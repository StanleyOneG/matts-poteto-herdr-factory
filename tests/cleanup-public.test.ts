import { test } from "node:test";
import assert from "node:assert/strict";
import { legatusUiFixture } from "./support/legatus-ui.mjs";

test("public cleanup tools expose only exact operation controls and passive observation", async () => {
  const f = await legatusUiFixture();
  try {
    for (const name of ["legion_cleanup", "legion_clean"]) {
      const tool = f.tools.get(name); assert.ok(tool, name);
      assert.equal(tool.exposure, "model-only");
      assert.doesNotMatch(JSON.stringify(tool.parameters), /\"command\"|\"generation\"|\"legatus\"|\"usage\"/);
      assert.equal((await f.call(name, { requestId: "forged" })).isError, true);
    }
    const before = await f.state();
    await f.runtime.command("status"); await f.runtime.command("doctor");
    assert.deepEqual(await f.state(), before);
    await f.runtime.command("help");
    assert.match(f.runtime.notices.at(-1) ?? "", /cleanup observe/);
  } finally { await f.close(); }
});

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TabCleanupIntent, WorktreeCleanupIntent, CleanupRecord, WorktreeCleanupOutcome, cleanupTargetDigest } from "../src/cleanup-domain.js";
import { SnapshotStore } from "../src/snapshot.js";

