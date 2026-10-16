import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, mkdir, unlink, symlink, lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorktreeCleanupAdapter, type WorktreeCleanupPermission, type WorktreeUsageReader } from "../src/worktree-cleanup.js";
import { WorktreeCleanupIntent, cleanupEligibility, type CleanupReferences } from "../src/cleanup-domain.js";
import { resultDigest } from "../src/result-domain.js";
import { LaunchRecord } from "../src/tribunus.js";
import type { GuardedCommand } from "../src/git-workspace.js";
import { HandoffRecord } from "../src/snapshot.js";

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wt-")), repo = join(root, "repo"), path = join(root, "owned");
  await mkdir(repo);
  const git = async (...args: string[]) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
  await git("init", "-b", "parent"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "code"), "accepted\n"); await git("add", "code"); await git("commit", "-m", "accepted");
  const commit = await git("rev-parse", "HEAD"), tree = await git("rev-parse", "HEAD^{tree}");
  await git("worktree", "add", "-b", "task", path, "HEAD");
  const commonDir = await git("rev-parse", "--path-format=absolute", "--git-common-dir");
  const address = { launch: randomUUID(), window: { endpoint: "/fixture/socket", server: "fixture-server", workspace: "w1", tab: "w1:t1", pane: "w1:p1", terminal: "term" }, session: "worker", generation: randomUUID() };
  const authority = { owner: randomUUID(), session: "legatus", generation: 1, epoch: 0 }, task = { id: randomUUID(), revision: 1 }, assignment = randomUUID(), reservation = randomUUID();
  const identity = { assignment: { owner: authority.owner, task, scope: "bounded", reservation, assignment, executor: { session: address.session, generation: address.generation } }, workspace: { repository: commonDir, repositoryId: randomUUID(), path, branch: "refs/heads/task", parent: "refs/heads/parent", parentPath: repo }, commit, tree, parent: { ref: "refs/heads/parent", commit }, criteria: ["accepted"], requiredChecks: ["tests"] };
  const result = { id: randomUUID(), digest: resultDigest(identity) }, integrationId = randomUUID();
  const intent = WorktreeCleanupIntent.parse({ id: randomUUID(), result, identity, target: { kind: "worktree", plan: { branch: identity.workspace.branch, path, parent: identity.parent.ref, commit } }, integration: { intent: { id: integrationId, result, identity, verificationDigest: "d".repeat(64), review: { id: randomUUID(), result, verificationDigest: "d".repeat(64), reviewer: { session: "independent", run: "review" }, reference: join(root, "review.md"), outcome: "approved", evidence: ["review"] }, controller: authority }, state: { kind: "confirmed", operation: integrationId, result, source: { commit, tree }, parent: { ref: identity.parent.ref, before: commit, after: commit, tree }, evidence: ["integration"] } } });
  const worker = { address, resources: { cwd: path, skills: [], diagnostics: [] }, identityEvidence: "fixture-native" };
  const launch = LaunchRecord.parse({ id: address.launch, reservation, revision: 1, scope: "bounded", startEvidence: { kind: "completed" }, state: { kind: "reported", worker, initialization: { command: randomUUID(), address, nativePrompt: "initialize", skillPath: "", modeEntry: "mode", settledEntry: "settled" }, command: assignment, assignment: { task, scope: "bounded", goal: "result", acceptance: ["accepted"], workflow: "implement", authority: "bounded-implementation-only" }, application: join(root, "journal") + "#assignment", report: { outcome: "reported-result", assistantText: "done", evidence: [join(root, "report")] } } });
  const references: CleanupReferences = { launches: [launch], handoffs: [], resultEvidence: [] };
  const run: GuardedCommand = async command => {
    try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
    catch (error) { if (error instanceof Error && "code" in error && typeof error.code === "number") return { kind: "finished", code: error.code, output: error.message }; throw error; }
  };
  let permission: WorktreeCleanupPermission | undefined;
  let usage: WorktreeUsageReader = async () => ({ usage: "unused", evidence: ["controlled complete native lifecycle and process census"] });
  const evidenceRoot = join(root, "receipts");
  const adapter = () => new LocalWorktreeCleanupAdapter({ commonDir, evidenceRoot, run, usage: input => usage(input), ...(permission ? { permission } : {}) });
  return { root, repo, path, commonDir, intent, references, launch, git, adapter, evidenceRoot, run, allow: (value: WorktreeCleanupPermission) => { permission = value; }, use: (value: WorktreeUsageReader) => { usage = value; } };
}

