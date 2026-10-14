import type { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { correctionDigest, CorrectionId, SubmissionRef, CorrectionAuthorization, CorrectionBinding } from "../src/snapshot.js";
import { CorrectionDelivery } from "../src/tribunus.js";
import { join } from "node:path";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { correctionFixture } from "./support/tribunus-corrections.mjs";

type Fixture = Awaited<ReturnType<typeof correctionFixture>>;
function request(f: Fixture) {
  const content = { id: randomUUID(), source: { id: randomUUID(), revision: 1 }, task: f.assignment.task,
    instruction: "Keep the approved label; correct only its spacing.", authorization: { kind: "technical" }, previous: null, binding: { pin: f.pin, address: f.address } };
  const parsed = { ...content, id: CorrectionId.parse(content.id), source: SubmissionRef.parse(content.source), authorization: CorrectionAuthorization.parse(content.authorization), binding: CorrectionBinding.parse(content.binding) };
  return CorrectionDelivery.parse({ ...parsed, digest: correctionDigest(parsed) });
}

test("native correction queues without steering and receipts only the durable user entry after safe settlement", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f);
    assert.equal((await f.host.correct({ request: correction })).state.kind, "queued");
    assert.equal(f.sends.length, 2, "Assignment remains uninterrupted");
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "queued");
    await f.runtime.settle(false, "Worker report is not correction compliance");
    await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn);
    assert.equal(turn.options.deliverAs, undefined);
    assert.equal(turn.options.expandPromptTemplates, false);
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "unknown", "Dispatch is not receipt");
    await f.runtime.start(turn.prompt);
    const delivered = await f.host.observeCorrection({ request: correction });
    assert.equal(delivered.state.kind, "delivered");
    if (delivered.state.kind !== "delivered") throw new Error("Expected native receipt");
    const continuation = { id: correction.id, digest: correction.digest };
    assert.deepEqual(await f.host.observeCorrection({ request: correction, continuation }), delivered, "Only the genuine active native correction turn can qualify continuation");
    await assert.rejects(f.host.observeCorrection({ request: correction, continuation: { ...continuation, digest: "foreign" } }), /current native correction turn/);
    const receipt = delivered.state.receipt;
    const entry = readFileSync(receipt.journal, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).find(entry => entry.id === receipt.entry);
    assert.equal(entry.message.role, "user");
    assert.equal(entry.message.content[0].text, turn.prompt);
    await f.runtime.settle(false, "I applied it — not authoritative verification");
    await assert.rejects(f.host.observeCorrection({ request: correction, continuation }), /current native correction turn/, "A completed prior correction turn cannot qualify new work");
    assert.deepEqual(await f.host.correct({ request: correction }), delivered);
    assert.equal(f.sends.length, 3);
  } finally { await f.close(); }
});

test("same-ID native correction replay observes once and rejects conflicting authenticated payloads", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f);
    const [first, second] = await Promise.all([f.host.correct({ request: correction }), f.host.correct({ request: correction })]);
    assert.equal(first.state.kind, "queued"); assert.deepEqual(second, first);
    const changed = { ...correction, instruction: "Conflicting instruction" };
    const conflict = CorrectionDelivery.parse({ ...changed, digest: correctionDigest(changed) });
    await assert.rejects(f.host.correct({ request: conflict }), /conflict/i);
    const before = inventory(f);
    await assert.rejects(f.host.observeCorrection({ request: conflict }), /conflict/i);
    assert.deepEqual(inventory(f), before, "Observation never repairs evidence");
    await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    assert.equal((await f.host.correct({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 3, "Lost user receipt never dispatches twice");
  } finally { await f.close(); }
});

test("correction authenticates exact original controller task assignment capability and worker generation", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f);
    for (const changes of [
      { capability: "wrong" },
      { request: rehashed({ ...correction, binding: { ...correction.binding, pin: { ...f.pin, assignment: randomUUID() } } }) },
      { request: rehashed({ ...correction, binding: { ...correction.binding, pin: { ...f.pin, session: "foreign-controller" } } }) },
      { request: { ...correction, task: { id: randomUUID(), revision: 1 } } },
      { request: { ...correction, binding: { ...correction.binding, address: { ...f.address, generation: randomUUID() } } } },
    ]) {
      const frame = { kind: "correct", capability: f.descriptor.capability, request: correction, ...changes };
      assert.equal((await f.frame(frame)).kind, "held");
    }
    assert.equal(f.sends.length, 2); assert.equal(inventory(f).some(([file]) => file.includes("correction")), false);
  } finally { await f.close(); }
});

function inventory(f: Fixture) { const root = join(f.actor, f.address.generation); return readdirSync(root).sort().map(file => [file, readFileSync(join(root, file), "utf8")] satisfies [string, string]); }
function rehashed(value: z.infer<typeof CorrectionDelivery>) { return CorrectionDelivery.parse({ ...value, digest: correctionDigest(value) }); }

