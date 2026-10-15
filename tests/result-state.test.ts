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
  return { legion, options, command, control, interpret, task: { id: task.id, revision: 1 }, launch, root, setStorageFault: (fault: LegionOptions["storageFault"]) => { storageFault = fault; } };
}

function readOnlyAdapter(commit = sourceCommit, tree = sourceTree): ResultRepository {
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

test("reported work is not accepted; only an observed clean committed candidate is captured durably", async () => {
  const f = await fixture();
  const before = (await f.legion.state()).tasks[0];
  assert.equal(before?.launch.kind, "reported");
  assert.equal(before?.resultStatus.kind, "not-captured");
  assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] })).kind, "rejected", "no default fake integration adapter");
  f.options.results = { repository: () => readOnlyAdapter() };
  const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] });
  assert.equal(captured.kind, "result-stage", JSON.stringify(captured));
  const view = await f.legion.state();
  assert.equal(view.tasks[0]?.resultStatus.kind, "verification-required");
  assert.equal(view.snapshot?.results[0]?.identity.commit, sourceCommit);
  assert.equal(view.snapshot?.results[0]?.identity.assignment.assignment, f.launch.command);
  assert.equal(view.snapshot?.results[0]?.identity.parent.ref, "refs/heads/task-parent");
  const reopened = new Legion(f.options);
  assert.deepEqual((await reopened.state()).snapshot?.results, view.snapshot?.results);
  await f.command("off");
});

test("every criterion/check and material exception binds the exact result; only current independent review makes it integration-ready", async () => {
  const f = await fixture(), result = await capture(f);
  const verify = (verification: unknown, ref = result) => f.control({ kind: "verify", result: ref, verification });
  assert.equal((await verify({ ...passingVerification, criteria: [] })).kind, "result-stage");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "verification-required");
  assert.equal((await verify({ ...passingVerification, checks: [{ name: "focused tests", outcome: "failed", evidence: ["test-exit-1"] }] })).kind, "result-stage");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "verification-required");
  assert.equal((await verify({ ...passingVerification, exceptions: [{ description: "Material gap", resolution: { kind: "open" } }] })).kind, "result-stage");
  assert.equal((await f.legion.state()).snapshot?.results[0]?.verifications.at(-1)?.verification.exceptions[0]?.description, "Material gap");
  const verified = await verify(passingVerification); assert.equal(verified.kind, "result-stage", JSON.stringify(verified));
  if (verified.kind !== "result-stage") assert.fail("verification required");
  const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "review-required");
  const review = (session: string, ref = result, digest = verificationDigest) => f.control({ kind: "review", result: ref, id: randomUUID(), verificationDigest: digest, reviewer: { session, run: "independent-review-run" }, reference: "skill-review.md", outcome: "approved", evidence: ["fresh-context-review"] });
  assert.equal((await review("executor")).kind, "rejected");
  assert.equal((await review("controller")).kind, "rejected");
  assert.equal((await review("independent-reviewer", result, "0".repeat(64))).kind, "rejected");
  assert.equal((await review("independent-reviewer", { ...result, digest: "0".repeat(64) })).kind, "rejected");
  assert.equal((await review("independent-reviewer")).kind, "result-stage");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "ready");
  assert.equal((await verify(passingVerification)).kind, "result-stage");
  const reused = await capture(f); assert.deepEqual(reused, result);
  assert.equal((await f.legion.state()).snapshot?.results[0]?.reviews.length, 1, "unchanged verification and candidate reuse valid review");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "ready");
  await verify({ ...passingVerification, exceptions: [{ description: "Resolved limitation", resolution: { kind: "resolved", summary: "Relevant check performed", evidence: ["new-check"] } }] });
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "review-required", "material evidence changes invalidate prior review");
  f.options.results = { repository: () => readOnlyAdapter("d".repeat(40), "e".repeat(40)) };
  assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] })).kind, "result-stage");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "verification-required", "changed Git result must be checked and reviewed afresh");
  assert.equal((await review("independent-reviewer")).kind, "rejected", "stale result cannot receive current review");
  await f.command("off");
});

