import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Legion, type LegionOptions } from "../src/intake.js";
import { GitWorkspace } from "../src/git-workspace.js";
import { mattInitializationPrompt, VerifiedWorker, type TribunusHost, type LaunchRecord, type HandoffStageObservation } from "../src/tribunus.js";
import type { WorkerResourceObservation } from "../src/resume.js";
import type { HandoffRequest } from "../src/snapshot.js";

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "h36-"));
  const checkout = join(root, "repo");
  await mkdir(checkout);
  const gitCommand = async (...args: string[]) => (await exec("git", ["-C", checkout, ...args])).stdout.trim();
  await gitCommand("init", "-b", "main");
  await gitCommand("config", "user.name", "Handoff test");
  await gitCommand("config", "user.email", "handoff@example.test");
  await writeFile(join(checkout, "tracked"), "original\n");
  await gitCommand("add", "tracked");
  await gitCommand("commit", "-m", "initial");
  const git = new GitWorkspace(checkout, async command => {
    try { const result = await exec("bash", ["-c", command]); return { kind: "finished", code: 0, output: result.stdout }; }
    catch (error) { const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: result.code, output: result.stdout + result.stderr }; }
  });
  const authority = { owner: "", session: "controller", generation: 1, epoch: 0 };
  const workers = new Map<string, ReturnType<typeof VerifiedWorker.parse>>();
  const starts: LaunchRecord[] = [];
  const assignments: Parameters<TribunusHost["assign"]>[0][] = [];
  const controls: Array<{ kind: string; request?: z.infer<typeof HandoffRequest>; instruction?: string }> = [];
  let report: Parameters<NonNullable<TribunusHost["watchReports"]>>[1] | undefined;
  const reports = new Map<string, NonNullable<typeof report>>();
  let stage: z.infer<typeof HandoffStageObservation> | null = null;
  const stopIds = new Map<string, string>();
  let busyChildren = false, busyEffects = false, pendingStage = false, loseStage = false;
  let artifactMode: "available" | "missing" | "changed-root" = "available";
  let removeBeforeStart = false;
  let artifactObservations = 0;
  let activity: "settled" | "active" | "unknown" = "settled";
  let fault: NonNullable<LegionOptions["assignments"]>["fault"];
  let loseStart = false, loseAssign = false, hideWorker = false;
  const applications = new Map<string, string>();
  const host: TribunusHost = {
    createWindow: async ({ launch, cwd, startupSelection, workflowChoice }) => {
      if (launch.successor) {
        assert.deepEqual(startupSelection, { kind: "exact", selection: { model: "openai-codex/gpt-6.1-sol", thinking: "high" } });
        assert.deepEqual(workflowChoice, { profile: "matt", requestedWorkflow: "implement" });
      }
      const window = { endpoint: "/test/local.sock", server: "test", workspace: "w", tab: launch.id, pane: "p", terminal: "t" };
      workers.set(launch.id, VerifiedWorker.parse({ address: { launch: launch.id, window, session: launch.id, generation: randomUUID() }, resources: {
        cwd, principal: { model: "openai-codex/gpt-6.1-sol", thinking: "high", contextWindow: 272000 },
        skills: ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review", "implement"].map(name => ({ name, path: `/skills/${name}` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "available" }], children: [],
      }, identityEvidence: "hello" }));
      return window;
    },
    startPi: async ({ launch }) => { starts.push(launch); if (loseStart && launch.successor) throw new Error("startup receipt lost"); },
    inspectWorker: async ({ launch }) => hideWorker && launch.successor ? null : workers.get(launch.id) ?? null,
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "mode", settledEntry: "settled" }),
    assign: async input => { assignments.push(input); applications.set(input.command, "application"); if (loseAssign && input.assignment.handoff) throw new Error("assignment receipt lost"); return { application: "application" }; },
    watchReports: (input, onReport) => { report = onReport; reports.set(input.worker.address.launch, onReport); },
    stop: async ({ worker, shutdown, command, instruction }, observe) => {
      controls.push({ kind: "stop", ...(instruction ? { instruction } : {}) }); stopIds.set(worker.address.launch, shutdown);
      await observe({ authority, address: worker.address, shutdown, command, state: { kind: "parked", evidence: ["park"] } });
    },
    handoff: async ({ worker, request }) => {
      controls.push({ kind: "handoff", request });
      const path = join(root, "handoff.md");
      await writeFile(path, "temporary continuation\n");
      stage = { authority, address: worker.address, handoff: request.id, command: request.command, state: { kind: "settled", receipt: { handoff: request.id, command: request.command, application: "handoff-user", settledEntry: "handoff-settled", effectEvidence: ["handoff-effect"], artifact: { path, tempRoot: root, evidence: "native-write" } } } };
      if (loseStage) throw new Error("stage applied, acknowledgement lost");
      return pendingStage ? { ...stage, state: { kind: "pending" } } : stage;
    },
    observeHandoff: async () => {
      assert.ok(stage);
      artifactObservations++;
      if (artifactMode === "missing" || removeBeforeStart && artifactObservations === 3) {
        if (stage.state.kind === "settled") await unlink(stage.state.receipt.artifact.path).catch(() => {});
      }
      if (artifactMode === "changed-root" && stage.state.kind === "settled") return { ...stage, state: { ...stage.state, receipt: { ...stage.state.receipt, artifact: { ...stage.state.receipt.artifact, tempRoot: tmpdir() } } } };
      return pendingStage ? { ...stage, state: { kind: "pending" } } : stage;
    },
  };
  const reader = { observeResources: async ({ launch }: { launch: LaunchRecord }): Promise<WorkerResourceObservation> => {
    const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
    assert.ok("worker" in progress);
    const command = "assignment" in progress ? progress.command : null;
    const stopId = stopIds.get(launch.id);
    const retirement = stopId ? { authority, address: progress.worker.address, shutdown: stopId, command, state: { kind: "parked" as const, evidence: ["park"] } } : null;
    return { launch: launch.id, reservation: launch.reservation, scope: launch.scope, disposition: activity === "settled" ? "settled" : "hold", reasons: [], recommendation: "Inspect evidence", evidence: ["native-observation"],
      process: { kind: "alive", identity: { pid: process.pid, boot: "boot", start: "1" } },
      live: activity === "unknown" ? { kind: "unknown", reason: "unavailable" } : { kind: "observed", value: { nonce: randomUUID(), address: progress.worker.address, controller: authority, command, principal: activity, busy: activity === "active", pendingMessages: false, admissionHold: null, childrenOutstanding: busyChildren, childrenHeld: false, effectsOutstanding: busyEffects, retirement } },
      retirement, report: null, actions: command && applications.has(command) ? [{ kind: "assign", command, receipt: { application: "application" } }] : [], effects: [], children: [] };
  } };
  const options: LegionOptions = { storagePath: join(root, "state"), context: checkout, session: "controller", preflight: async () => [],
    assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git, fault: point => fault?.(point) }, tribuni: { host: () => host }, resume: { repository: () => git, worker: () => ({ ...reader, ...(host.observeHandoff ? { observeHandoff: host.observeHandoff } : {}) }) } };
  const legion = new Legion(options);
  let seq = 0;
  const command = (text: string, requestKey = `request-${++seq}`) => legion.command({ text, requestKey, evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
  await legion.command({ text: "task Continue the label", requestKey: "task", workflowInvocation: { kind: "native-skill", workflow: "implement" }, evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
  const initial = (await legion.state()).snapshot;
  assert.ok(initial); authority.owner = initial.id; authority.generation = initial.generation;
  const source = initial.submissions[0]; assert.ok(source);
  assert.equal((await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Continue label", acceptance: ["Ready label"], questions: [] }, evidence: { session: "controller", generation: initial.generation, legatus: initial.id, run: "fixture", sources: [{ id: source.id, revision: 1 }] } })).kind, "applied");
  const task = (await legion.state()).tasks[0]; assert.ok(task);
  await command(`reserve ${task.id}@1 --parent refs/heads/main`, "reserve");
  const ready = await legion.command({ workspaceRequest: "reserve" }); assert.equal(ready.kind, "reserved", JSON.stringify(ready)); if (ready.kind !== "reserved") assert.fail("workspace required");
  await command(`launch ${task.id}@1`, "launch");
  const launched = await legion.command({ launchRequest: "launch" }); assert.equal(launched.kind, "launched");
  const original = assignments[0]; assert.ok(original); assert.ok(report);
  await report({ command: original.command, address: original.worker.address, outcome: "reported-result", assistantText: "Safe progress", evidence: ["ordinary-report"] });
  const cwd = ready.receipt.reservation.plan.path;
  await writeFile(join(cwd, "tracked"), "committed progress\n");
  await exec("git", ["-C", cwd, "add", "tracked"]);
  await exec("git", ["-C", cwd, "commit", "-m", "worker progress"]);
  await writeFile(join(cwd, "tracked"), "staged\n"); await exec("git", ["-C", cwd, "add", "tracked"]);
  await writeFile(join(cwd, "tracked"), "dirty\n"); await writeFile(join(cwd, "untracked"), "keep\n");
  return { root, legion, options, command, task, cwd, controls, starts, assignments, workers, host, original,
    lateReport: async () => reports.get(original.worker.address.launch)?.({ command: original.command, address: original.worker.address, outcome: "failed", assistantText: "Late conflicting result", evidence: ["late"] }),
    setChildren: (value: boolean) => { busyChildren = value; }, setEffects: (value: boolean) => { busyEffects = value; },
    setPendingStage: (value: boolean) => { pendingStage = value; }, loseStage: () => { loseStage = true; },
    setArtifact: (value: typeof artifactMode) => { artifactMode = value; }, removeBeforeStart: () => { removeBeforeStart = true; },
    setActivity: (value: typeof activity) => { activity = value; }, setFault: (value: typeof fault) => { fault = value; },
    loseStart: () => { loseStart = true; hideWorker = true; }, revealWorker: () => { hideWorker = false; }, loseAssign: () => { loseAssign = true; },
    request: () => command(`handoff ${task.id}@1 --purpose "Fresh context" --continue "Finish label"`),
    continue: (id: string) => legion.command({ handoffRequest: id }),
  };
}

test("Legatus explicitly hands off to one pinned successor in the same dirty worktree", async () => {
  const f = await fixture();
  await f.command("poteto-mode=on Future unrelated assignments only");
  await mkdir(join(f.options.context, ".pi"), { recursive: true });
  await writeFile(join(f.options.context, ".pi", "legion.json"), JSON.stringify({ tribuni_model: { model: "openai-codex/gpt-6-luna", thinking: "low" } }));
  const head = (await exec("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout;
  const before = await exec("git", ["-C", f.cwd, "diff", "--binary", "HEAD"]);
  const index = await exec("git", ["-C", f.cwd, "diff", "--cached", "--binary"]);
  const requested = await f.request();
  assert.equal(requested.kind, "handoff-stage");
  if (requested.kind !== "handoff-stage") assert.fail("saved handoff required");
  await f.continue(requested.requestId);
  const view = await f.legion.state();
  const handoff = view.snapshot?.handoffs[0]; assert.ok(handoff);
  assert.equal(handoff.purpose, "Fresh context"); assert.equal(handoff.continuation, "Finish label");
  assert.equal(handoff.state.kind, "successor-reserved");
  assert.equal(view.tasks[0]?.launch.kind, "assigned");
  assert.equal(f.starts.length, 2);
  const successor = f.assignments[1]; assert.ok(successor?.assignment.handoff);
  assert.equal(successor.worker.resources.cwd, f.cwd);
  assert.equal(successor.assignment.handoff.artifact.path, join(f.root, "handoff.md"));
  assert.deepEqual(successor.assignment.modelPin, { model: "openai-codex/gpt-6.1-sol", thinking: "high", profile: "matt" });
  assert.match(f.controls[0]?.instruction ?? "", /safe.stop/i);
  assert.deepEqual(f.controls.map(control => control.kind), ["stop", "handoff"]);
  assert.equal((await exec("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout, head);
  assert.equal((await exec("git", ["-C", f.cwd, "diff", "--binary", "HEAD"])).stdout, before.stdout);
  assert.equal((await exec("git", ["-C", f.cwd, "diff", "--cached", "--binary"])).stdout, index.stdout);
  assert.equal(await readFile(join(f.cwd, "untracked"), "utf8"), "keep\n");
});

test("duplicate requests and concurrent explicit continuations retain exactly one successor", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.request(), f.request()]);
  if (a.kind !== "handoff-stage" || b.kind !== "handoff-stage") assert.fail("same request must be retained");
  assert.equal(a.requestId, b.requestId);
  await Promise.all([f.continue(a.requestId), f.continue(a.requestId)]);
  await f.continue(a.requestId);
  assert.equal(f.starts.length, 2);
  assert.equal(f.assignments.length, 2);
  assert.equal((await f.legion.state()).snapshot?.handoffs.length, 1);
  assert.equal(f.controls.filter(control => control.kind === "handoff").length, 1);
  assert.equal((await f.command(`handoff ${f.task.id}@1 --purpose "Different" --continue "Finish label"`)).kind, "rejected");
  assert.equal((await f.command(`launch ${f.task.id}@1`)).kind, "rejected");
});

test("an applied handoff with lost receipt is observed without another native stage", async () => {
  const f = await fixture(); f.loseStage();
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  assert.equal((await f.continue(request.requestId)).kind, "rejected");
  const held = (await f.legion.state()).snapshot?.handoffs[0]?.state;
  assert.equal(held?.kind, "held"); if (held?.kind !== "held") assert.fail("hold required");
  assert.equal(held.last.kind, "handoff-dispatched");
  await f.continue(request.requestId);
  assert.equal(f.controls.filter(control => control.kind === "handoff").length, 1);
  assert.equal(f.starts.length, 2);
});

test("successor migration before/after commit failures preserve history and reconcile one allocation", async () => {
  for (const cut of ["before-launch-migration-commit", "after-launch-migration-commit", "after-launch-commit"] as const) {
    const f = await fixture(); let armed = true;
    f.setFault(point => { if (point === cut && armed) { armed = false; throw new Error(`cut ${cut}`); } });
    const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
    assert.equal((await f.continue(request.requestId)).kind, "rejected");
    assert.equal(f.starts.length, 1, "No process is started across lost allocation receipt");
    const held = (await f.legion.state()).snapshot?.handoffs[0]; assert.ok(held);
    assert.equal(held.pin.launch, f.original.worker.address.launch);
    f.setFault(undefined);
    await f.continue(request.requestId);
    assert.equal(f.starts.length, 2);
    await f.continue(request.requestId);
    assert.equal(f.starts.length, 2);
    assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "dirty\n");
  }
});

test("unknown successor startup and applied-unacknowledged assignment reconcile the saved IDs without replay", async () => {
  const f = await fixture(); f.loseStart(); f.loseAssign();
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  await f.continue(request.requestId);
  let launch = (await f.legion.state()).tasks[0]?.launch;
  assert.equal(launch?.kind, "held");
  if (launch?.kind !== "held") assert.fail("startup hold required");
  assert.equal(launch.last.kind, "pi-dispatched");
  const saved = (await f.legion.state()).snapshot?.handoffs[0]; assert.ok(saved);
  const successor = saved.state.kind === "successor-reserved" ? saved.state.launch : assert.fail("saved successor ID required");
  await f.continue(request.requestId);
  assert.equal(f.starts.length, 2, "Unknown does not authorize a second start");
  f.revealWorker();
  await f.continue(request.requestId);
  launch = (await f.legion.state()).tasks[0]?.launch;
  assert.equal(launch?.kind, "held"); if (launch?.kind !== "held") assert.fail("application hold required");
  assert.equal(launch.last.kind, "assigning");
  await f.continue(request.requestId);
  assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
  assert.equal(f.starts.length, 2);
  assert.equal(f.starts[1]?.id, successor);
  assert.equal(f.assignments.length, 2, "Retained application is read, not resent");
});

test("active or unknown native principal, child, effect and handoff stage block replacement", async () => {
  for (const activity of ["active", "unknown", "child", "effect", "stage"] as const) {
    const f = await fixture();
    if (activity === "active" || activity === "unknown") f.setActivity(activity);
    if (activity === "child") f.setChildren(true);
    if (activity === "effect") f.setEffects(true);
    if (activity === "stage") f.setPendingStage(true);
    const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
    assert.equal((await f.continue(request.requestId)).kind, "rejected");
    assert.equal(f.starts.length, 1);
    assert.equal(f.controls.filter(control => control.kind === "handoff").length, activity === "stage" ? 1 : 0);
    const before = (await f.legion.state()).snapshot;
    await f.command("status"); await f.command("doctor");
    assert.deepEqual((await f.legion.state()).snapshot, before, "Observation never retries or repairs handoff");
    f.setActivity("settled"); f.setChildren(false); f.setEffects(false); f.setPendingStage(false);
    await f.continue(request.requestId);
    assert.equal(f.starts.length, 2);
    assert.equal(f.controls.filter(control => control.kind === "handoff").length, 1);
  }
});

test("missing or changed temporary artifact and changed actual pins/resources block without fallback", async () => {
  for (const change of ["missing", "changed-root", "model", "resources", "worktree"] as const) {
    const f = await fixture();
    if (change === "missing" || change === "changed-root") f.setArtifact(change);
    if (change === "model" || change === "resources") {
      const worker = f.workers.get(f.original.worker.address.launch); assert.ok(worker);
      if (change === "model") worker.resources.principal = { model: "openai-codex/gpt-6-luna", thinking: "high", contextWindow: 272000 };
      else worker.resources.diagnostics = [{ name: "Tribunus model", status: "missing", message: "auth unavailable" }];
    }
    if (change === "worktree") await exec("git", ["-C", f.cwd, "symbolic-ref", "HEAD", "refs/heads/foreign"]);
    const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
    assert.equal((await f.continue(request.requestId)).kind, "rejected");
    assert.equal(f.starts.length, 1);
    assert.equal(f.assignments.length, 1);
    assert.equal((await f.legion.state()).snapshot?.handoffs[0]?.state.kind, "held");
    assert.equal(await readFile(join(f.cwd, "tracked"), "utf8"), "dirty\n");
  }
});

test("the exact artifact is rechecked after allocation before any successor dispatch", async () => {
  const f = await fixture(); f.removeBeforeStart();
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  const result = await f.continue(request.requestId);
  assert.equal(result.kind, "uncertain");
  assert.equal(f.starts.length, 1);
  const handoff = (await f.legion.state()).snapshot?.handoffs[0]; assert.ok(handoff);
  assert.equal(handoff.state.kind, "successor-reserved");
  assert.equal((await f.continue(request.requestId)).kind, "rejected");
  assert.equal(f.starts.length, 1);
});

test("late predecessor callbacks cannot rewrite successor state or handoff history", async () => {
  const f = await fixture();
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  await f.continue(request.requestId);
  const before = await f.legion.state();
  await f.lateReport();
  const after = await f.legion.state();
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.deepEqual(after.tasks[0]?.launch, before.tasks[0]?.launch);
  assert.equal(f.starts.length, 2);
});

test("explicit resume observes the known successor and never restores either actor", async () => {
  const f = await fixture();
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  await f.continue(request.requestId);
  const saved = (await f.legion.state()).snapshot; assert.ok(saved);
  await f.command("off");
  const resumed = new Legion(f.options);
  const result = await resumed.command({ text: `resume ${saved.id}`, requestKey: "resume-handoff", evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  const view = await resumed.state();
  assert.equal(view.tasks[0]?.launch.kind, "assigned");
  assert.equal(view.tasks[0]?.eligibility, "blocked");
  assert.match(view.tasks[0]?.resumeHold ?? "", /observation.only/);
  assert.equal((await resumed.command({ text: `handoff ${request.requestId}`, requestKey: "resume-stage", evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } })).kind, "rejected");
  assert.equal((await resumed.command({ handoffRequest: request.requestId })).kind, "rejected");
  assert.equal(f.starts.length, 2);
  assert.equal(f.assignments.length, 2);
});

test("missing known successor or predecessor history holds explicit resume without allocation", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  for (const missing of ["successor", "predecessor"] as const) {
    const f = await fixture();
    const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
    await f.continue(request.requestId);
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    await f.command("off");
    const path = join(f.options.context, ".git", "legion", "runs", saved.id, "assignments.sqlite");
    await writeFile(`${path}.before-missing-history`, await readFile(path));
    const db = new DatabaseSync(path);
    try { db.exec(missing === "successor" ? "DELETE FROM tribuni_successors" : "DELETE FROM tribuni"); } finally { db.close(); }
    const resumed = new Legion(f.options);
    const result = await resumed.command({ text: `resume ${saved.id}`, requestKey: `missing-${missing}`, evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
    assert.equal(result.kind, "rejected");
    assert.equal(f.starts.length, 2);
    assert.equal(f.assignments.length, 2);
    const view = await resumed.state();
    assert.equal(view.tasks[0]?.launch.kind, "unavailable");
    assert.equal(view.snapshot?.handoffs[0]?.id, request.requestId);
  }
});

test("legacy snapshots default to no handoffs and missing historical actual selection never adopts defaults", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = await fixture();
  const saved = (await f.legion.state()).snapshot; assert.ok(saved);
  const snapshotPath = join(f.options.storagePath, `v1.${saved.id}.sqlite`);
  const snapshotDb = new DatabaseSync(snapshotPath);
  try {
    const row = z.object({ value: z.string() }).parse(snapshotDb.prepare("SELECT value FROM snapshot WHERE singleton=1").get());
    const legacy = z.record(z.string(), z.unknown()).parse(JSON.parse(row.value));
    delete legacy.handoffs;
    snapshotDb.prepare("UPDATE snapshot SET value=? WHERE singleton=1").run(JSON.stringify(legacy));
  } finally { snapshotDb.close(); }
  assert.deepEqual((await f.legion.state()).snapshot?.handoffs, []);
  const path = join(f.options.context, ".git", "legion", "runs", saved.id, "assignments.sqlite");
  await writeFile(`${path}.before-legacy-pin`, await readFile(path));
  const db = new DatabaseSync(path);
  try {
    const row = z.object({ value: z.string() }).parse(db.prepare("SELECT value FROM tribuni").get());
    const legacy = z.object({ state: z.object({ assignment: z.record(z.string(), z.unknown()) }).passthrough() }).passthrough().parse(JSON.parse(row.value));
    delete legacy.state.assignment.modelPin;
    db.prepare("UPDATE tribuni SET value=?").run(JSON.stringify(legacy));
  } finally { db.close(); }
  assert.equal((await f.request()).kind, "rejected");
  assert.deepEqual((await f.legion.state()).snapshot?.handoffs, []);
  assert.equal(f.starts.length, 1);
});

test("purpose and continuation are required and missing optional host facilities hold visibly", async () => {
  const f = await fixture();
  assert.equal((await f.command(`handoff ${f.task.id}@1 --purpose "" --continue "Finish"`)).kind, "rejected");
  assert.equal((await f.command(`handoff ${f.task.id}@1 --purpose "Fresh" --continue " "`)).kind, "rejected");
  assert.deepEqual((await f.legion.state()).snapshot?.handoffs, []);
  delete f.host.observeHandoff;
  const request = await f.request(); if (request.kind !== "handoff-stage") assert.fail("handoff required");
  const result = await f.continue(request.requestId);
  assert.equal(result.kind, "rejected"); if (result.kind !== "rejected") assert.fail("hold required");
  assert.match(result.message, /facilities unavailable/);
  assert.equal((await f.legion.state()).snapshot?.handoffs[0]?.state.kind, "held");
  assert.equal(f.starts.length, 1);
  assert.equal(f.controls.length, 0, "Missing host facilities never choose an alternate delivery");
});
