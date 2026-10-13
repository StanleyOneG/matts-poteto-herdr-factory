import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("Tribunus uses a new no-focus tab in the verified owning workspace", async () => {
  await exerciseNativeAssignment("topology");
});

test("Tribunus refuses layout effects when the owning Herdr caller is unknown", async () => {
  await exerciseNativeAssignment("topology", { childCase: "unknown-caller" });
});

test("new Legion worktrees use the project sibling container and preserve its contents", async () => {
  await exerciseNativeAssignment("topology", { childCase: "project-container" });
});