test("exact accepted integrated clean worktree is eligible without mutating Git or evidence", async () => {
  const f = await fixture();
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(cleanupEligibility({ intent: f.intent, observation }).kind, "eligible", observation.evidence.join("\n"));
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
  assert.deepEqual((await readdir(f.root)).sort(), ["owned", "repo"]);
});

// Seed the old on-disk receipt format, never use the product to create a removal.
async function historicalRemoval({ f, outcome = { kind: "finished", code: 0, output: "" } }: { f: Awaited<ReturnType<typeof fixture>>; outcome?: { kind: "finished"; code: number; output: string } | { kind: "unknown"; message: string } }) {
  const stamp = async (path: string) => {
    const stat = await lstat(path, { bigint: true });
    return { path: await realpath(path), dev: stat.dev.toString(), ino: stat.ino.toString(), birth: stat.birthtimeNs.toString() };
  };
  const gitfile = join(f.path, ".git"), gitfileText = await readFile(gitfile, "utf8");
  const identity = { common: await stamp(f.commonDir), directory: await stamp(f.path), administrative: await stamp(gitfileText.trim().slice(8)), gitfile: await stamp(gitfile), gitfileText };
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  const command = ["git", "-C", f.commonDir, "worktree", "remove", "--", f.path].map(value => `'${value}'`).join(" ");
  const root = join(f.evidenceRoot, f.intent.id); await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "dispatch.json"), JSON.stringify({ intent: f.intent, command, observation, identity }), { mode: 0o600 });
  if (outcome.kind === "unknown" || outcome.code === 0) await f.git("worktree", "remove", "--", f.path);
  await writeFile(join(root, "receipt.json"), JSON.stringify({ intent: f.intent, command, outcome }), { mode: 0o600 });
}

test("historical exact successful removal receipt remains readable without replay or history loss", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "journal"), "retained report and history\n");
  await historicalRemoval({ f });
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "confirmed");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("never replay"); } })).kind, "retained");
  assert.equal(await f.git("rev-parse", "refs/heads/task"), f.intent.identity.commit);
  assert.equal(await readFile(join(f.root, "journal"), "utf8"), "retained report and history\n");
  await assert.rejects(readFile(join(f.path, "code")), { code: "ENOENT" });
});

async function observeEligibility({ f }: { f: Awaited<ReturnType<typeof fixture>> }) {
  return cleanupEligibility({ intent: f.intent, observation: await f.adapter().observe({ intent: f.intent, references: f.references }) });
}

test("ignored evidence appearing during native usage observation is preserved", async () => {
  const f = await fixture();
  await writeFile(join(f.path, ".gitignore"), "private-evidence\n");
  await exec("git", ["-C", f.path, "add", ".gitignore"]); await exec("git", ["-C", f.path, "commit", "-m", "ignore evidence"]);
  // Bind a fresh accepted result for this fixture's current clean source.
  const commit = (await exec("git", ["-C", f.path, "rev-parse", "HEAD"])).stdout.trim();
  const tree = (await exec("git", ["-C", f.path, "rev-parse", "HEAD^{tree}"])).stdout.trim();
  await f.git("merge", "--ff-only", "task");
  const intent = withSource({ intent: f.intent, commit, tree });
  f.use(async () => { await writeFile(join(f.path, "private-evidence"), "unpreserved review evidence\n"); return { usage: "unused", evidence: ["controlled settled census"] }; });
  const observation = await f.adapter().observe({ intent, references: f.references });
  assert.equal(observation.cleanliness, "dirty");
  assert.equal(await readFile(join(f.path, "private-evidence"), "utf8"), "unpreserved review evidence\n");
});

