import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access, mkdir, writeFile, readFile, copyFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
async function projectContainer() {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain", "-z"]);
  const primary = stdout.split("\0")[0];
  assert.ok(primary !== undefined && primary.startsWith("worktree "), "Fixture requires the primary Git project identity.");
  const project = await realpath(primary.slice("worktree ".length));
  return join(dirname(project), `worktrees-${basename(project)}_legion`);
}
test("production Centurio trial refuses arbitrary new cwd before creating or launching a fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-trial-script-"));
  const absent = join(root, "unapproved-run");
  await assert.rejects(exec(process.execPath, [resolve("scripts/verify-t04-production-centurio.mjs"), absent, "read-effects", "fixture-owner"], { env: { ...process.env, HERDR_ENV: "1" } }), error =>
    error instanceof Error && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("Trial cwd must be in a unique owned run directory"));
  await assert.rejects(access(absent), error => error instanceof Error && "code" in error && error.code === "ENOENT");
});

test("production Centurio script selects the exact admitted launch result, not an earlier management refusal", async () => {
  const container = await projectContainer();
  const root = join(container, randomUUID().slice(0, 7));
  assert.ok(Buffer.byteLength(join(root, "owner.sock")) < 108, "Fixture must fit the existing native Unix socket limit.");
  await mkdir(container, { recursive: true });
  await mkdir(root, { mode: 0o700 });
  const evidence = join(root, "evidence"), cwd = join(root, "repo"), bin = join(root, "bin");
  for (const directory of [evidence, cwd, bin, join(root, "owned"), join(cwd, ".pi", "extensions")]) await mkdir(directory, { recursive: true });
  const journal = join(evidence, "principal.jsonl");
  const launch = { agent: "fixture-centurio", task: "fixture-only", cwd, model: "openai-codex/gpt-6-luna" };
  const owner = { session: "fixture-principal" };
  const pane = { pane_id: "fixture-pane", tab_id: "fixture-tab", terminal_id: "fixture-terminal", workspace_id: "fixture-workspace" };
  const refused = { toolName: "subagent", toolCallId: "unrelated-models", isError: true, result: { content: [{ type: "text", text: "Native child input differs from every exact durable intent. No launch." }] } };
  const admitted = { toolName: "subagent", toolCallId: "exact-launch", isError: false, result: { details: { runId: "fixture-run", asyncDir: join(root, "absent-native-status") } } };
  await writeFile(journal, JSON.stringify({ type: "message", message: { role: "assistant", content: [
    { type: "toolCall", id: refused.toolCallId, name: "subagent", arguments: { action: "models" } },
    { type: "toolCall", id: admitted.toolCallId, name: "subagent", arguments: launch },
  ] } }) + "\n");
  await writeFile(join(evidence, "actor.json"), JSON.stringify({ name: "fixture-actor", cwd, mode: "read-effects", pane }));
  await writeFile(join(evidence, "principal.json"), JSON.stringify({ owner, launch, journal }));
  const source = resolve("src/centurio-guard.ts");
  await writeFile(join(evidence, "source.json"), JSON.stringify([{ path: source, sha256: createHash("sha256").update(await readFile(source)).digest("hex") }]));
  await writeFile(join(evidence, "permission-source.ts"), "fixture-policy-not-executed");
  await writeFile(join(cwd, ".pi", "extensions", "permissions.ts"), "fixture-policy-not-executed");
  await writeFile(join(evidence, "native-result.json"), JSON.stringify(refused));
  await writeFile(join(evidence, "native-calls.jsonl"), [refused, admitted].map(value => JSON.stringify(value)).join("\n") + "\n");
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(evidence, "adapter-commands.jsonl"))}, JSON.stringify(args)+'\\n');
if (args[0] === 'pane' && args[1] === 'get') console.log(JSON.stringify({result:{pane:{agent:'pi',agent_session:{kind:'id',value:'fixture-legatus'},workspace_id:'fixture-workspace'}}}));
else if (args[0] === 'agent' && args[1] === 'get') console.log(JSON.stringify({result:{agent:{...${JSON.stringify(pane)}, foreground_cwd:${JSON.stringify(cwd)}, agent_session:{kind:'id',value:'fixture-principal'}}}}));
else throw new Error('Fixture must not receive launch, prompt, approval or layout effects.');
`, { mode: 0o755 });
  await assert.rejects(exec(process.execPath, [resolve("scripts/verify-t04-production-centurio.mjs"), root, "read-effects", "fixture-legatus", "observe"], { env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "fixture-caller", PATH: `${bin}:${process.env.PATH}` } }), error => error instanceof Error && "code" in error && error.code === 1);
  const selected = JSON.parse(await readFile(join(evidence, "selected-native-result.json"), "utf8"));
  assert.equal(selected.event.toolCallId, admitted.toolCallId, "BEHAVIOR exact admitted launch result selected rather than unrelated refusal");
  assert.deepEqual(JSON.parse(await readFile(join(evidence, "native-result.json"), "utf8")), refused, "Earlier evidence remains unchanged.");
  const commands = (await readFile(join(evidence, "adapter-commands.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  assert.ok(commands.every(args => args[1] === "get"));
  // This fixture intentionally stops after selection at absent native status. It is not live acceptance evidence.
});

async function rootDenialObservationFixture(container: string, script = resolve("scripts/verify-t04-production-centurio.mjs")) {
  const root = join(container, randomUUID().slice(0, 7));
  assert.ok(Buffer.byteLength(join(root, "owner.sock")) < 108, "Fixture must fit the existing native Unix socket limit.");
  await mkdir(container, { recursive: true });
  await mkdir(root, { mode: 0o700 });
  const evidence = join(root, "evidence"), cwd = join(root, "repo"), bin = join(root, "bin");
  for (const directory of [evidence, cwd, bin, join(root, "owned"), join(cwd, ".pi", "extensions")]) await mkdir(directory, { recursive: true });
  const journal = join(evidence, "principal.jsonl");
  const launch = { agent: "fixture-centurio", task: "fixture-only", cwd, model: "openai-codex/gpt-6-luna" };
  const owner = { session: "fixture-principal" };
  const pane = { pane_id: "fixture-pane", tab_id: "fixture-tab", terminal_id: "fixture-terminal", workspace_id: "fixture-workspace" };
  const refused = { type: "tool_execution_end", toolName: "subagent", toolCallId: "exact-denied-launch", isError: true, result: { content: [{ type: "text", text: "Independent test-owned ordinary permission policy denied this exact effect." }] } };
  await writeFile(journal, JSON.stringify({ type: "message", message: { role: "assistant", content: [
    { type: "toolCall", id: refused.toolCallId, name: "subagent", arguments: launch },
  ] } }) + "\n");
  await writeFile(join(evidence, "actor.json"), JSON.stringify({ name: "fixture-actor", cwd, mode: "root-deny", pane }));
  await writeFile(join(evidence, "principal.json"), JSON.stringify({ owner, launch, journal }));
  const source = resolve("src/centurio-guard.ts");
  await writeFile(join(evidence, "source.json"), JSON.stringify([{ path: source, sha256: createHash("sha256").update(await readFile(source)).digest("hex") }]));
  await writeFile(join(evidence, "permission-source.ts"), "fixture-policy-not-executed");
  await writeFile(join(cwd, ".pi", "extensions", "permissions.ts"), "fixture-policy-not-executed");
  await writeFile(join(evidence, "native-calls.jsonl"), JSON.stringify(refused) + "\n");
  await writeFile(join(evidence, "permissions.jsonl"), [
    { child: false, kind: "loaded", session: owner.session },
    { child: false, kind: "denied", session: owner.session, event: { type: "tool_call", toolName: "subagent", toolCallId: refused.toolCallId, input: launch } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  const liveBytes = Buffer.from('{ "verdict": "ROOT_PERMISSION_DENIAL_PASS", "liveSentinel": true }\n');
  await writeFile(join(evidence, "result.json"), liveBytes);
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(evidence, "adapter-commands.jsonl"))}, JSON.stringify(args)+'\\n');
if (args[0] === 'pane' && args[1] === 'get') console.log(JSON.stringify({result:{pane:{agent:'pi',agent_session:{kind:'id',value:'fixture-legatus'},workspace_id:'fixture-workspace'}}}));
else if (args[0] === 'agent' && args[1] === 'get') console.log(JSON.stringify({result:{agent:{...${JSON.stringify(pane)}, foreground_cwd:${JSON.stringify(cwd)}, agent_session:{kind:'id',value:'fixture-principal'}}}}));
else throw new Error('Fixture must not receive launch, prompt, approval or layout effects.');
`, { mode: 0o755 });
  return { root, evidence, liveBytes, run: () => exec(process.execPath, [script, root, "root-deny", "fixture-legatus", "observe"], {
    env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "fixture-caller", PATH: `${bin}:${process.env.PATH}` },
  }) };
}

