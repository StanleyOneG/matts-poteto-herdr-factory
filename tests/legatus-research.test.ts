import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, SnapshotStore, TaskId } from "../src/snapshot.js";
import { exerciseOrdinaryLegatusResearch } from "./support/composed-transport.mjs";
import { Legion } from "../src/intake.js";

const evidence = { origin: "emperor", transport: "rpc", session: "research-principal", generation: null, presented: [] };
async function fixture() {
  const storagePath = await mkdtemp(join(tmpdir(), "legatus-research-"));
  const options = { storagePath, context: "/disposable/research", session: evidence.session, preflight: async () => [] };
  const legion = new Legion(options);
  const command = (text: string) => legion.command({ text, requestKey: randomUUID(), evidence });
  return { legion, options, command };
}

test("retired research syntax does not activate or stage work; explicit task research remains intake", async () => {
  const { legion, command } = await fixture();
  for (const text of ["research", "research Find the public seam"]) {
    const result = await command(text);
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.match(result.message, /native pi-subagents/i);
    assert.equal((await legion.state()).snapshot, null);
  }
  assert.equal((await command("on")).kind, "applied");
  const before = await legion.state();
  assert.equal((await command("research Find the public seam")).kind, "rejected");
  assert.deepEqual(await legion.state(), before, "No durable research controller or fabricated task");
  assert.equal((await command("task research Find the public seam")).kind, "saved");
  const view = await legion.state();
  assert.equal(view.snapshot?.submissions[0]?.text, "research Find the public seam");
  assert.deepEqual(view.snapshot?.researchRequests, []);
  assert.deepEqual(view.snapshot?.research, []);
  await command("off");
});

for (const kind of ["requested", "dispatched", "prepared"] as const) {
  test(`legacy ${kind} research request remains an unchanged visible hold across observation and off`, async () => {
    const { legion, options, command } = await fixture();
    const snapshot = createSnapshot({ id: randomUUID(), context: options.context });
    snapshot.generation = 1;
    snapshot.attachments.push({ session: options.session, generation: 1 });
    const owner = { role: "legatus" as const, owner: snapshot.id, session: options.session, generation: 1, epoch: 0 };
    snapshot.researchRequests.push({ id: randomUUID(), task: "Historical research", owner,
      state: kind === "requested" ? { kind } : { kind, marker: "Historical dispatch marker" } });
    await new SnapshotStore(options.storagePath).save(snapshot, null, () => true);
    const view = await legion.state();
    assert.equal(view.mode, "stopping", "Missing retired-controller settlement cannot mean inactive");
    assert.deepEqual(view.snapshot, snapshot);
    for (const text of ["status", `status ${snapshot.id}`, "doctor", "off"]) {
      const result = await command(text);
      assert.equal(result.kind, "observed");
      if (result.kind !== "observed") assert.fail("Expected read-only state");
      assert.equal(result.view.mode, "stopping");
      assert.deepEqual(result.view.snapshot, snapshot, "Observation/off cannot repair legacy stages");
    }
    assert.deepEqual((await new Legion(options).state()).snapshot, snapshot);
  });
}

for (const legacyHold of [false, true]) test(`ordinary Legatus research keeps native notices, model wakes, input/configuration and permission denial unchanged (${legacyHold ? "retained legacy hold" : "no legacy work"})`, async () => {
  const outcomes = await exerciseOrdinaryLegatusResearch(legacyHold);
  for (const outcome of outcomes) {
    assert.ok(outcome.retired.some((message: string) => /native pi-subagents/i.test(message)));
    assert.equal(outcome.contextResult, undefined, "Native completion content is not replaced");
    assert.equal(outcome.wakeStarted, true, "Native completion wake reaches the ordinary model turn");
    assert.equal(outcome.loader.isError ?? false, false);
    assert.equal(outcome.launched.isError ?? false, false);
    assert.deepEqual(outcome.launched.details.requiredExtensions, [], "Legatus research installs no mandatory child guard");
    assert.equal(outcome.refused.isError, true);
    assert.match(outcome.refused.content.map(part => part.text).join("\n"), /Ordinary native permission denial/);
    assert.deepEqual(outcome.nativeInputs, [{}, { agent: "scout", task: "Find the API", model: "configured/native", tools: ["read"], extensionBindings: { "unrelated/1": { value: "preserved" } } }], "Denial never reaches native execute; admitted input is unchanged");
    if (legacyHold && outcome.command !== "on") assert.equal(z.object({ mode: z.literal("stopping") }).safeParse(outcome.after).success, true);
    assert.deepEqual(outcome.after, outcome.before, "Direct native research is not automatically owned, persisted or settled by Legion");
  }
});

