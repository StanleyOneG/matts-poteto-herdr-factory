import { CleanupRecord, cleanupTargetDigest } from "../src/cleanup-domain.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { Legion, type LegionOptions } from "../src/intake.js";
import { GitWorkspace } from "../src/git-workspace.js";
import { mattInitializationPrompt, type TribunusHost } from "../src/tribunus.js";
import type { ResultRepository } from "../src/result-domain.js";
import { SnapshotStore } from "../src/snapshot.js";

const exec = promisify(execFile);
const sourceCommit = "a".repeat(40), sourceTree = "b".repeat(40), parentCommit = "c".repeat(40);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "r38-"));
  const checkout = join(root, "repo"); await mkdir(checkout);
  for (const args of [["init", "-b", "task-parent"], ["config", "user.name", "Result state fixture"], ["config", "user.email", "result@example.test"]]) await exec("git", ["-C", checkout, ...args]);
  await writeFile(join(checkout, "tracked"), "original\n");
  await exec("git", ["-C", checkout, "add", "tracked"]); await exec("git", ["-C", checkout, "commit", "-m", "initial"]);
  const git = new GitWorkspace(checkout, async command => {
    try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
    catch (error) { const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: result.code, output: result.stdout + result.stderr }; }
  });
  let worker: Parameters<TribunusHost["assign"]>[0]["worker"] | null = null;
  const reports = new Map<string, Parameters<NonNullable<TribunusHost["watchReports"]>>[1]>();
  const host: TribunusHost = {
    createWindow: async ({ launch, cwd }) => {
      const window = { endpoint: "/controlled/socket", server: "fixture", workspace: "w", tab: launch.id, pane: "p", terminal: "t" };
      worker = { address: { launch: launch.id, window, session: "executor", generation: randomUUID() }, resources: { cwd, principal: { model: "openai-codex/gpt-6.1-sol", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review", "implement"].map(name => ({ name, path: `/skills/${name}` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "fixture principal available" }], children: [] }, identityEvidence: "authenticated-fixture" };
      return window;
    },
    startPi: async () => {}, inspectWorker: async () => worker,
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "mode", settledEntry: "settled" }),
    assign: async () => ({ application: "assignment-user-entry" }),
    watchReports: ({ worker }, onReport) => { reports.set(worker.address.launch, onReport); },
  };
  let storageFault: LegionOptions["storageFault"];
  const options: LegionOptions = { storageFault: point => storageFault?.(point), storagePath: join(root, "state"), context: checkout, session: "controller", preflight: async () => [], tribuni: { host: () => host }, assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git } };
  const legion = new Legion(options);
  let sequence = 0;
  const command = (text: string) => legion.command({ text, requestKey: `command-${++sequence}`, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  await legion.command({ text: "task Implement exact result", requestKey: "task", workflowInvocation: { kind: "native-skill", workflow: "implement" }, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  const initial = (await legion.state()).snapshot; assert.ok(initial); const submission = initial.submissions[0]; assert.ok(submission);
  assert.equal((await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: { kind: "new-task", source: { id: submission.id, revision: 1 }, goal: "Implement exact result", acceptance: ["Exact result is verified"], questions: [] }, evidence: { session: "controller", generation: initial.generation, legatus: initial.id, run: "legatus", sources: [{ id: submission.id, revision: 1 }] } })).kind, "applied");
  const task = (await legion.state()).tasks[0]; assert.ok(task);
  await command(`reserve ${task.id}@1 --parent refs/heads/task-parent`);
  assert.equal((await legion.command({ workspaceRequest: `command-${sequence}` })).kind, "reserved");
  await command(`launch ${task.id}@1`); assert.equal((await legion.command({ launchRequest: `command-${sequence}` })).kind, "launched");
  const launch = (await legion.state()).tasks[0]?.launch; assert.ok(launch?.kind === "assigned", JSON.stringify(launch));
  const publish = reports.get(launch.worker.address.launch); assert.ok(publish); await publish({ address: launch.worker.address, command: launch.command, outcome: "reported-result", assistantText: "Completed, not accepted", evidence: ["worker-report"] });
  const control = async (action: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "result-control", action, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus-verification" } });
  };
  const interpret = async (proposal: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "interpretation", requestKey: `interpret-${++sequence}`, proposal, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus", sources: snapshot.submissions.map(source => ({ id: source.id, revision: source.revision })) } });
  };
  return { legion, options, git, command, control, interpret, task: { id: task.id, revision: 1 }, launch, root, setStorageFault: (fault: LegionOptions["storageFault"]) => { storageFault = fault; } };
}

function readOnlyAdapter({ commit = sourceCommit, tree = sourceTree }: { commit?: string; tree?: string } = {}): ResultRepository {
  return { observe: async () => ({ kind: "clean", commit, tree, parentCommit, evidence: ["read-only-git"] }),
    integrate: async () => { throw new Error("No fixture integration configured"); },
    reconcile: async () => { throw new Error("No fixture reconciliation configured"); } };
}
async function capture(f: Awaited<ReturnType<typeof fixture>>) {
  f.options.results = { repository: () => readOnlyAdapter() };
  const result = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] });
  assert.equal(result.kind, "result-stage", JSON.stringify(result));
  if (result.kind !== "result-stage") assert.fail("captured result required");
  return { id: result.result.id, digest: result.result.digest };
}
const passingVerification = { criteria: [{ criterion: 0, outcome: "passed", evidence: ["criterion-check"] }], checks: [{ name: "focused tests", outcome: "passed", evidence: ["test-exit-0"] }], exceptions: [] };