type RetainedEvidence = "check" | "criterion" | "resolved-exception" | "verification-history" | "review-history" | "prior-result";
async function accepted({ complete = true, retainedEvidence }: { complete?: boolean; retainedEvidence?: RetainedEvidence } = {}) {
  const native = { activity: "done", snapshotUnavailable: false, ...(complete ? { usage: async () => ({ usage: "unused", evidence: ["Controlled complete native process and every retained actor settlement boundary"] }) } : {}) };
  const f = await legatusUiFixture({ parent: "task-parent", cleanup: native });
  try {
    await f.runtime.command("implement-spec=on Implement bounded cleanup result"); await f.startPending();
    const source = (await f.state()).snapshot?.submissions[0]; assert.ok(source);
    assert.equal((await f.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Cleanup", acceptance: ["Exact reviewed parent result"], questions: [] })).isError, false);
    const task = (await f.state()).tasks[0]; assert.ok(task);
    const worker = await f.launch({ id: task.id, revision: 1 });
    writeFileSync(join(worker.ctx.cwd, "result.txt"), "accepted cleanup content\n");
    execFileSync("git", ["-C", worker.ctx.cwd, "add", "result.txt"]);
    execFileSync("git", ["-C", worker.ctx.cwd, "-c", "user.name=Cleanup", "-c", "user.email=cleanup@example.test", "commit", "-qm", "result"]);
    await worker.settle(false, "Reported bounded result, not acceptance");
    for (let i = 0; i < 200 && (await f.state()).tasks[0]?.launch.kind !== "reported"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const artifact = join(worker.ctx.cwd, "result.txt");
    if (retainedEvidence === "prior-result") {
      const prior = await f.call("legion_result", { action: { kind: "capture", task: { id: task.id, revision: 1 }, requiredChecks: ["historical"] } });
      assert.ok(prior.details?.kind === "result-stage");
      const result = { id: prior.details.result.id, digest: prior.details.result.digest };
      assert.equal((await f.call("legion_result", { action: { kind: "verify", result, verification: { criteria: [], checks: [{ name: "historical", outcome: "failed", evidence: [artifact] }], exceptions: [] } } })).isError, false);
    }
    const captured = await f.call("legion_result", { action: { kind: "capture", task: { id: task.id, revision: 1 }, requiredChecks: ["focused"] } });
    assert.ok(captured.details?.kind === "result-stage", JSON.stringify(captured));
    const result = { id: captured.details.result.id, digest: captured.details.result.digest };
    if (retainedEvidence === "verification-history")
      assert.equal((await f.call("legion_result", { action: { kind: "verify", result, verification: { criteria: [], checks: [{ name: "focused", outcome: "failed", evidence: [artifact] }], exceptions: [] } } })).isError, false);
    const verified = await f.call("legion_result", { action: { kind: "verify", result, verification: { criteria: [{ criterion: 0, outcome: "passed", evidence: [retainedEvidence === "criterion" ? artifact : "criterion"] }], checks: [{ name: "focused", outcome: "passed", evidence: [retainedEvidence === "check" ? artifact : "exit-0"] }], exceptions: retainedEvidence === "resolved-exception" ? [{ description: "Resolved material exception", resolution: { kind: "resolved", summary: "Verified resolution", evidence: [artifact] } }] : [] } } });
    assert.ok(verified.details?.kind === "result-stage");
    if (retainedEvidence === "review-history")
      assert.equal((await f.call("legion_result", { action: { kind: "review", id: randomUUID(), result, verificationDigest: verified.details.result.verifications.at(-1)?.digest, reviewer: { session: "initial-independent", run: "initial-review" }, reference: artifact + "#findings", outcome: "changes-requested", evidence: ["initial exact-result review"] } })).isError, false);
    assert.equal((await f.call("legion_result", { action: { kind: "review", id: randomUUID(), result, verificationDigest: verified.details.result.verifications.at(-1)?.digest, reviewer: { session: "independent", run: "review" }, reference: "review.md", outcome: "approved", evidence: ["exact-result-review"] } })).isError, false);
    const integration = randomUUID();
    assert.equal((await f.call("legion_result", { action: { kind: "prepare-integration", result, id: integration } })).isError, false);
    const integrated = await f.call("legion_integrate", { requestId: integration });
    assert.equal(integrated.isError, false, JSON.stringify(integrated));
    const view = await f.state(); assert.ok(view.snapshot); assert.equal(view.tasks[0]?.resultStatus.kind, "accepted");
    const tab = view.snapshot.cleanups.find((record: { intent: { target: { kind: string } } }) => record.intent.target.kind === "tab");
    assert.ok(tab);
    assert.deepEqual(view.snapshot.cleanups.map(record => record.intent.target.kind), ["tab"]);
    // Old-format record for explicit legacy-fixture cases; the product must not create one.
    const claim = view.tasks[0]?.claim; assert.ok(claim?.kind === "owned");
    const worktree = CleanupRecord.parse({ intent: { ...tab.intent, id: randomUUID(), target: { kind: "worktree", plan: claim.reservation.plan } }, state: { kind: "pending" } });
    assert.match(JSON.stringify(integrated.content), new RegExp(`legion_clean.*${tab.intent.id}`), "The model must receive the automatic exact next stage, not only a human UI notification");
    return { ...f, worker, native, tab: { ...tab, intent: TabCleanupIntent.parse(tab.intent) }, worktree: { ...worktree, intent: WorktreeCleanupIntent.parse(worktree.intent) },
      state: async () => { const view = await f.state(); assert.ok(view.snapshot); return { ...view, snapshot: view.snapshot }; },
    };
  } catch (error) { await f.close(); throw error; }
}

for (const prior of ["pending", "retained", "failed", "dispatched", "unknown"] as const)
test(`legacy ${prior} worktree removal remains non-destructive through public controls and explicit resume`, async () => {
  const f = await accepted();
  try {
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, false);
    const snapshot = (await f.state()).snapshot;
    const record = f.worktree;
    snapshot.cleanups.push(record);
    const binding = { resource: "worktree", operation: record.intent.id, result: record.intent.result, targetDigest: cleanupTargetDigest({ intent: record.intent }), evidence: ["historical-cleanup-evidence"] };
    const unknown = WorktreeCleanupOutcome.parse({ ...binding, kind: "unknown", message: "Historical effect receipt lost" });
    record.history = [unknown];
    record.state = prior === "pending" || prior === "dispatched" ? { kind: prior }
      : prior === "unknown" ? unknown
      : WorktreeCleanupOutcome.parse(prior === "failed" ? { ...binding, kind: "failed", noEffect: true, message: "Historical proven no-effect failure" }
      : { ...binding, kind: "retained", noEffect: true, reason: "usage", message: "Historical usage unknown" });
    const legacy = CleanupRecord.parse(record);
    const revision = snapshot.revision++;
    await new SnapshotStore(join(f.root, "a", "legion")).save(snapshot, revision, () => true);
    const before = (await f.state()).snapshot;
    await f.runtime.command("status"); await f.runtime.command("doctor");
    assert.deepEqual((await f.state()).snapshot, before, "Observation never migrates history or authorizes effects");
    const prepared = await f.call("legion_cleanup", { action: { kind: "prepare", id: record.intent.id } });
    assert.equal(prepared.isError, true);
    assert.deepEqual((await f.state()).snapshot.cleanups[1], legacy, "Disabling removal never rewrites historical operations");
    await f.call("legion_cleanup", { action: { kind: "reconcile", id: record.intent.id } });
    await f.runtime.command(`cleanup observe ${snapshot.id} ${record.intent.id}`);
    assert.deepEqual((await f.state()).snapshot.cleanups[1], legacy, "Reconciliation preserves even dispatched/unknown state exactly");
    assert.equal((await f.call("legion_clean", { requestId: record.intent.id })).isError, true);
    await f.runtime.command("off"); await f.runtime.settle();
    await f.runtime.command(`resume ${snapshot.id}`);
    const after = await f.state();
    assert.equal(after.mode, prior === "unknown" || prior === "dispatched" ? "stopping" : "active");
    assert.deepEqual(after.snapshot.results, snapshot.results);
    assert.deepEqual(after.snapshot.handoffs, snapshot.handoffs);
    assert.deepEqual(after.snapshot.cleanups[1]?.intent, legacy.intent);
    assert.deepEqual(after.snapshot.cleanups[1]?.controllers, legacy.controllers);
    assert.deepEqual(after.snapshot.cleanups[1]?.history[0], unknown);
    assert.ok(existsSync(f.worker.ctx.cwd));
    assert.equal(readFileSync(join(f.worker.ctx.cwd, "result.txt"), "utf8"), "accepted cleanup content\n");
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", f.worktree.intent.target.plan.branch], { encoding: "utf8" }).trim(), f.worktree.intent.identity.commit);
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-worktrees", f.worktree.intent.id)), false);
  } finally { await f.close(); }
});

test("first version retains accepted worktree and branch before any cleanup command, without blocking eligible tab closure", async () => {
  const f = await accepted();
  try {
    const initial = await f.state(), before = initial.snapshot;
    assert.deepEqual(before.cleanups.map(record => record.intent.target.kind), ["tab"]);
    assert.equal(initial.tasks[0]?.retainedWorktree?.path, f.worker.ctx.cwd);
    assert.equal(initial.tasks[0]?.retainedWorktree?.branch, f.worktree.intent.target.plan.branch);
    assert.match(initial.tasks[0]?.retainedWorktree?.reason ?? "", /unsupported in this version/);
    const closed = await f.call("legion_clean", { requestId: f.tab.intent.id });
    assert.equal(closed.isError, false);
    const after = (await f.state()).snapshot;
    assert.equal(after.cleanups.find(record => record.intent.id === f.tab.intent.id)?.state.kind, "confirmed");
    assert.deepEqual(after.results, before.results);
    assert.equal(readFileSync(join(f.worker.ctx.cwd, "result.txt"), "utf8"), "accepted cleanup content\n");
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", f.worktree.intent.target.plan.branch], { encoding: "utf8" }).trim(), f.worktree.intent.identity.commit);
    assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true);
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-worktrees", f.worktree.intent.id)), false);
    await f.runtime.command("status");
    assert.match(f.runtime.notices.at(-1) ?? "", /Automatic worktree removal is unsupported in this version/);
    assert.match(f.runtime.notices.at(-1) ?? "", new RegExp(f.worker.ctx.cwd));
    await f.runtime.command("help");
    assert.match(f.runtime.notices.at(-1) ?? "", /Automatic worktree removal is unsupported in this version/);
  } finally { await f.close(); }
});

for (const retainedEvidence of ["check", "criterion", "resolved-exception", "verification-history", "review-history", "prior-result"] satisfies RetainedEvidence[])
test(`cleanup preserves a clean tracked artifact referenced only by retained result ${retainedEvidence}`, async () => {
  const f = await accepted({ retainedEvidence });
  try {
    const path = join(f.worker.ctx.cwd, "result.txt");
    assert.equal(execFileSync("git", ["-C", f.worker.ctx.cwd, "status", "--porcelain"], { encoding: "utf8" }), "");
    const before = (await f.state()).snapshot;
    await f.call("legion_clean", { requestId: f.tab.intent.id });
    assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true);
    const view = await f.state();
    assert.equal(view.tasks[0]?.retainedWorktree?.path, f.worker.ctx.cwd);
    assert.match(view.tasks[0]?.retainedWorktree?.reason ?? "", /unsupported in this version/);
    assert.equal(readFileSync(path, "utf8"), "accepted cleanup content\n");
    assert.deepEqual(view.snapshot.results, before.results, "Cleanup preserves authoritative evidence records without copying artifacts");
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-worktrees", f.worktree.intent.id)), false);
  } finally { await f.close(); }
});

