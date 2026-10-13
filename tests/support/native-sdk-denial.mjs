import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import legion from "../../src/extension.ts";
import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "pi-subagents/delegation";

const piManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")), "utf8"));
const subagentsManifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.resolve("pi-subagents")), "utf8"));
assert.equal(VERSION, piManifest.version, "Current SDK code and runtime metadata must match");

// Disposable supported SDK composition. The scripted stream has no network/provider calls.
const root = mkdtempSync(join(tmpdir(), "legion-native-sdk-denial-"));
const profile = join(root, "agent"), cwd = join(root, "checkout");
mkdirSync(profile); mkdirSync(cwd); mkdirSync(join(profile, "extensions", "subagent"), { recursive: true });
writeFileSync(join(profile, "extensions", "subagent", "config.json"), JSON.stringify({ permissions: { rules: { write: "deny" } }, fleetView: false, asyncWidget: false }));
const prior = process.env.PI_CODING_AGENT_DIR, priorChild = process.env.PI_SUBAGENT_CHILD;
delete process.env.PI_SUBAGENT_CHILD;
const { default: nativeSubagents } = await import("pi-subagents");
process.env.PI_CODING_AGENT_DIR = profile;
const messages = [], errors = [], childModelRequests = [], rootEnds = [], beforeStarts = [];
let response, customTurn;
const settings = SettingsManager.inMemory({ defaultProvider: "legion-fixture", defaultModel: "fixture-8k", subagents: { agentOverrides: { worker: { tools: ["write", "read"], inheritSkills: false, extensions: [], acceptanceRole: false } } }, compaction: { enabled: false }, retry: { enabled: false } });
const provider = pi => pi.registerProvider("legion-fixture", {
  baseUrl: "http://fixture.invalid", apiKey: "disposable-not-a-credential", api: "legion-fixture",
  models: [{ id: "fixture-8k", name: "provider-free fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1024 }],
  streamSimple(model, context) {
    const stream = new AssistantMessageEventStream();
    const result = context.messages.find(message => message.role === "toolResult");
    const child = context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("Native child denial fixture"));
    if (child) childModelRequests.push({ provider: model.provider, id: model.id, contextWindow: model.contextWindow });
    if (result) messages.push({ child, isError: result.isError, content: result.content });
    const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: result ? [{ type: "text", text: "Native denial observed; no write performed." }] : [{ type: "toolCall", id: randomUUID(), name: "write", arguments: { path: child ? "child-canary.txt" : "root-canary.txt", content: "Must not be written" } }], stopReason: result ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
    return stream;
  },
});
const harness = pi => {
  customTurn = () => pi.sendMessage({ customType: "fixture-current-sdk", content: "Observe an ordinary custom-triggered turn.", display: false }, { triggerTurn: true });
  pi.on("before_agent_start", (event, ctx) => { beforeStarts.push({ messageType: event.messageType, idle: ctx.isIdle() }); });
  pi.on("tool_call", event => event.toolName === "write" ? { block: true, reason: "Ordinary root fixture permission denial" } : undefined);
  pi.on("tool_execution_end", event => rootEnds.push({ name: event.toolName, isError: event.isError, durationMs: event.durationMs }));
  pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, value => { response = value; });
  pi.registerCommand("native-denial", { description: "Disposable native delegation denial check", handler: async (_args, ctx) => {
    pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, { requestId: randomUUID(), ownerRunId: "fixture-owned-run", nodeId: "native-child", agent: "worker", task: "Native child denial fixture: attempt the configured write then report its native refusal.", context: "fresh", cwd, artifacts: true, intercomBridge: { mode: "off" }, result: { kind: "text" } });
    const deadline = Date.now() + 30000;
    while (!response && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(response, "Supported native delegation must return its exact terminal response");
  } });
};
let session;
try {
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  provider(modelRuntime);
  const model = modelRuntime.getModel("legion-fixture", "fixture-8k");
  assert.ok(model);
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings, extensionFactories: [provider, nativeSubagents, legion, harness], noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, [], "Native fixture composition must load without setup errors");
  ({ session } = await createAgentSession({ cwd, agentDir: profile, resourceLoader: loader, settingsManager: settings, modelRuntime, model }));
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  await session.prompt("Root native denial fixture");
  assert.ok(customTurn);
  customTurn();
  await session.waitForIdle();
  const userStartupBusy = beforeStarts.some(event => event.messageType === "user" && event.idle === false);
  const customStartupBusy = beforeStarts.some(event => event.messageType === "custom" && event.idle === false);
  assert.equal(userStartupBusy, true);
  assert.equal(customStartupBusy, true);

  await session.prompt("/native-denial");
  assert.equal(existsSync(join(cwd, "root-canary.txt")), false);
  assert.equal(existsSync(join(cwd, "child-canary.txt")), false);
  assert.ok(rootEnds.some(event => event.name === "write" && event.isError && event.durationMs === undefined), "Actual SDK refusal reports no execute duration");
  assert.ok(messages.some(message => message.child && message.isError && JSON.stringify(message.content).includes("denied")), JSON.stringify({ response, messages, errors }));
  assert.ok(childModelRequests.length > 0);
  assert.ok(childModelRequests.every(model => model.contextWindow === 8000), "No Legion 272k child minimum");
  assert.ok(response.runId);
  const report = { root, pi: piManifest.version, subagents: subagentsManifest.version, networkCalls: 0, userStartupBusy, customStartupBusy, beforeStarts, rootRefused: true, childRefused: true, rootCanary: false, childCanary: false, childModelRequests, nativeResponse: response, nativeToolResults: messages, errors };
  writeFileSync(join(root, "evidence.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); session.dispose(); }
  if (priorChild === undefined) delete process.env.PI_SUBAGENT_CHILD; else process.env.PI_SUBAGENT_CHILD = priorChild;
  if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prior;
}
