import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Legion } from "../src/intake.js";
import { deliveryFixture, acceptedResult, deliveryControl } from "./support/delivery-fixture.js";
import type { DeliveryAdapter } from "../src/delivery-domain.js";

const configuration = { provider: "fixture", project: "project-one", revision: "v1" };
const tracker = { provider: "fixture", project: "project-one", id: "39" };
test("retained delivery reconciles after stopping and actual process restart without execution revival", async () => {
  const evidence = process.env.DELIVERY_RESTART_EVIDENCE ?? join(tmpdir(), `delivery-${randomUUID()}.json`);
  if (process.env.DELIVERY_RESTART_CHILD === "1") {
    const f = await deliveryFixture();
    await acceptedResult(f);
    await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker } });
    let effects = 0;
    f.options.delivery = { adapter: () => ({ configuration,
      execute: async ({ assertAuthority }) => { await assertAuthority(); effects++; throw new Error("Applied effect, lost receipt"); },
      reconcile: async () => { throw new Error("No read proof before restart"); },
    }) };
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", id, task: f.task } })).kind, "delivery-stage");
    await f.legion.command({ deliveryRequest: id });
    assert.equal(effects, 1);
    await f.command("off");
    const saved = (await f.legion.state()).snapshot; assert.ok(saved);
    assert.equal(saved.deliveries[0]?.state.kind, "unknown");
    assert.equal((await f.legion.command({ deliveryRequest: id })).kind, "rejected");
    writeFileSync(evidence, JSON.stringify({ root: f.root, context: f.checkout, saved, id }));
    return;
  }
  const setup = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/delivery-recovery.test.ts"], {
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, DELIVERY_RESTART_CHILD: "1", DELIVERY_RESTART_EVIDENCE: evidence }, encoding: "utf8",
  });
  assert.equal(setup.status, 0, `${setup.error ?? ""}\n${setup.stdout}\n${setup.stderr}`);
  const { root, context, saved, id } = JSON.parse(readFileSync(evidence, "utf8"));
  let reads = 0;
  const adapter: DeliveryAdapter = { configuration,
    execute: async () => { assert.fail("No execution authority after restart"); },
    reconcile: async ({ intent }) => { reads++; return { kind: "confirmed", operation: intent.id, digest: intent.digest, evidence: ["exact-operation-receipt"], reference: "tracker:39" }; },
  };
  const options = { storagePath: join(root, "state"), context, session: "controller", preflight: async () => [], delivery: { adapter: () => adapter } };
  const legion = new Legion(options);
  assert.equal((await legion.command({ deliveryRequest: id })).kind, "rejected");
  assert.equal((await legion.observeDelivery({ run: saved.id, operation: id, session: "foreign" })).kind, "rejected");
  assert.equal((await new Legion({ ...options, session: "foreign" }).observeDelivery({ run: saved.id, operation: id, session: "foreign" })).kind, "rejected");
  assert.equal(reads, 0);
  const observed = await legion.observeDelivery({ run: saved.id, operation: id, session: "controller" });
  assert.equal(observed.kind, "delivery-stage", JSON.stringify(observed));
  const state = await legion.state();
  assert.equal(state.mode, "stopping", "Read-only delivery settlement cannot waive retained worker shutdown holds");
  assert.equal(state.snapshot?.deliveries[0]?.state.kind, "confirmed");
  assert.equal(state.snapshot?.generation, saved.generation);
  assert.deepEqual(state.snapshot?.attachments, saved.attachments);
  assert.deepEqual(state.snapshot?.shutdown, saved.shutdown);
  assert.equal(reads, 1);
  assert.equal((await legion.command({ deliveryRequest: id })).kind, "rejected");
  assert.equal((await legion.submit({ kind: "delivery-control", action: { kind: "prepare-closure", id: randomUUID(), task: { id: saved.tasks[0].id, revision: 1 } }, evidence: { session: "controller", generation: saved.generation, legatus: saved.id, run: "no-revival" } })).kind, "rejected");
});