test("accepted exact result closes its eligible tab through ordinary Bash while retaining worktree, branch and evidence", async () => {
  const f = await accepted();
  try {
    const before = (await f.state()).snapshot;
    await f.runtime.command("status"); await f.runtime.command("doctor");
    assert.deepEqual((await f.state()).snapshot, before);
    assert.equal(existsSync(f.closedPath), false); assert.ok(existsSync(f.worker.ctx.cwd));
    assert.equal((await f.call("legion_clean", { requestId: randomUUID() })).isError, true);
    const tool = f.tools.get("legion_clean"); assert.ok(tool);
    await assert.rejects(() => tool.execute("forged", { requestId: f.tab.intent.id }, undefined, undefined, { ...f.runtime.ctx, tools: [] }), /correlated/);
    let authorized = 0;
    f.runtime.pi.on("tool_call", (event) => {
      if (event.toolName !== "bash") return;
      assert.ok(event.parentToolCallId); assert.match(JSON.stringify(event.input), /cleanup-gate\.mjs.*&& herdr tab close/);
      authorized++;
    });
    const closed = await f.call("legion_clean", { requestId: f.tab.intent.id });
    assert.equal(closed.isError, false);
    assert.doesNotMatch(JSON.stringify(closed.content), new RegExp(`legion_clean.*${f.worktree.intent.id}`), "No worktree effect stage is prepared");
    assert.ok(existsSync(f.closedPath)); assert.ok(existsSync(f.worker.ctx.cwd), "Tab close alone never removes worktree");
    assert.equal((await f.state()).snapshot.cleanups[0]?.state.kind, "confirmed");
    assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true);
    const view = await f.state();
    assert.deepEqual(view.snapshot.cleanups.map((record: { state: { kind: string } }) => record.state.kind), ["confirmed"]);
    const task = view.tasks[0]; assert.ok(task?.claim.kind === "owned"); assert.equal(task.claim.workspace.kind, "ready");
    assert.equal(existsSync(f.worker.ctx.cwd), true);
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", f.worktree.intent.target.plan.branch], { encoding: "utf8" }).trim(), f.worktree.intent.identity.commit);
    assert.ok(existsSync(join(f.root, "worker.jsonl"))); assert.equal(authorized, 1);
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, true);
    const run = view.snapshot.id;
    await f.runtime.command("off"); await f.runtime.settle();
    assert.equal((await f.state()).mode, "inactive");
    await f.runtime.command(`resume ${run}`);
    const resumed = await f.state();
    assert.equal(resumed.mode, "active"); assert.ok(resumed.tasks[0]?.claim.kind === "owned");
    assert.equal(resumed.tasks[0].claim.workspace.kind, "ready", "Explicit recovery preserves the retained worktree");
    assert.equal(authorized, 1, "Off/resume never replays cleanup or contacts confirmed closed actor");
  } finally { await f.close(); }
});

