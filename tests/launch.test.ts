import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Legion } from "../src/intake.js";
import type { WorkspaceRepository } from "../src/git-workspace.js";
import { mattInitializationPrompt, LaunchId, LaunchRecord, type TribunusHost } from "../src/tribunus.js";
async function fixture(host?: TribunusHost, fault?: NonNullable<import("../src/intake.js").LegionOptions["assignments"]>["fault"], requestedWorkflow: "implement" | null = "implement") {
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
  let settings: import("../src/legion-settings.js").LegionSettings = { context: { warningTokens: 135000, escalationTokens: 150000 } };
  const options = {
    loadSettings: async () => settings,
    storagePath: join(root, "state"), context: checkout, session: "controller",
    preflight: async () => [],
    assignments: {
      workspaceRoot: join(root, "workspaces"), repository: () => git, fault: (point: Parameters<NonNullable<typeof fault>>[0]) => fault?.(point)
    },
    tribuni: {
      host: () => host ?? null
    },
  };
  let legion = new Legion(options);
  let seq = 0;
  const evidence = {
    origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: []
  };
  const command = (text: string, requestKey = `request-${++seq}`) => legion.command({
    text, requestKey, evidence
  });
  await legion.command({ text: "task Fix the trial label", requestKey: "task", evidence,
    ...(requestedWorkflow ? { workflowInvocation: { kind: "native-skill", workflow: requestedWorkflow } } : {}) });
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
  assert.ok(initial.snapshot);
  return {
    get legion() { return legion; }, command, task, ready, git, options, root,
    // Controlled saved-input recovery is not permission to resume the actual retiring actor.
    restartFromPreShutdownInput: async () => {
      const savedInput = join(root, "pre-shutdown-input");
      const before = (await legion.state()).snapshot;
      assert.ok(before);
      assert.equal(before.shutdown, null);
      await cp(options.storagePath, savedInput, { recursive: true });
      await command("off");
      const stopped = (await legion.state()).snapshot;
      assert.ok(stopped?.shutdown);
      await command("off");
      assert.deepEqual((await legion.state()).snapshot, stopped, "Repeated off does not rewrite unchanged addressed worker targets");
      const refused = await command(`resume ${before.id}`, "retired-resume");
      if (refused.kind !== "rejected") assert.fail("Actual off must refuse retiring-worker resume");
      assert.equal(refused.code, "stopping");
      assert.deepEqual((await legion.state()).snapshot, stopped, "Actual shutdown remains intact");
      legion = new Legion({ ...options, storagePath: savedInput });
      assert.deepEqual((await legion.state()).snapshot, before, "Explicit resume reads the truthful pre-shutdown input");
    },
    setSettings: (next: typeof settings) => { settings = next; },
    ledgerRoot: join(commonDir, "legion", "runs", initial.snapshot.id)
  };
}
test("an admitted task without a confirmed claim cannot authorize launch", async () => {
  const f = await fixture();
  try {
    const result = await f.command(`launch ${f.task.id}@1`, "launch");
    assert.equal(result.kind, "rejected");
    if (result.kind !== "rejected")
      assert.fail("Expected launch refusal");
    assert.equal(result.code, "launch-claim");
    assert.equal((await f.legion.state()).tasks[0]?.eligibility, "admitted");
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "not-launched");
  }
  finally {
    await f.command("off");
  }
});
test("an applied startup with unavailable identity is held durably and a fresh request cannot start another worker", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  const liveWorkers: string[] = [];
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { liveWorkers.push(launch.id); throw new Error("Applied start; receipt lost"); },
    inspectWorker: async () => null,
    initialize: async () => assert.fail("Unknown worker cannot initialize"),
    assign: async () => assert.fail("Unknown worker cannot receive assignment"),
  };
  const f = await fixture(host);
  try {
    const reservation = await f.ready();
    const request = await f.command(`launch ${f.task.id}@1`, "launch");
    assert.equal(request.kind, "launch-stage");
    const result = await f.legion.command({
      launchRequest: "launch"
    });
    assert.equal(result.kind, "launched");
    const held = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(held?.kind, "held");
    if (held?.kind !== "held")
      assert.fail("Expected preserved startup");
    assert.equal(held.code, "startup-outcome-unknown");
    assert.deepEqual(held.startEvidence, {
      kind: "uncertain", message: "Error: Applied start; receipt lost"
    });
    assert.equal(held.last.kind, "pi-dispatched");
    assert.equal((await f.legion.state()).tasks[0]?.claim.kind, "owned");
    await f.command(`launch ${f.task.id}@1`, "another-launch");
    await f.legion.command({
      launchRequest: "another-launch"
    });
    assert.equal(liveWorkers.length, 1);
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "held");
    await f.command("off");
    assert.equal((await f.legion.state()).mode, "stopping");
    const stopped = (await f.legion.state()).snapshot;
    assert.ok(stopped?.shutdown);
    await f.command("off");
    assert.deepEqual((await f.legion.state()).snapshot, stopped, "An unchanged worker list is not republished");
    const addressed = await f.command(`status ${stopped.id}`);
    if (addressed.kind !== "observed") assert.fail("Expected addressed stopping observation");
    assert.equal(addressed.view.mode, "stopping", "Addressed status must not hide an unresolved worker launch");
    assert.deepEqual(addressed.view.snapshot, stopped);
    const restarted = new Legion(f.options);
    assert.equal((await restarted.state()).mode, "stopping");
    assert.equal((await restarted.state()).tasks[0]?.launch.kind, "held");
    const refused = await restarted.command({ text: `resume ${stopped.id}`, requestKey: "retiring-reactivation", evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
    if (refused.kind !== "rejected") assert.fail("Unresolved startup must refuse reactivation");
    assert.equal(refused.code, "ownership");
    assert.equal(liveWorkers.length, 1);
    assert.equal(reservation.plan.path.startsWith(f.root), true);
  }
  finally {
    await f.command("off");
  }
});
test("fresh-session resume preserves unresolved shutdown after the prior controller process exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-restart-"));
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { mkdir } from "node:fs/promises";
    import { join } from "node:path";
    import { Legion } from "./src/intake.ts";
    const root = process.argv[1], commonDir = join(root, "repo.git"), context = join(root, "checkout");
    await mkdir(commonDir); await mkdir(context);
    let branch = null, workspace = null;
    const git = {
      locate: async () => ({ commonDir, worktrees: [context] }),
      parent: async () => "a".repeat(40),
      inspect: async () => ({ branch, path: workspace ? "directory" : "absent", workspace, parent: "a".repeat(40) }),
      createBranch: async plan => { branch = plan.commit; return { kind: "succeeded" }; },
      createWorktree: async plan => { workspace = { commonDir, branch: plan.branch, commit: plan.commit, backlink: true }; return { kind: "succeeded" }; }
    };
    const host = {
      createWindow: async () => ({ endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test" }),
      startPi: async () => { throw new Error("Applied startup; identity unknown"); },
      inspectWorker: async () => null,
      initialize: async () => assert.fail("Unknown worker cannot initialize"),
      assign: async () => assert.fail("Unknown worker cannot receive assignment")
    };
    const legion = new Legion({ storagePath: join(root, "state"), context, session: "prior-controller", preflight: async () => [], assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git }, tribuni: { host: () => host } });
    const evidence = { origin: "host-command", transport: "source-unavailable", session: "prior-controller", generation: null, presented: [] };
    const command = (text, requestKey) => legion.command({ text, requestKey, evidence });
    assert.equal((await legion.command({ text: "task Retained work", requestKey: "task", evidence, workflowInvocation: { kind: "native-skill", workflow: "implement" } })).kind, "saved");
    const initial = await legion.state(), source = initial.snapshot.submissions[0];
    assert.equal((await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Retained work", acceptance: ["Preserve worker"], questions: [] }, evidence: { session: "prior-controller", generation: initial.snapshot.generation, legatus: initial.snapshot.id, run: "fixture", sources: [{ id: source.id, revision: 1 }] } })).kind, "applied");
    const task = (await legion.state()).tasks[0];
    assert.equal((await command("reserve " + task.id + "@1 --parent refs/heads/main", "reserve")).kind, "deferred");
    assert.equal((await legion.command({ workspaceRequest: "reserve" })).kind, "reserved");
    assert.equal((await command("launch " + task.id + "@1", "launch")).kind, "launch-stage");
    assert.equal((await legion.command({ launchRequest: "launch" })).kind, "launched");
    await command("off", "off");
    const stopped = await legion.state();
    assert.equal(stopped.mode, "stopping"); assert.ok(stopped.snapshot.shutdown);
    process.stdout.write(stopped.snapshot.id);
  `, root]);
  // execFile resolves only after a clean process exit: the prior SQLite locks are genuinely gone.
  const id = stdout.trim();
  const options = { storagePath: join(root, "state"), context: join(root, "checkout"), session: "fresh-controller", preflight: async () => [] };
  const restarted = new Legion(options);
  assert.equal((await restarted.state()).snapshot, null, "The fresh session has no implicit attachment");
  const evidence = { origin: "host-command", transport: "source-unavailable", session: options.session, generation: null, presented: [] };
  const addressed = await restarted.command({ text: `status ${id}`, requestKey: "before", evidence });
  if (addressed.kind !== "observed") assert.fail("Expected retained aggregate observation");
  const before = addressed.view.snapshot;
  assert.ok(before?.shutdown);
  assert.equal(addressed.view.mode, "stopping", "Fresh-session addressed observation retains the unresolved worker blocker");
  assert.equal(addressed.view.tasks[0]?.launch.kind, "held");
  const file = join(options.storagePath, `v1.${id}.sqlite`), durable = await readFile(file);
  const refused = await restarted.command({ text: `resume ${id}`, requestKey: "unsafe-resume", evidence });
  if (refused.kind !== "rejected") assert.fail("Unresolved recovered shutdown must refuse activation");
  assert.equal(refused.code, "stopping", "Refusal is settlement, not a prior-process ownership lock");
  const after = await restarted.command({ text: `status ${id}`, requestKey: "after", evidence });
  if (after.kind !== "observed") assert.fail("Expected retained aggregate observation");
  assert.deepEqual(after.view.snapshot, before, "No shutdown clearing, generation, attachment, receipt or revision mutation");
  assert.deepEqual(await readFile(file), durable);
  assert.equal((await restarted.state()).snapshot, null, "Refusal does not adopt the recovered actor");
});
test("exact native initialization precedes one bounded assignment even when the start receipt is lost", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const delivered: string[] = [];
  let initialized = false;
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { address = {
      launch: launch.id, window, session: "actual-pi-session", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; throw new Error("Applied start; receipt lost"); },
    inspectWorker: async ({ cwd }) => ({
      address, identityEvidence: "matching-herdr-session", resources: {
        cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Tribunus model", status: "ready", message: "Native target metadata"
          }]
      }
    }),
    initialize: async ({ worker, command }) => {
      initialized = true;
      return {
        profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "observed-off", settledEntry: "idle-settlement"
      };
    },
    assign: async ({ assignment }) => { assert.equal(initialized, true); delivered.push(assignment.goal); assert.equal(assignment.authority, "bounded-implementation-only"); return {
      application: "receiver-journal-application"
    }; },
  };
  const f = await fixture(host);
  try {
    await f.ready();
    assert.equal((await f.command(`launch ${f.task.id}@1`, "launch")).kind, "launch-stage");
    assert.equal((await f.legion.command({
      launchRequest: "launch"
    })).kind, "launched");
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "assigned");
    if (state?.kind !== "assigned")
      assert.fail("Expected applied assignment");
    assert.equal(state.assignment.goal, "Fix the trial label");
    assert.deepEqual(state.assignment.acceptance, ["The label says Ready"]);
    assert.equal(state.worker.address.session, "actual-pi-session");
    await f.command(`launch ${f.task.id}@1`, "duplicate");
    await f.legion.command({
      launchRequest: "duplicate"
    });
    assert.deepEqual(delivered, ["Fix the trial label"]);
  }
  finally {
    await f.command("off");
  }
});
for (const cut of ["before-launch-migration-commit", "after-launch-migration-commit"] as const) {
  test(`launch migration interruption at ${cut} preserves existing ownership and receipts without starting a worker`, async () => {
    let armed = false;
    const f = await fixture(undefined, (point) => { if (armed && point === cut)
      throw new Error("Migration crash cut"); });
    try {
      const reservation = await f.ready();
      const identityPath = join(f.ledgerRoot, "assignments.initialized");
      const before = await readFile(identityPath, "utf8");
      f.options.tribuni.host = () => ({
        createWindow: async () => assert.fail("Migration cut cannot create a window"),
        startPi: async () => assert.fail("Migration cut cannot start Pi"),
        inspectWorker: async () => null, initialize: async () => null, assign: async () => null,
      });
      await f.command(`launch ${f.task.id}@1`, "launch");
      armed = true;
      const result = await f.legion.command({
        launchRequest: "launch"
      });
      assert.equal(result.kind, "uncertain");
      assert.equal((await f.legion.state()).tasks[0]?.claim.kind, "owned");
      assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "not-launched");
      assert.equal(await readFile(identityPath, "utf8"), before);
      const replay = await f.command(`reserve ${f.task.id}@1 --parent refs/heads/main`, "reserve");
      assert.equal(replay.kind, "reserved");
      if (replay.kind !== "reserved")
        assert.fail("Expected retained claim receipt");
      assert.deepEqual(replay.receipt.reservation, reservation);
    }
    finally {
      await f.command("off");
    }
  });
}
test("off during fresh workspace inspection prevents window creation and retains the ready claim", async () => {
  const host: TribunusHost = {
    createWindow: async () => assert.fail("Revoked authority cannot create a window"),
    startPi: async () => assert.fail("Revoked authority cannot start Pi"),
    inspectWorker: async () => null, initialize: async () => null, assign: async () => null,
  };
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { entered = r; });
    const inspect = f.git.inspect;
    f.git.inspect = async (plan) => { entered(); await barrier; return inspect(plan); };
    const running = f.legion.command({
      launchRequest: "launch"
    });
    await started;
    await f.command("off");
    assert.equal((await f.legion.state()).mode, "stopping");
    release();
    assert.equal((await running).kind, "uncertain");
    const view = await f.legion.state();
    assert.equal(view.mode, "inactive");
    assert.equal(view.tasks[0]?.claim.kind, "owned");
    assert.equal(view.tasks[0]?.launch.kind, "not-launched");
  }
  finally {
    await f.command("off");
  }
});
test("a received-only initialization receipt cannot become applied initialization", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const assignments: string[] = [];
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { address = {
      launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; },
    inspectWorker: async ({ cwd }) => ({
      address, identityEvidence: "exact-session-reference", resources: {
        cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Tribunus model", status: "ready", message: "Target native model metadata"
          }]
      }
    }),
    initialize: async () => null,
    assign: async ({ assignment }) => { assignments.push(assignment.goal); return {
      application: "trial-received-assignment"
    }; },
  };
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "held");
    assert.deepEqual(assignments, []);
    if (state?.kind !== "held")
      assert.fail("Expected withheld assignment");
    assert.equal(state.code, "initialization-outcome-unknown");
    assert.equal(state.last.kind, "initializing");
  }
  finally {
    await f.command("off");
  }
});
test("the bounded same-generation worker report becomes observable without authorizing another assignment", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const delivered: string[] = [];
  const observer: {
    emit: (report: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerReport>) => Promise<void>;
  } = {
    emit: async () => { }
  };
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { address = {
      launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; },
    inspectWorker: async ({ cwd }) => ({
      address, identityEvidence: "exact-session-reference", resources: {
        cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Tribunus model", status: "ready", message: "Target native model metadata"
          }]
      }
    }),
    initialize: async ({ command }) => ({
      profile: "matt", command, address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "observed-off", settledEntry: "idle-settlement"
    }),
    assign: async ({ assignment }) => { delivered.push(assignment.goal); return {
      application: "assignment-entry"
    }; },
    watchReports: (_input, onReport) => { observer.emit = onReport; },
  };
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(assigned?.kind, "assigned");
    if (assigned?.kind !== "assigned")
      assert.fail("Expected assignment");
    await observer.emit({
      address: assigned.worker.address, command: assigned.command, outcome: "reported-result", assistantText: "The label now says Ready.", evidence: ["trial-journal#final"]
    });
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "reported");
    if (state?.kind !== "reported")
      assert.fail("Expected visible report");
    assert.equal(state.report.assistantText, "The label now says Ready.");
    assert.deepEqual(delivered, ["Fix the trial label"]);
  }
  finally {
    await f.command("off");
  }
});
test("late context-check failures cannot replace a newer sample or mutate revoked ownership state", async () => {
  const window = { endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test" };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const observer: {
    emit: Parameters<NonNullable<TribunusHost["watchContext"]>>[1];
    unavailable: Parameters<NonNullable<TribunusHost["watchContext"]>>[2];
  } = { emit: async () => {}, unavailable: () => {} };
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { address = { launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11" }; },
    inspectWorker: async ({ cwd }) => ({ address, identityEvidence: "exact-session-reference", resources: { cwd,
      principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 },
      skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map(name => ({ name, path: `/skills/${name}/SKILL.md` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "Target native model metadata" }] } }),
    initialize: async ({ command }) => ({ profile: "matt", command, address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "observed-off", settledEntry: "idle-settlement" }),
    assign: async () => ({ application: "assignment-entry" }),
    watchContext: (_input, onObservation, onUnavailable) => { observer.emit = onObservation; observer.unavailable = onUnavailable; return () => {}; },
  };
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({ launchRequest: "launch" });
    const view = await f.legion.state(), assigned = view.tasks[0]?.launch;
    assert.ok(view.snapshot && assigned?.kind === "assigned");
    const observation = { authority: { owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: view.snapshot.launchRequests[0]?.epoch ?? 0 },
      address: assigned.worker.address, command: assigned.command, model: "controlled/selected", sequence: 1,
      sample: { kind: "fresh", tokens: 135000, contextWindow: 272000, sampledAt: Date.now() } } satisfies import("zod").z.infer<typeof import("../src/tribunus.js").TribunusContextObservation>;
    await observer.emit(observation);
    await observer.emit({ ...observation, sequence: 2, sample: { ...observation.sample, tokens: 140000 } });
    const newer = (await f.legion.state()).context;
    observer.unavailable("Late old-session current check failed", observation);
    assert.deepEqual((await f.legion.state()).context, newer);
    await f.command("off");
    const revoked = (await f.legion.state()).context;
    observer.unavailable("Late callback after revocation", { ...observation, sequence: 3 });
    assert.deepEqual((await f.legion.state()).context, revoked);
  } finally { await f.command("off"); }
});

test("missing known launch history cannot be interpreted as a pre-launch repository or create another worker", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  const started: string[] = [];
  const f = await fixture({
    createWindow: async () => window,
    startPi: async ({ launch }) => { started.push(launch.id); },
    inspectWorker: async () => null, initialize: async () => null, assign: async () => null,
  });
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(f.ledgerRoot, "assignments.sqlite"));
    try {
      db.exec("DROP TABLE tribuni; DROP TABLE legion_schema;");
    }
    finally {
      db.close();
    }
    const view = await f.legion.state();
    assert.equal(view.tasks[0]?.claim.kind, "owned");
    assert.equal(view.tasks[0]?.launch.kind, "unavailable");
    const result = await f.command(`launch ${f.task.id}@1`, "duplicate-after-loss");
    assert.equal(result.kind, "rejected");
    assert.deepEqual(started.length, 1);
  }
  finally {
    await f.command("off");
  }
});
test("explicit resume resolves the same retained initialization command without starting or assigning twice", async () => {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  let proof: import("zod").z.infer<typeof import("../src/tribunus.js").Initialization> | null = null;
  let lost = true;
  const starts: string[] = [], assignments: string[] = [];
  const f = await fixture({
    createWindow: async () => window,
    startPi: async ({ launch }) => { starts.push(launch.id); address = {
      launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; },
    inspectWorker: async ({ cwd }) => ({
      address, identityEvidence: "exact-session", resources: {
        cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Tribunus model", status: "ready", message: "Target native model metadata"
          }]
      }
    }),
    initialize: async ({ command }) => {
      if (!proof)
        proof = {
          profile: "matt", command, address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "observed-off", settledEntry: "idle-settlement"
        };
      assert.equal(command, proof.command);
      return lost ? null : proof;
    },
    assign: async ({ command }) => { assignments.push(command); return {
      application: "applied-assignment"
    }; },
  });
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    const held = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(held?.kind, "held");
    if (held?.kind !== "held" || held.last.kind !== "initializing")
      assert.fail("Expected retained initializing command");
    const initializationCommand = held.last.command;
    await f.restartFromPreShutdownInput();
    const owner = (await f.legion.state()).snapshot?.id;
    assert.equal((await f.command(`resume ${owner}`, "resume")).kind, "applied");
    lost = false;
    await f.command(`launch ${f.task.id}@1`, "reconcile-existing");
    await f.legion.command({
      launchRequest: "reconcile-existing"
    });
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "assigned");
    if (state?.kind !== "assigned")
      assert.fail("Expected retained receipt recovery");
    assert.equal(state.initialization.command, initializationCommand);
    assert.equal(starts.length, 1);
    assert.deepEqual(assignments, [state.command]);
  }
  finally {
    await f.command("off");
  }
});
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
        cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Tribunus model", status: "ready", message: "Target native model metadata"
          }]
      }
    }),
    initialize: async ({ worker, command, workflowChoice }) => { actor.initialized.push(command); return actor.proof({
      profile: workflowChoice.profile, command, address: worker.address,
      nativePrompt: workflowChoice.profile === "poteto-mode" ? '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">body</skill>' : mattInitializationPrompt(command),
      skillPath: workflowChoice.profile === "poteto-mode" ? "/skills/poteto-mode/SKILL.md" : "", modeEntry: "observed-controller-mode", settledEntry: "settlement"
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
test("a deferred reservation request cannot authorize a launch stage", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    assert.equal((await f.command(`reserve ${f.task.id}@1 --parent refs/heads/main`, "deferred")).kind, "deferred");
    const result = await f.command(`launch ${f.task.id}@1`, "launch");
    assert.equal(result.kind, "rejected");
    if (result.kind !== "rejected")
      assert.fail("Expected deferred-claim refusal");
    assert.equal(result.code, "launch-claim");
    assert.equal((await f.legion.state()).tasks[0]?.eligibility, "admitted");
    assert.equal(actor.started.length, 0);
  }
  finally {
    await f.command("off");
  }
});
test("busy unavailable initialized claim authority cannot authorize a launch stage", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    await f.ready();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(f.ledgerRoot, "assignments.sqlite"));
    try {
      db.exec("BEGIN EXCLUSIVE");
      const result = await f.command(`launch ${f.task.id}@1`, "busy-launch");
      assert.equal(result.kind, "rejected");
      if (result.kind !== "rejected")
        assert.fail("Expected busy-authority refusal");
      assert.equal(result.code, "launch-claim");
      assert.equal((await f.legion.state()).tasks[0]?.claim.kind, "unavailable");
      assert.equal(actor.started.length, 0);
    }
    finally {
      db.exec("ROLLBACK");
      db.close();
    }
    await f.command(`launch ${f.task.id}@1`, "after-release");
    await f.legion.command({
      launchRequest: "after-release"
    });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
    assert.deepEqual(actor.assignments, ["Fix the trial label"]);
  }
  finally {
    await f.command("off");
  }
});
test("unknown Git completion preserves the claim but cannot authorize a launch stage", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    f.git.createBranch = async () => ({
      kind: "unknown", message: "Applied branch outcome unavailable"
    });
    await f.command(`reserve ${f.task.id}@1 --parent refs/heads/main`, "reserve");
    const reserved = await f.legion.command({
      workspaceRequest: "reserve"
    });
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved")
      assert.fail("Expected retained reservation");
    assert.equal(reserved.workspace.kind, "held");
    const result = await f.command(`launch ${f.task.id}@1`, "launch");
    assert.equal(result.kind, "rejected");
    if (result.kind !== "rejected")
      assert.fail("Expected unknown-workspace refusal");
    assert.equal(result.code, "launch-workspace");
    assert.equal((await f.legion.state()).tasks[0]?.claim.kind, "owned");
    assert.equal(actor.started.length, 0);
  }
  finally {
    await f.command("off");
  }
});
for (const scenario of ["identity", "resources", "initialization"] as const) {
  test(`${scenario} evidence mismatch withholds the next worker stage`, async () => {
    const { actor, host } = externalWorker(), f = await fixture(host);
    if (scenario === "identity")
      actor.observe = (worker) => ({
        ...worker, address: {
          ...worker.address, launch: LaunchId.parse("938ab712-1c42-4a4e-8769-6ef383730fe9")
        }
      });
    if (scenario === "resources")
      actor.observe = (worker) => ({
        ...worker, resources: {
          ...worker.resources, skills: worker.resources.skills.filter((s) => s.name !== "matt-tdd")
        }
      });
    if (scenario === "initialization")
      actor.proof = (proof) => ({
        ...proof, nativePrompt: "The model says poteto-mode is enabled"
      });
    try {
      await f.ready();
      await f.command(`launch ${f.task.id}@1`, "launch");
      await f.legion.command({
        launchRequest: "launch"
      });
      const state = (await f.legion.state()).tasks[0]?.launch;
      assert.equal(state?.kind, "held");
      if (state?.kind !== "held")
        assert.fail("Expected evidence hold");
      assert.equal(state.code, scenario === "identity" ? "worker-identity" : scenario === "resources" ? "worker-resources" : "initialization-evidence");
      assert.equal(actor.initialized.length, scenario === "initialization" ? 1 : 0);
      assert.equal(actor.assignments.length, 0);
    }
    finally {
      await f.command("off");
    }
  });
}
test("off during worker initialization prevents assignment and preserves the unresolved stage", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const started = new Promise<void>((r) => { entered = r; });
  const initialize = host.initialize;
  host.initialize = async (input) => { entered(); await barrier; return initialize(input); };
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    const running = f.legion.command({
      launchRequest: "launch"
    });
    await started;
    await f.command("off");
    assert.equal((await f.legion.state()).mode, "stopping");
    release();
    assert.equal((await running).kind, "uncertain");
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "initializing");
    assert.deepEqual(actor.assignments, []);
    assert.equal(actor.started.length, 1);
  }
  finally {
    release();
    await f.command("off");
  }
});
test("an old-generation report cannot replace the current assignment report", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned")
      assert.fail("Expected assignment");
    await actor.emit({
      address: {
        ...assigned.worker.address, generation: "6d0a0f2b-d987-4780-9222-53db6f671642"
      }, command: assigned.command, outcome: "reported-result", assistantText: "Stale result", evidence: ["old-journal#final"]
    });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
    await actor.emit({
      address: assigned.worker.address, command: assigned.command, outcome: "reported-result", assistantText: "Current result", evidence: ["current-journal#final"]
    });
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "reported");
    if (state?.kind !== "reported")
      assert.fail("Expected current report");
    assert.equal(state.report.assistantText, "Current result");
    assert.deepEqual(actor.assignments, ["Fix the trial label"]);
  }
  finally {
    await f.command("off");
  }
});
test("unreadable retained report evidence is visible as a hold and never a fabricated result", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  const observer = {
    unavailable: async (_message: string) => { }
  };
  host.watchReports = (_input, _onReport, onUnavailable) => { if (onUnavailable)
    observer.unavailable = onUnavailable; };
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "launch");
    await f.legion.command({
      launchRequest: "launch"
    });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
    await observer.unavailable("Retained worker report is unreadable");
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "held");
    if (state?.kind !== "held")
      assert.fail("Expected report-evidence hold");
    assert.equal(state.code, "report-evidence-unavailable");
    assert.equal(state.last.kind, "assigned");
    assert.match(state.message, /Retained worker report is unreadable/);
    assert.deepEqual(actor.assignments, ["Fix the trial label"]);
  }
  finally {
    await f.command("off");
  }
});


test("missing run ownership evidence keeps a known worker launch visibly unavailable without duplicate effects", async () => {
  const { actor, host } = externalWorker();
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "known-launch");
    await f.legion.command({ launchRequest: "known-launch" });
    assert.equal(actor.started.length, 1);
    await rm(join(f.ledgerRoot, "assignments.initialized"));
    const before = await readFile(join(f.ledgerRoot, "assignments.sqlite"));
    for (const text of ["status", "doctor"]) await f.command(text);
    const view = await f.legion.state();
    assert.equal(view.tasks[0]?.claim.kind, "unavailable");
    assert.equal(view.tasks[0]?.launch.kind, "unavailable");
    assert.equal(view.tasks[0]?.workflowChoice, null);
    assert.match(view.tasks[0]?.workflowHold ?? "", /pin.*unavailable/i);
    assert.equal((await f.command(`launch ${f.task.id}@1`, "missing-owner")).kind, "rejected");
    assert.equal(actor.started.length, 1);
    assert.deepEqual(await readFile(join(f.ledgerRoot, "assignments.sqlite")), before);
  } finally { await f.command("off"); }
});

test("actual Tribunus below 272000 is held before initialization or assignment without replacement", async () => {
  const window = { endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test" };
  let starts = 0;
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async () => { starts++; },
    inspectWorker: async ({ launch, cwd }) => ({
      address: { launch: launch.id, window, session: "actual-worker", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11" }, identityEvidence: "matching-herdr-session",
      resources: { cwd, principal: { model: "controlled/selected", thinking: "high", contextWindow: 271999 },
        skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map(name => ({ name, path: `/skills/${name}/SKILL.md` })),
        diagnostics: [{ name: "Tribunus model", status: "ready", message: "Controlled metadata" }] }
    }),
    initialize: async () => assert.fail("Incompatible principal cannot initialize"),
    assign: async () => assert.fail("Incompatible principal cannot receive assignment"),
  };
  const f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "small-worker");
    const result = await f.legion.command({ launchRequest: "small-worker" });
    assert.equal(result.kind, "launched");
    const launch = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(launch?.kind, "held");
    if (launch?.kind !== "held") assert.fail("Expected retained incompatible worker");
    assert.equal(launch.code, "worker-principal");
    assert.match(launch.message, /271999.*272000/);
    assert.equal(starts, 1);
    assert.equal((await f.legion.state()).tasks[0]?.claim.kind, "owned");
  } finally { await f.command("off"); }
});


test("resumed settings change new intent but never an applied assignment model/thinking/profile pin", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "pin-assignment");
    await f.legion.command({ launchRequest: "pin-assignment" });
    const before = (await f.legion.state()).tasks[0]?.launch;
    if (before?.kind !== "assigned") assert.fail("Expected applied assignment");
    assert.deepEqual(before.assignment.modelPin, { model: "controlled/selected", thinking: "high", profile: "matt" });
    f.setSettings({ context: { warningTokens: 140000, escalationTokens: 160000 }, tribuni_model: { model: "controlled/future", thinking: "off" } });
    const id = (await f.legion.state()).snapshot?.id;
    await f.restartFromPreShutdownInput();
    assert.equal((await f.command(`resume ${id}`)).kind, "applied");
    const view = await f.legion.state();
    assert.deepEqual(view.tribuniModel, { kind: "new-exact-override", selection: { model: "controlled/future", thinking: "off" } });
    assert.deepEqual(view.tasks[0]?.tribunusModel, { kind: "existing-pinned", pin: before.assignment.modelPin });
    const after = view.tasks[0]?.launch;
    if (after?.kind !== "assigned") assert.fail("Expected preserved assignment");
    assert.deepEqual(after.assignment, before.assignment);
    await f.command(`launch ${f.task.id}@1`, "after-resume");
    await f.legion.command({ launchRequest: "after-resume" });
    assert.equal(actor.started.length, 1);
    assert.equal(actor.assignments.length, 1);
  } finally { await f.command("off"); }
});

test("new exact override mismatch holds the observed native worker without substitution or assignment", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    f.setSettings({ context: { warningTokens: 135000, escalationTokens: 150000 }, tribuni_model: { model: "controlled/exact-other", thinking: "off" } });
    await f.command("on");
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "override-mismatch");
    await f.legion.command({ launchRequest: "override-mismatch" });
    const launch = (await f.legion.state()).tasks[0]?.launch;
    if (launch?.kind !== "held") assert.fail("Expected visible override mismatch");
    assert.equal(launch.code, "worker-principal");
    assert.match(launch.message, /expected controlled\/exact-other\/off, observed controlled\/selected\/high/);
    assert.match(launch.message, /No substitution, relaunch or assignment/);
    if (launch.last.kind !== "verified") assert.fail("Expected retained actual worker observations");
    assert.deepEqual(launch.last.worker.resources.principal, { model: "controlled/selected", thinking: "high", contextWindow: 272000 });
    assert.equal(actor.started.length, 1);
    assert.equal(actor.initialized.length, 0);
    assert.equal(actor.assignments.length, 0);
  } finally { await f.command("off"); }
});

test("launch persistence preserves model pins in both assignment union arms and leaves missing historical pins unknown", () => {
  const window = { endpoint: "/fixture", server: "fixture", workspace: "fixture", tab: "fixture", pane: "fixture", terminal: "fixture" };
  const id = "7c3ace99-1c9d-4e36-a316-d88f6a183c11", address = { launch: id, window, session: "fixture", generation: id };
  const assignment = { task: { id, revision: 1 }, scope: "fixture", goal: "fixture", acceptance: [], workflow: "implement", authority: "bounded-implementation-only", modelPin: { model: "fixture/original", thinking: "high", profile: "original-declared-profile" } };
  const record = { id, reservation: id, revision: 1, scope: "fixture", state: { kind: "assigned", worker: { address, identityEvidence: "fixture", resources: { cwd: "/fixture", skills: [], diagnostics: [] } }, initialization: { command: id, address, nativePrompt: "fixture", skillPath: "/fixture", modeEntry: "fixture", settledEntry: "fixture" }, command: id, assignment, application: "fixture" } };
  for (const legacy of [false, true]) {
    const saved = LaunchRecord.parse({ ...record, state: { ...record.state, assignment: { ...assignment, ...(legacy ? { testContract: "Matt TDD at Legatus-approved public seams; request an explicit exception if impractical" } : {}) } } });
    if (saved.state.kind !== "assigned") assert.fail("Expected assigned record");
    assert.deepEqual(saved.state.assignment.modelPin, { model: "fixture/original", thinking: "high", profile: "original-declared-profile" });
    const { modelPin, ...unPinned } = assignment;
    const historical = LaunchRecord.parse({ ...record, state: { ...record.state, assignment: { ...unPinned, ...(legacy ? { testContract: "Matt TDD at Legatus-approved public seams; request an explicit exception if impractical" } : {}) } } });
    if (historical.state.kind !== "assigned") assert.fail("Expected historical record");
    assert.equal(historical.state.assignment.modelPin, undefined);
  }
});

test("unknown workflow holds new dispatch; explicit fresh poteto choice passes the profile gate", async () => {
  const f = await fixture(undefined, undefined, null);
  try {
    await f.ready();
    const unknown = await f.command(`launch ${f.task.id}@1`, "unknown-workflow");
    assert.equal(unknown.kind, "rejected");
    if (unknown.kind !== "rejected") assert.fail("Expected workflow clarification");
    assert.equal(unknown.code, "workflow-unknown");
    assert.match(unknown.message, /explicit.*workflow/i);
    assert.equal((await f.legion.state()).snapshot?.launchRequests.length, 0);
    assert.match((await f.legion.state()).tasks[0]?.workflowHold ?? "", /explicit.*workflow/i);
    await f.command("poteto-mode=on Use poteto for future work");
    assert.equal((await f.command(`launch ${f.task.id}@1`, "explicit-poteto")).kind, "launch-stage");
    assert.deepEqual((await f.legion.state()).snapshot?.launchRequests[0]?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
  } finally { await f.command("off"); }
});

test("poteto and explicit Matt selections hold conflicting dispatch in either order until Emperor off", async () => {
  for (const first of ["matt", "poteto"]) {
    const f = await fixture(undefined, undefined, first === "matt" ? "implement" : null);
    try {
      await f.ready();
      await f.command("poteto-mode=on Poteto instructions remain saved");
      if (first === "poteto") await f.command("implement-spec=on Follow the approved spec");
      const refusal = await f.command(`launch ${f.task.id}@1`, "conflict");
      assert.equal(refusal.kind, "rejected");
      if (refusal.kind !== "rejected") assert.fail("Expected conflicting controllers to hold");
      assert.equal(refusal.code, "workflow-conflict");
      assert.match(refusal.message, /poteto-mode=off.*different workflow/i);
      const held = await f.legion.state();
      assert.equal(held.snapshot?.workflowChoice.profile, "poteto-mode");
      assert.equal(held.snapshot?.launchRequests.length, 0);
      assert.equal(held.tasks[0]?.launch.kind, "not-launched");
      assert.match(held.tasks[0]?.workflowHold ?? "", /conflict/i);
      await f.command("poteto-mode=off");
      assert.equal((await f.command(`launch ${f.task.id}@1`, "resolved")).kind, "launch-stage");
      assert.deepEqual((await f.legion.state()).snapshot?.launchRequests[0]?.workflowChoice,
        { profile: "matt", requestedWorkflow: first === "matt" ? "implement" : "implement-spec" });
    } finally { await f.command("off"); }
  }
});

test("pending launches and applied assignments retain captured workflow across future profile defaults", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "captured-matt");
    await f.command("poteto-mode=on New future instructions");
    assert.deepEqual((await f.legion.state()).tasks[0]?.workflowChoice, { profile: "matt", requestedWorkflow: "implement" });
    await f.legion.command({ launchRequest: "captured-matt" });
    const before = (await f.legion.state()).tasks[0]?.launch;
    if (before?.kind !== "assigned") assert.fail("Expected captured assignment");
    assert.deepEqual(before.assignment.modelPin, { model: "controlled/selected", thinking: "high", profile: "matt" });
    assert.deepEqual(before.assignment.workflowChoice, { profile: "matt", requestedWorkflow: "implement" });
    await f.command("poteto-mode=off");
    await f.command("implement-spec=on Future spec workflow");
    await f.command(`launch ${f.task.id}@1`, "same-assignment");
    await f.legion.command({ launchRequest: "same-assignment" });
    const after = (await f.legion.state()).tasks[0]?.launch;
    if (after?.kind !== "assigned") assert.fail("Expected preserved assignment");
    assert.deepEqual(after.assignment, before.assignment);
    assert.equal(actor.started.length, 1);
    assert.equal(actor.assignments.length, 1);
  } finally { await f.command("off"); }
});

test("new poteto and implement-spec assignments pin the explicit controller and actual principal separately", async () => {
  for (const selected of ["poteto-mode", "implement-spec"]) {
    const { host } = externalWorker(), f = await fixture(host, undefined, null);
    try {
      await f.command(selected === "poteto-mode" ? "poteto-mode=on Bounded poteto task" : "implement-spec=on Approved spec instructions");
      await f.ready();
      await f.command(`launch ${f.task.id}@1`, "selected-workflow");
      await f.legion.command({ launchRequest: "selected-workflow" });
      const launch = (await f.legion.state()).tasks[0]?.launch;
      if (launch?.kind !== "assigned") assert.fail("Expected explicit assignment");
      assert.equal(launch.assignment.workflow, selected);
      assert.deepEqual(launch.assignment.modelPin, { model: "controlled/selected", thinking: "high", profile: selected === "poteto-mode" ? "poteto-mode" : "matt" });
      assert.deepEqual(launch.assignment.workflowChoice, selected === "poteto-mode"
        ? { profile: "poteto-mode", requestedWorkflow: "unknown" }
        : { profile: "matt", requestedWorkflow: "implement-spec" });
    } finally { await f.command("off"); }
  }
});

test("saved startup selection survives resume and an ambiguous applied launch without retargeting", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  const startups: unknown[] = [];
  const start = host.startPi;
  host.startPi = async input => { startups.push(Reflect.get(input, "startupSelection")); await start(input); };
  try {
    f.setSettings({ context: { warningTokens: 135000, escalationTokens: 150000 }, tribuni_model: { model: "controlled/selected", thinking: "high" } });
    await f.command("on");
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "frozen-start");
    const before = await f.legion.state();
    assert.deepEqual(before.snapshot?.launchRequests[0]?.startupSelection, { kind: "exact", selection: { model: "controlled/selected", thinking: "high" } });
    const inspect = host.inspectWorker;
    host.inspectWorker = async () => null;
    await f.legion.command({ launchRequest: "frozen-start" });
    f.setSettings({ context: { warningTokens: 135000, escalationTokens: 150000 }, tribuni_model: { model: "controlled/future", thinking: "off" } });
    await f.restartFromPreShutdownInput();
    assert.equal((await f.command(`resume ${before.snapshot?.id}`)).kind, "applied");
    host.inspectWorker = inspect;
    await f.command(`launch ${f.task.id}@1`, "reconcile-frozen");
    await f.legion.command({ launchRequest: "reconcile-frozen" });
    const after = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(after?.kind, "assigned");
    assert.deepEqual(startups, [{ kind: "exact", selection: { model: "controlled/selected", thinking: "high" } }]);
    assert.equal(actor.started.length, 1);
  } finally { await f.command("off"); }
});

test("Matt launch accepts only off initialization evidence and passes its captured controller", async () => {
  const { actor, host } = externalWorker(), f = await fixture(host);
  const choices: unknown[] = [];
  host.initialize = async input => {
    choices.push(Reflect.get(input, "workflowChoice"));
    return { command: input.command, address: input.worker.address, profile: "matt", nativePrompt: mattInitializationPrompt(input.command), skillPath: "", modeEntry: "observed-off-journal", settledEntry: "idle-journal" };
  };
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "matt-off");
    await f.legion.command({ launchRequest: "matt-off" });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
    assert.deepEqual(choices, [{ profile: "matt", requestedWorkflow: "implement" }]);
    assert.equal(actor.assignments.length, 1);
  } finally { await f.command("off"); }
});

test("captured native-default startup does not acquire a later configured override", async () => {
  const { host } = externalWorker(), f = await fixture(host);
  const selections: unknown[] = [], start = host.startPi;
  host.startPi = async input => { selections.push(input.startupSelection); await start(input); };
  try {
    await f.ready();
    await f.command(`launch ${f.task.id}@1`, "default-start");
    const id = (await f.legion.state()).snapshot?.id;
    f.setSettings({ context: { warningTokens: 135000, escalationTokens: 150000 }, tribuni_model: { model: "controlled/future", thinking: "off" } });
    await f.command("off");
    await f.command(`resume ${id}`);
    await f.command(`launch ${f.task.id}@1`, "default-reconcile");
    await f.legion.command({ launchRequest: "default-reconcile" });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "assigned");
    assert.deepEqual(selections, [{ kind: "native-defaults" }]);
  } finally { await f.command("off"); }
});

for (const mismatch of ["provider", "thinking"] as const) {
  test(`exact startup holds ${mismatch} alteration without initialization, fallback or replacement`, async () => {
    const { actor, host } = externalWorker(), f = await fixture(host);
    actor.observe = worker => ({ ...worker, resources: { ...worker.resources, principal: {
      model: mismatch === "provider" ? "foreign/selected" : "controlled/selected", thinking: mismatch === "thinking" ? "off" : "high", contextWindow: 272000,
    } } });
    try {
      f.setSettings({ context: { warningTokens: 135000, escalationTokens: 150000 }, tribuni_model: { model: "controlled/selected", thinking: "high" } });
      await f.command("on"); await f.ready();
      await f.command(`launch ${f.task.id}@1`, "altered-start");
      await f.legion.command({ launchRequest: "altered-start" });
      const launch = (await f.legion.state()).tasks[0]?.launch;
      if (launch?.kind !== "held") assert.fail("Expected exact selection hold");
      assert.equal(launch.code, "worker-principal");
      assert.deepEqual(actor.initialized, []);
      assert.deepEqual(actor.assignments, []);
      assert.equal(actor.started.length, 1);
    } finally { await f.command("off"); }
  });
}