function withSource({ intent, commit, tree }: { intent: WorktreeCleanupIntent; commit: string; tree: string }): WorktreeCleanupIntent {
  const identity = { ...intent.identity, commit, tree }, result = { ...intent.result, digest: resultDigest(identity) };
  assert.equal(intent.integration.state.kind, "confirmed");
  if (intent.integration.state.kind !== "confirmed") throw new Error("fixture needs confirmed integration");
  return WorktreeCleanupIntent.parse({ ...intent, identity, result, integration: { intent: { ...intent.integration.intent, identity, result, review: { ...intent.integration.intent.review, result } }, state: { ...intent.integration.state, result, source: { commit, tree }, parent: { ...intent.integration.state.parent, after: commit, tree } } } });
}

for (const dirt of ["tracked", "staged", "untracked", "ignored"] ) test(`${dirt} work is retained without deleting any files or branch`, async () => {
  const f = await fixture();
  if (dirt === "tracked" || dirt === "staged") {
    await writeFile(join(f.path, "code"), "unpreserved edit\n");
    if (dirt === "staged") await exec("git", ["-C", f.path, "add", "code"]);
  } else {
    if (dirt === "ignored") await writeFile(join(f.commonDir, "info", "exclude"), "unpreserved\n");
    await writeFile(join(f.path, "unpreserved"), "unpreserved artifact\n");
  }
  f.allow(async ({ execute }) => execute());
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained" && outcome.reason === "cleanliness");
  assert.equal(await f.git("rev-parse", "task"), f.intent.identity.commit);
  assert.ok((await readdir(f.root)).includes("owned"));
  assert.ok(!(await readdir(f.root)).includes("receipts"));
});

test("a later committed result is not silently discarded as clean accepted work", async () => {
  const f = await fixture(); await writeFile(join(f.path, "code"), "later unaccepted work\n");
  await exec("git", ["-C", f.path, "commit", "-am", "later"]);
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "later unaccepted work\n");
});

test("integration must still belong to the intended parent, not merely some branch", async () => {
  const f = await fixture();
  const unrelated = await f.git("commit-tree", f.intent.identity.tree, "-m", "unrelated parent");
  await f.git("update-ref", "refs/heads/parent", unrelated);
  f.allow(async ({ execute }) => execute());
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained" && outcome.reason === "integration");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

test("inert removal never enters permission, usage, final guard, or Git even for a clean accepted worktree", async () => {
  const f = await fixture();
  f.use(async () => { throw new Error("Inert removal must not observe usage"); });
  f.allow(async () => { throw new Error("Inert removal must not request permission"); });
  const adapter = new LocalWorktreeCleanupAdapter({ commonDir: f.commonDir, evidenceRoot: f.evidenceRoot, run: async () => { throw new Error("Inert removal must not execute Git"); }, permission: async () => { throw new Error("No permission entry"); } });
  const outcome = await adapter.remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("No guard entry"); } });
  assert.ok(outcome.kind === "retained" && outcome.reason === "automatic-worktree-removal-unsupported");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
  assert.equal(await f.git("rev-parse", "task"), f.intent.identity.commit);
  assert.deepEqual((await readdir(f.root)).sort(), ["owned", "repo"]);
});

test("same canonical path and branch recreated after historical removal is preserved as a different incarnation", async () => {
  const f = await fixture(); await historicalRemoval({ f });
  await f.git("worktree", "add", f.path, "task");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  const outcome = await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("No effect"); } });
  assert.ok(outcome.kind === "retained" && outcome.reason === "automatic-worktree-removal-unsupported");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

