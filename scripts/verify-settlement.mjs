import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, realpath, lstat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime, SessionManager, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { installTribunus } from "../src/tribunus-host.ts";
import { BoundedAssignment, Initialization, WorkerReport, WorkerStop } from "../src/tribunus.ts";
import { EffectMessage, EffectReply } from "../src/snapshot.ts";

// Bounded installed SDK evidence, not a real managed Herdr/TUI journey.
assert.equal(VERSION, "1.2.0");
const base = await realpath("/workspaces/astraprojects/.tmp");
const temp = await realpath(process.env.TMPDIR ?? "");
const root = await realpath(process.env.SETTLEMENT_RUNTIME ?? "");
assert.equal(process.argv.length, 2, "No alternative verification mode is supported");
for (const path of [temp, root]) assert.ok(path.startsWith(base + sep) && path !== base);
assert.notEqual(root, temp, "Runtime must be retained outside disposable scratch");
assert.equal(process.env.TMP, process.env.TMPDIR); assert.equal(process.env.TEMP, process.env.TMPDIR);
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const subagentsVersion = JSON.parse(await readFile(join(dirname(subagentsEntry), "package.json"))).version;
assert.equal(subagentsVersion, "0.78.0");
const versions = { pi: VERSION, subagents: subagentsVersion, node: process.version };
await writeFile(join(root, "versions.json"), JSON.stringify(versions, null, 2), { mode: 0o600, flag: "wx" });
const execute = promisify(execFile);
const json = async path => JSON.parse(await readFile(path, "utf8"));
const save = (name, value) => writeFile(join(root, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function until(check, label) {
  const deadline = Date.now() + 30000; // Observation bound only; expiry is failure, never settlement.
  do { const value = await check(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error(`Unresolved native observation: ${label}. Retain runtime; no fallback or kill.`);
}
function identity(pid) {
  return Promise.all([readFile("/proc/sys/kernel/random/boot_id", "utf8"), readFile(`/proc/${pid}/stat`, "utf8")])
    .then(([boot, stat]) => ({ pid, boot: boot.trim(), start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] }));
}
const prior = { ...process.env }, hostSettings = join(process.env.HOME, ".pi/agent/settings.json");
const hostBefore = await readFile(hostSettings);
const realServer = JSON.parse((await execute("herdr", ["status", "server", "--json"])).stdout);
const realPane = JSON.parse((await execute("herdr", ["pane", "get", process.env.HERDR_PANE_ID])).stdout).result.pane;
const realProcesses = JSON.parse((await execute("herdr", ["pane", "process-info", "--pane", realPane.pane_id])).stdout).result.process_info;
assert.equal(realServer.version, "0.9.1"); assert.equal(realServer.protocol, 22);
assert.equal(realPane.agent, "pi");
const realOwnerSession = realPane.agent_session.kind === "id" ? realPane.agent_session.value : JSON.parse((await readFile(realPane.agent_session.value, "utf8")).split("\n")[0]).id;
const realOwnerProcesses = await Promise.all(realProcesses.foreground_processes.map(p => identity(p.pid)));
await save("herdr-read-only.json", { server: realServer, pane: realPane, session: realOwnerSession, processes: realProcesses, proc: realOwnerProcesses });
await save("source.json", { head: (await execute("git", ["rev-parse", "HEAD"])).stdout.trim(), files: await Promise.all([fileURLToPath(import.meta.url), fileURLToPath(new URL("../src/centuriones.ts", import.meta.url)), fileURLToPath(new URL("../src/tribunus-host.ts", import.meta.url))].map(async path => ({ path, sha256: sha256(await readFile(path)) }))) });
const profile = join(root, "p"), cwd = join(root, "c");
for (const path of [profile, cwd, join(profile, "extensions/subagent")]) await mkdir(path, { recursive: true, mode: 0o700 });
// Fresh fixture profile only. No live settings, role mappings, credentials or runtime are changed.
Object.assign(process.env, { HOME: root, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_SUBAGENTS_TEMP_ROOT: join(root, "native"), PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))) });
for (const key of ["PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SESSION_FILE", "PI_SESSION_ID", "PI_ASYNC_NATIVE_RUNNER", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete process.env[key];
await writeFile(join(profile, "settings.json"), JSON.stringify({ retry: { enabled: false } }), { mode: 0o600 });
const providerPath = join(root, "provider.mjs");
await writeFile(join(cwd, "README.md"), "Native settlement read canary.\n");
// An ordinary custom-provider extension loads in the actual detached native runner.
await writeFile(providerPath, `import { AssistantMessageEventStream } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
export default function (pi) {
  const child = process.env.PI_SUBAGENT_CHILD === "1";
  globalThis.fetch = async () => { appendFileSync(${JSON.stringify(join(root, "network-attempts"))}, "blocked\\n"); throw new Error("Network forbidden in settlement check"); };
  let calls = 0;
  pi.registerProvider("settlement-local", { baseUrl: "http://fixture.invalid", apiKey: "not-a-credential", api: "settlement-local", models: ["parent", "child", "principal"].map(id => ({ id, name: id, reasoning: id === "principal", input: ["text"], contextWindow: 272000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    streamSimple(model) {
      const call = ++calls;
      if (call > (model.id === "principal" ? 5 : 2)) throw new Error("Unexpected inference");
      appendFileSync(${JSON.stringify(join(root, "provider-requests.jsonl"))}, JSON.stringify({ child, call, pid: process.pid, model: model.provider + "/" + model.id }) + "\\n");
      const principal = model.id === "principal";
      const tool = principal ? call === 2 || call === 4 : call === 1;
      const content = tool ? [principal
        ? { type: "toolCall", id: call === 2 ? "principal-write" : "late-write", name: "write", arguments: { path: call === 2 ? "effect.txt" : "late.txt", content: "Authorized local effect." } }
        : { type: "toolCall", id: child ? "child-read" : "native-launch", name: child ? "read" : "subagent", arguments: child ? { path: ${JSON.stringify(join(cwd, "README.md"))} } : JSON.parse(readFileSync(${JSON.stringify(join(root, "launch.json"))}, "utf8")) }]
        : [{ type: "text", text: "Local lifecycle complete." }];
      const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content, stopReason: tool ? "toolUse" : "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = new AssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    }
  });
  if (child) pi.on("agent_before_settle", async () => {
    appendFileSync(${JSON.stringify(join(root, "child-before-settle"))}, "waiting\\n");
    while (!existsSync(${JSON.stringify(join(root, "release-child"))})) await delay(20);
  });
}
`, { mode: 0o600 });
const launch = { agent: "settlement-canary", task: "Perform one local read and finish. No work or delegation.", async: true, cwd, worktree: false, artifacts: true };
await save("launch.json", launch);
let childSession, childPrompt, childPromptError, nativeDetails;
const errors = [], activity = [], childEvents = [];
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("Network forbidden"); };
async function sdk(factories, modelId, extra = {}) {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const runtime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  (await import(providerPath)).default(runtime);
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [providerPath], extensionFactories: factories });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: profile, settingsManager: settings, modelRuntime: runtime, model: runtime.getModel("settlement-local", modelId), resourceLoader: loader, ...extra });
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  return session;
}
// Real Pi lifecycle and production handler; only the named external boundaries are controlled.
async function verifyPrincipal(nativeSubagents) {
  const bin = join(root, "b"), socket = join(root, "h.sock");
  await mkdir(bin, { mode: 0o700 });
  const herdr = createServer();
  await new Promise(resolve => herdr.listen(socket, resolve));
  const stat = await lstat(socket), ownerSession = "settlement-controller";
  const window = { endpoint: socket, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}`, workspace: "fixture-w", tab: "fixture-owner-t", pane: "fixture-owner-p", terminal: "fixture-owner-term" };
  const manager = SessionManager.create(cwd, join(root, "principal-sessions"));
  const pane = { workspace_id: window.workspace, tab_id: "fixture-worker-t", pane_id: "fixture-worker-p", terminal_id: "fixture-worker-term", foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: manager.getSessionId() } };
  const ownerPane = { ...pane, tab_id: window.tab, pane_id: window.pane, terminal_id: window.terminal, agent_session: { kind: "id", value: ownerSession } };
  // This executable handles read-only identity/status calls only; unexpected operations fail.
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a.join(' ') === '--version') console.log('0.9.1');
else if (a.join(' ') === 'status server --json') console.log(JSON.stringify({ status: 'running', running: true, version: '0.9.1', protocol: 22, compatible: true, endpoint_compatible: true, restart_needed: false, socket: ${JSON.stringify(socket)} }));
else if (a[0] === 'pane' && a[1] === 'get' && ['fixture-worker-p', 'fixture-owner-p'].includes(a[2])) console.log(JSON.stringify({ result: { pane: a[2] === 'fixture-worker-p' ? ${JSON.stringify(pane)} : ${JSON.stringify(ownerPane)} } }));
else if (a[0] === 'pane' && a[1] === 'process-info' && a[2] === '--pane' && ['fixture-worker-p', 'fixture-owner-p'].includes(a[3])) console.log(JSON.stringify({ result: { process_info: { foreground_processes: [{ pid: ${process.pid} }] } } }));
else { console.error('Unexpected controlled Herdr operation', a); process.exitCode = 1; }
`, { mode: 0o700 });
  const launch = { id: randomUUID(), reservation: randomUUID(), revision: 1, scope: "One fixture filesystem write and settlement observation", state: { kind: "prepared" } };
  const authority = { owner: randomUUID(), session: ownerSession, generation: 1, epoch: 0 };
  const workflowChoice = { profile: "matt", requestedWorkflow: "implement-spec" };
  const capability = "private-local-settlement-fixture", launchRoot = join(profile, "legion/tribuni", launch.id);
  await mkdir(launchRoot, { recursive: true, mode: 0o700 });
  const bootstrap = join(launchRoot, "bootstrap.json");
  await writeFile(bootstrap, JSON.stringify({ launch, cwd, authority, workflowChoice, capability, ownerProcess: { ...await identity(process.pid), window } }), { mode: 0o600 });
  const fork = join(prior.HOME, ".pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack");
  const discovery = [
    { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } },
    ...["herdr", "matt-tdd", "matt-teach", "implement-spec", "handoff", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: `/controlled/${name}/SKILL.md` } })),
  ];
  const before = { PATH: process.env.PATH, HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
  Object.assign(process.env, { PATH: `${bin}:${before.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: pane.pane_id });
  let session, hello, lateTurn, releaseEffect, releasePrincipal, backendEntries = 0, turns = 0;
  const effectGate = new Promise(resolve => { releaseEffect = resolve; });
  const principalGate = new Promise(resolve => { releasePrincipal = resolve; });
  const events = [], notices = [], transport = [], clients = new Set();
  let admission;
  const capture = pi => {
    pi.registerTool(createWriteToolDefinition(cwd, { operations: {
      mkdir: path => mkdir(path, { recursive: true }),
      writeFile: async (path, content) => {
        backendEntries++;
        assert.equal(path, join(cwd, "effect.txt"), "Only the admitted first write may reach the backend");
        await save("principal-backend-entry.json", { path, content, backendEntries, events: [...events] });
        await effectGate;
        await writeFile(path, content);
      },
    } }));
    lateTurn = () => pi.sendMessage({ customType: "settlement-late-effect", content: "Local late effect refusal canary", display: false }, { triggerTurn: true });
    pi.on("session_start", (_event, ctx) => { ctx.ui.notify = message => notices.push(message); });
    for (const type of ["agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end"])
      pi.on(type, event => { if (type === "agent_start") turns++; events.push({ turn: turns, ...event, type }); });
    pi.on("agent_before_settle", async () => {
      if (turns === 2) {
        await save("principal-before-settle.json", { events: [...events], backendEntries });
        await principalGate;
      }
    });
  };
  const controlledWorker = pi => installTribunus({ ...pi,
    getCommands: () => [...pi.getCommands(), ...discovery],
    getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? { ...tool, sourceInfo: { path: subagentsEntry } } : tool),
    on: (name, handler) => pi.on(name, (event, ctx) => handler(event, { ...ctx, mode: "tui", isProjectTrusted: () => true })),
  }, bootstrap);
  async function control(kind, command, assignment = null, extra = {}) {
    const request = { capability, authority, reservation: launch.reservation, scope: launch.scope, address: hello.address, kind, command, assignment, ...extra };
    return new Promise((resolve, reject) => {
      const client = createConnection(hello.endpoint); clients.add(client);
      let data = "";
      client.on("connect", () => client.write(JSON.stringify(request) + "\n"));
      client.on("data", chunk => { data += chunk; });
      client.on("error", reject);
      client.on("close", () => { clients.delete(client); try { const response = JSON.parse(data); transport.push({ request, response }); resolve(response); } catch (error) { reject(error); } });
    });
  }
  try {
    session = await sdk([nativeSubagents, capture, controlledWorker], "principal", { sessionManager: manager, thinkingLevel: "high", tools: ["write", "subagent"] });
    assert.deepEqual(errors, []);
    hello = await json(join(launchRoot, "hello.json"));
    assert.equal(hello.address.session, manager.getSessionId());
    const generation = join(launchRoot, hello.address.generation);
    const receipt = (command, suffix) => join(generation, `${command}.${suffix}.json`);
    const initialized = await control("initialize", randomUUID());
    assert.equal(initialized.kind, "ok", JSON.stringify(initialized));
    const initialization = Initialization.parse(initialized.value);
    assert.equal(initialization.profile, "matt");
    await session.waitForIdle();
    assert.equal(events.filter(e => e.type === "agent_settled").length, 1);
    const assignmentCommand = randomUUID();
    const assignment = BoundedAssignment.parse({ task: { id: randomUUID(), revision: 1 }, scope: launch.scope, goal: "Write effect.txt once; preserve it through safe-stop", acceptance: ["One local effect settles before parking"], workflowChoice, workflow: "implement-spec", authority: "bounded-implementation-only" });
    // Controlled parent admission transports the exact production intent; it does not create native events or bypass tool guards.
    admission = until(async () => {
      const files = (await readdir(generation)).filter(name => name.endsWith(".effect-request.json"));
      if (!files.length) return false;
      assert.equal(files.length, 1);
      const envelope = await json(join(generation, files[0]));
      assert.equal(envelope.capability, capability); assert.equal(envelope.assignment, assignmentCommand); assert.deepEqual(envelope.address, hello.address);
      const message = EffectMessage.parse(envelope.message); assert.equal(message.kind, "effect-admission");
      const { intent } = message;
      assert.deepEqual(intent.pin, { ...authority, task: assignment.task, scope: assignment.scope, reservation: launch.reservation, assignment: assignmentCommand, launch: launch.id, workerSession: hello.address.session, workerGeneration: hello.address.generation, addressDigest: sha256(JSON.stringify(hello.address)) });
      assert.equal(intent.call.id, "principal-write"); assert.equal(intent.call.name, "write");
      assert.deepEqual(intent.call.input, { path: "effect.txt", content: "Authorized local effect." });
      assert.deepEqual(intent.call.rawInput, intent.call.input);
      const [journal, entry] = intent.call.journal.split("#"); assert.equal(journal, hello.journal);
      assert.ok((await readFile(journal, "utf8")).trim().split("\n").map(JSON.parse).some(e => e.id === entry && e.message?.role === "assistant" && e.message.content.some(c => c.type === "toolCall" && c.id === intent.call.id && c.name === "write" && JSON.stringify(c.arguments) === JSON.stringify(intent.call.input))));
      const reply = EffectReply.parse({ kind: "effect", effect: { intent, digest: sha256(JSON.stringify(intent)), state: { kind: "outstanding" } } });
      await writeFile(receipt(`${assignmentCommand}.${intent.id}`, "effect-response"), JSON.stringify(reply), { mode: 0o600, flag: "wx" });
      return { envelope, reply };
    }, "exact applied-assignment effect admission");
    // Attach rejection immediately so a setup error cannot become an unhandled rejection.
    let admissionError; const admitted = admission.catch(error => { admissionError = error; });
    const applied = await control("assign", assignmentCommand, assignment);
    assert.equal(applied.kind, "ok", JSON.stringify(applied)); assert.ok(applied.value?.application);
    assert.deepEqual(await json(receipt(assignmentCommand, "applied")), applied.value);
    const [journal, userEntry] = applied.value.application.split("#");
    assert.ok((await readFile(journal, "utf8")).trim().split("\n").map(JSON.parse).some(e => e.id === userEntry && e.message?.role === "user" && JSON.stringify(e.message.content).includes(`Legion bounded assignment ${assignmentCommand}`)));
    await until(() => { if (admissionError) throw admissionError; return existsSync(join(root, "principal-backend-entry.json")); }, "actual gated write backend entry, not tool_execution_start");
    const effectAdmission = await admitted; if (admissionError) throw admissionError;
    assert.equal(backendEntries, 1); assert.equal(existsSync(join(cwd, "effect.txt")), false);
    assert.equal(events.filter(e => e.turn === 2 && e.type === "agent_settled").length, 0);
    assert.equal(events.some(e => e.toolCallId === "principal-write" && e.type === "tool_execution_end"), false);
    const shutdown = randomUUID();
    const stop = await control("stop", shutdown, null, { currentCommand: assignmentCommand });
    assert.equal(stop.kind, "ok", JSON.stringify(stop));
    const draining = WorkerStop.parse(stop.value); assert.equal(draining.state.kind, "draining");
    assert.equal(draining.command, assignmentCommand); assert.equal(draining.shutdown, shutdown); assert.deepEqual(draining.address, hello.address);
    assert.equal(existsSync(receipt(shutdown, "park")), false); assert.equal(existsSync(receipt(assignmentCommand, "report")), false);
    await save("principal-draining.json", { initialization, assignmentCommand, assignment, applied, effectAdmission, draining, events: [...events], backendEntries });
    releaseEffect();
    await until(() => existsSync(join(root, "principal-before-settle.json")), "principal native pre-settle gate after effect completion");
    assert.equal(await readFile(join(cwd, "effect.txt"), "utf8"), "Authorized local effect.");
    const observation = EffectMessage.parse((await json(receipt(`${assignmentCommand}.${effectAdmission.reply.effect.intent.id}`, "effect-observation"))).message);
    assert.equal(observation.kind, "effect-observation"); assert.equal(observation.digest, effectAdmission.reply.effect.digest);
    assert.equal(observation.state.kind, "completed"); assert.equal(observation.state.isError, false);
    assert.ok(existsSync(observation.state.evidence));
    assert.ok(events.some(e => e.turn === 2 && e.type === "agent_end"));
    assert.equal(events.some(e => e.turn === 2 && e.type === "agent_settled"), false);
    const stillDraining = await control("stop", shutdown, null, { currentCommand: assignmentCommand });
    assert.equal(stillDraining.value.state.kind, "draining");
    assert.equal(existsSync(receipt(shutdown, "park")), false); assert.equal(existsSync(receipt(assignmentCommand, "report")), false);
    await save("principal-effect-settled-only.json", { observation, stillDraining, events: [...events] });
    releasePrincipal(); await session.waitForIdle();
    await until(() => existsSync(receipt(shutdown, "park")), "production report and park after genuine principal agent_settled");
    assert.ok(events.some(e => e.turn === 2 && e.type === "agent_settled"));
    const report = WorkerReport.parse(await json(receipt(assignmentCommand, "report")));
    const park = WorkerStop.parse(await json(receipt(shutdown, "park")));
    assert.equal(report.command, assignmentCommand); assert.deepEqual(report.address, hello.address); assert.equal(report.outcome, "reported-result");
    assert.ok(report.evidence.includes(observation.state.evidence)); assert.equal(park.state.kind, "parked");
    assert.deepEqual(park.state.evidence, [receipt(assignmentCommand, "report")]);
    const lateAssignment = await control("assign", randomUUID(), assignment);
    const lateInitialization = await control("initialize", randomUUID());
    for (const response of [lateAssignment, lateInitialization]) { assert.equal(response.kind, "held"); assert.match(response.message, /Retiring worker cannot restore assignment authority/); }
    lateTurn(); await session.waitForIdle();
    const lateEnd = events.find(e => e.type === "tool_execution_end" && e.toolCallId === "late-write");
    assert.ok(lateEnd, JSON.stringify(events)); assert.equal(lateEnd.isError, true); assert.equal(lateEnd.durationMs, undefined);
    assert.match(JSON.stringify(lateEnd.result), /Worker is retiring/);
    assert.equal(backendEntries, 1); assert.equal(existsSync(join(cwd, "late.txt")), false);
    assert.equal((await readdir(generation)).filter(name => name.endsWith(".effect-request.json")).length, 1);
    assert.deepEqual(await json(receipt(shutdown, "park")), park); assert.deepEqual(errors, []);
    const result = { initialization, assignmentCommand, assignment, applied, effectAdmission, observation, draining, report, park, lateAssignment, lateInitialization, lateEnd, backendEntries, hello, events, transport, notices };
    await save("principal-settled.json", result);
    return { session: hello.address.session, generation: hello.address.generation, assignment: assignmentCommand, shutdown, backendEntries, park: park.state.kind, lateAssignment: lateAssignment.kind, lateEffect: "refused-before-backend" };
  } catch (error) {
    await save("principal-failure.json", { error: String(error), stack: error.stack, hello, events, transport, notices, backendEntries });
    throw error;
  } finally {
    releaseEffect(); releasePrincipal();
    if (session) { await session.waitForIdle(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); session.dispose(); }
    if (admission) await admission.catch(() => {});
    assert.equal(clients.size, 0, "No live control clients may be discarded");
    if (hello) await until(() => !existsSync(hello.endpoint), "production generation socket close");
    await new Promise(resolve => herdr.close(resolve));
    await save("principal-cleanup.json", { sdkSessionIdleAndDisposed: !!session, controlledSocketClosed: true, generationSocketClosed: !hello || !existsSync(hello.endpoint), backendEntries, clients: clients.size });
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}
try {
  const { default: nativeSubagents } = await import("pi-subagents");
  const principal = await verifyPrincipal(nativeSubagents);
  let registration;
  const capture = pi => {
    pi.on("session_start", () => {
      const request = { version: 1, name: launch.agent, definition: { description: "Deterministic native lifecycle canary", systemPrompt: "One local read, no delegation.", tools: ["read"], model: "settlement-local/child", extensions: [providerPath], allowNestedSubagents: false, acceptanceRole: "read-only" } };
      pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
      assert.ok(request.result?.ok, String(request.result?.error)); registration = request.result.registration;
    });
    for (const kind of ["started", "complete"]) pi.events.on(`subagent:async-${kind}`, raw => activity.push({ kind, raw }));
    pi.on("tool_execution_end", event => { if (event.toolName === "subagent") { assert.equal(event.isError, false, JSON.stringify(event)); nativeDetails = event.result.details; } });
    pi.on("session_shutdown", () => registration?.dispose());
  };
  childSession = await sdk([nativeSubagents, capture], "parent", { tools: ["subagent"] });
  childPrompt = childSession.prompt("Run the one authorized deterministic native canary.").catch(error => { childPromptError = error; });
  await until(() => { if (childPromptError) throw childPromptError; assert.deepEqual(errors, []); return nativeDetails?.asyncDir && existsSync(join(root, "child-before-settle")); }, "native launch and child agent_before_settle");
  assert.ok(nativeDetails?.runId, JSON.stringify({ nativeDetails, errors }));
  assert.ok((await realpath(nativeDetails.asyncDir)).startsWith(root + sep), "Actual child runtime routing");
  const pendingStatus = await json(join(nativeDetails.asyncDir, "status.json"));
  const pendingEvents = (await readFile(join(nativeDetails.asyncDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(pendingEvents.some(e => e.subagentSource === "child" && e.type === "agent_start"));
  assert.equal(pendingEvents.some(e => e.subagentSource === "child" && e.type === "agent_settled"), false);
  assert.notEqual(pendingStatus.processTerminal?.state, "observed", "agent_end/prose does not establish process settlement");
  await save("child-pending.json", { status: pendingStatus, events: pendingEvents });
  await writeFile(join(root, "release-child"), "release");
  await childPrompt; if (childPromptError) throw childPromptError;
  const proof = await until(async () => { const path = join(nativeDetails.asyncDir, "process-terminal.json"); if (!existsSync(path)) return false; const value = await json(path); return value.state === "observed" && value; }, "exact native runner close");
  const status = await json(join(nativeDetails.asyncDir, "status.json"));
  assert.equal(status.lifecycleArtifactVersion, 3); assert.equal(status.runId, nativeDetails.runId);
  assert.ok([childSession.sessionManager.getSessionId(), childSession.sessionManager.getSessionFile()].includes(status.sessionId));
  assert.equal(status.cwd, cwd); assert.equal(status.steps.length, 1); assert.equal(status.steps[0].agent, launch.agent);
  assert.deepEqual(status.processTerminal, proof); assert.equal(proof.runId, nativeDetails.runId);
  const runners = proof.instances.filter(p => p.kind === "runner");
  assert.equal(runners.length, 1); assert.equal(runners[0].processInstanceId, proof.runnerProcessInstanceId);
  assert.equal(runners[0].exitCode, 0); assert.equal(runners[0].signal, null);
  childEvents.push(...(await readFile(join(nativeDetails.asyncDir, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse).filter(e => e.subagentSource === "child"));
  for (const event of childEvents) { assert.equal(event.subagentRunId, status.runId); assert.equal(event.subagentStepIndex, 0); assert.equal(event.subagentAgent, launch.agent); }
  assert.ok(childEvents.some(e => e.type === "agent_settled"));
  const starts = childEvents.filter(e => e.type === "tool_execution_start"), ends = childEvents.filter(e => e.type === "tool_execution_end");
  assert.equal(starts.length, 1); assert.equal(ends.length, 1); assert.equal(starts[0].toolCallId, ends[0].toolCallId); assert.equal(ends[0].isError, false);
  const journal = status.steps[0].sessionFile ?? status.sessionFile;
  const entries = (await readFile(journal, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(entries[0].cwd, cwd); assert.notEqual(entries[0].id, childSession.sessionManager.getSessionId());
  assert.ok(entries.some(e => e.message?.role === "toolResult" && e.message.toolCallId === starts[0].toolCallId && !e.message.isError && JSON.stringify(e.message.content).includes("Native settlement read canary.")));
  await until(() => activity.some(e => e.kind === "complete"), "native async completion correlation");
  for (const { raw } of activity) { assert.equal(raw.id, status.runId); assert.equal(raw.runId ?? raw.id, status.runId); assert.equal(raw.cwd, cwd); assert.equal(raw.asyncDir, nativeDetails.asyncDir); assert.equal(raw.agent, launch.agent); assert.equal(raw.sessionId, status.sessionId); }
  await save("child-settled.json", { pi: VERSION, subagents: subagentsVersion, nativeDetails, status, proof, journal, childSession: entries[0].id, activity, events: childEvents });
  await childSession.waitForIdle(); await childSession.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); childSession.dispose(); childSession = null;
  assert.equal(networkCalls, 0); assert.equal(existsSync(join(root, "network-attempts")), false);
  assert.deepEqual(errors, []); assert.deepEqual(await readFile(hostSettings), hostBefore);
  const result = { result: "bounded-native-settlement-passed", ...versions, runtime: root, principal, nativeDetails, childOutcome: status.state, runner: runners[0], networkCalls: 0, tabsCreated: 0, errors,
    limitations: ["Principal TUI/trust/Herdr/discovery and parent effect admission are explicitly controlled external boundaries, not a full Legatus/Tribunus journey", "Native child artifacts checked against Centuriones joins in a separate SDK session, not a prepared production Centuriones launch", "No owner disappearance, permission matrix or #41 installed journey exercised"] };
  await save("result.json", result); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await save("failure.json", { error: String(error), nativeDetails, errors, activity });
  throw error;
} finally {
  // Release fixture-owned work, never signal/cancel it or claim release is settlement.
  await writeFile(join(root, "release-child"), "release");
  if (childPrompt) await childPrompt;
  if (nativeDetails?.asyncDir) await until(async () => { const path = join(nativeDetails.asyncDir, "process-terminal.json"); return existsSync(path) && (await json(path)).state === "observed"; }, "cleanup exact native runner settlement");
  if (childSession) { await childSession.waitForIdle(); await childSession.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); childSession.dispose(); }
  await save("cleanup.json", { nativeRun: nativeDetails?.runId ?? null, nativeTerminal: nativeDetails?.asyncDir ? (await json(join(nativeDetails.asyncDir, "process-terminal.json"))).state : null, sdkSessionIdleAndDisposed: true, runtimeRetained: root, disposable: temp });
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  Object.assign(process.env, prior);
  console.error(`Retained runtime (do not disposable-clean): ${root}`);
}
