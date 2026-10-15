import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { deliveryFixture, acceptedResult, deliveryControl, observeFinalGit } from "./support/delivery-fixture.js";
import type { DeliveryAdapter } from "../src/delivery-domain.js";

const tracker = { provider: "fixture", project: "project-one", id: "39" };
const configuration = { provider: "fixture", project: "project-one", revision: "v1" };
test("stale provider configuration and #37 affected-scope holds cannot dispatch accepted-result closure", async () => {
  const f = await deliveryFixture();
  try {
    await acceptedResult(f);
    await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker } });
    let effects = 0;
    const adapter: DeliveryAdapter = { configuration, execute: async ({ intent, assertAuthority }) => {
      await assertAuthority(); effects++; return { kind: "confirmed", operation: intent.id, digest: intent.digest, reference: "tracker:39", evidence: ["receipt"] };
    }, reconcile: async () => { throw new Error("No read proof"); } };
    f.options.delivery = { adapter: () => adapter };
    const id = randomUUID(); await deliveryControl({ f, action: { kind: "prepare-closure", id, task: f.task } });
    adapter.configuration = { ...configuration, revision: "v2" };
    await f.legion.command({ deliveryRequest: id });
    assert.equal(effects, 0);
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "pending");
    adapter.configuration = configuration;
    await f.command(`correction ${f.task.id}@1 Changed acceptance needs Emperor decision`);
    const source = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
    await f.interpret({ kind: "propose-amendment", source: { id: source.id, revision: 1 }, affected: [f.task], category: "acceptance", change: "Change criterion", question: "Approve?", recommendation: "Ask Emperor" });
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "held");
    await f.legion.command({ deliveryRequest: id });
    assert.equal(effects, 0);
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", id: randomUUID(), task: f.task } })).kind, "rejected");
  } finally { await f.command("off"); }
});

test("mismatched execution and read-only reconciliation receipts remain unknown and never repeat publication", async () => {
  const f = await deliveryFixture();
  try {
    await acceptedResult(f);
    let effects = 0;
    f.options.delivery = { adapter: () => ({ configuration, observeFinal: observeFinalGit,
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); effects++; return { kind: "confirmed", operation: randomUUID(), digest: intent.digest, evidence: ["wrong-operation"], reference: "report:wrong" }; },
      reconcile: async ({ intent }) => ({ kind: "confirmed", operation: intent.id, digest: "0".repeat(64), evidence: ["wrong-proof"], reference: "report:wrong" }),
    }) };
    const captured = await deliveryControl({ f, action: { kind: "capture-final", specification: "direct:task", tasks: [f.task], requiredChecks: ["focused"] } }); assert.ok(captured.kind === "final-delivery-stage");
    const final = { id: captured.final.id, digest: captured.final.digest }, id = randomUUID();
    const prepared = await deliveryControl({ f, action: { kind: "prepare-publication", id, final, publication: { kind: "local-report" } } }); assert.equal(prepared.kind, "delivery-stage");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id, final, publication: { kind: "local-report" } } })).kind, "delivery-stage", "unchanged preparation is idempotent");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id, final, publication: { kind: "draft" } } })).kind, "rejected", "operation IDs cannot be repurposed");
    await f.legion.command({ deliveryRequest: id });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "unknown");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final, publication: { kind: "local-report" } } })).kind, "rejected");
    await f.legion.command({ deliveryRequest: id });
    await deliveryControl({ f, action: { kind: "reconcile", id } });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "unknown");
    assert.equal(effects, 1);
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
  } finally { await f.command("off"); }
});

test("closed tracker prose cannot create acceptance; final scopes reject duplicate, unknown, stale and foreign task identities", async () => {
  const f = await deliveryFixture();
  try {
    assert.equal((await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker: { ...tracker, state: "closed" } } })).kind, "rejected");
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "not-captured");
    await acceptedResult(f);
    f.options.delivery = { adapter: () => ({ configuration, observeFinal: observeFinalGit,
      execute: async () => { throw new Error("Not dispatched"); }, reconcile: async () => { throw new Error("Not dispatched"); },
    }) };
    for (const tasks of [[f.task, f.task], [{ id: randomUUID(), revision: 1 }], [{ ...f.task, revision: 2 }]]) {
      assert.equal((await deliveryControl({ f, action: { kind: "capture-final", specification: "spec:1", tasks, requiredChecks: ["focused"] } })).kind, "rejected");
    }
    const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
    assert.equal((await f.legion.submit({ kind: "delivery-control", action: { kind: "capture-final", specification: "spec:1", tasks: [f.task], requiredChecks: ["focused"] }, evidence: { session: "foreign", generation: snapshot.generation, legatus: snapshot.id, run: "foreign" } })).kind, "rejected");
    assert.equal((await f.legion.state()).snapshot?.finalDeliveries.length, 0);
  } finally { await f.command("off"); }
});

test("new failing final evidence invalidates standalone review reuse even when Git content is unchanged", async () => {
  const f = await deliveryFixture();
  try {
    await acceptedResult(f);
    f.options.delivery = { adapter: () => ({ configuration, observeFinal: observeFinalGit,
      execute: async () => { throw new Error("Failed checks must not publish"); }, reconcile: async () => { throw new Error("unused"); },
    }) };
    const captured = await deliveryControl({ f, action: { kind: "capture-final", specification: "direct:task", tasks: [f.task], requiredChecks: ["focused"] } }); assert.ok(captured.kind === "final-delivery-stage");
    assert.equal(captured.review.kind, "reused-result-review");
    const final = { id: captured.final.id, digest: captured.final.digest };
    const failed = await deliveryControl({ f, action: { kind: "verify-final", final, verification: { checks: [{ name: "focused", outcome: "failed", evidence: ["new-failure.log"] }], exceptions: [] } } }); assert.ok(failed.kind === "final-delivery-stage");
    assert.equal(failed.review.kind, "review-required");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final, publication: { kind: "local-report" } } })).kind, "rejected");
  } finally { await f.command("off"); }
});
