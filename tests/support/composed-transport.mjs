import centurioGuard from "../../src/centurio-guard.ts";
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
import { randomUUID } from "node:crypto";
import { execFile, exec as shell } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import extension from "../../src/extension.ts";
import { installTribunus, LocalTribunusHost } from "../../src/tribunus-host.ts";
import { stripFrontmatter, createReadTool, createReadToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, loadSkills, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";

const execute = promisify(execFile), executeShell = promisify(shell);
const pstack = "/home/vscode/.pi/agent/npm/node_modules/@zenspc/pi-pstack";
const skill = join(pstack, "skills/poteto-mode/SKILL.md");
const commands = [{ name: "pstack", source: "extension", sourceInfo: { path: join(pstack, "extensions/pstack/index.ts") } }, ...["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: name === "poteto-mode" ? skill : `/controlled/${name}/SKILL.md` } }))];
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) { if (await predicate()) return; await delay(5); }
  throw new Error(`Fixture timeout. ${label}`);
}
function runtime(cwd, session, journal) {
  const handlers = new Map(), tools = new Map(), registeredCommands = new Map(), entries = [], prompts = [], notices = [];
  const nativeTools = new Map([createReadToolDefinition(cwd), createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd), createBashToolDefinition(cwd), createEditToolDefinition(cwd), createWriteToolDefinition(cwd)].map(tool => [tool.name, tool]));
  let discovered = commands, onBranch = null;
  let idle = true, pending = false, rootCall = null, onIdle = null, onAuth = null, authenticated = true, sendFailure = false;
  const consumed = new Set();
  const append = entry => { const result = { id: randomUUID(), ...entry }; entries.push(result); fs.appendFileSync(journal, JSON.stringify(result) + "\n"); return result; };
  const ctx = {
    mode: "tui", cwd, isProjectTrusted: () => true,
    isIdle: () => { const hook = onIdle; onIdle = null; hook?.(); return idle; },
    hasPendingMessages: () => pending,
    sessionManager: { getSessionId: () => session, getSessionFile: () => journal, getBranch: () => { const hook = onBranch; onBranch = null; hook?.(); return entries; }, getLeafId: () => entries.at(-1)?.id },
    ui: { notify: message => notices.push(message), setStatus: () => {} },
    model: { provider: "controlled", id: "selected", input: ["text"] },
    modelRegistry: { getAvailable: () => [{ provider: "controlled", id: "selected" }], getApiKeyAndHeaders: async () => { const hook = onAuth; onAuth = null; await hook?.(); return authenticated ? { ok: true, apiKey: "controlled" } : { ok: false }; }, hasConfiguredAuth: () => authenticated },
    executeTool: async (name, input) => { const id = `${rootCall}/nested/${randomUUID()}`; const result = await call(name, input, id, rootCall); return { ...(result.result ? result : { result }), toolCall: { id, name, arguments: input }, isError: result.isError ?? false }; }
  };
  const events = new EventEmitter();
  const pi = {
    events: { emit: (name, value) => events.emit(name, value), on: (name, handler) => { events.on(name, handler); return () => events.off(name, handler); } },
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, command) => registeredCommands.set(name, command),
    getCommands: () => discovered,
    getSettings: () => ({}),
    getAllTools: () => [...["read", "grep", "find", "ls", "bash", "write", "edit"].map(name => ({ name, sourceInfo: { path: tools.has(name) ? "controlled-legion-extension" : `builtin:${name}` } })), ...["subagent", "subagents_enable"].map(name => ({ name, exposure: "model-only", sourceInfo: { path: "/home/vscode/.pi/agent/npm/node_modules/pi-subagents/index.js" } }))],
    sendMessage: message => append({ type: "custom_message", ...message }),
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
  let external = async () => { throw new Error("No external tool installed"); };
  async function call(name, input, id = randomUUID(), parentToolCallId) {
    const call = { type: "toolCall", id, name, arguments: structuredClone(input) };
    if (!parentToolCallId) append({ type: "message", message: { role: "assistant", content: [call], stopReason: "toolUse" } });
    const previous = rootCall; rootCall = id;
    try {
      let result;
      try {
        const definition = tools.get(name) ?? nativeTools.get(name);
        if (definition) {
          const prepared = definition.prepareArguments ? definition.prepareArguments(call.arguments) : call.arguments;
          input = validateToolArguments(definition, { type: "toolCall", id, name, arguments: prepared });
        }
        const guard = await emit("tool_call", { toolName: name, toolCallId: id, input, ...(parentToolCallId ? { parentToolCallId } : {}) });
        result = guard?.block ? { isError: true, content: [{ type: "text", text: guard.reason }], details: guard }
          : tools.has(name) ? await tools.get(name).execute(id, input, undefined, undefined, ctx) : await external(name, input);
      } catch (error) { result = { content: [{ type: "text", text: String(error) }], isError: true }; }
      const transformed = await emit("tool_result", { toolName: name, toolCallId: id, input, ...result, isError: result.isError ?? false });
      if (transformed) result = { ...result, ...transformed };
      await emit("tool_execution_end", { toolName: name, toolCallId: id, result, isError: result.isError ?? false, ...(parentToolCallId ? { parentToolCallId } : {}) });
      if (!parentToolCallId) {
        const entry = append({ type: "message", message: { role: "toolResult", toolName: name, toolCallId: id, ...result, isError: result.isError ?? false } });
        await emit("message_end", { message: entry.message });
      }
      return result;
    } finally { rootCall = previous; }
  }
  async function start(prompt, native = false) {
    assert.equal(consumed.has(prompt), false, "The external Pi fixture cannot replay a consumed marker");
    consumed.add(prompt);
    const input = await emit("input", { source: "extension", text: prompt });
    if (input?.action === "handled") return false;
    if (!authenticated) throw new Error("Controlled native Pi authentication refusal before agent_start");
    const skill = discovered.find(command => command.name === "skill:poteto-mode" && command.source === "skill")?.sourceInfo.path;
    const expanded = native ? `<skill name="poteto-mode" location="${skill}">\nReferences are relative to ${dirname(skill)}.\n\n${stripFrontmatter(fs.readFileSync(skill, "utf8")).trim()}\n</skill>\n\n${prompt.slice("/skill:poteto-mode ".length)}` : prompt;
    const prepared = await emit("before_agent_start", { prompt: expanded, systemPrompt: "Controlled external model" });
    if (prepared?.message) append({ type: "custom_message", ...prepared.message });
    idle = false;
    const user = append({ type: "message", message: { role: "user", content: [{ type: "text", text: expanded }] } });
    await emit("message_end", { message: user.message });
    await emit("agent_start");
    await new Promise(resolve => setImmediate(resolve));
    return true;
  }
  async function settle(native = false, text = "Waiting.", stopReason = "stop") {
    assert.equal(idle, false, "Only an admitted model turn can emit agent_settled");
    if (native) pi.appendEntry("pstack-mode", { enabled: true });
    append({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason } });
    idle = true;
    await emit("agent_settled");
  }
  return { pi, ctx, prompts, notices, emit, call, start, settle, onBranch: hook => { onBranch = hook; }, resources: value => { discovered = value; }, setAuth: value => { authenticated = value; }, failSend: () => { sendFailure = true; }, setPending: value => { pending = value; }, setIdle: value => { idle = value; }, onIdle: hook => { onIdle = hook; }, onAuth: hook => { onAuth = hook; }, external: handler => { external = handler; }, command: text => registeredCommands.has("legion") ? registeredCommands.get("legion").handler(text, ctx) : "Command /legion is unavailable in this session." };
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

