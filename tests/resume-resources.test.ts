import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { GitWorkspace } from "../src/git-workspace.js";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("fresh Legatus observes exact active worker without rebinding, receipts or native turns", async () => {
  await exerciseNativeAssignment("resume-resource-active");
});

for (const [scenario, behavior] of [
  ["retired", "observation retains production park/report without restoring assignment authority"],
  ["legacy", "missing legacy process identity is an actionable hold, not inferred liveness"],
  ["process-mismatch", "PID/start mismatch cannot prove applied actions or safe settlement"],
  ["missing-session", "missing actual Herdr session remains unknown without mutating retained state"],
  ["wrong-receipt", "only the exact saved action receipt can correlate an applied outcome"],
  ["wrong-origin", "applied assignment receipt cannot join an unrelated native user turn"],
  ["effect", "worker observation correlates only the exact admitted native effect outcome"],
  ["saved-hold", "current settlement and exact receipts cannot automatically release the original launch hold"],
  ["uncertain-start", "current process and settled report cannot resolve an uncertain original Pi start"],
]) test(behavior, async () => { await exerciseNativeAssignment(`resume-resource-${scenario}`); });

test("restarted native reader joins genuine result locator, exact runner and journal without controls", async () => {
  await exerciseNativeAssignment("child-resume-observation");
});

test("restarted native reader retains sticky unknown proof after ordinary later proof appears", async () => {
  await exerciseNativeAssignment("child-resume-sticky-proof");
});

test("resume Git observation preserves dirty work, index and legitimate later branch commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "rg-")), cwd = join(root, "repo"), worktree = join(root, "owned");
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "-b", "main", cwd]);
  git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "file.txt"), "base\n"); git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD"), branch = "refs/heads/owned";
  git("worktree", "add", "-q", "-b", "owned", worktree);
  writeFileSync(join(worktree, "file.txt"), "later\n");
  execFileSync("git", ["-C", worktree, "commit", "-qam", "later"]);
  const later = git("rev-parse", branch);
  writeFileSync(join(worktree, "file.txt"), "dirty\n"); writeFileSync(join(worktree, "sentinel"), "retain");
  const indexPath = execFileSync("git", ["-C", worktree, "rev-parse", "--path-format=absolute", "--git-path", "index"], { encoding: "utf8" }).trim(), beforeIndex = readFileSync(indexPath);
  const execute = promisify(exec), commands: string[] = [];
  const repository = new GitWorkspace(cwd, async command => {
    commands.push(command);
    try { return { kind: "finished", code: 0, output: (await execute(command)).stdout }; }
    catch (error) {
      if (error instanceof Error && "code" in error && typeof error.code === "number" && "stdout" in error && typeof error.stdout === "string") return { kind: "finished", code: error.code, output: error.stdout };
      throw error;
    }
  });
  const { commonDir } = await repository.locate();
  const result = await repository.observeResources({ plan: { branch, path: worktree, parent: "refs/heads/main", commit: base }, commonDir });
  assert.equal(result.disposition, "identified"); assert.deepEqual(result.dirty, { kind: "observed", value: true });
  assert.equal(result.association?.workspace?.commit, later);
  assert.deepEqual(readFileSync(indexPath), beforeIndex);
  assert.equal(readFileSync(join(worktree, "file.txt"), "utf8"), "dirty\n");
  assert.equal(readFileSync(join(worktree, "sentinel"), "utf8"), "retain");
  assert.equal(git("rev-parse", branch), later);
  assert.ok(commands.some(command => command.includes("--no-optional-locks") && command.includes("status")));
});