for (const usage of ["in-use", "unknown", "malformed", "unavailable"] ) test(`native ${usage} usage never becomes unused from UI idle or acceptance`, async () => {
  const f = await fixture();
  f.use(async () => { if (usage === "unavailable") throw new Error("native observation unavailable"); return { usage, evidence: ["actual native boundary"] }; });
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

test("no configured complete usage reader is a visible retention, not a default deletion grant", async () => {
  const f = await fixture();
  const adapter = new LocalWorktreeCleanupAdapter({ commonDir: f.commonDir, evidenceRoot: f.evidenceRoot, run: f.run, permission: async ({ execute }) => execute() });
  const observation = await adapter.observe({ intent: f.intent, references: f.references });
  assert.equal(observation.usage, "unknown");
  assert.ok(observation.evidence.some(text => text.includes("No complete native")));
  assert.equal((await adapter.remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
});

for (const artifact of ["report", "review", "journal"] ) test(`referenced tracked ${artifact} inside the target must remain available`, async () => {
  const f = await fixture(), inside = join(f.path, "code");
  if (artifact === "review") f.intent.integration.intent.review.reference = inside;
  if (f.launch.state.kind !== "reported") throw new Error("fixture launch");
  if (artifact === "report") f.launch.state.report.evidence = [inside];
  if (artifact === "journal") f.launch.state.application = inside + "#entry";
  f.allow(async ({ execute }) => execute());
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(observation.needs.reviewer, "needed");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(inside, "utf8"), "accepted\n");
});

for (const location of ["worktree", "administrative", "historical-alias", "missing-absolute"])
test(`retained result capture evidence in ${location} is preserved by ordinary path checks`, async () => {
  const f = await fixture();
  const gitdir = (await readFile(join(f.path, ".git"), "utf8")).trim().slice(8);
  const path = location === "administrative" ? join(gitdir, "logs", "HEAD") : join(f.path, "code");
  const original = await readFile(path, "utf8");
  if (location === "historical-alias") await symlink(path, join(f.root, "capture-alias"));
  const reference = location === "historical-alias" ? "capture-alias#capture" : location === "worktree" ? "code#capture" : location === "missing-absolute" ? join(gitdir, "missing-capture") : path;
  f.references.resultEvidence.push({ reference, cwd: location === "historical-alias" ? f.root : f.path });
  f.allow(async ({ execute }) => execute());
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained" && outcome.reason === "reviewer");
  assert.ok(outcome.evidence.includes(`Preserve referenced artifact at ${reference}`));
  assert.equal(await readFile(path, "utf8"), original);
  assert.ok(!(await readdir(f.root)).includes("receipts"));
});

test("relative result history references resolve from their original workspace, not the cleanup target", async () => {
  const f = await fixture(), historical = join(f.root, "history");
  await mkdir(historical); await writeFile(join(historical, "code"), "retained historical capture\n");
  f.references.resultEvidence.push({ reference: "code#capture", cwd: historical });
  assert.equal((await observeEligibility({ f })).kind, "eligible");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(join(historical, "code"), "utf8"), "retained historical capture\n");
});

test("unresolvable result-evidence symlinks retain the worktree instead of becoming opaque diagnostics", async () => {
  const f = await fixture();
  await symlink("capture-loop", join(f.root, "capture-loop"));
  f.references.resultEvidence.push({ reference: "capture-loop", cwd: f.root });
  f.allow(async ({ execute }) => execute());
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained" && outcome.reason === "ownership");
  assert.match(outcome.evidence.join("\n"), /ELOOP/);
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
  assert.ok(!(await readdir(f.root)).includes("receipts"));
});

for (const location of ["missing-relative", "missing-alias-child", "dangling-ancestor"])
test(`explicit relative result evidence with ${location} retains the worktree`, async () => {
  const f = await fixture();
  if (location !== "missing-relative") await symlink(location === "dangling-ancestor" ? join(f.path, "missing-directory") : f.path, join(f.root, "capture-alias"));
  const reference = location === "missing-relative" ? "./evidence/missing.json" : "capture-alias/report.json";
  f.references.resultEvidence.push({ reference, cwd: location === "missing-relative" ? f.path : f.root });
  f.allow(async ({ execute }) => execute());
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained", `Expected unresolved evidence retention, got ${outcome.kind}`);
  assert.equal(outcome.reason, location === "dangling-ancestor" ? "ownership" : "reviewer");
  if (location === "dangling-ancestor") assert.match(outcome.evidence.join("\n"), /Preserve unresolved worktree facts.*ENOENT/);
  else assert.ok(outcome.evidence.includes(`Preserve referenced artifact at ${reference}`));
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
  assert.ok(!(await readdir(f.root)).includes("receipts"));
});

test("opaque short and long native diagnostics remain readable without granting worktree removal", async () => {
  const f = await fixture();
  const reflog = `${"a".repeat(40)} ${"b".repeat(40)} Fixture <fixture@example.test> 1792068558 +0000\tlegion-integrate:${randomUUID()}:${"c".repeat(64)}: Fast-forward`;
  assert.ok(Buffer.byteLength(reflog) > 255);
  f.references.resultEvidence.push(...["exit-0", reflog, "https://evidence.example.test/capture/report.json"].map(reference => ({ reference, cwd: f.path })));
  assert.equal((await observeEligibility({ f })).kind, "eligible");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await f.git("rev-parse", "refs/heads/task"), f.intent.identity.commit);
});

test("cleanup evidence cannot be stored within the worktree being removed", async () => {
  const f = await fixture();
  const adapter = new LocalWorktreeCleanupAdapter({ commonDir: f.commonDir, evidenceRoot: join(f.path, "receipts"), run: f.run, usage: async () => ({ usage: "unused", evidence: ["controlled census"] }), permission: async ({ execute }) => execute() });
  assert.equal((await adapter.remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.deepEqual((await readdir(f.path)).sort(), [".git", "code"]);
});

test("legacy permission callbacks and final guards cannot revive removal", async () => {
  const f = await fixture();
  f.allow(async () => { throw new Error("Legacy permission callback must not run"); });
  const held = await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("must not enter"); } });
  assert.ok(held.kind === "retained" && held.reason === "automatic-worktree-removal-unsupported");
  assert.deepEqual((await readdir(f.root)).sort(), ["owned", "repo"]);
});