test("legacy research evidence survives read/write and retired protocol submissions cannot adopt or settle it", async () => {
  const { legion, options, command } = await fixture();
  const snapshot = createSnapshot({ id: randomUUID(), context: options.context });
  snapshot.generation = 1;
  snapshot.attachments.push({ session: options.session, generation: 1 });
  const owner = { role: "legatus" as const, owner: snapshot.id, session: options.session, generation: 1, epoch: 0 };
  const id = randomUUID();
  snapshot.researchRequests.push({ id, owner, task: "Historical research", state: { kind: "settled", marker: "Historical marker" } });
  snapshot.research.push({ id, owner, task: "Historical research", intent: { path: "/retained/intent.json", digest: "historical-digest" },
    sequence: 8, launch: { agent: "old-managed-research", extensionBindings: { "pi-legion/1": { path: "/retained/intent.json", digest: "historical-digest" } } },
    child: { id, purpose: "exploration", model: "historical/model", state: { kind: "unknown", reason: "Native outcome unavailable" },
      result: { evidence: "/retained/finding.json", source: "old-journal#finding", sha256: "historical-finding", preview: "Retained reference" }, evidence: ["/retained/intent.json", "/retained/finding.json"] } });
  await new SnapshotStore(options.storagePath).save(snapshot, null, () => true);
  assert.equal((await legion.state()).mode, "stopping");
  // Fresh explicit activation may persist intake, but must not adopt historical resources.
  assert.equal((await command("on")).kind, "applied");
  assert.equal((await command("task New bounded intake")).kind, "saved");
  const before = (await legion.state()).snapshot;
  assert.ok(before);
  assert.deepEqual(before.research, snapshot.research);
  assert.deepEqual(before.researchRequests, snapshot.researchRequests);
  assert.equal("researchOwner" in await legion.state(), false);
  for (const raw of [
    { kind: "research", owner, requestKey: id, task: "Historical research", role: "how explorer", modelIndex: 0 },
    { kind: "research-owner-check", owner, id, digest: "historical-digest", stage: "read" },
    { kind: "research-dispatch", owner, id, marker: "Historical marker" },
    { kind: "research-settled", owner, id, marker: "Historical marker" },
    { kind: "research-observation", owner, command: id, sequence: 9, children: [] },
    { kind: "research-hold", owner, reason: "New controller hold" },
  ]) {
    assert.equal((await legion.submit(raw)).kind, "rejected");
    assert.deepEqual((await legion.state()).snapshot, before);
  }
  for (const text of ["status", `status ${snapshot.id}`, "doctor", "off"]) {
    const result = await command(text);
    assert.equal(result.kind, "observed");
    if (result.kind !== "observed") assert.fail("Expected observation");
    assert.deepEqual(result.view.snapshot, before);
    if (text !== "status" && text !== "doctor") assert.equal(result.view.mode, "stopping");
  }
  assert.deepEqual((await new Legion(options).state()).snapshot, before);
});

