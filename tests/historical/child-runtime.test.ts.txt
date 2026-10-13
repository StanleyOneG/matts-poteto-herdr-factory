import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseChildStartup, exerciseRace } from "./support/composed-transport.mjs";

test("approved implementation Centurio prepares an isolated retained branch and exact committed base", async () => {
  await exerciseRace("admission", { effectCase: "writable-prepare" });
});

test("writable native registration selects actual inherited skills before admitting child write edit bash",  async () => {
  await exerciseRace("admission", { effectCase: "writable-effects" });
});

test("delayed writable child stays authorized after principal settlement and reports only exact terminal evidence", async () => {
  await exerciseRace("admission", { effectCase: "writable-delayed-settlement" });
});

for (const state of ["manual", "revoked"]) {
  test(`delayed writable child refuses effects after ${state} authority while preserving pending assignment`, async () => {
    await exerciseRace("admission", { effectCase: `writable-delayed-${state}` });
  });
}

test("delayed writable exception reports the actual later child alternative rather than stale principal verification", async () => {
  await exerciseRace("admission", { effectCase: "writable-delayed-exception" });
});

test("approved writable child accepts native object edits and retains original persisted input", async () => {
  await exerciseRace("admission", { effectCase: "writable-edit-object" });
});

test("approved writable child accepts native JSON string edits and retains original persisted input", async () => {
  await exerciseRace("admission", { effectCase: "writable-edit-string" });
});

test("writable native edit normalization still refuses changed assistant input with original bytes preserved", async () => {
  await exerciseRace("admission", { effectCase: "writable-edit-changed-input" });
});

test("a writable exception carries the exact approved public seam and retains actual child alternative verification", async () => {
  await exerciseRace("admission", { effectCase: "writable-exception" });
});

test("implementation native file effects cannot target parent files or dangling symlinks", async () => {
  await exerciseRace("admission", { effectCase: "writable-escape" });
});

test("a writable child cannot silently omit committed parent task changes using another base branch", async () => {
  await exerciseRace("admission", { effectCase: "writable-foreign-base" });
});

test("a settled preparation root call cannot authorize a fresh child workspace", async () => {
  await exerciseRace("admission", { effectCase: "writable-stale-origin" });
});

test("a child file target substituted after ordinary hooks is refused at final execute", async () => {
  await exerciseRace("admission", { effectCase: "writable-late-path" });
});

for (const refusal of ["dirty-base", "stale-base", "invalid-role", "forged-origin", "git-deny", "git-input", "git-unknown", "read-override", "deny", "late-input", "late-model", "late-owner", "late-resource", "late-settings"]) {
  test(`writable Centurio refuses ${refusal} with parent work preserved`, async () => {
    await exerciseRace("admission", { effectCase: `writable-${refusal}` });
  });
}

test("a matching caller session without the actual foreground controller process cannot create a Tribunus tab", async () => {
  await exerciseRace("child-preparation", { childCase: "caller-process" });
});

test("native child cannot acquire a Legatus command or consume its inherited principal bootstrap", async () => {
  const inherited = await exerciseChildStartup(true);
  assert.equal(inherited.initializationError, null);
  assert.equal(inherited.inheritedBootstrap, `${inherited.root}/principal-bootstrap.json`, "A native child must leave its principal bootstrap untouched");
  assert.equal(inherited.command, "Command /legion is unavailable in this session.");
  const fresh = await exerciseChildStartup(false);
  assert.equal(fresh.initializationError, null);
  assert.equal(fresh.command, "Command /legion is unavailable in this session.");
});

test("prose-only native child wake is suppressed without inventing unknown effects", async () => {
  await exerciseRace("admission", { effectCase: "native-wake" });
});

test("unrelated prose-only child notices retain diagnostics without effects authority or raw model context", async () => {
  await exerciseRace("admission", { effectCase: "native-context" });
});

test("unknown native child activity blocks preparation reporting and retains its evidence", async () => {
  await exerciseRace("child-preparation");
});

test("assigned Tribunus prepares a durable role-bound child intent without launching", async () => {
  await exerciseRace("child-intent");
});

test("owned native child launch preserves exact root permissions and refuses changed input", async () => {
  await exerciseRace("child-native");
});

