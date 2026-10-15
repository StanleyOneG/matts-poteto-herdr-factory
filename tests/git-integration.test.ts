import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { GitIntegration } from "../src/git-integration.js";
import { IntegrationIntent, ResultIdentity, resultDigest } from "../src/result-domain.js";
import type { GuardedCommand } from "../src/git-workspace.js";

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "g38-"));
  const cwd = join(root, "repo"), source = join(root, "source");
  await mkdir(cwd);
  const git = async (path: string, ...args: string[]) => (await exec("git", ["-C", path, ...args])).stdout.trim();
  await git(cwd, "init", "-b", "main");
  await git(cwd, "config", "user.name", "Git integration fixture");
  await git(cwd, "config", "user.email", "integration@example.test");
  await writeFile(join(cwd, "tracked"), "base\n");
  await git(cwd, "add", "."); await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "task-parent");
  await git(cwd, "worktree", "add", "-b", "task-source", source);
  await writeFile(join(source, "tracked"), "reviewed\n");
  await git(source, "commit", "-am", "candidate");
  const workspace = { repository: await git(cwd, "rev-parse", "--absolute-git-dir"), repositoryId: randomUUID(), path: source,
    branch: "refs/heads/task-source", parent: "refs/heads/task-parent", parentPath: cwd };
  const run: GuardedCommand = async command => {
    try { const output = await exec("bash", ["-c", command]); return { kind: "finished", code: 0, output: output.stdout + output.stderr }; }
    catch (error) {
      const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).safeParse(error);
      return result.success ? { kind: "finished", code: result.data.code, output: result.data.stdout + result.data.stderr } : { kind: "unknown", message: String(error) };
    }
  };
  return { root, cwd, source, workspace, run, git, adapter: new GitIntegration({ cwd, run }) };
}
async function intentFor(f: Awaited<ReturnType<typeof fixture>>) {
  const observed = await f.adapter.observe({ workspace: f.workspace });
  assert.equal(observed.kind, "clean", JSON.stringify(observed));
  if (observed.kind !== "clean") assert.fail("clean candidate required");
  const owner = randomUUID();
  const identity = ResultIdentity.parse({ workspace: f.workspace, commit: observed.commit, tree: observed.tree, parent: { ref: f.workspace.parent, commit: observed.parentCommit },
    assignment: { owner, task: { id: randomUUID(), revision: 1 }, scope: "approved", reservation: randomUUID(), assignment: randomUUID(), executor: { session: "executor", generation: randomUUID() } },
    criteria: ["reviewed content"], requiredChecks: ["focused tests"] });
  const result = { id: randomUUID(), digest: resultDigest(identity) }, verificationDigest = "a".repeat(64);
  return IntegrationIntent.parse({ id: randomUUID(), result, identity, verificationDigest,
    review: { id: randomUUID(), result, verificationDigest, reviewer: { session: "reviewer", run: "independent" }, reference: "review.md", outcome: "approved", evidence: ["exact candidate reviewed"] },
    controller: { owner, session: "controller", generation: 1, epoch: 0 } });
}

test("GitIntegration fast-forwards only the pinned clean owning task parent and confirms actual Git state", async () => {
  const f = await fixture(), intent = await intentFor(f);
  const main = await f.git(f.cwd, "rev-parse", "refs/heads/main");
  let authority = 0;
  const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => { authority++; } });
  assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
  if (outcome.kind !== "confirmed") assert.fail("confirmed parent integration required");
  assert.equal(authority, 1);
  assert.equal(outcome.parent.before, intent.identity.parent.commit);
  assert.equal(outcome.parent.after, intent.identity.commit);
  assert.equal(outcome.parent.tree, intent.identity.tree);
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), intent.identity.commit);
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "reviewed\n");
  assert.equal(await f.git(f.cwd, "status", "--porcelain"), "");
  assert.equal(await f.git(f.cwd, "rev-parse", "refs/heads/main"), main);
  assert.equal((await f.adapter.reconcile({ intent })).kind, "confirmed");
});

