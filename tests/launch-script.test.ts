import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Legion } from "../src/intake.js";
const exec = promisify(execFile);
test("the disposable launch fixture preserves completed Git absence observations and produces a confirmed ready claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-launch-script-"));
  const repo = join(root, "repo"), storage = join(root, "state");
  await mkdir(repo);
  await exec("git", ["init", "-q", repo]);
  await exec("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-qm", "base"]);
  const session = randomUUID();
  let outcome = "finished";
  try {
    await exec(process.execPath, ["--import", "tsx", resolve("scripts/verify-launch.mjs"), "seed", root, session, storage]);
  }
  catch {
    outcome = "failed";
  }
  const result: unknown = JSON.parse(await readFile(join(root, "workspace-result.json"), "utf8"));
  const legion = new Legion({
    storagePath: storage, context: repo, session, preflight: async () => []
  });
  const view = await legion.state();
  assert.deepEqual({
    outcome, claim: view.tasks[0]?.claim.kind, workspace: view.tasks[0]?.claim.kind === "owned" ? view.tasks[0].claim.workspace.kind : "unavailable"
  }, {
    outcome: "finished", claim: "owned", workspace: "ready"
  }, JSON.stringify(result));
  assert.equal(view.mode, "inactive");
});
