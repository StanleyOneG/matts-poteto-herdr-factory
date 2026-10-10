import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion } from "../src/intake.js";
import { exerciseLegatusResearch } from "./support/composed-transport.mjs";

const evidence = { origin: "emperor", transport: "rpc", session: "research-principal", generation: null, presented: [] };
async function fixture() {
  const storagePath = await mkdtemp(join(tmpdir(), "legatus-research-"));
  const options = {
    storagePath, context: "/disposable/research", session: evidence.session, preflight: async () => [],
    research: { prepare: async (request: { requestKey: string; task: string }, owner: unknown) => ({
      id: request.requestKey, owner, task: request.task, intent: { path: "/retained/intent.json", digest: "fixture-digest" },
      child: { id: request.requestKey, purpose: "exploration", model: "configured/explorer", state: { kind: "prepared" }, result: null, evidence: ["/retained/intent.json"] },
      sequence: 0, launch: { agent: "native-owned-research", model: "configured/explorer", async: true },
    }) },
  };
  const legion = new Legion(options);
  const command = (text: string) => legion.command({ text, requestKey: randomUUID(), evidence });
  const request = async () => {
    const task = "Locate the public API and return bounded references";
    const stage = await command(`research ${task}`);
    assert.equal(stage.kind, "research-stage");
    if (stage.kind !== "research-stage") throw new Error("No research stage");
    const owner = (await legion.state()).researchOwner;
    await legion.submit({ kind: "research-dispatch", id: stage.requestId, owner, marker: "controlled-research-marker" });
    return { kind: "research", requestKey: stage.requestId, task, role: "how explorer", modelIndex: 0, owner };
  };
  const research = async () => legion.submit(await request());
  return { legion, options, command, research, request };
}

test("Legatus explicitly prepares bounded research without a fabricated task or Tribunus", async () => {
  const { legion, command, research } = await fixture();
  await command("on");
  const result = await research();
  assert.equal(result.kind, "research-prepared");
  const view = await legion.state();
  assert.equal(view.tasks.length, 0);
  assert.equal(view.snapshot?.research.length, 1);
  assert.equal(view.snapshot?.research[0]?.child.state.kind, "prepared");
  assert.equal(view.snapshot?.research[0]?.child.model, "configured/explorer");
  await command("off");
});

for (const scenario of ["complete", "failed", "changed-input", "role-changed", "root-denial", "child-denial", "principal-model", "reactivate"]) {
  test(`Legatus research native composition preserves ${scenario} ownership, bounded evidence and safe drain`, async () => {
    await exerciseLegatusResearch(scenario);
  });
}

for (const scenario of ["off-after-completion", "completion-during-off"]) {
  test(`Legatus research ${scenario} restores ordinary native tools and retires managed launch policy`, async () => {
    await exerciseLegatusResearch(scenario);
  });
}

test("explicit status by logical ID never hides unresolved research children after stop", async () => {
  const { legion, command, research } = await fixture();
  await command("on");
  const result = await research();
  assert.equal(result.kind, "research-prepared");
  if (result.kind !== "research-prepared") return;
  const record = result.research;
  assert.equal((await legion.submit({ kind: "research-owner-check", owner: record.owner, id: record.id, digest: record.intent.digest, stage: "launch" })).kind, "research-current");
  await command("off");
  const status = await command(`status ${record.owner.owner}`);
  assert.equal(status.kind, "observed");
  if (status.kind === "observed") assert.equal(status.view.mode, "stopping");
});

test("research refuses wrong session generation epoch, duplicate preparation and unowned observations", async () => {
  const { legion, command, request } = await fixture();
  await command("on");
  const submitted = await request();
  assert.ok(submitted.owner);
  for (const owner of [{ ...submitted.owner, session: "another-principal" }, { ...submitted.owner, generation: submitted.owner.generation + 1 }, { ...submitted.owner, epoch: submitted.owner.epoch + 1 }]) {
    const rejected = await legion.submit({ ...submitted, owner });
    assert.equal(rejected.kind, "rejected");
  }
  const prepared = await legion.submit(submitted);
  assert.equal(prepared.kind, "research-prepared");
  assert.equal((await legion.submit(submitted)).kind, "rejected");
  assert.equal((await legion.submit({ kind: "research-observation", owner: submitted.owner, command: randomUUID(), sequence: 1, children: [] })).kind, "rejected");
  assert.equal((await legion.state()).snapshot?.research.length, 1);
  await command("off");
});

test("durable research requests advance the public snapshot revision", async () => {
  const { legion, command } = await fixture();
  await command("on");
  const revision = (await legion.state()).snapshot?.revision;
  assert.ok(revision);
  assert.equal((await command("research Find the public seam")).kind, "research-stage");
  assert.equal((await legion.state()).snapshot?.revision, revision + 1);
  await command("off");
});
