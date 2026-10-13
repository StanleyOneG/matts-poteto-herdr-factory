import { registerAgent } from "pi-subagents/agents";
import { listRuntimeAgentConfigs } from "../../node_modules/pi-subagents/src/agents/runtime-agent-registry.js";
import { resolveRequiredChildExtensions } from "../../node_modules/pi-subagents/src/shared/required-child-extensions.js";
import { buildInProcessChildLaunch } from "../../node_modules/pi-subagents/src/runs/shared/child-launch.js";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile, exec as shell } from "node:child_process";
import { promisify } from "node:util";
import { createServer, connect } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import extension from "../../src/extension.ts";
import { installTribunus, LocalTribunusHost } from "../../src/tribunus-host.ts";
import { Legion } from "../../src/intake.ts";
import { stripFrontmatter, createReadTool, createReadToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, loadSkills, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";

const execute = promisify(execFile), executeShell = promisify(shell);
const pstack = "/home/vscode/.pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack";
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const skill = join(pstack, "skills/poteto-mode/SKILL.md");
const commands = [{ name: "pstack", source: "extension", sourceInfo: { path: join(pstack, "extensions/pstack/index.ts") } }, ...["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "implement-spec", "handoff", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: name === "poteto-mode" ? skill : ["implement", "implement-spec"].includes(name) ? fileURLToPath(new URL(`../../.agents/skills/${name}/SKILL.md`, import.meta.url)) : `/controlled/${name}/SKILL.md` } }))];
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) { if (await predicate()) return; await delay(5); }
  throw new Error(`Fixture timeout. ${label}`);
}
function runtime(cwd, session, journal) {
  fs.writeFileSync(journal, JSON.stringify({ type: "session", id: session, cwd }) + "\n");
  const handlers = new Map(), tools = new Map(), registeredCommands = new Map(), entries = [], prompts = [], notices = [], statuses = [], sent = [];
  const nativeTools = new Map([createReadToolDefinition(cwd), createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd), createBashToolDefinition(cwd), createEditToolDefinition(cwd), createWriteToolDefinition(cwd)].map(tool => [tool.name, tool]));
  let discovered = commands, onBranch = null;
  let idle = true, pending = false, rootCall = null, onIdle = null, onAuth = null, authenticated = true, sendFailure = false;
  const consumed = new Set();
  const append = entry => { const result = { id: randomUUID(), ...entry }; entries.push(result); fs.appendFileSync(journal, JSON.stringify(result) + "\n"); return result; };
  const model = { provider: "controlled", id: "selected", api: "controlled-chat", name: "Controlled principal", reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null }, input: ["text"], contextWindow: 272000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const ctx = {
    mode: "tui", cwd, isProjectTrusted: () => true,
    isIdle: () => { const hook = onIdle; onIdle = null; hook?.(); return idle; },
    hasPendingMessages: () => pending,
    sessionManager: { getSessionId: () => session, getSessionFile: () => journal, getBranch: () => { const hook = onBranch; onBranch = null; hook?.(); return entries; }, getLeafId: () => entries.at(-1)?.id },
    ui: { notify: message => notices.push(message), setStatus: (key, text) => statuses.push({ key, text }) },
    getContextUsage: () => usage,
    model, thinkingLevel: "high",
    modelRegistry: { find: (provider, id) => provider === model.provider && id === model.id ? model : undefined, getProvider: () => ({}), getError: () => undefined, getAvailable: () => [model], getApiKeyAndHeaders: async () => { throw new Error("Legion must not resolve or refresh credentials"); }, hasConfiguredAuth: () => { const hook = onAuth; onAuth = null; hook?.(); return authenticated; } },
    executeTool: async (name, input) => { const id = `${rootCall}/nested/${randomUUID()}`; const result = await call(name, input, id, rootCall); return { ...(result.result ? result : { result }), toolCall: { id, name, arguments: input }, isError: result.isError ?? false }; }
  };
  let usage = { tokens: 1000, contextWindow: 272000, percent: 0.37 };
  const events = new EventEmitter();
  const pi = {
    events: { emit: (name, value) => events.emit(name, value), on: (name, handler) => { events.on(name, handler); return () => events.off(name, handler); } },
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, command) => registeredCommands.set(name, command),
    getCommands: () => [...discovered, ...[...registeredCommands.keys()].map(name => ({ name, source: "extension" }))],
    getSettings: () => ({}), getThinkingLevel: () => ctx.thinkingLevel,
    getAllTools: () => [...["read", "grep", "find", "ls", "bash", "write", "edit"].map(name => ({ name, sourceInfo: { path: tools.has(name) ? "controlled-legion-extension" : `builtin:${name}` } })), ...["subagent", "subagents_enable"].map(name => ({ name, exposure: "model-only", sourceInfo: { path: subagentsEntry } }))],
    sendMessage: (message, options) => { sent.push({ message, options }); return append({ type: "custom_message", ...message }); },
    appendEntry: (customType, data) => append({ type: "custom", customType, data }),
    sendUserMessage: prompt => { prompts.push(prompt); if (sendFailure) { sendFailure = false; throw new Error("Controlled send outcome uncertain after enqueue"); } }
  };
  events.on("pi-subagents:runtime-agent-register:v1", request => {
    try { request.result = { ok: true, registration: registerAgent({ pi, name: request.name, definition: request.definition }) }; }
    catch (error) { request.result = { ok: false, error }; }
  });
  async function emit(name, event = {}) {
    let result;
    for (const handler of handlers.get(name) ?? []) {
      const next = await handler(event, ctx);
      if (next !== undefined) result = next;
      if (next?.action === "handled" || next?.block) break;
    }
    return result;
  }
  let external = null;
  async function call(name, input, id = randomUUID(), parentToolCallId) {
    const call = { type: "toolCall", id, name, arguments: structuredClone(input) };
    if (!parentToolCallId) append({ type: "message", message: { role: "assistant", content: [call], stopReason: "toolUse" } });
    const previous = rootCall; rootCall = id;
    try {
      let result, executed = false;
      await emit("tool_execution_start", { toolName: name, toolCallId: id, args: call.arguments });
      try {
        const definition = tools.get(name) ?? nativeTools.get(name);
        if (definition) {
          const prepared = definition.prepareArguments ? definition.prepareArguments(call.arguments) : call.arguments;
          input = validateToolArguments(definition, { type: "toolCall", id, name, arguments: prepared });
        }
        const guard = await emit("tool_call", { toolName: name, toolCallId: id, input, ...(parentToolCallId ? { parentToolCallId } : {}) });
        if (guard?.block) result = { isError: true, content: [{ type: "text", text: guard.reason }], details: guard };
        else {
          executed = true;
          result = tools.has(name) ? await tools.get(name).execute(id, input, undefined, undefined, ctx) : external ? (await external(name, input)) ?? await nativeTools.get(name).execute(id, input, undefined, undefined, ctx) : await nativeTools.get(name).execute(id, input, undefined, undefined, ctx);
          if (result.result) result = result.result;
        }
      } catch (error) { result = { content: [{ type: "text", text: String(error) }], isError: true }; }
      if (executed) {
        const transformed = await emit("tool_result", { toolName: name, toolCallId: id, input, ...result, isError: result.isError ?? false });
        if (transformed) result = { ...result, ...transformed };
      }
      await emit("tool_execution_end", { toolName: name, toolCallId: id, result, isError: result.isError ?? false, ...(executed ? { durationMs: 1 } : {}), ...(parentToolCallId ? { parentToolCallId } : {}) });
      if (!parentToolCallId) {
        const entry = append({ type: "message", message: { role: "toolResult", toolName: name, toolCallId: id, ...result, isError: result.isError ?? false } });
        await emit("message_end", { message: entry.message });
      }
      return result;
    } finally { rootCall = previous; }
  }
  async function start(prompt, native = false, source = "extension") {
    if (prompt.startsWith("Legion ")) assert.equal(consumed.has(prompt), false, "The external Pi fixture cannot replay a consumed host marker");
    consumed.add(prompt);
    const input = await emit("input", { source, text: prompt });
    if (input?.action === "handled") return false;
    if (!authenticated) throw new Error("Controlled native Pi authentication refusal before agent_start");
    const skillInput = /^\/skill:([^ ]+)(?: ([\s\S]*))?$/.exec(prompt);
    const skillName = skillInput?.[1];
    const skill = discovered.find(command => command.name === `skill:${skillName}` && command.source === "skill")?.sourceInfo.path;
    const expanded = input?.action === "transform" ? input.text : skill ? `<skill name="${skillName}" location="${skill}">\nReferences are relative to ${dirname(skill)}.\n\n${stripFrontmatter(fs.readFileSync(skill, "utf8")).trim()}\n</skill>${skillInput[2]?.trim() ? `\n\n${skillInput[2].trim()}` : ""}` : prompt;
    idle = false; // Pi 1.2 marks the run busy before the user before_agent_start hook.
    const prepared = await emit("before_agent_start", { messageType: "user", prompt: expanded, systemPrompt: "Controlled external model" });
    if (prepared?.message) append({ type: "custom_message", ...prepared.message });
    await emit("agent_start");
    const user = { role: "user", content: [{ type: "text", text: expanded }] };
    await emit("message_end", { message: user });
    append({ type: "message", message: user });
    await emit("context", { messages: [user] });
    await new Promise(resolve => setImmediate(resolve));
    return true;
  }
  async function startCustom() {
    idle = false;
    const message = { role: "custom", customType: "subagent-update", content: "Ordinary native child result.", display: true };
    const prepared = await emit("before_agent_start", { messageType: "custom", message, systemPrompt: "Controlled native completion" });
    await emit("agent_start");
    append({ type: "custom_message", ...message });
    await emit("context", { messages: [message] });
    return prepared;
  }
  async function settle(native = false, text = "Waiting.", stopReason = "stop") {
    assert.equal(idle, false, "Only an admitted model turn can emit agent_settled");
    if (native) pi.appendEntry("pstack-mode", { enabled: true });
    append({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason } });
    await emit("turn_end");
    idle = true;
    await emit("agent_settled");
  }
  return { pi, ctx, prompts, notices, statuses, sent, setUsage: value => { usage = value; }, emit, call, start, startCustom, settle, invoke: (name, text) => registeredCommands.get(name)?.handler(text, ctx), onBranch: hook => { onBranch = hook; }, resources: value => { discovered = value; }, setAuth: value => { authenticated = value; }, failSend: () => { sendFailure = true; }, setPending: value => { pending = value; }, setIdle: value => { idle = value; }, onIdle: hook => { onIdle = hook; }, onAuth: hook => { onAuth = hook; }, external: handler => { external = handler; }, command: text => registeredCommands.has("legion") ? registeredCommands.get("legion").handler(text, ctx) : "Command /legion is unavailable in this session." };
}