for (const kind of ["prepared", "active", "logical-terminal", "process-terminal", "unknown", "mismatch", "launch-unresolved", "corroboration-pending"] as const) {
  test(`legacy ${kind} child retains its lifecycle distinction without a controller`, async () => {
    const { legion, options, command } = await fixture();
    const snapshot = createSnapshot({ id: randomUUID(), context: options.context });
    snapshot.generation = 1;
    snapshot.attachments.push({ session: options.session, generation: 1 });
    const owner = { role: "legatus" as const, owner: snapshot.id, session: options.session, generation: 1, epoch: 0 };
    const id = randomUUID();
    const identity = { run: "historical-run", index: 0, session: "historical-child" };
    const state = kind === "active" ? { kind, ...identity }
      : kind === "logical-terminal" ? { kind, ...identity, outcome: "complete" }
      : kind === "process-terminal" ? { kind, ...identity, outcome: "complete", proof: "/retained/process-proof.json" }
      : kind === "prepared" || kind === "launch-unresolved" ? { kind }
      : { kind, reason: "Historical unresolved evidence" };
    snapshot.researchRequests.push({ id, owner, task: "Historical research", state: { kind: "settled", marker: "Historical marker" } });
    snapshot.research.push({ id, owner, task: "Historical research", intent: { path: "/retained/intent.json", digest: "historical-digest" }, sequence: 7, launch: { agent: "old-research" },
      child: { id, purpose: "exploration", model: "historical/model", state, result: null, evidence: ["/retained/intent.json"] } });
    await new SnapshotStore(options.storagePath).save(snapshot, null, () => true);
    const mode = kind === "prepared" || kind === "process-terminal" ? "inactive" : "stopping";
    for (const text of ["status", `status ${snapshot.id}`, "doctor", "off"]) {
      const result = await command(text);
      if (result.kind !== "observed") assert.fail("Expected observation");
      assert.equal(result.view.mode, mode);
      assert.deepEqual(result.view.snapshot, snapshot, "No history stripping or terminal promotion");
    }
    assert.deepEqual((await legion.state()).snapshot, snapshot);
  });
}

for (const kind of ["outstanding", "unknown"] as const) {
  test(`legacy ${kind} effects and engineering records remain readable with a visible status-by-ID hold`, async () => {
    const { legion, options, command } = await fixture();
    const snapshot = createSnapshot({ id: randomUUID(), context: options.context });
    snapshot.generation = 1;
    snapshot.attachments.push({ session: options.session, generation: 1 });
    const pin = { owner: snapshot.id, session: options.session, generation: 1, epoch: 0,
      task: { id: TaskId.parse(randomUUID()), revision: 1 }, scope: "Historical scope", reservation: randomUUID(), assignment: randomUUID(),
      launch: randomUUID(), workerSession: "historical-worker", workerGeneration: randomUUID(), addressDigest: "historical-address" };
    const engineering = { id: randomUUID(), pin, proposal: { kind: "seam" as const, seam: "Historical public seam", behaviors: ["Old behavior"], verification: "Historical check" }, digest: "historical-decision", requestEvidence: "/retained/proposal.json", state: { kind: "open" as const } };
    snapshot.engineering.push(engineering);
    const intent = { id: randomUUID(), pin, decision: { id: engineering.id, digest: engineering.digest, command: randomUUID() },
      call: { id: "historical-write", name: "write" as const, input: { path: "old.txt", content: "Historical write" }, journal: "historical-journal#write" },
      contract: { verification: { kind: "pending" as const, message: "Historical incomplete reads" },
        compatibility: "Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review." as const,
        kind: "loading" as const, cwd: "/historical/workspace", precedence: "Matt TDD is primary; pstack supplements it. No self-authorized exceptions." as const,
        resources: [], diagnostics: [] } };
    snapshot.effects.push({ intent, digest: createHash("sha256").update(JSON.stringify(intent)).digest("hex"),
      state: kind === "outstanding" ? { kind } : { kind, reason: "Historical native outcome unavailable", evidence: "/retained/unknown.json" } });
    await new SnapshotStore(options.storagePath).save(snapshot, null, () => true);
    for (const text of ["status", `status ${snapshot.id}`, "doctor", "off"]) {
      const result = await command(text);
      if (result.kind !== "observed") assert.fail("Expected observation");
      assert.equal(result.view.mode, "stopping", `Unsettled effects cannot mean inactive in ${text}; ${result.view.unavailable ?? ""}`);
      assert.deepEqual(result.view.snapshot, snapshot);
    }
    assert.equal((await command("on")).kind, "applied");
    assert.equal((await command("task Fresh bounded intake")).kind, "saved");
    await command("off");
    const reopened = await new Legion(options).state();
    assert.equal(reopened.mode, "stopping");
    assert.deepEqual(reopened.snapshot?.engineering, snapshot.engineering);
    assert.deepEqual(reopened.snapshot?.effects, snapshot.effects);
    assert.deepEqual((await legion.state()).snapshot?.effects, snapshot.effects);
  });
}
