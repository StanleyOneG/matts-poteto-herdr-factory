import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

test("Tribunus uses a new no-focus tab in the verified owning workspace", async () => {
  await exerciseRace("child-owned", { childCase: "topology" });
});

test("Tribunus refuses layout effects when the owning Herdr caller is unknown", async () => {
  await exerciseRace("child-owned", { childCase: "unknown-caller" });
});

test("new Legion worktrees use the project sibling container and preserve its contents", async () => {
  await exerciseRace("child-owned", { childCase: "project-container" });
});
