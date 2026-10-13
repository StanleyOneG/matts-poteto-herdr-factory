import { test } from "node:test";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

for (const [scenario, behavior] of [
  ["intake-pending", "composed intake defers pending input and progresses after queue-drain observation"],
  ["intake-stale", "composed stale intake authority releases unstarted ownership only"],
  ["intake-auth-error", "composed intake authentication lookup failure retains input until explicit recovery"],
  ["intake-uncertain", "composed uncertain intake send cannot retry through resume"],
] satisfies [string, string][]) test(behavior, async () => { await exerciseNativeAssignment(scenario); });