for (const resource of ["tab"]) test(`ordinary command-aware Bash denial preserves exact ${resource} without a native dispatch or fallback`, async () => {
  const f = await accepted();
  try {
    if (resource === "worktree") assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, false);
    let denied = 0;
    f.runtime.pi.on("tool_call", (event) => {
      if (event.toolName === "bash" && (resource === "tab" ? JSON.stringify(event.input).includes("herdr tab close") : JSON.stringify(event.input).includes("'worktree' 'remove'"))) {
        denied++; return { block: true, reason: "Ordinary command-specific operator denial" };
      }
    });
    const target = resource === "tab" ? f.tab : f.worktree;
    await f.call("legion_clean", { requestId: target.intent.id });
    const record = (await f.state()).snapshot.cleanups.find((record: { intent: { id: string } }) => record.intent.id === target.intent.id);
    assert.ok(record); assert.equal(record.state.kind, "retained"); assert.ok(record.state.kind === "retained"); assert.equal(record.state.reason, "permission-not-entered");
    assert.equal(existsSync(join(f.root, "a", "legion", resource === "tab" ? "cleanup-tabs" : "cleanup-worktrees", target.intent.id)), false, "The trusted closure never entered: no adapter dispatch/receipt directory");
    assert.equal(existsSync(f.closedPath), resource === "worktree"); assert.ok(existsSync(f.worker.ctx.cwd)); assert.equal(denied, 1);
    assert.equal((await f.call("legion_clean", { requestId: target.intent.id })).isError, true, "Consumed correlation never retries");
    if (resource === "tab") {
      assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true, "Worktree removal remains unavailable regardless of tab outcome");
      assert.equal(existsSync(f.closedPath), false);
    }
  } finally { await f.close(); }
});

