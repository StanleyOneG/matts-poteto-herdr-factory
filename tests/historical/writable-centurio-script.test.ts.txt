import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Legion } from "../src/intake.js";
import { basename, join } from "node:path";
import { exerciseRace } from "./support/composed-transport.mjs";
import { registerWritableCoordinator, writableFixtureCommand, writableFixtureInterpretation, writableFixtureDecision, verifyWritablePublicEvidence } from "../scripts/verify-t04-writable-centurio.mjs";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createReadTool, createReadToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";

const fixture = exerciseRace("admission", { effectCase: "writable-red-green" });

// Each contradictory native-evidence scenario owns its copies; neither the
// shared runtime fixture nor historical live evidence is rewritten.
async function copyWritableEvidence() {
  const { view } = await fixture;
  const originalLaunch = view.tasks[0]?.launch;
  assert.ok(originalLaunch && "worker" in originalLaunch);
  const originalChild = originalLaunch.worker.resources.children?.[0];
  assert.ok(originalChild?.result);
  const intentPath = originalChild.evidence.find(path => path.endsWith(".centurio-intent.json"));
  assert.ok(intentPath);
  const startupPath = intentPath.replace(".centurio-intent.json", ".centurio-startup.json");
  const startup = JSON.parse(await readFile(startupPath, "utf8"));
  const root = await mkdtemp(join(tmpdir(), "legion-writable-evidence-"));
  const paths = [intentPath, startupPath, originalChild.result.evidence, ...originalChild.evidence.filter(path => path.endsWith(".centurio-status.json"))];
  const journalPath = join(root, "original-native.jsonl");
  const replacements = [[startup.child.journal, journalPath], ...paths.map(path => [path, join(root, basename(path))])] as [string, string][];
  const remap = <T,>(value: T): T => JSON.parse(replacements.reduce((text, [from, to]) => text.replaceAll(from, to), JSON.stringify(value))) as T;
  for (const path of paths) await writeFile(join(root, basename(path)), JSON.stringify(remap(JSON.parse(await readFile(path, "utf8")))));
  await writeFile(journalPath, await readFile(startup.child.journal));
  const changed = remap(structuredClone(view)), launch = changed.tasks[0]?.launch;
  assert.ok(launch && "worker" in launch);
  const result = launch.worker.resources.children?.[0]?.result;
  assert.ok(result);
  const retained = JSON.parse(await readFile(result.evidence, "utf8"));
  const entries = Buffer.from(retained.journalBytes, "base64").toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  const saveJournal = async (corroborate = true) => {
    const journal = entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
    retained.journalBytes = Buffer.from(journal).toString("base64");
    retained.journalSha256 = createHash("sha256").update(journal).digest("hex");
    await writeFile(result.evidence, JSON.stringify(retained));
    if (corroborate) await writeFile(journalPath, journal);
  };
  return { root, view: changed, result, retained, entries, journalPath, saveJournal };
}

