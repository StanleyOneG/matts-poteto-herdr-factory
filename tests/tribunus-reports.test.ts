import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("assignment receipt is not child completion or acceptance", async () => {
  const result = await exerciseNativeAssignment("child-active");
  assert.equal(result.view.tasks[0]?.launch.kind, "assigned");
});
test("off preserves an unsettled assignment across restart and parks only after native principal settlement", async () => {
  await exerciseNativeAssignment("drain-root");
});
test("same-process Legatus session loss latches retirement and late controls cannot restore assignment authority", async () => {
  await exerciseNativeAssignment("owner-loss-session");
});
test("PID reuse retires the exact owner incarnation without killing or restoring authority", async () => {
  await exerciseNativeAssignment("owner-loss-reuse");
});
test("unreadable owner evidence preserves a sticky blocker rather than fabricating death or settlement", async () => {
  await exerciseNativeAssignment("owner-loss-unreadable");
});
test("missing owner session metadata preserves a sticky blocker with the exact process and pane still present", async () => {
  await exerciseNativeAssignment("owner-loss-missing-session");
});
test("missing owner agent metadata preserves a sticky blocker with the exact session, process and pane still present", async () => {
  await exerciseNativeAssignment("owner-loss-missing-agent");
});
test("empty owner session identity preserves a sticky blocker rather than proving replacement", async () => {
  await exerciseNativeAssignment("owner-loss-empty-session");
});
for (const scenario of ["empty-agent", "malformed-session", "unreadable-session", "empty-session-journal"]) test(`${scenario} owner identity remains unresolved with the exact process and pane still present`, async () => {
  await exerciseNativeAssignment(`owner-loss-${scenario}`);
});
test("a positively observed non-Pi owner agent establishes loss even without session metadata", async () => {
  await exerciseNativeAssignment("owner-loss-non-pi");
});
test("off preserves an already-admitted native effect until its outcome and principal settle", async () => {
  await exerciseNativeAssignment("drain-effect");
});
test("unknown in-flight effect outcomes preserve stopping even after principal prose", async () => {
  await exerciseNativeAssignment("drain-effect-unknown");
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