for (const change of ["activity", "identity", "authority"]) test(`Trust/permission-held Bash does nothing; late ${change} prevents close after approval`, async () => {
  const f = await accepted();
  const session = f.runtime.ctx.sessionManager.getSessionId;
  try {
    let release!: () => void, held!: () => void;
    const waiting = new Promise<void>(resolve => { held = resolve; });
    const approval = new Promise<void>(resolve => { release = resolve; });
    f.runtime.pi.on("tool_call", async (event) => {
      if (event.toolName === "bash" && JSON.stringify(event.input).includes("herdr tab close")) { held(); await approval; }
    });
    const effect = f.call("legion_clean", { requestId: f.tab.intent.id });
    await waiting;
    assert.equal(existsSync(f.closedPath), false); assert.ok(existsSync(f.worker.ctx.cwd));
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-tabs", f.tab.intent.id)), false, "Trust hold cannot enter adapter closure");
    if (change === "activity") f.native.activity = "working";
    if (change === "identity") {
      const pane = JSON.parse(readFileSync(f.panePath, "utf8")); pane.agent_session.value = "reused-foreign-session"; writeFileSync(f.panePath, JSON.stringify(pane));
    }
    if (change === "authority") f.runtime.ctx.sessionManager.getSessionId = () => "foreign-current-session";
    release(); await effect;
    f.runtime.ctx.sessionManager.getSessionId = session;
    assert.equal(existsSync(f.closedPath), false);
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-tabs", f.tab.intent.id)), false);
    const record = (await f.state()).snapshot.cleanups[0]; assert.ok(record); assert.notEqual(record.state.kind, "confirmed");
  } finally { f.runtime.ctx.sessionManager.getSessionId = session; await f.close(); }
});

test("dirty worktrees and incomplete usage remain retained independently of eligible tab closure", async () => {
  const f = await accepted({ complete: false });
  try {
    writeFileSync(join(f.worker.ctx.cwd, "late.txt"), "Preserve native writer content");
    await f.call("legion_clean", { requestId: f.tab.intent.id });
    const records = (await f.state()).snapshot.cleanups;
    assert.equal(records[0]?.state.kind, "confirmed");
    assert.equal(records.length, 1);
    assert.equal((await f.state()).tasks[0]?.retainedWorktree?.path, f.worker.ctx.cwd);
    assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true);
    assert.equal(readFileSync(join(f.worker.ctx.cwd, "late.txt"), "utf8"), "Preserve native writer content");
    assert.equal(existsSync(join(f.root, "a", "legion", "cleanup-worktrees", f.worktree.intent.id)), false);
  } finally { await f.close(); }
});

test("saved exact native receipt reconciles after lost acknowledgment/off/restart without a second close", async () => {
  const f = await accepted({ complete: false });
  try {
    f.native.snapshotUnavailable = true;
    const lost = await f.call("legion_clean", { requestId: f.tab.intent.id });
    assert.equal(lost.isError, true);
    let view = await f.state(); assert.equal(view.snapshot.cleanups[0]?.state.kind, "unknown");
    assert.ok(existsSync(f.closedPath));
    const receipt = join(f.root, "a", "legion", "cleanup-tabs", f.tab.intent.id, "receipt.json");
    assert.equal(JSON.parse(readFileSync(receipt, "utf8")).outcome.code, 0);
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, true);
    f.native.snapshotUnavailable = false;
    assert.equal((await f.call("legion_cleanup", { action: { kind: "reconcile", id: f.tab.intent.id } })).isError, false);
    view = await f.state(); assert.equal(view.snapshot.cleanups[0]?.state.kind, "confirmed");
    const saved = readFileSync(f.closedPath, "utf8"), run = view.snapshot.id;
    await f.runtime.command("off"); await f.runtime.settle(); await f.runtime.emit("session_start");
    const before = await f.state(); assert.equal(before.mode, "inactive");
    const session = f.runtime.ctx.sessionManager.getSessionId;
    f.runtime.ctx.sessionManager.getSessionId = () => "foreign-retained-observer";
    await f.runtime.command(`cleanup observe ${run} ${f.tab.intent.id}`);
    assert.match(f.runtime.notices.at(-1) ?? "", /retained.*session|trusted host command/i);
    f.runtime.ctx.sessionManager.getSessionId = session;
    await f.runtime.command(`cleanup observe ${run} ${f.tab.intent.id}`);
    assert.match(f.runtime.notices.at(-1) ?? "", /confirmed/);
    assert.equal((await f.state()).mode, "inactive");
    assert.equal(readFileSync(f.closedPath, "utf8"), saved);
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, true);
  } finally { await f.close(); }
});

