import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion } from "../src/intake.js";
import type { WorkspaceRepository } from "../src/git-workspace.js";
import { LaunchId, type TribunusHost } from "../src/tribunus.js";
async function fixture(host?: TribunusHost, fault?: NonNullable<import("../src/intake.js").LegionOptions["assignments"]>["fault"]) {
  const root = await mkdtemp(join(tmpdir(), "legion-launch-"));
  const commonDir = join(root, "repo.git");
  await mkdir(commonDir);
  const checkout = join(root, "checkout");
  await mkdir(checkout);
  let branch: string | null = null;
  let workspace: Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"] = null;
  const git: WorkspaceRepository = {
    locate: async () => ({
      commonDir, worktrees: [checkout]
    }),
    parent: async () => "a".repeat(40),
    inspect: async () => ({
      branch, path: workspace ? "directory" : "absent", workspace, parent: "a".repeat(40)
    }),
    createBranch: async (plan) => { branch = plan.commit; return {
      kind: "succeeded"
    }; },
    createWorktree: async (plan) => {
      workspace = {
        commonDir, branch: plan.branch, commit: plan.commit, backlink: true
      };
      return {
        kind: "succeeded"
      };
    },
  };
  const options = {
    storagePath: join(root, "state"), context: checkout, session: "controller",
    preflight: async () => [],
    assignments: {
      workspaceRoot: join(root, "workspaces"), repository: () => git, fault: (point: Parameters<NonNullable<typeof fault>>[0]) => fault?.(point)
    },
    tribuni: {
      host: () => host ?? null
    },
  };
  const legion = new Legion(options);
  let seq = 0;
  const evidence = {
    origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: []
  };
  const command = (text: string, requestKey = `request-${++seq}`) => legion.command({
    text, requestKey, evidence
  });
  await command("task Fix the trial label");
  const initial = await legion.state();
  const source = initial.snapshot?.submissions[0];
  assert.ok(source);
  const admitted = await legion.submit({
    kind: "interpretation", requestKey: "interpret", proposal: {
      kind: "new-task", source: {
        id: source.id, revision: 1
      }, goal: "Fix the trial label", acceptance: ["The label says Ready"], questions: [],
    }, evidence: {
      session: "controller", generation: initial.snapshot?.generation, legatus: initial.snapshot?.id, run: "fixture", sources: [{
          id: source.id, revision: 1
        }]
    }
  });
  assert.equal(admitted.kind, "applied");
  const task = (await legion.state()).tasks[0];
  assert.ok(task);
  const ready = async () => {
    assert.equal((await command(`reserve ${task.id}@1 --parent refs/heads/main`, "reserve")).kind, "deferred");
    const result = await legion.command({
      workspaceRequest: "reserve"
    });
    assert.equal(result.kind, "reserved");
    if (result.kind !== "reserved")
      assert.fail("Expected confirmed reservation");
    assert.equal(result.workspace.kind, "ready");
    return result.receipt.reservation;
  };
  return {
    legion, command, task, ready, git, options, root
  };
}
function externalWorker() {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  const started: string[] = [], initialized: string[] = [], assignments: string[] = [];
  const actor = {
    started, initialized, assignments,
    observe: (worker: import("zod").z.infer<typeof import("../src/tribunus.js").VerifiedWorker>) => worker,
    proof: (proof: import("zod").z.infer<typeof import("../src/tribunus.js").Initialization>) => proof,
    emit: async (_report: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerReport>) => { },
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { actor.started.push(launch.id); address = {
      launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; },
    inspectWorker: async ({ cwd }) => actor.observe({
      address, identityEvidence: "exact-session", resources: {
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Target Pi"
          }]
      }
    }),
    initialize: async ({ worker, command }) => { actor.initialized.push(command); return actor.proof({
      command, address: worker.address, nativePrompt: '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">body</skill>', skillPath: "/skills/poteto-mode/SKILL.md", modeEntry: "new-mode", settledEntry: "settlement"
    }); },
    assign: async ({ assignment }) => { actor.assignments.push(assignment.goal); return {
      application: "applied-assignment"
    }; },
    watchReports: (_input, onReport) => { actor.emit = onReport; },
  };
  return {
    actor, host
  };
}
import { exec as importedExec, fork, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { Initialization, VerifiedWorker } from "../src/tribunus.js";
const Ready = z.object({ kind: z.literal("ready"), hello: z.object({ address: VerifiedWorker.shape.address, endpoint: z.string(), journal: z.string() }) });
async function receiverFixture(t: TestContext) {
  const profile = await mkdtemp(join(tmpdir(), "legion-receiver-public-"));
  process.env.PI_CODING_AGENT_DIR = profile;
  const authority = { owner: "938ab712-1c42-4a4e-8769-6ef383730fe9", session: "controller", generation: 1, epoch: 0 };
  const { host } = externalWorker();
  let receiver: z.infer<typeof Ready> | null = null;
  let child: ChildProcess | null = null;
  let closed: Promise<void> | null = null;
  let receiverError: Error | null = null;
  // The runner preserves a body failure even when this cleanup check also fails.
  t.after(() => assert.ifError(receiverError));
  const sendIPC = async (message: Parameters<ChildProcess["send"]>[0]) => {
    assert.ok(child);
    const principal = child;
    await new Promise<void>((resolve, reject) => {
      principal.send(message, (error) => error ? reject(receiverError ?? error) : resolve());
    });
  };
  const messages: unknown[] = [];
  let scope = "", reservation = "";
  const send = async (kind: string, command: string, assignment: unknown = null, engineering: unknown = null): Promise<unknown> => {
    assert.ok(receiver);
    const address = receiver.hello.address, endpoint = receiver.hello.endpoint;
    return new Promise((resolve, reject) => {
      const socket = connect(endpoint); let bytes = "";
      socket.on("connect", () => socket.write(JSON.stringify({ capability: "offline-test-capability", authority, reservation, scope, address, command, kind, assignment, engineering }) + "\n"));
      socket.on("data", (chunk) => { bytes += chunk; if (bytes.includes("\n")) { socket.end(); try { const result = z.discriminatedUnion("kind", [z.object({ kind: z.literal("ok"), value: z.unknown() }), z.object({ kind: z.literal("held"), message: z.string() })]).parse(JSON.parse(bytes)); if (result.kind === "held") reject(new Error(result.message)); else resolve(result.value); } catch (error) { reject(error); } } });
      socket.on("error", reject);
    });
  };
  host.createWindow = async ({ launch, cwd }) => {
    await mkdir(cwd, {recursive:true});
    const snapshot = (await f.legion.state()).snapshot;
    assert.ok(snapshot);
    authority.owner = snapshot.id;
    authority.generation = snapshot.generation;
    scope = launch.scope; reservation = launch.reservation;
    const path = join(profile, "metadata.json");
    await writeFile(path, JSON.stringify({ launch: launch.id, reservation, scope, authority, cwd }));
    child = fork(join(process.cwd(), "tests/support/tribunus-receiver.mjs"), [profile, path], { execArgv: ["--import", "tsx"], silent: true });
    const principal = child;
    principal.on("message", (message) => messages.push(message));
    let errors = ""; principal.stderr?.on("data", (data) => { errors += data; });
    principal.on("error", (error) => { receiverError = error; });
    closed = new Promise(resolve => principal.once("close", (code, signal) => {
      if (code !== 0 || signal !== null) {
        receiverError = new Error(`Receiver exited code=${code} signal=${signal}. ${errors}`);
        t.diagnostic(receiverError.message);
      }
      resolve();
    }));
    const closure = closed;
    receiver = await new Promise((resolve, reject) => {
      principal.on("message", (message) => { const parsed = Ready.safeParse(message); if (parsed.success) resolve(parsed.data); });
      void closure.then(() => reject(receiverError ?? new Error("Receiver exited before readiness.")));
    });
    assert.ok(receiver);
    return receiver.hello.address.window;
  };
  host.startPi = async () => {};
  host.inspectWorker = async () => VerifiedWorker.parse(await send("inspect", randomUUID()));
  host.initialize = async ({ command }) => Initialization.parse(await send("initialize", command));
  host.assign = async ({ command, assignment }) => z.object({ application: z.string() }).parse(await send("assign", command, assignment));
  const watcher = new LocalTribunusHost(async command => {
    const { stdout } = await promisify(importedExec)(command);
    return { kind: "finished", code: 0, output: stdout };
  }, authority);
  host.watchReports = (input, onReport, onUnavailable) => watcher.watchReports(input, onReport, onUnavailable);
  host.watchEngineering = (input, onRequest, onUnavailable) => watcher.watchEngineering(input, onRequest, onUnavailable);
  let loseDelivery = false;
  host.deliverEngineering = async ({ worker, record }) => {
    const value = await watcher.deliverEngineering({ worker, record });
    if (loseDelivery) { loseDelivery = false; throw new Error("Acknowledgment lost after durable worker application"); }
    return value;
  };
  const f = await fixture(host);
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) {
      if (receiverError) throw receiverError;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(predicate(), "Receiver observation must arrive");
  };
  return { ...f, messages, waitFor, send, loseNextDelivery: () => { loseDelivery = true; },
    inputState: async (kind: "pending-input" | "manual-input", pending = false) => {
      assert.ok(child);
      const id = randomUUID();
      await sendIPC({ kind, id, pending });
      await waitFor(() => messages.some(message => z.object({ kind: z.literal(`${kind}-set`), id: z.literal(id) }).safeParse(message).success));
    },
    propose: async (proposal: unknown) => {
      assert.ok(child);
      const id = randomUUID();
      await sendIPC({ kind: "propose", id, proposal });
      const response = z.object({ kind: z.literal("proposal-outcome"), id: z.literal(id), result: z.unknown() });
      await waitFor(() => messages.some(message => response.safeParse(message).success));
      return response.parse(messages.find(message => response.safeParse(message).success)).result;
    },
    attemptWrite: async (path: string) => {
      assert.ok(child);
      const id = randomUUID();
      await sendIPC({ kind: "attempt-write", id, path });
      const response = z.object({ kind: z.literal("write-outcome"), id: z.literal(id), outcome: z.object({ block: z.boolean(), reason: z.string().optional() }) });
      await waitFor(() => messages.some(message => response.safeParse(message).success));
      return response.parse(messages.find(message => response.safeParse(message).success)).outcome;
    },
    settle: (command: string, reason: string, pausePublication = false) => sendIPC({ kind: "settle", command, reason, error: "External provider failure", pausePublication }),
    close: async () => {
      await f.command("off");
      // A dead receiver must not replace the primary test failure with a cleanup send error.
      if (child?.connected) await sendIPC({ kind: "shutdown" }).catch(error => {
        receiverError = error instanceof Error ? error : new Error(String(error));
        t.diagnostic(receiverError.message);
      });
      await closed;
    },
  };
}

