import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Legion } from "../src/intake.js";
import type { WorkspaceRepository } from "../src/git-workspace.js";
import { mattInitializationPrompt, type TribunusHost } from "../src/tribunus.js";

async function assignmentFixture() {
  const root = await mkdtemp(join(tmpdir(), "legion-effect-authorization-"));
  const checkout = join(root, "checkout"), commonDir = join(root, "repo.git");
  await mkdir(checkout); await mkdir(commonDir);
  let branch: string | null = null;
  let workspace: Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"] = null;
  const git: WorkspaceRepository = {
    locate: async () => ({ commonDir, worktrees: [checkout] }),
    parent: async () => "a".repeat(40),
    inspect: async () => ({ branch, workspace, path: workspace ? "directory" : "absent", parent: "a".repeat(40) }),
    createBranch: async plan => { branch = plan.commit; return { kind: "succeeded" }; },
    createWorktree: async plan => {
      workspace = { commonDir, branch: plan.branch, commit: plan.commit, backlink: true };
      return { kind: "succeeded" };
    },
  };
  const window = { endpoint: "/fixture/herdr.sock", server: "fixture", workspace: "w", tab: "t", pane: "p", terminal: "term" };
  let address: Parameters<NonNullable<TribunusHost["initialize"]>>[0]["worker"]["address"];
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { address = { launch: launch.id, window, session: "worker", generation: randomUUID() }; },
    inspectWorker: async ({ cwd }) => ({ address, identityEvidence: "worker-session", resources: {
      cwd, principal: { model: "fixture/selected", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "handoff", "code-review"].map(name => ({ name, path: `/fixture/${name}/SKILL.md` })),
      diagnostics: [{ name: "Tribunus model", status: "ready", message: "Fixture native principal metadata" }],
    } }),
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address,
      nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "observed-off", settledEntry: "settled" }),
    assign: async () => ({ application: "assignment-applied" }),
  };
  const options = {
    storagePath: join(root, "state"), context: checkout, session: "controller", preflight: async () => [],
    assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git },
    tribuni: { host: () => host },
  };
  const legion = new Legion(options);
  let sequence = 0;
  const command = (text: string, requestKey = `command-${++sequence}`) => legion.command({ text, requestKey,
    ...(text === "task Fix the Ready label" ? { workflowInvocation: { kind: "native-skill", workflow: "implement" } } : {}),
    evidence: { origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: [] } });
  assert.equal((await command("task Fix the Ready label")).kind, "saved");
  const initial = (await legion.state()).snapshot;
  assert.ok(initial);
  const source = initial.submissions[0];
  assert.ok(source);
  assert.equal((await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: {
    kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Fix the Ready label", acceptance: ["Ready renders Ready"], questions: [],
  }, evidence: { session: "controller", generation: initial.generation, legatus: initial.id, run: "fixture", sources: [{ id: source.id, revision: 1 }] } })).kind, "applied");
  const task = (await legion.state()).tasks[0];
  assert.ok(task);
  assert.equal((await command(`reserve ${task.id}@1 --parent refs/heads/main`, "reserve")).kind, "deferred");
  assert.equal((await legion.command({ workspaceRequest: "reserve" })).kind, "reserved");
  assert.equal((await command(`launch ${task.id}@1`, "launch")).kind, "launch-stage");
  assert.equal((await legion.command({ launchRequest: "launch" })).kind, "launched");
  const view = await legion.state(), assigned = view.tasks[0];
  assert.ok(view.snapshot);
  if (assigned?.launch.kind !== "assigned" || assigned.claim.kind !== "owned") assert.fail(`Fixture must have an owned applied assignment: ${JSON.stringify(assigned)}`);
  const launch = assigned.launch;
  const intent = {
    id: randomUUID(),
    pin: { owner: view.snapshot.id, session: "controller", generation: view.snapshot.generation, epoch: 0,
      task: { id: task.id, revision: 1 }, scope: launch.assignment.scope, reservation: assigned.claim.reservation.id,
      assignment: launch.command, launch: launch.worker.address.launch, workerSession: launch.worker.address.session,
      workerGeneration: launch.worker.address.generation, addressDigest: createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") },
    call: { id: "write-ready", name: "write", rawInput: { path: "ready.txt", content: "Ready" }, input: { path: "ready.txt", content: "Ready" }, journal: "worker-journal#write-ready" },
  };
  return { legion, command, options, intent };
}

