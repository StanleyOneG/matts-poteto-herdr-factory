import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion, type LegionOptions } from "../src/intake.js";

async function fixture(extra: Partial<LegionOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "legion-profile-"));
  const options = { storagePath: join(root, "state"), context: root, session: "emperor-session", preflight: async () => [], ...extra };
  const legion = new Legion(options);
  const evidence = { origin: "emperor", transport: "interactive", session: options.session, generation: null, presented: [] };
  let sequence = 0;
  const command = (text: string, requestKey = `command-${++sequence}`) => legion.command({ text, requestKey, evidence });
  const cleanup = async () => { await command("off"); await rm(root, { recursive: true, force: true }); };
  return { legion, options, evidence, command, cleanup };
}

test("explicit poteto commands persist profile and exact instructions; resume preserves and independent runs start off", async () => {
  const f = await fixture();
  let resumed: Legion | undefined;
  let independent: Legion | undefined;
  try {
    await f.command("on");
    assert.deepEqual((await f.legion.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    const enabled = await f.command("poteto-mode=on  Keep this\nexact text  ");
    assert.equal(enabled.kind, "saved");
    const view = await f.legion.state();
    assert.deepEqual(view.snapshot?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
    assert.equal(view.snapshot?.submissions[0]?.text, " Keep this\nexact text  ");
    assert.deepEqual(view.snapshot?.submissions[0]?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
    assert.ok(view.snapshot);
    await f.command("off");
    resumed = new Legion({ ...f.options, session: "resumed-session" });
    await resumed.command({ text: `resume ${view.snapshot.id}`, requestKey: "resume", evidence: { ...f.evidence, session: "resumed-session" } });
    assert.deepEqual((await resumed.state()).snapshot?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
    await resumed.command({ text: "poteto-mode=off", requestKey: "disable", evidence: { ...f.evidence, session: "resumed-session" } });
    assert.deepEqual((await resumed.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    assert.equal((await resumed.state()).snapshot?.submissions.length, 1);
    await resumed.command({ text: "off", requestKey: "stop", evidence: { ...f.evidence, session: "resumed-session" } });
    independent = new Legion({ ...f.options, session: "independent-session" });
    await independent.command({ text: "on", requestKey: "new", evidence: { ...f.evidence, session: "independent-session" } });
    const fresh = await independent.state();
    assert.notEqual(fresh.snapshot?.id, view.snapshot.id);
    assert.deepEqual(fresh.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
  } finally {
    for (const [legion, session] of [[resumed, "resumed-session"], [independent, "independent-session"]] satisfies Array<[Legion | undefined, string]>) {
      await legion?.command({ text: "off", requestKey: "cleanup", evidence: { ...f.evidence, session } });
    }
    await f.cleanup();
  }
});

test("implement-spec=on records explicit Matt invocation without toggling poteto or claiming native dispatch", async () => {
  const f = await fixture();
  try {
    await f.command("poteto-mode=on Work independently");
    const result = await f.command("implement-spec=on  Follow approved spec #1\nexactly  ");
    assert.equal(result.kind, "saved");
    if (result.kind !== "saved") assert.fail("Expected durable input");
    assert.match(result.receipt.message, /not dispatched/i);
    const view = await f.legion.state();
    assert.deepEqual(view.snapshot?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "implement-spec" });
    const input = view.snapshot?.submissions[1];
    assert.equal(input?.text, " Follow approved spec #1\nexactly  ");
    assert.deepEqual(input?.workflowInvocation, { kind: "legion-command", command: "implement-spec=on" });
    assert.deepEqual(input?.workflowDispatch, { kind: "pending-native" });
    await f.command("poteto-mode=off");
    assert.deepEqual((await f.legion.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "implement-spec" });
  } finally { await f.cleanup(); }
});

test("reserved profile/workflow syntax rejects malformed payloads without turning them into tasks", async () => {
  const f = await fixture();
  try {
    for (const text of ["poteto-mode=on", "poteto-mode=on   ", "poteto-mode=off extra", "poteto-mode=maybe instructions", "implement-spec=on", "implement-spec=off"]) {
      const result = await f.command(text);
      assert.equal(result.kind, "rejected", text);
      assert.equal((await f.legion.state()).snapshot, null, text);
      if (result.kind === "rejected") assert.match(result.message, /poteto-mode=on.*poteto-mode=off.*implement-spec=on/);
    }
    await f.command("task poteto-mode=on /implement-spec is only literal task text");
    const view = await f.legion.state();
    assert.deepEqual(view.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    assert.equal(view.snapshot?.submissions[0]?.text, "poteto-mode=on /implement-spec is only literal task text");
  } finally { await f.cleanup(); }
});

test("only trusted explicit invocation provenance selects Matt; prose and classifier choices do not", async () => {
  const f = await fixture();
  try {
    await f.command("Please use /implement and /implement-spec; poteto-mode=on is mentioned in prose");
    assert.deepEqual((await f.legion.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    const initial = await f.legion.state(), source = initial.snapshot?.submissions[0];
    assert.ok(source);
    const interpreted = await f.legion.submit({ kind: "interpretation", requestKey: "classifier", proposal: {
      kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Work on the task", acceptance: [], questions: [],
      workflowChoice: { profile: "poteto-mode", requestedWorkflow: "implement-spec" },
    }, evidence: { session: f.options.session, generation: initial.snapshot?.generation, legatus: initial.snapshot?.id, run: "classifier-run", sources: [{ id: source.id, revision: 1 }] } });
    assert.equal(interpreted.kind, "applied");
    assert.deepEqual((await f.legion.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    for (const text of ["poteto-mode=on Work", "poteto-mode=off", "implement-spec=on Work", "task Work"]) {
      const denied = await f.legion.command({ text, requestKey: `denied-${text}`, evidence: { ...f.evidence, origin: "extension", transport: "extension" }, workflowInvocation: text === "task Work" ? { kind: "native-skill", workflow: "implement" } : undefined });
      assert.equal(denied.kind, "rejected");
    }
    const stale = await f.legion.command({ text: "poteto-mode=on Work", requestKey: "stale", evidence: { ...f.evidence, generation: 999 } });
    assert.equal(stale.kind, "rejected");
    assert.deepEqual((await f.legion.state()).snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" });
    const result = await f.legion.command({ text: "task Explicit native skill instructions", requestKey: "native", evidence: f.evidence, workflowInvocation: { kind: "native-skill", workflow: "implement" } });
    assert.equal(result.kind, "saved");
    const explicit = await f.legion.state();
    assert.deepEqual(explicit.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "implement" });
    assert.deepEqual(explicit.snapshot?.submissions[1]?.workflowInvocation, { kind: "native-skill", workflow: "implement" });
    assert.deepEqual(explicit.snapshot?.submissions[1]?.workflowDispatch, { kind: "pending-native" });
  } finally { await f.cleanup(); }
});

for (const point of ["before-commit", "after-commit"] satisfies Array<import("../src/snapshot.js").StorageFaultPoint>) {
  test(`poteto choice and instructions commit together across ${point} failure and same-key replay`, async () => {
    let armed = false;
    const f = await fixture({ storageFault: current => {
      if (armed && current === point) { armed = false; throw new Error("Controlled storage interruption"); }
    } });
    try {
      await f.command("on");
      armed = true;
      const interrupted = await f.command("poteto-mode=on Exact instructions", "atomic");
      assert.equal(interrupted.kind, "uncertain");
      const view = await f.legion.state();
      assert.deepEqual(view.snapshot?.workflowChoice, { profile: point === "before-commit" ? "matt" : "poteto-mode", requestedWorkflow: "unknown" });
      assert.equal(view.snapshot?.submissions.length, point === "before-commit" ? 0 : 1);
      const replay = await f.command("poteto-mode=on Exact instructions", "atomic");
      assert.equal(replay.kind, "saved");
      const saved = await f.legion.state();
      assert.deepEqual(saved.snapshot?.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
      assert.equal(saved.snapshot?.submissions.length, 1);
      assert.equal(saved.snapshot?.submissions[0]?.text, "Exact instructions");
      assert.deepEqual(saved.snapshot?.submissions[0]?.workflowInvocation, { kind: "legion-command", command: "poteto-mode=on" });
      const conflict = await f.command("poteto-mode=on Different instructions", "atomic");
      assert.equal(conflict.kind, "rejected");
      assert.equal((await f.legion.state()).snapshot?.submissions.length, 1);
    } finally { await f.cleanup(); }
  });
}
