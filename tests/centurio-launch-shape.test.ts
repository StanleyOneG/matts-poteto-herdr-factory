import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("Centurio preparation uses pi-subagents0.79.1 declared model options and exact native admission without replay", async () => {
  await exerciseNativeAssignment("child-launch-shape");
});

test("Centurio canonical launch refuses altered input, extras and foreign ownership before effects without consuming preparation", async () => {
  await exerciseNativeAssignment("child-launch-shape-denials");
});