async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await capture(f);
  const verified = await f.control({ kind: "verify", result, verification: passingVerification });
  assert.ok(verified.kind === "result-stage", JSON.stringify(verified));
  const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
  assert.equal((await f.control({ kind: "review", result, id: randomUUID(), verificationDigest, reviewer: { session: "reviewer", run: "review-run" }, reference: "review-skill-evidence.md", outcome: "approved", evidence: ["review-passed"] })).kind, "result-stage");
  return result;
}

test("integration is a separate write-ahead guarded stage; acceptance requires verified exact intended-parent outcome", async () => {
  const f = await fixture(), result = await ready(f), operation = randomUUID();
  const adapter = readOnlyAdapter();
  let effects = 0;
  adapter.integrate = async ({ intent, assertAuthority }) => {
    await assertAuthority();
    const visible = (await f.legion.state()).snapshot?.integrations.find(record => record.intent.id === intent.id);
    assert.equal(visible?.state.kind, "dispatched", "durable intent precedes effects");
    assert.equal((await new Legion(f.options).state()).snapshot?.integrations[0]?.state.kind, "dispatched", "a reopened observer sees the write-ahead marker");
    effects++;
    return { kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: sourceCommit, tree: sourceTree }, parent: { ref: "refs/heads/task-parent", before: parentCommit, after: sourceCommit, tree: sourceTree }, evidence: ["verified-parent-ref-and-tree"] };
  };
  f.options.results = { repository: () => adapter };
  const prepared = await f.control({ kind: "prepare-integration", result, id: operation });
  assert.equal(prepared.kind, "integration-stage", JSON.stringify(prepared));
  assert.equal(effects, 0, "review/preparation is not Git permission or an effect");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integration-pending");
  const integrated = await f.legion.command({ integrationRequest: operation });
  assert.equal(integrated.kind, "integration-stage", JSON.stringify(integrated));
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
  assert.equal(effects, 1);
  await f.legion.command({ integrationRequest: operation });
  assert.equal(effects, 1, "a terminal operation is never replayed");
  assert.equal((await new Legion(f.options).state()).tasks[0]?.resultStatus.kind, "accepted", "confirmed result persists without activating a new owner");
  await f.command("off");
});

test("applied-but-unacknowledged integration remains unaccepted and can only reconcile read-only without replay", async () => {
  const f = await fixture(), result = await ready(f), id = randomUUID();
  const adapter = readOnlyAdapter(); let effects = 0, observations = 0;
  adapter.integrate = async ({ assertAuthority }) => { await assertAuthority(); effects++; throw new Error("acknowledgment lost after Git effect"); };
  adapter.reconcile = async ({ intent }) => {
    observations++;
    return { kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: sourceCommit, tree: sourceTree }, parent: { ref: "refs/heads/task-parent", before: parentCommit, after: sourceCommit, tree: sourceTree }, evidence: ["read-only-exact-ref-tree-and-ancestry"] };
  };
  f.options.results = { repository: () => adapter };
  assert.equal((await f.control({ kind: "prepare-integration", result, id })).kind, "integration-stage");
  await f.legion.command({ integrationRequest: id });
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integration-unknown");
  const retained = await new Legion(f.options).state();
  assert.equal(retained.snapshot?.integrations[0]?.state.kind, "unknown");
  assert.equal(retained.tasks[0]?.resultStatus.kind, "integration-unknown");
  await f.legion.command({ integrationRequest: id });
  assert.equal(effects, 1, "unknown integration never blindly replays");
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  assert.equal((await f.control({ kind: "verify", result, verification: passingVerification })).kind, "rejected");
  const reconciled = await f.control({ kind: "reconcile-integration", id });
  assert.equal(reconciled.kind, "integration-stage", JSON.stringify(reconciled));
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
  assert.equal(effects, 1); assert.equal(observations, 1);
  await f.command("off");
});

