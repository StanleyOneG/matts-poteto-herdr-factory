import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

test("owned read-only Centurio refuses arguments changed by a later hook", async () => {
  await exerciseRace("child-owned", { childCase: "late-input" });
});

const scenarios: [string, string][] = [
  ["read-tools", "performs allowed native read grep find and ls"],
  ["child-deny", "preserves independent ordinary child permission denial"],
  ["root-deny", "preserves independent ordinary root permission denial"],
  ["late-owner", "refuses owner revoked by a later hook"],
  ["late-model", "refuses incompatible supported model switching before execution"],
  ["late-tool-owner", "refuses changed tool provenance before execution"],
  ["owner-unavailable", "refuses unavailable current owner at execution"],
  ["startup-override", "refuses an existing configured read override without replacing it"],
];
for (const [childCase, behavior] of scenarios) {
  test(`owned read-only Centurio ${behavior}`, async () => {
    await exerciseRace("child-owned", { childCase });
  });
}