test("GitIntegration reconciles an applied fast-forward with lost acknowledgment read-only, without another merge", async () => {
  const f = await fixture(), intent = await intentFor(f);
  let effects = 0;
  const run: GuardedCommand = async command => {
    const result = await f.run(command);
    if (command.includes("GIT_REFLOG_ACTION=")) { effects++; assert.equal(result.kind, "finished"); return { kind: "unknown", message: "lost receipt after actual Git operation" }; }
    return result;
  };
  const adapter = new GitIntegration({ cwd: f.cwd, run });
  assert.equal((await adapter.integrate({ intent, assertAuthority: async () => {} })).kind, "unknown");
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), intent.identity.commit, "actual effect applied despite missing receipt");
  const before = await f.git(f.cwd, "reflog", "show", "--format=%H %gs", "task-parent");
  assert.equal((await new GitIntegration({ cwd: f.cwd, run }).reconcile({ intent })).kind, "confirmed", "fresh adapter needs only durable intent and actual Git evidence");
  assert.equal(await f.git(f.cwd, "reflog", "show", "--format=%H %gs", "task-parent"), before);
  assert.equal(effects, 1);
  const unrelatedOperation = { ...intent, id: randomUUID() };
  assert.equal((await adapter.reconcile({ intent: unrelatedOperation })).kind, "unknown", "same final tree alone does not prove another operation applied");
  assert.equal((await adapter.integrate({ intent, assertAuthority: async () => assert.fail("no replay authority") })).kind, "confirmed");
  assert.equal(effects, 1, "bound existing integration is observed, never re-executed");
  await writeFile(join(f.cwd, "after-integration"), "preserve\n");
  const dirty = await adapter.integrate({ intent, assertAuthority: async () => assert.fail("never retry an applied operation") });
  assert.equal(dirty.kind, "unknown", "later dirty state cannot relabel a prior applied operation as no-effect");
});

test("GitIntegration holds divergent conflict resolution until a newly captured committed identity is checked and reviewed", async () => {
  const f = await fixture(), old = await intentFor(f);
  await writeFile(join(f.cwd, "tracked"), "parent competing change\n");
  await f.git(f.cwd, "commit", "-am", "parent moved");
  const movedParent = await f.git(f.cwd, "rev-parse", "HEAD");
  const refused = await f.adapter.integrate({ intent: old, assertAuthority: async () => assert.fail("stale parent has no effect authority") });
  assert.equal(refused.kind, "failed");
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), movedParent);
  const divergent = await intentFor(f);
  assert.notEqual(divergent.result.digest, old.result.digest, "changed parent changes exact identity even with unchanged source");
  const held = await f.adapter.integrate({ intent: divergent, assertAuthority: async () => assert.fail("divergent integration is held") });
  assert.equal(held.kind, "failed");
  await assert.rejects(f.git(f.source, "merge", "--no-commit", "task-parent"), /CONFLICT|Command failed/);
  assert.match(await f.git(f.source, "status", "--porcelain"), /UU tracked/);
  assert.equal((await f.adapter.observe({ workspace: f.workspace })).kind, "held");
  assert.equal((await f.adapter.reconcile({ intent: old })).kind, "unknown");
  // Separate fixture authority, NOT adapter behavior: material manual resolution is committed on the source.
  await writeFile(join(f.source, "tracked"), "material resolved combination\n");
  await f.git(f.source, "add", "tracked"); await f.git(f.source, "commit", "-m", "material conflict resolution");
  assert.equal((await f.adapter.integrate({ intent: divergent, assertAuthority: async () => assert.fail("old review does not authorize changed content") })).kind, "failed");
  const fresh = await intentFor(f);
  assert.notEqual(fresh.identity.commit, old.identity.commit);
  assert.notEqual(fresh.identity.tree, old.identity.tree);
  assert.notEqual(fresh.result.digest, divergent.result.digest);
  assert.equal((await f.adapter.integrate({ intent: fresh, assertAuthority: async () => {} })).kind, "confirmed");
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "material resolved combination\n");
  assert.equal((await f.adapter.reconcile({ intent: old })).kind, "unknown", "old candidate can never confirm the material resolution");
});

test("GitIntegration preserves dirty source and parent index, tracked and untracked state instead of staging or resetting", async () => {
  for (const side of ["source", "parent"]) {
    for (const dirt of ["index", "tracked", "untracked"]) {
      const f = await fixture(), intent = await intentFor(f), path = side === "source" ? f.source : f.cwd;
      await writeFile(join(path, dirt === "untracked" ? "untracked" : "tracked"), `${side} ${dirt} sentinel\n`);
      if (dirt === "index") await f.git(path, "add", "tracked");
      const before = await f.git(path, "status", "--porcelain=v1", "--untracked-files=all");
      const ref = await f.git(f.cwd, "rev-parse", "task-parent");
      const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => assert.fail("dirty resources never reach the effect") });
      assert.equal(outcome.kind, "failed", `${side}/${dirt}: ${JSON.stringify(outcome)}`);
      if (outcome.kind === "failed") assert.equal(outcome.noEffect, true);
      assert.equal(await f.git(path, "status", "--porcelain=v1", "--untracked-files=all"), before);
      assert.equal(await f.git(f.cwd, "rev-parse", "task-parent"), ref);
      assert.equal(await readFile(join(path, dirt === "untracked" ? "untracked" : "tracked"), "utf8"), `${side} ${dirt} sentinel\n`);
      assert.equal((await f.adapter.reconcile({ intent })).kind, "unknown", "read-only absence is not a no-effect proof");
    }
  }
});

