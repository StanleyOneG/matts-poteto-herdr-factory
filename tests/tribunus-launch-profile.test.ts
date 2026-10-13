import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("configured host launches exact selection through Herdr and initializes Matt without poteto injection", async () => {
  const result = await exerciseNativeAssignment("launch-profile", { profile: "matt", selection: { model: "controlled/selected", thinking: "high" } });
  assert.match(result.startupCommand, /herdr agent start .* --kind pi --pane 'controlled-worker-pane' -- -e .* --model 'controlled\/selected' --thinking 'high'$/);
  assert.equal(result.prompts.some((prompt: string) => prompt.startsWith("/skill:poteto-mode")), false);
  assert.equal(result.entries.some((entry: { customType?: string }) => entry.customType === "pstack-mode"), false);
  assert.equal(result.prompts.filter(prompt => prompt.startsWith("Legion native initialization ")).length, 1);
  assert.match(result.prompts[0] ?? "", /No implementation assignment is authorized yet.*Keep poteto off/);
  const launch = result.view.tasks[0]?.launch;
  assert.ok(launch);
  assert.equal(launch.kind, "assigned");
  if (launch.kind !== "assigned") assert.fail("Expected assigned worker");
  assert.equal(launch.initialization.profile, "matt");
  assert.equal(launch.initialization.skillPath, "");
  assert.deepEqual(launch.assignment.modelPin, { model: "controlled/selected", thinking: "high", profile: "matt" });
  assert.ok(launch.worker.resources.skills.some((skill: { name: string }) => skill.name === "implement-spec"));
  assert.ok(result.view.snapshot?.submissions.some(submission => submission.workflowDispatch?.kind === "applied-native"), "Legatus actually entered the selected native skill before launch");
});

test("configured host leaves native startup defaults untouched and only explicit poteto expands the native skill", async () => {
  const result = await exerciseNativeAssignment("launch-profile", { profile: "poteto-mode" });
  assert.doesNotMatch(result.startupCommand, /--model|--thinking/);
  assert.equal(result.prompts.filter((prompt: string) => prompt.startsWith("/skill:poteto-mode")).length, 1);
  const launch = result.view.tasks[0]?.launch;
  if (launch?.kind !== "assigned") assert.fail("Expected assigned poteto worker");
  assert.equal(launch.initialization.profile, "poteto-mode");
  assert.equal(result.entries.filter((entry: { customType?: string }) => entry.customType === "pstack-mode").length, 1);
  assert.deepEqual(result.workerDescriptor.workflowChoice, { profile: "poteto-mode", requestedWorkflow: "unknown" });
});

test("Matt refuses an enabled native controller without turning it off or dispatching a skill", async () => {
  const result = await exerciseNativeAssignment("launch-profile-held", { profile: "matt", initialMode: true });
  const launch = result.view.tasks[0]?.launch;
  assert.ok(launch);
  assert.equal(launch.kind, "held");
  if (launch.kind !== "held") assert.fail("Expected retained initialization hold");
  assert.match(launch.message, /poteto off/);
  assert.deepEqual(result.prompts, []);
  assert.equal(result.entries.filter((entry: { customType?: string }) => entry.customType === "pstack-mode").length, 1);
});

test("Matt implement-spec requires its native resource but does not require poteto skill discovery", async () => {
  const result = await exerciseNativeAssignment("launch-profile", { profile: "matt", missingWorkerSkill: "poteto-mode" });
  assert.equal(result.view.tasks[0]?.launch.kind, "assigned");
  assert.equal(result.prompts.some((prompt: string) => prompt.startsWith("/skill:")), false);
});

test("explicit poteto initialization cannot use an earlier enabled entry after native mode turns off", async () => {
  const result = await exerciseNativeAssignment("launch-profile-held", { profile: "poteto-mode", disableBeforeSettle: true });
  const launch = result.view.tasks[0]?.launch;
  if (launch?.kind !== "held") assert.fail("Expected unresolved poteto initialization");
  assert.equal(launch.code, "initialization-outcome-unknown");
  assert.equal(result.prompts.filter(prompt => prompt.startsWith("/skill:poteto-mode")).length, 1);
  assert.equal(result.entries.filter(entry => entry.customType === "pstack-mode").length, 2);
});