async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await capture(f);
  const verified = await f.control({ kind: "verify", result, verification: passingVerification });
  assert.ok(verified.kind === "result-stage", JSON.stringify(verified));
  const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
  assert.equal((await f.control({ kind: "review", result, id: randomUUID(), verificationDigest, reviewer: { session: "reviewer", run: "review-run" }, reference: "review-skill-evidence.md", outcome: "approved", evidence: ["review-passed"] })).kind, "result-stage");
  return result;
}

async function accept({ f, legacyWorktree = true }: { f: Awaited<ReturnType<typeof fixture>>; legacyWorktree?: boolean }) {
  const result = await ready(f), id = randomUUID(), adapter = readOnlyAdapter();
  adapter.integrate = async ({ intent, assertAuthority }) => {
    await assertAuthority();
    return { kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: sourceCommit, tree: sourceTree }, parent: { ref: "refs/heads/task-parent", before: parentCommit, after: sourceCommit, tree: sourceTree }, evidence: ["exact-parent-integration"] };
  };
  f.options.results = { repository: () => adapter };
  assert.deepEqual((await f.legion.state()).snapshot?.cleanups, []);
  await f.control({ kind: "prepare-integration", result, id });
  assert.deepEqual((await f.legion.state()).snapshot?.cleanups, []);
  const integrated = await f.legion.command({ integrationRequest: id });
  assert.equal(integrated.kind, "integration-stage", JSON.stringify(integrated));
  if (legacyWorktree) {
    // Seed an old-format worktree intent at the persisted-record boundary, not via V1 dispatch.
    const state = await f.legion.state(), snapshot = state.snapshot, claim = state.tasks[0]?.claim;
    assert.ok(snapshot && claim?.kind === "owned");
    const tab = snapshot.cleanups[0]; assert.ok(tab);
    snapshot.cleanups.push(CleanupRecord.parse({ intent: { ...tab.intent, id: randomUUID(), target: { kind: "worktree", plan: claim.reservation.plan } }, state: { kind: "pending" } }));
    const revision = snapshot.revision++;
    await new SnapshotStore(f.options.storagePath).save(snapshot, revision, () => true);
  }
  return { result, id };
}

async function seedCleanupState({ f, id, state }: { f: Awaited<ReturnType<typeof fixture>>; id: string; state: CleanupRecord["state"] }) {
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  const record = snapshot.cleanups.find(record => record.intent.id === id); assert.ok(record);
  record.state = state;
  if (state.kind !== "pending" && state.kind !== "dispatched") record.history.push(state);
  const revision = snapshot.revision++;
  await new SnapshotStore(f.options.storagePath).save(snapshot, revision, () => true);
}

test("accepted exact results queue independent durable cleanup intents without passive effects", async () => {
  const f = await fixture();
  try {
    const { result, id } = await accept({ f, legacyWorktree: false }), accepted = await f.legion.state();
    assert.equal(accepted.tasks[0]?.resultStatus.kind, "accepted");
    assert.deepEqual(accepted.snapshot?.cleanups.map(record => record.intent.target.kind).sort(), ["tab"]);
    assert.ok(accepted.snapshot?.cleanups.every(record => record.state.kind === "pending" && record.intent.integration.intent.id === id && record.intent.result.id === result.id));
    const before = accepted.snapshot;
    assert.deepEqual((await new Legion(f.options).state()).snapshot, before, "restart observation is passive");
    await f.command("status"); await f.command("doctor");
    assert.deepEqual((await f.legion.state()).snapshot, before, "status and doctor do not mutate or dispatch queued intents");
    await f.legion.command({ integrationRequest: id });
    assert.equal((await f.legion.state()).snapshot?.cleanups.length, 1, "acceptance does not duplicate resource operations or create removal intents");
  } finally { await f.command("off"); }
});

test("disabled legacy removal preserves earlier unaccepted result evidence without invoking worktree observation", async () => {
  const f = await fixture();
  try {
    const cwd = f.launch.worker.resources.cwd;
    const adapter = readOnlyAdapter();
    adapter.observe = async () => ({ kind: "clean", commit: sourceCommit, tree: sourceTree, parentCommit, evidence: ["tracked#capture"] });
    f.options.results = { repository: () => adapter };
    assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["historical capture"] })).kind, "result-stage");
    await accept({ f });
    const view = await f.legion.state(), worktree = view.snapshot?.cleanups.find(record => record.intent.target.kind === "worktree");
    assert.ok(worktree); assert.equal(view.snapshot?.results.length, 2);
    assert.equal(view.tasks[0]?.resultStatus.kind, "accepted");
    let observations = 0;
    f.options.cleanup = { tabs: () => null, worktrees: () => ({
      observe: async ({ intent, references }) => {
        assert.ok(references.resultEvidence.some(evidence => evidence.reference === "tracked#capture" && evidence.cwd === cwd));
        observations++;
        return worktreeObservation({ intent, needs: { continuation: "clear", handoffReader: "clear", reviewer: "needed" } });
      },
      remove: async () => { throw new Error("Capture evidence must remain available"); },
      reconcile: async () => { throw new Error("No cleanup dispatched"); },
    }) };
    const result = await runCleanup({ f, id: worktree.intent.id });
    assert.equal(result.kind, "rejected");
    assert.equal(observations, 0);
    assert.equal((await f.legion.state()).snapshot?.results[0]?.captureEvidence[0], "tracked#capture");
  } finally { await f.command("off"); }
});