test("absence alone and a lost historical native receipt remain read-only unknown without blind replay", async () => {
  const f = await fixture();
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.deepEqual((await readdir(f.root)).sort(), ["owned", "repo"]);
  await historicalRemoval({ f, outcome: { kind: "unknown", message: "native receipt lost" } });
  const receipt = await readFile(join(f.evidenceRoot, f.intent.id, "receipt.json"), "utf8");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("no replay"); } })).kind, "retained");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal(await readFile(join(f.evidenceRoot, f.intent.id, "receipt.json"), "utf8"), receipt);
});

test("historical successful exact Git receipt never removes a later reused path", async () => {
  const f = await fixture(); await historicalRemoval({ f });
  await f.git("worktree", "add", f.path, "task");
  await writeFile(join(f.path, "new-human-work"), "preserve\n");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("no repeat"); } })).kind, "retained");
  assert.equal(await readFile(join(f.path, "new-human-work"), "utf8"), "preserve\n");
});

for (const loss of ["missing", "corrupt", "conflicting"] ) test(`${loss} durable receipt cannot infer success from path absence`, async () => {
  const f = await fixture(); await historicalRemoval({ f });
  const receipt = join(f.evidenceRoot, f.intent.id, "receipt.json");
  if (loss === "missing") await unlink(receipt);
  else if (loss === "corrupt") await writeFile(receipt, "not-json");
  else { const saved = JSON.parse(await readFile(receipt, "utf8")); saved.intent.id = randomUUID(); await writeFile(receipt, JSON.stringify(saved)); }
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("never replay"); } })).kind, "retained");
});