async function nativeResourceEvidence(text: string, ranges: { offset: number | null; limit: number | null; start: number; end: number }[]) {
  const copied = await copyWritableEvidence();
  const effect = copied.view.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio");
  const selected = effect?.intent.contract.resources.find(resource => resource.load.kind === "complete");
  assert.ok(selected && selected.load.kind === "complete");
  const oldPath = selected.canonicalPath, oldLoad = selected.load.evidence[0];
  assert.ok(oldLoad?.kind === "read");
  const path = join(copied.root, "selected-resource.md");
  await writeFile(path, text);
  const native = createReadToolDefinition(copied.root);
  const proofs = [], results = [];
  const oldCallIndex = copied.entries.findIndex(entry => entry.id === oldLoad.call.split("#")[1]);
  const oldResultIndex = copied.entries.findIndex(entry => entry.id === oldLoad.result.split("#")[1]);
  const newEntries = [];
  for (const [index, range] of ranges.entries()) {
    const id = `native-range-${index}`, callEntry = `native-call-${index}`, resultEntry = `native-result-${index}`;
    const raw = { path, offset: range.offset, limit: range.limit };
    const input = validateToolArguments(native, { type: "toolCall", id, name: "read", arguments: structuredClone(raw) });
    const output: Awaited<ReturnType<typeof native.execute>> = await createReadTool(copied.root).execute(id, input);
    results.push(output);
    newEntries.push({ type: "message", id: callEntry, message: { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: raw }] } },
      { type: "message", id: resultEntry, message: { role: "toolResult", toolCallId: id, toolName: "read", ...output, isError: false } });
    proofs.push({ kind: "read" as const, toolCallId: id, call: `${copied.journalPath}#${callEntry}`, result: `${copied.journalPath}#${resultEntry}`, startLine: range.start, endLine: range.end });
  }
  copied.entries.splice(oldResultIndex, 1);
  copied.entries.splice(oldCallIndex, 1, ...newEntries);
  for (const effect of copied.view.snapshot?.effects ?? []) {
    if (effect.intent.origin?.kind !== "centurio") continue;
    for (const resource of effect.intent.contract.resources) if (resource.canonicalPath === oldPath) {
      resource.path = path; resource.canonicalPath = path;
      resource.digest = createHash("sha256").update(Buffer.from(text)).digest("hex");
      resource.load = { kind: "complete", evidence: structuredClone(proofs) };
    }
  }
  await copied.saveJournal();
  return { ...copied, results };
}

test("writable coordinator registers a strict empty-input model-only tool without starting effects", () => {
  const tools: Pick<ToolDefinition, "name" | "description" | "parameters" | "exposure">[] = [];
  registerWritableCoordinator({ registerTool: tool => { tools.push(tool); }, getAllTools: () => { throw new Error("Registration must not inspect or start a session"); } }, "/not-created-fixture", "/not-loaded-extension.ts");
  assert.equal(tools.length, 1);
  const tool = tools[0]; assert.ok(tool);
  assert.equal(tool.name, "legion_writable_fixture");
  assert.equal(tool.exposure, "model-only");
  assert.deepEqual(validateToolArguments(tool, { type: "toolCall", id: "actual-root", name: tool.name, arguments: {} }), {});
  assert.throws(() => validateToolArguments(tool, { type: "toolCall", id: "forged-input", name: tool.name, arguments: { session: "supervisor-impersonation" } }), /validation|additional/i);
});

test("writable controlled requests obey the actual public command and submission contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-writable-requests-"));
  const session = "controlled-fixture-schema-test";
  const legion = new Legion({ storagePath: join(root, "state"), context: root, session, preflight: async () => [] });
  const record = (await fixture).view.snapshot?.engineering[0]; assert.ok(record);
  try {
    assert.equal((await legion.command(writableFixtureCommand("task Delegate the bounded Ready status change", session, 1))).kind, "saved");
    const initial = await legion.state();
    assert.equal((await legion.submit(writableFixtureInterpretation(initial, session, "Ready fixture shape check"))).kind, "applied");
    const task = (await legion.state()).tasks[0]; assert.ok(task);
    for (const text of [`reserve ${task.id}@1 --parent refs/heads/main`, `launch ${task.id}@1`]) {
      const receipt = await legion.command(writableFixtureCommand(text, session, 2));
      assert.notEqual(receipt.kind === "rejected" ? receipt.code : "accepted", "invalid");
      assert.notEqual(receipt.kind === "rejected" ? receipt.code : "accepted", "syntax");
    }
    const decision = writableFixtureDecision(record, session);
    const malformed = await legion.submit({ ...decision, requestKey: "controlled-fixture-seam" });
    assert.deepEqual(malformed, { kind: "rejected", code: "invalid", message: "Invalid submission." }, "Retain the exact primary failure, not a timeout or unknown effect");
    const valid = await legion.submit(decision);
    assert.ok(valid.kind === "rejected");
    assert.notEqual(valid.code, "invalid", `Supported controlled decision must parse before authority checks: ${JSON.stringify(valid)}`);
    assert.notEqual(decision.requestKey, writableFixtureDecision(record, session).requestKey, "Each new controlled decision has a genuine unique request key");
    for (const command of [{ workspaceRequest: "fixture-2" }, { launchRequest: "fixture-3" }, { engineeringDelivery: record.id }]) {
      const receipt = await legion.command(command);
      assert.notEqual(receipt.kind === "rejected" ? receipt.code : "accepted", "invalid");
    }
    // No fixture-authored effect/completion requests follow: production host,
    // guard and owned runtime generate and validate those exact public messages.
  } finally { await legion.command(writableFixtureCommand("off", session, 4)); }
});

