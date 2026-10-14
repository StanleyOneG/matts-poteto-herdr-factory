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
import { Legion } from "../src/intake.ts";
import { GitWorkspace } from "../src/git-workspace.ts";
import { installTribunus, LocalTribunusHost } from "../src/tribunus-host.ts";

// One installed-SDK composition. Herdr allocation and TUI/Trust are controlled,
// not an alternate product launch mode or a #41 installed interactive journey.
assert.equal(VERSION, "1.2.0"); assert.equal(process.argv.length, 2);
const base = await realpath("/workspaces/astraprojects/.tmp");
const scratch = await realpath(process.env.TMPDIR ?? ""), root = await realpath(process.env.HANDOFF_RUNTIME ?? "");
for (const path of [scratch, root]) assert.ok(path.startsWith(base + sep) && path !== base);
assert.notEqual(root, scratch); assert.equal(process.env.TMP, process.env.TMPDIR); assert.equal(process.env.TEMP, process.env.TMPDIR);
const execute = promisify(execFile), json = async path => JSON.parse(await readFile(path, "utf8"));
const save = (name, value) => writeFile(join(root, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const project = fileURLToPath(new URL("..", import.meta.url));
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const subagentsVersion = (await json(join(dirname(subagentsEntry), "package.json"))).version;
assert.equal(subagentsVersion, "0.78.0");
await writeFile(join(root, "versions.json"), JSON.stringify({ pi: VERSION, subagents: subagentsVersion, node: process.version }), { flag: "wx", mode: 0o600 });
async function until(check, label) {
  const deadline = Date.now() + 30000; // Observation failure only, never settlement or kill authority.
  do { const result = await check(); if (result) return result; await delay(20); } while (Date.now() < deadline);
  throw new Error(`Unresolved ${label}; preserve native runtime, no fallback or replay.`);
}
async function identity(pid) {
  const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return { pid, boot, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
}
const prior = { ...process.env }, settingsPath = join(prior.HOME, ".pi/agent/settings.json"), hostSettings = await readFile(settingsPath);
const realServer = JSON.parse((await execute("herdr", ["status", "server", "--json"])).stdout);
assert.equal(realServer.version, "0.9.1"); assert.equal(realServer.protocol, 22);
const realPane = JSON.parse((await execute("herdr", ["pane", "get", prior.HERDR_PANE_ID])).stdout).result.pane;
await save("herdr-read-only.json", { server: realServer, pane: realPane });
const sourceFiles = ["scripts/verify-handoff.mjs", "src/intake.ts", "src/extension.ts", "src/resume.ts", "src/assignments.ts", "src/snapshot.ts", "src/tribunus.ts", "src/tribunus-host.ts", "src/tribunus-client.mjs", "src/git-workspace.ts", ".agents/skills/handoff/SKILL.md"];
await save("source.json", { head: (await execute("git", ["rev-parse", "HEAD"], { cwd: project })).stdout.trim(), files: await Promise.all(sourceFiles.map(async path => ({ path, sha256: sha256(await readFile(join(project, path))) }))) });
const profile = join(root, "p"), checkout = join(root, "repo"), nativeTemp = join(root, "t"), bin = join(root, "b"), socket = join(root, "h.sock");
for (const path of [profile, checkout, nativeTemp, bin]) await mkdir(path, { recursive: true, mode: 0o700 });
Object.assign(process.env, { HOME: root, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_SUBAGENTS_TEMP_ROOT: join(root, "native"), TMPDIR: nativeTemp, TMP: nativeTemp, TEMP: nativeTemp });
for (const key of ["PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SESSION_FILE", "PI_SESSION_ID", "PI_ASYNC_NATIVE_RUNNER", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete process.env[key];
await writeFile(join(profile, "settings.json"), JSON.stringify({ retry: { enabled: false } }), { mode: 0o600 });
const gitAt = async (cwd, ...args) => (await execute("git", ["-C", cwd, ...args])).stdout;
await gitAt(checkout, "init", "-q", "-b", "main");
await gitAt(checkout, "config", "user.name", "Native handoff fixture"); await gitAt(checkout, "config", "user.email", "handoff@example.invalid");
await writeFile(join(checkout, "tracked"), "base\n"); await gitAt(checkout, "add", "."); await gitAt(checkout, "commit", "-qm", "base");
const originalHead = (await gitAt(checkout, "rev-parse", "HEAD")).trim();
const run = async command => {
  try { const result = await execute("bash", ["-c", command]); return { kind: "finished", code: 0, output: result.stdout }; }
  catch (error) { if (typeof error.code === "number") return { kind: "finished", code: error.code, output: error.stdout + error.stderr }; throw error; }
};
const git = new GitWorkspace(checkout, run);
const herdr = createServer(); await new Promise(resolve => herdr.listen(socket, resolve));
const stat = await lstat(socket), ownerSession = "handoff-fixture-controller";
const local = { endpoint: socket, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}` };
const ownerWindow = { ...local, workspace: "fixture-w", tab: "fixture-owner-t", pane: "fixture-owner-p", terminal: "fixture-owner-term" };
const paneFile = join(root, "panes.json"), panes = {};
panes[ownerWindow.pane] = { workspace_id: ownerWindow.workspace, tab_id: ownerWindow.tab, pane_id: ownerWindow.pane, terminal_id: ownerWindow.terminal, foreground_cwd: checkout, agent: "pi", agent_session: { kind: "id", value: ownerSession } };
await save("panes.json", panes);
await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const a=process.argv.slice(2),p=JSON.parse(require('fs').readFileSync(${JSON.stringify(paneFile)},'utf8'));
if(a.join(' ')==='--version') console.log('0.9.1');
else if(a.join(' ')==='status server --json') console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));
else if(a[0]==='pane'&&a[1]==='get'&&p[a[2]]) console.log(JSON.stringify({result:{pane:p[a[2]]}}));
else if(a[0]==='pane'&&a[1]==='process-info'&&a[2]==='--pane'&&p[a[3]]) console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));
else {console.error('Unexpected fixture Herdr operation',a);process.exitCode=1;}
`, { mode: 0o700 });
Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: ownerWindow.pane });
const fork = join(prior.HOME, ".pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack");
const skillPaths = [join(project, ".agents/skills/handoff/SKILL.md"), join(project, "skills/herdr/SKILL.md"), ...["matt-tdd", "matt-teach", "implement", "code-review"].map(name => join(project, ".agents/skills", name, "SKILL.md"))];
for (const path of skillPaths) assert.ok(existsSync(path), path);
const authority = { owner: "", session: ownerSession, generation: 1, epoch: 0 };
const actors = new Map(), timeline = [], commands = [], errors = [], notices = [], effectMessages = [];
let sequence = 0, localHost, legion, handoffCalls = 0, networkCalls = 0, beforeDirty, predecessorId, successorId;
const mark = (type, data = {}) => { const event = { sequence: ++sequence, at: new Date().toISOString(), type, ...data }; timeline.push(event); appendFileSync(join(root, "timeline.jsonl"), JSON.stringify(event) + "\n"); return event; };
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { networkCalls++; throw new Error("No network authorized"); };
const artifactPath = join(nativeTemp, `handoff-${randomUUID()}.md`);
async function preserve(cwd) {
  const indexPath = (await gitAt(cwd, "rev-parse", "--git-path", "index")).trim();
  return { cwd, head: (await gitAt(cwd, "rev-parse", "HEAD")).trim(), branch: (await gitAt(cwd, "symbolic-ref", "HEAD")).trim(), index: sha256(await readFile(indexPath)), tracked: sha256(await readFile(join(cwd, "tracked"))), sentinel: sha256(await readFile(join(cwd, "sentinel"))), staged: await gitAt(cwd, "diff", "--cached", "--binary"), unstaged: await gitAt(cwd, "diff", "--binary"), worktrees: await gitAt(checkout, "worktree", "list", "--porcelain") };
}
function provider(actor) {
  return pi => {
    let call = 0;
    pi.registerProvider("handoff-local", { baseUrl: "http://fixture.invalid", apiKey: "not-a-credential", api: "handoff-local", models: ["retained", "future"].map(id => ({ id, name: id, reasoning: true, input: ["text"], contextWindow: 272000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
      streamSimple(model, context) {
        call++; assert.ok(call <= (actor.successor ? 4 : 6), "Unexpected inference/replay");
        mark("provider", { launch: actor.launch.id, session: actor.manager.getSessionId(), model: `${model.provider}/${model.id}`, call });
        let content = [{ type: "text", text: "Waiting for the bounded assignment." }];
        if (!actor.successor && call === 2) content = [{ type: "toolCall", id: "dirty-work", name: "bash", arguments: { command: "printf 'later committed progress\\n' > tracked && git add tracked && git commit -qm 'legitimate worker progress' && printf 'staged progress\\n' > tracked && git add tracked && printf 'unstaged progress\\n' > tracked && printf 'untracked sentinel\\n' > sentinel" } }];
        else if (!actor.successor && call === 5) {
          const user = context.messages.filter(message => message.role === "user").at(-1);
          assert.match(JSON.stringify(user), /<skill name=\\?"handoff/);
          content = [{ type: "toolCall", id: "handoff-artifact", name: "write", arguments: { path: artifactPath, content: [`# Continuation`, `Purpose: fresh context for the bounded label task.`, `Continue: finish the label without changing preserved work.`, `Worktree: ${actor.cwd}`, `Inspect Git history and tracked/index changes; preserve sentinel.`, `## Suggested skills`, `Read ${join(project, ".agents/skills/implement/SKILL.md")}.`, ""].join("\n") } }];
        } else if (!actor.successor && call === 6) content = [{ type: "text", text: `Handoff saved at ${artifactPath}` }];
        else if (actor.successor && call === 2) content = [{ type: "toolCall", id: "successor-first-read", name: "read", arguments: { path: artifactPath } }];
        else if (actor.successor && call === 3) {
          const read = context.messages.find(message => message.role === "toolResult" && message.toolCallId === "successor-first-read");
          assert.ok(read && !read.isError && JSON.stringify(read.content).includes("Suggested skills"), "Continuation requires actual successful exact-file read");
          content = [{ type: "toolCall", id: "successor-continuation", name: "write", arguments: { path: "continued", content: "Exact handoff read; bounded continuation complete.\n" } }];
        } else if (call > 1) content = [{ type: "text", text: actor.successor ? "Bounded continuation complete; not accepted." : "Ordinary work safely preserved; no children launched." }];
        const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content, stopReason: content[0].type === "toolCall" ? "toolUse" : "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        const stream = new AssistantMessageEventStream(); queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); }); return stream;
      }
    });
  };
}
const { default: nativeSubagents } = await import("pi-subagents");
const host = {
  createWindow: async input => {
    const { launch, cwd, workflowChoice, startupSelection } = input;
    if (launch.successor) {
      successorId = launch.id;
      assert.deepEqual(startupSelection, { kind: "exact", selection: { model: "handoff-local/retained", thinking: "high" } });
      assert.deepEqual(workflowChoice, { profile: "matt", requestedWorkflow: "implement" });
      const predecessor = actors.get(predecessorId);
      const observed = await localHost.observeHandoff({ worker: predecessor.worker, request: predecessor.request });
      assert.equal(observed.state.kind, "settled"); assert.equal(predecessor.openTools.size, 0); assert.equal(predecessor.settled, true);
      assert.deepEqual(await preserve(cwd), beforeDirty);
      mark("successor-authority-after-settlement", { predecessor: predecessorId, successor: launch.id, observation: observed });
    } else predecessorId = launch.id;
    const manager = SessionManager.create(cwd, join(root, "sessions"));
    const window = { ...local, workspace: "fixture-w", tab: `t-${actors.size}`, pane: `p-${actors.size}`, terminal: `term-${actors.size}` };
    panes[window.pane] = { workspace_id: window.workspace, tab_id: window.tab, pane_id: window.pane, terminal_id: window.terminal, foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: manager.getSessionId() } };
    await save("panes.json", panes);
    const launchRoot = join(profile, "legion/tribuni", launch.id); await mkdir(launchRoot, { recursive: true, mode: 0o700 });
    const bootstrap = join(launchRoot, "bootstrap.json");
    await writeFile(bootstrap, JSON.stringify({ launch, cwd, authority, workflowChoice, startupSelection, capability: randomUUID(), ownerProcess: { ...await identity(process.pid), window: ownerWindow } }), { mode: 0o600 });
    actors.set(launch.id, { launch, cwd, window, manager, bootstrap, successor: !!launch.successor, openTools: new Set(), settled: false });
    mark("controlled-window", { launch: launch.id, session: manager.getSessionId(), cwd, startupSelection, workflowChoice }); return window;
  },
  startPi: async ({ launch, startupSelection }) => {
    const actor = actors.get(launch.id), settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, defaultProvider: "handoff-local", defaultModel: actor.successor ? "future" : "retained", defaultThinkingLevel: "low" });
    const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false }); provider(actor)(modelRuntime);
    const capture = pi => {
      pi.on("before_agent_start", event => { mark("native-prompt", { launch: launch.id, promptKind: event.prompt?.startsWith("<skill name=\"handoff\"") ? "expanded-handoff" : event.prompt?.startsWith("Read the handoff file") ? "read-first-assignment" : event.prompt?.startsWith("Legion task-scoped safe stop") ? "safe-stop" : "ordinary", promptHash: sha256(event.prompt ?? "") }); });
      for (const type of ["agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end"]) pi.on(type, event => {
        if (type === "agent_start") actor.settled = false;
        if (type === "agent_settled") actor.settled = true;
        if (type === "tool_execution_start") actor.openTools.add(event.toolCallId);
        if (type === "tool_execution_end") actor.openTools.delete(event.toolCallId);
        mark(type, { launch: launch.id, session: actor.manager.getSessionId(), toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, durationMs: event.durationMs, path: event.args?.path });
      });
    };
    const worker = pi => installTribunus({ ...pi,
      // Only supplied-fork command provenance is controlled; ALL skills are native discoveries.
      getCommands: () => [...pi.getCommands(), { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } }],
      getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? { ...tool, sourceInfo: { path: subagentsEntry } } : tool),
      on: (name, handler) => pi.on(name, (event, ctx) => handler(event, { ...ctx, mode: "tui", isProjectTrusted: () => true })),
    }, actor.bootstrap);
    const loader = new DefaultResourceLoader({ cwd: actor.cwd, agentDir: profile, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalSkillPaths: skillPaths, extensionFactories: [provider(actor), nativeSubagents, capture, worker] });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    assert.equal(loader.getSkills().skills.filter(skill => skill.name === "handoff").length, 1);
    await save(`${launch.id}.discovery.json`, loader.getSkills());
    const selected = startupSelection.kind === "exact" ? startupSelection.selection : { model: "handoff-local/retained", thinking: "high" };
    process.env.HERDR_PANE_ID = actor.window.pane;
    try {
      const { session } = await createAgentSession({ cwd: actor.cwd, agentDir: profile, settingsManager, modelRuntime, resourceLoader: loader, sessionManager: actor.manager, model: modelRuntime.getModel(...selected.model.split("/")), thinkingLevel: selected.thinking, tools: ["read", "bash", "write", "subagent"] });
      actor.session = session; await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
      actor.hello = await json(join(dirname(actor.bootstrap), "hello.json"));
      mark("actual-sdk-identity", { launch: launch.id, hello: actor.hello, model: `${session.model.provider}/${session.model.id}`, thinking: session.thinkingLevel });
    } finally { process.env.HERDR_PANE_ID = ownerWindow.pane; }
  },
  inspectWorker: input => localHost.inspectWorker(input), initialize: input => localHost.initialize(input), assign: async input => {
    const actor = actors.get(input.worker.address.launch); actor.worker = input.worker; actor.assignment = input.assignment; actor.command = input.command;
    mark("ordinary-assignment", { launch: actor.launch.id, command: input.command, modelPin: input.assignment.modelPin, handoff: input.assignment.handoff });
    return localHost.assign(input);
  },
  watchEffects: (input, callback, unavailable) => localHost.watchEffects(input, async message => { effectMessages.push(message); mark("effect-message", { launch: input.worker.address.launch, kind: message.kind, id: message.id ?? message.intent?.id, state: message.state?.kind }); return callback(message); }, unavailable),
  watchReports: (...args) => localHost.watchReports(...args),
  stop: async (input, callback) => {
    mark("safe-stop-dispatch", { launch: input.worker.address.launch, shutdown: input.shutdown });
    await localHost.stop(input, callback);
    const actor = actors.get(input.worker.address.launch); await actor.session.waitForIdle();
    const path = join(dirname(actor.bootstrap), actor.hello.address.generation, `${input.shutdown}.park.json`);
    await until(() => existsSync(path), "actual safe-stop instruction and native park publication, not SDK idle alone");
    mark("native-park-published", { launch: actor.launch.id, retirement: await json(path) });
  },
  handoff: async input => { handoffCalls++; actors.get(input.worker.address.launch).request = input.request; const value = await localHost.handoff(input); mark("handoff-dispatch-receipt", { value }); throw new Error("Controlled loss of the actual native stage acknowledgement; observe same ID, never resend"); },
  observeHandoff: async input => { const value = await localHost.observeHandoff(input); mark("handoff-observation", { value }); return value; },
};
async function command(text, requestKey = randomUUID()) {
  const result = await legion.command({ text, requestKey, evidence: { origin: "host-command", transport: "source-unavailable", session: ownerSession, generation: null, presented: [] } }); commands.push({ text, requestKey, result }); return result;
}
try {
  legion = new Legion({ storagePath: join(root, "state"), context: checkout, session: ownerSession, preflight: async () => [], assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git }, tribuni: { host: () => host, onUnavailable: message => notices.push(message) }, resume: { repository: () => git, worker: () => ({ observeResources: async input => { const value = await localHost.observeResources(input); mark("native-resource-observation", { launch: input.launch.id, value }); return value; }, observeHandoff: input => localHost.observeHandoff(input) }) } });
  await legion.command({ text: "task Finish label", requestKey: "source", workflowInvocation: { kind: "native-skill", workflow: "implement" }, evidence: { origin: "host-command", transport: "source-unavailable", session: ownerSession, generation: null, presented: [] } });
  const snapshot = (await legion.state()).snapshot; assert.ok(snapshot); authority.owner = snapshot.id; authority.generation = snapshot.generation;
  localHost = new LocalTribunusHost(run, authority, message => notices.push(message));
  const source = snapshot.submissions[0];
  const interpreted = await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Finish label", acceptance: ["Read exact handoff before bounded continuation"], questions: [] }, evidence: { session: ownerSession, generation: snapshot.generation, legatus: snapshot.id, run: "fixture", sources: [{ id: source.id, revision: 1 }] } }); assert.equal(interpreted.kind, "applied");
  const task = (await legion.state()).tasks[0];
  await command(`reserve ${task.id}@1 --parent refs/heads/main`, "reserve");
  const reserved = await legion.command({ workspaceRequest: "reserve" }); assert.equal(reserved.kind, "reserved", JSON.stringify(reserved));
  await command(`launch ${task.id}@1`, "launch");
  const launched = await legion.command({ launchRequest: "launch" }); assert.equal(launched.kind, "launched", JSON.stringify(launched)); assert.equal(launched.launch.state.kind, "assigned", JSON.stringify(launched));
  const predecessor = actors.get(predecessorId); await predecessor.session.waitForIdle();
  await until(async () => (await legion.state()).tasks[0]?.launch.kind === "reported", "production ordinary result publication");
  beforeDirty = await preserve(predecessor.cwd); assert.notEqual(beforeDirty.head, originalHead); assert.ok(beforeDirty.staged && beforeDirty.unstaged);
  await save("dirty-before.json", { originalHead, ...beforeDirty });
  // Only fixture prospective defaults change. Existing observed pins remain authoritative.
  await mkdir(join(checkout, ".pi"), { recursive: true });
  await writeFile(join(checkout, ".pi/legion.json"), JSON.stringify({ tribuni_model: { model: "handoff-local/future", thinking: "low" } }));
  const requested = await command(`handoff ${task.id}@1 --purpose "Fresh context" --continue "Finish the label without changing preserved work"`); assert.equal(requested.kind, "handoff-stage", JSON.stringify(requested));
  const first = await legion.command({ handoffRequest: requested.requestId }); commands.push({ stage: "first", result: first }); assert.equal(first.kind, "rejected", JSON.stringify(first));
  assert.equal(handoffCalls, 1, JSON.stringify(first));
  await predecessor.session.waitForIdle();
  await until(() => existsSync(join(dirname(predecessor.bootstrap), predecessor.hello.address.generation, "handoff-observation.json")), "actual native handoff stage settlement publication");
  const stage = await host.observeHandoff({ worker: predecessor.worker, request: predecessor.request }); assert.equal(stage.state.kind, "settled", JSON.stringify(stage)); assert.equal(stage.state.receipt.artifact.path, artifactPath);
  const next = await legion.command({ handoffRequest: requested.requestId }); commands.push({ stage: "reconcile", result: next }); assert.equal(next.kind, "launched", JSON.stringify(next)); assert.equal(next.launch.state.kind, "assigned", JSON.stringify(next));
  const successor = actors.get(successorId); assert.ok(successor); await successor.session.waitForIdle();
  await until(async () => (await legion.state()).tasks[0]?.launch.kind === "reported", "successor real result publication");
  assert.equal(actors.size, 2); assert.equal(handoffCalls, 1); assert.notEqual(predecessor.hello.address.session, successor.hello.address.session); assert.notEqual(predecessor.hello.address.generation, successor.hello.address.generation);
  assert.equal(successor.cwd, predecessor.cwd); assert.deepEqual(successor.assignment.modelPin, predecessor.assignment.modelPin); assert.deepEqual(successor.assignment.workflowChoice, predecessor.assignment.workflowChoice);
  assert.deepEqual(await preserve(successor.cwd), beforeDirty);
  const entries = (await readFile(predecessor.hello.journal, "utf8")).trim().split("\n").map(JSON.parse);
  const expanded = entries.find(entry => entry.message?.role === "user" && JSON.stringify(entry.message.content).includes('<skill name=\\"handoff\\"'));
  assert.ok(expanded, "Actual persisted native skill expansion required");
  const successorEntries = (await readFile(successor.hello.journal, "utf8")).trim().split("\n").map(JSON.parse);
  const startup = successorEntries.find(entry => entry.message?.role === "user" && JSON.stringify(entry.message.content).includes("Read the handoff file at exactly")); assert.ok(startup); assert.ok(JSON.stringify(startup).includes(artifactPath));
  const firstTool = successorEntries.filter(entry => entry.message?.role === "assistant").flatMap(entry => entry.message.content.filter(part => part.type === "toolCall"))[0]; assert.equal(firstTool.name, "read"); assert.equal(firstTool.arguments.path, artifactPath);
  const read = successorEntries.find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === firstTool.id); assert.ok(read && !read.message.isError);
  const permission = timeline.find(event => event.type === "successor-authority-after-settlement");
  const artifactEnd = timeline.find(event => event.type === "tool_execution_end" && event.toolCallId === "handoff-artifact"); assert.ok(artifactEnd && !artifactEnd.isError && artifactEnd.durationMs !== undefined && artifactEnd.sequence < permission.sequence);
  const writers = timeline.filter(event => event.type === "tool_execution_start" && ["bash", "write", "edit"].includes(event.toolName));
  for (const writer of writers.filter(event => event.launch === predecessorId)) assert.ok(writer.sequence < permission.sequence);
  const open = new Set(); for (const event of timeline) { if (event.type === "tool_execution_start" && ["bash", "write", "edit"].includes(event.toolName)) { assert.equal(open.size, 0, "No overlapping worktree writers"); open.add(`${event.launch}:${event.toolCallId}`); } if (event.type === "tool_execution_end") open.delete(`${event.launch}:${event.toolCallId}`); } assert.equal(open.size, 0);
  const view = await legion.state();
  for (const actor of actors.values()) assert.equal((await readdir(join(dirname(actor.bootstrap), actor.hello.address.generation))).filter(name => name.endsWith(".centurio-intent.json")).length, 0);
  assert.ok(timeline.filter(event => event.type === "native-resource-observation").every(event => event.value.children.length === 0 && event.value.live.kind === "observed" && !event.value.live.value.childrenOutstanding && !event.value.live.value.childrenHeld));
  assert.ok(view.snapshot.effects.every(effect => effect.state.kind === "completed"));
  assert.equal(effectMessages.filter(message => message.kind === "effect-admission").length, 2, "Only ordinary dirty work and successor continuation use ordinary effect storage");
  assert.ok(!JSON.stringify(view.snapshot.effects).includes(artifactPath), "Artifact is not copied into ordinary effects");
  assert.deepEqual(errors, []); assert.equal(networkCalls, 0); assert.deepEqual(await readFile(settingsPath), hostSettings);
  await save("dirty-after.json", await preserve(successor.cwd)); await save("commands.json", commands); await save("state.json", view);
  const result = { result: "bounded-native-handoff-passed", root, artifact: stage.state.receipt.artifact, predecessor: predecessor.hello, successor: successor.hello, modelPin: successor.assignment.modelPin, workflowChoice: successor.assignment.workflowChoice, request: requested.requestId, handoffCalls, firstRead: `${successor.hello.journal}#${read.id}`, expandedSkill: `${predecessor.hello.journal}#${expanded.id}`, startup: `${successor.hello.journal}#${startup.id}`, writerCalls: writers.map(event => ({ sequence: event.sequence, launch: event.launch, toolCallId: event.toolCallId })), tabsCreated: 0, networkCalls, errors, notices };
  await save("result.json", result); console.log(JSON.stringify(result, null, 2));
} catch (error) { await save("failure.json", { error: String(error), stack: error.stack, commands, errors, notices, actors: [...actors.values()].map(actor => ({ launch: actor.launch.id, hello: actor.hello, openTools: [...actor.openTools], settled: actor.settled })) }); throw error; }
finally {
  const cleanup = [];
  for (const actor of actors.values()) if (actor.session) { await actor.session.waitForIdle(); assert.equal(actor.openTools.size, 0); await actor.session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); actor.session.dispose(); if (actor.hello) await until(() => !existsSync(actor.hello.endpoint), "exact generation socket closure"); cleanup.push({ launch: actor.launch.id, session: actor.manager.getSessionId(), idleDisposed: true, openTools: actor.openTools.size, socketClosed: !actor.hello || !existsSync(actor.hello.endpoint) }); }
  await new Promise(resolve => herdr.close(resolve));
  await save("cleanup.json", { actors: cleanup, controlledSocketClosed: true, tabsClosed: [], tabsRetained: [], runtimeRetained: root, commandScratch: scratch, artifactRetained: existsSync(artifactPath) ? artifactPath : null });
  globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]; Object.assign(process.env, prior);
  console.error(`Retained #36 runtime and actual TMPDIR artifact: ${root}`);
}
