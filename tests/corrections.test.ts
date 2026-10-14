import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { GitWorkspace } from "../src/git-workspace.js";
import { mattInitializationPrompt, type TribunusHost, type CorrectionObservation, type HandoffStageObservation } from "../src/tribunus.js";
import type { LegionOptions } from "../src/intake.js";
import type { WorkerResourceObservation } from "../src/resume.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Legion } from "../src/intake.js";

const exec = promisify(execFile);
async function fixture(withWorker = false) {
  const root = await mkdtemp(join(tmpdir(), "c37-"));
  const checkout = join(root, "repo");
  const workers = new Map<string, Parameters<TribunusHost["assign"]>[0]["worker"]>();
  const deliveries: Parameters<NonNullable<TribunusHost["correct"]>>[0][] = [];
  let observation: z.infer<typeof CorrectionObservation> | null = null;
  let loseReceipt = false;
  let storageFault: LegionOptions["storageFault"];
  const reports = new Map<string, Parameters<NonNullable<TribunusHost["watchReports"]>>[1]>();
  const stops = new Map<string, string>();
  const authority = { owner: "", session: "controller", generation: 1, epoch: 0 };
  let handoff: z.infer<typeof HandoffStageObservation> | null = null;
  const host: TribunusHost = {
    createWindow: async ({ launch, cwd }) => {
      const window = { endpoint: "/controlled/socket", server: "fixture", workspace: "w", tab: launch.id, pane: "p", terminal: "t" };
      workers.set(launch.id, { address: { launch: launch.id, window, session: launch.id, generation: randomUUID() }, resources: { cwd, principal: { model: "openai-codex/gpt-6.1-sol", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review", "implement"].map(name => ({ name, path: `/skills/${name}` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "available" }], children: [] }, identityEvidence: "authenticated-worker" });
      return window;
    },
    startPi: async () => {},
    inspectWorker: async ({ launch }) => workers.get(launch.id) ?? null,
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "mode", settledEntry: "settled" }),
    assign: async () => ({ application: "assigned-user-entry" }),
    watchReports: ({ worker }, onReport) => { reports.set(worker.address.launch, onReport); },
    stop: async ({ worker, shutdown, command }, onObservation) => {
      stops.set(worker.address.launch, shutdown);
      await onObservation({ authority, address: worker.address, shutdown, command, state: { kind: "parked", evidence: ["native-settlement"] } });
    },
    handoff: async ({ request }) => {
      const path = join(root, "handoff.md"); await writeFile(path, "Retained continuation\n");
      const address = workers.get(request.pin.launch)?.address; assert.ok(address);
      handoff = { authority, address, handoff: request.id, command: request.command, state: { kind: "settled", receipt: { handoff: request.id, command: request.command, application: "handoff-user-entry", settledEntry: "handoff-settled", effectEvidence: ["native-write"], artifact: { path, tempRoot: root, evidence: "native-artifact" } } } };
      return handoff;
    },
    observeHandoff: async () => { assert.ok(handoff); return handoff; },
    correct: async input => {
      deliveries.push(input);
      observation = { request: input.request, state: { kind: "delivered", receipt: { journal: "worker-journal", entry: "correction-user-entry", evidence: ["fsynced-user-entry"] } } };
      if (loseReceipt) throw new Error("receipt lost after delivery");
      return observation;
    },
    observeCorrection: async () => { assert.ok(observation); return observation; },
  };
  const options: LegionOptions = { storagePath: join(root, "state"), context: withWorker ? checkout : "/disposable/corrections", session: "controller", preflight: async () => [], storageFault: point => storageFault?.(point), tribuni: { host: () => host } };
  if (withWorker) {
    await mkdir(checkout);
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Corrections test"], ["config", "user.email", "corrections@example.test"]]) await exec("git", ["-C", checkout, ...args]);
    await writeFile(join(checkout, "tracked"), "original\n");
    await exec("git", ["-C", checkout, "add", "tracked"]);
    await exec("git", ["-C", checkout, "commit", "-m", "initial"]);
    const git = new GitWorkspace(checkout, async command => {
      try { const result = await exec("bash", ["-c", command]); return { kind: "finished", code: 0, output: result.stdout }; }
      catch (error) { const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: result.code, output: result.stdout + result.stderr }; }
    });
    options.assignments = { workspaceRoot: join(root, "workspaces"), repository: () => git };
    options.resume = { repository: () => git, worker: () => ({
      observeCorrection: async input => { assert.ok(host.observeCorrection); return host.observeCorrection(input); },
      observeResources: async ({ launch }): Promise<WorkerResourceObservation> => {
        const progress = launch.state.kind === "held" ? launch.state.last : launch.state; assert.ok("worker" in progress);
        const command = "assignment" in progress ? progress.command : null;
        const shutdown = stops.get(launch.id);
        const retirement = shutdown ? { authority, address: progress.worker.address, shutdown, command, state: { kind: "parked" as const, evidence: ["native-settlement"] } } : null;
        return { launch: launch.id, reservation: launch.reservation, scope: launch.scope, disposition: "settled", reasons: [], recommendation: "Inspect evidence", evidence: ["native-observation"],
          process: { kind: "alive", identity: { pid: process.pid, boot: "boot", start: "1" } },
          live: { kind: "observed", value: { nonce: randomUUID(), address: progress.worker.address, controller: authority, command, principal: "settled", busy: false, pendingMessages: false, admissionHold: null, childrenOutstanding: false, childrenHeld: false, effectsOutstanding: false, retirement } },
          retirement, report: null, actions: command ? [{ kind: "assign", command, receipt: { application: "assigned-user-entry" } }] : [], effects: [], children: [] };
      },
      observeHandoff: async () => { assert.ok(handoff); return handoff; },
    }) };
  }
  const legion = new Legion(options);
  let sequence = 0;
  const command = (text: string) => legion.command({ text, requestKey: `command-${++sequence}`, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  const interpret = async (proposal: unknown) => {
    const snapshot = (await legion.state()).snapshot;
    assert.ok(snapshot);
    return legion.submit({ kind: "interpretation", requestKey: `interpret-${++sequence}`, proposal, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus-run", sources: snapshot.submissions.map(source => ({ id: source.id, revision: source.revision })) } });
  };
  const task = async (goal: string) => {
    await legion.command({ text: `task ${goal}`, requestKey: `command-${++sequence}`, workflowInvocation: { kind: "native-skill", workflow: "implement" }, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    authority.owner = snapshot.id; authority.generation = snapshot.generation;
    const source = snapshot.submissions.at(-1);
    assert.ok(source);
    assert.equal((await interpret({ kind: "new-task", source: { id: source.id, revision: source.revision }, goal, acceptance: [], questions: [] })).kind, "applied");
    const task = (await legion.state()).tasks.at(-1); assert.ok(task);
    return { id: task.id, revision: 1 };
  };
  const launch = async (target: { id: string; revision: number }) => {
    const reservation = `reserve-${++sequence}`;
    await legion.command({ text: `reserve ${target.id}@${target.revision} --parent refs/heads/main`, requestKey: reservation, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
    assert.equal((await legion.command({ workspaceRequest: reservation })).kind, "reserved");
    const launch = `launch-${++sequence}`;
    await legion.command({ text: `launch ${target.id}@${target.revision}`, requestKey: launch, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
    const result = await legion.command({ launchRequest: launch });
    assert.equal(result.kind, "launched", JSON.stringify(result));
  };
  const correction = async (target: { id: string; revision: number }) => {
    await command(`correction ${target.id}@${target.revision} Use the existing formatter`);
    const source = (await legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
    const proposal = { kind: "correction", id: randomUUID(), source: { id: source.id, revision: source.revision }, target, authorization: { kind: "technical" } };
    assert.equal((await interpret(proposal)).kind, "applied");
    const record = (await legion.state()).snapshot?.corrections.at(-1); assert.ok(record);
    return { proposal, record };
  };
  const control = async (record: { id: string; digest: string }, action: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "correction-control", correction: { id: record.id, digest: record.digest }, action, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus-verification" } });
  };
  const report = async (target: { id: string; revision: number }) => {
    const current = (await legion.state()).tasks.find(task => task.id === target.id)?.launch; assert.ok(current && (current.kind === "assigned" || current.kind === "reported"));
    await reports.get(current.worker.address.launch)?.({ address: current.worker.address, command: current.command, outcome: "reported-result", assistantText: "Correction is performed", evidence: ["worker-report"] });
    return current;
  };
  const replace = async (target: { id: string; revision: number }) => {
    const current = await report(target);
    const request = await command(`handoff ${target.id}@${target.revision} --purpose "Fresh context" --continue "Finish correction"`);
    assert.equal(request.kind, "handoff-stage", JSON.stringify(request)); if (request.kind !== "handoff-stage") assert.fail("saved handoff required");
    await legion.command({ handoffRequest: request.requestId });
    const successor = (await legion.state()).tasks.find(task => task.id === target.id)?.launch;
    assert.ok(successor && successor.kind === "assigned", JSON.stringify(successor));
    assert.notEqual(successor.worker.address.generation, current.worker.address.generation);
    return successor;
  };
  return { legion, options, command, interpret, task, launch, correction, control, deliveries, host, report, replace, loseReceipt: () => { loseReceipt = true; }, setStorageFault: (value: LegionOptions["storageFault"]) => { storageFault = value; } };
}

test("explicit correction intent is durable, task-scoped and never launches a missing worker", async () => {
  const f = await fixture();
  const target = await f.task("Correct the label");
  const independent = await f.task("Independent approved work");
  await f.command(`correction ${target.id}@1 Use the existing formatter`);
  const source = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
  const id = randomUUID();
  assert.equal((await f.interpret({ kind: "correction", id, source: { id: source.id, revision: source.revision }, target, authorization: { kind: "technical" } })).kind, "applied");
  const view = await f.legion.state();
  assert.equal(view.snapshot?.corrections[0]?.id, id);
  assert.equal(view.snapshot?.corrections[0]?.state.kind, "queued");
  assert.equal(view.snapshot?.corrections[0]?.binding, null);
  assert.match(view.tasks.find(task => task.id === target.id)?.correctionHold ?? "", /worker/i);
  assert.equal(view.tasks.find(task => task.id === target.id)?.eligibility, "blocked");
  assert.equal(view.tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  assert.equal(view.tasks.find(task => task.id === target.id)?.launch.kind, "not-launched");
  const before = view.snapshot;
  assert.equal((await f.command("status")).kind, "observed");
  assert.equal((await f.command("doctor")).kind, "observed");
  assert.deepEqual((await f.legion.state()).snapshot, before);
  await f.command("off");
  const reopened = new Legion(f.options);
  assert.equal((await reopened.state()).mode, "inactive");
  assert.deepEqual((await reopened.state()).snapshot?.corrections, view.snapshot?.corrections);
});

test("receipt identifies the exact assigned generation; only evidenced Legatus verification marks performed correction", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label");
  await f.launch(target);
  const { record } = await f.correction(target);
  assert.ok(record.binding);
  const launch = (await f.legion.state()).tasks[0]?.launch;
  assert.ok(launch && launch.kind === "assigned");
  assert.equal(record.binding.pin.assignment, launch.command);
  assert.deepEqual(record.binding.address, launch.worker.address);
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  const delivered = (await f.legion.state()).snapshot?.corrections[0]; assert.ok(delivered);
  assert.equal(delivered.state.kind, "delivered");
  assert.equal((await f.legion.state()).tasks[0]?.eligibility, "admitted", "known technical correction retains its existing bounded execution authority");
  const effect = await f.legion.submit({ kind: "effect-admission", intent: { id: randomUUID(), pin: record.binding.pin, call: { id: "formatter-correction", name: "write", rawInput: { path: "tracked", content: "formatted" }, input: { path: "tracked", content: "formatted" }, journal: "worker-journal" } } });
  assert.equal(effect.kind, "effect", JSON.stringify(effect));
  if (effect.kind !== "effect") assert.fail("existing bounded assignment authority required");
  await f.legion.submit({ kind: "effect-observation", id: effect.effect.intent.id, digest: effect.effect.digest, state: { kind: "completed", evidence: "native-effect-end", isError: false } });
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered", "effect completion alone is not performed-correction verification");
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  assert.equal(f.deliveries.length, 1);
  assert.equal((await f.control(record, { kind: "verify", summary: "Formatter correction verified", evidence: [] })).kind, "rejected");
  assert.equal((await f.control(record, { kind: "verify", summary: "Formatter correction verified against changed source", evidence: ["git-diff:tracked", "formatter-check:exit-0"] })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "applied");
  assert.equal((await f.legion.state()).tasks[0]?.eligibility, "admitted");
  assert.equal((await f.control(record, { kind: "observe" })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "applied");
});

test("protected correction requires presented Emperor approval, binds the new task revision and retains the original assignment pin", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label");
  const independent = await f.task("Independent work");
  await f.launch(target);
  await f.command(`correction ${target.id}@1 Change the acceptance requirement`);
  const original = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(original);
  const source = { id: original.id, revision: original.revision };
  assert.equal((await f.interpret({ kind: "propose-amendment", source, affected: [target], category: "acceptance", change: "Accept the French label", question: "Approve changed acceptance?", recommendation: "Approve only if French is intended" })).kind, "applied");
  const pending = await f.legion.state();
  const decision = pending.snapshot?.decisions[0]; const amendment = pending.snapshot?.amendments[0]; assert.ok(decision && amendment);
  assert.equal(pending.tasks.find(task => task.id === target.id)?.eligibility, "blocked");
  assert.equal(pending.tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  assert.equal((await f.interpret({ kind: "correction", id: randomUUID(), source, target, authorization: { kind: "amendment", amendment: amendment.id } })).kind, "rejected");
  assert.equal((await f.legion.state()).snapshot?.corrections.length, 0);
  assert.equal((await f.legion.submit({ kind: "message", text: "Approve French", requestKey: "approval", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: pending.snapshot?.generation, presented: [{ decision: { id: decision.id, revision: 1 }, amendment: amendment.id }] } })).kind, "saved");
  const answer = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(answer);
  assert.equal((await f.interpret({ kind: "answer", source: { id: answer.id, revision: answer.revision }, decision: { id: decision.id, revision: 1 }, effect: { kind: "approve-amendment", amendment: amendment.id } })).kind, "applied");
  const latest = { id: target.id, revision: 2 };
  assert.equal((await f.interpret({ kind: "correction", id: randomUUID(), source, target: latest, authorization: { kind: "amendment", amendment: amendment.id } })).kind, "applied");
  const record = (await f.legion.state()).snapshot?.corrections[0]; assert.ok(record?.binding);
  assert.equal(record.instruction, "Accept the French label");
  assert.equal(record.task.revision, 2);
  assert.equal(record.binding.pin.task.revision, 1);
  assert.equal(record.state.kind, "queued");
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered");
  assert.match((await f.legion.state()).tasks.find(task => task.id === target.id)?.correctionHold ?? "", /assignment.*authority/i);
  await f.control(record, { kind: "verify", summary: "Performed correction independently checked", evidence: ["bounded-correction-evidence"] });
  const verified = await f.legion.state();
  assert.equal(verified.snapshot?.corrections[0]?.state.kind, "applied");
  assert.equal(verified.tasks.find(task => task.id === target.id)?.eligibility, "blocked", "verification never refreshes execution authority");
  assert.equal(verified.tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  const effect = await f.legion.submit({ kind: "effect-admission", intent: { id: randomUUID(), pin: record.binding.pin, call: { id: "amended-write", name: "write", rawInput: { path: "tracked", content: "French" }, input: { path: "tracked", content: "French" }, journal: "worker-journal" } } });
  assert.equal(effect.kind, "rejected");
  if (effect.kind === "rejected") assert.equal(effect.code, "effect-authority");
  assert.equal((await f.legion.state()).snapshot?.effects.length, 0);
});

test("same correction ID replays saved intent without rebinding and rejects conflicting content", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); await f.launch(target);
  const { record, proposal } = await f.correction(target);
  assert.equal((await f.interpret(proposal)).kind, "correction-stage");
  assert.equal((await f.interpret({ ...proposal, target: { ...target, revision: 2 } })).kind, "rejected");
  const view = await f.legion.state();
  assert.equal(view.snapshot?.corrections.length, 1);
  assert.deepEqual(view.snapshot?.corrections[0], record);
  assert.equal(f.deliveries.length, 0);
});

test("uncertain delivery holds only its task, reconciles before handoff and requires a linked fresh successor request", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label");
  const independent = await f.task("Independent work");
  await f.launch(target);
  const { record, proposal } = await f.correction(target);
  f.loseReceipt();
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "unknown");
  assert.equal((await f.legion.state()).tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  assert.equal((await f.command(`handoff ${target.id}@1 --purpose "Fresh" --continue "Correct label"`)).kind, "rejected");
  assert.equal((await f.interpret({ ...proposal, id: randomUUID(), previous: record.id })).kind, "rejected");
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  assert.equal(f.deliveries.length, 1, "lost receipt is observed, not resent");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered");
  const successor = await f.replace(target);
  assert.deepEqual((await f.legion.state()).snapshot?.corrections[0]?.binding, record.binding, "handoff never retargets saved delivery");
  const nextId = randomUUID();
  assert.equal((await f.interpret({ ...proposal, id: nextId, previous: record.id })).kind, "applied");
  const next = (await f.legion.state()).snapshot?.corrections[1]; assert.ok(next?.binding);
  assert.equal(next.previous, record.id);
  assert.deepEqual(next.binding.address, successor.worker.address);
  assert.equal(next.state.kind, "queued");
  const oldRequest = f.deliveries[0]?.request; assert.ok(oldRequest);
  assert.equal((await f.control(record, { kind: "reconcile", observation: { request: oldRequest, state: { kind: "delivered", receipt: { journal: "worker-journal", entry: "correction-user-entry", evidence: ["fsynced-user-entry"] } } } })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[1]?.state.kind, "queued", "late old receipt does not advance successor delivery");
});

test("performed-correction verification is immutable and requires current Legatus authority, not a worker report", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); await f.launch(target);
  const { record } = await f.correction(target);
  await f.control(record, { kind: "deliver" });
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  const input = { kind: "correction-control", correction: { id: record.id, digest: record.digest }, action: { kind: "verify", summary: "Performed correction checked", evidence: ["source-and-check-evidence"] }, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus-review" } };
  assert.equal((await f.legion.submit({ ...input, evidence: { ...input.evidence, session: record.binding?.address.session } })).kind, "rejected");
  assert.equal((await f.legion.submit({ ...input, evidence: { ...input.evidence, generation: snapshot.generation + 1 } })).kind, "rejected");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered");
  await f.report(target);
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered", "worker report is not verified performed correction");
  assert.equal((await f.legion.submit(input)).kind, "correction-stage");
  assert.equal((await f.legion.submit(input)).kind, "correction-stage");
  assert.equal((await f.legion.submit({ ...input, action: { ...input.action, summary: "Different performed action" } })).kind, "rejected");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "applied");
});

test("lost durable dispatch acknowledgement revokes correction authority and never blindly transports", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); await f.launch(target);
  const { record } = await f.correction(target);
  f.setStorageFault(point => { if (point === "after-commit") throw new Error("durable dispatch acknowledgement lost"); });
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "uncertain");
  f.setStorageFault(undefined);
  assert.equal(f.deliveries.length, 0);
  assert.equal((await f.legion.state()).mode, "inactive");
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "rejected");
  const saved = (await new Legion(f.options).state()).snapshot?.corrections[0]; assert.ok(saved);
  assert.deepEqual(saved.state, { kind: "queued", dispatch: "sent" });
  assert.deepEqual(saved.binding, record.binding);
});

test("ambiguous correction routing persists an Emperor decision across explicit resume without blocking independent work", async () => {
  const f = await fixture();
  const target = await f.task("Correct label"); const independent = await f.task("Independent work");
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  await f.legion.submit({ kind: "message", requestKey: "ambiguous", text: "Use the formatter", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: snapshot.generation, presented: [] } });
  const source = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
  const ref = { id: source.id, revision: source.revision };
  assert.equal((await f.interpret({ kind: "correction", id: randomUUID(), source: ref, target, authorization: { kind: "technical" } })).kind, "rejected");
  assert.equal((await f.interpret({ kind: "clarify", purpose: "routing", source: ref, affected: [target], question: "New task or correction to label?", recommendation: "Treat as label correction" })).kind, "applied");
  const pending = (await f.legion.state()).snapshot; assert.ok(pending);
  await f.command("off");
  const reopened = new Legion(f.options);
  const resume = await reopened.command({ text: `resume ${pending.id}`, requestKey: "resume", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  assert.equal(resume.kind, "applied", JSON.stringify(resume));
  const view = await reopened.state();
  assert.deepEqual(view.snapshot?.decisions, pending.decisions);
  assert.equal(view.tasks.find(task => task.id === target.id)?.eligibility, "blocked");
  assert.equal(view.tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  assert.equal(view.snapshot?.corrections.length, 0);
  const before = view.snapshot;
  await reopened.command({ text: "status", requestKey: "status", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  assert.deepEqual((await reopened.state()).snapshot, before);
  await reopened.command({ text: "off", requestKey: "off-reopened", evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
});

test("unaddressed saved intent needs a linked fresh request after an explicit ordinary launch", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label");
  const { record, proposal } = await f.correction(target);
  assert.equal(record.binding, null);
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "rejected");
  await f.launch(target);
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.binding, null);
  assert.equal((await f.interpret({ ...proposal, id: randomUUID(), previous: record.id })).kind, "applied");
  const view = await f.legion.state();
  assert.equal(view.snapshot?.corrections[0]?.state.kind, "not-delivered");
  assert.ok(view.snapshot?.corrections[1]?.binding);
  assert.equal(view.snapshot?.corrections[1]?.previous, record.id);
  assert.equal(f.deliveries.length, 0);
});

test("transport absence and mismatched or late observations cannot fabricate performed correction", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); await f.launch(target);
  const { record } = await f.correction(target);
  const transport = f.host.correct; assert.ok(transport); delete f.host.correct;
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "rejected");
  assert.deepEqual((await f.legion.state()).snapshot?.corrections[0]?.state, { kind: "queued", dispatch: "not-sent" });
  f.host.correct = transport;
  await f.control(record, { kind: "deliver" });
  const request = f.deliveries[0]?.request; assert.ok(request);
  const receipt = { journal: "worker-journal", entry: "correction-user-entry", evidence: ["fsynced-user-entry"] };
  assert.equal((await f.control(record, { kind: "reconcile", observation: { request: { ...request, task: { ...request.task, revision: 2 } }, state: { kind: "delivered", receipt } } })).kind, "rejected");
  assert.equal((await f.control(record, { kind: "reconcile", observation: { request: { ...request, binding: { ...request.binding, address: { ...request.binding.address, generation: randomUUID() } } }, state: { kind: "delivered", receipt } } })).kind, "rejected");
  assert.equal((await f.control(record, { kind: "reconcile", observation: { request, state: { kind: "delivered", receipt: { ...receipt, entry: "different-entry" } } } })).kind, "rejected");
  assert.equal((await f.control(record, { kind: "reconcile", observation: { request, state: { kind: "unknown", message: "late unavailable observation" } } })).kind, "correction-stage");
  assert.equal((await f.legion.state()).snapshot?.corrections[0]?.state.kind, "delivered");
  assert.equal(f.deliveries.length, 1);
});

test("native queued receipt remains saved intent and blocks handoff until its exact delivery outcome is reconciled", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); await f.launch(target);
  const { record } = await f.correction(target);
  f.host.correct = async ({ request }) => ({ request, state: { kind: "queued" } });
  assert.equal((await f.control(record, { kind: "deliver" })).kind, "correction-stage");
  assert.deepEqual((await f.legion.state()).snapshot?.corrections[0]?.state, { kind: "queued", dispatch: "sent" });
  assert.equal((await f.command(`handoff ${target.id}@1 --purpose "Fresh" --continue "Correct label"`)).kind, "rejected");
  assert.equal((await f.control(record, { kind: "verify", summary: "Worker is idle", evidence: ["native-turn-settled"] })).kind, "rejected");
});

test("off and explicit resume preserve unknown pinned corrections and permit observation rather than resend", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"); const independent = await f.task("Independent work");
  await f.launch(target);
  const { record } = await f.correction(target); f.loseReceipt();
  await f.control(record, { kind: "deliver" });
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  await f.command("off");
  await f.command("status"); // Observe after the separately queued native stop publication.
  const reopened = new Legion(f.options);
  assert.equal((await reopened.state()).mode, "inactive");
  assert.equal((await reopened.state()).snapshot?.corrections[0]?.state.kind, "unknown");
  const emperor = { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] };
  const resume = await reopened.command({ text: `resume ${snapshot.id}`, requestKey: "resume-unknown", evidence: emperor });
  assert.equal(resume.kind, "applied", JSON.stringify(resume));
  const view = await reopened.state(); assert.ok(view.snapshot);
  assert.equal(view.tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  assert.equal(view.snapshot.corrections[0]?.state.kind, "unknown");
  assert.deepEqual(view.snapshot.corrections[0]?.binding, record.binding);
  const action = { kind: "correction-control", correction: { id: record.id, digest: record.digest }, action: { kind: "observe" }, evidence: { session: "controller", generation: view.snapshot.generation, legatus: view.snapshot.id, run: "reconciled-continuation" } };
  assert.equal((await reopened.submit({ ...action, evidence: { ...action.evidence, session: "foreign" } })).kind, "rejected");
  assert.equal((await reopened.submit({ ...action, evidence: { ...action.evidence, generation: 1 } })).kind, "rejected");
  const resumeOptions = f.options.resume; assert.ok(resumeOptions);
  const reader = resumeOptions.worker;
  resumeOptions.worker = authority => {
    const original = reader(authority); assert.ok(original);
    return { ...original, observeResources: async input => {
      const observed = await original.observeResources(input);
      if (observed.live.kind === "observed") observed.live = { kind: "observed", value: { ...observed.live.value, controller: { ...observed.live.value.controller, session: "foreign-original-owner" } } };
      return observed;
    } };
  };
  await reopened.submit(action);
  assert.equal((await reopened.state()).snapshot?.corrections[0]?.state.kind, "unknown", "Numeric current generation cannot substitute for fresh exact original worker ownership");
  resumeOptions.worker = reader;
  assert.equal((await reopened.submit({ kind: "correction-control", correction: { id: record.id, digest: record.digest }, action: { kind: "deliver" }, evidence: { session: "controller", generation: view.snapshot.generation, legatus: view.snapshot.id, run: "reconciled-continuation" } })).kind, "correction-stage");
  assert.equal((await reopened.state()).snapshot?.corrections[0]?.state.kind, "delivered");
  assert.equal(f.deliveries.length, 1);
  await reopened.command({ text: "off", requestKey: "off-resumed", evidence: emperor });
});

test("reported correction continuation requires pending exact delivered authority for both effects and child admission", async () => {
  const f = await fixture(true);
  const target = await f.task("Correct label"), independent = await f.task("Independent work");
  await f.launch(target);
  const { record } = await f.correction(target); assert.ok(record.binding);
  await f.report(target);
  const pin = record.binding.pin;
  const correction = { id: record.id, digest: record.digest };
  const effect = (qualification: unknown, authority = pin) => f.legion.submit({ kind: "effect-admission", intent: { id: randomUUID(), pin: authority, ...(qualification ? { correction: qualification } : {}), call: { id: randomUUID(), name: "write", rawInput: { path: "tracked", content: "corrected" }, input: { path: "tracked", content: "corrected" }, journal: "worker-journal#call" } } });
  const child = (qualification: unknown) => f.legion.submit({ kind: "centurio-owner-check", id: randomUUID(), pin, child: { id: randomUUID(), digest: "child" }, stage: "launch", ...(qualification ? { correction: qualification } : {}) });
  assert.equal((await effect(null)).kind, "rejected", "Reported alone grants no new effects");
  assert.equal((await child(null)).kind, "rejected");
  assert.equal((await effect(correction)).kind, "rejected", "Saved but never delivered correction grants no continuation");
  assert.equal((await child(correction)).kind, "rejected");
  await f.control(record, { kind: "deliver" });
  assert.equal((await effect({ ...correction, id: randomUUID() })).kind, "rejected");
  assert.equal((await effect({ ...correction, digest: "foreign" })).kind, "rejected");
  assert.equal((await effect(correction, { ...pin, workerGeneration: randomUUID() })).kind, "rejected");
  const observe = f.host.observeCorrection; assert.ok(observe);
  f.host.observeCorrection = async ({ request }) => ({ request, state: { kind: "unknown", message: "Current native turn provenance missing" } });
  assert.equal((await effect(correction)).kind, "rejected", "Missing native evidence cannot authorize reported work");
  assert.equal((await child(correction)).kind, "rejected");
  f.host.observeCorrection = observe;
  assert.equal((await child(correction)).kind, "centurio-owner-current");
  const admitted = await effect(correction); assert.equal(admitted.kind, "effect");
  if (admitted.kind !== "effect") assert.fail("Exact pending correction authority required");
  await f.legion.submit({ kind: "effect-observation", id: admitted.effect.intent.id, digest: admitted.effect.digest, state: { kind: "completed", evidence: "native-completion", isError: false } });
  await f.control(record, { kind: "verify", summary: "Changed label checked", evidence: ["read:tracked"] });
  assert.equal((await effect(correction)).kind, "rejected", "Applied correction is not indefinite reported-worker authority");
  assert.equal((await child(correction)).kind, "rejected");
  assert.equal((await f.legion.state()).tasks.find(task => task.id === independent.id)?.eligibility, "admitted");
  await f.command("off");
  assert.equal((await effect(correction)).kind, "rejected", "Off never revives a reported worker");
});