function predecessor({ f }: { f: Awaited<ReturnType<typeof fixture>> }) {
  if (f.launch.state.kind !== "reported") throw new Error("fixture launch");
  const oldAddress = { ...f.launch.state.worker.address, launch: randomUUID(), session: "predecessor", generation: randomUUID() };
  const oldCommand = randomUUID();
  const old = LaunchRecord.parse({ ...f.launch, id: oldAddress.launch, state: { ...f.launch.state, command: oldCommand, worker: { ...f.launch.state.worker, address: oldAddress }, report: { ...f.launch.state.report, outcome: "blocked" } } });
  const assignment = f.intent.identity.assignment;
  const id = randomUUID(), command = randomUUID();
  const modelPin = { model: "openai-codex/gpt-6.1-sol", thinking: "high", profile: "matt" };
  const workflowChoice = { profile: "matt", requestedWorkflow: "implement" };
  const artifact = { path: join(f.root, "handoff.md"), tempRoot: f.root, evidence: "native temporary artifact" };
  const handoff = HandoffRecord.parse({ id, pin: { ...f.intent.integration.intent.controller, task: assignment.task, scope: assignment.scope, reservation: assignment.reservation, assignment: oldCommand, launch: oldAddress.launch, workerSession: oldAddress.session, workerGeneration: oldAddress.generation, addressDigest: createHash("sha256").update(JSON.stringify(oldAddress)).digest("hex") }, stop: randomUUID(), command, purpose: "finish result", continuation: "accepted successor result", modelPin, workflowChoice, state: { kind: "successor-reserved", retirementEvidence: ["parked"], launch: f.launch.id, receipt: { handoff: id, command, application: join(f.root, "old-journal") + "#handoff", settledEntry: join(f.root, "old-journal") + "#settled", effectEvidence: ["settled native handoff"], artifact } } });
  f.launch.successor = { handoff: id, predecessor: oldAddress.launch, assignment: oldCommand, artifact, modelPin: handoff.modelPin, workflowChoice: handoff.workflowChoice, continuation: handoff.continuation };
  f.references.launches.unshift(old); f.references.handoffs.push(handoff);
  return { old, handoff };
}

test("disconnected predecessor handoff cycles cannot erase continuation needs", async () => {
  const f = await fixture(), p = predecessor({ f });
  p.old.successor = f.launch.successor; delete f.launch.successor;
  if (p.handoff.state.kind !== "successor-reserved") throw new Error("fixture handoff");
  p.handoff.state.launch = p.old.id;
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.notEqual(observation.needs.continuation, "clear");
});

test("all retained predecessor and successor references reach fresh native usage checks", async () => {
  const f = await fixture(), p = predecessor({ f }); let predecessorInUse = true;
  f.use(async ({ references }) => {
    assert.deepEqual(references.launches.map(launch => launch.id), [p.old.id, f.launch.id]);
    assert.equal(references.handoffs[0]?.id, p.handoff.id);
    return { usage: predecessorInUse ? "in-use" : "unused", evidence: ["actual predecessor, successor and detached child census"] };
  });
  const held = await observeEligibility({ f });
  assert.ok(held.kind === "retained" && held.reason === "usage");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
  predecessorInUse = false;
  assert.equal((await observeEligibility({ f })).kind, "eligible");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await f.git("rev-parse", "task"), f.intent.identity.commit);
});