test("review never clears Emperor decisions or #37 changed-scope assignment authority holds", async () => {
  const f = await fixture(), result = await ready(f);
  await f.command(`correction ${f.task.id}@1 Change acceptance`);
  const original = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(original);
  const source = { id: original.id, revision: original.revision };
  await f.interpret({ kind: "propose-amendment", source, affected: [f.task], category: "acceptance", change: "Require amended behavior", question: "Approve amended behavior?", recommendation: "Ask Emperor" });
  const pending = await f.legion.state();
  assert.equal(pending.tasks[0]?.resultStatus.kind, "held", "old independent review cannot imply acceptance while requirements await a decision");
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  const decision = pending.snapshot?.decisions[0], amendment = pending.snapshot?.amendments[0]; assert.ok(decision && amendment);
  await f.legion.submit({ kind: "message", text: "Approve amended behavior", requestKey: "amendment-approval", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: pending.snapshot?.generation, presented: [{ decision: { id: decision.id, revision: 1 }, amendment: amendment.id }] } });
  const answer = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(answer);
  await f.interpret({ kind: "answer", source: { id: answer.id, revision: answer.revision }, decision: { id: decision.id, revision: 1 }, effect: { kind: "approve-amendment", amendment: amendment.id } });
  await f.interpret({ kind: "correction", id: randomUUID(), source, target: { id: f.task.id, revision: 2 }, authorization: { kind: "amendment", amendment: amendment.id } });
  const held = await f.legion.state();
  assert.equal(held.tasks[0]?.resultStatus.kind, "held");
  assert.match(held.tasks[0]?.correctionHold ?? "", /assignment.*authority/i);
  assert.equal(held.tasks[0]?.eligibility, "blocked");
  assert.equal((await f.control({ kind: "verify", result, verification: passingVerification })).kind, "rejected");
  assert.equal((await f.control({ kind: "capture", task: { id: f.task.id, revision: 2 }, requiredChecks: ["focused tests"] })).kind, "rejected");
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  await f.command("off");
});

for (const mismatch of ["operation", "result", "source", "parent", "before", "tree"]) test(`a ${mismatch} integration-proof mismatch remains unknown and never accepted`, async () => {
  const f = await fixture(), result = await ready(f), id = randomUUID();
  const adapter = readOnlyAdapter();
  adapter.integrate = async ({ intent, assertAuthority }) => {
    await assertAuthority();
    return { kind: "confirmed", operation: mismatch === "operation" ? randomUUID() : intent.id,
      result: mismatch === "result" ? { ...intent.result, digest: "0".repeat(64) } : intent.result,
      source: { commit: mismatch === "source" ? "d".repeat(40) : sourceCommit, tree: sourceTree },
      parent: { ref: mismatch === "parent" ? "refs/heads/unrelated" : "refs/heads/task-parent", before: mismatch === "before" ? "d".repeat(40) : parentCommit, after: sourceCommit, tree: mismatch === "tree" ? "e".repeat(40) : sourceTree }, evidence: ["mismatched-proof"] };
  };
  f.options.results = { repository: () => adapter };
  await f.control({ kind: "prepare-integration", result, id }); await f.legion.command({ integrationRequest: id });
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integration-unknown");
  assert.equal((await f.legion.state()).snapshot?.integrations[0]?.state.kind, "unknown");
  await f.command("off");
});