test("lost ordinary Bash receipt remains unknown despite native absence and cannot replay on reconciliation", async () => {
  const f = await accepted({ complete: false });
  try {
    const ordinary = f.runtime.ctx.executeTool;
    f.runtime.ctx.executeTool = async (...args) => {
      const receipt = await ordinary(...args);
      if (JSON.stringify(args).includes("herdr tab close")) throw new Error("Lost actual Bash acknowledgment after effect");
      return receipt;
    };
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, true);
    assert.ok(existsSync(f.closedPath));
    assert.equal((await f.state()).snapshot.cleanups[0]?.state.kind, "unknown");
    await f.call("legion_cleanup", { action: { kind: "reconcile", id: f.tab.intent.id } });
    assert.equal((await f.state()).snapshot.cleanups[0]?.state.kind, "unknown");
    assert.equal((await f.call("legion_clean", { requestId: f.tab.intent.id })).isError, true);
  } finally { await f.close(); }
});

test("worktree commands cannot enter ordinary Bash even with a complete usage override", async () => {
  const f = await accepted();
  try {
    await f.call("legion_clean", { requestId: f.tab.intent.id });
    let destructive = 0;
    f.runtime.pi.on("tool_call", event => {
      if (event.toolName === "bash" && JSON.stringify(event.input).includes("'worktree' 'remove'")) destructive++;
    });
    const prepared = await f.call("legion_cleanup", { action: { kind: "prepare", id: f.worktree.intent.id } });
    assert.equal(prepared.isError, true);
    assert.equal((await f.call("legion_clean", { requestId: f.worktree.intent.id })).isError, true);
    assert.equal(destructive, 0);
    assert.ok(existsSync(f.worker.ctx.cwd));
  } finally { await f.close(); }
});

test("concurrent duplicate gate callers cannot release two native effects or deadlock the correlated stage", async () => {
  const f = await accepted();
  try {
    const ordinary = f.runtime.ctx.executeTool;
    f.runtime.ctx.executeTool = async (name, args, options) => {
      if (name !== "bash" || !JSON.stringify(args).includes("herdr tab close")) return ordinary(name, args, options);
      assert.ok(typeof args === "object" && args && "command" in args && typeof args.command === "string");
      const split = args.command.lastIndexOf(" && herdr tab close"); assert.ok(split > 0);
      // The authorized Bash itself launches two identical fixed helper clients; only one may enter.
      const gate = args.command.slice(0, split), native = args.command.slice(split + 4);
      return ordinary(name, { command: `(${gate} && ${native}) & (${gate} && ${native}) & wait` }, options);
    };
    await f.call("legion_clean", { requestId: f.tab.intent.id });
    assert.ok(existsSync(f.closedPath));
    const receipt = JSON.parse(readFileSync(join(f.root, "a", "legion", "cleanup-tabs", f.tab.intent.id, "receipt.json"), "utf8"));
    assert.equal(receipt.outcome.code, 0); assert.equal(receipt.outcome.output.trim(), '{"result":{"type":"ok"}}', "Only one identical client released a native close");
  } finally { await f.close(); }
});

test("worktree and Git administrative data stay retained while a real process uses them", async () => {
  const f = await accepted({ complete: false });
  const { spawn } = await import("node:child_process");
  const administrative = execFileSync("git", ["-C", f.worker.ctx.cwd, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  const child = spawn(process.execPath, ["-e", "process.stdin.resume();process.stdout.write('ready');process.stdin.once('data',()=>process.exit(0));"], { cwd: administrative, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
    await f.call("legion_clean", { requestId: f.tab.intent.id });
    const view = await f.state();
    assert.equal(view.tasks[0]?.retainedWorktree?.path, f.worker.ctx.cwd);
    assert.match(view.tasks[0]?.retainedWorktree?.reason ?? "", /unsupported in this version/);
    assert.ok(existsSync(administrative)); assert.ok(existsSync(f.worker.ctx.cwd));
  } finally {
    child.stdin.end("exit\n"); const result = await exited;
    assert.deepEqual(result, { code: 0, signal: null }); await f.close();
  }
});
