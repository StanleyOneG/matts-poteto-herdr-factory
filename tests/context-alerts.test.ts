import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { exerciseNativeAssignment, exerciseNativeWorkflow } from "./support/composed-transport.mjs";

test("Legatus absolute context transitions are deduplicated follow-ups, not routine transcript telemetry", async () => {
  const result = await exerciseNativeAssignment("context-legatus");
  try {
    assert.equal(result.sent.length, 5);
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["warning", "escalation", "escalation", "escalation", "warning"]);
    for (const item of result.sent) {
      assert.deepEqual(item.options, { triggerTurn: true, deliverAs: "followUp" });
      assert.match(item.message.content, /concise progress, remaining work and child state/);
      assert.match(item.message.content, /advisory/i);
    }
    assert.equal(result.observations[4]?.legatus?.sample.kind, "unknown");
    assert.equal(result.observations[4]?.legatus?.sample.tokens, null);
    assert.equal(result.view.context.legatus?.sample.contextWindow, 1000000);
    assert.ok(result.statuses.some(item => /135000.*1000000.*fresh/.test(item.text)));
  } finally { await rm(result.root, { recursive: true, force: true }); }
});


test("assigned Tribunus context is repeatedly delivered to the Legatus independently of its final report", async () => {
  const result = await exerciseNativeAssignment("context-worker");
  try {
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["escalation", "escalation"]);
    assert.equal(result.view.tasks[0]?.launch.kind, "reported");
    const sample = Object.values(result.view.context).find(item => item.identity.includes("tribunus"))?.sample;
    assert.equal(sample?.tokens, 150000);
    assert.equal(sample?.contextWindow, 272000);
    assert.equal(result.observations[1] && Object.values(result.observations[1]).find(item => item.identity.includes("tribunus"))?.sample.kind, "unknown");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});


const endedWorkers: Array<"context-worker-switch" | "context-worker-shutdown"> = ["context-worker-switch", "context-worker-shutdown"];
for (const scenario of endedWorkers) test(`${scenario} rejects a delayed crossing without adding a worker turn or transcript entry`, async () => {
  const result = await exerciseNativeAssignment(scenario);
  try {
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["warning"]);
    const previous = Object.values(result.observations[0] ?? {}).find(item => item.identity.includes("tribunus"));
    const current = Object.values(result.view.context).find(item => item.identity.includes("tribunus"));
    assert.equal(previous?.sample.kind, "fresh");
    assert.equal(current?.sample.kind, "stale");
    assert.equal(current?.sample.tokens, 135000);
    assert.equal(result.view.tasks[0]?.launch.kind, "assigned");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("disposing a live context check contains the peer reset and cannot wake or refresh a revoked assignment", async () => {
  const result = await exerciseNativeAssignment("context-worker-disposal");
  try {
    assert.deepEqual(result.sent, [], "A canceled threshold crossing cannot wake the Legatus");
    const sample = Object.values(result.view.context).find(item => item.identity.includes("tribunus"))?.sample;
    assert.equal(sample?.kind, "stale");
    assert.equal(sample?.tokens, 1000, "Aborted context cannot replace the last known estimate");
    assert.match(sample?.reason ?? "", /Owner authority revoked/);
    assert.equal(result.view.tasks[0]?.launch.kind, "assigned", "Transport loss cannot settle or replace owned work");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("missing, stale and compaction-unknown estimates never re-arm an escalation", async () => {
  const result = await exerciseNativeAssignment("context-invalidations");
  try {
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["escalation", "escalation"]);
    assert.deepEqual(result.observations.slice(1, 7).map(item => item.legatus?.sample.kind), ["unknown", "unknown", "stale", "missing", "unknown", "stale"]);
    assert.deepEqual(result.observations.slice(1, 7).map(item => item.legatus?.sample.tokens), [null, null, null, null, null, null]);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("compaction-unknown Legatus context preserves a prepared workspace and withholds new worker assignment", async () => {
  const result = await exerciseNativeAssignment("context-block-launch");
  try {
    assert.equal(result.created, false);
    assert.equal(result.view.snapshot?.launchRequests.length, 0);
    assert.equal(result.view.tasks[0]?.launch.kind, "not-launched");
    assert.ok(result.notices.some(text => /context observation.*unresolved/i.test(text)));
    assert.equal(result.view.context.legatus?.sample.kind, "unknown");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});


test("ordinary context observations are excluded from native skill transcript state", async () => {
  const result = await exerciseNativeWorkflow("context");
  try { assert.equal(result.observations.telemetryInContext, false); }
  finally { await rm(result.root, { recursive: true, force: true }); }
});


test("effective checkout thresholds stay absolute even for a million-token principal window", async () => {
  const result = await exerciseNativeAssignment("context-low-thresholds");
  try {
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["warning", "escalation"]);
    assert.deepEqual(result.sent.map(item => item.message.details.sample.tokens), [10, 20]);
    assert.deepEqual(result.view.settings?.context, { warningTokens: 10, escalationTokens: 20 });
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("an existing native Matt assignment stays monitored when the operator changes future profiles on and off", async () => {
  const result = await exerciseNativeWorkflow("context-profile");
  try {
    assert.deepEqual(result.observations.monitoredTokens, [135000, 150000]);
    assert.deepEqual(result.observations.contextKinds, ["fresh", "fresh"]);
    assert.deepEqual(result.observations.contextAlerts, ["warning", "escalation"]);
    assert.deepEqual(result.observations.futureProfiles, ["poteto-mode", "matt"]);
    const assignment = result.view.tasks[0]?.launch;
    assert.ok(assignment && "assignment" in assignment);
    assert.equal(assignment.assignment.workflowChoice?.profile, "matt");
    assert.equal(assignment.assignment.modelPin?.profile, "matt");
    assert.deepEqual(result.observations.pinnedAssignments, [assignment.assignment, assignment.assignment]);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("a verified new Legatus ownership generation does not reuse its predecessor's threshold deduplication", async () => {
  const result = await exerciseNativeAssignment("context-owner");
  try {
    assert.deepEqual(result.sent.map(item => item.message.details.level), ["escalation", "escalation"]);
    assert.notEqual(result.observations[0]?.legatus?.identity, result.observations[1]?.legatus?.identity);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});
