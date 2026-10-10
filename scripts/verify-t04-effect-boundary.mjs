import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createWriteToolDefinition, createBashToolDefinition, createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, validateToolArguments } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";

const root = mkdtempSync(join(tmpdir(), "legion-effect-boundary-"));
const reference = getModel("anthropic", "claude-sonnet-4-5");
assert.ok(reference);
const model = { ...reference, provider: "legion-boundary-fixture", api: "legion-boundary-fixture", id: "controlled", baseUrl: "http://invalid.localhost" };
globalThis.fetch = async () => { throw new Error("Network is forbidden in this controlled adapter trial"); };
const results = [];
for (const name of ["allow", "mutate", "deny", "mutate-deny", "throw", "mutate-throw", "shell-settings", "inactive", "edit-canonical", "edit-legacy", "edit-string", "edit-object", "edit-legacy-deny", "edit-legacy-mutate"]) {
  const cwd = join(root, name), agentDir = join(cwd, "agent");
  mkdirSync(agentDir, { recursive: true });
  const path = join(cwd, "effect.txt"), redirected = join(cwd, "redirected.txt");
  const toolName = name === "shell-settings" ? "bash" : name.startsWith("edit-") ? "edit" : "write";
  const replacement = { oldText: "Before", newText: "After" };
  const intended = toolName === "bash" ? { command: 'printf "%s/%s" "$BOUNDARY_PREFIX" "$PI_SESSION_ID" > effect.txt' } : toolName === "edit"
    ? name.startsWith("edit-legacy") ? { path, ...replacement } : { path, edits: name === "edit-string" ? JSON.stringify([replacement]) : name === "edit-object" ? replacement : [replacement] }
    : { path, content: "approved bytes" };
  if (toolName === "edit") writeFileSync(path, "Before");
  const trace = [], captured = new Map();
  let native, provenance;
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, shellPath: "/bin/bash", shellCommandPrefix: "export BOUNDARY_PREFIX=retained" });
  let turns = 0;
  const streamSimple = () => {
    const stream = createAssistantMessageEventStream();
    const first = turns++ === 0;
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: first ? [{ type: "toolCall", id: `boundary-${name}`, name: toolName, arguments: structuredClone(intended) }] : [{ type: "text", text: "Trial complete." }], stopReason: first ? "toolUse" : "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: message.stopReason, message });
    stream.end();
    return stream;
  };
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [pi => {
      pi.registerProvider(model.provider, { api: model.api, apiKey: "fixture", models: [model], streamSimple });
      pi.on("session_start", () => {
        const original = pi.getAllTools().find(tool => tool.name === toolName);
        assert.equal(original?.sourceInfo.path, `builtin:${toolName}`);
        const configured = pi.getSettings();
        native = toolName === "bash" ? createBashToolDefinition(cwd, { shellPath: configured.shellPath, commandPrefix: configured.shellCommandPrefix }) : toolName === "edit" ? createEditToolDefinition(cwd) : createWriteToolDefinition(cwd);
        pi.registerTool({ ...native, execute: async (id, args, signal, update, ctx) => {
          trace.push("final-execute");
          if (!isDeepStrictEqual(args, captured.get(id))) throw new Error("Exact final input differs from admitted intent");
          trace.push("native-execute");
          return native.execute(id, structuredClone(args), signal, update, ctx);
        } });
      });
      pi.on("tool_call", (event, ctx) => {
        trace.push("capture");
        const journal = readFileSync(ctx.sessionManager.getSessionFile(), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
        const entry = journal.find(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall" && part.id === event.toolCallId));
        const call = entry.message.content.find(part => part.type === "toolCall" && part.id === event.toolCallId);
        assert.deepEqual(call.arguments, intended);
        const raw = structuredClone(call.arguments);
        const prepared = native.prepareArguments ? native.prepareArguments(raw) : raw;
        const validated = validateToolArguments(native, { ...call, arguments: prepared });
        assert.deepEqual(event.input, validated);
        if (toolName === "edit") assert.deepEqual(validated, { path, edits: [{ oldText: "Before", newText: "After" }] });
        provenance = { entry: `${ctx.sessionManager.getSessionFile()}#${entry.id}`, raw: call.arguments, prepared: structuredClone(validated), active: ctx.sessionManager.getBranch().find(current => current.id === entry.id)?.message };
        captured.set(event.toolCallId, structuredClone(validated));
      });
    }, pi => {
      pi.on("tool_call", event => {
        trace.push("permission-hook");
        if (name.startsWith("mutate")) event.input.path = redirected;
        if (name === "edit-legacy-mutate") event.input.edits[0].newText = "Changed by later hook";
        if (name.endsWith("deny")) return { block: true, reason: "Controlled permission denial" };
        if (name.endsWith("throw")) throw new Error("Controlled permission failure");
      });
    }] });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const { session } = await createAgentSession({ cwd, agentDir, model, modelRuntime, settingsManager: settings, resourceLoader, tools: name === "inactive" ? ["read"] : [toolName], sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });

  try {
    await session.bindExtensions({});
    if (name === "inactive") {
      assert.equal(session.getActiveToolNames().includes(toolName), false, "Wrapping an inactive builtin must not activate it");
      results.push({ name, activeTools: session.getActiveToolNames(), effect: existsSync(path) });
      continue;
    }
    await session.prompt("Run the one controlled boundary call.");
    const result = session.messages.find(message => message.role === "toolResult");
    assert.ok(result);
    const allowed = ["allow", "shell-settings", "edit-canonical", "edit-legacy", "edit-string", "edit-object"].includes(name);
    assert.equal(result.isError, !allowed);
    assert.equal(existsSync(path), allowed || toolName === "edit");
    assert.equal(existsSync(redirected), false);
    assert.deepEqual(trace, name === "mutate" || name === "edit-legacy-mutate" || allowed ? ["capture", "permission-hook", "final-execute", ...(allowed ? ["native-execute"] : [])] : ["capture", "permission-hook"]);
    if (allowed) assert.equal(readFileSync(path, "utf8"), toolName === "edit" ? "After" : name === "allow" ? "approved bytes" : `retained/${session.sessionManager.getSessionId()}`);
    if (toolName === "edit" && !allowed) assert.equal(readFileSync(path, "utf8"), "Before");
    results.push({ name, trace, isError: result.isError, result: result.content, provenance, journal: session.sessionManager.getSessionFile(), effect: existsSync(path) ? readFileSync(path, "utf8") : null });
  } finally { session.dispose(); }
}
writeFileSync(join(root, "results.json"), JSON.stringify({ root, scope: "Installed ordinary AgentSession tool pipeline with a controlled external model. Not managed admission or live issue acceptance.", results }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ verdict: "BOUNDARY_TRIAL_PASS", root, cases: results.map(result => ({ name: result.name, trace: result.trace, isError: result.isError })) }, null, 2) + "\n");