test("cleanup retains a needed tab independently and rejects legacy worktree dispatch without a state change", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const records = (await f.legion.state()).snapshot?.cleanups; assert.ok(records);
    const tab = records.find(record => record.intent.target.kind === "tab"), worktree = records.find(record => record.intent.target.kind === "worktree"); assert.ok(tab && worktree);
    let closes = 0, removals = 0;
    f.options.cleanup = {
      tabs: () => ({
        observe: async ({ intent }) => tabObservation({ intent, needs: { continuation: "needed", handoffReader: "clear", reviewer: "clear" } }),
        close: async () => { closes++; throw new Error("Needed tab must not close"); },
        reconcile: async () => { throw new Error("Not dispatched"); },
      }),
      worktrees: () => ({
        observe: async ({ intent, references }) => {
          assert.equal(references.launches.length, 1, "Usage observation receives full retained launch history");
          return worktreeObservation({ intent });
        },
        remove: async ({ intent, finalGuard }) => {
          await finalGuard();
          assert.equal((await new Legion(f.options).state()).snapshot?.cleanups.find(record => record.intent.id === intent.id)?.state.kind, "dispatched");
          removals++;
          return { ...confirmed({ intent }), resource: "worktree" };
        },
        reconcile: async () => { throw new Error("No lost receipt"); },
      }),
    };
    const retained = await runCleanup({ f, id: tab.intent.id });
    assert.equal(retained.kind, "cleanup-stage", JSON.stringify(retained));
    assert.equal((await f.legion.state()).snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.state.kind, "retained");
    assert.equal(closes, 0);
    const removed = await runCleanup({ f, id: worktree.intent.id });
    assert.equal(removed.kind, "rejected", JSON.stringify(removed));
    assert.equal(removals, 0); assert.equal(closes, 0);
    const state = await f.legion.state();
    assert.equal(state.snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.state.kind, "retained");
    assert.deepEqual(state.snapshot?.cleanups.find(record => record.intent.id === worktree.intent.id), worktree);
    assert.equal(state.snapshot?.results.length, 1); assert.equal(state.snapshot?.integrations[0]?.state.kind, "confirmed");
    assert.ok(state.tasks[0]?.claim.kind === "owned");
    assert.equal(state.tasks[0].claim.workspace.kind, "ready", "Disabled removal never fabricates a tombstone");
  } finally { await f.command("off"); }
});
function tabObservation({ intent, ...overrides }: { intent: import("../src/cleanup-domain.js").TabCleanupIntent } & Partial<import("../src/cleanup-domain.js").TabCleanupObservation>): import("../src/cleanup-domain.js").TabCleanupObservation {
  return { kind: "tab", operation: intent.id, targetDigest: cleanupTargetDigest({ intent }), ownership: "exact", occupants: "owned-only", activity: "idle", worker: "settled", children: "settled", effects: "settled", needs: { continuation: "clear", handoffReader: "clear", reviewer: "clear" }, evidence: ["fresh-exact-native-observation"], ...overrides };
}
function worktreeObservation({ intent, ...overrides }: { intent: import("../src/cleanup-domain.js").WorktreeCleanupIntent } & Partial<import("../src/cleanup-domain.js").WorktreeCleanupObservation>): import("../src/cleanup-domain.js").WorktreeCleanupObservation {
  return { kind: "worktree", operation: intent.id, targetDigest: cleanupTargetDigest({ intent }), ownership: "exact", integration: "integrated", cleanliness: "clean", usage: "unused", needs: { continuation: "clear", handoffReader: "clear", reviewer: "clear" }, evidence: ["fresh-exact-git-and-native-usage"], ...overrides };
}
function confirmed({ intent }: { intent: import("../src/cleanup-domain.js").CleanupIntent }) {
  return { kind: "confirmed", resource: intent.target.kind, operation: intent.id, result: intent.result, targetDigest: cleanupTargetDigest({ intent }), evidence: ["exact-operation-postcondition-receipt"] } satisfies import("../src/cleanup-domain.js").CleanupOutcome;
}

async function cleanupControl({ f, action }: { f: Awaited<ReturnType<typeof fixture>>; action: { kind: "prepare" | "reconcile"; id: string } }) {
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  return f.legion.submit({ kind: "cleanup-control", action, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "cleanup-stage" } });
}

test("every historical worktree state rejects direct execution and preparation without invoking adapters or rewriting history", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const record = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "worktree"); assert.ok(record);
    f.options.cleanup = { tabs: () => null, worktrees: () => { throw new Error("No historical worktree adapter may be invoked"); } };
    const binding = { resource: "worktree", operation: record.intent.id, result: record.intent.result, targetDigest: cleanupTargetDigest({ intent: record.intent }), evidence: ["preserved historical evidence"] };
    for (const state of [
      { kind: "pending" }, { kind: "dispatched" },
      { ...binding, kind: "retained", noEffect: true, reason: "usage", message: "Historical use unknown" },
      { ...binding, kind: "failed", noEffect: true, message: "Historical no-effect failure" },
      { ...binding, kind: "unknown", message: "Historical receipt lost" },
      { ...binding, kind: "confirmed" },
    ]) {
      await seedCleanupState({ f, id: record.intent.id, state: CleanupRecord.parse({ ...record, state }).state });
      const before = (await f.legion.state()).snapshot;
      assert.equal((await f.legion.command({ cleanupRequest: record.intent.id })).kind, "rejected");
      assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: record.intent.id } })).kind, "rejected");
      assert.equal((await cleanupControl({ f, action: { kind: "reconcile", id: record.intent.id } })).kind, "cleanup-stage");
      assert.deepEqual((await f.legion.state()).snapshot, before, "No state/controller/history migration, completion or replay");
      if (state.kind === "dispatched" || state.kind === "unknown" || state.kind === "confirmed")
        assert.equal((await f.legion.state()).tasks[0]?.retainedWorktree, null, "Uncertain outcomes and old tombstones never assert path existence");
    }
  } finally { await f.command("off"); }
});