test("fresh predecessor use is retained even when the successor has settled", async () => {
  const f = await fixture(), p = predecessor({ f }); let active = false;
  f.use(async ({ references }) => ({ usage: active && references.launches.some(launch => launch.id === p.old.id) ? "in-use" : "unused", evidence: ["native child started in predecessor's worktree"] }));
  active = true;
  const outcome = await observeEligibility({ f });
  assert.ok(outcome.kind === "retained" && outcome.reason === "usage");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

for (const need of ["outgoing", "missing-predecessor", "unstarted-successor", "held-predecessor"] ) test(`${need} durable lifecycle is not clear continuation`, async () => {
  const f = await fixture(), p = predecessor({ f });
  if (need === "outgoing") p.handoff.pin.launch = f.launch.id;
  if (need === "missing-predecessor") f.references.launches.shift();
  if (need === "unstarted-successor") f.launch.startEvidence = { kind: "uncertain", message: "lost start" };
  if (need === "held-predecessor" && p.old.state.kind !== "held") p.old.state = { kind: "held", last: p.old.state, code: "unknown", message: "unresolved predecessor" };
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(cleanupEligibility({ intent: f.intent, observation }).kind, "retained");
});

test("completed handoff artifact inside target remains preserved even when tracked and native usage is clear", async () => {
  const f = await fixture(), p = predecessor({ f });
  if (p.handoff.state.kind !== "successor-reserved") throw new Error("fixture handoff");
  p.handoff.state.receipt.artifact = { path: join(f.path, "code"), tempRoot: f.path, evidence: "retained exact handoff" };
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(observation.needs.reviewer, "needed");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

for (const change of ["backlink", "branch", "registration", "symlink", "repository"] ) test(`changed ${change} identity is retained without adoption`, async () => {
  const f = await fixture();
  if (change === "backlink") { const gitdir = (await readFile(join(f.path, ".git"), "utf8")).trim().slice(8); await writeFile(join(gitdir, "gitdir"), join(f.repo, ".git")); }
  if (change === "branch") { await f.git("branch", "replacement", "task"); await exec("git", ["-C", f.path, "symbolic-ref", "HEAD", "refs/heads/replacement"]); }
  if (change === "registration" || change === "symlink") { const saved = join(f.root, "saved"); await f.git("worktree", "move", f.path, saved); if (change === "symlink") await symlink(saved, f.path); }
  if (change === "repository") f.intent.identity.workspace.repository = join(f.root, "other", ".git");
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.ok(!(await readdir(f.root)).includes("receipts"));
});

test("repeated legacy calls cannot overwrite an already applied historical Git removal receipt", async () => {
  const f = await fixture(); await historicalRemoval({ f });
  const before = await readFile(join(f.evidenceRoot, f.intent.id, "receipt.json"), "utf8");
  f.allow(async () => { throw new Error("Must not enter legacy permission"); });
  for (let i = 0; i < 2; i++) assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("No effect"); } })).kind, "retained");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "confirmed");
  assert.equal(await readFile(join(f.evidenceRoot, f.intent.id, "receipt.json"), "utf8"), before);
});

test("historical native nonzero receipt remains unknown rather than claiming conclusive no-effect", async () => {
  const f = await fixture(); await historicalRemoval({ f, outcome: { kind: "finished", code: 1, output: "Git refused removal" } });
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("no retry"); } })).kind, "retained");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

for (const flag of ["--assume-unchanged", "--skip-worktree"] ) test(`${flag} cannot hide unpreserved tracked work from cleanup`, async () => {
  const f = await fixture();
  await exec("git", ["-C", f.path, "update-index", flag, "code"]);
  await writeFile(join(f.path, "code"), "hidden unpreserved edit\n");
  f.allow(async ({ execute }) => execute());
  const outcome = await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.equal(outcome.kind, "retained");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "hidden unpreserved edit\n");
});

test("native usage evidence stored inside target is not deleted as an otherwise clean tracked file", async () => {
  const f = await fixture();
  f.use(async () => ({ usage: "unused", evidence: [join(f.path, "code")] }));
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});

test("independent receipts cannot live in Git administrative data removed by ordinary worktree removal", async () => {
  const f = await fixture();
  const gitdir = (await readFile(join(f.path, ".git"), "utf8")).trim().slice(8);
  const adapter = new LocalWorktreeCleanupAdapter({ commonDir: f.commonDir, evidenceRoot: join(gitdir, "receipts"), run: f.run, usage: async () => ({ usage: "unused", evidence: ["controlled census"] }), permission: async ({ execute }) => execute() });
  assert.equal((await adapter.remove({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(await readFile(join(f.path, "code"), "utf8"), "accepted\n");
});