test("current owned assignment admits an exact effect without engineering or skill-load proof", async () => {
  const f = await assignmentFixture();
  const result = await f.legion.submit({ kind: "effect-admission", intent: f.intent });
  assert.equal(result.kind, "effect", JSON.stringify(result));
  if (result.kind !== "effect") assert.fail("Expected retained effect admission");
  assert.deepEqual(result.effect.intent, f.intent);
  assert.equal(result.effect.state.kind, "outstanding");
  const assignment = (await f.legion.state()).tasks[0]?.launch;
  assert.ok(assignment && assignment.kind === "assigned");
  assert.equal("testContract" in assignment.assignment, false, "Assignment retains scope/goal/acceptance, not machine TDD contracts");
  assert.deepEqual((await f.legion.state()).snapshot?.engineering, []);
  assert.deepEqual(await f.legion.submit({ kind: "effect-admission", intent: f.intent }), result, "Duplicate intent returns the same receipt, not a new effect");
  assert.equal((await f.legion.state()).snapshot?.effects.length, 1);
  assert.equal((await f.legion.submit({ kind: "effect-observation", id: f.intent.id, digest: result.effect.digest,
    state: { kind: "refused", reason: "Ordinary permission denial", evidence: "native-denial" } })).kind, "effect");
  assert.equal((await f.legion.state()).snapshot?.effects[0]?.state.kind, "refused");
  await f.command("off");
});

test("effect admission requires the exact current assignment and worker incarnation independently of methodology", async () => {
  const f = await assignmentFixture();
  const changedPins = [
    { owner: randomUUID() }, { session: "foreign-controller" }, { generation: f.intent.pin.generation + 1 }, { epoch: 1 },
    { task: { ...f.intent.pin.task, revision: 2 } }, { scope: "expanded-scope" }, { reservation: randomUUID() },
    { assignment: randomUUID() }, { launch: randomUUID() }, { workerSession: "foreign-worker" }, { workerGeneration: randomUUID() }, { addressDigest: "foreign-address" },
  ];
  for (const changed of changedPins) {
    const result = await f.legion.submit({ kind: "effect-admission", intent: { ...f.intent, pin: { ...f.intent.pin, ...changed } } });
    assert.equal(result.kind, "rejected", JSON.stringify({ changed, result }));
    assert.equal((await f.legion.state()).snapshot?.effects.length, 0);
  }
  await f.command("off");
  assert.equal((await f.legion.submit({ kind: "effect-admission", intent: f.intent })).kind, "rejected");
});

test("an unknown effect cannot become settled from a later ordinary observation or admit fresh work", async () => {
  const f = await assignmentFixture();
  const result = await f.legion.submit({ kind: "effect-admission", intent: f.intent });
  if (result.kind !== "effect") assert.fail("Expected effect admission");
  const unknown = { kind: "effect-observation", id: f.intent.id, digest: result.effect.digest,
    state: { kind: "unknown", reason: "Native execution outcome unavailable", evidence: "native-unknown" } };
  const observed = await f.legion.submit(unknown);
  assert.equal(observed.kind, "effect");
  assert.deepEqual(await f.legion.submit(unknown), observed);
  assert.equal((await f.legion.submit({ ...unknown, state: { kind: "completed", isError: false, evidence: "later-completion" } })).kind, "rejected");
  assert.equal((await f.legion.submit({ kind: "effect-admission", intent: { ...f.intent, id: randomUUID(), call: { ...f.intent.call, id: "fresh-write" } } })).kind, "rejected");
  await f.command("off");
  assert.equal((await f.legion.state()).mode, "stopping");
  const reopened = await new Legion(f.options).state();
  assert.deepEqual(reopened.snapshot?.effects[0]?.state, unknown.state, "Unknown outcome stays visible on read-only reopening");
});

test("legacy effect proof remains readable and digest-stable without becoming current effect authority", async () => {
  const f = await assignmentFixture();
  const legacyIntent = {
    id: f.intent.id, pin: f.intent.pin,
    decision: { id: randomUUID(), digest: "historical-decision", command: randomUUID() },
    call: f.intent.call,
    contract: {
      verification: { kind: "pending", message: "Historical reads not completed" },
      compatibility: "Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review.",
      kind: "loading", cwd: "/historical-workspace",
      precedence: "Matt TDD is primary; pstack supplements it. No self-authorized exceptions.", resources: [], diagnostics: [],
    },
  };
  const digest = createHash("sha256").update(JSON.stringify(legacyIntent)).digest("hex");
  const admitted = await f.legion.submit({ kind: "effect-admission", intent: legacyIntent });
  assert.equal(admitted.kind, "effect", JSON.stringify(admitted));
  if (admitted.kind !== "effect") assert.fail("Expected same assignment to admit independently of legacy proof");
  assert.equal(admitted.effect.digest, digest, "Parsing must not reorder legacy evidence and invalidate its retained digest");
  assert.deepEqual(admitted.effect.intent, legacyIntent);
  await f.legion.submit({ kind: "effect-observation", id: legacyIntent.id, digest,
    state: { kind: "unknown", reason: "Historical native outcome unresolved", evidence: "legacy-outcome" } });
  await f.command("off");
  const reopened = (await new Legion(f.options).state()).snapshot?.effects[0];
  assert.ok(reopened);
  assert.deepEqual(reopened.intent, legacyIntent);
  assert.equal(reopened.digest, digest);
  assert.equal(createHash("sha256").update(JSON.stringify(reopened.intent)).digest("hex"), digest);
  assert.equal(reopened.state.kind, "unknown");
});
