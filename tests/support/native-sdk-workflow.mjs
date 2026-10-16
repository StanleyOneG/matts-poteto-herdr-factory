import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import legion from "../../src/extension.ts";

// Actual SDK/input/journal ordering with scripted zero-network inference. Discovery/Herdr are controlled boundaries, not native target evidence.
const scenario = process.argv[2] ?? "entry";
const root = mkdtempSync(join(tmpdir(), "legion-native-sdk-workflow-"));
const profile = join(root, "profile"), cwd = join(root, "checkout"), bin = join(root, "bin");
for (const directory of [profile, cwd, bin]) mkdirSync(directory);
const workspaceScenario = scenario === "workspace" || scenario === "deferred-guidance";
const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
if (workspaceScenario) {
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  git("commit", "--allow-empty", "-m", "Workspace fixture parent");
}
const initialWorktrees = workspaceScenario ? git("worktree", "list", "--porcelain") : null;
const initialBranches = workspaceScenario ? git("for-each-ref", "refs/heads") : null;
const socket = join(root, "herdr.sock"), server = createServer();
await new Promise(resolve => server.listen(socket, resolve));
writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nconsole.log(process.argv.includes('--version')?'0.9.1':JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));\n`, { mode: 0o700 });
const prior = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD };
process.env.PATH = `${bin}:${prior.PATH}`; process.env.PI_CODING_AGENT_DIR = profile; delete process.env.PI_SUBAGENT_CHILD;
const { default: nativeSubagents } = await import("pi-subagents");
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const fork = "/home/vscode/.pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack";
const skillPaths = ["implement", "implement-spec"].map(name => fileURLToPath(new URL(`../../.agents/skills/${name}/SKILL.md`, import.meta.url)));
const discovery = [
  { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } },
  ...["herdr", "poteto-mode", "matt-tdd", "matt-teach", "handoff", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: name === "poteto-mode" ? join(fork, "skills/poteto-mode/SKILL.md") : `/controlled/${name}/SKILL.md` } })),
];
const notices = [], errors = [], requests = [], starts = [], bashCalls = [];
let phase = 0, customTurn, workspaceKey, stageId, initialClaim, prematureDenied = false, wrongIdDenied = false;
const textContent = message => typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
const lastResult = ({ context, name }) => {
  const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === name);
  assert.ok(result, `Expected a public ${name} result`);
  return result;
};
function unchangedWorkspace() {
  assert.equal(bashCalls.length, 0, "Rejected workspace calls must not enter nested Bash");
  assert.equal(git("worktree", "list", "--porcelain"), initialWorktrees);
  assert.equal(git("for-each-ref", "refs/heads"), initialBranches);
  assert.equal(existsSync(join(root, "worktrees-checkout_legion")), false);
}
function workspaceStep({ context, step }) {
  const call = ({ name, arguments: args }) => ({ type: "toolCall", id: randomUUID(), name, arguments: args });
  const status = () => call({ name: "legion_status", arguments: { command: "status", details: true } });
  const statusView = () => JSON.parse(textContent(lastResult({ context, name: "legion_status" })).split("\nState\n")[1]);
  switch (step) {
    case 2: return status();
    case 3: {
      const task = statusView().tasks[0]; assert.ok(task);
      assert.deepEqual(task.claim, { kind: "unavailable", message: "Repository observation requires guarded workspace execution." });
      initialClaim = task.claim;
      return call({ name: "legion_request", arguments: { command: `reserve ${task.id}@1 --parent refs/heads/main` } });
    }
    case 4: {
      const deferred = JSON.parse(textContent(lastResult({ context, name: "legion_request" })));
      assert.equal(deferred.kind, "deferred");
      workspaceKey = deferred.receipt.requestKey; assert.ok(workspaceKey);
      unchangedWorkspace();
      return call({ name: "legion_workspace", arguments: { requestId: workspaceKey } });
    }
    case 5: {
      const denied = lastResult({ context, name: "legion_workspace" });
      assert.equal(denied.isError, true); assert.match(textContent(denied), /No correlated host-authorized workspace stage is active/);
      unchangedWorkspace(); prematureDenied = true;
      return status();
    }
    case 6: {
      const view = statusView();
      assert.deepEqual(view.tasks[0].claim, initialClaim);
      assert.equal(view.snapshot.workspaceRequests.length, 1);
      assert.equal(view.snapshot.workspaceRequests[0].id, workspaceKey);
      return call({ name: "legion_request", arguments: { command: `workspace ${workspaceKey}` } });
    }
    case 7: {
      const stage = JSON.parse(textContent(lastResult({ context, name: "legion_request" })));
      assert.equal(stage.kind, "workspace-stage"); assert.equal(stage.requestId, workspaceKey);
      stageId = stage.requestId;
      return call({ name: "legion_workspace", arguments: { requestId: "foreign-request" } });
    }
    case 8: {
      const denied = lastResult({ context, name: "legion_workspace" });
      assert.equal(denied.isError, true); assert.match(textContent(denied), /only its exact correlated root tool/);
      unchangedWorkspace(); wrongIdDenied = true;
      return status();
    }
    case 9:
      assert.deepEqual(statusView().tasks[0].claim, initialClaim);
      return call({ name: "legion_workspace", arguments: { requestId: stageId } });
    case 10: {
      const result = lastResult({ context, name: "legion_workspace" });
      assert.equal(result.isError, false);
      const reserved = JSON.parse(textContent(result));
      assert.equal(reserved.kind, "reserved"); assert.equal(reserved.workspace.kind, "ready");
      assert.ok(existsSync(join(reserved.receipt.reservation.plan.path, ".git")), "Execution creates a real isolated Git worktree");
      assert.ok(bashCalls.length > 0, "Execution uses ordinary SDK nested Bash");
      assert.ok(bashCalls.every(event => event.parentToolCallId === result.toolCallId), "Every Bash call is correlated with the exact workspace invocation");
      return call({ name: "write", arguments: { path: "denied-canary.txt", content: "Must remain denied" } });
    }
    default: return null;
  }
}
const provider = pi => pi.registerProvider("legion-workflow-fixture", {
  baseUrl: "http://fixture.invalid", apiKey: "disposable-not-a-credential", api: "legion-workflow-fixture",
  models: [{ id: "principal", name: "zero-network principal", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 1024 }],
  streamSimple(model, context) {
    requests.push(context);
    const stream = new AssistantMessageEventStream();
    const native = context.messages.findLast(message => message.role === "user" && (typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n")).includes('<skill name="implement-spec"'));
    const latest = context.messages.at(-1);
    const data = context.messages.findLast(message => (typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n")).includes("Exact saved sources and current state\n"));
    let content = [{ type: "text", text: "Ordinary native completion." }], stopReason = "stop";
    if (native && data && !JSON.stringify(latest.content).includes("Ordinary child completion fixture")) {
      const text = typeof data.content === "string" ? data.content : data.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      const parsed = JSON.parse(text.split("Exact saved sources and current state\n")[1]);
      if (phase++ === 0) { content = [{ type: "toolCall", id: randomUUID(), name: "legion_intake", arguments: { kind: "new-task", source: parsed.sources[0], goal: "SDK scoped approved task", acceptance: ["Exact native entry"], questions: [] } }]; stopReason = "toolUse"; }
      else if (workspaceScenario) {
        const call = workspaceStep({ context, step: phase });
        if (call) { content = [call]; stopReason = "toolUse"; }
      }
      else if (phase === 2) { content = [{ type: "toolCall", id: randomUUID(), name: "write", arguments: { path: "denied-canary.txt", content: "Must remain denied" } }]; stopReason = "toolUse"; }
    }
    const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content, stopReason, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: stopReason, message }); stream.end(); });
    return stream;
  },
});
const capture = pi => {
  customTurn = () => pi.sendMessage({ customType: "subagent-update", content: "Ordinary child completion fixture", display: true }, { triggerTurn: true });
  pi.on("session_start", (_event, ctx) => { ctx.ui.notify = message => notices.push(message); });
  pi.on("before_agent_start", (event, ctx) => { starts.push({ messageType: event.messageType, busy: !ctx.isIdle(), prompt: event.messageType === "user" ? event.prompt : null }); });
  pi.on("tool_call", event => {
    if (event.toolName === "bash") bashCalls.push(event);
    if (event.toolName === "write") return { block: true, reason: "Ordinary SDK workflow permission denial" };
  });
};
const controlledLegion = pi => legion({ ...pi,
  getCommands: () => [...pi.getCommands(), ...discovery],
  getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? { ...tool, sourceInfo: { path: subagentsEntry } } : tool),
});
let session;
async function state() {
  await session.prompt("/legion status --details");
  const notice = notices.at(-1);
  return JSON.parse(notice.split("\nState\n")[1]);
}
try {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  provider(modelRuntime);
  const model = modelRuntime.getModel("legion-workflow-fixture", "principal"); assert.ok(model);
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings, noSkills: true, additionalSkillPaths: skillPaths, noPromptTemplates: true, noThemes: true, extensionFactories: [provider, nativeSubagents, capture, controlledLegion] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd, agentDir: profile, settingsManager: settings, modelRuntime, model, resourceLoader: loader }));
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  await session.prompt("/implement Inactive ordinary skill");
  await session.waitForIdle();
  assert.equal((await state()).snapshot, null, "Alias cannot activate inactive Legion");
  await session.prompt("/legion on");
  assert.equal((await state()).mode, "active", JSON.stringify(notices));
  const exact = " Follow approved spec\nexactly  ";
  await session.prompt(`/skill:implement-spec ${exact}`);
  const deadline = Date.now() + 10000;
  let view;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
    view = await state();
    if (view.tasks.length === 1) { await session.waitForIdle(); break; }
  }
  assert.equal(view.tasks.length, 1, JSON.stringify({ view, notices: notices.filter(notice => !notice.includes("State\n")), errors }));
  assert.equal(view.snapshot.submissions[0].workflowDispatch.kind, "applied-native");
  const delivery = view.snapshot.submissions[0].workflowDispatch;
  assert.ok(delivery.prompt.endsWith(exact));
  const journal = readFileSync(delivery.journal, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(journal.some(entry => entry.id === delivery.entry && entry.message?.role === "user" && entry.message.content[0].text === delivery.prompt));
  assert.deepEqual(session.messages.filter(message => message.role === "assistant" && message.stopReason === "error").map(message => message.errorMessage), [], "Scripted SDK provider must complete without fixture errors");
  assert.ok(session.messages.some(message => message.role === "toolResult" && message.toolName === "write" && message.isError));
  assert.equal(existsSync(join(cwd, "denied-canary.txt")), false);
  if (workspaceScenario) {
    view = await state();
    assert.equal(prematureDenied, true); assert.equal(wrongIdDenied, true);
    assert.equal(view.tasks[0].claim.kind, "owned");
    assert.equal(view.tasks[0].claim.workspace.kind, "ready");
    assert.equal(view.snapshot.launchRequests.length, 0, "Workspace execution never launches a worker");
  }
  customTurn(); await session.waitForIdle();
  assert.ok(starts.some(start => start.messageType === "custom" && start.busy));
  assert.ok(starts.some(start => start.messageType === "user" && start.busy && start.prompt === delivery.prompt));
  assert.equal(session.getLastAssistantText(), "Ordinary native completion.");
  assert.deepEqual(errors, []);
  if (scenario === "deferred-guidance") {
    const deferred = session.messages.filter(message => message.role === "toolResult" && message.toolName === "legion_request").map(message => JSON.parse(textContent(message))).find(result => result.kind === "deferred");
    assert.ok(deferred);
    assert.match(deferred.receipt.message, /deferred[^.]*not[^.]*execut(?:able|ion)/i);
    assert.match(deferred.receipt.message, /legion_request[^\n]*workspace/, "Native callers need an explicit workspace authorization command");
    assert.ok(deferred.receipt.message.includes(`workspace ${workspaceKey}`), "Guidance must name the actual saved request key");
    assert.match(deferred.receipt.message, /workspace-stage[^.]*legion_workspace[^.]*requestId/);
    assert.match(deferred.receipt.message, /\/legion workspace/, "Host slash-command guidance remains available");
  }
  if (scenario === "guidance") {
    const nativeContext = requests.find(context => context.messages.some(message => message.role === "system" && JSON.stringify(message).includes("intake-only interpreter")));
    assert.ok(nativeContext, "Inspect the instructions actually delivered to the native workflow");
    const systemMessages = nativeContext.messages.filter(message => message.role === "system");
    const instructions = systemMessages.map(message => [typeof message.content === "string" ? message.content : message.content.map(part => part.text).join("\n"), ...Object.values(message.sections ?? {})].join("\n")).join("\n");
    assert.match(instructions, /deferred[^.]*not[^.]*execut(?:able|ion)/i, "Deferred intent must not be presented as executable authority");
    assert.match(instructions, /legion_request[^\n]*workspace[^\n]*receipt\.requestKey/, "Native instructions must name the intermediate workspace authorization request");
    assert.match(instructions, /workspace-stage[^.]*legion_workspace[^.]*requestId/, "Execution must follow a workspace-stage response with its exact requestId");
    const tools = systemMessages.flatMap(message => message.toolsAdded ?? []);
    const requestTool = tools.findLast(tool => tool.name === "legion_request");
    const workspaceTool = tools.findLast(tool => tool.name === "legion_workspace");
    assert.ok(requestTool); assert.ok(workspaceTool);
    assert.match(requestTool.description, /deferred[^.]*workspace[^.]*workspace-stage/i, "Request tool must distinguish saved intent from stage preparation");
    assert.match(workspaceTool.description, /workspace-stage[^.]*requestId/, "Executor description must require the explicitly prepared stage identity");
    assert.match(workspaceTool.description, /\/legion workspace/, "Native guidance must not exclude the supported host authorization alternative");
  }
  console.log(JSON.stringify({ root, pi: VERSION, networkCalls: 0, tasks: view.tasks.length, dispatch: delivery.kind, exactInstructions: delivery.prompt.endsWith(exact), appliedJournal: true, permissionDenied: true, customCompletion: true, ...(workspaceScenario ? { prematureDenied, wrongIdDenied, workspace: "ready", nestedBash: bashCalls.length } : {}), errors }));
} finally {
  if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); session.dispose(); }
  await new Promise(resolve => server.close(resolve));
  for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
