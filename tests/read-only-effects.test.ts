import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("owned native launch preserves ordinary root permission denial without mandatory child guard", async () => {
  await exerciseNativeAssignment("child-deny");
});
test("native child tool refusal is actual nonexecution evidence, not an unknown executed failure", async () => {
  await exerciseNativeAssignment("child-tool-denial");
});