test("failed integration stays unaccepted; competing requests serialize and only an explicit proven-no-effect retry may run", async () => {
  const f = await fixture(), result = await ready(f), id = randomUUID();
  const adapter = readOnlyAdapter(); let effects = 0, active = 0, maximum = 0;
  let release: () => void = () => { throw new Error("No effect waiting"); };
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let enter: () => void = () => { throw new Error("No start observer"); };
  const started = new Promise<void>(resolve => { enter = resolve; });
  adapter.integrate = async ({ intent, assertAuthority }) => {
    await assertAuthority(); effects++; active++; maximum = Math.max(maximum, active); enter();
    await blocked; active--;
    return { kind: "failed", operation: intent.id, result: intent.result, noEffect: true, message: "Guarded Git refused without effect", evidence: ["real-exit-preserved-by-adapter"] };
  };
  f.options.results = { repository: () => adapter };
  await f.control({ kind: "prepare-integration", result, id });
  const first = f.legion.command({ integrationRequest: id }); await started;
  const repeated = f.legion.command({ integrationRequest: id });
  const competing = f.control({ kind: "prepare-integration", result, id: randomUUID() });
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integrating");
  release(); await Promise.all([first, repeated]);
  const next = await competing;
  assert.equal(effects, 1); assert.equal(maximum, 1);
  assert.equal((await f.legion.state()).snapshot?.integrations[0]?.state.kind, "failed");
  assert.equal(next.kind, "integration-stage", JSON.stringify(next));
  if (next.kind !== "integration-stage") assert.fail("explicit no-effect retry intent required");
  await f.legion.command({ integrationRequest: next.integration.intent.id });
  assert.equal(effects, 2); assert.equal(maximum, 1);
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integration-failed");
  assert.equal((await f.legion.state()).snapshot?.integrations.length, 2);
  adapter.observe = readOnlyAdapter("d".repeat(40), "e".repeat(40)).observe;
  await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] });
  const historical = await f.legion.command({ integrationRequest: id });
  assert.ok(historical.kind === "integration-stage");
  assert.equal(historical.status.kind, "held", "historical operation status cannot silently name a newer result");
  assert.equal(historical.status.result.id, result.id);
  await f.command("off");
});

test("dirty/untracked candidates and stale Git observations cannot silently reuse committed-result evidence", async () => {
  const f = await fixture(), result = await ready(f);
  const adapter = readOnlyAdapter();
  adapter.observe = async () => ({ kind: "held", message: "Tracked, index or untracked content is dirty", evidence: ["porcelain-including-untracked"] });
  f.options.results = { repository: () => adapter };
  assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] })).kind, "rejected");
  assert.equal((await f.control({ kind: "verify", result, verification: passingVerification })).kind, "rejected");
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  adapter.observe = async () => ({ kind: "clean", commit: sourceCommit, tree: sourceTree, parentCommit: "d".repeat(40), evidence: ["parent-moved"] });
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  assert.equal((await f.legion.state()).snapshot?.results.length, 1);
  assert.equal((await f.legion.state()).snapshot?.integrations.length, 0);
  await f.command("off");
});

test("a reported assignment with a newly admitted unsettled correction effect cannot be captured or integrated", async () => {
  const f = await fixture(), result = await ready(f);
  const host = f.options.tribuni?.host(); assert.ok(host);
  const receipt = { journal: "worker-journal", entry: "correction-user-entry", evidence: ["fsynced-entry"] };
  host.correct = async ({ request }) => ({ request, state: { kind: "delivered", receipt } });
  host.observeCorrection = async ({ request }) => ({ request, state: { kind: "delivered", receipt } });
  await f.command(`correction ${f.task.id}@1 Correct the implementation detail`);
  const original = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(original);
  await f.interpret({ kind: "correction", id: randomUUID(), source: { id: original.id, revision: original.revision }, target: f.task, authorization: { kind: "technical" } });
  const snapshot = (await f.legion.state()).snapshot, correction = snapshot?.corrections[0]; assert.ok(snapshot && correction?.binding);
  await f.legion.submit({ kind: "correction-control", correction: { id: correction.id, digest: correction.digest }, action: { kind: "deliver" }, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "correction-control" } });
  const effect = await f.legion.submit({ kind: "effect-admission", intent: { id: randomUUID(), pin: correction.binding.pin, correction: { id: correction.id, digest: correction.digest }, call: { id: "technical-fix", name: "write", rawInput: { path: "tracked", content: "corrected" }, input: { path: "tracked", content: "corrected" }, journal: "worker-journal" } } });
  assert.equal(effect.kind, "effect", JSON.stringify(effect));
  assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused tests"] })).kind, "rejected");
  assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).kind, "rejected");
  if (effect.kind !== "effect") assert.fail("admitted effect required");
  await f.legion.submit({ kind: "effect-observation", id: effect.effect.intent.id, digest: effect.effect.digest, state: { kind: "completed", evidence: "native-effect-completed", isError: false } });
  await f.command("off");
});