test("GitIntegration preserves wrong/unrelated checkouts and never adopts a parent checked out elsewhere", async () => {
  const f = await fixture(), intent = await intentFor(f);
  await f.git(f.cwd, "checkout", "-b", "unrelated");
  await writeFile(join(f.cwd, "tracked"), "unrelated dirty work\n");
  const other = join(f.root, "other-parent");
  await f.git(f.cwd, "worktree", "add", other, "task-parent");
  const before = await f.git(other, "rev-parse", "HEAD");
  assert.equal((await f.adapter.integrate({ intent, assertAuthority: async () => assert.fail("no parent adoption") })).kind, "failed");
  assert.equal(await f.git(other, "rev-parse", "HEAD"), before);
  assert.equal(await f.git(f.cwd, "symbolic-ref", "HEAD"), "refs/heads/unrelated");
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "unrelated dirty work\n");
  assert.equal(await readFile(join(other, "tracked"), "utf8"), "base\n");
  const relocated = new GitIntegration({ cwd: other, run: f.run });
  assert.equal((await relocated.integrate({ intent, assertAuthority: async () => assert.fail("frozen parent path cannot relocate") })).kind, "failed");
});

test("GitIntegration refuses main and legacy unpinned parent targets despite approved reviews", async () => {
  const f = await fixture();
  await f.git(f.cwd, "checkout", "main");
  f.workspace.parent = "refs/heads/main";
  const mainIntent = await intentFor(f);
  assert.equal((await f.adapter.integrate({ intent: mainIntent, assertAuthority: async () => assert.fail("review is not main authority") })).kind, "failed");
  await f.git(f.cwd, "checkout", "task-parent"); f.workspace.parent = "refs/heads/task-parent";
  const pinned = await intentFor(f);
  const { parentPath: _parentPath, ...workspace } = pinned.identity.workspace;
  const identity = { ...pinned.identity, workspace }, result = { ...pinned.result, digest: resultDigest(identity) };
  const legacy = IntegrationIntent.parse({ ...pinned, identity, result, review: { ...pinned.review, result } });
  assert.equal((await f.adapter.integrate({ intent: legacy, assertAuthority: async () => assert.fail("missing pin is not adoption permission") })).kind, "failed");
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), pinned.identity.parent.commit);
});

test("GitIntegration remains a fast-forward ref integration even when task branch merge defaults request squash", async () => {
  const f = await fixture(), intent = await intentFor(f);
  await f.git(f.cwd, "config", "branch.task-parent.mergeOptions", "--squash --autostash");
  const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => {} });
  assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), intent.identity.commit);
  assert.equal(await f.git(f.cwd, "status", "--porcelain"), "");
  assert.equal(await f.git(f.cwd, "config", "branch.task-parent.mergeOptions"), "--squash --autostash", "adapter does not persist settings changes");
});

test("GitIntegration rechecks actual refs and dirtiness after authority, and never claims a submitted failed guard had no effect", async () => {
  const f = await fixture(), intent = await intentFor(f);
  const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => {
    // An actual Git change at the public authority boundary, not a mocked observation.
    await f.git(f.cwd, "checkout", "-b", "new-unrelated");
    await writeFile(join(f.cwd, "tracked"), "late unrelated sentinel\n");
  } });
  assert.equal(outcome.kind, "unknown", JSON.stringify(outcome));
  if (outcome.kind !== "unknown") assert.fail("submitted guarded-command failure stays uncertain");
  assert.match(outcome.message, /exited 1/);
  assert.equal(await f.git(f.cwd, "rev-parse", "task-parent"), intent.identity.parent.commit);
  assert.equal(await f.git(f.cwd, "symbolic-ref", "HEAD"), "refs/heads/new-unrelated");
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "late unrelated sentinel\n");
  assert.equal((await f.adapter.reconcile({ intent })).kind, "unknown");
});

test("GitIntegration refuses revoked core authority before submitting any Git effect", async () => {
  const f = await fixture(), intent = await intentFor(f);
  const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => { throw new Error("owning run stopped"); } });
  assert.equal(outcome.kind, "failed");
  if (outcome.kind === "failed") assert.equal(outcome.noEffect, true);
  assert.equal(await f.git(f.cwd, "rev-parse", "task-parent"), intent.identity.parent.commit);
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "base\n");
});

