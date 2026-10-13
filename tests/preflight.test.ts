import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

test("preflight admits intake with installed Pi 1.1.0 and pi-subagents 0.77.0 composition", async () => {
  const result = await exerciseRace("readiness");
  assert.match(result.doctor, /Pi ready\. Observed Pi 1\.1\.0\./);
  assert.match(result.doctor, /pi-subagents ready\..*Observed 0\.77\.0\./);
  assert.match(result.doctor, /@zenspc\/pi-pstack ready\./);
  assert.equal(result.view.mode, "active");
  assert.equal(result.view.snapshot?.submissions[0]?.text, "Fix the Ready label");
  assert.equal(result.prompts.length, 1, "Verified composition can admit the saved intake into a model turn");
});

for (const [readinessCase, diagnostic] of [
  ["missing-pi-contract", "Pi unverified."],
  ["unknown-subagents", "pi-subagents unverified."],
  ["unsupported-subagents", "pi-subagents unverified."],
  ["missing-subagents", "pi-subagents missing."],
  ["hidden-subagents", "pi-subagents missing."],
  ["missing-pstack", "@zenspc/pi-pstack missing."],
  ["unsupported-pstack", "@zenspc/pi-pstack unverified."],
] satisfies [string, string][]) {
  test(`preflight preserves input without admission for ${readinessCase}`, async () => {
    const result = await exerciseRace("readiness", { readinessCase });
    assert.ok(result.doctor.includes(diagnostic), result.doctor);
    assert.equal(result.view.mode, "inactive");
    assert.equal(result.view.snapshot?.submissions[0]?.text, "Fix the Ready label");
    assert.equal(result.view.snapshot?.submissions[0]?.state.kind, "pending");
    assert.equal(result.view.tasks.length, 0);
    assert.equal(result.prompts.length, 0, "Unknown or unsupported loaded composition cannot wake the model");
  });
}


test("actual Legatus below 272000 preserves inactive task input without a model wake", async () => {
  const result = await exerciseRace("readiness", { readinessCase: "small-legatus" });
  assert.match(result.doctor, /Legatus.*271999.*272000/);
  assert.equal(result.view.mode, "inactive");
  assert.equal(result.view.snapshot?.submissions[0]?.text, "Fix the Ready label");
  assert.equal(result.prompts.length, 0);
});


for (const [readinessCase, message] of [
  ["missing-model", /selection is unknown/],
  ["missing-auth", /no configured authentication/],
  ["missing-provider", /no registered native Pi provider/],
  ["unsupported-thinking", /thinking high is unsupported/],
  ["unknown-window", /at least 272000/],
  ["actual-unsupported-registered-supported", /actual selected.*thinking high.*unsupported/],
  ["actual-small-registered-large", /actual selected.*271999.*272000/],
  ["exact-override-missing", /controlled\/not-selected.*not registered/],
  ["invalid-settings", /legion.json.*invalid JSON/],
] satisfies [string, RegExp][]) {
  test(`activation diagnoses ${readinessCase} without fallback, credential acquisition or model wake`, async () => {
    const result = await exerciseRace("readiness", { readinessCase });
    assert.equal(result.view.mode, "inactive");
    assert.equal(result.view.snapshot?.submissions[0]?.text, "Fix the Ready label");
    assert.equal(result.prompts.length, 0);
    assert.match(result.view.diagnostics.map(d => d.message).join(" "), message);
  });
}
