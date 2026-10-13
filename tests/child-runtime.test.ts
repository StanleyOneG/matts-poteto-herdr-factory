import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseChildStartup, exerciseNativeAssignment } from "./support/composed-transport.mjs";

test("off retains active native children until exact native settlement then parks without acceptance", async () => {
  await exerciseNativeAssignment("child-drain");
});
test("off with missing native proof preserves stopping and exposes a settlement blocker", async () => {
  await exerciseNativeAssignment("child-missing-proof", { drain: true });
});
test("native child completion cannot park while its ordinary principal completion turn is active", async () => {
  await exerciseNativeAssignment("child-drain-native-turn");
});
test("safe stop followed by exact owner process loss drains the registered child under the original shutdown", async () => {
  await exerciseNativeAssignment("child-stop-owner-loss");
});
test("owner-loss retirement can observe an already-owned native child settlement but cannot regain controls", async () => {
  await exerciseNativeAssignment("child-owner-loss");
});
for (const field of ["session", "agent"]) test(`missing owner ${field} metadata never grants parent-independent child settlement or parking`, async () => {
  await exerciseNativeAssignment(`child-owner-missing-${field}`);
});
test("owner loss with missing child proof preserves native activity and the retirement blocker", async () => {
  await exerciseNativeAssignment("child-missing-proof", { ownerLoss: true });
});
test("owned native writer prepares an isolated committed task branch without child model or policy routing", async () => {
  await exerciseNativeAssignment("child-prepared");
});
test("native child cannot acquire Legatus authority or consume inherited principal bootstrap", async () => {
  for (const inherited of [true, false]) {
    const result = await exerciseChildStartup(inherited);
    assert.equal(result.initializationError, null);
    assert.equal(result.command, "Command /legion is unavailable in this session.");
    if (inherited) assert.equal(result.inheritedBootstrap, `${result.root}/principal-bootstrap.json`);
  }
});
test("ordinary child completion context and model wake pass through the Tribunus host", async () => {
  await exerciseNativeAssignment("notice");
});
for (const [scenario, behavior] of [
  ["child-active", "principal prose cannot settle an active native writer"],
  ["child-terminal", "exact runner proof and settled native events release reporting without final findings"],
  ["child-missing-events", "missing native settlement events hold even with runner proof"],
  ["child-open-tool", "missing tool outcome holds even with runner proof and settled prose"],
  ["child-missing-proof", "logical settlement never substitutes for runner close proof"],
  ["child-unknown-proof", "unknown process proof stays unknown after later ordinary proof"],
  ["child-wrong-runner", "another runner cannot settle an owned native writer"],
  ["child-changed-session", "a changed native child journal session cannot settle an owned run"],
  ["child-canceled", "native cancellation without settled effects does not release owned reporting"],
  ["child-failed", "conclusive native child failure is reported without acceptance"],
  ["child-lost-owner", "off revokes new child work but retains exact read-only native settlement"],
  ["child-tool-unknown", "executed native tool failure without effect evidence remains held"],
] satisfies [string, string][]) test(behavior, async () => { await exerciseNativeAssignment(scenario); });

for (const scenario of ["native-pre-assignment", "native-unprepared"]) test(`${scenario}: managed execution requires assignment-owned isolated preparation but inspection stays native`, async () => {
  await exerciseNativeAssignment(scenario);
});

test("held principal cannot launch prepared or ordinary native writers while inspection remains available", async () => {
  await exerciseNativeAssignment("child-held-launch");
});

test("native initial startup publication to fresh top-level journal and runner-plus-writer proof settles with current helpers", async () => {
  await exerciseNativeAssignment("child-native-startup");
});

for (const childCase of ["foreign-owner", "foreign-run", "foreign-agent", "foreign-cwd", "malformed-cwd", "malformed-journal", "malformed-state", "unknown-sidecar", "foreign-sidecar"]) test(`incomplete native startup retains ${childCase} as a visible sticky hold`, async () => {
  await exerciseNativeAssignment("child-native-startup", { childCase });
});

test("native control requires exact currently owned child identity and cannot revive via steering recovery", async () => {
  await exerciseNativeAssignment("child-owned-controls");
});
test("non-launch native settings management retains assignment effect admission and ordinary permission denial", async () => {
  await exerciseNativeAssignment("native-management");
});