test("a verified worker can retain a seam proposal without approving its own implementation", async () => {
  const { host } = externalWorker();
  const f = await fixture(host);
  try {
    const reservation = await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const view = await f.legion.state();
    const launch = view.tasks[0]?.launch;
    if (!view.snapshot || launch?.kind !== "assigned") assert.fail("Expected a verified assignment");
    const id = randomUUID();
    const result = await f.legion.submit({
      kind: "engineering-request", requestKey: id,
      proposal: { kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Run the exported label behavior test before and after implementation." },
      evidence: { kind: "tribunus", owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: 0, address: launch.worker.address, assignment: launch.command, reservation: reservation.id, task: { id: f.task.id, revision: 1 }, scope: launch.assignment.scope, journal: "worker-journal#request" }
    });
    assert.equal(result.kind, "applied", JSON.stringify(result));
    const observed = await f.legion.state();
    assert.equal(observed.snapshot?.engineering[0]?.id, id);
    assert.deepEqual(observed.snapshot?.engineering[0]?.state, { kind: "open" });
    assert.equal(observed.snapshot?.engineering[0]?.proposal.kind, "seam");
  } finally { await f.command("off"); }
});

test("a Legatus decision durably binds one proposal and its pending delivery without granting the worker self-approval", async () => {
  const { host } = externalWorker();
  const f = await fixture(host);
  try {
    const reservation = await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const view = await f.legion.state();
    const launch = view.tasks[0]?.launch;
    if (!view.snapshot || launch?.kind !== "assigned") assert.fail("Expected a verified assignment");
    const id = randomUUID();
    const workerEvidence = { kind: "tribunus", owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: 0, address: launch.worker.address, assignment: launch.command, reservation: reservation.id, task: { id: f.task.id, revision: 1 }, scope: launch.assignment.scope, journal: "worker-journal#request" };
    assert.equal((await f.legion.submit({ kind: "engineering-request", requestKey: id, proposal: { kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" }, evidence: workerEvidence })).kind, "applied");
    const request = (await f.legion.state()).snapshot?.engineering[0];
    assert.ok(request);
    const decision = { kind: "engineering-decision", requestKey: randomUUID(), request: { id, digest: request.digest }, decision: { kind: "approve", rationale: "The seam covers the admitted Ready label behavior." } };
    assert.equal((await f.legion.submit({ ...decision, evidence: workerEvidence })).kind, "rejected");
    const submission = { ...decision, evidence: { kind: "legatus", owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: 0, run: "engineering-decision-turn", requests: [{ id, digest: request.digest }] } };
    assert.deepEqual(await f.legion.submit({ ...submission, evidence: { ...submission.evidence, session: launch.worker.address.session } }), {
      kind: "rejected", code: "engineering-self-approval", message: "A worker cannot approve its own engineering proposal."
    });
    const approved = await f.legion.submit(submission);
    assert.equal(approved.kind, "applied", JSON.stringify(approved));
    assert.deepEqual(await f.legion.submit(submission), approved);
    await f.command("off");
    const reopened = new Legion(f.options);
    const retained = (await reopened.state()).snapshot?.engineering[0];
    assert.deepEqual(retained?.state, {
      kind: "decided", decision: { kind: "approve", rationale: "The seam covers the admitted Ready label behavior." },
      by: { session: "controller", generation: view.snapshot.generation, run: "engineering-decision-turn" },
      delivery: { kind: "pending", command: decision.requestKey }
    });
  } finally { await f.command("off"); }
});

test("a launched assignment refuses a write before Legatus engineering approval and preserves the worktree", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const launch = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(launch?.kind, "assigned", JSON.stringify(launch));
    const target = join(f.root, "unapproved.txt");
    assert.deepEqual(await f.attemptWrite(target), {
      block: true,
      reason: "Legatus engineering approval is required before tests or implementation. Only reads are currently authorized."
    });
    await assert.rejects(readFile(target), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("completed worker bytes publish atomically and remain publicly reported under writer preemption", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected applied assignment");
    await f.settle(assigned.command, "stop", true);
    await f.waitFor(() => f.messages.some((message) => z.object({ kind: z.literal("publication-open") }).safeParse(message).success));
    await new Promise((r) => setTimeout(r, 500));
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "reported");
    if (state?.kind !== "reported") assert.fail("Expected complete public result");
    assert.equal(state.report.outcome, "reported-result");
    await f.command(`launch ${f.task.id}@1`, "duplicate"); await f.legion.command({ launchRequest: "duplicate" });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "reported");
  } finally { await f.close(); }
});

for (const reason of ["error", "aborted"]) {
  test(`${reason} settlement publishes one addressed failed report after application without repeating assignment`, async (t) => {
    const f = await receiverFixture(t);
    try {
      await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
      const assigned = (await f.legion.state()).tasks[0]?.launch;
      if (assigned?.kind !== "assigned") assert.fail("Expected application before result");
      const application = assigned.application;
      await f.settle(assigned.command, reason);
      await f.waitFor(() => f.messages.some((message) => z.object({kind:z.literal("settled")}).safeParse(message).success));
      await new Promise(r => setTimeout(r,100));
      const state = (await f.legion.state()).tasks[0]?.launch;
      assert.equal(state?.kind, "reported");
      if (state?.kind !== "reported") assert.fail("Expected explicit failure result");
      assert.equal(state.report.outcome, "failed");
      assert.match(state.report.assistantText, reason === "error" ? /error/ : /aborted/);
      assert.ok(state.report.evidence.length > 0);
      assert.equal(state.application, application);
      assert.equal(state.command, assigned.command);
      const duplicate = await f.send("assign", assigned.command, assigned.assignment);
      assert.deepEqual(duplicate, {application});
      await f.command(`launch ${f.task.id}@1`, "duplicate"); await f.legion.command({launchRequest:"duplicate"});
      assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "reported");
    } finally { await f.close(); }
  });
}


test("an addressed worker publishes its actual proposal and waits without reporting assignment completion", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected applied assignment");
    const proposal = { kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Run the public label test." };
    const result = await f.propose(proposal);
    assert.equal(z.object({ details: z.object({ kind: z.literal("waiting") }) }).safeParse(result).success, true, JSON.stringify(result));
    await f.settle(assigned.command, "stop");
    await f.waitFor(() => f.messages.some(message => z.object({ kind: z.literal("settled") }).safeParse(message).success));
    const view = await f.legion.state();
    assert.equal(view.tasks[0]?.launch.kind, "assigned");
    assert.equal(view.snapshot?.engineering.length, 1);
    assert.deepEqual(view.snapshot?.engineering[0]?.proposal, proposal);
    assert.deepEqual(view.snapshot?.engineering[0]?.state, { kind: "open" });
    assert.match(view.snapshot?.engineering[0]?.requestEvidence ?? "", /session.jsonl#/);
    assert.equal((await f.attemptWrite(join(f.root, "waiting.txt"))).block, true);
  } finally { await f.close(); }
});


test("a durable engineering decision survives a lost acknowledgment and continues once only after the worker is idle", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected applied assignment");
    await f.propose({ kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" });
    let view = await f.legion.state();
    for (let i = 0; !view.snapshot?.engineering.length && i < 100; i++) { await new Promise(r => setTimeout(r, 10)); view = await f.legion.state(); }
    const request = view.snapshot?.engineering[0];
    assert.ok(request);
    const command = randomUUID();
    assert.equal((await f.legion.submit({ kind: "engineering-decision", requestKey: command,
      request: { id: request.id, digest: request.digest }, decision: { kind: "approve", rationale: "Within the bounded label task." },
      evidence: { kind: "legatus", owner: request.pin.owner, session: request.pin.session, generation: request.pin.generation, epoch: request.pin.epoch, run: "decision-turn", requests: [{ id: request.id, digest: request.digest }] }
    })).kind, "applied");
    f.loseNextDelivery();
    const lost = await f.legion.command({ engineeringDelivery: request.id });
    assert.equal(lost.kind, "rejected");
    assert.match("message" in lost ? lost.message : "", /Acknowledgment lost/);
    assert.equal(f.messages.filter(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success).length, 0);
    assert.equal((await f.legion.command({ engineeringDelivery: request.id })).kind, "applied");
    const busy = (await f.legion.state()).snapshot?.engineering[0]?.state;
    if (busy?.kind !== "decided") assert.fail("Expected decision");
    assert.equal(busy.delivery.kind, "applied");
    if (busy.delivery.kind !== "applied") assert.fail("Expected applied delivery");
    assert.deepEqual(busy.delivery.continuation, { kind: "pending" });
    await f.settle(assigned.command, "stop");
    await f.waitFor(() => f.messages.some(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success));
    const repeated = await f.legion.command({ engineeringDelivery: request.id });
    assert.equal(repeated.kind, "applied", `BEHAVIOR a completed continuation preserves idempotent decision delivery. ${JSON.stringify(repeated)}`);
    assert.equal((await f.legion.command({ engineeringDelivery: request.id })).kind, "applied");
    assert.equal(f.messages.filter(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success).length, 1, "BEHAVIOR duplicate decision delivery injects exactly one idle continuation");
    const retained = (await f.legion.state()).snapshot?.engineering[0];
    if (retained?.state.kind !== "decided" || retained.state.delivery.kind !== "applied") assert.fail("Expected durable application");
    assert.equal(retained.state.delivery.command, command);
    assert.equal(retained.state.delivery.continuation.kind, "applied");
    const target = join(f.root, "cached-approval.txt");
    assert.equal((await f.attemptWrite(target)).block, true);
    await assert.rejects(readFile(target), { code: "ENOENT" });
    await f.command("off");
    assert.deepEqual((await new Legion(f.options).state()).snapshot?.engineering[0], retained);
  } finally { await f.close(); }
});

test("the Legatus uses a separate correlated decision turn and cannot choose a foreign proposal or supply provenance", async (t) => {
  const f = await receiverFixture(t);
  const { controllerFixture } = await import("./support/engineering-controller.mjs");
  const controller = controllerFixture(f.legion, f.options.context, async () => { throw new Error("This test has no delivery stage"); });
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    await f.propose({ kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" });
    for (let i = 0; !(await f.legion.state()).snapshot?.engineering.length && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    controller.setBusy(true);
    await controller.schedule();
    assert.equal(controller.messages.length, 0);
    controller.setBusy(false);
    await controller.schedule();
    assert.equal(controller.messages.length, 1);
    assert.equal(z.object({ block: z.literal(true) }).safeParse(await controller.call("legion_engineering_decide", { kind: "approve", rationale: "Too early" })).success, true);
    assert.deepEqual(await controller.start("Legion engineering dispatch foreign"), { action: "handled" });
    const marker = controller.messages[0];
    assert.ok(marker);
    await controller.start(marker);
    assert.equal(z.object({ block: z.literal(true) }).safeParse(await controller.call("bash", { command: "touch unsafe" })).success, true);
    const forged = await controller.call("legion_engineering_decide", { kind: "approve", rationale: "Forged", request: randomUUID(), evidence: { session: "worker" } });
    assert.equal(z.object({ block: z.literal(true) }).safeParse(forged).success, true);
    const result = await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The label seam covers the admitted behavior." });
    assert.equal(z.object({ details: z.object({ kind: z.literal("applied") }) }).safeParse(result).success, true, JSON.stringify(result));
    const request = (await f.legion.state()).snapshot?.engineering[0];
    if (request?.state.kind !== "decided") assert.fail("Expected actual decision-stage publication");
    assert.equal(request.state.by.session, "controller");
    assert.equal(request.state.decision.rationale, "The label seam covers the admitted behavior.");
    assert.equal(request.state.delivery.kind, "pending");
    assert.equal(z.object({ block: z.literal(true) }).safeParse(await controller.call("legion_engineering_decide", { kind: "decline", rationale: "Second decision" })).success, true);
  } finally { controller.close(); await f.close(); }
});


test("the correlated delivery stage uses the real addressed adapter without admitting another root tool", async (t) => {
  const f = await receiverFixture(t);
  const { controllerFixture } = await import("./support/engineering-controller.mjs");
  const controller = controllerFixture(f.legion, f.options.context, async command => {
    const { stdout } = await promisify(importedExec)(command);
    return { result: { structuredContent: { output: stdout, exit_code: 0, truncated: false } } };
  }, async (host, action) => {
    const previous = f.options.tribuni.host;
    f.options.tribuni.host = () => host;
    try { return await action(); } finally { f.options.tribuni.host = previous; }
  });
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected assignment");
    await f.propose({ kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" });
    for (let i = 0; !(await f.legion.state()).snapshot?.engineering.length && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    await controller.schedule();
    await controller.start(controller.messages[0] ?? "");
    await controller.call("legion_engineering_decide", { kind: "approve", rationale: "A meaningful in-scope seam." });
    await controller.settle();
    await controller.schedule();
    assert.equal(controller.messages.length, 2);
    await controller.start(controller.messages[1] ?? "");
    assert.equal(z.object({ block: z.literal(true) }).safeParse(await controller.call("bash", { command: "touch forbidden" })).success, true);
    const request = (await f.legion.state()).snapshot?.engineering[0];
    assert.ok(request);
    assert.equal(z.object({ block: z.literal(true) }).safeParse(await controller.call("legion_engineering_deliver", { requestId: randomUUID() })).success, true);
    const result = await controller.call("legion_engineering_deliver", { requestId: request.id });
    assert.equal(z.object({ details: z.object({ kind: z.literal("applied") }) }).safeParse(result).success, true, JSON.stringify(result));
    await f.settle(assigned.command, "stop");
    await f.waitFor(() => f.messages.some(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success));
    let observed = (await f.legion.state()).snapshot?.engineering[0]?.state;
    for (let i = 0; i < 100 && !(observed?.kind === "decided" && observed.delivery.kind === "applied" && observed.delivery.continuation.kind === "applied"); i++) {
      await new Promise(r => setTimeout(r, 10)); observed = (await f.legion.state()).snapshot?.engineering[0]?.state;
    }
    if (observed?.kind !== "decided" || observed.delivery.kind !== "applied") assert.fail("Expected passive durable receipt");
    assert.equal(observed.delivery.continuation.kind, "applied");
    assert.equal((await f.attemptWrite(join(f.root, "still-locked.txt"))).block, true);
  } finally { controller.close(); await f.close(); }
});


test("foreign owners stale pins conflicting decisions and unknown delivery fields cannot replace a retained worker decision", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    await f.propose({ kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" });
    for (let i = 0; !(await f.legion.state()).snapshot?.engineering.length && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    const request = (await f.legion.state()).snapshot?.engineering[0];
    assert.ok(request);
    const ref = { id: request.id, digest: request.digest };
    const submission = { kind: "engineering-decision", requestKey: randomUUID(), request: ref,
      decision: { kind: "approve", rationale: "Within the admitted task." },
      evidence: { kind: "legatus", owner: request.pin.owner, session: request.pin.session, generation: request.pin.generation, epoch: request.pin.epoch, run: "decision-turn", requests: [ref] }
    };
    for (const changed of [{ owner: randomUUID() }, { generation: request.pin.generation + 1 }, { epoch: request.pin.epoch + 1 }]) {
      const rejected = await f.legion.submit({ ...submission, evidence: { ...submission.evidence, ...changed } });
      assert.equal(rejected.kind === "rejected" ? rejected.code : rejected.kind, "engineering-owner");
    }
    const absent = await f.legion.submit({ ...submission, request: { ...ref, digest: "foreign" } });
    assert.equal(absent.kind === "rejected" ? absent.code : absent.kind, "engineering-request");
    assert.equal((await f.legion.submit(submission)).kind, "applied");
    const conflict = await f.legion.submit({ ...submission, decision: { kind: "decline", rationale: "Conflicting same command." } });
    assert.equal(conflict.kind === "rejected" ? conflict.code : conflict.kind, "request-conflict");
    const record = (await f.legion.state()).snapshot?.engineering[0];
    assert.ok(record);
    const command = submission.requestKey;
    for (const pin of [{ ...record.pin, scope: "foreign" }, { ...record.pin, task: { ...record.pin.task, revision: 2 } }, { ...record.pin, workerGeneration: randomUUID() }]) {
      await assert.rejects(f.send("engineering", command, null, { ...record, pin }), /does not match/);
    }
    await assert.rejects(f.send("engineering", command, null, { ...record, unexpected: "do not discard" }), /unrecognized|Unrecognized/);
    assert.equal((await f.legion.command({ engineeringDelivery: record.id })).kind, "applied");
    await assert.rejects(f.send("engineering", command, null, { ...record, state: { ...record.state, decision: { kind: "decline", rationale: "Conflicting bytes" } } }), /conflicts/);
    await f.command("off");
    const stale = await f.legion.command({ engineeringDelivery: record.id });
    assert.equal(stale.kind === "rejected" ? stale.code : stale.kind, "inactive");
    const retained = (await f.legion.state()).snapshot?.engineering[0];
    if (retained?.state.kind !== "decided") assert.fail("Expected retained decision");
    assert.deepEqual(retained.state.decision, { kind: "approve", rationale: "Within the admitted task." });
    assert.equal(f.messages.filter(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success).length, 0);
  } finally { await f.close(); }
});


test("queued input and manual intervention retain an applied decision without injecting a worker continuation", async (t) => {
  const f = await receiverFixture(t);
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected assignment");
    await f.propose({ kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Public label test" });
    for (let i = 0; !(await f.legion.state()).snapshot?.engineering.length && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    const request = (await f.legion.state()).snapshot?.engineering[0];
    assert.ok(request);
    const ref = { id: request.id, digest: request.digest };
    assert.equal((await f.legion.submit({ kind: "engineering-decision", requestKey: randomUUID(), request: ref, decision: { kind: "decline", rationale: "Refine the expected behavior before implementation." },
      evidence: { kind: "legatus", owner: request.pin.owner, session: request.pin.session, generation: request.pin.generation, epoch: request.pin.epoch, run: "decision-turn", requests: [ref] }
    })).kind, "applied");
    await f.inputState("pending-input", true);
    assert.equal((await f.legion.command({ engineeringDelivery: request.id })).kind, "applied");
    await f.settle(assigned.command, "stop");
    await f.waitFor(() => f.messages.some(message => z.object({ kind: z.literal("settled") }).safeParse(message).success));
    const held = (await f.legion.state()).snapshot?.engineering[0]?.state;
    if (held?.kind !== "decided" || held.delivery.kind !== "applied") assert.fail("Expected retained application");
    assert.deepEqual(held.delivery.continuation, { kind: "pending" });
    await f.inputState("manual-input");
    await f.inputState("pending-input", false);
    const delivery = await f.legion.command({ engineeringDelivery: request.id });
    assert.equal(delivery.kind, "rejected");
    assert.match("message" in delivery ? delivery.message : "", /authorized worker incarnation/);
    assert.equal(f.messages.filter(message => z.object({ kind: z.literal("continuation") }).safeParse(message).success).length, 0);
    assert.deepEqual((await f.legion.state()).snapshot?.engineering[0]?.state, held);
  } finally { await f.close(); }
});

test("exception requests reject foreign bindings and superseded approvals while preserving exact history", async () => {
  const { host } = externalWorker();
  host.deliverEngineering = async ({ record }) => {
    if (record.state.kind !== "decided") throw new Error("No decided external delivery");
    return { kind: "applied", command: record.state.delivery.command, evidence: `worker#${record.id}`, continuation: { kind: "applied", evidence: `journal#${record.id}` } };
  };
  const f = await fixture(host);
  try {
    const reservation = await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const view = await f.legion.state(), launch = view.tasks[0]?.launch;
    if (!view.snapshot || launch?.kind !== "assigned") assert.fail("Expected a verified assignment");
    const snapshot = view.snapshot;
    const evidence = { kind: "tribunus", owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: 0, address: launch.worker.address, assignment: launch.command, reservation: reservation.id, task: { id: f.task.id, revision: 1 }, scope: launch.assignment.scope, journal: "worker-journal#request" };
    const proposal = { kind: "seam", seam: "public Ready label", behaviors: ["Ready renders Ready"], verification: "Public label test" };
    assert.equal((await f.legion.submit({ kind: "engineering-request", requestKey: randomUUID(), proposal, evidence })).kind, "applied");
    const records = async () => {
      const current = (await f.legion.state()).snapshot;
      assert.ok(current);
      return current.engineering;
    };
    const first = (await records())[0];
    assert.ok(first);
    const ref = (record: typeof first) => ({ id: record.id, digest: record.digest });
    const decide = (record: typeof first) => ({ kind: "engineering-decision", requestKey: randomUUID(), request: ref(record), decision: { kind: "approve", rationale: "Only this meaningful bounded behavior and verification." }, evidence: { kind: "legatus", owner: snapshot.id, session: "controller", generation: snapshot.generation, epoch: 0, run: randomUUID(), requests: [ref(record)] } });
    assert.equal((await f.legion.submit(decide(first))).kind, "applied");
    assert.equal((await f.legion.command({ engineeringDelivery: first.id })).kind, "applied");
    const exception = { kind: "exception", seam: ref(first), behavior: "Ready renders Ready", omittedTest: "Terminal screenshot", rationale: "No display in this worker", alternative: { description: "Read the public Ready file bytes", input: { command: "test \"$(cat ready.txt)\" = Ready" } } };
    const request = { kind: "engineering-request", requestKey: randomUUID(), previous: ref(first), proposal: exception, evidence };
    const rejected = async (input: unknown, code: string) => {
      const result = await f.legion.submit(input);
      assert.equal(result.kind, "rejected");
      if (result.kind !== "rejected") assert.fail("Expected explicit refusal");
      assert.equal(result.code, code);
    };
    await rejected({ ...request, proposal: { ...exception, skipTdd: true } }, "invalid");
    await rejected({ ...request, proposal: { ...exception, rationale: " " } }, "invalid");
    await rejected({ ...request, proposal: { ...exception, behavior: "Add billing" } }, "engineering-exception");
    await rejected({ ...request, proposal: { ...exception, seam: { ...ref(first), digest: "wrong" } } }, "engineering-exception");
    for (const changed of [{ owner: randomUUID() }, { generation: evidence.generation + 1 }, { epoch: 1 }])
      await rejected({ ...request, evidence: { ...evidence, ...changed } }, "engineering-owner");
    await rejected({ ...request, evidence: { ...evidence, assignment: randomUUID() } }, "engineering-pin");
    await rejected({ ...request, evidence: { ...evidence, reservation: randomUUID() } }, "engineering-assignment");
    await rejected({ ...request, evidence: { ...evidence, scope: "expanded" } }, "engineering-pin");
    const saved = await f.legion.submit(request);
    assert.equal(saved.kind, "applied");
    assert.deepEqual(await f.legion.submit(request), saved);
    await rejected({ ...request, proposal: { ...exception, rationale: "Changed bytes under one ID" } }, "request-conflict");
    const second = (await records())[1];
    assert.ok(second);
    const approval = decide(second);
    await rejected({ ...approval, evidence: { ...approval.evidence, session: launch.worker.address.session } }, "engineering-self-approval");
    assert.equal((await f.legion.submit(approval)).kind, "applied");
    assert.equal((await f.legion.command({ engineeringDelivery: second.id })).kind, "applied");
    const third = { kind: "engineering-request", requestKey: randomUUID(), previous: ref(second), proposal, evidence };
    assert.equal((await f.legion.submit(third)).kind, "applied");
    const old = (await records())[1];
    assert.ok(old);
    if (old.state.kind !== "decided") assert.fail("Expected retained old decision");
    await rejected({ kind: "effect-admission", intent: {
      id: randomUUID(), pin: old.pin, decision: { ...ref(old), command: old.state.delivery.command }, seam: ref(first),
      call: { id: "stale-exception-call", name: "bash", rawInput: exception.alternative.input, input: exception.alternative.input, journal: "journal#call" },
      contract: { kind: "loading", cwd: launch.worker.resources.cwd, verification: { kind: "pending", message: "No proof supplied for a revoked decision" }, precedence: "Matt TDD is primary; pstack supplements it. No self-authorized exceptions.", resources: [], diagnostics: [] },
    } }, "effect-decision");
    assert.equal((await f.legion.command({ engineeringDelivery: second.id })).kind, "rejected");
    await rejected({ ...request, requestKey: randomUUID(), previous: ref(second) }, "engineering-predecessor");
    const thirdRecord = (await records())[2];
    assert.ok(thirdRecord);
    assert.equal((await f.legion.submit(decide(thirdRecord))).kind, "applied");
    assert.equal((await f.legion.command({ engineeringDelivery: thirdRecord.id })).kind, "applied");
    await rejected({ ...request, requestKey: randomUUID(), previous: ref(thirdRecord) }, "engineering-exception");
    const history = await records();
    await f.command("off");
    const reopened = new Legion(f.options);
    assert.deepEqual((await reopened.state()).snapshot?.engineering, history);
    assert.equal(history.length, 3);
    assert.deepEqual(history[1]?.proposal, exception);
  } finally { await f.command("off"); }
});