test("controlled writable trial intake saves instructions before public interpretation grants scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-writable-intake-"));
  const legion = new Legion({ storagePath: join(root, "state"), context: root, session: "controlled-fixture", preflight: async () => [] });
  try {
    const result = await legion.command({ text: "task Delegate the bounded Ready status change", requestKey: "fixture-start", evidence: { origin: "host-command", transport: "source-unavailable", session: "controlled-fixture", generation: null, presented: [] } });
    assert.equal(result.kind, "saved", "Saved task instructions are not an applied interpretation or effect authority");
    assert.equal((await legion.state()).tasks.length, 0);
    assert.equal((await legion.state()).snapshot?.submissions[0]?.state.kind, "pending");
  } finally { await legion.command({ text: "off", requestKey: "fixture-stop" }); }
});

test("writable verifier accepts public native results and retained branch evidence", async () => {
  const { view } = await fixture;
  const verified = await verifyWritablePublicEvidence(view);
  assert.equal(verified.child.state.kind, "process-terminal");
  assert.equal(verified.effects.length, 6);
  assert.equal(verified.effects.filter(effect => effect.state.kind === "refused").length, 1);
});

test("writable verifier refuses a changed recorded bash command despite matching native call IDs", async () => {
  const { view } = await fixture;
  const changed = structuredClone(view);
  const effect = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "bash");
  assert.ok(effect);
  effect.intent.call.input = { command: "printf fabricated-verification" };
  await assert.rejects(verifyWritablePublicEvidence(changed), /Admitted native input/);
});

test("writable verifier refuses a recorded green state contradicted by the native assertion failure", async () => {
  const { view } = await fixture;
  const changed = structuredClone(view);
  const red = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "bash");
  assert.ok(red && red.state.kind === "completed");
  assert.equal(red.state.exitCode, 1);
  red.state.exitCode = 0;
  red.state.isError = false;
  await assert.rejects(verifyWritablePublicEvidence(changed), /Recorded native (?:exit|error)/);
});

test("writable verifier joins original arguments and the exact persisted entry, not merely call IDs", async () => {
  const { view } = await fixture;
  for (const mismatch of ["raw-input", "journal-entry"]) {
    const changed = structuredClone(view);
    const effect = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "edit");
    assert.ok(effect);
    if (mismatch === "raw-input") effect.intent.call.rawInput = { path: "ready.txt", edits: { oldText: "Red", newText: "Forged" } };
    else effect.intent.call.journal = effect.intent.call.journal.split("#")[0] + "#foreign-entry";
    await assert.rejects(verifyWritablePublicEvidence(changed), mismatch === "raw-input" ? /Original persisted arguments/ : /Exact persisted child assistant call/);
  }
});