test("lost correction receipt or transition stays unknown and never repairs or resends", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f);
    await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "delivered");
    const receiptPath = join(f.actor, f.address.generation, `${correction.id}.correction-receipt.json`);
    unlinkSync(receiptPath);
    const missing = inventory(f);
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.deepEqual(inventory(f), missing);
    await f.runtime.settle();
    assert.equal(existsSync(receiptPath), false, "Later native settlement cannot recreate lost receipts");
    assert.equal((await f.host.correct({ request: correction })).state.kind, "unknown");
    unlinkSync(join(f.actor, f.address.generation, `${correction.id}.correction-transition.json`));
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 3);
  } finally { await f.close(); }
});

test("never-dispatched queued correction terminalizes positively on retirement without competing with dispatch", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f);
    await f.host.correct({ request: correction });
    await f.control({ kind: "stop", command: randomUUID(), currentCommand: f.command });
    const observed = await f.host.observeCorrection({ request: correction });
    assert.equal(observed.state.kind, "not-delivered");
    if (observed.state.kind !== "not-delivered") throw new Error("Expected positive exact intent evidence");
    assert.ok(observed.state.evidence.every(path => existsSync(path)));
    await f.runtime.settle();
    assert.deepEqual(await f.host.correct({ request: correction }), observed);
    assert.equal(f.sends.length, 2, "Retirement never delivers the correction");
  } finally { await f.close(); }
});

test("correction receipt preserves old assignment authority when approved target revision advances", async () => {
  const f = await correctionFixture();
  try {
    const correction = rehashed({ ...request(f), task: { ...f.assignment.task, revision: 2 }, authorization: CorrectionAuthorization.parse({ kind: "amendment", amendment: randomUUID() }) });
    const assignmentBefore = readFileSync(join(f.actor, f.address.generation, `${f.command}.assignment.json`), "utf8");
    await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "delivered");
    assert.equal(readFileSync(join(f.actor, f.address.generation, `${f.command}.assignment.json`), "utf8"), assignmentBefore);
    assert.match(turn.prompt, /does not refresh scope/);
  } finally { await f.close(); }
});

test("queued correction never interrupts admitted native effects and unknown outcomes remain held", async () => {
  for (const unknown of [false, true]) {
    const f = await correctionFixture();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let writing: ReturnType<Fixture["runtime"]["call"]> | null = null;
    try {
      await f.allowEffects();
      let began = false;
      f.runtime.external(async name => { if (name !== "write") return; began = true; await gate; if (unknown) throw new Error("Native backend executed without conclusive outcome"); });
      writing = f.runtime.call("write", { path: "in-flight.txt", content: "Authorized in-flight work" });
      await f.until(() => began);
      const correction = request(f);
      assert.equal((await f.host.correct({ request: correction })).state.kind, "queued");
      assert.equal(f.sends.length, 2); assert.equal(f.admitted.length, 1);
      release(); await writing;
      await f.runtime.settle();
      if (unknown) {
        await f.until(() => f.runtime.statuses.some(status => status.text.includes("blocked")));
        assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "queued");
        assert.equal(f.sends.length, 2, "Unknown effect cannot be mistaken for a safe point");
      } else {
        await f.until(() => f.sends.length === 3);
        assert.equal(readFileSync(join(f.cwd, "in-flight.txt"), "utf8"), "Authorized in-flight work");
      }
    } finally { release(); await writing; await f.close(); }
  }
});

test("unresolved native children and pending messages hold correction delivery despite idle report prose", async () => {
  for (const blocker of ["child", "messages"]) {
    const f = await correctionFixture();
    try {
      const correction = request(f); await f.host.correct({ request: correction });
      if (blocker === "child") f.unknownChild(); else f.runtime.setPending(true);
      await f.runtime.settle(false, "Children and work are done — this prose proves nothing");
      const before = inventory(f);
      assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "queued");
      assert.equal(f.sends.length, 2); assert.deepEqual(inventory(f), before);
    } finally { await f.close(); }
  }
});

