import assert from "node:assert/strict";
import { GitWorkspace } from "../../src/git-workspace.ts";
import { execFileSync } from "node:child_process";
import { Legion } from "../../src/intake.ts";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = mkdtempSync("/tmp/t02-spec-race-");
mkdirSync(join(root, "repo.git"));
mkdirSync(join(root, "checkout"));
let locateCalls = 0,
  release,
  block = false,
  offIssued = false,
  startedAfterOff = false;
execFileSync("git", ["init", "-q", join(root, "checkout")]);
execFileSync("git", [
  "-C",
  join(root, "checkout"),
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.test",
  "commit",
  "--allow-empty",
  "-qm",
  "base",
]);
execFileSync("git", ["-C", join(root, "checkout"), "branch", "intended"]);
const git = new GitWorkspace(join(root, "checkout"), async (command) => {
  locateCalls++;
  startedAfterOff = offIssued;
  const output = execFileSync("bash", ["-c", command], { encoding: "utf8" });
  if (block) await new Promise((r) => (release = r));
  return { kind: "finished", code: 0, output };
});
const options = {
  storagePath: join(root, "intake"),
  context: join(root, "checkout"),
  session: "fixture",
  preflight: async () => [],
  assignments: {
    workspaceRoot: join(root, "workspaces"),
    repository: () => git,
  },
};
const legion = new Legion(options);
let key = 0;
const evidence = {
  origin: "host-command",
  transport: "source-unavailable",
  session: "fixture",
  generation: null,
  presented: [],
};
const command = (text, requestKey = String(++key)) =>
  legion.command({ text, requestKey, evidence });
await command("task test");
let view = await legion.state();
const source = view.snapshot.submissions[0];
await legion.submit({
  kind: "interpretation",
  requestKey: "interpret",
  proposal: {
    kind: "new-task",
    source: { id: source.id, revision: 1 },
    goal: "test",
    acceptance: [],
    questions: [],
  },
  evidence: {
    session: "fixture",
    generation: view.snapshot.generation,
    legatus: view.snapshot.id,
    run: "test",
    sources: [{ id: source.id, revision: 1 }],
  },
});
view = await legion.state();
const owner = view.snapshot.id,
  task = view.tasks[0].id;

await command(`reserve ${task}@1 --parent refs/heads/intended`, "pending");
block = true;
const running = legion.command({ workspaceRequest: "pending" });
while (!release) await new Promise((r) => setImmediate(r));
const snapshotFile = join(root, "intake", `v1.${owner}.sqlite`);
const original = readFileSync(snapshotFile);
writeFileSync(snapshotFile, "corrupt fixture snapshot");
const stopped = await command("off");
assert.equal(stopped.view.mode, "stopping");
assert.match(stopped.view.unavailable, /not a database/);
console.log(
  JSON.stringify({
    offMode: stopped.view.mode,
    unavailable: stopped.view.unavailable,
    gitPending: !!release,
    root,
  }),
);
writeFileSync(snapshotFile, original);
assert.equal((await legion.state()).mode, "stopping");
console.log(
  JSON.stringify({
    afterRestoringReadableSnapshot: (await legion.state()).mode,
  }),
);
block = false;
release();
await running;
await command("off");

assert.equal((await legion.state()).mode, "inactive");
console.log(JSON.stringify({ passed: true, settledMode: "inactive" }));