test("owned child remains observable after principal settlement and retains its result", async () => {
  await exerciseRace("child-owned");
});

const deferredSettlementScenarios: [string, string][] = [
  ["multiple-settlement", "waits for every launched child but not prepared-only intents"],
  ["failed-native", "retains a failed native child outcome despite runner exit zero"],
  ["failed-runner", "retains failed runner closure despite complete native status"],
  ["principal-failed", "preserves the principal failure after a completed child"],
  ["manual-settlement", "never resumes reporting after manual takeover"],
  ["manual-during-final-owner", "rechecks manual authority after the final awaited owner response"],
];
for (const [childCase, behavior] of deferredSettlementScenarios) {
  test(`deferred assignment settlement ${behavior}`, async () => {
    await exerciseRace("child-owned", { childCase });
  });
}

test("concurrent root calls cannot duplicate an owned child intent", async () => {
  await exerciseRace("child-concurrent");
});

test("managed child preparation permits exact native capability discovery only", async () => {
  await exerciseRace("child-discovery");
});

test("unknown owned child holds approved principal effects", async () => {
  await exerciseRace("admission", { effectCase: "child-launch-unknown" });
});

test("mandatory startup accepts actual identity before native journal persistence", async () => {
  await exerciseRace("child-startup-order");
});

test("mandatory startup precedes native launch response without a causal wait", async () => {
  await exerciseRace("child-early-startup");
});

test("confirmed native mismatch remains a durable child hold", async () => {
  await exerciseRace("child-owned", { childCase: "sticky-mismatch" });
});

test("owned logical completion settles after transient pending native process proof", async () => {
  await exerciseRace("child-owned", { childCase: "pending-proof" });
});

test("genuinely unknown native process effects remain held after later close proof", async () => {
  await exerciseRace("child-owned", { childCase: "unknown-proof" });
});

test("process completion refuses a proof for another runner instance of the owned run", async () => {
  await exerciseRace("child-owned", { childCase: "wrong-runner" });
});

test("incomplete native publication cannot conceal a confirmed step model mismatch", async () => {
  await exerciseRace("child-owned", { childCase: "partial-model" });
});

test("native terminal proof cannot settle a child after its current owner is lost", async () => {
  await exerciseRace("child-owned", { childCase: "terminal-lost-owner" });
});

test("actual child model mismatch remains held when its model is restored", async () => {
  await exerciseRace("child-owned", { childCase: "child-model-mismatch" });
});

test("malformed structured native startup remains an unknown-activity hold", async () => {
  await exerciseRace("child-preparation", { childCase: "malformed-start" });
});

test("prose before owned structured completion stays active until independent process close", async () => {
  await exerciseRace("child-owned", { childCase: "structured-completion" });
});

test("missing structured completion cannot turn prose into proof but exact native observation can settle", async () => {
  await exerciseRace("child-owned", { childCase: "prose-without-event" });
});

const refusalScenarios: [string, string][] = [
  ["foreign-owner", "foreign native parent session"],
  ["stale-run", "stale native run"],
  ["missing-guard", "unavailable required native extension"],
  ["foreign-journal", "reused foreign journal session"],
  ["foreign-child-session", "changed actual child session"],
  ["foreign-event-session", "foreign structured completion session"],
  ["stale-event-owner", "stale structured completion owner instance"],
  ["foreign-event-directory", "wrong structured completion directory"],
];
for (const [childCase, behavior] of refusalScenarios) {
  test(`owned child durably refuses ${behavior}`, async () => {
    await exerciseRace("child-owned", { childCase });
  });
}

test("native terminal status without completed findings remains held despite later valid-looking artifacts", async () => {
  await exerciseRace("child-owned", { childCase: "missing-findings" });
});

test("native status with genuinely unknown process effects remains held", async () => {
  await exerciseRace("child-owned", { childCase: "unknown-native-status" });
});

test("owned terminal evidence preserves independent native process close metadata", async () => {
  await exerciseRace("child-owned", { childCase: "proof-metadata" });
});

test("incomplete publication cannot conceal a changed native runner instance", async () => {
  await exerciseRace("child-owned", { childCase: "partial-runner" });
});
