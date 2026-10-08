import { test } from "node:test";
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
    const restarted = new Legion(f.options);
    assert.equal((await restarted.state()).mode, "inactive");
    assert.equal((await restarted.state()).tasks[0]?.launch.kind, "held");
    assert.equal(reservation.plan.path.startsWith(f.root), true);
  }
  finally {
    await f.command("off");
  }
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
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Loaded target resources"
          }]
      }
    }),
    initialize: async ({ worker, command }) => {
      initialized = true;
      return {
        command, address: worker.address, nativePrompt: '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">native skill body</skill>', skillPath: "/skills/poteto-mode/SKILL.md", modeEntry: "new-enabled-pstack-entry", settledEntry: "successful-native-turn"
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
      const identityPath = join(f.root, "repo.git", "legion", "assignments.initialized");
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
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Target Pi"
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
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Target Pi"
          }]
      }
    }),
    initialize: async ({ command }) => ({
      command, address, nativePrompt: '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">body</skill>', skillPath: "/skills/poteto-mode/SKILL.md", modeEntry: "mode", settledEntry: "settled"
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
    const db = new DatabaseSync(join(f.root, "repo.git", "legion", "assignments.sqlite"));
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
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Target Pi"
          }]
      }
    }),
    initialize: async ({ command }) => {
      if (!proof)
        proof = {
          command, address, nativePrompt: '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">body</skill>', skillPath: "/skills/poteto-mode/SKILL.md", modeEntry: "new-mode", settledEntry: "settlement"
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
    await f.command("off");
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
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
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
    const db = new DatabaseSync(join(f.root, "repo.git", "legion", "assignments.sqlite"));
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