test("lost outcome publication preserves a dispatched intent for read-only reconciliation, never a second effect", async () => {
  const f = await fixture(), result = await ready(f), id = randomUUID();
  const adapter = readOnlyAdapter(); let effects = 0;
  const confirmed = (intent: Parameters<ResultRepository["reconcile"]>[0]["intent"]) => ({ kind: "confirmed", operation: intent.id, result: intent.result, source: { commit: sourceCommit, tree: sourceTree }, parent: { ref: "refs/heads/task-parent", before: parentCommit, after: sourceCommit, tree: sourceTree }, evidence: ["exact-parent-ref-tree-and-ancestry"] } satisfies Awaited<ReturnType<ResultRepository["integrate"]>>);
  adapter.integrate = async ({ intent, assertAuthority }) => { await assertAuthority(); effects++; return confirmed(intent); };
  adapter.reconcile = async ({ intent }) => confirmed(intent);
  f.options.results = { repository: () => adapter };
  await f.control({ kind: "prepare-integration", result, id });
  let publications = 0;
  f.setStorageFault(point => { if (point === "before-commit" && ++publications === 2) throw new Error("outcome publication lost"); });
  assert.equal((await f.legion.command({ integrationRequest: id })).kind, "uncertain");
  f.setStorageFault(undefined);
  assert.equal((await new Legion(f.options).state()).snapshot?.integrations[0]?.state.kind, "dispatched");
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integrating");
  await f.legion.command({ integrationRequest: id }); assert.equal(effects, 1);
  await f.control({ kind: "reconcile-integration", id });
  assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
  assert.equal(effects, 1);
  await f.command("off");
});

test("owner off revokes the guarded integration callback, preserving unaccepted intent for observation only", async () => {
  const f = await fixture(), result = await ready(f), id = randomUUID();
  const adapter = readOnlyAdapter(); let effects = 0, stopped: ReturnType<typeof f.command> | null = null;
  adapter.integrate = async ({ intent, assertAuthority }) => {
    stopped = f.command("off");
    await assertAuthority();
    effects++;
    return { kind: "failed", operation: intent.id, result: intent.result, noEffect: true, message: "not reached", evidence: ["not-reached"] };
  };
  adapter.reconcile = async ({ intent }) => ({ kind: "failed", operation: intent.id, result: intent.result, noEffect: true, message: "Read-only inspection proves no Git effect", evidence: ["unchanged-parent-no-effect"] });
  f.options.results = { repository: () => adapter };
  await f.control({ kind: "prepare-integration", result, id });
  assert.equal((await f.legion.command({ integrationRequest: id })).kind, "uncertain");
  await stopped;
  assert.equal(effects, 0);
  assert.equal((await f.legion.state()).snapshot?.integrations[0]?.state.kind, "dispatched");
  assert.equal((await f.legion.command({ integrationRequest: id })).kind, "rejected");
  assert.equal((await f.control({ kind: "reconcile-integration", id })).kind, "integration-stage", "retained stopping owner may observe but never replay");
  assert.equal((await f.legion.state()).snapshot?.integrations[0]?.state.kind, "failed");
  assert.equal(effects, 0);
});