export async function exerciseChildStartup(inherited) {
  const root = await mkdtemp(join(tmpdir(), "legion-child-startup-"));
  const child = runtime(root, randomUUID(), join(root, "child.jsonl"));
  const prior = { PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD, LEGION_TRIBUNUS_BOOTSTRAP: process.env.LEGION_TRIBUNUS_BOOTSTRAP };
  const bootstrap = join(root, "principal-bootstrap.json");
  fs.writeFileSync(bootstrap, JSON.stringify({
    launch: { id: randomUUID(), reservation: randomUUID(), revision: 0, scope: "child-isolation-trial", state: { kind: "prepared" } },
    cwd: root, capability: "disposable-principal-capability", authority: { owner: randomUUID(), session: "principal", generation: 1, epoch: 0 }
  }), { mode: 0o600 });
  let initializationError = null;
  try {
    process.env.PI_SUBAGENT_CHILD = "1";
    if (inherited) process.env.LEGION_TRIBUNUS_BOOTSTRAP = bootstrap;
    else delete process.env.LEGION_TRIBUNUS_BOOTSTRAP;
    try { extension(child.pi); } catch (error) { initializationError = String(error); }
    const command = await child.command("task Create an unauthorized child-owned graph");
    const result = { initializationError, command, inheritedBootstrap: process.env.LEGION_TRIBUNUS_BOOTSTRAP ?? null };
    fs.writeFileSync(join(root, "outcome.json"), JSON.stringify(result, null, 2));
    return { root, ...result };
  } finally {
    await child.emit("session_shutdown");
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

export async function exerciseNativeAssignment(scenario = "write", census) {
  const kind = scenario === "readiness" ? "readiness" : "native";
  // Keep the actual generation-specific Unix endpoint below the platform path limit on disk-backed TMPDIR.
  const root = await mkdtemp(join(tmpdir(), "lc-")), profile = join(root, "a"), repo = join(root, "repo"), bin = join(root, "bin");
  assert.ok(Buffer.byteLength(join(profile, "legion", "tribuni", `s-${"a".repeat(32)}.sock`)) < 108, "Controlled fixture TMPDIR is too long for the exact native host endpoint");
  await mkdir(profile); await mkdir(repo); await mkdir(bin);
  if (census?.childCase === "project-container") {
    await mkdir(join(root, "worktrees-repo_legion"));
    await writeFile(join(root, "worktrees-repo_legion", "unrelated-sentinel.txt"), "Preserve existing container contents.");
  }
  await execute("git", ["init", "-q", "-b", "main", repo]);
  await execute("git", ["-C", repo, "-c", "user.name=Trial", "-c", "user.email=trial@example.invalid", "commit", "--allow-empty", "-qm", "base"]);
  const prior = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD };
  delete process.env.PI_SUBAGENT_CHILD;
  Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, PI_CODING_AGENT_DIR: profile, HERDR_ENV: "1", HERDR_PANE_ID: "controlled-pane" });
  const server = createServer(), socket = join(root, "herdr.sock"), paneFile = join(root, "pane.json"), createdFile = join(root, "created.json");
  await new Promise(resolve => server.listen(socket, resolve));
  const pane = { workspace_id: "controlled-workspace", tab_id: "controlled-tab", pane_id: "controlled-pane", terminal_id: "controlled-terminal", foreground_cwd: repo, agent: "pi", agent_session: { kind: "id", value: census?.childCase === "unknown-caller" ? "foreign-controller" : "composed-controller" } };
  await writeFile(paneFile, JSON.stringify(pane));
  const callerFile = join(root, "caller.json");
  await writeFile(callerFile, JSON.stringify(pane));
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);const file=${JSON.stringify(paneFile)};let pane=JSON.parse(fs.readFileSync(a[0]==='pane'&&a[1]==='get'&&a[2]==='controlled-pane'?${JSON.stringify(callerFile)}:file));if(a[0]==='--version')console.log('0.9.1');else if(a[0]==='status')console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));else if(a[0]==='workspace'||a[0]==='tab'){fs.writeFileSync(${JSON.stringify(join(root, "layout-command.json"))},JSON.stringify(a));delete pane.agent;delete pane.agent_session;pane.tab_id='controlled-worker-tab';pane.pane_id='controlled-worker-pane';pane.foreground_cwd=a[a.indexOf('--cwd')+1];fs.writeFileSync(file,JSON.stringify(pane));fs.writeFileSync(${JSON.stringify(createdFile)},JSON.stringify({bootstrap:a[a.indexOf('--env')+1].split('=').slice(1).join('=')}));console.log(JSON.stringify({result:{root_pane:pane}}));}else if(a[1]==='get')console.log(JSON.stringify({result:{pane}}));else console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${census?.childCase === "caller-process" ? process.pid + 1 : process.pid}}]}}}));\n`, { mode: 0o700 });
  let workerDescriptor = null;
  let worker = null, originalTimer = globalThis.setTimeout, scheduled = [], workerFailure = null;
  const controller = runtime(repo, "composed-controller", join(root, "controller.jsonl"));
  globalThis.setTimeout = (callback, milliseconds, ...args) => milliseconds === 0 ? (scheduled.push(() => callback(...args)), { unref() {} }) : originalTimer(callback, milliseconds, ...args);
  const drain = async () => { const batch = scheduled; scheduled = []; for (const callback of batch) callback(); await delay(20); };
  controller.external(async (name, { command }) => {
    if (name !== "bash") return undefined;
    let output, exitCode = 0;
    if (command.startsWith("herdr agent start ")) {
      await writeFile(join(root, "startup-command.json"), JSON.stringify(command));
      const { bootstrap } = JSON.parse(await readFile(createdFile, "utf8"));
      const descriptor = JSON.parse(await readFile(bootstrap, "utf8"));
      workerDescriptor = descriptor;
      worker = runtime(descriptor.cwd, randomUUID(), join(root, "worker.jsonl"));
      worker.pi.sendUserMessage = prompt => {
        worker.prompts.push(prompt);
        void (async () => { const poteto = prompt.startsWith("/skill:"); const init = poteto || prompt.startsWith("Legion native initialization "); await worker.start(prompt, poteto); if (init) { if (census?.disableBeforeSettle) worker.onBranch(() => worker.pi.appendEntry("pstack-mode", { enabled: false })); await worker.settle(poteto); } })().catch(error => { workerFailure = error; });
      };
      if (census?.initialMode !== undefined) worker.pi.appendEntry("pstack-mode", { enabled: census.initialMode });
      if (census?.missingWorkerSkill) worker.resources(commands.filter(command => command.name !== `skill:${census.missingWorkerSkill}`));
      installTribunus(worker.pi, bootstrap);
      process.env.HERDR_PANE_ID = "controlled-worker-pane";
      try { await worker.emit("session_start"); }
      finally { process.env.HERDR_PANE_ID = "controlled-pane"; }
      if (scenario === "native-pre-assignment") {
        let invoked = 0;
        worker.external(async () => { invoked++; return { content: [], details: {} }; });
        const result = await worker.call("subagent", { agent: "worker", task: "Unassigned writer", async: false, worktree: false });
        try {
          assert.equal(result.isError, true, "BEHAVIOR managed native execution before assignment must be visibly refused");
          assert.equal(invoked, 0, "Unassigned native execution must not reach the native runner");
        } catch (error) { workerFailure = error; throw error; }
        assert.equal((await worker.call("subagent", { action: "status" })).isError ?? false, false, "Native inspection is available before assignment");
        assert.equal((await worker.call("subagents_enable", {})).isError ?? false, false);
        assert.equal((await worker.call("subagent", { action: "watchdog.configure", model: "recommended", options: { scope: "session" } })).isError, true, "Settings management requires an applied assignment");
        worker.external(null);
      }
      const actualPane = JSON.parse(await readFile(paneFile, "utf8"));
      await writeFile(paneFile, JSON.stringify({ ...actualPane, agent: "pi", agent_session: { kind: "id", value: worker.ctx.sessionManager.getSessionId() } }));
      output = JSON.stringify({ started: true });
    } else {
      try { output = (await executeShell(command)).stdout; }
      catch (error) {
        if (typeof error.code !== "number" || error.signal) throw error;
        output = error.stdout + error.stderr; exitCode = error.code;
      }
    }
    return { result: { structuredContent: { output, exit_code: exitCode, truncated: false }, content: [{ type: "text", text: output }] } };
  });
  if (kind === "readiness") {
    const scenario = census?.readinessCase;
    if (scenario === "small-legatus") controller.ctx.model.contextWindow = 271999;
    if (scenario === "missing-model") controller.ctx.model = undefined;
    if (scenario === "missing-auth") controller.setAuth(false);
    if (scenario === "missing-provider") controller.ctx.modelRegistry.getProvider = () => undefined;
    if (scenario === "unsupported-thinking") controller.ctx.model.thinkingLevelMap.high = null;
    if (scenario === "unknown-window") controller.ctx.model.contextWindow = undefined;
    if (scenario === "actual-unsupported-registered-supported") {
      const registered = { ...controller.ctx.model, thinkingLevelMap: { ...controller.ctx.model.thinkingLevelMap } };
      controller.ctx.modelRegistry.find = () => registered;
      controller.ctx.modelRegistry.getAvailable = () => [registered];
      controller.ctx.model.thinkingLevelMap.high = null;
    }
    if (scenario === "actual-small-registered-large") {
      const registered = { ...controller.ctx.model };
      controller.ctx.modelRegistry.find = () => registered;
      controller.ctx.modelRegistry.getAvailable = () => [registered];
      controller.ctx.model.contextWindow = 271999;
    }
    if (scenario === "exact-override-missing") {
      await mkdir(join(repo, ".pi"));
      await writeFile(join(repo, ".pi", "legion.json"), JSON.stringify({ tribuni_model: { model: "controlled/not-selected", thinking: "high" } }));
    }
    if (scenario === "invalid-settings") {
      await mkdir(join(repo, ".pi"));
      await writeFile(join(repo, ".pi", "legion.json"), "{bad-json");
    }
    if (scenario === "missing-pi-contract") controller.pi.sendUserMessage = undefined;
    if (["unknown-subagents", "unsupported-subagents", "missing-subagents", "hidden-subagents", "pre-1.2-subagents"].includes(scenario)) {
      const discoveredTools = controller.pi.getAllTools();
      const unsupported = join(root, "unsupported-subagents");
      if (["unsupported-subagents", "pre-1.2-subagents"].includes(scenario)) {
        await mkdir(unsupported);
        await writeFile(join(unsupported, "package.json"), JSON.stringify({ name: "pi-subagents", version: scenario === "pre-1.2-subagents" ? "0.77.0" : "9.9.9" }));
      }
      controller.pi.getAllTools = () => discoveredTools.flatMap(tool => tool.name !== "subagent" ? [tool]
        : scenario === "missing-subagents" ? []
        : [{ ...tool, exposure: scenario === "hidden-subagents" ? "hidden" : tool.exposure, sourceInfo: { path: ["unsupported-subagents", "pre-1.2-subagents"].includes(scenario) ? join(unsupported, "index.js") : scenario === "unknown-subagents" ? join(root, "unknown/index.js") : tool.sourceInfo.path } }]);
    }
    if (["same-version-npm", "foreign-fork-origin", "foreign-poteto-skill"].includes(scenario)) {
      const foreign = join(root, "foreign-pstack");
      await mkdir(foreign);
      await writeFile(join(foreign, "package.json"), JSON.stringify({ name: "@zenspc/pi-pstack", version: "0.6.0", repository: { type: "git", url: scenario === "same-version-npm" ? "https://github.com/zenspc/pi-pstack.git" : "git+https://github.com/StanleyOneG/stanley-pi-pstack.git" } }));
      await mkdir(join(foreign, "extensions/pstack"), { recursive: true });
      await mkdir(join(foreign, "skills/poteto-mode"), { recursive: true });
      await writeFile(join(foreign, "extensions/pstack/index.ts"), "fixture");
      await writeFile(join(foreign, "skills/poteto-mode/SKILL.md"), "fixture");
      await execute("git", ["init", "-q", foreign]);
      await execute("git", ["-C", foreign, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "add", "."]);
      await execute("git", ["-C", foreign, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"]);
      await execute("git", ["-C", foreign, "remote", "add", "origin", "https://github.com/foreign/pstack.git"]);
      controller.resources(commands.map(command => command.name === (scenario === "foreign-poteto-skill" ? "skill:poteto-mode" : "pstack") ? { ...command, sourceInfo: { path: join(foreign, scenario === "foreign-poteto-skill" ? "skills/poteto-mode/SKILL.md" : "extensions/pstack/index.ts") } } : command));
    }
    if (scenario === "wrong-fork-skill") controller.resources(commands.map(command => command.name === "skill:poteto-mode" ? { ...command, sourceInfo: { path: join(pstack, "skills/why/SKILL.md") } } : command));
    if (["missing-handoff", "missing-implement-spec"].includes(scenario)) controller.resources(commands.filter(command => command.name !== `skill:${scenario.slice("missing-".length)}`));
    if (["missing-pstack", "unsupported-pstack"].includes(scenario)) {
      const unsupported = join(root, "unsupported-pstack");
      if (scenario === "unsupported-pstack") {
        await mkdir(unsupported);
        await writeFile(join(unsupported, "package.json"), JSON.stringify({ name: "@zenspc/pi-pstack", version: "9.9.9" }));
      }
      controller.resources(commands.flatMap(command => command.name !== "pstack" ? [command]
        : scenario === "missing-pstack" ? [] : [{ ...command, sourceInfo: { path: join(unsupported, "index.ts") } }]));
    }
  }
  if (scenario === "workflow-collision") controller.pi.registerCommand("implement", { handler: () => "Existing resource preserved" });
  if (scenario === "context-low-thresholds") { await mkdir(join(repo, ".pi")); await writeFile(join(repo, ".pi", "legion.json"), JSON.stringify({ context: { warningTokens: 10, escalationTokens: 20 } })); }
  extension(controller.pi);
  async function state() {
    const before = controller.notices.length;
    await controller.command("status");
    const text = controller.notices.slice(before).find(value => value.includes("\nState\n"));
    if (!text && controller.notices.slice(before).some(notice => notice === "Legion is inactive.")) return { mode: "inactive", snapshot: null, tasks: [] };
    assert.ok(text, "Fixture setup must expose public status");
    return JSON.parse(text.split("\nState\n")[1].split("\n")[0]);
  }
  async function interpretPending() {
          const pending = (await state()).snapshot.submissions.filter(source => source.state.kind === "pending");
          for (const source of pending) {
            const sourceRef = { id: source.id, revision: source.revision };
            const result = await controller.call("legion_intake", source.state.routing.kind === "new-task"
              ? { kind: "new-task", source: sourceRef, goal: "Add a second independent label", acceptance: ["Second label appears"], questions: [] }
              : { kind: "conversation", source: sourceRef });
            assert.equal(result.details.kind, "applied", JSON.stringify(result));
          }
  }
  try {
    await controller.emit("session_start");
    if (["context-legatus", "context-invalidations", "context-low-thresholds", "context-owner"].includes(scenario)) {
      if (scenario === "context-low-thresholds") controller.setUsage({ tokens: 9, contextWindow: 1000000 });
      await controller.command("on");
      if (scenario === "context-low-thresholds" || scenario === "context-owner") {
        const observations = [];
        if (scenario === "context-owner") {
          controller.setUsage({ tokens: 150000, contextWindow: 272000 }); await controller.emit("turn_end");
          observations.push((await state()).context);
          await controller.command("off"); await controller.command("on");
          await controller.emit("turn_end"); observations.push((await state()).context);
        } else {
          for (const tokens of [9, 10, 19, 20]) {
            controller.setUsage({ tokens, contextWindow: 1000000 }); await controller.emit("turn_end"); observations.push((await state()).context);
          }
        }
        return { root, observations, sent: controller.sent, statuses: controller.statuses, view: await state() };
      }
      if (scenario === "context-invalidations") {
        const observations = [];
        for (const [usage, event] of [
          [{ tokens: 150000, contextWindow: 272000 }, "turn_end"],
          [{ tokens: 1, contextWindow: 272000 }, "session_before_compact"],
          [{ tokens: 1, contextWindow: 272000 }, "session_compact"],
          [{ tokens: 1, contextWindow: 272000 }, "session_compact_failed"],
          [undefined, "turn_end"],
          [{ tokens: null, contextWindow: 272000 }, "turn_end"],
          [{ tokens: 1, contextWindow: 272000 }, "model_select"],
          [{ tokens: 150001, contextWindow: 272000 }, "turn_end"],
          [{ tokens: 149999, contextWindow: 272000 }, "turn_end"],
          [{ tokens: 150000, contextWindow: 272000 }, "turn_end"],
        ]) {
          controller.setUsage(usage); await controller.emit(event); observations.push((await state()).context);
        }
        return { root, observations, sent: controller.sent, statuses: controller.statuses, view: await state() };
      }
      const observations = [];
      for (const tokens of [134999, 135000, 140000, 150000, null, 150001, 149999, 150000, 134999, 150000, 134999, 135000]) {
        controller.setUsage({ tokens, contextWindow: 1000000, percent: tokens === null ? null : tokens / 10000 });
        await controller.emit("turn_end");
        observations.push((await state()).context);
      }
      return { root, observations, sent: controller.sent, statuses: controller.statuses, view: await state() };
    }
    if (kind === "readiness") {
      const history = () => fs.existsSync(controller.ctx.sessionManager.getSessionFile()) ? fs.readFileSync(controller.ctx.sessionManager.getSessionFile()) : null;
      const before = history();
      await controller.command("doctor");
      const doctor = controller.notices.at(-1);
      assert.deepEqual(history(), before, "Doctor must preserve history bytes");
      await controller.command("task Fix the Ready label");
      await drain();
      const admitted = await state(), savedHistory = history();
      const selectedAfter = { model: controller.ctx.model?.id, thinking: controller.ctx.thinkingLevel };
      assert.equal(selectedAfter.thinking, "high", "Legion must not change thinking");
      assert.equal(selectedAfter.model, census?.readinessCase === "missing-model" ? undefined : "selected", "Legion must not change the selected model");
      await controller.command("doctor");
      assert.deepEqual(history(), savedHistory, "Doctor must preserve saved history bytes");
      assert.deepEqual(await state(), admitted, "Doctor must not activate, repair or mutate saved state");
      return { root, doctor, view: admitted, prompts: [...controller.prompts] };
    }
    if (scenario.startsWith("workflow-")) {
      const observations = {};
      if (scenario === "workflow-collision") {
        observations.existingCommand = await controller.invoke("implement", "Do not replace this resource");
        return { root, prompt: "", nativeWrite: {}, observations, notices: controller.notices, view: await state() };
      }
      if (scenario === "workflow-inactive-alias") {
        await controller.invoke("implement", "Ordinary inactive native work");
        const queued = controller.prompts.shift();
        assert.ok(queued); await controller.start(queued);
        const user = controller.ctx.sessionManager.getBranch().findLast(entry => entry.message?.role === "user");
        const view = await state(); await controller.settle();
        return { root, prompt: user.message.content[0].text, nativeWrite: {}, observations, view };
      }
      if (scenario === "workflow-prose" || scenario === "workflow-extension-source") {
        await controller.command("on");
        await controller.emit("input", { source: scenario === "workflow-prose" ? "interactive" : "extension", text: scenario === "workflow-prose" ? "Please mention /implement and /skill:implement-spec in documentation" : "/skill:implement-spec Extension cannot select Matt" });
        const view = await state();
        return { root, prompt: "", nativeWrite: {}, observations, view };
      }
      if (scenario === "workflow-context") { await controller.command("on"); await controller.emit("turn_end"); }
      if (scenario === "workflow-conflict") await controller.command("poteto-mode=on Future Tribunus profile only");
      if (scenario === "workflow-sticky") controller.pi.appendEntry("pstack-mode", { enabled: true });
      if (scenario === "workflow-uncertain") controller.failSend();
      if (scenario === "workflow-alias" || scenario === "workflow-native-input") {
        await controller.command("on");
        if (scenario === "workflow-alias") await controller.invoke("implement", "Native alias instructions");
        else await controller.emit("input", { source: "interactive", text: "/skill:implement-spec  Follow approved spec\nexactly  " });
      } else await controller.command("implement-spec=on  Follow approved spec\nexactly  ");
      if (scenario === "workflow-missing") controller.resources(commands.filter(command => command.name !== "skill:implement-spec"));
      if (scenario === "workflow-duplicate") controller.resources([...commands, commands.find(command => command.name === "skill:implement-spec")]);
      await drain();
      await until(async () => controller.prompts.length || (await state()).snapshot.submissions.at(-1).workflowDispatch.kind === "held-native", "native entry readiness");
      if (["workflow-missing", "workflow-duplicate", "workflow-conflict", "workflow-sticky"].includes(scenario)) return { root, prompt: "", nativeWrite: {}, observations, notices: controller.notices, view: await state() };
      if (scenario === "workflow-uncertain") {
        await until(async () => (await state()).snapshot.submissions[0].workflowDispatch.kind === "uncertain-native", "durable native uncertainty");
        const late = controller.prompts.shift();
        const before = await state();
        await controller.command(`resume ${before.snapshot.id}`); await drain();
        observations.lateStarted = await controller.start(late);
        await controller.emit("session_shutdown"); await controller.emit("session_start");
        await controller.command(`resume ${before.snapshot.id}`); await drain();
        observations.replayedPrompts = controller.prompts.length;
        return { root, prompt: "", nativeWrite: {}, observations, notices: controller.notices, view: await state() };
      }
      const queued = controller.prompts.shift();
      assert.ok(queued, `An explicit workflow must schedule a native skill turn, not remain intake-only: ${controller.notices.join("\n")}`);
      if (scenario === "workflow-resource-race") {
        controller.resources(commands.filter(command => command.name !== "skill:implement-spec"));
        observations.started = await controller.start(queued);
        return { root, prompt: "", nativeWrite: {}, observations, notices: controller.notices, view: await state() };
      }
      if (scenario === "workflow-witness") controller.pi.on("message_end", event => { if (event.message.role === "user") event.message.content[0].text += "\nForeign transformation"; });
      assert.equal(await controller.start(queued), true);
      const user = controller.ctx.sessionManager.getBranch().findLast(entry => entry.message?.role === "user");
      if (scenario === "workflow-context") {
        const entry = controller.ctx.sessionManager.getBranch().findLast(entry => entry.customType === "legion-native-workflow");
        observations.telemetryInContext = "context" in JSON.parse(entry.content.split("\n")[1]).state;
        return { root, prompt: user.message.content[0].text, nativeWrite: {}, observations, view: await state() };
      }
      if (scenario === "workflow-permission") controller.pi.on("tool_call", event => event.toolName === "write" ? { block: true, reason: "Ordinary native skill permission denial" } : undefined);
      const nativeWrite = await controller.call("write", { path: join(repo, "native.txt"), content: "Native skill tools remain native." });
      observations.nativeCanary = fs.existsSync(join(repo, "native.txt"));
      if (scenario === "workflow-witness") observations.managedRefused = (await controller.call("legion_request", { command: "workspace fabricated" })).isError === true;
      if (scenario === "workflow-launch" || scenario === "workflow-context-profile") {
        const source = (await state()).snapshot.submissions[0];
        for (const goal of ["Fix first approved ticket", "Fix second approved ticket"]) {
          const admitted = await controller.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: source.revision }, goal, acceptance: ["Approved behavior works"], questions: [] });
          assert.equal(admitted.details?.kind, "applied", JSON.stringify(admitted));
        }
        const task = (await state()).tasks[0];
        const request = await controller.call("legion_request", { command: `reserve ${task.id}@1 --parent refs/heads/main` });
        assert.equal(request.details?.kind, "deferred", JSON.stringify(request));
        const workspaceId = request.details.receipt.requestKey;
        const stage = await controller.call("legion_request", { command: `workspace ${workspaceId}` });
        assert.equal(stage.details?.kind, "workspace-stage", JSON.stringify(stage));
        assert.equal((await controller.call("legion_workspace", { requestId: "foreign-request" })).isError, true, "A skill cannot retarget the exact saved stage");
        assert.equal((await controller.call("write", { path: join(repo, "during-stage.txt"), content: "Native tools stay native while a bounded stage is prepared." })).isError ?? false, false);
        assert.equal((await controller.call("legion_workspace", { requestId: workspaceId })).details?.kind, "reserved");
        const launch = await controller.call("legion_request", { command: `launch ${task.id}@1` });
        assert.equal(launch.details?.kind, "launch-stage", JSON.stringify(launch));
        const assigned = await controller.call("legion_launch", { requestId: launch.details.requestId });
        assert.equal(assigned.details?.kind, "launched", JSON.stringify(assigned));
        if (scenario === "workflow-context-profile") {
          observations.monitoredTokens = [];
          observations.contextKinds = [];
          observations.futureProfiles = [];
          observations.pinnedAssignments = [];
          for (const [command, tokens] of [["poteto-mode=on Future workers only", 135000], ["poteto-mode=off", 150000]]) {
            await controller.command(command);
            worker.setUsage({ tokens, contextWindow: 272000, percent: tokens / 2720 });
            await worker.emit("turn_end");
            await until(async () => {
              const sample = Object.values((await state()).context).find(item => item.identity.includes("tribunus"))?.sample;
              return sample?.tokens === tokens || sample?.kind === "stale";
            }, "existing assignment observation after future profile change");
            const current = await state();
            const sample = Object.values(current.context).find(item => item.identity.includes("tribunus"))?.sample;
            observations.monitoredTokens.push(sample?.tokens);
            observations.contextKinds.push(sample?.kind);
            observations.futureProfiles.push(current.snapshot.workflowChoice.profile);
            observations.pinnedAssignments.push(current.tasks[0].launch.assignment);
          }
          observations.contextAlerts = controller.sent.filter(item => item.message.customType === "legion-context-alert").map(item => item.message.details.level);
        }
        assert.equal((await controller.call("write", { path: join(repo, "after-stage.txt"), content: "Ordinary tools remain available after managed stages." })).isError ?? false, false);
      }
      if (scenario === "workflow-authority") {
        const source = (await state()).snapshot.submissions[0];
        await controller.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Approved bounded work", acceptance: [], questions: [] });
        observations.refusals = [];
        for (const command of ["poteto-mode=on Unapproved profile", "implement-spec=on Model cannot select", "task Model cannot manufacture Emperor tasks", "off", "push", "close 32", "launch fabricated@1", "workspace fabricated"]) observations.refusals.push((await controller.call("legion_request", { command })).isError === true);
        observations.forgedEvidenceRefused = (await controller.call("legion_request", { command: "workspace fabricated", evidence: { origin: "emperor" } })).isError === true;
        await controller.command("off");
        observations.afterOffRefused = (await controller.call("legion_request", { command: `reserve ${(await state()).tasks[0].id}@1 --parent refs/heads/main` })).isError === true;
      }
      if (scenario === "workflow-clarification") {
        const source = (await state()).snapshot.submissions[0];
        const result = await controller.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Approved work needing a product answer", acceptance: [], questions: [{ question: "Should the label read Ready?", recommendation: "Use Ready." }] });
        assert.equal(result.details.kind, "applied");
        await controller.settle();
        const exactAnswer = " Yes, label Ready.  ";
        await controller.emit("input", { source: "interactive", text: exactAnswer }); await drain();
        await until(() => controller.prompts.length, "native clarification continuation");
        await controller.start(controller.prompts.shift());
        const view = await state(), answer = view.snapshot.submissions.at(-1), decision = view.snapshot.decisions[0];
        const resolved = await controller.call("legion_intake", { kind: "answer", source: { id: answer.id, revision: answer.revision }, decision: { id: decision.id, revision: 1 }, effect: { kind: "record-clarification", target: { id: view.tasks[0].id, revision: 1 }, answer: exactAnswer } });
        assert.equal(resolved.details?.kind, "applied", JSON.stringify(resolved));
        observations.answerText = answer.text;
        observations.answerInvocation = answer.workflowInvocation ?? null;
      }
      if (scenario === "workflow-routing") {
        const rootSource = (await state()).snapshot.submissions[0];
        await controller.call("legion_intake", { kind: "new-task", source: { id: rootSource.id, revision: 1 }, goal: "Approved bounded task", acceptance: [], questions: [] });
        await controller.settle();
        await controller.emit("input", { source: "interactive", text: "Change the existing task or create another?" }); await drain();
        await until(() => controller.prompts.length, "native ambiguous correction"); await controller.start(controller.prompts.shift());
        let view = await state(); const original = view.snapshot.submissions.at(-1), target = { id: view.tasks[0].id, revision: 1 };
        const question = await controller.call("legion_intake", { kind: "clarify", purpose: "routing", source: { id: original.id, revision: 1 }, affected: [target], question: "Correct this task or create independent work?", recommendation: "Correct the current task." });
        assert.equal(question.details.kind, "applied");
        await controller.settle();
        await controller.emit("input", { source: "interactive", text: "Correct the existing task." }); await drain();
        await until(() => controller.prompts.length, "native routing answer"); await controller.start(controller.prompts.shift());
        view = await state(); const answer = view.snapshot.submissions.at(-1), decision = view.snapshot.decisions[0];
        const resolved = await controller.call("legion_intake", { kind: "answer", source: { id: answer.id, revision: 1 }, decision: { id: decision.id, revision: 1 }, effect: { kind: "resolve-routing", original: { id: original.id, revision: 1 }, routing: { kind: "correction", target } } });
        assert.equal(resolved.details.kind, "applied");
        assert.equal((await state()).snapshot.submissions.find(source => source.id === original.id).workflowDispatch.kind, "pending-native", "Resolved correction must retain native pending delivery, not strand an already applied source");
        await controller.settle(); await drain();
        await until(() => controller.prompts.length, "resolved correction must continue natively rather than strand its source"); await controller.start(controller.prompts.shift());
        observations.newTaskRefused = (await controller.call("legion_intake", { kind: "new-task", source: { id: original.id, revision: 2 }, goal: "Illicit new task from correction", acceptance: [], questions: [] })).isError === true;
        const scoped = await controller.call("legion_intake", { kind: "technical-choice", source: { id: original.id, revision: 2 }, target, choice: "Implement the in-scope correction." });
        observations.correctionApplied = scoped.details?.kind;
      }
      await controller.settle();
      if (scenario === "workflow-custom") {
        observations.customPromptChange = await controller.startCustom() ?? null;
        const source = (await state()).snapshot.submissions[0];
        const admitted = await controller.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Scoped after native child result", acceptance: [], questions: [] });
        observations.customAdmission = admitted.details?.kind;
        observations.customNativeWrite = (await controller.call("write", { path: join(repo, "completion.txt"), content: "Native completion stays live." })).isError ?? false;
        await controller.settle();
      }
      return { root, prompt: user.message.content[0].text, nativeWrite, observations, notices: controller.notices, view: await state() };
    }
    if (scenario === "intake-uncertain") controller.failSend();
    if (census?.selection) {
      await mkdir(join(repo, ".pi"));
      await writeFile(join(repo, ".pi", "legion.json"), JSON.stringify({ tribuni_model: census.selection }));
    }
    await controller.command(scenario.startsWith("intake-") ? "task Fix the Ready label" : census?.profile === "matt" ? "implement-spec=on Fix the Ready label" : "poteto-mode=on Fix the Ready label");
    await drain(); await until(() => controller.prompts.length === 1, "initial intake prompt");
    if (scenario === "intake-uncertain") {
      const before = await state(); controller.prompts.shift();
      await controller.command(`resume ${before.snapshot.id}`); await drain();
      assert.deepEqual(controller.prompts, [], "Explicit resume cannot retry uncertain send");
      return { root, view: await state() };
    }
    if (scenario.startsWith("intake-")) {
      const prompt = controller.prompts.shift(), before = await state();
      if (scenario === "intake-pending") controller.onAuth(() => controller.setPending(true));
      if (scenario === "intake-stale") await controller.command("off");
      if (scenario === "intake-auth-error") controller.onAuth(() => { throw new Error("Controlled auth lookup failure"); });
      assert.equal(await controller.start(prompt), false, "Pending/stale/unavailable admission cannot start a model turn");
      assert.equal((await state()).snapshot.submissions[0].state.kind, "pending");
      controller.setPending(false);
      if (scenario !== "intake-pending") await controller.command(`resume ${before.snapshot.id}`);
      await controller.emit("input", { source: "interactive", text: "Queue-drain observation" }); await drain();
      assert.ok(controller.prompts.length > 0, "Explicit current authority or queue-drain observation can schedule fresh intake");
      return { root, view: await state() };
    }
    assert.equal(await controller.start(controller.prompts.shift()), true);
    const initial = await state(), source = initial.snapshot.submissions[0];
    const admitted = await controller.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: source.revision }, goal: "Fix the Ready label", acceptance: ["Ready renders Ready"], questions: [] });
    assert.equal(admitted.details.kind, "applied", JSON.stringify(admitted));
    await controller.settle(); await drain();
    const task = (await state()).tasks[0];
    await controller.command(`reserve ${task.id}@1 --parent refs/heads/main`);
    const reserved = await state(), workspace = reserved.snapshot.workspaceRequests.at(-1).id;
    await controller.command(`workspace ${workspace}`);
    assert.equal(await controller.start(controller.prompts.shift()), true);
    const reservation = await controller.call("legion_workspace", { requestId: workspace });
    assert.equal(reservation.details.kind, "reserved", JSON.stringify(reservation));
    if (census?.childCase === "project-container") {
      assert.equal(dirname(reservation.details.receipt.reservation.plan.path), join(root, "worktrees-repo_legion"), "BEHAVIOR new Legion worktrees use the project sibling container");
      assert.equal(fs.readFileSync(join(root, "worktrees-repo_legion", "unrelated-sentinel.txt"), "utf8"), "Preserve existing container contents.");
      assert.equal(fs.readFileSync(join(reservation.details.receipt.reservation.plan.path, ".git"), "utf8").startsWith("gitdir: "), true, "The allocated task directory is an actual isolated Git worktree");
    }
    await controller.settle(); await drain();
    if (scenario === "context-block-launch") {
      controller.setUsage({ tokens: null, contextWindow: 272000 });
      await controller.emit("session_compact");
      await controller.command(`launch ${task.id}@1`);
      return { root, notices: controller.notices, view: await state(), created: fs.existsSync(createdFile) };
    }
    await controller.command(`launch ${task.id}@1`);
    const launching = await state(), launch = launching.snapshot.launchRequests.at(-1).id;
    assert.equal(await controller.start(controller.prompts.shift()), true);
    const launched = await controller.call("legion_launch", { requestId: launch });
    if (workerFailure) throw workerFailure;
    if (["unknown-caller", "caller-process"].includes(census?.childCase)) {
      assert.equal((await state()).tasks[0].launch.kind, "held", "Unknown caller/session/process cannot acquire a Tribunus");
      assert.equal(fs.existsSync(createdFile), false, "Unknown owning Legatus must not create a Herdr tab or workspace");
      return { root, view: await state() };
    }
    if (scenario === "launch-profile-held") return { root, view: await state(), result: launched.details, prompts: [...worker.prompts], entries: worker.ctx.sessionManager.getBranch() };
    assert.equal(launched.details.kind, "launched", JSON.stringify(launched));
    assert.equal((await state()).tasks[0].launch.kind, "assigned", JSON.stringify((await state()).tasks[0].launch));
    await controller.settle(); await drain();
    const assignment = (await state()).tasks[0].launch;
    async function workerControl(frame) {
      const hello = JSON.parse(fs.readFileSync(join(profile, "legion", "tribuni", assignment.worker.address.launch, "hello.json"), "utf8"));
      return new Promise((resolve, reject) => {
        const socket = connect(hello.endpoint); let buffer = "";
        socket.once("connect", () => socket.write(JSON.stringify({ capability: workerDescriptor.capability, authority: workerDescriptor.authority, reservation: workerDescriptor.launch.reservation, scope: workerDescriptor.launch.scope, address: assignment.worker.address, ...frame }) + "\n"));
        socket.on("data", chunk => { buffer += chunk; const end = buffer.indexOf("\n"); if (end < 0) return; resolve(JSON.parse(buffer.slice(0, end))); socket.destroy(); });
        socket.once("error", reject); socket.once("close", () => reject(new Error("Fixture control closed without receipt")));
      });
    }
    async function assertCannotRestoreAuthority() {
      for (const authority of [workerDescriptor.authority, { ...workerDescriptor.authority, generation: workerDescriptor.authority.generation + 1 }]) {
        const result = await workerControl({ authority, kind: "assign", command: assignment.command, assignment: assignment.assignment });
        assert.equal(result.kind, "held", "Late/duplicate/newer-generation assignment cannot unpark a worker");
      }
      const observation = await workerControl({ kind: "context-current", command: assignment.command, assignment: null, nonce: randomUUID() });
      assert.equal(observation.kind, "ok", "Exact read-only observation cannot adopt a newer controller");
      assert.deepEqual(observation.value.authority, workerDescriptor.authority);
    }
    if (scenario.startsWith("owner-loss-")) {
      const read = fs.readFileSync;
      if (scenario === "owner-loss-session") await writeFile(callerFile, JSON.stringify({ ...pane, agent_session: { kind: "id", value: "replacement-owner-session" } }));
      else if (scenario === "owner-loss-empty-session") await writeFile(callerFile, JSON.stringify({ ...pane, agent_session: { kind: "id", value: "" } }));
      else if (scenario === "owner-loss-empty-agent") await writeFile(callerFile, JSON.stringify({ ...pane, agent: " " }));
      else if (scenario === "owner-loss-malformed-session") await writeFile(callerFile, JSON.stringify({ ...pane, agent_session: { kind: "id", value: 42 } }));
      else if (scenario === "owner-loss-unreadable-session") await writeFile(callerFile, JSON.stringify({ ...pane, agent_session: { kind: "path", value: join(root, "absent-owner.jsonl") } }));
      else if (scenario === "owner-loss-empty-session-journal") {
        const journal = join(root, "empty-owner.jsonl");
        await writeFile(journal, JSON.stringify({ type: "session", id: "" }) + "\n");
        await writeFile(callerFile, JSON.stringify({ ...pane, agent_session: { kind: "path", value: journal } }));
      } else if (scenario === "owner-loss-non-pi") {
        const observed = { ...pane, agent: "claude" }; delete observed.agent_session;
        await writeFile(callerFile, JSON.stringify(observed));
      }
      else if (scenario === "owner-loss-missing-session" || scenario === "owner-loss-missing-agent") {
        const missing = { ...pane }; delete missing[scenario === "owner-loss-missing-agent" ? "agent" : "agent_session"];
        await writeFile(callerFile, JSON.stringify(missing));
      } else {
        fs.readFileSync = (path, ...args) => {
          if (path === `/proc/${process.pid}/stat`) {
            if (scenario === "owner-loss-unreadable") throw Object.assign(new Error("Controlled unreadable owner proc evidence"), { code: "EACCES", path });
            const stat = read(path, ...args), end = stat.lastIndexOf(")") + 2;
            const fields = stat.slice(end).split(" "); fields[19] = "0";
            return stat.slice(0, end) + fields.join(" ");
          }
          return read(path, ...args);
        };
        syncBuiltinESMExports();
      }
      let refused;
      try { refused = await worker.call("write", { path: "orphan-write.txt", content: "no" }); }
      finally { fs.readFileSync = read; syncBuiltinESMExports(); }
      assert.equal(refused.isError, true, "Missing exact owner authority cannot admit a new native effect");
      await writeFile(callerFile, JSON.stringify(pane));
      assert.equal((await worker.call("write", { path: "returned-write.txt", content: "no" })).isError, true, "Returning communication cannot restore authority");
      await worker.settle();
      const rootEvidence = join(profile, "legion", "tribuni", assignment.worker.address.launch);
      const unresolved = ["owner-loss-unreadable", "owner-loss-missing-session", "owner-loss-missing-agent", "owner-loss-empty-session", "owner-loss-empty-agent", "owner-loss-malformed-session", "owner-loss-unreadable-session", "owner-loss-empty-session-journal"].includes(scenario);
      const retirement = JSON.parse(fs.readFileSync(join(rootEvidence, "retirement.json"), "utf8"));
      assert.equal(retirement.stop.command, assignment.command);
      assert.equal(retirement.reason, unresolved ? "owner-unresolved" : "owner-lost");
      await until(() => fs.readdirSync(join(rootEvidence, assignment.worker.address.generation)).some(file => file.endsWith(unresolved ? ".park-held.json" : ".park.json")), "owner-loss worker park or explicit evidence blocker");
      if (unresolved) assert.equal(fs.readdirSync(join(rootEvidence, assignment.worker.address.generation)).some(file => file.endsWith(".park.json")), false);
      await assertCannotRestoreAuthority();
      assert.equal(fs.existsSync(join(worker.ctx.cwd, "orphan-write.txt")), false);
      if (scenario === "owner-loss-session") {
        const cwd = worker.ctx.cwd;
        await worker.emit("session_shutdown");
        worker = runtime(cwd, randomUUID(), join(root, "restarted-worker.jsonl"));
        installTribunus(worker.pi, join(rootEvidence, "bootstrap.json"));
        process.env.HERDR_PANE_ID = "controlled-worker-pane";
        try { await worker.emit("session_start"); } finally { process.env.HERDR_PANE_ID = "controlled-pane"; }
        const hello = JSON.parse(fs.readFileSync(join(rootEvidence, "hello.json"), "utf8"));
        assert.deepEqual(hello.address, assignment.worker.address, "Restart preserves prior identity without adopting outstanding children");
        assert.equal((await worker.call("write", { path: "restarted.txt", content: "no" })).isError, true, "Ordinary native worker restart cannot clear a retained retirement");
        assert.deepEqual(worker.prompts, []);
        assert.equal(worker.statuses.some(status => status.text?.includes("retirement retained")), true);
      }
      return { root, view: await state(), retirement };
    }
    if (scenario === "drain-effect" || scenario === "drain-effect-unknown") {
      let began = false, release;
      const gate = new Promise(resolve => { release = resolve; });
      worker.external(async name => { if (name !== "write") return undefined; began = true; await gate; if (scenario === "drain-effect-unknown") throw new Error("Controlled executed effect without outcome"); return undefined; });
      const writing = worker.call("write", { path: "in-flight.txt", content: "Preserved effect" });
      try {
        await until(() => began, "native admitted effect execution");
        await controller.command("off");
        assert.equal((await state()).mode, "stopping");
        assert.equal((await state()).snapshot.effects.at(-1).state.kind, "outstanding");
        release(); await writing;
        const expected = scenario === "drain-effect-unknown" ? "unknown" : "completed";
        await until(async () => (await state()).snapshot.effects.at(-1).state.kind === expected, "retained effect outcome observation after off");
        await worker.settle();
        if (expected === "completed") {
          await until(async () => (await state()).mode === "inactive", "known effect drain");
          assert.equal(fs.readFileSync(join(worker.ctx.cwd, "in-flight.txt"), "utf8"), "Preserved effect");
        } else {
          await until(async () => (await state()).snapshot.shutdown.workers[0].state.kind === "held", "unknown effect blocker");
          assert.equal((await state()).mode, "stopping");
          assert.equal((await state()).tasks[0].launch.report.outcome, "blocked");
        }
        await assertCannotRestoreAuthority();
        return { root, view: await state() };
      } finally { release(); await writing; }
    }
    if (scenario === "drain-root") {
      await controller.command("off");
      const stopped = await state();
      assert.equal(stopped.mode, "stopping");
      assert.ok(stopped.snapshot.shutdown, "Off must persist the same shutdown, not delivery-only state");
      await controller.command("off");
      assert.equal((await state()).snapshot.shutdown.id, stopped.snapshot.shutdown.id);
      const restarted = new Legion({ storagePath: join(profile, "legion"), context: repo, session: "composed-controller", preflight: async () => [] });
      assert.equal((await restarted.state()).mode, "stopping", "Restart must retain unresolved stop without dispatch");
      await controller.command("on");
      assert.equal((await state()).mode, "stopping", "Activation cannot erase unresolved stop");
      assert.equal((await worker.call("write", { path: "after-off.txt", content: "no" })).isError, true);
      assert.equal(fs.existsSync(join(worker.ctx.cwd, "after-off.txt")), false);
      await worker.settle();
      await until(async () => (await state()).mode === "inactive", "native settled parked worker");
      const settled = await state();
      assert.equal(settled.snapshot.shutdown.id, stopped.snapshot.shutdown.id);
      assert.equal(settled.tasks[0].launch.kind, "reported");
      assert.equal(settled.snapshot.shutdown.workers[0].state.kind, "parked");
      await assertCannotRestoreAuthority();
      const repeated = await workerControl({ kind: "stop", command: stopped.snapshot.shutdown.id, currentCommand: assignment.command, assignment: null });
      assert.equal(repeated.kind, "ok");
      assert.equal(repeated.value.state.kind, "parked");
      const conflicting = await workerControl({ kind: "stop", command: stopped.snapshot.shutdown.id, currentCommand: randomUUID(), assignment: null });
      assert.equal(conflicting.kind, "held", "A shutdown ID cannot acquire a different assignment");
      return { root, view: settled };
    }
    if (scenario === "context-worker-disposal") {
      await worker.emit("turn_end");
      await until(async () => Object.values((await state()).context).some(item => item.identity.includes("tribunus") && item.sample.tokens === 1000), "baseline actual worker sample");
      const entries = worker.ctx.sessionManager.getBranch().length, prompts = worker.prompts.length;
      const sessionId = worker.ctx.sessionManager.getSessionId;
      let checks = 0, stopped = null;
      // Revoke at the real server's Pi incarnation read, after the client request has arrived.
      worker.ctx.sessionManager.getSessionId = () => {
        checks++;
        stopped ??= controller.command("off");
        return sessionId();
      };
      try {
        const source = join(root, "pending-context.json");
        const destination = join(profile, "legion", "tribuni", assignment.worker.address.launch, assignment.worker.address.generation);
        const sample = { capability: workerDescriptor.capability, observation: { authority: workerDescriptor.authority, address: assignment.worker.address, command: assignment.command, sequence: 100, model: "controlled/selected", sample: { kind: "fresh", tokens: 150000, contextWindow: 272000, sampledAt: Date.now() } } };
        await writeFile(source, JSON.stringify(sample));
        await execute(process.execPath, ["--import", "tsx", "tests/context-event-worker.ts", source, join(destination, `${assignment.command}.pending.context.json`)], { cwd: process.cwd() });
        await until(() => stopped !== null, "owner revoked during actual live context check");
        await stopped;
        const retirementPath = join(profile, "legion", "tribuni", assignment.worker.address.launch, "retirement.json");
        await until(() => fs.existsSync(retirementPath), "addressed safe-stop authentication receipt");
        const checksAfterStop = checks;
        assert.equal(checksAfterStop, 2, "Only the original context check and addressed stop authenticate the native incarnation");
        await writeFile(source, JSON.stringify({ ...sample, observation: { ...sample.observation, sequence: 101 } }));
        await execute(process.execPath, ["--import", "tsx", "tests/context-event-worker.ts", source, join(destination, `${assignment.command}.after-disposal.context.json`)], { cwd: process.cwd() });
        assert.equal(checks, checksAfterStop, "Disposed observation cannot make another current-assignment request after safe-stop authentication");
        assert.equal(worker.ctx.sessionManager.getBranch().length, entries, "Canceled context checks must not append principal transcript entries");
        assert.equal(worker.prompts.length, prompts, "Canceled context checks must not start principal turns");
        return { root, observations: [], sent: controller.sent, statuses: controller.statuses, view: await state() };
      } finally { worker.ctx.sessionManager.getSessionId = sessionId; }
    }
    if (scenario === "context-worker-switch" || scenario === "context-worker-shutdown") {
      const observations = [];
      const entries = worker.ctx.sessionManager.getBranch().length, prompts = worker.prompts.length;
      worker.setUsage({ tokens: 135000, contextWindow: 272000, percent: 50 });
      await worker.emit("turn_end");
      await until(async () => Object.values((await state()).context).some(item => item.identity.includes("tribunus") && item.sample.tokens === 135000), "current actual worker sample");
      observations.push((await state()).context);
      await worker.emit(scenario.endsWith("switch") ? "session_start" : "session_shutdown");
      const source = join(root, "delayed-context.json");
      await writeFile(source, JSON.stringify({ capability: workerDescriptor.capability, observation: { authority: workerDescriptor.authority, address: assignment.worker.address, command: assignment.command, sequence: 100, model: "controlled/selected", sample: { kind: "fresh", tokens: 150000, contextWindow: 272000, sampledAt: Date.now() } } }));
      await execute(process.execPath, ["--import", "tsx", "tests/context-event-worker.ts", source, join(profile, "legion", "tribuni", assignment.worker.address.launch, assignment.worker.address.generation, `${assignment.command}.delayed.context.json`)], { cwd: process.cwd() });
      await until(async () => Object.values((await state()).context).some(item => item.identity.includes("tribunus") && /Current worker context is unresolved/.test(item.sample.reason ?? "")), "visible delayed actual worker rejection");
      observations.push((await state()).context);
      assert.equal(worker.ctx.sessionManager.getBranch().length, entries, "Context checks must not append principal transcript entries");
      assert.equal(worker.prompts.length, prompts, "Context checks must not start principal turns");
      return { root, observations, sent: controller.sent, statuses: controller.statuses, view: await state() };
    }
    if (scenario === "context-worker") {
      const observations = [];
      for (const [tokens, event] of [[150000, "turn_end"], [null, "session_compact"], [150001, "turn_end"], [134999, "turn_end"]]) {
        worker.setUsage({ tokens, contextWindow: 272000, percent: tokens === null ? null : tokens / 2720 });
        await worker.emit(event);
        await until(async () => Object.values((await state()).context ?? {}).some(item => item.identity.includes("tribunus") && item.sample.tokens === tokens), "addressed context publication");
        observations.push((await state()).context);
      }
      await worker.settle();
      await until(async () => (await state()).tasks[0].launch.kind === "reported", "context worker final report");
      worker.setUsage({ tokens: 150000, contextWindow: 272000, percent: 55 });
      await worker.emit("turn_end");
      await until(() => controller.sent.length === 2, "context after final report");
      return { root, observations, sent: controller.sent, statuses: controller.statuses, view: await state() };
    }
    if (scenario === "launch-profile") return { root, view: await state(), startupCommand: JSON.parse(await readFile(join(root, "startup-command.json"), "utf8")), prompts: [...worker.prompts], entries: worker.ctx.sessionManager.getBranch(), workerDescriptor };
    assert.equal("testContract" in assignment.assignment, false);
    assert.equal((await state()).snapshot.engineering.length, 0);
    const originalTools = worker.pi.getAllTools();
    assert.equal(originalTools.find(tool => tool.name === "write").sourceInfo.path, "builtin:write", "Legion must not replace ordinary tools");
    const commit = (await execute("git", ["-C", worker.ctx.cwd, "rev-parse", "HEAD"])).stdout.trim();
    if (scenario === "topology") {
      const layout = JSON.parse(fs.readFileSync(join(root, "layout-command.json")));
      assert.ok(layout.includes("--no-focus"));
      assert.equal(layout[layout.indexOf("--workspace") + 1], "controlled-workspace");
      return { root, view: await state() };
    }
    if (scenario === "native-management") {
      let invoked = 0;
      worker.external(async (name, raw) => { assert.equal(name, "subagent"); assert.equal(raw.action, "watchdog.configure"); invoked++; return { content: [], details: { mode: "management" } }; });
      const input = { action: "watchdog.configure", model: "recommended", options: { scope: "session" } };
      assert.equal((await worker.call("subagent", input)).isError ?? false, false, "Non-launch native management remains native");
      await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "completed", "native management effect admission");
      const effect = (await state()).snapshot.effects.at(-1);
      assert.equal(effect.intent.call.name, "subagent"); assert.deepEqual(effect.intent.call.input, input);
      worker.pi.on("tool_call", event => event.toolName === "subagent" ? { block: true, reason: "Ordinary native management permission denial" } : undefined);
      assert.equal((await worker.call("subagent", input)).isError, true);
      await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "refused", "native management permission denial");
      assert.equal(invoked, 1, "Native permissions still prevent settings execution");
      return { root, view: await state() };
    }
    if (scenario === "native-unprepared") {
      let invoked = 0;
      worker.external(async () => { invoked++; return { content: [], details: {} }; });
      for (const raw of [
        { agent: "worker", task: "Unprepared writer", async: false, worktree: false },
        { agent: "worker", task: "Unprepared writer", async: true, worktree: false },
        { workflow: true, async: false },
        { action: "resume", id: "foreign-run", message: "Continue" },
        { action: "schedule.create", agent: "worker", task: "Later writer" },
        { action: "project.open", cwd: worker.ctx.cwd },
        { action: "stop", id: "foreign-run" },
        { action: "interrupt", id: "foreign-run" },
        { action: "steer", id: "foreign-run", message: "Change scope" },
      ]) {
        const result = await worker.call("subagent", raw);
        assert.equal(result.isError, true, `BEHAVIOR unowned launch/control must be visibly refused: ${JSON.stringify(raw)}`);
        assert.ok(result.content[0].text.length > 0);
      }
      assert.equal(invoked, 0, "Unsupported launches and foreign controls never reach native execution");
      for (const action of ["list", "status", "guide", "models", "validate", "mission.list", "schedule.show", "project.status", "watchdog.check"]) {
        assert.equal((await worker.call("subagent", { action })).isError ?? false, false, `Native inspection remains usable: ${action}`);
      }
      assert.equal((await worker.call("subagents_enable", {})).isError ?? false, false);
      return { root, view: await state() };
    }
    if (scenario === "notice") {
      const notice = { role: "custom", customType: "subagent-notify", content: "Ordinary child result", display: true, timestamp: 1 };
      assert.equal(await worker.emit("context", { messages: [notice] }), undefined, "Native completion content must pass through");
      await worker.settle();
      assert.equal(await worker.start("Subagent updates above."), true, "Ordinary completion starts a normal turn");
      await worker.settle();
      return { root, view: await state() };
    }
    if (scenario.startsWith("child-")) {
      // No purpose is treated as a native tool ceiling: every potentially writing child is isolated.
      fs.writeFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "Parent uncommitted sentinel");
      const request = { purpose: "implementation", agent: "worker", task: "Bounded Ready label", baseRef: (await execute("git", ["-C", worker.ctx.cwd, "symbolic-ref", "HEAD"])).stdout.trim(), baseCommit: commit };
      const dirty = await worker.call("legion_centurio", request);
      assert.equal(dirty.isError, true, "Uncommitted parent cannot be silently copied or omitted");
      assert.equal(fs.readFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "utf8"), "Parent uncommitted sentinel");
      fs.unlinkSync(join(worker.ctx.cwd, "dirty-parent.txt"));
      const prepared = await worker.call("legion_centurio", request);
      assert.equal(prepared.isError ?? false, false, JSON.stringify(prepared));
      fs.writeFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "Parent uncommitted sentinel");
      const input = prepared.details.launch;
      assert.equal(input.agent, "worker");
      for (const field of ["model", "tools", "extensionBindings", "context", "skill"]) assert.equal(field in input, false, `Native ${field} resolution must stay native`);
      assert.notEqual(input.cwd, worker.ctx.cwd);
      assert.equal(fs.existsSync(join(input.cwd, "dirty-parent.txt")), false);
      const branch = (await execute("git", ["-C", input.cwd, "symbolic-ref", "HEAD"])).stdout.trim();
      assert.notEqual(branch, (await execute("git", ["-C", worker.ctx.cwd, "symbolic-ref", "HEAD"])).stdout.trim());
      if (scenario === "child-prepared") return { root, view: await state() };
      if (scenario === "child-held-launch") {
        worker.external(async () => { throw new Error("Native effect outcome unavailable"); });
        assert.equal((await worker.call("write", { path: "uncertain.txt", content: "unknown" })).isError, true);
        await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "unknown", "principal effect hold");
        let invoked = 0;
        worker.external(async () => { invoked++; return { content: [], details: {} }; });
        for (const raw of [input, { agent: "worker", task: "Unprepared writer", async: false, worktree: false }, { agent: "worker", task: "Unprepared writer", async: true, worktree: false }]) {
          assert.equal((await worker.call("subagent", raw)).isError, true, "BEHAVIOR held principal cannot start an owned or unprepared native writer");
        }
        assert.equal(invoked, 0);
        assert.equal((await worker.call("subagent", { action: "status" })).isError ?? false, false, "Inspection remains native during a hold");
        return { root, view: await state() };
      }
      const directory = join(root, "native-run"); fs.mkdirSync(directory);
      const run = "native-run-id", runner = "native-runner-instance", childSession = "native-child-session", childJournal = join(directory, "child.jsonl");
      fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: childSession, cwd: input.cwd }) + "\n");
      let nativeInvocations = 0;
      worker.external(async (name, raw) => { assert.equal(name, "subagent"); assert.deepEqual(raw, input); nativeInvocations++; return { content: [], details: { runId: run, asyncDir: directory } }; });
      if (scenario === "child-native-startup") {
        // Exact initial single-run publication from 0.77.0 async-execution.js:2020-2034/616-621.
        const initial = { lifecycleArtifactVersion: 3, runId: run, sessionId: worker.ctx.sessionManager.getSessionId(), mode: "single", state: "running", startedAt: 1, lastUpdate: 1, currentStep: 0, chainStepCount: 1,
          steps: [{ agent: "worker", status: "pending" }], pid: process.pid,
          processTerminal: { version: 1, state: "pending", runId: run, runnerProcessInstanceId: runner } };
        const incompleteCase = census?.childCase;
        if (incompleteCase === "foreign-owner") initial.sessionId = "foreign-principal";
        if (incompleteCase === "foreign-run") initial.runId = "foreign-run";
        if (incompleteCase === "foreign-agent") initial.steps[0].agent = "foreign-agent";
        if (incompleteCase === "foreign-cwd") initial.cwd = worker.ctx.cwd;
        if (incompleteCase === "malformed-cwd") initial.cwd = 42;
        if (incompleteCase === "malformed-journal") initial.steps[0].sessionFile = null;
        if (incompleteCase === "malformed-state") initial.state = "invented-state";
        if (incompleteCase === "unknown-sidecar") fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify({ version: 1, state: "unknown", runId: run, runnerProcessInstanceId: runner, reason: "writer-close-unverified" }));
        if (incompleteCase === "foreign-sidecar") fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify({ version: 1, state: "pending", runId: "foreign-run", runnerProcessInstanceId: runner }));
        fs.writeFileSync(join(directory, "status.json"), JSON.stringify(initial));
        assert.equal((await worker.call("subagent", input)).isError ?? false, false);
        await until(async () => !["prepared", "launch-unresolved"].includes((await state()).tasks[0].launch.worker.resources.children[0].state.kind), "initial native publication");
        if (incompleteCase) {
          const expected = incompleteCase.startsWith("foreign-") ? "mismatch" : "unknown";
          assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, expected, `Incomplete publication cannot hide ${incompleteCase}`);
          const repaired = { lifecycleArtifactVersion: 3, runId: run, sessionId: worker.ctx.sessionManager.getSessionId(), mode: "single", state: "complete", cwd: input.cwd, sessionFile: childJournal, currentStep: 0, steps: [{ agent: "worker", status: "complete" }], processTerminal: { version: 1, state: "pending", runId: run, runnerProcessInstanceId: runner } };
          fs.writeFileSync(join(directory, "status.json"), JSON.stringify(repaired));
          fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId: run, runnerProcessInstanceId: runner, observedAt: 3, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: 3, exitCode: 0, signal: null }] }));
          await delay(40);
          assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, expected, "Later ordinary publication cannot repair unknown or conflicting evidence");
          await worker.settle();
          assert.equal((await state()).tasks[0].launch.kind, "assigned");
          return { root, view: await state() };
        }
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "corroboration-pending", "BEHAVIOR valid incomplete installed startup is pending, not sticky unknown");
        // Runner's initial publication adds cwd but the fresh child journal is not yet exposed.
        const status = { ...initial, cwd: input.cwd, steps: [{ agent: "worker", status: "running", recentTools: [], recentOutput: [] }] };
        fs.writeFileSync(join(directory, "status.json"), JSON.stringify(status));
        await worker.settle(false, "Principal is done; native publication remains incomplete.");
        assert.equal((await state()).tasks[0].launch.kind, "assigned");
        // subagent-runner.js:4741 exposes the fresh journal at TOP LEVEL, not necessarily on steps[0].
        status.state = "complete"; status.sessionFile = childJournal; status.steps[0].status = "complete";
        const event = type => ({ type, subagentSource: "child", subagentRunId: run, subagentStepIndex: 0, subagentAgent: "worker", observedAt: 2 });
        fs.writeFileSync(join(directory, "events.jsonl"), [event("agent_start"), event("agent_settled")].map(value => JSON.stringify(value)).join("\n") + "\n");
        fs.writeFileSync(join(directory, "status.json"), JSON.stringify(status));
        await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "logical-terminal", "fully published fresh native child journal");
        // finalizeProcessTerminal emits runner PLUS all writer records; array order is not an authority pin.
        const proof = { version: 1, state: "observed", runId: run, runnerProcessInstanceId: runner, observedAt: 3,
          instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: 3, exitCode: 0, signal: null },
            { kind: "pi-writer", processInstanceId: "native-pi-writer", attempt: 0, closeObservedAt: 2, exitCode: 0, signal: null, processTree: { state: "observed", mechanism: "posix-process-group", processGroupId: process.pid, verifiedAt: 2 } }] };
        status.processTerminal = proof;
        fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify(proof));
        fs.writeFileSync(join(directory, "status.json"), JSON.stringify(status));
        worker.pi.events.emit("subagent:async-complete", { lifecycleArtifactVersion: 3, id: run, runId: run, sessionId: status.sessionId, cwd: input.cwd, asyncDir: directory, agent: "worker", mode: "single", state: "complete", sessionFile: childJournal, results: [{ agent: "worker", sessionFile: childJournal }] });
        await until(async () => (await state()).tasks[0].launch.kind === "reported", "installed native shapes settle without deadlock");
        assert.equal((await state()).tasks[0].launch.report.outcome, "reported-result");
        assert.equal(nativeInvocations, 1);
        return { root, view: await state() };
      }
      if (scenario === "child-deny") worker.pi.on("tool_call", event => event.toolName === "subagent" ? { block: true, reason: "Ordinary launch permission denial" } : undefined);
      const result = await worker.call("subagent", input);
      if (scenario === "child-deny") {
        assert.equal(result.isError, true); assert.equal(nativeInvocations, 0); await worker.settle();
        await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "unknown", "native denied launch hold");
        const children = (await state()).tasks[0].launch.worker.resources.children;
        assert.equal(children[0].state.kind, "unknown", "Failed launch with no run evidence stays held, not proof of no effects");
        return { root, view: await state() };
      }
      assert.equal(result.isError ?? false, false);
      assert.equal((await worker.call("subagent", input)).isError, true, "Consumed owned intent cannot launch twice");
      assert.equal(nativeInvocations, 1);
      const status = { lifecycleArtifactVersion: 3, runId: run, sessionId: worker.ctx.sessionManager.getSessionId(), mode: "single", cwd: input.cwd, currentStep: 0, state: "running", steps: [{ agent: "worker", sessionFile: childJournal, model: "native-small-context-model" }], processTerminal: { version: 1, state: "pending", runId: run, runnerProcessInstanceId: runner } };
      const event = type => ({ type, subagentSource: "child", subagentRunId: run, subagentStepIndex: 0, subagentAgent: "worker" });
      const events = [event("agent_start")];
      const publishNative = () => { fs.writeFileSync(join(directory, "status.json"), JSON.stringify(status)); fs.writeFileSync(join(directory, "events.jsonl"), events.map(item => JSON.stringify(item)).join("\n") + "\n"); };
      publishNative();
      worker.pi.events.emit("subagent:async-started", { id: run, sessionId: status.sessionId, cwd: input.cwd, asyncDir: directory, agent: "worker" });
      await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "active", "native child association");
      if (scenario === "child-owned-controls") {
        let invoked = 0;
        worker.external(async (name, raw) => { assert.equal(name, "subagent"); assert.equal(raw.id, run); invoked++; return { content: [], details: {} }; });
        assert.equal((await worker.call("subagent", { action: "steer", id: run, message: "Scope-preserving guidance" })).isError, true, "Recovery-capable steer cannot revive an unassociated writer");
        for (const raw of [{ action: "stop", id: "foreign-run" }, { action: "interrupt", id: run.slice(0, 6) }, { action: "stop", id: run, options: { index: 1 } }, { action: "stop", id: run, runId: "foreign-run" }]) assert.equal((await worker.call("subagent", raw)).isError, true);
        assert.equal(invoked, 0, "Foreign, abbreviated and ambiguous controls are not executed");
        for (const raw of [{ action: "steer", id: run, message: "Scope-preserving guidance", options: { mode: "steer", steeringRecovery: false } }, { action: "interrupt", id: run }, { action: "stop", id: run }]) assert.equal((await worker.call("subagent", raw)).isError ?? false, false, "Current exact owned controls remain native");
        assert.equal(invoked, 3);
        await controller.command("off");
        assert.equal((await worker.call("subagent", { action: "stop", id: run })).isError, true, "Lost current ownership cannot control a child");
        assert.equal(invoked, 3);
        return { root, view: await state() };
      }
      await worker.settle(false, "Principal reports finished; this is not child settlement.");
      assert.equal((await state()).tasks[0].launch.kind, "assigned");
      if (scenario === "child-active") return { root, view: await state() };
      let originalShutdown = null;
      if (scenario === "child-stop-owner-loss") {
        await controller.command("off");
        originalShutdown = (await state()).snapshot.shutdown.id;
        const stopped = await workerControl({ kind: "stop", command: originalShutdown, currentCommand: assignment.command, assignment: null });
        assert.equal(stopped.kind, "ok");
        assert.equal(stopped.value.state.kind, "draining");
        const read = fs.readFileSync;
        fs.readFileSync = (path, ...args) => {
          if (path === `/proc/${process.pid}/stat`) throw Object.assign(new Error("Controlled exact owner process disappeared"), { code: "ENOENT", path });
          return read(path, ...args);
        };
        syncBuiltinESMExports();
        try { assert.equal((await worker.call("write", { path: "after-owner-death.txt", content: "no" })).isError, true); }
        finally { fs.readFileSync = read; syncBuiltinESMExports(); }
        assert.equal((await worker.call("subagent", { action: "stop", id: run })).isError, true, "Owner return does not restore execution/control authority");
      }
      const missingOwner = scenario === "child-owner-missing-session" || scenario === "child-owner-missing-agent";
      if (scenario === "child-owner-loss" || census?.ownerLoss || missingOwner) {
        const observedOwner = { ...pane };
        if (missingOwner) delete observedOwner[scenario === "child-owner-missing-agent" ? "agent" : "agent_session"];
        else observedOwner.agent_session = { kind: "id", value: "replacement-owner" };
        await writeFile(callerFile, JSON.stringify(observedOwner));
        assert.equal((await worker.call("write", { path: "orphan-principal.txt", content: "no" })).isError, true);
        await writeFile(callerFile, JSON.stringify(pane));
        assert.equal((await worker.call("subagent", { action: "stop", id: run })).isError, true, "Read-only retirement observation cannot authorize controls of an active child");
        await assertCannotRestoreAuthority();
      }
      if (scenario === "child-drain" || census?.drain) {
        await controller.command("off");
        assert.equal((await state()).mode, "stopping");
        assert.equal((await worker.call("legion_centurio", { agent: "worker", task: "New unauthorized child", writable: true })).isError, true);
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "Control delivery cannot settle the active native child");
      }
      status.state = scenario === "child-canceled" ? "stopped" : scenario === "child-failed" ? "failed" : "complete";
      if (scenario === "child-changed-session") fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: "replacement-child-session", cwd: input.cwd }) + "\n");
      if (!["child-missing-events", "child-canceled"].includes(scenario)) events.push(event("agent_settled"));
      if (scenario === "child-open-tool") events.splice(1, 0, { ...event("tool_execution_start"), toolCallId: "open-write", toolName: "write", args: { path: "ready.txt", content: "Ready" } });
      if (scenario === "child-failed") events.splice(1, 0,
        { ...event("tool_execution_start"), toolCallId: "failed-bash", toolName: "bash", args: { command: "exit 1" } },
        { ...event("tool_execution_end"), toolCallId: "failed-bash", toolName: "bash", isError: true, durationMs: 1, result: { content: [], structuredContent: { exit_code: 1 } } });
      if (scenario === "child-tool-denial" || scenario === "child-tool-unknown") events.splice(1, 0,
        { ...event("tool_execution_start"), toolCallId: "write", toolName: "write", args: { path: "ready.txt", content: "Ready" } },
        { ...event("tool_execution_end"), toolCallId: "write", toolName: "write", isError: true, ...(scenario === "child-tool-unknown" ? { durationMs: 1 } : {}), result: { content: [{ type: "text", text: "Native write failed" }] } });
      publishNative();
      const proof = { version: 1, state: "observed", runId: run, runnerProcessInstanceId: runner, observedAt: 2, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: 2, exitCode: 0, signal: null }] };
      if (scenario === "child-unknown-proof") { proof.state = "unknown"; status.processTerminal.state = "unknown"; }
      if (scenario === "child-wrong-runner") proof.runnerProcessInstanceId = "foreign-runner";
      if (scenario === "child-lost-owner") await controller.command("off");
      if (scenario !== "child-missing-proof") fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify(proof));
      publishNative();
      worker.pi.events.emit("subagent:async-complete", { id: run, runId: run, sessionId: status.sessionId, cwd: input.cwd, asyncDir: directory, agent: "worker" });
      const held = ["child-missing-events", "child-open-tool", "child-tool-unknown", "child-missing-proof", "child-unknown-proof", "child-wrong-runner", "child-changed-session", "child-canceled"].includes(scenario);
      const expectedHold = ["child-missing-events", "child-canceled", "child-open-tool"].includes(scenario) ? "corroboration-pending"
        : scenario === "child-missing-proof" ? "logical-terminal" : ["child-wrong-runner", "child-changed-session"].includes(scenario) ? "mismatch" : "unknown";
      await until(async () => {
        const launch = (await state()).tasks[0].launch;
        return held ? launch.worker.resources.children[0].state.kind === expectedHold : launch.kind === "reported";
      }, "native terminal observation");
      if (held) await delay(40);
      if (scenario === "child-drain-native-turn") {
        await worker.startCustom();
        await controller.command("off");
        const stopped = await state();
        const receipt = await workerControl({ kind: "stop", command: stopped.snapshot.shutdown.id, currentCommand: assignment.command, assignment: null });
        assert.equal(receipt.kind, "ok");
        assert.equal(receipt.value.state.kind, "draining", "An active ordinary native completion turn is not settlement even after the child report");
        assert.equal((await state()).mode, "stopping");
        await worker.settle();
      }
      const view = await state();
      assert.equal(view.tasks[0].launch.kind, held ? "assigned" : "reported");
      if (scenario === "child-drain" || scenario === "child-drain-native-turn" || scenario === "child-stop-owner-loss" || scenario === "child-lost-owner") {
        await until(async () => (await state()).mode === "inactive", "native child drain parked");
        assert.equal((await state()).snapshot.shutdown.workers[0].state.kind, "parked");
        if (originalShutdown) {
          assert.equal((await state()).snapshot.shutdown.id, originalShutdown);
          const loss = JSON.parse(fs.readFileSync(join(profile, "legion", "tribuni", assignment.worker.address.launch, assignment.worker.address.generation, `${originalShutdown}.owner-loss.json`), "utf8"));
          assert.equal(loss.reason, "owner-lost");
          assert.equal(loss.stop.shutdown, originalShutdown);
          await assertCannotRestoreAuthority();
        }
      }
      if (scenario === "child-owner-loss" || census?.ownerLoss || missingOwner) {
        const workerRoot = join(profile, "legion", "tribuni", assignment.worker.address.launch), generation = join(workerRoot, assignment.worker.address.generation);
        if (!held && !missingOwner) await until(() => fs.readdirSync(generation).some(file => file.endsWith(".park.json")), "exact native child retirement settlement");
        else assert.equal(fs.readdirSync(generation).some(file => file.endsWith(".park.json")), false, "Missing owner/native proof cannot park even a retired worker");
        const retirement = JSON.parse(fs.readFileSync(join(workerRoot, "retirement.json"), "utf8"));
        assert.equal(retirement.reason, missingOwner ? "owner-unresolved" : "owner-lost");
        assert.equal(retirement.stop.command, assignment.command);
        if (missingOwner) {
          const park = JSON.parse(fs.readFileSync(join(generation, `${retirement.stop.shutdown}.park-held.json`), "utf8"));
          assert.equal(park.state.kind, "held");
          const reads = fs.readdirSync(generation).filter(file => file.endsWith(".effect-request.json"))
            .map(file => JSON.parse(fs.readFileSync(join(generation, file), "utf8")))
            .filter(frame => frame.message.kind === "centurio-owner-check" && frame.message.stage === "read");
          assert.ok(reads.length > 0, "Missing identity must still require the public authenticated parent settlement check");
          for (const { message } of reads) {
            const response = JSON.parse(fs.readFileSync(join(generation, `${assignment.command}.${message.id}.effect-response.json`), "utf8"));
            assert.equal(response.kind, "centurio-owner-current");
            assert.equal(response.id, message.id);
            assert.deepEqual(response.child, message.child);
          }
          await assertCannotRestoreAuthority();
        }
      }
      if (census?.drain && held) {
        assert.equal(view.mode, "stopping");
        assert.notEqual(view.snapshot.shutdown.workers[0].state.kind, "parked");
      }
      if (scenario === "child-failed") assert.equal(view.tasks[0].launch.report.outcome, "failed");
      assert.equal(fs.readFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "utf8"), "Parent uncommitted sentinel");
      if (scenario === "child-unknown-proof") {
        status.processTerminal.state = "observed"; proof.state = "observed"; publishNative(); fs.writeFileSync(join(directory, "process-terminal.json"), JSON.stringify(proof)); await delay(40);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown", "Unknown cannot be promoted by a later ordinary observation");
      }
      return { root, view: await state() };
    }
    if (scenario === "deny") worker.pi.on("tool_call", event => event.toolName === "write" ? { block: true, reason: "Ordinary root permission denial" } : undefined);
    if (scenario === "unknown") worker.external(async () => { throw new Error("Native execute failed without conclusive effects"); });
    if (scenario === "changed-input") worker.pi.on("tool_call", event => { if (event.toolName === "write") event.input.path = "changed.txt"; });
    const result = await worker.call("write", { path: "ready.txt", content: "Ready" });
    const uncertain = scenario === "unknown" || scenario === "changed-input";
    const expected = scenario === "deny" ? "refused" : uncertain ? "unknown" : "completed";
    await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === expected, "root native effect result");
    assert.equal(result.isError ?? false, scenario === "deny" || scenario === "unknown");
    assert.equal(fs.existsSync(join(worker.ctx.cwd, "ready.txt")), scenario !== "deny" && !uncertain);
    if (scenario === "changed-input") assert.equal(fs.readFileSync(join(worker.ctx.cwd, "changed.txt"), "utf8"), "Ready", "Native execution is not replaced by a final-execute veto");
    if (uncertain) assert.equal((await worker.call("write", { path: "second.txt", content: "no" })).isError, true);
    await worker.settle();
    await until(async () => (await state()).tasks[0].launch.kind === "reported", "root report");
    const view = await state();
    assert.equal(view.snapshot.engineering.length, 0);
    assert.equal(view.tasks[0].launch.report.outcome, uncertain ? "blocked" : "reported-result");
    return { root, view };
  } finally {
    await controller.emit("session_shutdown");
    if (worker) await worker.emit("session_shutdown");
    scheduled = []; globalThis.setTimeout = originalTimer;
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
export function exerciseRace(kind, options) {
  if (kind !== "readiness") throw new Error("Retired controlled workflow fixture; see tests/historical");
  return exerciseNativeAssignment("readiness", options);
}

// Deterministic public extension/native composition seam, not a real child execution.
export async function exerciseOrdinaryLegatusResearch(legacyHold = false) {
  const root = await mkdtemp(join(tmpdir(), "legatus-ordinary-native-"));
  const profile = join(root, "profile"), bin = join(root, "bin");
  fs.mkdirSync(profile); fs.mkdirSync(bin);
  const prior = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD, PATH: process.env.PATH };
  process.env.PI_CODING_AGENT_DIR = profile; delete process.env.PI_SUBAGENT_CHILD;
  fs.writeFileSync(join(bin, "herdr"), '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "0.9.1" : JSON.stringify({status:"running",running:true,version:"0.9.1",protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:"/controlled/herdr.sock"}));\n', { mode: 0o700 });
  process.env.PATH = `${bin}:${prior.PATH}`;
  const principal = runtime(root, "legatus-ordinary-native", join(root, "principal.jsonl"));
  const input = { agent: "scout", task: "Find the API", model: "configured/native", tools: ["read"], extensionBindings: { "unrelated/1": { value: "preserved" } } };
  let deny = false;
  const nativeInputs = [];
  principal.external(async (name, raw) => {
    nativeInputs.push(structuredClone(raw));
    if (name === "subagents_enable") return { content: [], details: { enabled: true } };
    if (name !== "subagent") throw new Error(`Unknown native tool ${name}`);
    const policy = buildInProcessChildLaunch({ parentSessionId: principal.ctx.sessionManager.getSessionId(), cwd: root, host: "runner", sessionEnabled: false, childAgentName: raw.agent, childIndex: 0, inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false, tools: raw.tools, model: raw.model, extensionBindings: raw.extensionBindings });
    return { content: [], details: { requiredExtensions: policy.launchResolvedExtensions.required } };
  });
  extension(principal.pi);
  principal.pi.on("tool_call", event => deny && event.toolName === "subagent" ? { block: true, reason: "Ordinary native permission denial" } : undefined);
  const state = async () => {
    await principal.command("status");
    const notice = principal.notices.at(-1);
    return notice === "Legion is inactive." ? { mode: "inactive", snapshot: null } : JSON.parse(notice.split("State\n")[1].split("\n")[0]);
  };
  try {
    if (legacyHold) {
      const { createSnapshot, SnapshotStore } = await import("../../src/snapshot.ts");
      const saved = createSnapshot({ id: randomUUID(), context: root });
      saved.generation = 1;
      saved.attachments.push({ session: principal.ctx.sessionManager.getSessionId(), generation: 1 });
      saved.researchHold = "Historical unowned native activity; preserve evidence";
      fs.mkdirSync(join(profile, "legion"));
      await new SnapshotStore(join(profile, "legion")).save(saved, null, () => true);
    }
    await principal.emit("session_start");
    const outcomes = [];
    for (const command of ["status", "doctor", "on", "off"]) {
      await principal.command(command);
      const before = await state();
      const retiredNotices = principal.notices.length;
      await principal.command("research Find the API");
      const retired = principal.notices.slice(retiredNotices);
      const notice = { role: "custom", customType: "subagent-notify", content: "Native finding: facts.md:1", details: { runs: [{ runId: "ordinary-run", agent: "scout", status: "completed" }] }, display: true, timestamp: 1 };
      const contextResult = await principal.emit("context", { messages: [notice] });
      const wakeStarted = await principal.start("Subagent updates above.");
      await principal.settle(false, "Native findings received normally.");
      const loader = await principal.call("subagents_enable", {});
      const launched = await principal.call("subagent", input);
      principal.pi.events.emit("subagent:async-started", { id: "ordinary-run", sessionId: principal.ctx.sessionManager.getSessionId(), agent: "scout", cwd: root });
      principal.pi.events.emit("subagent:async-complete", { id: "ordinary-run", runId: "ordinary-run", sessionId: principal.ctx.sessionManager.getSessionId(), agent: "scout", cwd: root });
      deny = true;
      const refused = await principal.call("subagent", input);
      deny = false;
      const after = await state();
      outcomes.push({ command, before, after, retired, contextResult, wakeStarted, loader, launched, refused, nativeInputs: nativeInputs.splice(0) });
    }
    return outcomes;
  } finally {
    await principal.emit("session_shutdown");
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

export const exerciseNativeWorkflow = scenario => exerciseNativeAssignment(`workflow-${scenario}`);
