import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, realpath, lstat, readdir } from "node:fs/promises";
import { existsSync, appendFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import extension from "../src/extension.ts";
import { installTribunus, LocalTribunusHost } from "../src/tribunus-host.ts";

// Bounded installed SDK composition, NOT configured-shell launch or a #41 journey.
// Only Herdr allocation/startup and TUI/Trust context are controlled. A/B/C,
// tools, entries, native lifecycle, sockets and durable receipts are production.
assert.equal(VERSION, "1.2.0"); assert.equal(process.argv.length, 2);
const base = await realpath("/workspaces/astraprojects/.tmp");
const scratch = await realpath(process.env.TMPDIR ?? ""), root = await realpath(process.env.CORRECTIONS_RUNTIME ?? "");
for (const path of [scratch, root]) assert.ok(path.startsWith(base + sep) && path !== base);
assert.notEqual(root, scratch); assert.equal(process.env.TMP, process.env.TMPDIR); assert.equal(process.env.TEMP, process.env.TMPDIR);
const execute = promisify(execFile), json = async path => JSON.parse(await readFile(path, "utf8"));
const save = (name, value) => writeFile(join(root, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const project = fileURLToPath(new URL("..", import.meta.url));
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
assert.equal((await json(join(dirname(subagentsEntry), "package.json"))).version, "0.78.0");
const prior = { ...process.env }, settingsPath = join(prior.HOME, ".pi/agent/settings.json"), hostSettings = await readFile(settingsPath);
const realServer = JSON.parse((await execute("herdr", ["status", "server", "--json"])).stdout);
assert.equal(realServer.version, "0.9.1"); assert.equal(realServer.protocol, 22);
await save("versions.json", { pi: VERSION, subagents: "0.78.0", node: process.version, herdr: realServer });
const sourceFiles = ["scripts/verify-corrections.mjs", "src/intake.ts", "src/extension.ts", "src/resume.ts", "src/assignments.ts", "src/snapshot.ts", "src/tribunus.ts", "src/tribunus-host.ts", "src/tribunus-client.mjs", "src/git-workspace.ts"];
await save("source.json", { head: (await execute("git", ["rev-parse", "HEAD"], { cwd: project })).stdout.trim(), files: await Promise.all(sourceFiles.map(async path => ({ path, sha256: sha256(await readFile(join(project, path))) }))) });
const installedFiles = ["dist/core/agent-session.js", "dist/core/session-manager.js", "dist/core/resource-loader.js", "dist/core/tools/bash.js", "dist/core/tools/write.js", "dist/core/tools/read.js"].map(path => join(project, "node_modules/@earendil-works/pi-coding-agent", path));
await save("installed-source.json", await Promise.all([...installedFiles, subagentsEntry].map(async path => ({ path, sha256: sha256(await readFile(path)) }))));
async function until(check, label) {
  const deadline = Date.now() + 30000; // Observation failure only; never kill/settlement authority or a product cap.
  do { const value = await check(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error(`Unresolved ${label}; preserve exact runtime, no fallback/replay.`);
}
async function identity(pid) {
  const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return { pid, boot, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
}
const profile = join(root, "p"), checkout = join(root, "repo"), nativeTemp = join(root, "t"), bin = join(root, "b"), socket = join(root, "h.sock");
for (const path of [profile, checkout, nativeTemp, bin]) await mkdir(path, { recursive: true, mode: 0o700 });
Object.assign(process.env, { HOME: root, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_SUBAGENTS_TEMP_ROOT: join(root, "native"), TMPDIR: nativeTemp, TMP: nativeTemp, TEMP: nativeTemp });
for (const key of ["PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SESSION_FILE", "PI_SESSION_ID", "PI_ASYNC_NATIVE_RUNNER", "LEGION_TRIBUNUS_BOOTSTRAP", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete process.env[key];
await writeFile(join(profile, "settings.json"), JSON.stringify({ retry: { enabled: false } }), { mode: 0o600 });
const gitAt = async (cwd, ...args) => (await execute("git", ["-C", cwd, ...args])).stdout;
await gitAt(checkout, "init", "-q", "-b", "main");
await gitAt(checkout, "config", "user.name", "Native correction fixture"); await gitAt(checkout, "config", "user.email", "correction@example.invalid");
await writeFile(join(checkout, "label"), "base\n"); await gitAt(checkout, "add", "."); await gitAt(checkout, "commit", "-qm", "base");
const herdr = createServer(); await new Promise(resolve => herdr.listen(socket, resolve));
const stat = await lstat(socket), local = { endpoint: socket, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}` };
const rootManager = SessionManager.create(checkout, join(root, "sessions"));
const ownerWindow = { ...local, workspace: "fixture-w", tab: "fixture-owner-t", pane: "fixture-owner-p", terminal: "fixture-owner-term" };
const panes = {}, paneFile = join(root, "panes.json");
panes[ownerWindow.pane] = { workspace_id: ownerWindow.workspace, tab_id: ownerWindow.tab, pane_id: ownerWindow.pane, terminal_id: ownerWindow.terminal, foreground_cwd: checkout, agent: "pi", agent_session: { kind: "id", value: rootManager.getSessionId() } };
await save("panes.json", panes);
await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const a=process.argv.slice(2),p=JSON.parse(require('fs').readFileSync(${JSON.stringify(paneFile)},'utf8'));
if(a.join(' ')==='--version') console.log('0.9.1');
else if(a.join(' ')==='status server --json') console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));
else if(a[0]==='pane'&&a[1]==='get'&&p[a[2]]) console.log(JSON.stringify({result:{pane:p[a[2]]}}));
else if(a[0]==='pane'&&a[1]==='process-info'&&a[2]==='--pane'&&p[a[3]]) console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));
else {console.error('Unexpected controlled Herdr operation',a);process.exitCode=1;}
`, { mode: 0o700 });
Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: ownerWindow.pane });
const fork = join(prior.HOME, ".pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack");
const skillPaths = [join(fork, "skills/poteto-mode/SKILL.md"), join(project, "skills/herdr/SKILL.md"), ...["handoff", "matt-tdd", "matt-teach", "implement", "implement-spec", "code-review"].map(name => join(project, ".agents/skills", name, "SKILL.md"))];
for (const path of skillPaths) assert.ok(existsSync(path), path);
const actors = [], timeline = [], notices = [], statuses = [], forbiddenUi = [], errors = [], sends = [];
let sequence = 0, networkCalls = 0, rootSession, rootCtx, rootCommand, phase = "initial", step = 0, providerCalls = 0;
const correctionId = randomUUID(), releasePath = join(root, "release"), startedPath = join(root, "write-started");
const mark = (type, data = {}) => { const event = { sequence: ++sequence, at: new Date().toISOString(), type, ...data }; timeline.push(event); appendFileSync(join(root, "timeline.jsonl"), JSON.stringify(event) + "\n"); return event; };
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { networkCalls++; throw new Error("No network authorized"); };
const view = async () => { await rootCommand.handler("status --details", rootCtx); const message = notices.at(-1).message; assert.ok(message.includes("State\n"), message); return JSON.parse(message.split("State\n")[1]); };
const call = (id, name, args) => [{ type: "toolCall", id, name, arguments: args }];
async function rootResponse() {
  step++; const state = await view(), source = state.snapshot?.submissions.at(-1), task = state.tasks[0], record = state.snapshot?.corrections[0];
  const ref = source && { id: source.id, revision: source.revision };
  if (phase === "initial") {
    if (step === 1) return call("task", "legion_intake", { kind: "new-task", source: ref, goal: "Correct the existing label", acceptance: ["Preserve admitted work then correct label"], questions: [] });
    if (step === 2) return call("reserve", "legion_request", { command: `reserve ${task.id}@1 --parent refs/heads/main` });
    if (step === 3) return call("workspace-request", "legion_request", { command: `workspace ${state.snapshot.workspaceRequests.at(-1).id}` });
    if (step === 4) return call("workspace", "legion_workspace", { requestId: state.snapshot.workspaceRequests.at(-1).id });
    if (step === 5) return call("launch-request", "legion_request", { command: `launch ${task.id}@1` });
    if (step === 6) return call("launch", "legion_launch", { requestId: state.snapshot.launchRequests.at(-1).id });
  } else if (phase === "intake") {
    if (step === 1) return call("correction-intake", "legion_intake", { kind: "correction", id: correctionId, source: ref, target: { id: task.id, revision: 1 }, authorization: { kind: "technical" } });
  } else if (phase === "deliver" || phase === "verify") {
    if (step === 1) return call(`${phase}-conversation`, "legion_intake", { kind: "conversation", source: ref });
    const correction = { id: record.id, digest: record.digest };
    if (phase === "deliver" && step === 2) return call("delivery", "legion_correction", { correction, action: { kind: "deliver" } });
    if (phase === "verify") {
      if (step === 2) return call("legatus-read", "read", { path: join(actors[0].cwd, "label") });
      if (step === 3) return call("observation", "legion_correction", { correction, action: { kind: "observe" } });
      if (step === 4) return call("replay", "legion_correction", { correction, action: { kind: "deliver" } });
      if (step === 5) {
        const read = rootManager.getBranch().find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "legatus-read");
        assert.ok(read && !read.message.isError && JSON.stringify(read.message.content).includes("corrected"));
        assert.equal(await readFile(join(actors[0].cwd, "label"), "utf8"), "corrected\n");
        await save("performed-check.json", { path: join(actors[0].cwd, "label"), sha256: sha256(await readFile(join(actors[0].cwd, "label"))), diff: await gitAt(actors[0].cwd, "diff", "--", "label"), nativeRead: `${rootManager.getSessionFile()}#${read.id}` });
        return call("verification", "legion_correction", { correction, action: { kind: "verify", summary: "Legatus read the actual corrected label and checked its exact bytes/diff under unchanged assignment authority", evidence: [`${rootManager.getSessionFile()}#${read.id}`, join(root, "performed-check.json")] } });
      }
    }
  }
  return [{ type: "text", text: "Bounded stage finished; receipt/report is not correction verification or result acceptance." }];
}
function provider(actor) {
  return pi => pi.registerProvider("correction-local", { baseUrl: "http://fixture.invalid", apiKey: "not-a-credential", api: "correction-local", models: [{ id: "principal", name: "principal", reasoning: true, input: ["text"], contextWindow: 272000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      const stream = new AssistantMessageEventStream();
      queueMicrotask(async () => {
        try {
          let content;
          if (!actor) { providerCalls++; content = await rootResponse(); }
          else {
            actor.calls++; content = [{ type: "text", text: "Native stage settled; not accepted or verified." }];
            if (actor.calls === 2) content = call("inflight-write", "bash", { command: `printf 'started\\n' > '${startedPath}'; while [ ! -f '${releasePath}' ]; do sleep 0.02; done; printf 'authorized finished\\n' > label` });
            if (actor.calls === 4) content = call("correction-write", "write", { path: "label", content: "corrected\n" });
          }
          mark("provider", { principal: actor ? actor.launch.id : "root", phase, step, call: actor?.calls ?? providerCalls });
          const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content, stopReason: content[0].type === "toolCall" ? "toolUse" : "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
        } catch (error) {
          errors.push(String(error));
          const failed = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [], stopReason: "error", errorMessage: String(error), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "error", reason: "error", error: failed }); stream.end();
        }
      }); return stream;
    }
  });
}
const { default: nativeSubagents } = await import("pi-subagents");
function controlledContext(ctx, actor) {
  const ui = new Proxy(ctx.ui, { get(target, name) {
    if (name === "notify") return (message, level) => notices.push({ principal: actor ? actor.launch.id : "root", message, level });
    if (name === "setStatus") return (key, text) => statuses.push({ principal: actor ? actor.launch.id : "root", key, text });
    if (["confirm", "select", "custom", "setEditorComponent", "setFooter", "setWidget", "setEditorText", "setTitle"].includes(name)) return () => { forbiddenUi.push(String(name)); throw new Error(`Forbidden UI: ${String(name)}`); };
    return target[name];
  } });
  return new Proxy(ctx, { get(target, name) {
    if (name === "ui") return ui;
    if (name === "mode") return "tui";
    if (name === "isProjectTrusted") return () => true;
    return Reflect.get(target, name);
  } });
}
function adapt(pi, actor) {
  return { ...pi,
    registerTool: tool => pi.registerTool({ ...tool, execute: (id, input, signal, update, ctx) => tool.execute(id, input, signal, update, controlledContext(ctx, actor)) }),
    getCommands: () => [...pi.getCommands(), { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } }],
    getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? { ...tool, sourceInfo: { path: subagentsEntry } } : tool),
    registerCommand: (name, command) => {
      const adapted = { ...command, handler: (text, ctx) => { const controlled = controlledContext(ctx, actor); if (!actor) rootCtx = controlled; return command.handler(text, controlled); } };
      if (!actor && name === "legion") rootCommand = adapted;
      pi.registerCommand(name, adapted);
    },
    sendUserMessage: (text, options) => { sends.push({ principal: actor ? actor.launch.id : "root", text, options }); mark("native-send", { principal: actor ? actor.launch.id : "root", text, options }); pi.sendUserMessage(text, options); },
    on: (name, handler) => pi.on(name, (event, ctx) => { const controlled = controlledContext(ctx, actor); if (!actor) rootCtx = controlled; return handler(event, controlled); }),
  };
}
async function sdk(actor) {
  const cwd = actor?.cwd ?? checkout, manager = actor?.manager ?? rootManager;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, defaultProvider: "correction-local", defaultModel: "principal", defaultThinkingLevel: "high" });
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false }); provider(actor)(modelRuntime);
  const capture = pi => {
    for (const type of ["agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end", "message_end"]) pi.on(type, event => {
      if (actor && type === "tool_execution_start") actor.openTools.add(event.toolCallId);
      if (actor && type === "tool_execution_end") actor.openTools.delete(event.toolCallId);
      mark(type, { principal: actor ? actor.launch.id : "root", session: manager.getSessionId(), toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, role: event.message?.role });
    });
  };
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalSkillPaths: skillPaths, extensionFactories: [provider(actor), nativeSubagents, capture, pi => actor ? installTribunus(adapt(pi, actor), actor.bootstrap) : extension(adapt(pi, null))] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []); await save(`${actor?.launch.id ?? "root"}.discovery.json`, loader.getSkills());
  const { session } = await createAgentSession({ cwd, agentDir: profile, settingsManager, modelRuntime, resourceLoader: loader, sessionManager: manager, model: modelRuntime.getModel("correction-local", "principal"), thinkingLevel: "high", tools: actor ? ["read", "bash", "write", "subagent"] : ["read", "bash", "write", "subagent", "legion_intake", "legion_status", "legion_request", "legion_workspace", "legion_launch", "legion_handoff", "legion_correction"] });
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) }); return session;
}
const originalCreate = LocalTribunusHost.prototype.createWindow, originalStart = LocalTribunusHost.prototype.startPi;
// Invocation-local authorized SDK bootstrap seam, as in verify-handoff; no CLI fallback.
LocalTribunusHost.prototype.createWindow = async function ({ launch, cwd, workflowChoice, startupSelection }) {
  assert.equal(actors.length, 0, "Exactly one bounded worker; no replacement journey");
  const state = await view(), authority = { owner: state.snapshot.id, session: rootManager.getSessionId(), generation: state.snapshot.generation, epoch: state.snapshot.launchRequests.find(request => request.attempt === launch.id)?.epoch ?? 0 };
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  const window = { ...local, workspace: "fixture-w", tab: "fixture-worker-t", pane: "fixture-worker-p", terminal: "fixture-worker-term" };
  panes[window.pane] = { workspace_id: window.workspace, tab_id: window.tab, pane_id: window.pane, terminal_id: window.terminal, foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: manager.getSessionId() } }; await save("panes.json", panes);
  const launchRoot = join(profile, "legion/tribuni", launch.id); await mkdir(launchRoot, { recursive: true, mode: 0o700 });
  const bootstrap = join(launchRoot, "bootstrap.json");
  await writeFile(bootstrap, JSON.stringify({ launch, cwd, authority, workflowChoice, startupSelection, capability: randomUUID(), ownerProcess: { ...await identity(process.pid), window: ownerWindow } }), { mode: 0o600 });
  actors.push({ launch, cwd, manager, window, bootstrap, authority, calls: 0, openTools: new Set() }); mark("controlled-window", { launch: launch.id, cwd, window, authority }); return window;
};
LocalTribunusHost.prototype.startPi = async function () {
  const actor = actors[0]; process.env.HERDR_PANE_ID = actor.window.pane;
  try { actor.session = await sdk(actor); actor.hello = await json(join(dirname(actor.bootstrap), "hello.json")); mark("actual-sdk-identity", { hello: actor.hello }); }
  finally { process.env.HERDR_PANE_ID = ownerWindow.pane; }
};
async function passive(label) {
  const before = await view(), calls = providerCalls, sent = sends.length, branch = rootManager.getBranch().length;
  for (const text of ["/legion help", "/legion status", "/legion doctor", "/legion status --details"]) await rootSession.prompt(text);
  assert.deepEqual((await view()).snapshot, before.snapshot); assert.equal(providerCalls, calls); assert.equal(sends.length, sent); assert.equal(rootManager.getBranch().length, branch); assert.deepEqual(forbiddenUi, []);
  mark("passive-ui-checked", { label, providerCalls: calls, sends: sent, nativeEntries: branch });
}
async function stage(next, prompt) { phase = next; step = 0; await rootSession.prompt(prompt); await until(() => step > 0 && !rootSession.isStreaming, `root ${next} actual turn settlement`); await rootSession.waitForIdle(); }
try {
  rootSession = await sdk(null); await passive("inactive");
  await stage("initial", "/legion implement-spec=on Correct the existing label under unchanged approved scope");
  const actor = actors[0]; assert.ok(actor?.hello, `Worker startup unavailable; inspect ${join(root, "failure.json")}`);
  await until(() => existsSync(startedPath), "actual admitted in-flight Bash write");
  let state = await view(); assert.equal(state.tasks[0].launch.kind, "assigned", JSON.stringify(state.tasks));
  await stage("intake", `/legion correction ${state.tasks[0].id}@1 Set the existing label to corrected using the ordinary write tool`);
  state = await view(); assert.equal(state.snapshot.corrections[0].state.kind, "queued"); assert.equal(state.tasks[0].correctionHold, null);
  await stage("deliver", "Perform the saved technical correction safely after the admitted write finishes.");
  state = await view(); assert.deepEqual(state.snapshot.corrections[0].state, { kind: "queued", dispatch: "sent" });
  assert.ok(actor.openTools.has("inflight-write")); assert.equal(actor.calls, 2);
  const generationRoot = join(dirname(actor.bootstrap), actor.hello.address.generation);
  assert.ok(existsSync(join(generationRoot, `${correctionId}.correction-intent.json`)));
  assert.ok(!existsSync(join(generationRoot, `${correctionId}.correction-receipt.json`)));
  assert.ok(!sends.some(send => send.principal === actor.launch.id && send.text.includes(correctionId)));
  await passive("queued-busy");
  await save("queued.json", state); await writeFile(releasePath, "release admitted operation\n");
  const receiptPath = join(generationRoot, `${correctionId}.correction-receipt.json`);
  await until(() => existsSync(receiptPath), "actual durable correction user receipt");
  await until(() => actor.calls === 5 && !actor.session.isStreaming && actor.openTools.size === 0, "performed correction native settlement");
  await actor.session.waitForIdle();
  state = await view(); assert.equal(state.snapshot.corrections[0].state.kind, "queued", "Native report/settlement cannot auto-mark delivered or applied in Legatus state");
  const performed = actor.manager.getBranch().find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "correction-write");
  assert.ok(performed, "Actual native correction tool result required");
  if (performed.message.isError) {
    await save("blocked.json", { state, receipt: await json(receiptPath), result: performed, nativeResult: `${actor.hello.journal}#${performed.id}`, label: await readFile(join(actor.cwd, "label"), "utf8") });
    throw new Error(`Production correction execution refused: ${JSON.stringify(performed.message.content)}. Retain receipt/report; do not verify or claim compliance.`);
  }
  await until(async () => { state = await view(); return state.snapshot.effects.every(effect => effect.state.kind === "completed"); }, "durable completed correction effect observation");
  assert.ok(state.snapshot.effects.every(effect => effect.state.kind === "completed"));
  await passive("performed-unverified");
  await stage("verify", "Read and check the actual performed correction, observe the saved receipt, replay the same ID, then explicitly verify only with these checks.");
  state = await view(); assert.equal(state.snapshot.corrections[0].state.kind, "applied");
  assert.equal(state.snapshot.corrections[0].state.verification.by.session, rootManager.getSessionId()); assert.equal(state.tasks[0].correctionHold, null);
  const receipt = await json(receiptPath), safe = await json(join(generationRoot, `${correctionId}.correction-safe-point.json`));
  const entries = (await readFile(actor.hello.journal, "utf8")).trim().split("\n").map(JSON.parse);
  const users = entries.filter(entry => entry.message?.role === "user" && JSON.stringify(entry.message.content).includes(correctionId));
  assert.equal(users.length, 1, "Same-ID replay must not add another native correction entry"); assert.equal(users[0].id, receipt.state.receipt.entry);
  assert.equal(receipt.state.receipt.journal, actor.hello.journal);
  const safeEntry = entries.find(entry => entry.id === safe.entry); assert.equal(safeEntry.customType, "legion-correction-safe-point");
  const beforeResult = entries.findIndex(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "inflight-write");
  assert.ok(beforeResult >= 0 && beforeResult < entries.indexOf(safeEntry) && entries.indexOf(safeEntry) < entries.indexOf(users[0]));
  const end = timeline.find(event => event.type === "tool_execution_end" && event.toolCallId === "inflight-write");
  const send = timeline.find(event => event.type === "native-send" && event.principal === actor.launch.id && event.text.includes(correctionId));
  assert.ok(end.sequence < send.sequence); assert.equal(end.isError, false);
  const nativeSends = sends.filter(send => send.principal === actor.launch.id && send.text.includes(correctionId)); assert.equal(nativeSends.length, 1); assert.deepEqual(nativeSends[0].options, { expandPromptTemplates: false });
  await passive("explicitly-verified");
  const record = state.snapshot.corrections[0], { state: ignored, ...request } = record;
  const resumedAuthority = { ...actor.authority, generation: actor.authority.generation + 1 };
  const observer = new LocalTribunusHost(async () => { throw new Error("Observation cannot invoke effects/adoption"); }, resumedAuthority);
  const resumed = await observer.observeCorrection({ request }); assert.equal(resumed.state.kind, "unknown"); assert.match(resumed.state.message, /adoption/);
  assert.ok(!existsSync(join(generationRoot, `${resumedAuthority.generation}.controller.json`)));
  await save("resumed-observation.json", { authority: resumedAuthority, observation: resumed, qualification: "Focused B observation only; public resume adoption reachability assessed separately by source, not a restart journey" });
  assert.equal(networkCalls, 0); assert.deepEqual(errors, []); assert.deepEqual(await readFile(settingsPath), hostSettings);
  assert.equal((await readdir(generationRoot)).filter(name => name.endsWith(".centurio-intent.json")).length, 0);
  await save("state.json", state); await save("ui.json", { notices, statuses, forbiddenUi, sends });
  const result = { result: "bounded-native-correction-passed", root, process: await identity(process.pid), rootSession: rootManager.getSessionId(), rootJournal: rootManager.getSessionFile(), worker: actor.hello, correctionId, receiptPath, nativeUser: `${actor.hello.journal}#${users[0].id}`, nativeSafePoint: `${actor.hello.journal}#${safeEntry.id}`, admittedWriteResult: `${actor.hello.journal}#${entries[beforeResult].id}`, orderedWriteEnd: end.sequence, orderedCorrectionSend: send.sequence, networkCalls, realTabs: 0, childrenLaunched: 0, resumedObservation: resumed.state, changedAuthorityAcceptance: "NOT established; pending Emperor continuation decision" };
  await save("result.json", result); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await save("failure.json", { error: String(error), stack: error.stack, phase, step, errors, notices, actors: actors.map(actor => ({ launch: actor.launch.id, hello: actor.hello, openTools: [...actor.openTools], calls: actor.calls })) }); throw error;
} finally {
  // Release only the verifier synchronization gate; never abort an admitted effect.
  await writeFile(releasePath, "settle owned fixture operation\n");
  const cleanup = [];
  for (const actor of actors) if (actor.session) { await actor.session.waitForIdle(); assert.equal(actor.openTools.size, 0); await actor.session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); actor.session.dispose(); if (actor.hello) await until(() => !existsSync(actor.hello.endpoint), "exact worker socket closure"); cleanup.push({ session: actor.manager.getSessionId(), idleDisposed: true, openTools: actor.openTools.size, socketClosed: !actor.hello || !existsSync(actor.hello.endpoint) }); }
  if (rootSession) { await rootSession.waitForIdle(); await rootSession.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); rootSession.dispose(); }
  await new Promise(resolve => herdr.close(resolve));
  await save("cleanup.json", { actors: cleanup, rootDisposed: !!rootSession, controlledSocketClosed: true, runtimeRetained: root, scratch, realTabsOpened: [], realTabsClosed: [], realTabsRetained: [] });
  LocalTribunusHost.prototype.createWindow = originalCreate; LocalTribunusHost.prototype.startPi = originalStart;
  globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]; Object.assign(process.env, prior);
  console.error(`Retained #37 owned native runtime/evidence: ${root}`);
}