test("writable verifier refuses contradictory native outcomes and foreign effect identities", async () => {
  const { root, view } = await fixture;
  for (const mismatch of ["exit", "error", "content", "effect", "call"]) {
    const changed = structuredClone(view);
    const green = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "bash" && effect.state.kind === "completed" && effect.state.exitCode === 0);
    assert.ok(green && green.state.kind === "completed");
    const outcome = JSON.parse(await readFile(green.state.evidence, "utf8"));
    if (mismatch === "exit") outcome.result.structuredContent.exit_code = 1;
    if (mismatch === "error") outcome.result.isError = true;
    if (mismatch === "content") outcome.result.content = [{ type: "text", text: "Fabricated green output" }];
    if (mismatch === "effect") outcome.id = "foreign-effect";
    if (mismatch === "call") outcome.call = "foreign-call";
    green.state.evidence = join(root, `contradictory-${mismatch}.json`);
    await writeFile(green.state.evidence, JSON.stringify(outcome));
    await assert.rejects(verifyWritablePublicEvidence(changed), /(?:Native|Recorded native)/);
  }
});

test("writable verifier refuses an ordinary denial outcome with contradictory error status", async () => {
  const { root, view } = await fixture;
  const changed = structuredClone(view);
  const refused = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.state.kind === "refused");
  assert.ok(refused && refused.state.kind === "refused");
  const outcome = JSON.parse(await readFile(refused.state.evidence, "utf8"));
  outcome.isError = false;
  refused.state.evidence = join(root, "contradictory-denial.json");
  await writeFile(refused.state.evidence, JSON.stringify(outcome));
  await assert.rejects(verifyWritablePublicEvidence(changed), /Ordinary pipeline refusal/);
});

test("writable verifier accepts native journals without structured content while retaining exact outcome exits", async () => {
  const { view, entries, saveJournal } = await copyWritableEvidence();
  for (const entry of entries) if (entry.message?.role === "toolResult") delete entry.message.structuredContent;
  await saveJournal();
  await verifyWritablePublicEvidence(view);
});

test("writable verifier refuses unrelated successful commands without meaningful behavioral red and green", async () => {
  const { view } = await exerciseRace("admission", { effectCase: "writable-effects" });
  await assert.rejects(verifyWritablePublicEvidence(view), /meaningful behavioral red and green/);
});

test("writable verifier refuses setup-only red or skipped green even when outcome and journal agree", async () => {
  for (const phase of ["red", "green"]) {
    const { root, view, entries, saveJournal } = await copyWritableEvidence();
    const effect = view.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "bash" && effect.state.kind === "completed" && effect.state.exitCode === (phase === "red" ? 1 : 0));
    assert.ok(effect && effect.state.kind === "completed");
    const outcome = JSON.parse(await readFile(effect.state.evidence, "utf8"));
    outcome.result.structuredContent.output = phase === "red" ? "Setup failed: missing test file" : "Skipping recursive test execution";
    outcome.result.content = [{ type: "text", text: outcome.result.structuredContent.output }];
    effect.state.evidence = join(root, `${phase}-not-behavioral.json`);
    await writeFile(effect.state.evidence, JSON.stringify(outcome));
    for (const entry of entries) if (entry.message?.role === "toolResult" && entry.message.toolCallId === effect.intent.call.id) Object.assign(entry.message, outcome.result);
    await saveJournal();
    await assert.rejects(verifyWritablePublicEvidence(view), phase === "red" ? /actual behavioral assertion failure/ : /pass actual behavioral tests/);
  }
});

test("writable verifier refuses a contradictory independently retained startup model", async () => {
  const { root, view } = await fixture;
  const changed = structuredClone(view), launch = changed.tasks[0]?.launch;
  assert.ok(launch && "worker" in launch);
  const child = launch.worker.resources.children?.[0];
  assert.ok(child);
  const intentPath = child.evidence.find(path => path.endsWith(".centurio-intent.json"));
  assert.ok(intentPath);
  const original = intentPath.replace(".centurio-intent.json", ".centurio-startup.json");
  const startup = JSON.parse(await readFile(original, "utf8"));
  startup.child.model = "foreign/model";
  const path = join(root, "contradictory.centurio-startup.json");
  await writeFile(path, JSON.stringify(startup));
  const copiedIntent = join(root, "contradictory.centurio-intent.json");
  await writeFile(copiedIntent, await readFile(intentPath));
  child.evidence[child.evidence.indexOf(intentPath)] = copiedIntent;
  await assert.rejects(verifyWritablePublicEvidence(changed), /Startup model/);
});