test("permission-delay final guard re-observes actual tab activity and prevents a late close", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const tab = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(tab);
    let active = false, effects = 0, observations = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => { observations++; return tabObservation({ intent, activity: active ? "active" : "idle" }); },
      close: async ({ intent, finalGuard }) => {
        active = true; // Activity arrives during the ordinary permission wait.
        await finalGuard();
        effects++;
        return { ...confirmed({ intent }), resource: "tab" };
      },
      reconcile: async () => { throw new Error("No action was applied"); },
    }) };
    assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } })).kind, "cleanup-stage");
    assert.equal(observations, 1, "Prepare freshly observes resources but grants no effect");
    const result = await runCleanup({ f, id: tab.intent.id });
    assert.equal(result.kind, "cleanup-stage", JSON.stringify(result));
    assert.equal(effects, 0); assert.equal(observations, 3);
    const state = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.state;
    assert.equal(state?.kind, "retained");
    if (state?.kind === "retained") assert.equal(state.reason, "activity");
  } finally { await f.command("off"); }
});

test("lost cleanup receipt is never repeated; retained-controller observation reconciles only the same resource", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const operation = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "worktree"); assert.ok(operation);
    let removals = 0, observations = 0;
    f.options.cleanup = { tabs: () => null, worktrees: () => ({
      observe: async ({ intent }) => worktreeObservation({ intent }),
      remove: async ({ finalGuard }) => { await finalGuard(); removals++; throw new Error("Receipt lost after actual removal"); },
      reconcile: async ({ intent }) => { observations++; return { ...confirmed({ intent }), resource: "worktree" }; },
    }) };
    const historical = { kind: "unknown", resource: "worktree", operation: operation.intent.id, result: operation.intent.result, targetDigest: cleanupTargetDigest({ intent: operation.intent }), evidence: ["historical-unknown"], message: "Receipt lost after historical removal" } satisfies CleanupRecord["state"];
    await seedCleanupState({ f, id: operation.intent.id, state: historical });
    const legacy = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.id === operation.intent.id);
    await runCleanup({ f, id: operation.intent.id });
    let state = await f.legion.state();
    assert.equal(state.snapshot?.cleanups.find(record => record.intent.id === operation.intent.id)?.state.kind, "unknown");
    assert.ok(state.tasks[0]?.claim.kind === "owned");
    assert.notEqual(state.tasks[0].claim.workspace.kind, "removed", "Unknown receipt is not a tombstone");
    assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: operation.intent.id } })).kind, "rejected");
    await runCleanup({ f, id: operation.intent.id });
    assert.equal(removals, 0); assert.equal(observations, 0);
    const snapshot = state.snapshot; assert.ok(snapshot);
    await f.command("off");
    assert.equal((await f.legion.observeCleanup({ run: snapshot.id, operation: operation.intent.id, session: "foreign" })).kind, "rejected");
    assert.equal(observations, 0);
    const reconciled = await f.legion.observeCleanup({ run: snapshot.id, operation: operation.intent.id, session: "controller" });
    assert.equal(reconciled.kind, "cleanup-stage", JSON.stringify(reconciled));
    state = await f.legion.state();
    const record = state.snapshot?.cleanups.find(record => record.intent.id === operation.intent.id); assert.ok(record);
    assert.deepEqual(record, legacy, "Explicit observation cannot promote or rewrite historical unknown removal");
    assert.deepEqual(record.history.map(outcome => outcome.kind), ["unknown"]);
    assert.equal(removals, 0); assert.equal(observations, 0);
    assert.equal(state.snapshot?.results[0]?.reviews.length, 1);
    assert.ok(state.tasks[0]?.claim.kind === "owned"); assert.equal(state.tasks[0].claim.workspace.kind, "ready");
    assert.equal((await runCleanup({ f, id: operation.intent.id })).kind, "rejected", "Observation never revives effect authority after off");
  } finally { await f.command("off"); }
});

test("confirmed closed tab and removed workspace resume as retained history, never as missing ready resources", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    let effects = 0;
    f.options.cleanup = {
      tabs: () => ({ observe: async ({ intent }) => tabObservation({ intent }), close: async ({ intent, finalGuard }) => { await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "tab" }; }, reconcile: async () => { throw new Error("Already confirmed"); } }),
      worktrees: () => ({ observe: async ({ intent }) => worktreeObservation({ intent }), remove: async ({ intent, finalGuard }) => { await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "worktree" }; }, reconcile: async () => { throw new Error("Already confirmed"); } }),
    };
    const records = (await f.legion.state()).snapshot?.cleanups; assert.ok(records);
    const tree = records.find(record => record.intent.target.kind === "worktree"); assert.ok(tree);
    await seedCleanupState({ f, id: tree.intent.id, state: { ...confirmed({ intent: tree.intent }), resource: "worktree" } });
    for (const record of [...records].reverse()) await runCleanup({ f, id: record.intent.id });
    assert.equal(effects, 1, "Tab cleanup remains independent of a historical confirmed removal");
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    await f.command("off");
    assert.equal((await f.legion.state()).mode, "inactive", "Closed settled actors need no stop message to a nonexistent tab");
    f.options.resume = { repository: () => { throw new Error("Removed checkout must not be inspected as ready"); }, worker: () => { throw new Error("Closed worker must not be contacted"); } };
    const resumed = await f.command(`resume ${saved.id}`);
    assert.equal(resumed.kind, "applied", JSON.stringify(resumed));
    const state = await f.legion.state();
    assert.equal(state.tasks[0]?.resultStatus.kind, "accepted");
    assert.ok(state.tasks[0]?.claim.kind === "owned"); assert.equal(state.tasks[0].claim.workspace.kind, "removed");
    assert.deepEqual(state.snapshot?.cleanups, saved.cleanups);
    assert.equal((await f.command(`launch ${f.task.id}@1`)).kind, "rejected");
    assert.equal(effects, 1);
  } finally { await f.command("off"); }
});