test("root-denial observation preserves the original live summary bytes", async () => {
  const fixture = await rootDenialObservationFixture(await projectContainer());
  const result = await fixture.run();
  assert.ok(result.stdout.includes("ROOT_PERMISSION_DENIAL_PASS"));
  assert.deepEqual(await readFile(join(fixture.evidence, "result.json")), fixture.liveBytes, "BEHAVIOR root-denial observation leaves live summary bytes unchanged");
  const summary = JSON.parse(await readFile(join(fixture.evidence, "retrospective-result.json"), "utf8"));
  assert.equal(summary.verdict, "ROOT_PERMISSION_DENIAL_PASS");
  assert.equal(summary.retrospective, true);
  const commands = (await readFile(join(fixture.evidence, "adapter-commands.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  assert.ok(commands.every(args => args[1] === "get"));
});

test("linked-checkout trial uses the original primary project container", async () => {
  const projectParent = await mkdtemp(join(tmpdir(), "lg-cli-"));
  const primary = join(projectParent, "primary");
  const container = join(projectParent, "worktrees-primary_legion");
  const linked = join(container, "task");
  await mkdir(primary);
  await exec("git", ["init", "-q", "-b", "main", primary]);
  await exec("git", ["-C", primary, "worktree", "add", "--orphan", "-b", "linked-fixture", linked]);
  await mkdir(join(linked, "scripts"));
  const script = join(linked, "scripts", "verify-t04-production-centurio.mjs");
  await copyFile(resolve("scripts/verify-t04-production-centurio.mjs"), script);
  const fixture = await rootDenialObservationFixture(container, script);
  const result = await fixture.run().then(value => ({ ...value, exitCode: 0 }), error => {
    assert.ok(error instanceof Error && "code" in error && typeof error.code === "number" && "stderr" in error && typeof error.stderr === "string");
    return { exitCode: error.code, stdout: "", stderr: error.stderr };
  });
  assert.equal(result.exitCode, 0, `BEHAVIOR linked-checkout trial uses primary project container\n${result.stderr}`);
  assert.ok(result.stdout.includes("ROOT_PERMISSION_DENIAL_PASS"));
  assert.equal(dirname(fixture.root), container);
  assert.deepEqual(await readFile(join(fixture.evidence, "result.json")), fixture.liveBytes);
  await assert.rejects(access(join(container, "worktrees-task_legion")), error => error instanceof Error && "code" in error && error.code === "ENOENT");
  const commands = (await readFile(join(fixture.evidence, "adapter-commands.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  assert.ok(commands.every(args => args[1] === "get"));
});

async function lifecycleObservationFixture(kind: "logical-terminal" | "process-terminal") {
  const fixture = await rootDenialObservationFixture(await projectContainer());
  const cwd = join(fixture.root, "repo"), owned = join(fixture.root, "owned"), native = join(fixture.root, "native");
  await mkdir(native);
  const actor = JSON.parse(await readFile(join(fixture.evidence, "actor.json"), "utf8"));
  actor.mode = "allowed";
  await writeFile(join(fixture.evidence, "actor.json"), JSON.stringify(actor));
  const owner = { session: "fixture-principal" }, id = randomUUID(), run = randomUUID(), runner = randomUUID();
  const binding = { path: join(owned, "intent.json"), digest: "fixture-digest" };
  const journal = join(fixture.evidence, "principal.jsonl"), childJournal = join(native, "child.jsonl");
  const launch = { agent: "fixture-centurio", cwd, model: "controlled/selected", extensionBindings: { "pi-legion/1": binding } };
  const proof = { version: 1, state: "observed", runId: run, runnerProcessInstanceId: runner, observedAt: 200, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: 100, exitCode: 0, signal: null }] };
  const status = { runId: run, cwd, sessionId: owner.session, completionOwnerId: "fixture-completion-owner", launchContractDigest: "fixture-contract", launchResolvedExtensions: { required: ["pi-legion-centurio"] }, steps: [{ agent: launch.agent, model: launch.model, requestedModel: launch.model, context: "fresh", sessionFile: childJournal }], processTerminal: proof };
  await writeFile(join(native, "status.json"), JSON.stringify(status));
  await writeFile(join(native, "process-terminal.json"), JSON.stringify(proof));
  await writeFile(journal, JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "launch", name: "subagent", arguments: launch }] } }) + "\n");
  await writeFile(join(fixture.evidence, "principal.json"), JSON.stringify({ owner, launch, journal }));
  await writeFile(join(fixture.evidence, "native-calls.jsonl"), JSON.stringify({ toolName: "subagent", toolCallId: "launch", isError: false, result: { details: { runId: run, asyncDir: native, launchContractDigest: "fixture-contract" } } }) + "\n");
  await writeFile(binding.path, JSON.stringify({ digest: binding.digest, intent: { id, owner, role: { model: launch.model }, cwd } }));
  await writeFile(join(owned, `${id}.centurio-startup.json`), JSON.stringify({ kind: "startup-authorized", owner, child: { session: "fixture-child", journal: childJournal, binding, model: launch.model, cwd } }));
  const final = { type: "message", id: "completed-finding", parentId: "read-result", timestamp: "2026-10-09T12:00:01Z", message: { role: "assistant", provider: "controlled", model: "selected", stopReason: "stop", content: [{ type: "text", text: "Completed fixture findings." }] } };
  const childBytes = [
    { type: "session", id: "fixture-child", cwd },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: join(cwd, "README.md") } }] } },
    { type: "message", timestamp: "2026-10-09T12:00:00Z", message: { role: "toolResult", toolCallId: "read", isError: false, content: [{ type: "text", text: "Production Centurio reads this disposable file.\n" }] } },
    final,
  ].map(value => JSON.stringify(value)).join("\n") + "\n";
  await writeFile(childJournal, childBytes);
  const retainedPath = join(owned, "retained.json"), proofPath = join(owned, "process-proof.json");
  const sha256 = createHash("sha256").update("Completed fixture findings.").digest("hex");
  await writeFile(proofPath, JSON.stringify(proof));
  await writeFile(retainedPath, JSON.stringify({ source: `${childJournal}#${final.id}`, sha256, bytes: Buffer.from("Completed fixture findings.").toString("base64"), message: { id: final.id, type: final.type, message: { role: "assistant", stopReason: "stop", content: final.message.content } }, journalBytes: Buffer.from(childBytes).toString("base64"), journalSha256: createHash("sha256").update(childBytes).digest("hex") }));
  await writeFile(join(owned, "projection.centuriones.json"), JSON.stringify({ sequence: 1, children: [{ id, state: { kind, run, session: "fixture-child", proof: proofPath }, result: { evidence: retainedPath, source: `${childJournal}#${final.id}`, sha256 } }] }));
  await writeFile(join(fixture.evidence, "native-activity.jsonl"), JSON.stringify({ kind: "complete", raw: { id: run, runId: run, sessionId: owner.session, completionOwnerId: status.completionOwnerId, asyncDir: native, sessionFile: childJournal } }) + "\n");
  return { retainedPath, run: () => exec(process.execPath, [resolve("scripts/verify-t04-production-centurio.mjs"), fixture.root, "allowed", "fixture-legatus", "observe"], {
    env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "fixture-caller", PATH: `${join(fixture.root, "bin")}:${process.env.PATH}` },
  }) };
}

test("production lifecycle verifier refuses logical completion even with independent close evidence", async () => {
  const fixture = await lifecycleObservationFixture("logical-terminal");
  await assert.rejects(fixture.run(), error => error instanceof Error && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("Production child lifecycle must independently settle to process-terminal"));
});

test("production lifecycle verifier joins projected findings to preserved full native journal bytes", async () => {
  const fixture = await lifecycleObservationFixture("process-terminal");
  assert.match((await fixture.run()).stdout, /OWNED_READ_ONLY_LIFECYCLE_PASS/);
});

test("production lifecycle verifier refuses findings with corrupted retained native journal bytes", async () => {
  const fixture = await lifecycleObservationFixture("process-terminal");
  const retained = JSON.parse(await readFile(fixture.retainedPath, "utf8"));
  retained.journalBytes = Buffer.from("Not the independently observed native journal").toString("base64");
  await writeFile(fixture.retainedPath, JSON.stringify(retained));
  await assert.rejects(fixture.run(), error => error instanceof Error && "code" in error && error.code === 1 && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("Retained full native journal bytes must match"));
});