test("writable verifier refuses logical completion and foreign native run proof", async () => {
  const { view } = await fixture;
  const logical = structuredClone(view);
  const child = logical.tasks[0]?.launch;
  assert.ok(child && "worker" in child);
  const state = child.worker.resources.children?.[0];
  assert.ok(state);
  assert.equal(state.state.kind, "process-terminal");
  if (state.state.kind !== "process-terminal") assert.fail("Fixture must independently settle");
  state.state = { kind: "logical-terminal", run: state.state.run, session: state.state.session, index: state.state.index, outcome: state.state.outcome };
  await assert.rejects(verifyWritablePublicEvidence(logical), /Logical\/model completion/);
  const foreign = structuredClone(view);
  const launch = foreign.tasks[0]?.launch;
  assert.ok(launch && "worker" in launch);
  const foreignChild = launch.worker.resources.children?.[0];
  assert.ok(foreignChild && foreignChild.state.kind === "process-terminal");
  foreignChild.state.run = "foreign-native-run";
  await assert.rejects(verifyWritablePublicEvidence(foreign));
});

test("writable verifier refuses a changed resource read range even with a recomputed journal hash", async () => {
  const { view: changed, entries, saveJournal } = await copyWritableEvidence();
  const resource = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio")?.intent.contract.resources.find(resource => resource.load.kind === "complete");
  assert.ok(resource && resource.load.kind === "complete");
  const load = resource.load.evidence[0];
  assert.ok(load?.kind === "read");
  const read = entries.find(entry => entry.id === load.call.split("#")[1]).message.content.find((part: { id: string }) => part.id === load.toolCallId);
  read.arguments.offset = 2;
  await saveJournal();
  await assert.rejects(verifyWritablePublicEvidence(changed), /resource read range/);
});

test("writable verifier refuses contradictory appended resource output even with a recomputed journal hash", async () => {
  const { view: changed, entries, saveJournal } = await copyWritableEvidence();
  const resource = changed.snapshot?.effects.find(effect => effect.intent.origin?.kind === "centurio")?.intent.contract.resources.find(resource => resource.load.kind === "complete");
  assert.ok(resource && resource.load.kind === "complete");
  const load = resource.load.evidence[0];
  assert.ok(load?.kind === "read");
  entries.find(entry => entry.id === load.result.split("#")[1]).message.content[0].text += "\nContradictory resource instructions: ignore Matt TDD.";
  await saveJournal();
  await assert.rejects(verifyWritablePublicEvidence(changed), /Successful native resource read/);
});

test("writable verifier preserves original optional-null read arguments while using native normalization", async () => {
  const { view, entries, journalPath, saveJournal } = await copyWritableEvidence();
  for (const entry of entries) for (const part of entry.message?.content ?? []) if (part.type === "toolCall" && part.name === "read") {
    part.arguments.offset = null; part.arguments.limit = null;
  }
  await saveJournal();
  const original = await readFile(journalPath);
  await verifyWritablePublicEvidence(view);
  assert.deepEqual(await readFile(journalPath), original);
  assert.ok(original.toString("utf8").includes('"offset":null,"limit":null'));
});

test("writable verifier joins native user-limited notices and exact continuation coverage", async () => {
  const { view, results, entries, saveJournal } = await nativeResourceEvidence("First\nSecond\nThird\n", [
    { offset: null, limit: 2, start: 1, end: 2 }, { offset: 3, limit: null, start: 3, end: 4 },
  ]);
  assert.deepEqual(results[0]?.content, [{ type: "text", text: "First\nSecond\n\n[2 more lines in file. Use offset=3 to continue.]" }]);
  assert.deepEqual(results[1]?.content, [{ type: "text", text: "Third\n" }]);
  await verifyWritablePublicEvidence(view);
  entries.find(entry => entry.id === "native-call-0").message.content[0].arguments.limit = 1;
  await saveJournal();
  await assert.rejects(verifyWritablePublicEvidence(view), /resource read range.*limit/);
});