test("cleanup eligibility retains unknown ownership, human or foreign use, unsettled children/effects and independent resource needs", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const records = (await f.legion.state()).snapshot?.cleanups; assert.ok(records);
    const tab = records.find(record => record.intent.target.kind === "tab"), worktree = records.find(record => record.intent.target.kind === "worktree"); assert.ok(tab && worktree);
    let tabFacts: Partial<import("../src/cleanup-domain.js").TabCleanupObservation> = {}, treeFacts: Partial<import("../src/cleanup-domain.js").WorktreeCleanupObservation> = {}, effects = 0;
    f.options.cleanup = {
      tabs: () => ({ observe: async ({ intent }) => tabObservation({ intent, ...tabFacts }), close: async () => { effects++; throw new Error("Ineligible tab must remain"); }, reconcile: async () => { throw new Error("No dispatch"); } }),
      worktrees: () => ({ observe: async ({ intent }) => worktreeObservation({ intent, ...treeFacts }), remove: async () => { effects++; throw new Error("Ineligible worktree must remain"); }, reconcile: async () => { throw new Error("No dispatch"); } }),
    };
    const tabCases: Array<{ facts: typeof tabFacts; reason: string }> = [
      { facts: { ownership: "changed" }, reason: "ownership" }, { facts: { ownership: "unknown" }, reason: "ownership" },
      { facts: { occupants: "foreign" }, reason: "occupants" }, { facts: { occupants: "ambiguous" }, reason: "occupants" },
      { facts: { activity: "active" }, reason: "activity" }, { facts: { activity: "unknown" }, reason: "activity" },
      { facts: { worker: "unknown" }, reason: "worker" }, { facts: { children: "active" }, reason: "children" }, { facts: { effects: "unknown" }, reason: "effects" },
      { facts: { needs: { continuation: "unknown", handoffReader: "clear", reviewer: "clear" } }, reason: "continuation" },
      { facts: { needs: { continuation: "clear", handoffReader: "needed", reviewer: "clear" } }, reason: "handoffReader" },
      { facts: { needs: { continuation: "clear", handoffReader: "clear", reviewer: "needed" } }, reason: "reviewer" },
      { facts: { targetDigest: "0".repeat(64) }, reason: "identity-mismatch" },
      { facts: { occupants: "human" }, reason: "known-human-use" },
    ];
    for (const { facts, reason } of tabCases) {
      tabFacts = facts;
      const outcome = await runCleanup({ f, id: tab.intent.id });
      assert.equal(outcome.kind, "cleanup-stage", JSON.stringify(outcome));
      if (outcome.kind !== "cleanup-stage" || outcome.cleanup.state.kind !== "retained") assert.fail("Expected retained tab");
      assert.equal(outcome.cleanup.state.reason, reason);
    }
    const treeCases: Array<{ facts: typeof treeFacts; reason: string }> = [
      { facts: { ownership: "unknown" }, reason: "ownership" }, { facts: { cleanliness: "dirty" }, reason: "cleanliness" }, { facts: { cleanliness: "unknown" }, reason: "cleanliness" },
      { facts: { integration: "not-integrated" }, reason: "integration" }, { facts: { integration: "unknown" }, reason: "integration" },
      { facts: { usage: "in-use" }, reason: "usage" }, { facts: { usage: "unknown" }, reason: "usage" },
      { facts: { needs: { continuation: "clear", handoffReader: "unknown", reviewer: "clear" } }, reason: "handoffReader" },
      { facts: { needs: { continuation: "clear", handoffReader: "clear", reviewer: "needed" } }, reason: "reviewer" },
    ];
    for (const { facts, reason } of treeCases) {
      treeFacts = facts;
      const outcome = await runCleanup({ f, id: worktree.intent.id });
      assert.equal(outcome.kind, "rejected", `Legacy worktree ${reason} never invokes an observer or effect`);
      assert.deepEqual((await f.legion.state()).snapshot?.cleanups.find(record => record.intent.id === worktree.intent.id), worktree);
    }
    assert.equal(effects, 0);
    assert.equal((await f.legion.state()).snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.history.length, 14);
  } finally { await f.command("off"); }
});

test("off during an ordinary permission wait revokes the final authority guard without closing the tab", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const tab = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(tab);
    let effects = 0, stopping: Promise<unknown> | undefined;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent }),
      close: async ({ intent, finalGuard }) => { stopping = f.command("off"); await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "tab" }; },
      reconcile: async () => { throw new Error("No conclusive receipt"); },
    }) };
    const result = await runCleanup({ f, id: tab.intent.id });
    await stopping;
    assert.equal(effects, 0);
    assert.ok(result.kind === "uncertain" || result.kind === "cleanup-stage", JSON.stringify(result));
    const state = await f.legion.state();
    assert.equal(state.mode, "stopping");
    assert.notEqual(state.snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.state.kind, "confirmed");
    assert.equal((await runCleanup({ f, id: tab.intent.id })).kind, "rejected");
  } finally { await f.command("off"); }
});

