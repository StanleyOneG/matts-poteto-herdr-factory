import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("managed root write uses current assignment authority and unchanged native tools without skill or seam gates", async () => {
  await exerciseNativeAssignment("write");
});
test("managed root native permission refusal retains exact refused effect without executing", async () => {
  await exerciseNativeAssignment("deny");
});
test("managed root native executed error holds fresh effects without blind retry", async () => {
  await exerciseNativeAssignment("unknown");
});

test("a later native input change retains an unknown actual effect rather than claiming a final-execute veto", async () => {
  const result = await exerciseNativeAssignment("changed-input");
  assert.equal(result.view.snapshot?.effects.at(-1)?.state.kind, "unknown");
});
