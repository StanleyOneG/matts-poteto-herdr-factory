import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { exerciseNativeWorkflow } from "./support/composed-transport.mjs";

test("explicit Matt command enters its native skill with exact instructions and durable applied evidence", async () => {
  const result = await exerciseNativeWorkflow("entry");
  try {
    assert.match(result.prompt, /<skill name="implement-spec"/);
    assert.ok(result.prompt.endsWith(" Follow approved spec\nexactly  "));
    assert.equal(result.view.snapshot?.submissions[0]?.workflowDispatch?.kind, "applied-native");
    assert.ok(result.view.snapshot?.submissions[0]?.workflowDispatch && "entry" in result.view.snapshot.submissions[0].workflowDispatch);
    assert.equal(result.nativeWrite.isError ?? false, false);
    assert.equal(result.view.snapshot?.workflowChoice.profile, "matt");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("selected native Legatus scopes spec tickets and requests the existing isolated workspace and exact Matt launch", async () => {
  const result = await exerciseNativeWorkflow("launch");
  try {
    assert.equal(result.view.tasks.length, 2);
    assert.equal(result.view.tasks[0]?.launch.kind, "assigned");
    const launch = result.view.tasks[0]?.launch;
    if (launch?.kind !== "assigned") assert.fail("Expected applied native Matt assignment");
    assert.equal(launch.assignment.modelPin?.profile, "matt");
    assert.equal(launch.assignment.workflow, "implement-spec");
    assert.equal(result.view.snapshot?.workspaceRequests[0]?.evidence.origin, "host-command");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

for (const scenario of ["alias", "native-input"]) test(`explicit ${scenario} selects Matt only at the trusted public input boundary`, async () => {
  const result = await exerciseNativeWorkflow(scenario);
  try {
    assert.equal(result.view.snapshot?.workflowChoice.requestedWorkflow, scenario === "alias" ? "implement" : "implement-spec");
    assert.equal(result.view.snapshot?.submissions[0]?.workflowInvocation?.kind, "native-skill");
    assert.equal(result.view.snapshot?.submissions[0]?.workflowDispatch?.kind, "applied-native");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

for (const scenario of ["prose", "extension-source"]) test(`${scenario} cannot infer or manufacture workflow selection`, async () => {
  const result = await exerciseNativeWorkflow(scenario);
  try { assert.deepEqual(result.view.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "unknown" }); }
  finally { await rm(result.root, { recursive: true, force: true }); }
});

test("inactive alias remains ordinary native skill behavior without activating Legion", async () => {
  const result = await exerciseNativeWorkflow("inactive-alias");
  try {
    assert.match(result.prompt, /<skill name="implement"/);
    assert.equal(result.view.mode, "inactive");
    assert.equal(result.view.snapshot, null);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

for (const scenario of ["missing", "duplicate", "conflict", "sticky"]) test(`${scenario} native resources or controller hold visibly before dispatch without toggling`, async () => {
  const result = await exerciseNativeWorkflow(scenario);
  try {
    assert.equal(result.prompt, "");
    assert.equal(result.view.snapshot?.submissions.at(-1)?.workflowDispatch?.kind, "held-native");
    assert.ok(result.notices?.some(notice => /held before dispatch/.test(notice)));
    assert.equal(result.view.snapshot?.workflowChoice.profile, scenario === "conflict" ? "poteto-mode" : "matt");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("uncertain native skill delivery holds a late prompt and never replays after restart and explicit resume", async () => {
  const result = await exerciseNativeWorkflow("uncertain");
  try {
    assert.equal(result.view.snapshot?.submissions[0]?.workflowDispatch?.kind, "uncertain-native");
    assert.equal(result.observations.lateStarted, false);
    assert.equal(result.observations.replayedPrompts, 0);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("selected native workflow cannot select profiles, manufacture Emperor authority or request managed work after off", async () => {
  const result = await exerciseNativeWorkflow("authority");
  try {
    assert.deepEqual(result.observations.refusals, Array(8).fill(true));
    assert.equal(result.observations.forgedEvidenceRefused, true);
    assert.equal(result.observations.afterOffRefused, true);
    assert.deepEqual(result.view.snapshot?.workflowChoice, { profile: "matt", requestedWorkflow: "implement-spec" });
    assert.equal(result.view.snapshot?.workspaceRequests.length, 0);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("ordinary clarification answers are saved exactly and delivered into the selected skill without reselecting it", async () => {
  const result = await exerciseNativeWorkflow("clarification");
  try {
    assert.equal(result.observations.answerText, " Yes, label Ready.  ");
    assert.equal(result.observations.answerInvocation, null);
    assert.equal(result.view.snapshot?.decisions[0]?.state.kind, "resolved");
    assert.equal(result.view.snapshot?.submissions[1]?.workflowDispatch?.kind, "applied-native");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("native skill tools still obey ordinary permission denial", async () => {
  const result = await exerciseNativeWorkflow("permission");
  try { assert.equal(result.nativeWrite.isError, true); assert.equal(result.observations.nativeCanary, false); }
  finally { await rm(result.root, { recursive: true, force: true }); }
});

test("ordinary custom child completion retains its native turn and can continue the applied scoped workflow", async () => {
  const result = await exerciseNativeWorkflow("custom");
  try {
    assert.equal(result.observations.customPromptChange, null);
    assert.equal(result.observations.customAdmission, "applied");
    assert.equal(result.observations.customNativeWrite, false);
    assert.equal(result.view.tasks.length, 1);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("explicit aliases never override an existing loaded command resource", async () => {
  const result = await exerciseNativeWorkflow("collision");
  try {
    assert.equal(result.observations.existingCommand, "Existing resource preserved");
    assert.ok(result.notices?.some(notice => /already belongs to another loaded resource/.test(notice)));
    assert.equal(result.view.snapshot, null);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("native resource loss between durable intent and real input boundary withholds dispatch rather than substituting", async () => {
  const result = await exerciseNativeWorkflow("resource-race");
  try {
    assert.equal(result.observations.started, false);
    assert.equal(result.view.snapshot?.submissions[0]?.workflowDispatch?.kind, "uncertain-native");
    assert.equal(result.view.tasks.length, 0);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("a changed persisted native prompt cannot authorize managed work or claim an applied skill witness", async () => {
  const result = await exerciseNativeWorkflow("witness");
  try {
    assert.equal(result.observations.managedRefused, true);
    assert.equal(result.view.snapshot?.submissions[0]?.workflowDispatch?.kind, "uncertain-native");
    assert.equal(result.view.tasks.length, 0);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test("resolved ambiguous correction returns to the selected native workflow without laundering it into a new task", async () => {
  const result = await exerciseNativeWorkflow("routing");
  try {
    assert.equal(result.observations.newTaskRefused, true);
    assert.equal(result.observations.correctionApplied, "applied");
    assert.equal(result.view.tasks.length, 1);
    assert.equal(result.view.tasks[0]?.technicalChoices[0]?.choice, "Implement the in-scope correction.");
  } finally { await rm(result.root, { recursive: true, force: true }); }
});
