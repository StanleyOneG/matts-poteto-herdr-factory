import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Legion, type LegionOptions } from "../src/intake.js";
import type { WorkspaceRepository, WorkspaceResourceObservation } from "../src/git-workspace.js";
import extension from "../src/extension.js";
import { composedRuntime } from "./support/composed-transport.mjs";
import { setTimeout as delay } from "node:timers/promises";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "resume-"));
  const commonDir = join(root, "repo.git");
  await mkdir(commonDir);
  let branch: string | null = null;
  let workspace: Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"] = null;
  let observe: () => Promise<WorkspaceResourceObservation> = async () => ({ disposition: "identified", association: await git.inspect(), dirty: { kind: "observed", value: true }, reasons: [] });
  const git = {
    locate: async () => ({ commonDir, worktrees: [root] }), parent: async () => "a".repeat(40),
    inspect: async () => ({ branch, workspace, path: workspace ? "directory" as const : "absent" as const, parent: "a".repeat(40) }),
    createBranch: async (plan: Parameters<WorkspaceRepository["createBranch"]>[0]) => { branch = plan.commit; return { kind: "succeeded" as const }; },
    createWorktree: async (plan: Parameters<WorkspaceRepository["createWorktree"]>[0]) => { workspace = { commonDir, branch: plan.branch, commit: plan.commit, backlink: true }; return { kind: "succeeded" as const }; },
  };
  const options: LegionOptions = { storagePath: join(root, "state"), context: root, session: "original", preflight: async () => [], assignments: { repository: () => git }, resume: { repository: () => ({ observeResources: () => observe() }), worker: () => null } };
  const legion = new Legion(options);
  const evidence = { origin: "host-command", transport: "source-unavailable", session: "original", generation: null, presented: [] };
  const command = (text: string) => legion.command({ text, requestKey: randomUUID(), evidence });
  await command("implement-spec=on Approved label task");
  const initial = await legion.state(), source = initial.snapshot?.submissions[0];
  assert.ok(initial.snapshot && source);
  await legion.submit({ kind: "interpretation", requestKey: "scope", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Label Ready", acceptance: ["Ready label"], questions: [] }, evidence: { session: "original", generation: initial.snapshot.generation, legatus: initial.snapshot.id, run: "scope", sources: [{ id: source.id, revision: 1 }] } });
  const task = (await legion.state()).tasks[0]; assert.ok(task);
  await legion.command({ text: `reserve ${task.id}@1 --parent refs/heads/main`, requestKey: "reserve", evidence });
  assert.equal((await legion.command({ workspaceRequest: "reserve" })).kind, "reserved");
  const saved = (await legion.state()).snapshot; assert.ok(saved);
  await command("off");
  return { root, legion, options, evidence, saved, task, command, git, setObserve: (next: typeof observe) => { observe = next; }, observe: () => observe(), cleanup: async () => { await command("off"); await rm(root, { recursive: true, force: true }); } };
}

test("retained workspaces require explicit resume in their saved session; on and task keys cannot bypass reconciliation", async () => {
  const f = await fixture();
  try {
    for (const text of ["on", "task More work"]) {
      const result = await f.command(text);
      assert.equal(result.kind, "rejected");
      if (result.kind === "rejected") assert.equal(result.code, "resume-required");
    }
    assert.equal((await f.legion.state()).snapshot?.submissions.length, 1);
    assert.equal((await f.legion.state()).mode, "inactive");
  } finally { await f.cleanup(); }
});

test("fresh explicit resume observes actual dirty workspace before attaching; unknown association preserves saved state", async () => {
  const f = await fixture();
  const fresh = new Legion({ ...f.options, session: "fresh" });
  const evidence = { ...f.evidence, session: "fresh" };
  try {
    assert.equal((await fresh.state()).snapshot, null);
    const before = (await f.legion.state()).snapshot;
    f.setObserve(async () => ({ disposition: "hold", association: null, dirty: { kind: "unknown", reason: "Unavailable" }, reasons: ["Workspace moved"] }));
    const refused = await fresh.command({ text: `resume ${f.saved.id}`, requestKey: "unknown", evidence });
    assert.equal(refused.kind, "rejected");
    if (refused.kind === "rejected") assert.match(refused.message, /Workspace moved/);
    assert.deepEqual((await f.legion.state()).snapshot, before);
    assert.equal((await fresh.state()).snapshot, null);
    f.setObserve(async () => ({ disposition: "identified", association: await f.git.inspect(), dirty: { kind: "observed", value: true }, reasons: [] }));
    const resumed = await fresh.command({ text: `resume ${f.saved.id}`, requestKey: "known", evidence });
    assert.equal(resumed.kind, "applied");
    const view = await fresh.state();
    assert.equal(view.mode, "active");
    assert.deepEqual(view.snapshot?.tasks, f.saved.tasks);
    assert.deepEqual(view.snapshot?.submissions, f.saved.submissions);
    assert.equal(view.tasks[0]?.claim.kind, "owned");
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});

async function waitForPrompt(runtime: ReturnType<typeof composedRuntime>) {
  for (let attempt = 0; attempt < 1000; attempt++) { const prompt = runtime.prompts.shift(); if (prompt !== undefined) return prompt; await delay(5); }
  assert.fail(`No prompt delivered: ${runtime.notices.join("\n")}`);
}

for (const delivery of ["applied", "uncertain"] as const) test(`registered fresh resume retains ${delivery} compact continuation with saved questions and no original-prompt replay`, async () => {
  const root = await mkdtemp(join(tmpdir(), "resume-native-")), profile = join(root, "profile"), bin = join(root, "bin");
  await mkdir(profile); await mkdir(bin);
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node\nconst a=process.argv.slice(2);console.log(a[0]==='--version'?'0.9.1':JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:'/controlled/read-only.sock'}));\n`, { mode: 0o700 });
  const prior = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD };
  process.env.PATH = `${bin}:${prior.PATH}`; process.env.PI_CODING_AGENT_DIR = profile; delete process.env.PI_SUBAGENT_CHILD;
  const original = composedRuntime(root, "original", join(root, "original.jsonl"));
  const fresh = composedRuntime(root, "fresh", join(root, "fresh.jsonl"));
  assert.ok(fresh.ctx.model);
  fresh.ctx.model.id = "emperor-selected-fresh";
  const reader = (session: string) => new Legion({ storagePath: join(profile, "legion"), context: root, session, preflight: async () => [] });
  try {
    extension(original.pi); await original.emit("session_start");
    assert.equal((await reader("original").state()).snapshot, null);
    await original.command("implement-spec=on ORIGINAL-DO-NOT-REPLAY");
    assert.equal(await original.start(await waitForPrompt(original)), true);
    const initial = (await reader("original").state()).snapshot; assert.ok(initial);
    const source = initial.submissions[0]; assert.ok(source);
    const applied = await original.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Saved Ready label", acceptance: ["Ready label is visible"], questions: [{ question: "Which color?", recommendation: "Use blue" }] });
    assert.equal(applied.isError ?? false, false);
    await original.settle();
    const saved = (await reader("original").state()).snapshot; assert.ok(saved);
    const originalDispatch = saved.submissions[0]?.workflowDispatch; assert.equal(originalDispatch?.kind, "applied-native");
    await original.command("off");
    extension(fresh.pi); await fresh.emit("session_start");
    assert.equal((await reader("fresh").state()).snapshot, null);
    assert.deepEqual(fresh.prompts, []);
    if (delivery === "uncertain") fresh.failSend();
    await fresh.command(`resume ${saved.id}`);
    const input = await waitForPrompt(fresh);
    assert.equal(fresh.ctx.model?.id, "emperor-selected-fresh", "Resume validates the fresh Emperor-selected principal, never sets or substitutes it");
    assert.match(input, /Explicit run continuation/);
    assert.match(input, /Saved Ready label/);
    assert.match(input, /Which color\?/);
    assert.doesNotMatch(input, /ORIGINAL-DO-NOT-REPLAY/);
    const awaiting = (await reader("fresh").state()).snapshot?.resumeState?.continuation;
    assert.equal(awaiting?.dispatch.kind, delivery === "applied" ? "dispatching-native" : "uncertain-native");
    await fresh.command(`resume ${saved.id}`); await delay(100);
    assert.deepEqual(fresh.prompts, [], "Pending/uncertain continuation cannot enqueue a replay before application");
    assert.deepEqual((await reader("fresh").state()).snapshot?.resumeState?.continuation, awaiting);
    assert.equal(await fresh.start(input), delivery === "applied", "Uncertain delivery cannot start a late prompt");
    const continued = (await reader("fresh").state()).snapshot; assert.ok(continued);
    assert.deepEqual(continued.submissions, saved.submissions, "No fake Emperor submission or overwritten original prompt");
    assert.deepEqual(continued.tasks, saved.tasks);
    assert.equal(continued.resumeState?.continuation?.dispatch.kind, delivery === "applied" ? "applied-native" : "uncertain-native");
    if (delivery === "applied") await fresh.settle();
    else await fresh.command("off");
    await fresh.command(`resume ${saved.id}`); await delay(100);
    assert.deepEqual(fresh.prompts, [], "Repeated resume cannot enqueue a competing continuation");
    assert.equal((await reader("fresh").state()).snapshot?.submissions.length, 1);
    assert.deepEqual((await reader("fresh").state()).snapshot?.resumeState?.continuation, continued.resumeState?.continuation, "Resume never overwrites a prior native applied/uncertain identity");
    if (delivery === "applied") {
      const answerText = "Use blue for the Ready label.";
      await fresh.emit("input", { source: "interactive", text: answerText });
      const answerInput = await waitForPrompt(fresh);
      assert.match(answerInput, /Use blue for the Ready label\./);
      assert.doesNotMatch(answerInput, /Explicit run continuation|ORIGINAL-DO-NOT-REPLAY/);
      assert.equal(await fresh.start(answerInput), true);
      const answered = (await reader("fresh").state()).snapshot; assert.ok(answered);
      const answer = answered.submissions.at(-1), decision = answered.decisions[0], task = answered.tasks[0];
      assert.ok(answer && decision && task);
      assert.equal(answer.workflowDispatch?.kind, "applied-native");
      const resolved = await fresh.call("legion_intake", { kind: "answer", source: { id: answer.id, revision: 1 }, decision: { id: decision.id, revision: 1 }, effect: { kind: "record-clarification", target: { id: task.id, revision: 1 }, answer: answerText } });
      assert.equal(resolved.isError ?? false, false);
      await fresh.settle(); await delay(100);
      const final = (await reader("fresh").state()).snapshot; assert.ok(final);
      assert.deepEqual(fresh.prompts, [], "The new answer delivers exactly once");
      assert.deepEqual(final.submissions[0]?.workflowDispatch, originalDispatch, "Original delivery receipt is unchanged");
      assert.deepEqual(final.resumeState?.continuation, continued.resumeState?.continuation, "Applied continuation receipt is unchanged");
      assert.equal(final.submissions.length, 2);
      assert.equal(final.decisions[0]?.state.kind, "resolved");
    }
  } finally {
    await original.emit("session_shutdown"); await fresh.emit("session_shutdown");
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent off revokes delayed resume observation before attachment and receipt publication", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.setObserve(async () => { entered(); await gate; return { disposition: "identified", association: await f.git.inspect(), dirty: { kind: "observed", value: true }, reasons: [] }; });
  const fresh = new Legion({ ...f.options, session: "fresh" }), evidence = { ...f.evidence, session: "fresh" };
  try {
    const before = (await f.legion.state()).snapshot;
    const resuming = fresh.command({ text: `resume ${f.saved.id}`, requestKey: "delayed", evidence });
    await started;
    await fresh.command({ text: "off", requestKey: "off-wins", evidence });
    release();
    const result = await resuming;
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "revoked");
    assert.deepEqual((await f.legion.state()).snapshot, before);
    assert.equal((await fresh.state()).snapshot, null);
  } finally { release(); await f.cleanup(); }
});

test("fresh activation cannot bypass missing initialized managed history even after its Git marker disappears", async () => {
  const f = await fixture();
  const commonDir = f.saved.workspaceRequests[0]?.repository; assert.ok(commonDir);
  const database = join(commonDir, "legion", "runs", f.saved.id, "assignments.sqlite");
  await mkdir(join(f.root, ".git"));
  await rm(database);
  await rm(join(f.root, ".git"), { recursive: true });
  const fresh = new Legion({ ...f.options, session: "fresh" }), evidence = { ...f.evidence, session: "fresh" };
  try {
    for (const text of ["on", "task Bypass", `resume ${f.saved.id}`]) {
      const result = await fresh.command({ text, requestKey: randomUUID(), evidence });
      assert.equal(result.kind, "rejected");
      if (result.kind === "rejected") assert.match(result.message, /history|unavailable|missing/i);
    }
    assert.equal((await fresh.state()).snapshot, null);
    const { stat } = await import("node:fs/promises");
    await assert.rejects(stat(database), { code: "ENOENT" });
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});

test("proven settled inactive historical workspaces do not permanently forbid an independent new run", async () => {
  const f = await fixture(), fresh = new Legion({ ...f.options, session: "independent" }), evidence = { ...f.evidence, session: "independent" };
  try {
    const before = (await f.legion.state()).snapshot;
    assert.equal((await fresh.command({ text: "on", requestKey: "new-run", evidence })).kind, "applied");
    const view = await fresh.state();
    assert.notEqual(view.snapshot?.id, f.saved.id);
    assert.deepEqual(view.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    assert.deepEqual(view.snapshot?.workspaceRequests, []);
    assert.deepEqual((await f.legion.state()).snapshot, before, "No historical resource adoption or mutation");
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});

test("resume validates every repository and saved receipt, not just the latest repository provider", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.command(`resume ${f.saved.id}`)).kind, "applied");
    const secondDir = join(f.root, "second.git"); await mkdir(secondDir);
    let branch: string | null = null;
    let workspace: Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"] = null;
    const second: WorkspaceRepository = {
      locate: async () => ({ commonDir: secondDir, worktrees: [f.root] }), parent: async () => "b".repeat(40),
      inspect: async () => ({ branch, workspace, path: workspace ? "directory" : "absent", parent: "b".repeat(40) }),
      createBranch: async plan => { branch = plan.commit; return { kind: "succeeded" }; },
      createWorktree: async plan => { workspace = { commonDir: secondDir, branch: plan.branch, commit: plan.commit, backlink: true }; return { kind: "succeeded" }; },
    };
    assert.ok(f.options.assignments); f.options.assignments.repository = () => second;
    await f.command("task Second bounded task");
    const view = await f.legion.state(), source = view.snapshot?.submissions.at(-1); assert.ok(view.snapshot && source);
    assert.equal((await f.legion.submit({ kind: "interpretation", requestKey: "scope-second", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Second task", acceptance: [], questions: [] }, evidence: { session: "original", generation: view.snapshot.generation, legatus: view.snapshot.id, run: "scope-second", sources: [{ id: source.id, revision: 1 }] } })).kind, "applied");
    const task = (await f.legion.state()).tasks[1]; assert.ok(task);
    await f.legion.command({ text: `reserve ${task.id}@1 --parent refs/heads/main`, requestKey: "reserve-second", evidence: f.evidence });
    assert.equal((await f.legion.command({ workspaceRequest: "reserve-second" })).kind, "reserved");
    assert.equal((await f.legion.state()).tasks.filter(task => task.claim.kind === "owned").length, 2);
    await f.command("off");
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    const earlierDir = saved.workspaceRequests[0]?.repository; assert.ok(earlierDir);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(earlierDir, "legion", "runs", saved.id, "assignments.sqlite"));
    try { db.prepare("DELETE FROM receipts WHERE request=?").run("reserve"); } finally { db.close(); }
    f.setObserve(async () => assert.fail("History must be checked before actual resources"));
    const result = await f.command(`resume ${saved.id}`);
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.match(result.message, /reserve.*matching receipt\/history/);
    assert.deepEqual((await f.legion.state()).snapshot, saved);
  } finally { await f.cleanup(); }
});

for (const point of ["before-commit", "after-commit"] as const) test(`resume ${point} publication uncertainty withholds attachment authority and preserves saved tasks`, async () => {
  const f = await fixture();
  let armed = true;
  const fresh = new Legion({ ...f.options, session: "fresh", storageFault: current => { if (armed && current === point) { armed = false; throw new Error("Controlled resume publication failure"); } } });
  const evidence = { ...f.evidence, session: "fresh" };
  try {
    const result = await fresh.command({ text: `resume ${f.saved.id}`, requestKey: "publication", evidence });
    assert.equal(result.kind, "uncertain");
    assert.notEqual((await fresh.state()).mode, "active");
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    assert.deepEqual(saved.tasks, f.saved.tasks);
    assert.deepEqual(saved.submissions, f.saved.submissions);
    const reconciled = await fresh.command({ text: `resume ${f.saved.id}`, requestKey: "reconcile-publication", evidence });
    assert.equal(reconciled.kind, "applied");
    assert.equal((await fresh.state()).mode, "active");
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});

for (const damage of ["missing-root", "malformed-resume-state"] as const) test(`explicit resume preserves ${damage} rather than defaulting to a new continuation`, async () => {
  const f = await fixture(), before = (await f.legion.state()).snapshot; assert.ok(before);
  const { DatabaseSync } = await import("node:sqlite");
  const database = join(f.options.storagePath, `v1.${before.id}.sqlite`);
  const db = new DatabaseSync(database);
  const resumeState = damage === "missing-root" ? { generation: before.generation, holds: [], continuation: { root: { id: randomUUID(), revision: 1 }, dispatch: { kind: "pending-native" } } } : { generation: "invalid", holds: [] };
  try { db.prepare("UPDATE snapshot SET value=? WHERE singleton=1").run(JSON.stringify({ ...before, resumeState })); } finally { db.close(); }
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(database);
  const fresh = new Legion({ ...f.options, session: "fresh" }), evidence = { ...f.evidence, session: "fresh" };
  try {
    const result = await fresh.command({ text: `resume ${before.id}`, requestKey: "damaged-resume", evidence });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.match(result.message, damage === "missing-root" ? /root\/history is missing/ : /recovery is unavailable/);
    assert.equal((await fresh.state()).snapshot, null);
    assert.deepEqual(await readFile(database), bytes, "No malformed-state repair or receipt/attachment mutation");
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});

test("unavailable unrelated checkout history is preserved without globally blocking a new checkout-local run", async () => {
  const f = await fixture(), otherRoot = await mkdtemp(join(tmpdir(), "resume-unrelated-"));
  const other = new Legion({ ...f.options, context: otherRoot, session: "other" });
  const otherEvidence = { ...f.evidence, session: "other" };
  const fresh = new Legion({ ...f.options, session: "independent" }), evidence = { ...f.evidence, session: "independent" };
  try {
    assert.equal((await other.command({ text: "on", requestKey: "other-on", evidence: otherEvidence })).kind, "applied");
    const savedOther = (await other.state()).snapshot; assert.ok(savedOther);
    await other.command({ text: "off", requestKey: "other-off", evidence: otherEvidence });
    await writeFile(join(otherRoot, ".git"), "gitdir: /unavailable/fixture/git-directory\n");
    assert.equal((await fresh.command({ text: "on", requestKey: "independent-on", evidence })).kind, "applied");
    assert.notEqual((await fresh.state()).snapshot?.id, savedOther.id);
    const refused = await other.command({ text: `resume ${savedOther.id}`, requestKey: "unavailable-own-history", evidence: otherEvidence });
    assert.equal(refused.kind, "rejected", "An explicit resume still refuses this inaccessible checkout rather than replacing its history");
  } finally {
    await fresh.command({ text: "off", requestKey: "cleanup", evidence });
    await other.command({ text: "off", requestKey: "cleanup", evidence: otherEvidence });
    await rm(otherRoot, { recursive: true, force: true }); await f.cleanup();
  }
});

for (const damage of ["corrupt-route", "missing-snapshot"] as const) test(`fresh activation cannot skip exact current checkout ${damage}`, async () => {
  const f = await fixture();
  const { readdir } = await import("node:fs/promises");
  if (damage === "missing-snapshot") await rm(join(f.options.storagePath, `v1.${f.saved.id}.sqlite`));
  else {
    const route = (await readdir(f.options.storagePath)).find(name => name.endsWith(`.${f.saved.id}.initial.route`)); assert.ok(route);
    await writeFile(join(f.options.storagePath, route), "{invalid-current-route");
  }
  const fresh = new Legion({ ...f.options, session: "fresh" }), evidence = { ...f.evidence, session: "fresh" };
  try {
    assert.equal((await fresh.command({ text: "on", requestKey: "no-fallback", evidence })).kind, "rejected");
    assert.equal((await fresh.state()).snapshot, null);
  } finally { await fresh.command({ text: "off", requestKey: "cleanup", evidence }); await f.cleanup(); }
});