test("GitIntegration holds the second serialized owning-run integration when the first moved their shared parent", async () => {
  const f = await fixture(), first = await intentFor(f), otherPath = join(f.root, "second-source");
  await f.git(f.cwd, "worktree", "add", "-b", "second-source", otherPath, "task-parent");
  await writeFile(join(otherPath, "second"), "second reviewed candidate\n");
  await f.git(otherPath, "add", "second"); await f.git(otherPath, "commit", "-m", "second candidate");
  const secondFixture = { ...f, workspace: { ...f.workspace, branch: "refs/heads/second-source", path: otherPath } };
  const second = await intentFor(secondFixture);
  assert.equal(second.identity.parent.commit, first.identity.parent.commit);
  assert.equal((await f.adapter.integrate({ intent: first, assertAuthority: async () => {} })).kind, "confirmed");
  assert.equal((await f.adapter.integrate({ intent: second, assertAuthority: async () => assert.fail("stale second request cannot overwrite the parent") })).kind, "failed");
  assert.equal(await f.git(f.cwd, "rev-parse", "task-parent"), first.identity.commit);
  assert.equal(await readFile(join(otherPath, "second"), "utf8"), "second reviewed candidate\n");
  const recaptured = await intentFor(secondFixture);
  assert.notEqual(recaptured.result.digest, second.result.digest);
  assert.equal((await f.adapter.integrate({ intent: recaptured, assertAuthority: async () => assert.fail("still divergent; no blind merge") })).kind, "failed");
});

test("GitIntegration rejects wrong repository/worktree/branch and commit-tree pins without adoption", async () => {
  const f = await fixture(), intent = await intentFor(f);
  const wrong = await fixture();
  for (const workspace of [{ ...f.workspace, repository: wrong.workspace.repository }, { ...f.workspace, path: wrong.source }, { ...f.workspace, branch: "refs/heads/main" }])
    assert.equal((await f.adapter.observe({ workspace })).kind, "held");
  const identity = { ...intent.identity, tree: "0".repeat(40) }, result = { ...intent.result, digest: resultDigest(identity) };
  const mismatched = IntegrationIntent.parse({ ...intent, identity, result, review: { ...intent.review, result } });
  assert.equal((await f.adapter.integrate({ intent: mismatched, assertAuthority: async () => assert.fail("wrong exact tree cannot integrate") })).kind, "failed");
  assert.equal(await f.git(f.cwd, "rev-parse", "HEAD"), intent.identity.parent.commit);
});

test("GitIntegration preserves tracked edits hidden from Git status by assume-unchanged flags", async () => {
  for (const side of ["source", "parent"]) {
    const f = await fixture(), intent = await intentFor(f), path = side === "source" ? f.source : f.cwd;
    await f.git(path, "update-index", "--assume-unchanged", "tracked");
    await writeFile(join(path, "tracked"), "hidden dirty sentinel\n");
    assert.equal(await f.git(path, "status", "--porcelain"), "", "ordinary status is insufficient for this real Git state");
    if (side === "source") assert.equal((await f.adapter.observe({ workspace: f.workspace })).kind, "held");
    const outcome = await f.adapter.integrate({ intent, assertAuthority: async () => assert.fail("hidden tracked edits require a hold") });
    assert.equal(outcome.kind, "failed", JSON.stringify(outcome));
    assert.equal(await readFile(join(path, "tracked"), "utf8"), "hidden dirty sentinel\n");
    assert.equal(await f.git(f.cwd, "rev-parse", "task-parent"), intent.identity.parent.commit);
  }
});

test("GitIntegration holds a clean-looking source with an unfinished real Git merge", async () => {
  const f = await fixture();
  await f.git(f.cwd, "checkout", "-b", "empty-side", "main");
  await f.git(f.cwd, "commit", "--allow-empty", "-m", "empty side");
  await f.git(f.cwd, "checkout", "task-parent");
  await f.git(f.source, "merge", "--no-ff", "--no-commit", "empty-side");
  assert.equal(await f.git(f.source, "status", "--porcelain"), "");
  assert.equal((await f.adapter.observe({ workspace: f.workspace })).kind, "held");
  assert.equal(await f.git(f.source, "rev-parse", "--verify", "MERGE_HEAD"), await f.git(f.cwd, "rev-parse", "empty-side"));
});

test("GitIntegration observes exact clean committed source and intended parent without changing either checkout", async () => {
  const f = await fixture();
  const observed = await f.adapter.observe({ workspace: f.workspace });
  assert.equal(observed.kind, "clean", JSON.stringify(observed));
  if (observed.kind !== "clean") assert.fail("clean observation required");
  assert.equal(observed.commit, await f.git(f.source, "rev-parse", "HEAD"));
  assert.equal(observed.tree, await f.git(f.source, "rev-parse", "HEAD^{tree}"));
  assert.equal(observed.parentCommit, await f.git(f.cwd, "rev-parse", "HEAD"));
  assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "base\n");
  await writeFile(join(f.source, "untracked"), "must not disappear\n");
  assert.equal((await f.adapter.observe({ workspace: f.workspace })).kind, "held");
  assert.equal(await readFile(join(f.source, "untracked"), "utf8"), "must not disappear\n");
});