test("a newly accepted result cannot bypass an older uncertain cleanup of the same native tab", async () => {
  const f = await fixture();
  try {
    const first = await accept({ f });
    const old = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(old);
    let effects = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent }),
      close: async ({ finalGuard }) => { await finalGuard(); effects++; throw new Error("Lost exact tab close receipt"); },
      reconcile: async () => { throw new Error("Still ambiguous"); },
    }) };
    await runCleanup({ f, id: old.intent.id });
    assert.equal(effects, 1);
    const adapter = readOnlyAdapter({ commit: "d".repeat(40), tree: "e".repeat(40) });
    adapter.integrate = async ({ intent, assertAuthority }) => {
      await assertAuthority();
      return { kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: intent.identity.commit, tree: intent.identity.tree }, parent: { ref: intent.identity.parent.ref, before: intent.identity.parent.commit, after: intent.identity.commit, tree: intent.identity.tree }, evidence: ["new-exact-integration"] };
    };
    f.options.results = { repository: () => adapter };
    const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] }); assert.ok(captured.kind === "result-stage");
    const result = { id: captured.result.id, digest: captured.result.digest }; assert.notEqual(result.id, first.result.id);
    const verified = await f.control({ kind: "verify", result, verification: passingVerification }); assert.ok(verified.kind === "result-stage");
    const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
    await f.control({ kind: "review", result, id: randomUUID(), verificationDigest, reviewer: { session: "new-reviewer", run: "new-fresh-review" }, reference: "new-review.md", outcome: "approved", evidence: ["new-independent-review"] });
    const id = randomUUID(); await f.control({ kind: "prepare-integration", result, id }); await f.legion.command({ integrationRequest: id });
    const newer = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab" && record.intent.result.id === result.id); assert.ok(newer);
    const outcome = await runCleanup({ f, id: newer.intent.id });
    assert.equal(outcome.kind, "rejected", JSON.stringify(outcome));
    assert.equal(effects, 1, "New result identity cannot blind-repeat an uncertain native close");
  } finally { await f.command("off"); }
});

test("read-only exact integration reconciliation queues cleanup but performs no cleanup effect", async () => {
  const f = await fixture();
  try {
    const result = await ready(f), id = randomUUID(), adapter = readOnlyAdapter();
    adapter.integrate = async ({ assertAuthority }) => { await assertAuthority(); throw new Error("Applied integration receipt lost"); };
    adapter.reconcile = async ({ intent }) => ({ kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: sourceCommit, tree: sourceTree }, parent: { ref: "refs/heads/task-parent", before: parentCommit, after: sourceCommit, tree: sourceTree }, evidence: ["read-only-exact-integration"] });
    f.options.results = { repository: () => adapter };
    await f.control({ kind: "prepare-integration", result, id }); await f.legion.command({ integrationRequest: id });
    assert.deepEqual((await f.legion.state()).snapshot?.cleanups, []);
    assert.equal((await f.control({ kind: "reconcile-integration", id })).kind, "integration-stage");
    const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
    assert.equal(snapshot.cleanups.length, 1); assert.equal(snapshot.cleanups[0]?.intent.target.kind, "tab"); assert.ok(snapshot.cleanups.every(record => record.state.kind === "pending"));
    assert.deepEqual((await new Legion(f.options).state()).snapshot?.cleanups, snapshot.cleanups);
  } finally { await f.command("off"); }
});

test("an open Emperor decision retains both accepted-resource intents before resource observation", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    let observations = 0;
    f.options.cleanup = {
      tabs: () => ({ observe: async () => { observations++; throw new Error("Decision must hold first"); }, close: async () => { throw new Error("No authority"); }, reconcile: async () => { throw new Error("No dispatch"); } }),
      worktrees: () => ({ observe: async () => { observations++; throw new Error("Decision must hold first"); }, remove: async () => { throw new Error("No authority"); }, reconcile: async () => { throw new Error("No dispatch"); } }),
    };
    await f.command(`correction ${f.task.id}@1 Require an additional acceptance check`);
    const original = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(original);
    await f.interpret({ kind: "propose-amendment", source: { id: original.id, revision: original.revision }, affected: [f.task], category: "acceptance", change: "Additional behavior", question: "Approve new acceptance?", recommendation: "Ask Emperor" });
    const state = await f.legion.state(); assert.equal(state.tasks[0]?.resultStatus.kind, "held");
    for (const record of state.snapshot?.cleanups ?? []) {
      assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: record.intent.id } })).kind, "rejected");
      const outcome = await runCleanup({ f, id: record.intent.id });
      assert.equal(outcome.kind, "rejected", JSON.stringify(outcome));
    }
    assert.equal(observations, 0);
  } finally { await f.command("off"); }
});