export async function exerciseRace(kind, census) {
  const root = await mkdtemp(join(tmpdir(), "legion-composed-")), profile = join(root, "agent"), repo = join(root, "repo"), bin = join(root, "bin");
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
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);const file=${JSON.stringify(paneFile)};let pane=JSON.parse(fs.readFileSync(file));if(a[0]==='--version')console.log('0.9.1');else if(a[0]==='status')console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));else if(a[0]==='workspace'||a[0]==='tab'){fs.writeFileSync(${JSON.stringify(join(root, "layout-command.json"))},JSON.stringify(a));delete pane.agent;delete pane.agent_session;pane.tab_id='controlled-worker-tab';pane.pane_id='controlled-worker-pane';pane.foreground_cwd=a[a.indexOf('--cwd')+1];fs.writeFileSync(file,JSON.stringify(pane));fs.writeFileSync(${JSON.stringify(createdFile)},JSON.stringify({bootstrap:a[a.indexOf('--env')+1].split('=').slice(1).join('=')}));console.log(JSON.stringify({result:{root_pane:pane}}));}else if(a[1]==='get')console.log(JSON.stringify({result:{pane}}));else console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${census?.childCase === "caller-process" ? process.pid + 1 : process.pid}}]}}}));\n`, { mode: 0o700 });
  let refreshWorkerResources = null, workerPaths = [], workerDescriptor = null, proofInspections;
  let worker = null, originalTimer = globalThis.setTimeout, scheduled = [], workerFailure = null;
  const controller = runtime(repo, "composed-controller", join(root, "controller.jsonl"));
  globalThis.setTimeout = (callback, milliseconds, ...args) => milliseconds === 0 ? (scheduled.push(() => callback(...args)), { unref() {} }) : originalTimer(callback, milliseconds, ...args);
  const drain = async () => { const batch = scheduled; scheduled = []; for (const callback of batch) callback(); await delay(20); };
  controller.external(async (name, { command }) => {
    assert.equal(name, "bash");
    let output, exitCode = 0;
    if (command.startsWith("herdr agent start ")) {
      const { bootstrap } = JSON.parse(await readFile(createdFile, "utf8"));
      const descriptor = JSON.parse(await readFile(bootstrap, "utf8"));
      workerDescriptor = descriptor;
      worker = runtime(descriptor.cwd, randomUUID(), join(root, "worker.jsonl"));
      for (const name of ["matt-tdd", "matt-teach"]) fs.cpSync(new URL(`../../.agents/skills/${name}`, import.meta.url), join(descriptor.cwd, ".agents/skills", name), { recursive: true });

      if (kind === "contract" && ["truncated", "truncated-continuation"].includes(census?.loadCase)) fs.appendFileSync(join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md"), "\n" + "Reference line\n".repeat(2100));
      if (census?.loadCase === "truncated-bytes") fs.appendFileSync(join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md"), "\n" + ("Large reference "+"x".repeat(3000)+"\n").repeat(30));
      if (census?.loadCase === "incomplete-bytes") fs.appendFileSync(join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md"), "\n" + "x".repeat(60000) + "\nFinal complete line.\n");
      if (kind === "contract" && census?.resourceCase === "missing") fs.unlinkSync(join(descriptor.cwd, ".agents/skills/matt-teach/SKILL.md"));
      if (kind === "contract" && ["shadow", "disabled", "selected-deleted", "selected-wrong-identity"].includes(census?.resourceCase)) {
        const duplicate = join(descriptor.cwd, ".pi/skills/matt-tdd/SKILL.md");
        fs.mkdirSync(dirname(duplicate), { recursive: true });
        fs.cpSync(join(descriptor.cwd, ".agents/skills/matt-tdd"), dirname(duplicate), { recursive: true });
      }
      if (kind === "contract" && census?.resourceCase === "conflicting") {
        const path = join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md");
        fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("name: matt-tdd", "name: tdd"));
      }
      if (kind === "contract" && census?.resourceCase === "invalid-utf8") fs.appendFileSync(join(descriptor.cwd, ".agents/skills/matt-tdd/tests.md"), Buffer.from([0x80]));
      if (kind === "contract" && census?.resourceCase === "alias") {
        fs.mkdirSync(join(descriptor.cwd, ".pi/skills"), { recursive: true });
        fs.symlinkSync(join(descriptor.cwd, ".agents/skills/matt-tdd"), join(descriptor.cwd, ".pi/skills/matt-tdd"));
      }
      if (kind === "contract" && census?.resourceCase === "reference-missing") fs.unlinkSync(join(descriptor.cwd, ".agents/skills/matt-tdd/tests.md"));
      if (census?.loadCase?.startsWith("path-normalized")) fs.renameSync(join(descriptor.cwd, ".agents/skills/matt-tdd"), join(descriptor.cwd, ".agents/skills/matt tdd"));
      let selectedPoteto = dirname(skill);
      if (census?.loadCase?.startsWith("snapshot-") || census?.effectCase?.startsWith("controller-")) {
        const packageRoot = join(root, "native-pstack");
        selectedPoteto = join(packageRoot, "skills/poteto-mode");
        fs.cpSync(dirname(skill), selectedPoteto, { recursive: true });
        fs.copyFileSync(join(pstack, "package.json"), join(packageRoot, "package.json"));
      }
      const nativePaths = [join(descriptor.cwd, ".agents/skills"), selectedPoteto, ...["tdd", "teach"].map(name => join(pstack, "skills", name))];
      if (census?.resourceCase !== "disabled") nativePaths.push(join(descriptor.cwd, ".pi/skills"));
      workerPaths = nativePaths;
      refreshWorkerResources = (paths = workerPaths, interception) => {
        const resolved = loadSkills({ cwd: descriptor.cwd, agentDir: profile, includeDefaults: false, skillPaths: paths });
        fs.appendFileSync(join(root, "native-discovery.jsonl"), JSON.stringify({ options: { includeDefaults: false, skillPaths: paths }, ...resolved }) + "\n");
        const unrelatedCommands = commands.filter(command => !["skill:matt-tdd", "skill:matt-teach", "skill:poteto-mode"].includes(command.name));
        worker.resources([...unrelatedCommands, ...resolved.skills.map(resource => ({ name: `skill:${resource.name}`, source: "skill", sourceInfo: resource.sourceInfo })), ...(interception ? [{ name: "skill:matt-tdd", source: interception, sourceInfo: { path: join(descriptor.cwd, `intercept-${interception}.ts`) } }] : [])]);
      };
      worker.resources([]);
      worker.external(async (name, input) => {
        assert.equal(name, "read");
        if (kind === "contract" && census?.loadCase === "changed-during-read" && input.path.endsWith("mocking.md")) fs.appendFileSync(input.path, "\nChanged during native read.\n");
        const result = await createReadTool(descriptor.cwd, census?.loadCase === "read-error" && input.path.endsWith("SKILL.md") ? { operations: { access: async () => { throw new Error("Controlled native read access denied"); }, readFile: fs.promises.readFile } } : undefined).execute(randomUUID(), input);
        return kind === "contract" && census?.loadCase === "failed" && input.path.endsWith("SKILL.md") ? { ...result, isError: true } : result;
      });
      worker.pi.sendUserMessage = prompt => {
        worker.prompts.push(prompt);
        void (async () => { const init = prompt.startsWith("/skill:"); await worker.start(prompt, init); if (init) await worker.settle(true); })().catch(error => { workerFailure = error; });
      };
      if (census?.effectCase === "native-legacy-early-mutate") worker.pi.on("tool_call", event => {
        if (event.toolName === "edit") event.input.edits[0].newText = "Changed before admission";
      });
      installTribunus(worker.pi, bootstrap);
      await worker.emit("session_start");
      await worker.emit("resources_discover", { cwd: descriptor.cwd, reason: "startup" });
      refreshWorkerResources();
      if (census?.resourceCase === "selected-deleted") fs.unlinkSync(join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md"));
      if (census?.resourceCase === "selected-wrong-identity") {
        const selected = join(descriptor.cwd, ".agents/skills/matt-tdd/SKILL.md");
        fs.writeFileSync(selected, fs.readFileSync(selected, "utf8").replace("name: matt-tdd", "name: tdd"));
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
  extension(controller.pi);
  async function state() {
    const before = controller.notices.length;
    await controller.command("status");
    const text = controller.notices.slice(before).find(value => value.includes("\nState\n"));
    assert.ok(text, "Fixture setup must expose public status");
    return JSON.parse(text.split("\nState\n")[1]);
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
    await controller.command("task Fix the Ready label");
    await drain(); await until(() => controller.prompts.length === 1, "initial intake prompt");
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
    if (kind === "contract") {
      if (census?.loadCase) {
        assert.equal(launched.details.kind, "launched", "Fixture setup must launch before native reads");
        const matt = dirname(worker.pi.getCommands().find(command => command.name === "skill:matt-tdd" && command.source === "skill").sourceInfo.path);
        for (const file of ["SKILL.md", "tests.md", "mocking.md"]) {
          const path = join(matt, file);
          if (file === "SKILL.md" && ["partial", "chunks", "gap", "changed-chunks", "reordered"].includes(census.loadCase)) {
            await worker.call("read", census.loadCase === "reordered" ? { limit: 2, path } : { path, limit: 2 });
            if (census.loadCase === "changed-chunks") fs.appendFileSync(path, "\nChanged between chunks.\n");
            if (["chunks", "changed-chunks", "gap", "reordered"].includes(census.loadCase)) await worker.call("read", census.loadCase === "reordered" ? { offset: 3, path } : { path, offset: census.loadCase === "gap" ? 4 : 3 });
          } else if (file === "SKILL.md" && ["truncated-continuation", "truncated-bytes", "incomplete-bytes"].includes(census.loadCase)) {
            let native = await worker.call("read", { path });
            while (native.details?.truncation?.truncated && !native.details.truncation.firstLineExceedsLimit) {
              const offset = Number(native.content[0].text.match(/Use offset=(\d+) to continue/)[1]);
              native = await worker.call("read", { path, offset });
              if (native.details?.truncation?.firstLineExceedsLimit) await worker.call("read", { path, offset: offset + 1 });
            }
          } else if (file === "SKILL.md" && census.loadCase.startsWith("path-")) {
            const alternate = census.loadCase.startsWith("path-at") ? `@${path}` : census.loadCase.startsWith("path-tilde") ? `~/${relative(homedir(), path)}` : path.replace("matt tdd", "matt\u00a0tdd");
            const native = await worker.call("read", { path: alternate });
            assert.equal(native.isError ?? false, false, "Fixture alternate syntax must succeed in the real native read tool");
            if (census.loadCase.endsWith("-reread")) await worker.call("read", { path });
          } else await worker.call("read", census.loadCase.startsWith("optional-nulls") ? { path, offset: null, limit: null } : { path });
        }
        if (census.loadCase.startsWith("optional-nulls")) {
          const retained = fs.readFileSync(worker.ctx.sessionManager.getSessionFile());
          const rawCalls = retained.toString("utf8").trimEnd().split("\n").map(JSON.parse).flatMap(entry => entry.message?.role === "assistant" ? entry.message.content.filter(part => part.type === "toolCall" && part.name === "read") : []);
          assert.equal(rawCalls.length, 3);
          for (const call of rawCalls) assert.deepEqual(call.arguments, { path: call.arguments.path, offset: null, limit: null }, "Native validation must not rewrite persisted original null arguments");
          if (census.loadCase !== "optional-nulls") worker.onBranch(() => {
            const branch = worker.ctx.sessionManager.getBranch();
            const entry = branch.find(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall" && part.id === rawCalls[0].id));
            const call = entry.message.content.find(part => part.id === rawCalls[0].id);
            if (census.loadCase.endsWith("changed-path")) call.arguments.path = join(matt, "mocking.md");
            else call.arguments.offset = 2;
          });
          fs.writeFileSync(join(root, "retained-read-originals.json"), JSON.stringify(rawCalls, null, 2));
          fs.writeFileSync(join(root, "retained-journal-before.jsonl"), retained);
        }
        if (census.loadCase.startsWith("snapshot-")) {
          const assigned = (await state()).tasks[0].launch;
          assert.equal(assigned.kind, "assigned");
          const host = new LocalTribunusHost(async command => ({ kind: "finished", code: 0, output: (await executeShell(command)).stdout }), workerDescriptor.authority);
          const inspect = async () => (await host.inspectWorker({ launch: workerDescriptor.launch, window: assigned.worker.address.window, cwd: worker.ctx.cwd })).resources.contract;
          const before = await inspect();
          const poteto = worker.pi.getCommands().find(command => command.name === "skill:poteto-mode" && command.source === "skill").sourceInfo.path;
          const path = census.loadCase.includes("-matt-") ? join(matt, "SKILL.md") : poteto;
          const bytes = fs.readFileSync(path);
          worker.onBranch(() => {
            if (census.loadCase.endsWith("unavailable")) fs.unlinkSync(path);
            else fs.appendFileSync(path, "\nChanged during contract inspection.\n");
          });
          let failed;
          try { failed = await inspect(); }
          finally { fs.writeFileSync(path, bytes); }
          const restored = await inspect();
          for (const file of ["SKILL.md", "tests.md", "mocking.md"]) await worker.call("read", { path: join(matt, file) });
          const afterMatt = await inspect();
          await worker.call("read", { path: poteto });
          const recovered = await inspect();
          proofInspections = { before, failed, restored, afterMatt, recovered };
          fs.writeFileSync(join(root, "proof-inspections.json"), JSON.stringify(proofInspections, null, 2));
        }
        if (census.loadCase === "changed") fs.appendFileSync(join(matt, "mocking.md"), "\nChanged after native loading.\n");
        if (census.loadCase.startsWith("selection-")) {
          const replacement = join(worker.ctx.cwd, "replacement/matt-tdd");
          fs.cpSync(matt, replacement, { recursive: true });
          refreshWorkerResources([replacement, ...workerPaths]);
          if (census.loadCase === "selection-returned") {
            await worker.call("read", { path: join(replacement, "SKILL.md") });
            refreshWorkerResources();
          }
          if (census.loadCase === "selection-reread") for (const file of ["SKILL.md", "tests.md", "mocking.md"]) await worker.call("read", { path: join(replacement, file) });
        }
        if (census.loadCase.startsWith("intercept-")) refreshWorkerResources(workerPaths, census.loadCase.slice("intercept-".length));
        const refusal = await worker.call("write", { path: join(worker.ctx.cwd, "forbidden"), content: "no" });
        assert.equal(refusal.isError, true, "Complete contract loading must not unlock mutation");
        if (census.loadCase === "waiting") {
          const proposal = await worker.call("legion_engineering", { kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Run the public label test" });
          assert.equal(proposal.details.kind, "waiting");
          await until(async () => (await state()).snapshot.engineering.length === 1, "contract-loading proposal ingestion");
        }
        await worker.settle();
        if (census.loadCase !== "waiting") await until(async () => (await state()).tasks[0].launch.kind === "reported", "public contract report");
        else await delay(100);
      }
      return { launch: (await state()).tasks[0].launch, root, cwd: worker.ctx.cwd, ...(proofInspections ? { proofInspections } : {}) };
    }
    assert.equal(launched.details.kind, "launched", JSON.stringify(launched));
    if (kind === "child-discovery") {
      const discovered = join(root, "capabilities-read.txt");
      worker.external(async (name, input) => {
        if (name === "subagents_enable") {
          assert.deepEqual(input, {});
          return { content: [{ type: "text", text: "Enabled: subagent." }] };
        }
        assert.equal(name, "subagent");
        assert.deepEqual(input, { action: "list", capabilities: true });
        fs.writeFileSync(discovered, "Native capabilities inspected without launching.");
        return { content: [{ type: "text", text: "Native capability catalog" }], details: { agents: [] } };
      });
      const enabled = await worker.call("subagents_enable", {});
      assert.equal(enabled.content[0].text, "Enabled: subagent.", "BEHAVIOR managed preparation permits the native loader without launching");
      assert.equal((await worker.call("subagents_enable", { task: "smuggled" })).isError, true);
      const catalog = await worker.call("subagent", { action: "list", capabilities: true });
      assert.equal(catalog.content[0].text, "Native capability catalog", "BEHAVIOR managed preparation permits exact native capability discovery without launch authority");
      assert.equal(fs.readFileSync(discovered, "utf8"), "Native capabilities inspected without launching.");
      const mixed = await worker.call("subagent", { action: "list", capabilities: true, task: "Smuggled launch" });
      assert.equal(mixed.isError, true);
      const management = await worker.call("subagent", { action: "stop", id: "foreign-run" });
      assert.equal(management.isError, true);
      const prepared = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Read only." });
      assert.equal(prepared.details.kind, "prepared");
      return { root, view: await state() };
    }
    if (kind === "child-owned" || kind === "child-startup-order" || kind === "child-early-startup") {
      if (census?.childCase === "topology") {
        const layout = JSON.parse(await readFile(join(root, "layout-command.json"), "utf8"));
        assert.deepEqual(layout.slice(0, 4), ["tab", "create", "--workspace", "controlled-workspace"], "BEHAVIOR a Tribunus launches in a new tab in its verified owning Legatus workspace");
        assert.equal(layout.includes("--no-focus"), true);
      }
      const prepared = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Read the Ready label implementation and report findings." });
      assert.equal(prepared.details?.kind, "prepared");
      const input = prepared.details.launch;
      const runner = randomUUID(), completionOwnerId = randomUUID();
      const runId = randomUUID(), childSession = randomUUID(), asyncDir = join(root, "native-owned-run"), childJournal = join(root, "owned-child.jsonl"), outputFile = join(asyncDir, "output-0.log");
      fs.mkdirSync(asyncDir);
      if (!["child-startup-order", "child-early-startup"].includes(kind)) fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: childSession, cwd: worker.ctx.cwd }) + "\n");
      const status = { runId, sessionId: worker.ctx.sessionManager.getSessionFile(), completionOwnerId, mode: "single", state: "running", cwd: worker.ctx.cwd, currentStep: 0,
        launchContractDigest: "observed-native-contract", launchResolvedExtensions: { version: 1, source: "launch-resolved", disableAmbientExtensions: false, required: ["pi-legion-centurio"] },
        processTerminal: { version: 1, state: "pending", runId, runnerProcessInstanceId: runner },
        runtimeAcknowledgedExtensions: { version: 1, source: "child-runtime", ids: ["pi-legion-centurio"], omitted: 0 },
        steps: [{ agent: input.agent, sessionFile: childJournal, model: input.model, requestedModel: input.model, context: "fresh", launchContractDigest: "observed-native-contract" }], outputFile };
      const child = runtime(worker.ctx.cwd, childSession, childJournal);
      if (census?.childCase === "startup-override") {
        const all = child.pi.getAllTools();
        child.pi.getAllTools = () => all.map(tool => tool.name === "read" ? { ...tool, sourceInfo: { path: "configured-independent-override" } } : tool);
      }
      async function startChild() {
        const priorChild = process.env.PI_SUBAGENT_CHILD, priorBinding = process.env.PI_SUBAGENT_EXTENSION_BINDINGS;
        try {
          process.env.PI_SUBAGENT_CHILD = "1";
          process.env.PI_SUBAGENT_EXTENSION_BINDINGS = JSON.stringify(input.extensionBindings);
          centurioGuard(child.pi);
        } finally {
          priorChild === undefined ? delete process.env.PI_SUBAGENT_CHILD : process.env.PI_SUBAGENT_CHILD = priorChild;
          priorBinding === undefined ? delete process.env.PI_SUBAGENT_EXTENSION_BINDINGS : process.env.PI_SUBAGENT_EXTENSION_BINDINGS = priorBinding;
        }
        let started = true;
        try { await child.emit("session_start"); } catch { started = false; }
        if (census?.childCase === "startup-override") {
          assert.equal(started, false, "An existing read override refuses mandatory child startup rather than being replaced");
          assert.equal(child.pi.getAllTools().find(tool => tool.name === "read").sourceInfo.path, "configured-independent-override");
        } else assert.equal(started, true, "BEHAVIOR the mandatory guard joins the actual native child to its owning principal before reads");
      }
      worker.external(async name => {
        assert.equal(name, "subagent");
        if (kind === "child-early-startup") await startChild();
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status));
        if (census?.childCase === "structured-completion") worker.pi.events.emit("subagent:async-started", { id: runId, sessionId: status.sessionId, completionOwnerId, asyncDir, cwd: status.cwd, mode: "single", agent: input.agent });
        return { content: [{ type: "text", text: "Native runtime accepted one child." }], details: { runId, asyncDir }, isError: false };
      });
      if (census?.childCase === "root-deny") {
        worker.pi.on("tool_call", event => event.toolName === "subagent" ? { block: true, reason: "Independent ordinary root permission denial" } : undefined);
        const refused = await worker.call("subagent", input);
        assert.equal(refused.isError, true, "Ordinary root denial refuses the admitted launch");
        assert.equal(fs.existsSync(join(asyncDir, "status.json")), false, "Ordinary root denial must not launch a native child");
        return { root, view: await state() };
      }
      const launchedChild = await worker.call("subagent", input);
      assert.equal(launchedChild.isError ?? false, false, "BEHAVIOR startup can precede the independently observed native launch response");
      if (kind !== "child-early-startup") await startChild();
      if (census?.childCase === "startup-override") {
        const refused = await child.call("read", { path: join(worker.ctx.cwd, "README.md") });
        assert.equal(refused.isError, true, "Failed mandatory startup authorizes no read effects");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (["child-startup-order", "child-early-startup"].includes(kind)) {
        assert.equal(fs.existsSync(childJournal), false, "Startup must not fabricate persistence");
        fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: childSession, cwd: worker.ctx.cwd }) + "\n");
      }
      const target = join(worker.ctx.cwd, "read-only-evidence.txt");
      fs.writeFileSync(target, "Owned child read succeeded.");
      const oldAccess = new Date("2000-01-01T00:00:00Z");
      fs.utimesSync(target, oldAccess, oldAccess);
      child.external((name, args) => { assert.equal(name, "read"); return createReadTool(worker.ctx.cwd).execute(randomUUID(), args); });
      assert.equal((await child.call("read", { path: target })).content[0].text, "Owned child read succeeded.");
      assert.ok(fs.statSync(target).atimeMs > oldAccess.getTime(), "The real native baseline must produce observable filesystem read access");
      assert.equal((await child.call("write", { path: target, content: "Forbidden" })).isError, true);
      if (census?.childCase === "read-tools") {
        assert.match((await child.call("grep", { pattern: "Owned child", path: target })).content[0].text, /Owned child read succeeded/);
        assert.match((await child.call("find", { pattern: "read-only-evidence.txt", path: worker.ctx.cwd })).content[0].text, /read-only-evidence.txt/);
        assert.match((await child.call("ls", { path: worker.ctx.cwd })).content[0].text, /read-only-evidence.txt/);
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (["child-deny", "late-owner", "late-model", "late-tool-owner", "owner-unavailable"].includes(census?.childCase)) {
        child.pi.on("tool_call", async event => {
          if (event.toolName !== "read") return;
          if (census.childCase === "child-deny") return { block: true, reason: "Independent ordinary child permission denial" };
          if (census.childCase === "late-owner") await controller.command("off");
          if (census.childCase === "owner-unavailable") await worker.emit("session_shutdown");
          if (census.childCase === "late-model") child.ctx.model = { provider: "controlled", id: "incompatible", input: ["text"] };
          if (census.childCase === "late-tool-owner") {
            const all = child.pi.getAllTools();
            child.pi.getAllTools = () => all.map(tool => tool.name === "read" ? { ...tool, sourceInfo: { path: "independent-override" } } : tool);
          }
        });
        fs.utimesSync(target, oldAccess, oldAccess);
        const refused = await child.call("read", { path: target });
        assert.equal(fs.statSync(target).atimeMs, oldAccess.getTime(), "Refused final native read must not access the file");
        assert.equal(refused.isError, true, "Final native read refuses ordinary denial or changed owner/model/tool provenance");
        assert.equal(refused.content.some(part => part.text?.includes("Owned child read succeeded.")), false, "No refused native contents escape");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "late-input") {
        const other = join(worker.ctx.cwd, "not-admitted.txt");
        fs.writeFileSync(other, "Unadmitted contents must not be read.");
        fs.utimesSync(other, oldAccess, oldAccess);
        fs.utimesSync(target, oldAccess, oldAccess);
        child.pi.on("tool_call", event => { if (event.toolName === "read") event.input.path = other; });
        const refused = await child.call("read", { path: target });
        assert.equal(refused.isError, true, "BEHAVIOR a later hook cannot substitute an unadmitted native read input");
        assert.equal(fs.statSync(other).atimeMs, oldAccess.getTime(), "Unadmitted input must not produce native filesystem read access");
        assert.equal(fs.statSync(target).atimeMs, oldAccess.getTime());
        assert.equal(refused.content.some(part => part.text?.includes("Unadmitted contents must not be read.")), false);
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (["foreign-owner", "stale-run", "missing-guard", "foreign-journal", "foreign-child-session", "foreign-event-session", "stale-event-owner", "foreign-event-directory"].includes(census?.childCase)) {
        if (census.childCase === "foreign-owner") fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, sessionId: "foreign-parent" }));
        if (census.childCase === "stale-run") fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, runId: "stale-run" }));
        if (census.childCase === "missing-guard") fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, launchResolvedExtensions: { ...status.launchResolvedExtensions, required: [] } }));
        if (census.childCase === "foreign-journal") fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: "reused-foreign-session", cwd: worker.ctx.cwd }) + "\n");
        if (census.childCase === "foreign-child-session") child.ctx.sessionManager.getSessionId = () => "foreign-child";
        if (census.childCase.includes("event")) {
          worker.pi.events.emit("subagent:async-complete", { id: runId, runId, sessionId: census.childCase === "foreign-event-session" ? "foreign-parent" : status.sessionId, completionOwnerId: census.childCase === "stale-event-owner" ? "stale-completion-owner" : completionOwnerId, asyncDir: census.childCase === "foreign-event-directory" ? root : asyncDir, cwd: status.cwd, mode: "single", agent: input.agent, sessionFile: childJournal });
        }
        assert.equal((await child.call("read", { path: target })).isError, true, "Foreign identities or missing required native guard refuse child effects");
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "mismatch", "Confirmed native identity/guard mismatch must be durable");
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status));
        fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: childSession, cwd: worker.ctx.cwd }) + "\n");
        child.ctx.sessionManager.getSessionId = () => childSession;
        assert.equal((await child.call("read", { path: target })).isError, true, "Valid-looking restoration cannot erase an identity mismatch");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "unknown-native-status") {
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, processTerminal: { ...status.processTerminal, state: "unknown", reason: "writer-close-unverified" } }));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown", "BEHAVIOR native status with genuinely unknown process effects cannot be treated as active");
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status));
        assert.equal((await child.call("read", { path: target })).isError, true);
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "child-model-mismatch") {
        child.ctx.model = { provider: "controlled", id: "foreign", input: ["text"] };
        assert.equal((await child.call("read", { path: target })).isError, true);
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "mismatch", "BEHAVIOR actual authenticated child model mismatch is a durable owned hold");
        child.ctx.model = { provider: "controlled", id: "selected", input: ["text"] };
        assert.equal((await child.call("read", { path: target })).isError, true, "Restoring the model must not erase confirmed mismatch");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (["partial-model", "partial-runner"].includes(census?.childCase)) {
        const partial = census.childCase === "partial-runner" ? { ...status, processTerminal: { ...status.processTerminal, runnerProcessInstanceId: "foreign-runner" } } : { ...status, steps: [{ ...status.steps[0], model: "controlled/foreign" }] };
        delete partial.launchContractDigest;
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(partial));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "mismatch", "BEHAVIOR a published model or process-instance contradiction is sticky even while other status fields are pending");
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status));
        assert.equal((await child.call("read", { path: target })).isError, true);
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "sticky-mismatch") {
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, cwd: root }));
        await until(async () => ["unknown", "mismatch"].includes((await state()).tasks[0].launch.worker.resources.children[0].state.kind), "observed child mismatch");
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status));
        const refused = await child.call("read", { path: target });
        assert.equal(refused.isError, true, "BEHAVIOR a confirmed native mismatch cannot be erased by later valid-looking status");
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "mismatch");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      let secondChild = null;
      if (census?.childCase === "multiple-settlement") {
        const second = await worker.call("legion_centurio", { purpose: "review", role: "interrogate reviewers", task: "Review the Ready label independently." });
        assert.equal(second.details.kind, "prepared");
        const directory = join(root, "second-native"), locator = join(root, "second-child.jsonl"), session = randomUUID(), run = randomUUID(), runnerId = randomUUID();
        fs.mkdirSync(directory);
        fs.writeFileSync(locator, JSON.stringify({ type: "session", id: session, cwd: worker.ctx.cwd }) + "\n");
        const nativeStatus = { ...status, runId: run, processTerminal: { version: 1, state: "pending", runId: run, runnerProcessInstanceId: runnerId }, steps: [{ ...status.steps[0], agent: second.details.launch.agent, sessionFile: locator }] };
        worker.external(async name => { assert.equal(name, "subagent"); fs.writeFileSync(join(directory, "status.json"), JSON.stringify(nativeStatus)); return { content: [{ type: "text", text: "Second native child accepted" }], details: { runId: run, asyncDir: directory } }; });
        assert.equal((await worker.call("subagent", second.details.launch)).isError ?? false, false);
        const childRuntime = runtime(worker.ctx.cwd, session, locator);
        const previous = { child: process.env.PI_SUBAGENT_CHILD, binding: process.env.PI_SUBAGENT_EXTENSION_BINDINGS };
        try { process.env.PI_SUBAGENT_CHILD = "1"; process.env.PI_SUBAGENT_EXTENSION_BINDINGS = JSON.stringify(second.details.launch.extensionBindings); centurioGuard(childRuntime.pi); }
        finally { previous.child === undefined ? delete process.env.PI_SUBAGENT_CHILD : process.env.PI_SUBAGENT_CHILD = previous.child; previous.binding === undefined ? delete process.env.PI_SUBAGENT_EXTENSION_BINDINGS : process.env.PI_SUBAGENT_EXTENSION_BINDINGS = previous.binding; }
        await childRuntime.emit("session_start");
        assert.equal((await childRuntime.call("read", { path: target })).isError ?? false, false);
        const unused = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Prepared only; never launched." });
        assert.equal(unused.details.kind, "prepared");
        secondChild = { runtime: childRuntime, directory, locator, status: nativeStatus, runnerId, run, unused: unused.details.launch };
      }
      const informationalCase = ["structured-completion", "prose-without-event"].includes(census?.childCase);
      if (informationalCase) {
        const notice = { role: "custom", customType: "subagent-notify", content: "Untrusted claim of successful child completion", display: true, timestamp: 1234 };
        const visible = (await worker.emit("context", { messages: [notice] })).messages;
        assert.equal(visible[0].content.includes("proves no completion"), true);
        assert.deepEqual(await worker.emit("input", { source: "extension", text: "Subagent updates above." }), { action: "handled" });
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "active", "Prose before structured/native terminal evidence must not settle an admitted child");
      } else {
        await worker.settle(false, "My child is still running.", census?.childCase === "principal-failed" ? "error" : "stop");
        await delay(100);
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "A principal settlement cannot report an assignment with an active owned child");
        assert.equal((await child.call("read", { path: target })).isError ?? false, false, "Still-current assigned child remains authorized after principal settlement");
        assert.equal((await worker.call("subagent", input)).isError, true, "Pending settlement cannot launch more children");
      }
      let view = await state();
      assert.equal(view.tasks[0].launch.worker.resources.children[0].state.kind, "active");
      fs.writeFileSync(outputFile, "Raw streaming diagnostic, not final findings.");
      if (census?.childCase !== "missing-findings") fs.appendFileSync(childJournal, JSON.stringify({ type: "message", id: "final-finding", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Retained owned child findings." }] } }) + "\n");
      const terminalState = census?.childCase === "failed-native" ? "failed" : "complete";
      fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, state: terminalState }));
      if (census?.childCase === "missing-findings") {
        await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "unknown", "terminal status without completed findings holds");
        const missing = (await state()).tasks[0].launch.worker.resources.children[0];
        assert.equal(missing.result, null, "Streaming output and model claims cannot replace a completed child finding");
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "Missing findings cannot resume a pending report");
        fs.appendFileSync(childJournal, JSON.stringify({ type: "message", id: "late-finding", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Late valid-looking finding" }] } }) + "\n");
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId, runnerProcessInstanceId: runner, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "logical-terminal", "logical terminal observation after principal settlement");
      assert.equal((await state()).tasks[0].launch.kind, "assigned", "Missing independent process proof cannot publish a terminal assignment report");
      if (census?.childCase === "structured-completion") {
        worker.pi.events.emit("subagent:async-complete", { id: runId, runId, sessionId: status.sessionId, completionOwnerId, asyncDir, cwd: status.cwd, mode: "single", agent: input.agent, sessionFile: childJournal, results: [{ agent: input.agent, sessionFile: childJournal, model: input.model, requestedModel: input.model, context: "fresh" }] });
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "logical-terminal", "Structured completion alone does not prove process exit");
      }
      if (census?.childCase === "terminal-lost-owner") await controller.command("off");
      if (census?.childCase === "wrong-runner") {
        const foreignRunner = randomUUID();
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId, runnerProcessInstanceId: foreignRunner, instances: [{ kind: "runner", processInstanceId: foreignRunner, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "mismatch", "BEHAVIOR internally consistent foreign runner proof cannot settle this exact owned process");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "unknown-proof") {
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ ...status.processTerminal, state: "unknown", reason: "writer-close-unverified" }));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown", "BEHAVIOR genuinely unknown process effects remain held");
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId, runnerProcessInstanceId: runner, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown", "Later valid-looking close proof must not clear a genuine unknown hold");
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "Unknown proof must not resume a pending report");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census?.childCase === "pending-proof") {
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify(status.processTerminal));
        await delay(100);
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "logical-terminal", "BEHAVIOR native pending process proof is transient, not a sticky unknown hold");
      }
      if (census?.childCase === "manual-settlement") {
        assert.deepEqual(await worker.emit("input", { source: "interactive", text: "Take manual control" }), { action: "handled" });
        assert.equal((await child.call("read", { path: target })).isError, true, "Manual intervention refuses later child effects");
      }
      const processProof = { version: 1, state: "observed", runId, runnerProcessInstanceId: runner, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: Date.now(), exitCode: census?.childCase === "failed-runner" ? 1 : 0, signal: null }], ...(census?.childCase === "proof-metadata" ? { observedAt: Date.now(), resumeDisposition: "resumable" } : {}) };
      if (census?.childCase === "manual-during-final-owner") {
        const originalLink = fs.linkSync;
        let intervened = false;
        fs.linkSync = (source, destination) => {
          originalLink(source, destination);
          if (intervened || !String(destination).endsWith(".effect-response.json")) return;
          const requestPath = String(destination).replace(".effect-response.json", ".effect-request.json");
          const request = JSON.parse(fs.readFileSync(requestPath));
          if (request.message.kind !== "centurio-owner-check" || request.message.stage !== "launch") return;
          intervened = true;
          void worker.emit("input", { source: "interactive", text: "Manual takeover during final owner response" });
        };
        syncBuiltinESMExports();
        try {
          fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify(processProof));
          await until(() => intervened, "manual takeover at the final current-owner response boundary");
          await delay(150);
          const held = (await state()).tasks[0].launch;
          assert.equal(held.kind, "assigned", "Finalization rechecks authority after the awaited owner response");
          assert.equal(held.worker.resources.children[0].state.kind, "process-terminal", "Independent terminal evidence remains retained even though reporting authority is lost");
          assert.equal((await child.call("read", { path: target })).isError, true);
        } finally { fs.linkSync = originalLink; syncBuiltinESMExports(); }
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify(processProof));
      if (["terminal-lost-owner", "manual-settlement"].includes(census?.childCase)) {
        await delay(300);
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "Lost/manual authority cannot resume a pending terminal report");
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].state.kind, "unknown", "BEHAVIOR process close cannot authorize terminal acceptance after current owner is lost");
        assert.equal((await child.call("read", { path: target })).isError, true, "Safety/manual revocation while settlement pending refuses further child effects");
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "process-terminal", "independent observed process terminal");
      if (secondChild) {
        assert.equal((await state()).tasks[0].launch.kind, "assigned", "One terminal child cannot finalize an assignment with another active child");
        fs.appendFileSync(secondChild.locator, JSON.stringify({ type: "message", id: "second-final", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Independent second child review findings." }] } }) + "\n");
        fs.writeFileSync(join(secondChild.directory, "status.json"), JSON.stringify({ ...secondChild.status, state: "complete" }));
        await until(async () => (await state()).tasks[0].launch.worker.resources.children[1].state.kind === "logical-terminal", "second child awaits independent close");
        assert.equal((await state()).tasks[0].launch.kind, "assigned");
        fs.writeFileSync(join(secondChild.directory, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId: secondChild.run, runnerProcessInstanceId: secondChild.runnerId, instances: [{ kind: "runner", processInstanceId: secondChild.runnerId, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
      }
      if (informationalCase) {
        await worker.settle(false, "Owned child is now independently proven terminal.");
        await until(async () => (await state()).tasks[0].launch.kind === "reported", "proven terminal principal report");
        assert.equal((await state()).tasks[0].launch.report.outcome, "reported-result", "BEHAVIOR owned structured completion or exact native observation does not create a blanket sticky host hold");
      }
      await until(async () => (await state()).tasks[0].launch.kind === "reported", "exact child terminal evidence resumes captured principal settlement");
      view = await state();
      assert.equal(view.tasks[0].launch.report.outcome, ["failed-native", "failed-runner", "principal-failed"].includes(census?.childCase) ? "failed" : "reported-result");
      const retained = view.tasks[0].launch.worker.resources.children[0];
      if (census?.childCase === "proof-metadata") assert.deepEqual(JSON.parse(fs.readFileSync(retained.state.proof)), processProof, "BEHAVIOR native observed close metadata is retained without stripping independent proof fields");
      if (secondChild) {
        assert.match(view.tasks[0].launch.report.assistantText, /Independent second child review findings/);
        const children = view.tasks[0].launch.worker.resources.children;
        assert.equal(children[2].state.kind, "prepared", "Unlaunched intent need not have process-close evidence");
        assert.equal((await worker.call("subagent", secondChild.unused)).isError, true, "Prepared-only intent cannot launch after assignment reporting");
        for (const owned of children.slice(0, 2)) {
          assert.ok(view.tasks[0].launch.report.evidence.includes(owned.state.proof));
          assert.ok(view.tasks[0].launch.report.evidence.includes(owned.result.evidence));
        }
        await secondChild.runtime.emit("session_shutdown");
      }
      assert.equal(retained.result.preview, "Retained owned child findings.", "BEHAVIOR retained findings are the completed assistant reply rather than streaming diagnostics");
      fs.unlinkSync(outputFile);
      assert.equal(Buffer.from(JSON.parse(fs.readFileSync(retained.result.evidence)).bytes, "base64").toString(), "Retained owned child findings.");
      assert.equal(fs.readFileSync(target, "utf8"), "Owned child read succeeded.");
      await child.emit("session_shutdown");
      return { root, view };
    }
    if (kind === "child-native" || kind === "child-concurrent") {
      const prepared = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Read the Ready label implementation and report findings." });
      assert.equal(prepared.details?.kind, "prepared");
      const input = prepared.details.launch;
      const target = join(worker.ctx.cwd, "observed-read.txt");
      fs.writeFileSync(target, "Read-only findings survive parent settlement.");
      const runId = randomUUID(), asyncDir = join(root, "native-run");
      fs.mkdirSync(asyncDir);
      worker.external(async (name, actual) => {
        assert.equal(name, "subagent");
        assert.deepEqual(actual, input);
        fs.appendFileSync(join(root, "native-launches.txt"), "native launch\n");
        return { content: [{ type: "text", text: "Native runtime accepted one child." }], details: { runId, asyncDir }, isError: false };
      });
      if (kind === "child-concurrent") {
        await Promise.all([worker.call("subagent", input), worker.call("subagent", input)]);
        assert.equal(fs.readFileSync(join(root, "native-launches.txt"), "utf8"), "native launch\n", "BEHAVIOR concurrent root calls cannot launch the same owned child twice");
        return { root, view: await state() };
      }
      const changed = await worker.call("subagent", { ...input, task: "An unbound task" });
      assert.equal(changed.isError, true);
      const launched = await worker.call("subagent", input);
      assert.equal(launched.isError ?? false, false, "BEHAVIOR the exact owned root launch reaches the ordinary native permission pipeline");
      const replay = await worker.call("subagent", input);
      assert.equal(replay.isError, true);
      const next = await worker.call("legion_centurio", { purpose: "review", role: "interrogate reviewers", task: "Review only." });
      assert.equal(next.isError, true, "Unknown native launch state holds new child preparation");
      await worker.settle(false, "The principal settled while the native child outcome is unknown.");
      await delay(100);
      const view = await state();
      assert.equal(view.tasks[0].launch.kind, "assigned", "Unresolved native launch stays pending rather than terminally reported");
      assert.equal(view.tasks[0].launch.worker.resources.children[0].state.kind, "corroboration-pending", "Missing native status remains observable as pending corroboration");
      return { root, view };
    }
    if (kind === "child-intent") {
      const prepared = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Read the Ready label implementation and report findings.", timeoutMs: 5400000 });
      assert.equal(prepared.details?.kind, "prepared", "BEHAVIOR the assigned Tribunus prepares a durable native child intent without launching");
      assert.equal(prepared.details.launch.model, "controlled/selected");
      assert.equal(prepared.details.launch.cwd, worker.ctx.cwd);
      assert.equal(prepared.details.launch.context, "fresh");
      assert.equal(prepared.details.launch.async, true);
      assert.equal(prepared.details.launch.worktree, false);
      assert.equal(prepared.details.launch.timeoutMs, 5400000);
      const blocked = await worker.call("legion_centurio", { purpose: "implementation", role: "feature, refactoring", task: "Change the label." });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0].text, /current applied seam\/exception approval|retained writable workspace/);
      await worker.settle(false, "Prepared an exploration intent. No child has launched.");
      await until(async () => (await state()).tasks[0].launch.kind === "reported", "prepared child report");
      const view = await state();
      const reference = view.tasks[0].launch.report.evidence.find(path => path.endsWith(".centurio-intent.json"));
      assert.equal(typeof reference, "string");
      const retained = JSON.parse(fs.readFileSync(reference));
      assert.equal(retained.intent.assignment.command, view.tasks[0].launch.command);
      assert.equal(retained.intent.owner.session, worker.ctx.sessionManager.getSessionId());
      assert.equal(retained.intent.role.model, "controlled/selected");
      return { root, view };
    }
    if (kind === "child-preparation") {
      worker.pi.events.emit(census?.childCase === "malformed-start" ? "subagent:async-started" : "subagent:async-complete", census?.childCase === "malformed-start" ? { id: 42 } : { id: "foreign-run", runId: "foreign-run", sessionId: worker.ctx.sessionManager.getSessionId(), completionOwnerId: "foreign-owner", asyncDir: root, cwd: worker.ctx.cwd, mode: "single", agent: "foreign-agent" });
      await worker.emit("input", { source: "extension", text: "Subagent updates above." });
      await worker.settle(false, "All children are finished, according to the model.");
      await until(async () => (await state()).tasks[0].launch.kind === "reported", "preparation child report");
      const view = await state();
      assert.equal(view.tasks[0].launch.report.outcome, "blocked", "A preparation result must remain blocked when native child ownership is unknown");
      const retained = view.tasks[0].launch.report.evidence.find(path => path.endsWith(".child-unresolved.json"));
      assert.equal(typeof retained, "string");
      assert.equal(JSON.parse(fs.readFileSync(retained)).kind, "unknown");
      return { root, view };
    }
    if (kind === "admission") {
      await controller.settle(); await drain();
      const target = join(worker.ctx.cwd, "ready.txt");
      assert.equal((await worker.call("write", { path: target, content: "Ready" })).isError, true);
      const matt = dirname(worker.pi.getCommands().find(command => command.name === "skill:matt-tdd").sourceInfo.path);
      for (const file of ["SKILL.md", "tests.md", "mocking.md"]) await worker.call("read", { path: join(matt, file) });
      const proposed = await worker.call("legion_engineering", { kind: "seam", seam: "public Ready file", behaviors: ["Ready renders Ready"], verification: "Read the resulting Ready file" });
      assert.equal(proposed.details.kind, "waiting");
      await until(async () => (await state()).snapshot.engineering.length === 1, "proposal ingestion");
      await worker.settle(); await drain();
      await until(() => controller.prompts.length > 0, "decision prompt");
      assert.equal(await controller.start(controller.prompts.shift()), true);
      const decided = await controller.call("legion_engineering_decide", { kind: census.effectCase === "decline" ? "decline" : "approve", rationale: "The public Ready file is an in-scope meaningful behavior." });
      assert.equal(decided.details.kind, "applied");
      await controller.settle(); await drain();
      assert.equal(await controller.start(controller.prompts.shift()), true);
      const request = (await state()).snapshot.engineering[0];
      assert.equal((await controller.call("legion_engineering_deliver", { requestId: request.id })).details.kind, "applied");
      await controller.settle(); await drain();
      await until(() => worker.prompts.some(prompt => prompt.startsWith("Legion engineering continuation")), "worker continuation");
      if (census.effectCase.startsWith("writable-")) {
        if (["writable-exception", "writable-delayed-exception"].includes(census.effectCase)) {
          assert.equal((await worker.call("legion_engineering", { kind: "exception", seam: { id: request.id, digest: request.digest }, behavior: "Ready renders Ready", omittedTest: "Terminal screenshot", rationale: "No terminal screenshot surface is available in this bounded child", alternative: { description: "Verify the actual Ready bytes", input: { command: "test \"$(cat ready.txt)\" = Ready && printf 'Ready verified'" } } })).details.kind, "waiting");
          await until(async () => (await state()).snapshot.engineering.length === 2, "writable exception request");
          await worker.settle(); await drain();
          await until(() => controller.prompts.length > 0, "writable exception decision prompt");
          assert.equal(await controller.start(controller.prompts.shift()), true);
          assert.equal((await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The same behavior has meaningful byte verification for the documented omitted screenshot" })).details.kind, "applied");
          await controller.settle(); await drain();
          assert.equal(await controller.start(controller.prompts.shift()), true);
          assert.equal((await controller.call("legion_engineering_deliver", { requestId: (await state()).snapshot.engineering[1].id })).details.kind, "applied");
          await controller.settle(); await drain();
          await until(() => worker.prompts.some(prompt => prompt.startsWith("Legion engineering continuation")), "writable exception continuation");
        }
        // Newly authored disposable fixture resources are explicit committed task input.
        await execute("git", ["-C", worker.ctx.cwd, "add", ".agents"]);
        await execute("git", ["-C", worker.ctx.cwd, "-c", "user.name=Legion fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Disposable child contract baseline"]);
        const baseRef = (await execute("git", ["-C", worker.ctx.cwd, "symbolic-ref", "HEAD"])).stdout.trim();
        const baseCommit = (await execute("git", ["-C", worker.ctx.cwd, "rev-parse", "HEAD"])).stdout.trim();
        const writableRequest = { purpose: "implementation", role: "feature, refactoring", task: "Change only ready.txt and return evidence.", baseRef, baseCommit };
        const beforeTrees = (await execute("git", ["-C", worker.ctx.cwd, "worktree", "list", "--porcelain"])).stdout;
        if (census.effectCase === "writable-dirty-base") fs.writeFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "Uncommitted assignment input must not disappear.");
        if (census.effectCase === "writable-stale-base") writableRequest.baseCommit = "0".repeat(40);
        if (census.effectCase === "writable-foreign-base") { writableRequest.baseRef = "refs/heads/main"; writableRequest.baseCommit = (await execute("git", ["-C", worker.ctx.cwd, "rev-parse", "refs/heads/main"])).stdout.trim(); }
        if (census.effectCase === "writable-invalid-role") writableRequest.role = "how explorer";
        if (census.effectCase === "writable-stale-origin") worker.pi.on("tool_call", event => {
          if (event.toolName !== "legion_centurio") return;
          const result = { id: randomUUID(), type: "message", message: { role: "toolResult", toolCallId: event.toolCallId, toolName: "legion_centurio", content: [{ type: "text", text: "Already settled root origin" }], isError: false } };
          worker.ctx.sessionManager.getBranch().push(result);
          fs.appendFileSync(worker.ctx.sessionManager.getSessionFile(), JSON.stringify(result) + "\n");
        });
        if (census.effectCase === "writable-forged-origin") worker.onBranch(() => { worker.ctx.sessionManager.getBranch().at(-1).message.content[0].arguments.task = "Forged preparation input"; });
        if (["writable-git-deny", "writable-git-input", "writable-git-unknown"].includes(census.effectCase)) worker.pi.on("tool_call", event => {
          if (event.toolName !== "bash" || !event.input.command.includes("'update-ref'")) return;
          if (census.effectCase === "writable-git-deny") return { block: true, reason: "Independent ordinary Git permission denial" };
          if (census.effectCase === "writable-git-input") event.input.command = "printf 'Changed unadmitted Git input'";
        });
        if (census.effectCase === "writable-git-unknown") worker.pi.on("tool_result", event => event.toolName === "bash" && event.input.command.includes("'update-ref'") ? { structuredContent: undefined, content: [{ type: "text", text: "Unresolved Git completion" }] } : undefined);
        const prepared = await worker.call("legion_centurio", writableRequest);
        if (["writable-dirty-base", "writable-stale-base", "writable-foreign-base", "writable-invalid-role", "writable-forged-origin", "writable-stale-origin", "writable-git-deny", "writable-git-input", "writable-git-unknown"].includes(census.effectCase)) {
          assert.equal(prepared.isError, true, `BEHAVIOR ${census.effectCase} refuses workspace preparation`);
          assert.equal((await execute("git", ["-C", worker.ctx.cwd, "worktree", "list", "--porcelain"])).stdout, beforeTrees, "Refused or branch-only unresolved preparation creates no child worktree");
          assert.equal((await execute("git", ["-C", worker.ctx.cwd, "symbolic-ref", "HEAD"])).stdout.trim(), baseRef);
          if (census.effectCase === "writable-dirty-base") assert.equal(fs.readFileSync(join(worker.ctx.cwd, "dirty-parent.txt"), "utf8"), "Uncommitted assignment input must not disappear.");
          if (census.effectCase === "writable-git-unknown") {
            const afterRefs = (await execute("git", ["-C", worker.ctx.cwd, "for-each-ref", "refs/heads/legion/centurio-*"])).stdout;
            assert.match(afterRefs, /refs\/heads\/legion\/centurio-/, "Unknown applied allocation retains its branch");
            assert.equal((await worker.call("legion_centurio", writableRequest)).isError, true);
            assert.equal((await execute("git", ["-C", worker.ctx.cwd, "for-each-ref", "refs/heads/legion/centurio-*"])).stdout, afterRefs, "Uncertain preparation never duplicates its allocation");
          }
          return { root, view: await state() };
        }
        assert.equal(prepared.details?.kind, "prepared", `BEHAVIOR approved implementation prepares a retained isolated native child: ${JSON.stringify(prepared)}`);
        const input = prepared.details.launch;
        assert.notEqual(input.cwd, worker.ctx.cwd);
        assert.equal(input.worktree, false, "Native runtime consumes the exact preallocated workspace without a second allocator");
        assert.equal(input.model, "controlled/selected");
        assert.match(input.task, /Recorded engineering authority/, "The actual native child task carries its approved seam, not only principal prose");
        assert.ok(input.task.includes(JSON.stringify(request.proposal)), "The exact current approved proposal is supplied to the child");
        const branch = (await execute("git", ["-C", input.cwd, "symbolic-ref", "HEAD"])).stdout.trim();
        assert.notEqual(branch, baseRef);
        assert.equal((await execute("git", ["-C", input.cwd, "rev-parse", "HEAD"])).stdout.trim(), baseCommit);
        assert.equal((await execute("git", ["-C", worker.ctx.cwd, "symbolic-ref", "HEAD"])).stdout.trim(), baseRef);
        assert.equal(fs.existsSync(target), false, "Workspace preparation preserves the parent task files");
        if (census.effectCase === "writable-prepare") return { root, view: await state() };
        const runId = randomUUID(), runner = randomUUID(), childSession = randomUUID(), asyncDir = join(root, "writable-native"), childJournal = join(root, "writable-child.jsonl");
        fs.mkdirSync(asyncDir);
        fs.writeFileSync(childJournal, JSON.stringify({ type: "session", id: childSession, cwd: input.cwd }) + "\n");
        const status = { runId, sessionId: worker.ctx.sessionManager.getSessionFile(), mode: "single", state: "running", cwd: input.cwd, currentStep: 0, launchContractDigest: "native-writable-contract", launchResolvedExtensions: { disableAmbientExtensions: false, required: ["pi-legion-centurio"] }, processTerminal: { version: 1, state: "pending", runId, runnerProcessInstanceId: runner }, steps: [{ agent: input.agent, sessionFile: childJournal, model: input.model, requestedModel: input.model, context: "fresh", launchContractDigest: "native-writable-contract" }] };
        worker.external(async name => { assert.equal(name, "subagent"); fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status)); return { content: [{ type: "text", text: "Native child accepted" }], details: { runId, asyncDir } }; });
        assert.equal((await worker.call("subagent", input)).isError ?? false, false, "The native executor consumes the owned workspace");
        const child = runtime(input.cwd, childSession, childJournal);
        const registered = listRuntimeAgentConfigs(worker.pi);
        const writableAgent = registered.find(agent => agent.name === input.agent);
        assert.equal(writableAgent?.inheritSkills, true, "Actual native registration must enable writable skill inheritance");
        assert.equal(registered.find(agent => agent.name === input.agent.replace(/-implementation$/, ""))?.inheritSkills, false, "Read-only native registration remains unchanged");
        // Match installed child-session's noSkills/skillsOverride boundary with real Pi discovery.
        const noSkills = !writableAgent.inheritSkills;
        const loader = new DefaultResourceLoader({ cwd: input.cwd, agentDir: profile, settingsManager: SettingsManager.inMemory(), noExtensions: true, noSkills, skillsOverride: noSkills ? base => ({ ...base, skills: [] }) : undefined, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalSkillPaths: [dirname(skill), ...["tdd", "teach"].map(name => join(pstack, "skills", name))] });
        await loader.reload();
        const selected = loader.getSkills().skills;
        assert.ok(selected.some(resource => resource.name === "matt-tdd" && resource.filePath.startsWith(input.cwd)), "Native selected Matt resource belongs to the child workspace");
        assert.ok(selected.some(resource => resource.name === "matt-teach"));
        assert.ok(selected.some(resource => resource.name === "poteto-mode"));
        child.resources([...commands.filter(command => command.source !== "skill"), ...selected.map(resource => ({ name: `skill:${resource.name}`, source: "skill", sourceInfo: resource.sourceInfo }))]);
        const previous = { child: process.env.PI_SUBAGENT_CHILD, bindings: process.env.PI_SUBAGENT_EXTENSION_BINDINGS };
        try { process.env.PI_SUBAGENT_CHILD = "1"; process.env.PI_SUBAGENT_EXTENSION_BINDINGS = JSON.stringify(input.extensionBindings); centurioGuard(child.pi); }
        finally { previous.child === undefined ? delete process.env.PI_SUBAGENT_CHILD : process.env.PI_SUBAGENT_CHILD = previous.child; previous.bindings === undefined ? delete process.env.PI_SUBAGENT_EXTENSION_BINDINGS : process.env.PI_SUBAGENT_EXTENSION_BINDINGS = previous.bindings; }
        await child.emit("session_start");
        const notLoaded = await child.call("write", { path: "not-loaded.txt", content: "No native loading yet" });
        assert.equal(notLoaded.isError, true, "Current child resource loading cannot be borrowed from the principal");
        assert.equal(fs.existsSync(join(input.cwd, "not-loaded.txt")), false);
        if (census.effectCase === "writable-read-override") {
          const tools = child.pi.getAllTools();
          child.pi.getAllTools = () => tools.map(tool => tool.name === "read" ? { ...tool, sourceInfo: { path: "unrelated-read-override" } } : tool);
          const path = child.pi.getCommands().find(command => command.name === "skill:matt-tdd").sourceInfo.path;
          assert.equal((await child.call("read", { path })).isError, true);
          child.pi.getAllTools = () => tools;
          assert.equal((await child.call("write", { path: "ready.txt", content: "No override proof" })).isError, true, "Unrelated read override cannot satisfy selected resource loading");
          assert.equal(fs.existsSync(join(input.cwd, "ready.txt")), false);
          await child.emit("session_shutdown");
          return { root, view: await state() };
        }
        for (const name of ["matt-tdd", "poteto-mode"]) {
          const path = child.pi.getCommands().find(command => command.name === `skill:${name}`).sourceInfo.path;
          assert.equal((await child.call("read", { path })).isError ?? false, false);
          if (name === "matt-tdd") for (const file of ["tests.md", "mocking.md"]) await child.call("read", { path: join(dirname(path), file) });
        }
        if (census.effectCase === "writable-escape") {
          assert.equal((await child.call("write", { path: target, content: "Overwrite parent" })).isError, true);
          fs.symlinkSync(target, join(input.cwd, "escape.txt"));
          assert.equal((await child.call("write", { path: "escape.txt", content: "Overwrite through symlink" })).isError, true);
          assert.equal(fs.existsSync(target), false, "Neither absolute nor symlink file escape mutates parent work");
          await child.emit("session_shutdown");
          return { root, view: await state() };
        }
        if (["writable-deny", "writable-late-input", "writable-late-model", "writable-late-owner", "writable-late-resource", "writable-late-settings", "writable-late-path"].includes(census.effectCase)) {
          child.pi.on("tool_call", async event => {
            if (event.toolName !== "write") return;
            if (census.effectCase === "writable-deny") return { block: true, reason: "Independent ordinary native child permission denial" };
            if (census.effectCase === "writable-late-input") event.input.content = "Changed unadmitted input";
            if (census.effectCase === "writable-late-model") child.ctx.model = { provider: "controlled", id: "incompatible", input: ["text"] };
            if (census.effectCase === "writable-late-owner") await controller.command("off");
            if (census.effectCase === "writable-late-resource") fs.appendFileSync(child.pi.getCommands().find(command => command.name === "skill:matt-tdd").sourceInfo.path, "\nChanged after admission\n");
            if (census.effectCase === "writable-late-path") fs.symlinkSync(target, join(input.cwd, "ready.txt"));
            if (census.effectCase === "writable-late-settings") child.pi.getSettings = () => ({ shellCommandPrefix: "echo incompatible" });
          });
          assert.equal((await child.call("write", { path: "ready.txt", content: "Not admitted after late change" })).isError, true, `BEHAVIOR ${census.effectCase} refuses the final native effect`);
          assert.equal(fs.existsSync(join(input.cwd, "ready.txt")), false);
          assert.equal(fs.existsSync(target), false);
          await child.emit("session_shutdown");
          return { root, view: await state() };
        }
        const delayedSettlement = census.effectCase.startsWith("writable-delayed-");
        if (delayedSettlement) {
          await worker.settle(false, "Launched child; no implementation result yet.");
          await delay(150);
          const pending = (await state()).tasks[0].launch;
          assert.equal(pending.kind, "assigned", "Principal async-launch settlement cannot publish a terminal report while its child is active");
          assert.equal(pending.worker.resources.children[0].state.kind, "active");
          const statusPrompts = worker.prompts.length;
          assert.deepEqual(await worker.emit("input", { source: "extension", text: "Subagent updates above." }), { action: "handled" });
          await drain();
          assert.equal(worker.prompts.length, statusPrompts, "Pending settlement cannot trigger a model continuation from prose");
        }
        if (["writable-delayed-manual", "writable-delayed-revoked"].includes(census.effectCase)) {
          const beforeEffects = (await state()).snapshot.effects.length;
          if (census.effectCase === "writable-delayed-manual") await worker.emit("input", { source: "interactive", text: "Take manual control while the child is active" });
          else await controller.command("off");
          assert.equal((await child.call("write", { path: "ready.txt", content: "Forbidden after authority loss" })).isError, true);
          assert.equal(fs.existsSync(join(input.cwd, "ready.txt")), false, "Authority loss cannot admit a writable child mutation");
          assert.equal((await state()).snapshot.effects.length, beforeEffects, "No effect admitted after manual/revoked authority");
          assert.equal((await state()).tasks[0].launch.kind, "assigned", "Safety control does not publish an invented terminal report");
          await child.emit("session_shutdown");
          return { root, view: await state() };
        }
        const written = await child.call("write", { path: "ready.txt", content: "Red" });
        assert.equal(written.isError ?? false, false, `BEHAVIOR loaded approved native child writes in its isolated workspace: ${JSON.stringify(written)}`);
        async function runReadyTest() {
          // Native shell inherits node:test's runner marker in this controlled adapter.
          // Remove only that marker so the child command runs an independent real test.
          const marker = process.env.NODE_TEST_CONTEXT;
          delete process.env.NODE_TEST_CONTEXT;
          try { return await child.call("bash", { command: "node --test status.test.mjs" }); }
          finally { if (marker !== undefined) process.env.NODE_TEST_CONTEXT = marker; }
        }
        if (census.effectCase === "writable-red-green") {
          assert.equal((await child.call("write", { path: "status.test.mjs", content: 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\ntest("Ready label", () => assert.equal(readFileSync("ready.txt", "utf8"), "Ready"));\n' })).isError ?? false, false);
          const red = await runReadyTest();
          assert.equal(red.structuredContent?.exit_code, 1, "Real public behavior fails before the label is changed");
          assert.match(red.structuredContent.output, /ERR_ASSERTION|AssertionError/);
        }
        const editInput = census.effectCase === "writable-edit-string" ? { path: "ready.txt", edits: '{"oldText":"Red","newText":"Ready"}' }
          : ["writable-edit-object", "writable-edit-changed-input", "writable-red-green"].includes(census.effectCase) ? { path: "ready.txt", edits: { oldText: "Red", newText: "Ready" } }
          : { path: "ready.txt", oldText: "Red", newText: "Ready" };
        if (census.effectCase === "writable-edit-changed-input") {
          child.onBranch(() => {
            const entries = child.ctx.sessionManager.getBranch();
            entries.at(-1).message.content[0].arguments.edits[0].newText = "Unadmitted";
          });
          assert.equal((await child.call("edit", editInput)).isError, true, "Native normalization cannot excuse a changed in-memory assistant call");
          assert.equal(fs.readFileSync(join(input.cwd, "ready.txt"), "utf8"), "Red");
          assert.equal((await state()).snapshot.effects.filter(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "edit").length, 0);
          const original = fs.readFileSync(childJournal, "utf8").trimEnd().split("\n").map(line => JSON.parse(line)).find(entry => entry.message?.role === "assistant" && entry.message.content[0]?.name === "edit");
          assert.deepEqual(original.message.content[0].arguments, editInput, "Refusal preserves original persisted evidence");
          await child.emit("session_shutdown");
          return { root, view: await state() };
        }
        assert.equal((await child.call("edit", editInput)).isError ?? false, false, "BEHAVIOR supported native edit normalization must preserve child provenance");
        const verified = census.effectCase === "writable-red-green" ? await runReadyTest() : await child.call("bash", { command: "test \"$(cat ready.txt)\" = Ready && printf 'Ready verified'" });
        assert.equal(verified.structuredContent?.exit_code, 0);
        if (census.effectCase === "writable-red-green") assert.match(verified.structuredContent.output, /# pass 1/);
        else assert.equal(verified.structuredContent?.output, "Ready verified");
        assert.equal(fs.readFileSync(join(input.cwd, "ready.txt"), "utf8"), "Ready");
        if (census.effectCase === "writable-red-green") {
          child.pi.on("tool_call", event => event.toolName === "write" && event.input.path === "denied.txt" ? { block: true, reason: "Ordinary fixture permission denied this write" } : undefined);
          assert.equal((await child.call("write", { path: "denied.txt", content: "Forbidden" })).isError, true);
          assert.equal(fs.existsSync(join(input.cwd, "denied.txt")), false, "Denied ordinary effect cannot mutate the retained child workspace");
        }
        assert.equal(fs.existsSync(target), false, "Child edits preserve parent task work");
        await until(async () => (await state()).snapshot.effects.filter(effect => effect.intent.origin?.kind === "centurio" && effect.state.kind === "completed").length === (census.effectCase === "writable-red-green" ? 5 : 3), "retained writable effect results");
        const editEffect = (await state()).snapshot.effects.find(effect => effect.intent.origin?.kind === "centurio" && effect.intent.call.name === "edit");
        assert.deepEqual(editEffect.intent.call.rawInput, editInput, "Retained raw evidence is the original persisted call, not mutated native preparation");
        assert.deepEqual(editEffect.intent.call.input, { path: "ready.txt", edits: [{ oldText: "Red", newText: "Ready" }] });
        const originalEntry = fs.readFileSync(childJournal, "utf8").trimEnd().split("\n").map(line => JSON.parse(line)).find(entry => `${childJournal}#${entry.id}` === editEffect.intent.call.journal);
        assert.deepEqual(originalEntry.message.content[0].arguments, editInput, "Parent admission joins the untouched original journal arguments");
        fs.appendFileSync(childJournal, JSON.stringify({ type: "message", id: "writable-final", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Ready verified in the retained isolated child workspace." }] } }) + "\n");
        fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, state: "complete" }));
        if (delayedSettlement) {
          await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "logical-terminal", "delayed child awaits independent close proof");
          assert.equal((await state()).tasks[0].launch.kind, "assigned", "Logical child completion alone cannot finalize the assignment");
        }
        fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId, runnerProcessInstanceId: runner, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
        await until(async () => (await state()).tasks[0].launch.worker.resources.children[0].state.kind === "process-terminal", "writable native lifecycle independently settles");
        if (delayedSettlement) {
          await until(async () => (await state()).tasks[0].launch.kind === "reported", "delayed settlement resumes without another model turn");
          const final = (await state()).tasks[0].launch;
          assert.equal(final.report.outcome, "reported-result");
          if (census.effectCase === "writable-delayed-exception") {
            assert.equal(final.report.engineering.alternative.kind, "verified", "Report recomputes exception verification from the later owned child effect");
            const alternative = (await state()).snapshot.effects.find(effect => effect.intent.id === final.report.engineering.alternative.effect.id);
            assert.equal(alternative.intent.origin.kind, "centurio");
            assert.ok(final.report.evidence.includes(alternative.state.evidence));
          }
          assert.match(final.report.assistantText, /Ready verified in the retained isolated child workspace/);
          assert.equal(final.report.assistantText.includes("Launched child;"), false, "The old principal launch summary is not a child completion report");
          assert.ok(final.report.evidence.includes(final.worker.resources.children[0].result.evidence));
          assert.ok(final.report.evidence.includes(final.worker.resources.children[0].state.proof));
          for (const effect of (await state()).snapshot.effects) assert.ok(final.report.evidence.includes(effect.state.evidence), "Report retains actual effect outcomes");
          assert.equal((await child.call("write", { path: "after-report.txt", content: "Forbidden" })).isError, true);
          assert.equal(fs.existsSync(join(input.cwd, "after-report.txt")), false);
          const bytes = fs.readFileSync(final.report.evidence.find(path => path.endsWith(".settlement-pending.json")));
          const reportPath = join(dirname(final.worker.resources.children[0].result.evidence), `${final.command}.report.json`);
          const reportBytes = fs.readFileSync(reportPath);
          await worker.emit("agent_settled");
          await worker.emit("agent_settled");
          fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, state: "complete" }));
          await delay(100);
          assert.deepEqual(fs.readFileSync(reportPath), reportBytes, "Duplicate settlements/observations do not republish the terminal report");
          assert.deepEqual(fs.readFileSync(final.report.evidence.find(path => path.endsWith(".settlement-pending.json"))), bytes);
        }
        assert.equal((await state()).tasks[0].launch.worker.resources.children[0].result.preview, "Ready verified in the retained isolated child workspace.");
        assert.equal((await execute("git", ["-C", input.cwd, "symbolic-ref", "HEAD"])).stdout.trim(), branch, "Terminal runtime retains the child branch/worktree");
        if (census.effectCase === "writable-exception") {
          await worker.settle(false, "Completed only the bounded child and exact approved exception alternative.");
          await until(async () => (await state()).tasks[0].launch.kind === "reported", "writable exception report");
          const report = (await state()).tasks[0].launch.report;
          assert.equal(report.engineering.alternative.kind, "verified");
          const alternative = (await state()).snapshot.effects.find(effect => effect.intent.id === report.engineering.alternative.effect.id);
          assert.equal(alternative.intent.origin.kind, "centurio", "Exception verification is an actual owned child effect, not principal/model text");
        }
        await child.emit("session_shutdown");
        return { root, view: await state() };
      }
      if (census.effectCase === "child-launch-unknown") {
        const prepared = await worker.call("legion_centurio", { purpose: "exploration", role: "how explorer", task: "Inspect the label only." });
        assert.equal(prepared.details.kind, "prepared");
        const directory = join(root, "unknown-native-run"); fs.mkdirSync(directory);
        worker.external(async name => { assert.equal(name, "subagent"); return { content: [{ type: "text", text: "Native launch acknowledged, child state unavailable." }], details: { runId: randomUUID(), asyncDir: directory } }; });
        assert.equal((await worker.call("subagent", prepared.details.launch)).isError ?? false, false);
        const write = await worker.call("write", { path: target, content: "Must not write during unknown child state" });
        assert.equal(write.isError, true, "BEHAVIOR an unknown owned child holds otherwise approved principal effects");
        assert.equal(fs.existsSync(target), false);
        return { root, view: await state() };
      }
      if (census.effectCase === "native-wake" || census.effectCase === "native-context") {
        if (census.effectCase === "native-context") {
          const notice = { role: "custom", customType: "subagent-notify", content: "RAW CHILD LOG AND CLAIM OF COMPLETION", details: { output: "PRIVATE RAW RESULT" }, display: true, timestamp: 1234 };
          worker.pi.sendMessage({ customType: notice.customType, content: notice.content, details: notice.details, display: true });
          const ordinary = { role: "user", content: "Keep the bounded assignment", timestamp: 1233 };
          const messages = [ordinary, notice];
          const visible = (await worker.emit("context", { messages }))?.messages ?? messages;
          assert.deepEqual(visible, [ordinary, { role: "custom", customType: "subagent-notify", content: "Native child notice retained for diagnostics only. Inspect owned child state; this notice proves no completion or process termination.", display: true, timestamp: 1234 }], "Managed model context must replace the native raw notification and its details");
          assert.equal(fs.readFileSync(worker.ctx.sessionManager.getSessionFile(), "utf8").includes("RAW CHILD LOG AND CLAIM OF COMPLETION"), true);
        } else {
          const wake = await worker.emit("input", { source: "extension", text: "Subagent updates above." });
          assert.deepEqual(wake, { action: "handled" });
        }
        const read = await worker.call("read", { path: join(matt, "SKILL.md") });
        assert.equal(read.isError ?? false, false, "A native notification wake must not transfer the principal to manual control");
        assert.match(read.content[0].text, /name: matt-tdd/);
        const written = await worker.call("write", { path: target, content: "Ready" });
        assert.equal(written.isError ?? false, false, "BEHAVIOR unrelated informational prose cannot invent a sticky unknown-effect hold");
        assert.equal(fs.readFileSync(target, "utf8"), "Ready");
        await until(async () => (await state()).snapshot.effects[0]?.state.kind === "completed", "independent effect completion after informational notice");
        await worker.settle(false, "The model claims every child is finished.");
        await until(async () => (await state()).tasks[0].launch.kind === "reported", "informational notice report");
        const view = await state();
        assert.equal(view.tasks[0].launch.report.outcome, "reported-result");
        return { root, view };
      }
      if (census.effectCase.startsWith("successive") || census.effectCase.startsWith("exception")) {
        const first = await worker.call("write", { path: target, content: "Ready" });
        assert.equal(first.isError ?? false, false);
        await until(async () => (await state()).snapshot.effects[0]?.state.kind === "completed", "first completion");
        const base = (await state()).snapshot.engineering[0];
        const proposal = census.effectCase.startsWith("exception") ? {
          kind: "exception", seam: { id: base.id, digest: base.digest }, behavior: "Ready renders Ready",
          omittedTest: "Automated terminal screenshot on this headless worker", rationale: "No terminal display is available for this bounded check.",
          alternative: { description: "Verify the actual Ready file bytes with the native shell", input: { command: "test \"$(cat ready.txt)\" = Ready && printf 'Ready verified'" } }
        } : { kind: "seam", seam: "public Ready file", behaviors: ["Ready remains Ready"], verification: "Read Ready after rewriting the label" };
        const next = await worker.call("legion_engineering", proposal);
        assert.equal(next.details?.kind, "waiting", census.effectCase.startsWith("exception") ? "BEHAVIOR a narrow exception reaches its separate Legatus decision with exact seam and alternative plan" : "BEHAVIOR a successive proposal waits for its own separate Legatus decision");
        assert.equal((await worker.call("write", { path: target, content: "Unapproved" })).isError, true);
        assert.equal(fs.readFileSync(target, "utf8"), "Ready");
        await until(async () => (await state()).snapshot.engineering.length === 2, "successive proposal ingestion");
        const records = (await state()).snapshot.engineering;
        assert.deepEqual(records[1].previous, { id: records[0].id, digest: records[0].digest });
        if (census.effectCase !== "successive-busy") await worker.settle();
        await drain();
        await until(() => controller.prompts.length > 0, "successive decision prompt");
        assert.equal(await controller.start(controller.prompts.shift()), true);
        if (census.effectCase === "exception-context") {
          const presented = controller.ctx.sessionManager.getBranch().filter(entry => entry.customType === "legion-engineering-decision").at(-1);
          assert.deepEqual(JSON.parse(presented.content).approvedSeam?.proposal, base.proposal, "BEHAVIOR exception decision presents the exact approved seam and behavior to the separate Legatus");
        }
        assert.equal((await controller.call("legion_engineering_decide", { kind: ["exception-decline", "exception-revise"].includes(census.effectCase) ? "decline" : census.effectCase === "exception-escalate" ? "escalate" : "approve", rationale: "Only the named omitted test is considered. The alternative checks the same bounded behavior." })).details.kind, "applied");
        await controller.settle(); await drain();
        assert.equal(await controller.start(controller.prompts.shift()), true);
        assert.equal((await controller.call("legion_engineering_deliver", { requestId: records[1].id })).details.kind, "applied");
        await controller.settle(); await drain();
        if (census.effectCase === "successive-busy") {
          assert.equal((await worker.call("write", { path: target, content: "Wrong continuation" })).isError, true, "BEHAVIOR a delivered successor cannot borrow the earlier expanded continuation");
          assert.equal(fs.readFileSync(target, "utf8"), "Ready");
          await worker.settle(); await drain();
          assert.equal((await state()).tasks[0].launch.kind, "assigned", "Settling the earlier turn must not report the successor as finished");
        }
        if (["exception-off", "exception-stale"].includes(census.effectCase)) {
          const owner = (await state()).snapshot.id;
          await controller.command("off");
          if (census.effectCase === "exception-stale") await controller.command(`resume ${owner}`);
        }
        const resumed = await worker.call("write", { path: target, content: "Ready" });
        if (["exception-decline", "exception-escalate", "exception-off", "exception-stale", "exception-revise"].includes(census.effectCase)) {
          assert.equal(resumed.isError, true, "An old seam cannot substitute for declined, escalated, or revoked exception authority");
          assert.equal(fs.readFileSync(target, "utf8"), "Ready");
          assert.equal((await state()).snapshot.effects.length, 1);
          if (census.effectCase === "exception-revise") {
            const revisedProposal = { ...proposal, rationale: "The revised justification identifies the unavailable display and retains the exact byte check." };
            const revision = await worker.call("legion_engineering", revisedProposal);
            assert.equal(revision.details?.kind, "waiting", "BEHAVIOR a declined exception can request a fresh decision for a revised justification");
            assert.equal((await worker.call("write", { path: target, content: "Not approved" })).isError, true);
            await until(async () => (await state()).snapshot.engineering.length === 3, "revised exception ingestion");
            await worker.settle(); await drain();
            assert.equal(await controller.start(controller.prompts.shift()), true);
            assert.equal((await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The revised justification and exact alternative are adequate." })).details.kind, "applied");
            await controller.settle(); await drain();
            assert.equal(await controller.start(controller.prompts.shift()), true);
            const revisionRecord = (await state()).snapshot.engineering[2];
            assert.equal((await controller.call("legion_engineering_deliver", { requestId: revisionRecord.id })).details.kind, "applied");
            await controller.settle(); await drain();
            assert.equal((await worker.call("bash", revisedProposal.alternative.input)).isError ?? false, false);
            await worker.settle(); await drain();
            const result = (await state()).tasks[0].launch;
            assert.equal(result.kind, "reported");
            assert.equal(result.report.engineering.decision.id, revisionRecord.id);
            assert.equal(result.report.engineering.alternative.kind, "verified");
          }
          const view = await state();
          fs.writeFileSync(join(root, "effect-history.json"), JSON.stringify(view, null, 2));
          return { root, view };
        }
        assert.equal(resumed.isError ?? false, false, JSON.stringify(resumed));
        await until(async () => (await state()).snapshot.effects.length === 2 && (await state()).snapshot.effects[1].state.kind === "completed", "successive completion");
        assert.equal((await state()).snapshot.effects[1].intent.decision.id, records[1].id);
        if (census.effectCase.startsWith("exception")) {
          assert.deepEqual((await state()).snapshot.engineering[1].proposal, proposal);
          assert.deepEqual((await state()).snapshot.effects[1].intent.seam, proposal.seam);
          if (census.effectCase === "exception-result-failed") assert.equal((await worker.call("write", { path: target, content: "Wrong" })).isError ?? false, false);
          worker.pi.on("tool_call", event => {
            if (event.toolName !== "bash") return;
            if (census.effectCase === "exception-result-deny") return { block: true, reason: "Ordinary shell permission refused" };
            if (census.effectCase === "exception-result-mutate") event.input.command = "printf 'unrelated success'";
          });
          const alternative = await worker.call("bash", ["exception-result-missing", "exception-successor-missing"].includes(census.effectCase) ? { command: "printf 'unrelated success'" } : proposal.alternative.input);
          const refused = ["exception-result-failed", "exception-result-deny", "exception-result-mutate"].includes(census.effectCase);
          assert.equal(alternative.isError ?? false, refused, JSON.stringify(alternative));
          if (!refused) assert.equal(alternative.structuredContent.output, ["exception-result-missing", "exception-successor-missing"].includes(census.effectCase) ? "unrelated success" : "Ready verified");
          await until(async () => ["completed", "refused"].includes((await state()).snapshot.effects.at(-1)?.state.kind), "alternative observation");
          assert.equal((await state()).snapshot.effects.at(-1).intent.decision.id, records[1].id);
          if (census.effectCase === "exception-result-after-write") assert.equal((await worker.call("write", { path: target, content: "Changed after verification" })).isError ?? false, false);
          if (census.effectCase.startsWith("exception-result-")) {
            await worker.settle(false, "All verification passed. This model claim must not grant acceptance."); await drain();
            const final = (await state()).tasks[0].launch;
            assert.equal(final.kind, "reported");
            assert.equal(final.report.outcome, "blocked", "BEHAVIOR missing alternative evidence blocks the reported result despite model claims");
            assert.equal(final.report.engineering.alternative.kind, "unverified", "Unrelated, failed, refused, mutated, or superseded command evidence cannot verify an exception");
          }
          if (census.effectCase.startsWith("exception-successor")) {
            const proposed = await worker.call("legion_engineering", { kind: "seam", seam: "public Ready file", behaviors: ["Ready remains Ready"], verification: "Check the final Ready file" });
            assert.equal(proposed.details.kind, "waiting");
            assert.equal((await worker.call("bash", proposal.alternative.input)).isError, true);
            await until(async () => (await state()).snapshot.engineering.length === 3, "successor seam ingestion");
            await worker.settle(); await drain();
            assert.equal(await controller.start(controller.prompts.shift()), true);
            assert.equal((await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The successor seam remains within the same task." })).details.kind, "applied");
            await controller.settle(); await drain();
            assert.equal(await controller.start(controller.prompts.shift()), true);
            const successor = (await state()).snapshot.engineering[2];
            assert.equal((await controller.call("legion_engineering_deliver", { requestId: successor.id })).details.kind, "applied");
            await controller.settle(); await drain();
            const staleException = await worker.call("legion_engineering", proposal);
            assert.equal(staleException.isError, true);
            assert.equal((await worker.call("write", { path: target, content: "Ready" })).isError ?? false, false);
            await worker.settle(); await drain();
            const final = (await state()).tasks[0].launch;
            assert.equal(final.kind, "reported");
            assert.equal(final.report.engineering.decision.id, successor.id);
            assert.equal(final.report.engineering.priorExceptions?.length, 1, "BEHAVIOR a successor result preserves the retired exception and its historical native verification");
            const historical = final.report.engineering.priorExceptions[0];
            assert.deepEqual(historical.decision, { id: records[1].id, digest: records[1].digest });
            assert.deepEqual(historical.seam, proposal.seam);
            assert.equal(historical.alternative.kind, census.effectCase === "exception-successor-missing" ? "unverified" : "verified");
            assert.equal(final.report.outcome, census.effectCase === "exception-successor-missing" ? "blocked" : "reported-result");
          }
          if (census.effectCase === "exception-result") {
            await worker.settle(); await drain();
            const final = (await state()).tasks[0].launch;
            assert.equal(final.kind, "reported", "BEHAVIOR final exception result retains native alternative verification rather than a model claim");
            assert.equal(final.report.outcome, "reported-result");
            assert.deepEqual(final.report.engineering.decision, { id: records[1].id, digest: records[1].digest });
            assert.deepEqual(final.report.engineering.seam, proposal.seam);
            assert.equal(final.report.engineering.alternative.kind, "verified");
            const effect = (await state()).snapshot.effects[2];
            assert.deepEqual(final.report.engineering.alternative.effect, { id: effect.intent.id, digest: effect.digest });
            assert.equal(final.report.engineering.alternative.evidence, effect.state.evidence);
            const retained = JSON.parse(fs.readFileSync(final.report.engineering.alternative.evidence, "utf8"));
            assert.equal(retained.kind, "native-result");
            assert.equal(retained.result.structuredContent.exit_code, 0);
            assert.equal(retained.result.structuredContent.output, "Ready verified");
          }
        }
      } else if (census.effectCase === "task-amendment") {
        await controller.emit("input", { source: "interactive", text: "Change the existing Ready behavior to say Ready now" });
        await drain();
        assert.equal(await controller.start(controller.prompts.shift()), true);
        const change = (await state()).snapshot.submissions.at(-1);
        const amendment = await controller.call("legion_intake", { kind: "propose-amendment", source: { id: change.id, revision: change.revision }, affected: [{ id: task.id, revision: 1 }], category: "requirements", change: "Ready now replaces Ready", question: "Approve the changed Ready behavior?", recommendation: "Approve only this bounded change" });
        assert.equal(amendment.details.kind, "applied", JSON.stringify(amendment));
        await controller.settle(); await drain();
        const open = await state(), question = open.snapshot.decisions.at(-1), proposed = open.snapshot.amendments.at(-1);
        await controller.emit("input", { source: "interactive", text: "Approve the displayed Ready now amendment" });
        await drain();
        assert.equal(await controller.start(controller.prompts.shift()), true);
        const answer = (await state()).snapshot.submissions.at(-1);
        const approved = await controller.call("legion_intake", { kind: "answer", source: { id: answer.id, revision: answer.revision }, decision: { id: question.id, revision: question.history.at(-1).revision }, effect: { kind: "approve-amendment", amendment: proposed.id } });
        assert.equal(approved.details.kind, "applied", JSON.stringify(approved));
        await controller.settle(); await drain();
        const revised = await state();
        assert.equal(revised.tasks[0].history.at(-1).revision, 2);
        assert.deepEqual(revised.tasks[0].scope.amendments, [proposed.id]);
        assert.equal((await worker.call("write", { path: target, content: "Stale approval" })).isError, true);
        assert.equal(fs.existsSync(target), false);
        assert.equal((await state()).snapshot.effects.length, 0);
      } else if (census.effectCase.startsWith("controller-")) {
        const selected = census.effectCase.includes("-poteto-") ? worker.pi.getCommands().find(command => command.name === "skill:poteto-mode").sourceInfo.path : join(matt, "SKILL.md");
        const bytes = fs.readFileSync(selected), originalLink = fs.linkSync;
        let changed = false, restored = false, refusal, requested;
        const restore = () => {
          if (!changed || restored) return;
          if (census.effectCase.endsWith("target")) { fs.unlinkSync(selected); fs.renameSync(`${selected}.original`, selected); }
          else fs.writeFileSync(selected, bytes);
          restored = true;
        };
        fs.linkSync = (source, destination) => {
          originalLink(source, destination);
          if (!String(destination).startsWith(join(profile, "legion/tribuni", workerDescriptor.launch.id))) return;
          if (String(destination).endsWith(".effect-request.json") && !changed) {
            requested = JSON.parse(fs.readFileSync(destination, "utf8")).message.intent;
            if (census.effectCase.endsWith("target")) {
              fs.writeFileSync(`${selected}.controller-target`, bytes);
              fs.renameSync(selected, `${selected}.original`);
              fs.symlinkSync(`${selected}.controller-target`, selected);
            } else fs.appendFileSync(selected, "\nController observes changed bytes.\n");
            changed = true;
          }
          if (String(destination).endsWith(".effect-response.json") && changed && !restored) {
            refusal = JSON.parse(fs.readFileSync(destination, "utf8"));
            restore();
          }
        };
        syncBuiltinESMExports();
        try { assert.equal((await worker.call("write", { path: target, content: "Ready" }, "controller-refused")).isError, true, "Controller must refuse its observed resource change"); }
        finally { restore(); fs.linkSync = originalLink; syncBuiltinESMExports(); }
        assert.equal(changed && restored, true);
        assert.equal(fs.existsSync(target), false);
        fs.writeFileSync(join(root, "controller-refusal.json"), JSON.stringify({ requested, refusal }, null, 2));
        const restoredCall = await worker.call("write", { path: target, content: "Ready" }, "restored-without-loading");
        assert.equal(restoredCall.isError, true, "BEHAVIOR controller-observed invalidation survives restoration until fresh native loading");
        assert.equal(refusal.kind, "resource-invalidated");
        assert.equal(refusal.intent.id, requested.id);
        assert.equal(refusal.resource.reason, census.effectCase.endsWith("target") ? "canonical-target-changed" : "content-changed");
        assert.equal(fs.existsSync(target), false);
        for (const file of ["SKILL.md", "tests.md", "mocking.md"]) await worker.call("read", { path: join(matt, file) });
        assert.equal((await worker.call("write", { path: target, content: "Ready" }, "fresh-matt-only")).isError, true, "Full retirement includes old poteto expansion proof");
        const poteto = worker.pi.getCommands().find(command => command.name === "skill:poteto-mode").sourceInfo.path;
        await worker.call("read", { path: poteto });
        assert.equal((await worker.call("write", { path: target, content: "Ready" }, "fresh-proof-recovered")).isError ?? false, false);
        assert.equal(fs.readFileSync(target, "utf8"), "Ready");
        await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "completed", "fresh proof recovery completes");
      } else if (census.effectCase === "lost-response") {
        const transportRoot = join(profile, "legion/tribuni", workerDescriptor.launch.id, (await state()).tasks[0].launch.worker.address.generation);
        const lost = fs.watch(transportRoot, (_event, file) => {
          if (file?.endsWith(".effect-response.json") && fs.existsSync(join(transportRoot, file))) fs.unlinkSync(join(transportRoot, file));
        });
        try { assert.equal((await worker.call("write", { path: target, content: "Ready" })).isError, true); }
        finally { lost.close(); }
        assert.equal(fs.existsSync(target), false);
        const retained = await state();
        assert.equal(retained.snapshot.effects.length, 1);
        assert.equal(retained.snapshot.effects[0].state.kind, "outstanding");
        const next = await worker.call("write", { path: target, content: "No implicit retry" });
        assert.equal(next.isError, true, "BEHAVIOR ambiguous admission response holds fresh effects without reissuing work");
        assert.equal(fs.existsSync(target), false);
      } else if (census.effectCase === "unknown") {
        fs.mkdirSync(target);
        assert.equal((await worker.call("write", { path: target, content: "Ready" }, "unknown-write")).isError, true);
        await until(async () => (await state()).snapshot.effects?.[0]?.state.kind === "unknown", "unknown effect observation");
        const next = await worker.call("write", { path: join(worker.ctx.cwd, "after-unknown.txt"), content: "No blind continuation" });
        assert.equal(next.isError, true, "BEHAVIOR unknown admitted effect holds new effects until same-identity reconciliation");
        assert.equal(fs.existsSync(join(worker.ctx.cwd, "after-unknown.txt")), false);
      } else {
        let permissionCalls = 0, outstanding;
        if (census.effectCase !== "write" && !census.effectCase.startsWith("native-")) worker.pi.on("tool_call", async event => {
          if (event.toolName !== "write") return;
          permissionCalls++;
          if (permissionCalls !== 1) return;
          if (census.effectCase === "off") { await controller.command("off"); outstanding = await state(); }
          if (census.effectCase.startsWith("mutate")) event.input.content = "Changed by later hook";
          if (census.effectCase.endsWith("deny")) return { block: true, reason: "Ordinary permission refused" };
          if (census.effectCase.endsWith("throw")) throw new Error("Ordinary permission failed");
          if (census.effectCase === "resources") fs.appendFileSync(join(matt, "mocking.md"), "\nObserved change after admission.\n");
          if (census.effectCase === "settings") worker.pi.getSettings = () => ({ shellCommandPrefix: "changed prefix" });
          if (census.effectCase === "ownership") {
            const current = worker.pi.getAllTools();
            worker.pi.getAllTools = () => current.map(tool => tool.name === "write" ? { ...tool, sourceInfo: { path: "foreign-tool-override" } } : tool);
          }
        });
        if (census.effectCase === "disconnected") await controller.emit("session_shutdown");
        if (["stale", "off-before"].includes(census.effectCase)) {
          const id = (await state()).snapshot.id;
          await controller.command("off");
          if (census.effectCase === "stale") await controller.command(`resume ${id}`);
        }
        if (census.effectCase === "incarnation") worker.ctx.sessionManager.getSessionId = () => "foreign-worker-session";
        if (census.effectCase === "selection") {
          const replacement = join(worker.ctx.cwd, "replacement/matt-tdd");
          fs.cpSync(matt, replacement, { recursive: true });
          refreshWorkerResources([replacement, ...workerPaths]);
        }
        const result = await worker.call("write", { path: target, content: "Ready" }, "exact-ready-write");
        if (["mutate", "deny", "mutate-deny", "throw", "mutate-throw", "resources", "disconnected", "stale", "off-before", "incarnation", "selection", "decline", "settings", "ownership"].includes(census.effectCase)) {
          assert.equal(result.isError, true, `Managed ${census.effectCase} refuses the effect`);
          assert.equal(fs.existsSync(target), false);
          if (!["disconnected", "stale", "off-before", "incarnation", "selection", "decline"].includes(census.effectCase)) {
            await until(async () => (await state()).snapshot.effects?.[0]?.state.kind === "refused", "durable final refusal");
            assert.equal(permissionCalls, 1);
          }
          if (census.effectCase === "resources") {
            const path = join(matt, "mocking.md");
            fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("\nObserved change after admission.\n", ""));
            assert.equal((await worker.call("write", { path: target, content: "Ready" })).isError, true, "Restored bytes alone do not revive proof");
            for (const file of ["SKILL.md", "tests.md", "mocking.md"]) await worker.call("read", { path: join(matt, file) });
            assert.equal((await worker.call("write", { path: target, content: "Ready" })).isError ?? false, false, "Fresh native reads recover current proof");
            assert.equal(fs.readFileSync(target, "utf8"), "Ready");
            await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "completed", "recovered effect completion");
          }
          const view = await state();
          fs.writeFileSync(join(root, "effect-history.json"), JSON.stringify(view, null, 2));
          return { root, view };
        }
        if (census.effectCase === "off") {
          assert.equal(outstanding.mode, "stopping");
          assert.equal(outstanding.snapshot.effects[0].state.kind, "outstanding");
          fs.writeFileSync(join(root, "outstanding-after-off.json"), JSON.stringify(outstanding, null, 2));
          assert.equal((await worker.call("write", { path: join(worker.ctx.cwd, "after-off.txt"), content: "Forbidden" })).isError, true);
          assert.equal(fs.existsSync(join(worker.ctx.cwd, "after-off.txt")), false);
        }
        assert.equal(result.isError ?? false, false, "BEHAVIOR current approved loaded principal writes through normal root permission hooks");
        assert.equal(fs.readFileSync(target, "utf8"), "Ready");
        await until(async () => (await state()).snapshot.effects?.[0]?.state.kind === "completed", "native completion observation");
        assert.equal((await worker.call("write", { path: target, content: "Replay" }, "exact-ready-write")).isError, true);
        assert.equal(fs.readFileSync(target, "utf8"), "Ready");
        assert.equal((await worker.call("write", { path: target, content: "Nested" }, "parent/1", "parent")).isError, true);
        assert.equal((await worker.call("subagent", { task: "Unauthorized delegation" })).isError, true);
        if (census.effectCase.startsWith("native-")) {
          worker.pi.on("tool_call", event => {
            if (event.toolName !== "edit") return;
            if (census.effectCase === "native-legacy-deny") return { block: true, reason: "Ordinary edit permission denied" };
            if (census.effectCase === "native-legacy-mutate") event.input.edits[0].newText = "Changed by later hook";
          });
          const replacement = { oldText: "Ready", newText: "Ready now" };
          const raw = census.effectCase.startsWith("native-legacy") ? { path: target, ...replacement }
            : { path: target, edits: census.effectCase === "native-string" ? JSON.stringify([replacement]) : census.effectCase === "native-object" ? replacement : [replacement] };
          const edited = await worker.call("edit", raw);
          if (["native-legacy-deny", "native-legacy-mutate", "native-legacy-early-mutate"].includes(census.effectCase)) {
            assert.equal(edited.isError, true, "BEHAVIOR only native preparation may bridge raw and admitted edit arguments");
            assert.equal(fs.readFileSync(target, "utf8"), "Ready");
            if (census.effectCase !== "native-legacy-early-mutate") await until(async () => (await state()).snapshot.effects.at(-1)?.state.kind === "refused", "native edit refusal");
          } else {
            assert.equal(edited.isError ?? false, false, "BEHAVIOR native-supported edit preparation preserves managed exact-call admission");
            assert.equal(fs.readFileSync(target, "utf8"), "Ready now");
            const admitted = (await state()).snapshot.effects.find(effect => effect.intent.call.name === "edit");
            assert.deepEqual(admitted.intent.call.rawInput, raw);
            assert.deepEqual(admitted.intent.call.input, { path: target, edits: [{ oldText: "Ready", newText: "Ready now" }] });
            const shell = await worker.call("bash", { command: "test \"$(cat ready.txt)\" = \"Ready now\" && printf 'behavior passed'" });
            assert.equal(shell.isError ?? false, false, JSON.stringify(shell));
            assert.equal(shell.structuredContent.output, "behavior passed");
            await until(async () => (await state()).snapshot.effects.filter(effect => effect.state.kind === "completed").length === 3, "all native effects completed");
          }
        }
      }
      const view = await state();
      fs.writeFileSync(join(root, "effect-history.json"), JSON.stringify(view, null, 2));
      return { root, view };
    }
    assert.equal((await state()).tasks[0].launch.kind, "assigned", "Fixture setup must produce an assigned worker");
    await controller.settle(); await drain(); scheduled = [];
    controller.setIdle(false);
    const proposal = await worker.call("legion_engineering", { kind: "seam", seam: "labelForStatus", behaviors: ["Ready renders Ready"], verification: "Run the public label test" });
    assert.equal(proposal.details.kind, "waiting", JSON.stringify(proposal));
    await until(async () => (await state()).snapshot.engineering.length === 1, "addressed proposal ingestion");
    await controller.command("task Add a second independent label");
    let nextWorkspace = workspace;
    if (kind === "workspace" || census?.stage === "workspace") {
      await controller.command(`reconcile ${task.id}`);
      nextWorkspace = (await state()).snapshot.workspaceRequests.at(-1).id;
      assert.notEqual(nextWorkspace, workspace, "Fixture setup requires a fresh unattempted workspace request");
    }
    controller.setPending(true);
    await controller.settle();
    scheduled = scheduled.slice(-2);
    assert.equal(scheduled.length, 2, "Fixture requires the externally queued engineering and intake callbacks");
    const [engineering, intake] = scheduled; scheduled = [];
    controller.setPending(false);
    if (census) {
      const initial = await state();
      if (census.outcome === "send-uncertain") controller.failSend();
      if (census.stage === "workspace") await controller.command(`workspace ${nextWorkspace}`);
      else (census.stage === "engineering" ? engineering : intake)();
      await delay(100);
      const prompt = controller.prompts.shift();
      assert.equal(typeof prompt, "string", "Census setup requires an actually emitted dispatch");
      let admitted = null, nativeAdmissionFailure = null;
      if (census.outcome === "pending") {
        if (census.stage === "workspace") controller.onIdle(() => queueMicrotask(() => controller.setPending(true)));
        else controller.onAuth(() => controller.setPending(true));
      }
      if (census.outcome === "pending-before") controller.setPending(true);
      if (census.outcome === "auth-error") controller.onAuth(() => { throw new Error("Controlled selected-provider lookup unavailable"); });
      if (census.outcome === "superseded") controller.onAuth(async () => {
        await controller.command("off");
        await controller.command(`resume ${initial.snapshot.id}`);
        await drain();
      });
      if (census.outcome === "stale") await controller.command("off");
      if (census.outcome === "auth-unavailable") controller.setAuth(false);
      if (census.outcome !== "send-uncertain") {
        try { admitted = await controller.start(prompt); }
        catch (error) {
          if (census.outcome !== "auth-unavailable" || error.message !== "Controlled native Pi authentication refusal before agent_start") throw error;
          admitted = false;
          nativeAdmissionFailure = error.message;
        }
      }
      const afterAdmission = controller.notices.slice();
      if (admitted) await controller.settle();
      controller.setPending(false);
      controller.setAuth(true);
      if (census.outcome === "stale" || census.outcome === "auth-unavailable" || census.outcome === "auth-error") await controller.command(`resume ${initial.snapshot.id}`);
      if (census.outcome !== "superseded") await controller.emit("input", { source: "interactive", text: "Queue-drain progress observation" });
      await drain(); await delay(50);
      const replacement = controller.prompts.filter(value => value !== prompt);
      if (kind === "uncertain") {
        assert.deepEqual(replacement, [], "BEHAVIOR uncertain dispatch delivery remains held without automatic retry");
        await controller.command(`resume ${initial.snapshot.id}`);
        await drain(); await drain();
        assert.deepEqual(controller.prompts, [], "Explicit resume cannot retry an uncertain send");
        assert.equal((await state()).snapshot.engineering[0].state.kind, "open");
      }
      if (kind === "progress") {
        if (census.outcome === "pending" || census.outcome === "pending-before") {
          assert.equal(admitted, false, "BEHAVIOR pending input is refused before a model turn starts");
          assert.equal(replacement.length > 0, true, "BEHAVIOR consumed unstarted dispatch releases ownership for real queue-drain progress");
        } else if (census.outcome === "auth-unavailable" || census.outcome === "auth-error") {
          assert.deepEqual(replacement.map(value => value.split(" dispatch ")[0]), ["Legion engineering"], "BEHAVIOR held authentication resumes only through a fresh public dispatch");
        } else if (census.outcome === "stale" || census.outcome === "superseded") {
          assert.deepEqual(replacement.map(value => value.split(" dispatch ")[0]), ["Legion intake"], "BEHAVIOR stale unstarted authority does not retain controller ownership");
        }
        const nextPrompt = controller.prompts.shift();
        assert.notEqual(nextPrompt, prompt);
        assert.equal(await controller.start(nextPrompt), true);
        if (nextPrompt.startsWith("Legion intake dispatch ")) {
          await interpretPending();
          await controller.settle(); await drain();
        }
        if (census.outcome === "stale" || census.outcome === "superseded") {
          assert.equal((await state()).tasks.length, 2);
          assert.equal((await state()).snapshot.engineering[0].state.kind, "open");
          return { ...census, admitted, staleRequestRetained: true, progressed: true };
        }
        const fresh = nextPrompt.startsWith("Legion engineering dispatch ") ? nextPrompt : controller.prompts.shift();
        assert.notEqual(fresh, prompt);
        assert.match(fresh, /^Legion engineering dispatch /);
        if (fresh !== nextPrompt) assert.equal(await controller.start(fresh), true);
        const result = await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The preserved seam covers the bounded behavior." });
        assert.equal(result.details.kind, "applied", JSON.stringify(result));
        await controller.settle();
        assert.equal(await controller.start(controller.prompts.shift()), true);
        const request = (await state()).snapshot.engineering[0];
        const delivered = await controller.call("legion_engineering_deliver", { requestId: request.id });
        assert.equal(delivered.details.kind, "applied", JSON.stringify(delivered));
        assert.equal((await worker.call("write", { path: join(repo, "forbidden"), content: "no" })).isError, true);
        await worker.settle(); await controller.settle(); await drain();
        if (census.stage === "workspace") {
          if (controller.prompts[0]?.startsWith("Legion intake dispatch ")) {
            assert.equal(await controller.start(controller.prompts.shift()), true);
            await interpretPending();
            await controller.settle(); await drain();
          }
          await controller.command(`workspace ${nextWorkspace}`);
          const freshWorkspace = controller.prompts.shift();
          assert.match(freshWorkspace, /^Legion workspace dispatch /);
          assert.notEqual(freshWorkspace, prompt);
          assert.equal(await controller.start(freshWorkspace), true);
          const completed = await controller.call("legion_workspace", { requestId: nextWorkspace });
          assert.equal(completed.details.kind, "reserved", JSON.stringify(completed));
        }
      }
      return { ...census, admitted, nativeAdmissionFailure, followupPrompts: replacement.map(value => value.split(" dispatch ")[0]), requestRetained: (await state()).snapshot.engineering.length === 1, admissionNotices: afterAdmission.slice(initial.notices?.length ?? 0).filter(value => !value.includes("\nState\n")).slice(-3), recoveryEvent: census.outcome === "stale" || census.outcome === "auth-unavailable" || census.outcome === "auth-error" ? "explicit resume followed by actual Emperor input" : admitted ? "settlement of the admitted turn followed by actual Emperor input" : "actual Emperor input after queue drain; no settlement for consumed input" };
    }
    if (kind === "engineering") controller.onIdle(engineering);
    else if (kind === "pending") controller.onIdle(() => queueMicrotask(() => controller.setPending(true)));
    else if (kind === "workspace") controller.onIdle(engineering);
    else if (kind !== "workspace-input") throw new Error("Unknown race fixture");
    if (kind === "workspace") await controller.command(`workspace ${nextWorkspace}`);
    else intake();
    await delay(100);
    if (kind === "workspace") {
      assert.deepEqual(controller.prompts.map(prompt => prompt.startsWith("Legion engineering dispatch ") ? "engineering" : "workspace"), ["engineering"], "BEHAVIOR a workspace command cannot allocate a stage beside engineering after its awaits");
    } else if (kind === "engineering") {
      assert.deepEqual(controller.prompts.map(prompt => prompt.startsWith("Legion engineering dispatch ") ? "engineering" : "intake"), ["engineering"], "BEHAVIOR one model stage owns the idle controller after competing dispatch reads");
      assert.equal(await controller.start(controller.prompts.shift()), true);
      const decided = await controller.call("legion_engineering_decide", { kind: "approve", rationale: "The seam covers the bounded behavior." });
      assert.equal(decided.details.kind, "applied", JSON.stringify(decided));
      await controller.settle();
      assert.equal(await controller.start(controller.prompts.shift()), true);
      const request = (await state()).snapshot.engineering[0];
      const delivered = await controller.call("legion_engineering_deliver", { requestId: request.id });
      assert.equal(delivered.details.kind, "applied", JSON.stringify(delivered));
      await worker.settle(); await controller.settle(); await drain();
      await until(() => controller.prompts.length > 0, "remaining intake proceeds after engineering");
      assert.equal(await controller.start(controller.prompts.shift()), true);
      const next = (await state()).snapshot.submissions.at(-1);
      const accepted = await controller.call("legion_intake", { kind: "new-task", source: { id: next.id, revision: next.revision }, goal: "Add a second independent label", acceptance: ["Second label appears"], questions: [] });
      assert.equal(accepted.details.kind, "applied", JSON.stringify(accepted));
      assert.equal((await state()).tasks.length, 2);
      assert.equal((await worker.call("write", { path: join(repo, "forbidden"), content: "no" })).isError, true);
    } else {
      assert.deepEqual(controller.prompts, [], "BEHAVIOR pending messages prevent intake dispatch after an awaited read");
      controller.setPending(false);
      await controller.emit("input", { source: "interactive", text: "Queue-drain observation" });
      await drain();
      assert.equal(await controller.start(controller.prompts.shift()), true);
      await controller.settle(); await drain();
      assert.ok(controller.prompts.some(prompt => prompt.startsWith("Legion engineering dispatch ")));
    }
  } finally {
    await controller.emit("session_shutdown");
    if (worker) await worker.emit("session_shutdown");
    scheduled = []; globalThis.setTimeout = originalTimer;
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await writeFile(join(root, "ownership.json"), JSON.stringify({ pid: process.pid, kind: "in-process controlled Pi contexts", closed: true, noOrdinaryPiOrHerdrActors: true }));
  }
}