test("explicit authenticated controller adoption permits read-only historical observation but not new correction authority", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f); await f.host.correct({ request: correction });
    const resumed = { ...f.authority, session: "explicit-resumed-legatus", generation: 2 };
    const host = new LocalTribunusHost(async () => { throw new Error("Observe cannot execute"); }, resumed);
    const absent = await host.observeCorrection({ request: correction }); assert.equal(absent.state.kind, "unknown");
    assert.equal((await f.adopt(resumed)).kind, "ok", "Existing authenticated control produces adoption evidence");
    const observed = await host.observeCorrection({ request: correction });
    assert.equal(observed.state.kind, "not-delivered", "Original never-dispatched queue cannot transfer to resumed authority");
    const before = inventory(f);
    assert.deepEqual(await host.observeCorrection({ request: correction }), observed); assert.deepEqual(inventory(f), before);
    await assert.rejects(host.correct({ request: correction }), /exact original current controller/);
    const foreign = new LocalTribunusHost(async () => { throw new Error("Observe cannot execute"); }, { ...resumed, owner: randomUUID() });
    assert.equal((await foreign.observeCorrection({ request: correction })).state.kind, "unknown");
    const mismatch = new LocalTribunusHost(async () => { throw new Error("Observe cannot execute"); }, { ...resumed, session: "unadopted-session" });
    assert.equal((await mismatch.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 2);
  } finally { await f.close(); }
});

test("fresh host observes durable native receipt after connection loss without replay or generation retarget", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f); await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    const delivered = await f.host.observeCorrection({ request: correction }); assert.equal(delivered.state.kind, "delivered");
    await f.close();
    process.env.PI_CODING_AGENT_DIR = f.profile;
    const host = new LocalTribunusHost(async () => { throw new Error("Observation cannot launch"); }, f.authority);
    assert.deepEqual(await host.observeCorrection({ request: correction }), delivered);
    const helloPath = join(f.actor, "hello.json"), hello = JSON.parse(readFileSync(helloPath, "utf8"));
    writeFileSync(helloPath, JSON.stringify({ ...hello, address: { ...f.address, generation: randomUUID() } }), { mode: 0o600 });
    assert.equal((await host.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 3);
  } finally { await f.close(); }
});

test("same-worker correction queue holds later IDs through uncertain receipt and releases only after exact evidence returns", async () => {
  const f = await correctionFixture();
  try {
    const first = request(f); await f.host.correct({ request: first }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    const path = join(f.actor, f.address.generation, `${first.id}.correction-receipt.json`), receipt = readFileSync(path, "utf8");
    unlinkSync(path); await f.runtime.settle();
    const next = request(f); assert.equal((await f.host.correct({ request: next })).state.kind, "queued");
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("earlier dispatch")));
    assert.equal(f.sends.length, 3);
    const before = inventory(f); assert.equal((await f.host.observeCorrection({ request: first })).state.kind, "unknown"); assert.deepEqual(inventory(f), before);
    writeFileSync(path, receipt, { mode: 0o600 });
    assert.equal((await f.host.observeCorrection({ request: first })).state.kind, "delivered");
    assert.equal(f.sends.length, 3, "Read-only reconciliation cannot trigger turns");
    await f.runtime.start("Ordinary native notification after receipt reconciliation"); await f.runtime.settle();
    await f.until(() => f.sends.length === 4);
    const following = f.sends[3]; assert.ok(following); assert.match(following.prompt, new RegExp(next.id));
  } finally { await f.close(); }
});

test("retirement cannot turn dispatched correction uncertainty into positive non-delivery", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f); await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    await f.control({ kind: "stop", command: randomUUID(), currentCommand: f.command });
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.equal((await f.host.correct({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 3);
  } finally { await f.close(); }
});

test("missing correction evidence cannot prevent existing safe-stop retirement from settling", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f); await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    unlinkSync(join(f.actor, f.address.generation, `${correction.id}.correction-transition.json`));
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    await f.control({ kind: "stop", command: randomUUID(), currentCommand: f.command });
    await f.runtime.settle();
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("parked")));
    assert.equal((await f.host.observeCorrection({ request: correction })).state.kind, "unknown");
    assert.equal(f.sends.length, 3);
  } finally { await f.close(); }
});

test("authenticated resumed observation preserves original delivered receipt and rejects stale controller claims", async () => {
  const f = await correctionFixture();
  try {
    const correction = request(f); await f.host.correct({ request: correction }); await f.runtime.settle(); await f.until(() => f.sends.length === 3);
    const turn = f.sends[2]; assert.ok(turn); await f.runtime.start(turn.prompt);
    const delivered = await f.host.observeCorrection({ request: correction }); assert.equal(delivered.state.kind, "delivered");
    const resumed = { ...f.authority, session: "resumed-after-delivery", generation: 2 };
    assert.equal((await f.adopt(resumed)).kind, "ok");
    const host = new LocalTribunusHost(async () => { throw new Error("Observation only"); }, resumed);
    const before = inventory(f);
    assert.deepEqual(await host.observeCorrection({ request: correction }), delivered);
    assert.deepEqual(inventory(f), before); assert.equal(f.sends.length, 3);
    const stale = new LocalTribunusHost(async () => { throw new Error("Observation only"); }, { ...f.authority, session: "stale-unadopted-session" });
    assert.equal((await stale.observeCorrection({ request: correction })).state.kind, "unknown");
  } finally { await f.close(); }
});