test("failed cleanup outcome publication keeps its dispatched write-ahead marker for read-only settlement", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const tab = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(tab);
    let effects = 0, armed = true;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent }),
      close: async ({ intent, finalGuard }) => {
        await finalGuard(); effects++;
        f.setStorageFault(point => { if (armed && point === "before-commit") { armed = false; throw new Error("Outcome save unavailable"); } });
        return { ...confirmed({ intent }), resource: "tab" };
      },
      reconcile: async ({ intent }) => ({ ...confirmed({ intent }), resource: "tab" }),
    }) };
    assert.equal((await runCleanup({ f, id: tab.intent.id })).kind, "uncertain");
    const unknown = await f.legion.state();
    assert.equal(unknown.snapshot?.cleanups.find(record => record.intent.id === tab.intent.id)?.state.kind, "dispatched");
    assert.ok(unknown.tasks[0]?.claim.kind === "owned"); assert.notEqual(unknown.tasks[0].claim.workspace.kind, "removed");
    await runCleanup({ f, id: tab.intent.id }); assert.equal(effects, 1);
    const observed = await cleanupControl({ f, action: { kind: "reconcile", id: tab.intent.id } });
    assert.ok(observed.kind === "cleanup-stage"); assert.equal(observed.cleanup.state.kind, "confirmed"); assert.equal(effects, 1);
  } finally { f.setStorageFault(undefined); await f.command("off"); }
});

async function runCleanup({ f, id }: { f: Awaited<ReturnType<typeof fixture>>; id: string }) {
  const snapshot = (await f.legion.state()).snapshot, record = snapshot?.cleanups.find(record => record.intent.id === id);
  const controller = record?.controllers.at(-1);
  if (record && (record.state.kind === "retained" || record.state.kind === "pending" && controller?.generation !== snapshot?.generation)) {
    const prepared = await cleanupControl({ f, action: { kind: "prepare", id } });
    if (prepared.kind !== "cleanup-stage" || prepared.cleanup.state.kind === "retained") return prepared;
  }
  return f.legion.command({ cleanupRequest: id });
}

for (const prior of ["never-dispatched", "unknown"]) test(`explicit reconciled resume prepares ${prior} cleanup only when no effect is unresolved`, async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    const tab = saved.cleanups.find(record => record.intent.target.kind === "tab"), origin = saved.launchRequests[0]; assert.ok(tab && origin);
    let effects = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent }),
      close: async ({ intent, finalGuard }) => { await finalGuard(); effects++; if (prior === "unknown") throw new Error("Unacknowledged close"); return { ...confirmed({ intent }), resource: "tab" }; },
      reconcile: async () => { throw new Error("No conclusive outcome"); },
    }) };
    assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } })).kind, "cleanup-stage");
    if (prior === "unknown") await f.legion.command({ cleanupRequest: tab.intent.id });
    let retirement: z.infer<typeof import("../src/tribunus.js").WorkerStop> | null = null;
    const host = f.options.tribuni?.host(); assert.ok(host);
    host.stop = async ({ worker, shutdown, command }, observe) => {
      retirement = { authority: { owner: saved.id, session: "controller", generation: origin.generation, epoch: origin.epoch }, address: worker.address, shutdown, command, state: { kind: "parked", evidence: ["native-retirement-settled"] } };
      await observe(retirement);
    };
    f.options.resume = { repository: () => f.git, worker: () => ({
      observeResources: async ({ launch }): Promise<import("../src/resume.js").WorkerResourceObservation> => {
        assert.ok(launch.state.kind === "reported");
        const { worker, command, report, application } = launch.state;
        return { launch: launch.id, reservation: launch.reservation, scope: launch.scope, disposition: "settled", reasons: [], recommendation: "Preserve old assignment; current native observations only", evidence: ["read-only-native-session-settlement"],
          process: { kind: "alive", identity: { pid: process.pid, boot: "fixture-boot", start: "1" } },
          live: { kind: "observed", value: { nonce: randomUUID(), address: worker.address, controller: { owner: saved.id, session: "controller", generation: origin.generation, epoch: origin.epoch }, command, principal: "settled", busy: false, pendingMessages: false, admissionHold: null, childrenOutstanding: false, childrenHeld: false, effectsOutstanding: false, retirement } },
          retirement, report: { address: worker.address, command, ...report }, actions: [{ kind: "assign", command, receipt: { application } }], effects: [], children: [] };
      },
    }) };
    await f.command("off");
    if (prior === "unknown") {
      assert.equal((await f.command(`resume ${saved.id}`)).kind, "rejected", "Unresolved cleanup cannot be bypassed by resume");
      assert.equal((await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } })).kind, "rejected");
      await f.legion.command({ cleanupRequest: tab.intent.id }); assert.equal(effects, 1, "Resume cannot blind-repeat uncertain effect");
    } else {
      for (let i = 0; i < 200 && (await f.legion.state()).mode !== "inactive"; i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal((await f.legion.state()).mode, "inactive");
      const resumed = await f.command(`resume ${saved.id}`); assert.equal(resumed.kind, "applied", JSON.stringify(resumed));
      const current = (await f.legion.state()).snapshot; assert.ok(current && current.generation > saved.generation);
      const prepare = await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } });
      assert.ok(prepare.kind === "cleanup-stage", JSON.stringify(prepare));
      assert.deepEqual(prepare.cleanup.controllers.map(controller => controller.generation), [saved.generation, current.generation]);
      await f.legion.command({ cleanupRequest: tab.intent.id }); assert.equal(effects, 1, "Fresh prepared cleanup has independent current authority");
    }
  } finally { await f.command("off"); }
});