export async function exerciseLegatusResearch(scenario = "complete") {
  const { Legion } = await import("../../src/intake.ts");
  const root = await mkdtemp(join(tmpdir(), "legatus-native-contract-"));
  const profile = join(root, "profile"); fs.mkdirSync(profile);
  const prior = { dir: process.env.PI_CODING_AGENT_DIR, child: process.env.PI_SUBAGENT_CHILD, bindings: process.env.PI_SUBAGENT_EXTENSION_BINDINGS, path: process.env.PATH };
  process.env.PI_CODING_AGENT_DIR = profile; delete process.env.PI_SUBAGENT_CHILD;
  fs.mkdirSync(join(profile, "pstack"));
  fs.writeFileSync(join(profile, "pstack/models.json"), JSON.stringify({ version: 1, roles: { "how explorer": "controlled/explorer" } }));
  fs.writeFileSync(join(root, "facts.md"), "The public function is renderStatus.\n");
  const principal = runtime(root, "legatus-native-contract", join(root, "principal.jsonl"));
  principal.ctx.modelRegistry.getAvailable = () => [{ provider: "controlled", id: "selected" }, { provider: "controlled", id: "explorer" }];
  const bin = join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(join(bin, "herdr"), '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "0.9.1" : JSON.stringify({status:"running",running:true,version:"0.9.1",protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:"/controlled/herdr.sock"}));\n', { mode: 0o700 });
  process.env.PATH = `${bin}:${prior.path}`;
  extension(principal.pi);
  await principal.emit("session_start");
  const options = { storagePath: join(profile, "legion"), context: root, session: principal.ctx.sessionManager.getSessionId(), preflight: async () => [] };
  const command = text => principal.command(text);
  const legion = { state: async () => {
    await command("status");
    const notice = principal.notices.at(-1);
    if (notice === "Legion is inactive.") return { mode: "inactive", snapshot: null };
    return JSON.parse(notice.split("State\n")[1]);
  } };
  const nativePolicy = raw => buildInProcessChildLaunch({ parentSessionId: options.session, cwd: root, host: "runner", sessionEnabled: false, childAgentName: raw.agent, childIndex: 0, inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false, tools: ["read"], model: "controlled/explorer", extensionBindings: raw.extensionBindings });
  // Controlled native execute boundary: resolve actual installed registrations and build
  // the real native child launch policy, but never create a child session/process.
  const ordinaryNative = async (name, raw) => {
    if (name === "subagents_enable") return { content: [], details: { enabled: true } };
    assert.equal(name, "subagent");
    if (raw.action === "list") return { content: [], details: { agents: listRuntimeAgentConfigs(principal.pi).map(agent => agent.name) } };
    return { content: [], details: { extensions: nativePolicy(raw).launchResolvedExtensions.required } };
  };
  const ordinaryInput = { agent: "ordinary-native", task: "Ordinary native work", extensionBindings: { "unrelated/1": { value: "retained" } } };
  const protectedDrain = async input => {
    principal.external(ordinaryNative);
    for (const [name, raw] of [["subagent", { action: "list", capabilities: true }], ["subagents_enable", {}], ["subagent", ordinaryInput], ["subagent", input]]) {
      const denied = await principal.call(name, raw);
      assert.equal(denied.isError, true, "Unresolved research keeps native child tools protected during off");
      assert.match(denied.content[0].text, /No correlated research launch stage is active/);
    }
    assert.deepEqual(resolveRequiredChildExtensions(options.session).map(entry => entry.id), ["pi-legion-centurio"], "Unresolved off must not drop the actual required guard");
    assert.deepEqual(nativePolicy(ordinaryInput).launchResolvedExtensions.required, ["pi-legion-centurio"]);
    assert.ok(listRuntimeAgentConfigs(principal.pi).some(agent => agent.name === input.agent));
    const intent = JSON.parse(fs.readFileSync(input.extensionBindings["pi-legion/1"].path, "utf8"));
    assert.ok(fs.existsSync(intent.intent.endpoint), "Retiring owner retains its child authentication socket");
  };
  let child;
  try {
    assert.equal((await legion.state()).mode, "inactive");
    principal.external(ordinaryNative);
    for (const [name, raw] of [["subagent", { action: "list", capabilities: true }], ["subagents_enable", {}], ["subagent", ordinaryInput]]) assert.equal((await principal.call(name, raw)).isError ?? false, false, "Inactive startup remains unrestricted for ordinary native tools");
    assert.deepEqual(resolveRequiredChildExtensions(options.session), []);
    await command("status"); await command("doctor");
    assert.equal((await principal.call("legion_research", { task: "Find the API", role: "how explorer" })).isError, true);
    await command("on");
    await command("research Find the API and references");
    const marker = principal.prompts.shift();
    assert.equal(await principal.start(marker), true, "Actual extension command dispatches its correlated model stage");
    assert.equal((await principal.call("read", { path: "facts.md" })).isError, true, "Research stage cannot explore in principal context");
    assert.equal((await principal.call("legion_research", { task: "Substituted task", role: "how explorer" })).isError, true);
    principal.external(async () => ({ content: [{ type: "text", text: "External unowned launch accepted" }], isError: false }));
    assert.equal((await principal.call("subagent", { agent: "unowned", task: "Unapproved child" })).isError, true, "Research dispatch cannot launch an unowned child before its durable preparation");
    const prepared = await principal.call("legion_research", { task: "Find the API and references", role: "how explorer" });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const record = prepared.details.research, input = record.launch;
    assert.equal(input.model, "controlled/explorer");
    assert.equal(principal.ctx.model.id, "selected");
    assert.equal((await legion.state()).tasks.length, 0);
    assert.equal(record.owner.role, "legatus");
    assert.equal("window" in record.owner, false);
    const descriptors = listRuntimeAgentConfigs(principal.pi);
    assert.equal(descriptors.find(agent => agent.name === input.agent).allowNestedSubagents, false);
    assert.equal(descriptors.find(agent => agent.name === input.agent).inheritSkills, false);
    if (scenario === "changed-input") {
      assert.equal((await principal.call("subagent", { ...input, task: "Changed unowned task" })).isError, true);
      assert.equal((await legion.state()).snapshot.research[0].child.state.kind, "prepared");
      return { root };
    }
    if (scenario === "role-changed") {
      fs.writeFileSync(join(profile, "pstack/models.json"), JSON.stringify({ version: 1, roles: { "how explorer": "controlled/selected" } }));
      assert.equal((await principal.call("subagent", input)).isError, true);
      assert.equal((await legion.state()).snapshot.research[0].child.state.kind, "prepared");
      return { root };
    }
    const runId = randomUUID(), runner = randomUUID(), childSession = randomUUID(), completionOwnerId = randomUUID(), asyncDir = join(root, "native-run"), journal = join(root, "child.jsonl");
    fs.mkdirSync(asyncDir);
    fs.writeFileSync(journal, JSON.stringify({ type: "session", id: childSession, cwd: root }) + "\n");
    const status = { runId, sessionId: principal.ctx.sessionManager.getSessionFile(), completionOwnerId, mode: "single", state: "running", cwd: root, currentStep: 0, launchContractDigest: "research-contract", launchResolvedExtensions: { disableAmbientExtensions: false, required: ["pi-legion-centurio"] }, processTerminal: { version: 1, state: "pending", runId, runnerProcessInstanceId: runner }, steps: [{ agent: input.agent, sessionFile: journal, model: input.model, requestedModel: input.model, context: "fresh", launchContractDigest: "research-contract" }] };
    principal.external(async (name, raw) => { if (name === "read") return createReadTool(root).execute(randomUUID(), raw); assert.equal(name, "subagent"); fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status)); return { content: [{ type: "text", text: "Native contract accepted" }], details: { runId, asyncDir } }; });
    if (scenario === "root-denial") principal.pi.on("tool_call", event => event.toolName === "subagent" ? { block: true, reason: "Ordinary root permission denial" } : undefined);
    const launched = await principal.call("subagent", input);
    if (scenario === "root-denial") {
      assert.equal(launched.isError, true);
      assert.equal(fs.existsSync(join(asyncDir, "status.json")), false);
      await command("off");
      assert.equal((await legion.state()).mode, "stopping", "Denied post-admission root remains visibly unresolved, never declared child-free");
      // Settle the principal stage so the refusal proves Legion's retained drain policy,
      // rather than either the running-stage restriction or the ordinary permission hook.
      await principal.settle(false, "Launch denied; exact native outcome remains unknown.");
      await protectedDrain(input);
      assert.equal((await legion.state()).snapshot.research[0].child.state.kind, "unknown");
      return { root };
    }
    assert.equal(launched.isError ?? false, false, JSON.stringify(launched));
    await principal.settle(false, "Native research dispatched; child completion not established.");
    assert.deepEqual(await principal.emit("input", { source: "extension", text: marker }), { action: "handled" }, "Consumed research marker cannot replay");
    child = runtime(root, childSession, journal); child.ctx.model = { provider: "controlled", id: "explorer", input: ["text"] };
    process.env.PI_SUBAGENT_CHILD = "1"; process.env.PI_SUBAGENT_EXTENSION_BINDINGS = JSON.stringify(input.extensionBindings);
    centurioGuard(child.pi);
    delete process.env.PI_SUBAGENT_CHILD;
    await child.emit("session_start");
    principal.pi.events.emit("subagent:async-started", { id: runId, sessionId: status.sessionId, completionOwnerId, asyncDir, cwd: root, mode: "single", agent: input.agent });
    await until(async () => (await legion.state()).snapshot.research[0].child.state.kind === "active", "research startup observation");
    if (scenario !== "off-after-completion") for (const transition of ["session_before_switch", "session_before_fork", "session_before_tree"]) assert.deepEqual(await principal.emit(transition), { cancel: true }, "Supported session transition must not strand owned research");
    if (scenario === "child-denial") child.pi.on("tool_call", event => event.toolName === "read" ? { block: true, reason: "Ordinary child read denial" } : undefined);
    const read = await child.call("read", { path: "facts.md" });
    assert.equal(read.isError ?? false, scenario === "child-denial", JSON.stringify(read));
    if (scenario !== "child-denial") assert.match(read.content[0].text, /renderStatus/);
    assert.equal((await child.call("bash", { command: "touch forbidden" })).isError, true);
    assert.equal((await child.call("write", { path: "forbidden", content: "no" })).isError, true);
    assert.equal(fs.existsSync(join(root, "forbidden")), false);
    const notice = { role: "custom", customType: "subagent-notify", content: "RAW LOG", details: { output: "PRIVATE LOG" }, display: true, timestamp: 1 };
    const projected = await principal.emit("context", { messages: [notice] });
    assert.equal(JSON.stringify(projected).includes("RAW LOG"), false);
    assert.equal(JSON.stringify(projected).includes("PRIVATE LOG"), false);
    assert.deepEqual(await principal.emit("input", { source: "extension", text: "Subagent updates above." }), { action: "handled" });
    const offAfterCompletion = scenario === "off-after-completion";
    if (!offAfterCompletion) await command("off");
    assert.equal((await legion.state()).mode, offAfterCompletion ? "active" : "stopping");
    assert.equal((await principal.call("legion_research", { task: "Not authorized", role: "how explorer" })).isError, true);
    assert.equal((await principal.call("subagent", input)).isError, true);
    if (!offAfterCompletion) await protectedDrain(input);
    if (scenario === "principal-model") {
      principal.ctx.model.id = "changed";
      assert.equal((await child.call("read", { path: "facts.md" })).isError, true);
      assert.equal((await legion.state()).mode, "stopping");
      return { root };
    }
    assert.equal((await child.call("read", { path: "facts.md" })).isError ?? false, scenario === "child-denial", "Already-authorized read-only child may safely finish during drain");
    const text = "API: facts.md:1 renderStatus.\n" + "bounded finding\n".repeat(400);
    fs.appendFileSync(journal, JSON.stringify({ type: "message", id: "research-finding", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }, { type: "thinking", thinking: "PRIVATE THINKING" }] } }) + "\n");
    fs.writeFileSync(join(asyncDir, "status.json"), JSON.stringify({ ...status, state: scenario === "failed" ? "failed" : "complete" }));
    await until(async () => (await legion.state()).snapshot.research[0].child.state.kind === "logical-terminal", "research awaits process proof");
    assert.equal((await legion.state()).mode, offAfterCompletion ? "active" : "stopping");
    if (!offAfterCompletion) await protectedDrain(input);
    const reopened = await new Legion(options).state();
    assert.equal(reopened.mode, "stopping", "Restart cannot infer no active children from absent runtime");
    assert.equal(reopened.snapshot.research[0].owner.session, options.session);
    fs.writeFileSync(join(asyncDir, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId, runnerProcessInstanceId: runner, instances: [{ kind: "runner", processInstanceId: runner, closeObservedAt: Date.now(), exitCode: scenario === "failed" ? 1 : 0, signal: null }] }));
    await until(async () => (await legion.state()).snapshot.research[0].child.state.kind === "process-terminal", "research settles independently");
    if (offAfterCompletion) {
      assert.equal((await legion.state()).mode, "active", "Child completion alone does not deactivate Legion");
      await command("off");
    }
    const final = await legion.state();
    assert.equal(final.mode, "inactive");
    if (["off-after-completion", "completion-during-off"].includes(scenario)) {
      principal.external(ordinaryNative);
      const listed = await principal.call("subagent", { action: "list", capabilities: true });
      assert.equal(listed.isError ?? false, false, "BEHAVIOR safe off restores ordinary native discovery");
      assert.equal(listed.details.agents.includes(input.agent), false, "Settled owned agent registration is removed");
      assert.equal(listed.details.agents.includes(`${input.agent}-implementation`), false);
      assert.deepEqual(resolveRequiredChildExtensions(options.session), [], "Safe off removes the actual required-child registration, not just tool checks");
      assert.equal((await principal.call("subagents_enable", {})).isError ?? false, false, "Safe off restores the unchanged native loader");
      const ordinary = await principal.call("subagent", ordinaryInput);
      assert.equal(ordinary.isError ?? false, false, JSON.stringify(ordinary));
      assert.deepEqual(ordinary.details.extensions, [], "Ordinary native launch policy does not inherit the retired research guard");
      assert.equal((await principal.call("subagent", input)).isError, true, "Old managed intent remains refused after removing local research policy");
      assert.deepEqual(await principal.emit("input", { source: "extension", text: marker }), { action: "handled" });
      principal.pi.events.emit("subagent:async-started", { id: "unrelated-native", sessionId: options.session, cwd: root, agent: ordinaryInput.agent });
      principal.pi.events.emit("subagent:async-complete", { runId: "unrelated-native", sessionId: options.session, cwd: root, agent: ordinaryInput.agent });
      assert.deepEqual(await principal.emit("input", { source: "extension", text: "Subagent updates above." }), { action: "continue" }, "Retired research no longer suppresses ordinary native notifications");
      assert.equal(await principal.emit("context", { messages: [notice] }), undefined, "Retired research no longer rewrites ordinary native context");
      assert.deepEqual((await legion.state()).snapshot.research, final.snapshot.research, "Retirement and unrelated native tools preserve durable research evidence");
      assert.equal((await legion.state()).snapshot.researchHold, null);
      const intent = JSON.parse(fs.readFileSync(record.intent.path, "utf8"));
      await until(() => !fs.existsSync(intent.intent.endpoint), "retired research socket closes");
      assert.ok(fs.existsSync(record.intent.path), "Disposal retains exact durable intent bytes");
    }
    for (const transition of ["session_before_switch", "session_before_fork", "session_before_tree"]) assert.equal(await principal.emit(transition), undefined, "Settled research permits normal transitions");
    assert.equal(final.snapshot.research[0].child.state.outcome, scenario === "failed" ? "failed" : "complete");
    assert.equal(final.snapshot.research[0].child.result.preview.length, 4000);
    assert.equal(final.snapshot.research[0].child.result.source, `${journal}#research-finding`);
    assert.equal(JSON.stringify(final).includes("PRIVATE THINKING"), false);
    assert.equal(fs.readFileSync(join(root, "facts.md"), "utf8"), "The public function is renderStatus.\n");
    if (scenario === "reactivate") {
      await command("on");
      await command("research Find the API again");
      assert.equal(await principal.start(principal.prompts.shift()), true);
      const fresh = await principal.call("legion_research", { task: "Find the API again", role: "how explorer" });
      assert.equal(fresh.isError, false, JSON.stringify(fresh));
      const freshRecord = fresh.details.research, freshInput = freshRecord.launch;
      assert.ok(freshRecord.owner.generation > record.owner.generation, "Reactivation establishes a fresh exact owner");
      assert.notEqual(freshRecord.id, record.id);
      assert.notEqual(freshInput.agent, input.agent);
      assert.deepEqual(resolveRequiredChildExtensions(options.session).map(entry => entry.id), ["pi-legion-centurio"]);
      assert.equal((await principal.call("subagent", input)).isError, true, "Fresh authority does not adopt an old managed intent");
      assert.equal((await principal.call("read", { path: "facts.md" })).isError, true, "A new exact owner must retain its research-only stage when disposing a settled predecessor runtime");
      const freshRun = randomUUID(), freshSession = randomUUID(), freshRunner = randomUUID(), freshCompletionOwner = randomUUID();
      const freshDirectory = join(root, "fresh-native-run"), freshJournal = join(root, "fresh-child.jsonl");
      fs.mkdirSync(freshDirectory);
      fs.writeFileSync(freshJournal, JSON.stringify({ type: "session", id: freshSession, cwd: root }) + "\n");
      const freshStatus = { ...status, runId: freshRun, completionOwnerId: freshCompletionOwner, processTerminal: { version: 1, state: "pending", runId: freshRun, runnerProcessInstanceId: freshRunner }, steps: [{ ...status.steps[0], agent: freshInput.agent, sessionFile: freshJournal }] };
      principal.external(async (name, raw) => {
        assert.equal(name, "subagent"); assert.deepEqual(raw, freshInput);
        assert.deepEqual(nativePolicy(raw).launchResolvedExtensions.required, ["pi-legion-centurio"]);
        fs.writeFileSync(join(freshDirectory, "status.json"), JSON.stringify(freshStatus));
        return { content: [], details: { runId: freshRun, asyncDir: freshDirectory } };
      });
      assert.equal((await principal.call("subagent", freshInput)).isError ?? false, false, "Fresh runtime admits its exact native launch");
      await principal.settle(false, "Fresh research dispatched.");
      await child.emit("session_shutdown");
      child = runtime(root, freshSession, freshJournal); child.ctx.model = { provider: "controlled", id: "explorer", input: ["text"] };
      process.env.PI_SUBAGENT_CHILD = "1"; process.env.PI_SUBAGENT_EXTENSION_BINDINGS = JSON.stringify(freshInput.extensionBindings);
      centurioGuard(child.pi); delete process.env.PI_SUBAGENT_CHILD;
      await child.emit("session_start");
      principal.pi.events.emit("subagent:async-started", { id: freshRun, sessionId: freshStatus.sessionId, completionOwnerId: freshCompletionOwner, asyncDir: freshDirectory, cwd: root, mode: "single", agent: freshInput.agent });
      await until(async () => (await legion.state()).snapshot.research.at(-1).child.state.kind === "active", "fresh research startup");
      assert.equal((await child.call("read", { path: "facts.md" })).isError ?? false, false, "Fresh owner/socket authenticates the real guarded child read");
      fs.appendFileSync(freshJournal, JSON.stringify({ type: "message", id: "fresh-finding", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "facts.md:1 renderStatus" }] } }) + "\n");
      fs.writeFileSync(join(freshDirectory, "status.json"), JSON.stringify({ ...freshStatus, state: "complete" }));
      fs.writeFileSync(join(freshDirectory, "process-terminal.json"), JSON.stringify({ version: 1, state: "observed", runId: freshRun, runnerProcessInstanceId: freshRunner, instances: [{ kind: "runner", processInstanceId: freshRunner, closeObservedAt: Date.now(), exitCode: 0, signal: null }] }));
      await until(async () => (await legion.state()).snapshot.research.at(-1).child.state.kind === "process-terminal", "fresh research process proof");
      await command("off");
      assert.equal((await legion.state()).mode, "inactive");
      assert.deepEqual(resolveRequiredChildExtensions(options.session), [], "Fresh runtime also retires at safe off");
    }
    return { root };
  } finally {
    await child?.emit("session_shutdown");
    await principal.emit("session_shutdown");
    await command("off");
    prior.path === undefined ? delete process.env.PATH : process.env.PATH = prior.path;
    prior.dir === undefined ? delete process.env.PI_CODING_AGENT_DIR : process.env.PI_CODING_AGENT_DIR = prior.dir;
    prior.child === undefined ? delete process.env.PI_SUBAGENT_CHILD : process.env.PI_SUBAGENT_CHILD = prior.child;
    prior.bindings === undefined ? delete process.env.PI_SUBAGENT_EXTENSION_BINDINGS : process.env.PI_SUBAGENT_EXTENSION_BINDINGS = prior.bindings;
  }
}
