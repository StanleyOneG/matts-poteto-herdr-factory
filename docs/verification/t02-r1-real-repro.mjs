import assert from "node:assert/strict";
import { GitWorkspace } from "../../src/git-workspace.ts";
import { execFileSync } from "node:child_process";
import { Legion } from "../../src/intake.ts";
import { mkdtempSync, mkdirSync } from "node:fs";
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
let held = 0;
for (let delay = 0; delay < 70; delay++) {
  if (delay) await command(`resume ${owner}`);
  await command(
    `reserve ${task}@1 --parent refs/heads/intended`,
    "request-" + delay,
  );
  block = true;
  offIssued = false;
  startedAfterOff = false;
  release = null;
  const before = locateCalls;
  const running = legion.command({ workspaceRequest: "request-" + delay });
  let offPromise;
  const stop = () => {
    offIssued = true;
    offPromise = command("off");
  };
  let remaining = delay;
  const tick = () => (remaining-- > 0 ? queueMicrotask(tick) : stop());
  queueMicrotask(tick);
  await new Promise((r) => setImmediate(r));
  await offPromise;
  const during = await legion.state();
  if (locateCalls > before) {
    assert.equal(
      startedAfterOff,
      false,
      `Discovery began after off at cut ${delay}`,
    );
    assert.equal(during.mode, "stopping");
    const replacement = new Legion(options);
    const takeover = await replacement.command({
      text: `resume ${owner}`,
      requestKey: "replacement-" + delay,
      evidence,
    });
    assert.equal(takeover.kind, "rejected");
    assert.equal(takeover.code, "ownership");
    held++;
  }

  block = false;
  release?.();
  await running;
  await command("off");
}
assert.ok(held > 0);
console.log(
  JSON.stringify({
    passed: true,
    root,
    cuts: 70,
    held,
    startedAfterOff: false,
    replacement: "rejected while unsettled",
  }),
);