test("known human use remains retained after its positive source disappears", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const tab = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(tab);
    let human = true, effects = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent, occupants: human ? "human" : "owned-only", ownership: human ? "unknown" : "exact", evidence: human ? ["exact-trusted-human-use"] : ["positive-human-source-no-longer-present"] }),
      close: async ({ intent, finalGuard }) => { await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "tab" }; },
      reconcile: async () => { throw new Error("Never dispatched"); },
    }) };
    const initial = await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } });
    assert.ok(initial.kind === "cleanup-stage" && initial.cleanup.state.kind === "retained", JSON.stringify(initial));
    assert.equal(initial.cleanup.state.reason, "known-human-use", "Positive exact human evidence precedes the ownership gate");
    const saved = (await f.legion.state()).snapshot;
    assert.deepEqual((await new Legion(f.options).state()).snapshot, saved, "Human-use retention is durable, not an in-memory observation");
    human = false;
    const later = await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } });
    assert.ok(later.kind === "cleanup-stage" && later.cleanup.state.kind === "retained", JSON.stringify(later));
    assert.equal(later.cleanup.state.reason, "known-human-use");
    assert.deepEqual(later.cleanup.state.evidence, ["exact-trusted-human-use"]);
    await f.legion.command({ cleanupRequest: tab.intent.id });
    assert.equal(effects, 0, "A consumed positive source cannot authorize closing a known human-used tab");
  } finally { await f.command("off"); }
});

test("a newly accepted result cannot release known human use of the same native tab and session", async () => {
  const f = await fixture();
  try {
    const first = await accept({ f });
    const old = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(old);
    let human = true, effects = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent, occupants: human ? "human" : "owned-only", ownership: human ? "unknown" : "exact", evidence: human ? ["trusted-human-use-before-new-result"] : ["no-current-positive-human-signal"] }),
      close: async ({ intent, finalGuard }) => { await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "tab" }; },
      reconcile: async () => { throw new Error("Never dispatched"); },
    }) };
    const held = await cleanupControl({ f, action: { kind: "prepare", id: old.intent.id } });
    assert.ok(held.kind === "cleanup-stage" && held.cleanup.state.kind === "retained");
    assert.equal(held.cleanup.state.reason, "known-human-use");
    human = false;
    const adapter = readOnlyAdapter({ commit: "d".repeat(40), tree: "e".repeat(40) });
    adapter.integrate = async ({ intent, assertAuthority }) => {
      await assertAuthority();
      return { kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: intent.identity.commit, tree: intent.identity.tree }, parent: { ref: intent.identity.parent.ref, before: intent.identity.parent.commit, after: intent.identity.commit, tree: intent.identity.tree }, evidence: ["new-exact-integration"] };
    };
    f.options.results = { repository: () => adapter };
    const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] }); assert.ok(captured.kind === "result-stage");
    const result = { id: captured.result.id, digest: captured.result.digest }; assert.notEqual(result.id, first.result.id);
    const verified = await f.control({ kind: "verify", result, verification: passingVerification }); assert.ok(verified.kind === "result-stage");
    const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
    await f.control({ kind: "review", result, id: randomUUID(), verificationDigest, reviewer: { session: "new-reviewer", run: "new-fresh-review" }, reference: "new-review.md", outcome: "approved", evidence: ["new-independent-review"] });
    const id = randomUUID(); await f.control({ kind: "prepare-integration", result, id }); await f.legion.command({ integrationRequest: id });
    const current = await f.legion.state(); assert.equal(current.tasks[0]?.resultStatus.kind, "accepted");
    const newer = current.snapshot?.cleanups.find(record => record.intent.target.kind === "tab" && record.intent.result.id === result.id); assert.ok(newer);
    const outcome = await runCleanup({ f, id: newer.intent.id });
    assert.ok(outcome.kind === "cleanup-stage" && outcome.cleanup.state.kind === "retained", JSON.stringify(outcome));
    assert.equal(outcome.cleanup.state.reason, "known-human-use");
    assert.deepEqual(outcome.cleanup.state.evidence, ["trusted-human-use-before-new-result"]);
    assert.equal(effects, 0);
  } finally { await f.command("off"); }
});

test("unknown or foreign occupants and mismatched human observations do not establish known human use", async () => {
  const f = await fixture();
  try {
    await accept({ f });
    const tab = (await f.legion.state()).snapshot?.cleanups.find(record => record.intent.target.kind === "tab"); assert.ok(tab);
    let facts: Partial<import("../src/cleanup-domain.js").TabCleanupObservation> = {}, effects = 0;
    f.options.cleanup = { worktrees: () => null, tabs: () => ({
      observe: async ({ intent }) => tabObservation({ intent, ...facts }),
      close: async ({ intent, finalGuard }) => { await finalGuard(); effects++; return { ...confirmed({ intent }), resource: "tab" }; },
      reconcile: async () => { throw new Error("No uncertain receipt"); },
    }) };
    for (const item of [
      { facts: { ownership: "unknown", occupants: "ambiguous" }, reason: "ownership" },
      { facts: { occupants: "foreign" }, reason: "occupants" },
      { facts: { occupants: "human", operation: randomUUID() }, reason: "identity-mismatch" },
      { facts: { occupants: "human", targetDigest: "0".repeat(64) }, reason: "identity-mismatch" },
    ] satisfies Array<{ facts: typeof facts; reason: string }>) {
      facts = item.facts;
      const held = await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } });
      assert.ok(held.kind === "cleanup-stage" && held.cleanup.state.kind === "retained", JSON.stringify(held));
      assert.equal(held.cleanup.state.reason, item.reason);
    }
    facts = {};
    const prepared = await cleanupControl({ f, action: { kind: "prepare", id: tab.intent.id } });
    assert.ok(prepared.kind === "cleanup-stage"); assert.equal(prepared.cleanup.state.kind, "pending");
    await f.legion.command({ cleanupRequest: tab.intent.id }); assert.equal(effects, 1, "No positive exact human evidence was recorded");
  } finally { await f.command("off"); }
});
