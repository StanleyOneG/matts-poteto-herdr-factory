import assert from "node:assert/strict";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { Legion } from "../src/intake.ts";
import { GitWorkspace } from "../src/git-workspace.ts";
const exec = promisify(execFile);
const [action, rootArg, session, storageRoot, cwdArg] = process.argv.slice(2);
assert.equal(action, "seed", "Use seed <test-owned root> <exact Pi session ID>. This creates no Pi worker.");
assert.ok(rootArg && session);
const root = resolve(rootArg);
const cwd = resolve(cwdArg ?? join(root, "repo"));
await mkdir(root, { recursive: true });
const head = (await exec("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
const source = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
const diff = (await exec("git", ["diff", "HEAD"])).stdout;
const git = new GitWorkspace(cwd, async (command) => {
  try {
    const result = await exec("bash", ["-c", command], { cwd });
    await appendFile(join(root, "git-observations.jsonl"), JSON.stringify({ command, code: 0, stdout: result.stdout, stderr: result.stderr }) + "\n");
    return { kind: "finished", code: 0, output: result.stdout };
  } catch (error) {
    await appendFile(join(root, "git-observations.jsonl"), JSON.stringify({ command, code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n");
    if (typeof error.code === "number" && !error.signal && !error.killed && typeof error.stdout === "string" && typeof error.stderr === "string")
      return { kind: "finished", code: error.code, output: error.stdout + error.stderr };
    return { kind: "unknown", message: String(error) };
  }
});
const legion = new Legion({ storagePath: storageRoot ?? join(homedir(), ".pi/agent/legion"), context: cwd, session, preflight: async () => [], assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git } });
const command = (text, requestKey) => legion.command({ text, requestKey, evidence: { origin: "host-command", transport: "source-unavailable", session, generation: null, presented: [] } });
try {
  await command("task Report the trial label without editing files", "trial-task");
  let view = await legion.state();
  const pending = view.snapshot.submissions[0];
  assert.ok(pending);
  assert.equal((await legion.submit({ kind: "interpretation", requestKey: "trial-admission", proposal: { kind: "new-task", source: { id: pending.id, revision: 1 }, goal: "Read the trial worktree label and report Ready. Do not edit files, delegate, close issues, integrate, or accept work.", acceptance: ["Report Ready in one sentence"], questions: [] }, evidence: { session, generation: view.snapshot.generation, legatus: view.snapshot.id, run: "disposable-fixture", sources: [{ id: pending.id, revision: 1 }] } })).kind, "applied");
  view = await legion.state();
  const task = view.tasks[0];
  const parent = (await exec("git", ["-C", cwd, "symbolic-ref", "HEAD"])).stdout.trim();
  assert.equal((await command(`reserve ${task.id}@1 --parent ${parent}`, "trial-reserve")).kind, "deferred");
  const reserved = await legion.command({ workspaceRequest: "trial-reserve" });
  await writeFile(join(root, "workspace-result.json"), JSON.stringify(reserved, null, 2));
  assert.equal(reserved.kind, "reserved");
  assert.equal(reserved.workspace.kind, "ready");
  await command("off", "fixture-off");
  const manifest = { source, trackedDiffSha256: createHash("sha256").update(diff).digest("hex"), fixtureHead: head, owner: view.snapshot.id, task: task.id, session, reservation: reserved.receipt.reservation, setup: "Public-seam fixture setup. Not Pi or Herdr runtime acceptance.", commands: [`/legion resume ${view.snapshot.id}`, `/legion launch ${task.id}@1`] };
  await writeFile(join(root, "seed.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
} finally { await command("off", "fixture-final-off"); }
