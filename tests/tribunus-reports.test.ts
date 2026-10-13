import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("assignment receipt is not child completion or acceptance", async () => {
  const result = await exerciseNativeAssignment("child-active");
  assert.equal(result.view.tasks[0]?.launch.kind, "assigned");
});
test("actual root native result is publicly reported but not accepted", async () => {
  const result = await exerciseNativeAssignment("write");
  const launch = result.view.tasks[0]?.launch;
  assert.ok(launch?.kind === "reported");
  assert.equal(launch.report.outcome, "reported-result");
  assert.equal(launch.report.engineering, undefined);
  assert.equal(launch.report.contract, undefined);
  assert.ok(launch.report.evidence.length > 0);
});