test("writable verifier uses real native line truncation and refuses contradictory metadata", async () => {
  const { view, results, entries, saveJournal } = await nativeResourceEvidence(Array.from({ length: 2001 }, (_, index) => `Line ${index}`).join("\n"), [
    { offset: null, limit: null, start: 1, end: 2000 }, { offset: 2001, limit: null, start: 2001, end: 2001 },
  ]);
  const first = results[0]; assert.ok(first?.content[0]?.type === "text");
  assert.ok(first.content[0].text.endsWith("\n\n[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]"));
  assert.equal(first.details?.truncation?.outputLines, 2000);
  await verifyWritablePublicEvidence(view);
  entries.find(entry => entry.id === "native-result-0").message.details.truncation.outputLines = 1999;
  await saveJournal();
  await assert.rejects(verifyWritablePublicEvidence(view), /Native resource truncation metadata/);
});

test("writable verifier uses real native UTF-8 byte truncation with complete continuation lines", async () => {
  const { view, results } = await nativeResourceEvidence(Array(20).fill("é".repeat(2000)).join("\n"), [
    { offset: null, limit: null, start: 1, end: 12 }, { offset: 13, limit: null, start: 13, end: 20 },
  ]);
  const first = results[0]; assert.ok(first?.content[0]?.type === "text");
  assert.ok(first.content[0].text.endsWith("\n\n[Showing lines 1-12 of 20 (50.0KB limit). Use offset=13 to continue.]"));
  assert.equal(first.details?.truncation?.outputLines, 12);
  await verifyWritablePublicEvidence(view);
});

test("writable verifier refuses native first-line-over-byte-limit fallback as resource coverage", async () => {
  const { view, results } = await nativeResourceEvidence("x".repeat(60000), [{ offset: null, limit: null, start: 1, end: 1 }]);
  assert.equal(results[0]?.details?.truncation?.firstLineExceedsLimit, true);
  await assert.rejects(verifyWritablePublicEvidence(view), /Only complete native resource lines/);
});

test("writable verifier accepts an exact retained prefix when the original native journal appends later entries", async () => {
  const { view, journalPath } = await copyWritableEvidence();
  const original = await readFile(journalPath);
  await writeFile(journalPath, Buffer.concat([original, Buffer.from(JSON.stringify({ type: "label", id: "later-native-entry" }) + "\n")]));
  await verifyWritablePublicEvidence(view);
});

test("writable verifier refuses a self-hashed substituted journal not corroborated by original native bytes", async () => {
  const { view, entries, saveJournal } = await copyWritableEvidence();
  entries[0].substituted = "Same claimed native identity, different original bytes";
  await saveJournal(false);
  await assert.rejects(verifyWritablePublicEvidence(view), /Original native journal/);
});

test("writable verifier refuses a substituted retained source entry with the same journal path", async () => {
  const { view, result, retained } = await copyWritableEvidence();
  retained.source = retained.source.split("#")[0] + "#substituted-native-entry";
  result.source = retained.source;
  await writeFile(result.evidence, JSON.stringify(retained));
  await assert.rejects(verifyWritablePublicEvidence(view), /Exact retained native finding/);
});

test("writable verifier refuses changed retained actual child journal bytes", async () => {
  const { root, view } = await fixture;
  const changed = structuredClone(view), launch = changed.tasks[0]?.launch;
  assert.ok(launch && "worker" in launch);
  const result = launch.worker.resources.children?.[0]?.result;
  assert.ok(result);
  const retained = JSON.parse(await readFile(result.evidence, "utf8"));
  retained.journalBytes = Buffer.from("unrelated child journal").toString("base64");
  result.evidence = join(root, "corrupt-writable-result.json");
  await writeFile(result.evidence, JSON.stringify(retained));
  await assert.rejects(verifyWritablePublicEvidence(changed));
});
