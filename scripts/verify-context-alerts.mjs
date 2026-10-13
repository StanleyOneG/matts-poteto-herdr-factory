import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import legion from "../src/extension.ts";

// Run in a fresh shell-owned disk-backed TMPDIR; never use the live agent profile.
assert.equal(VERSION, "1.2.0");
const temp = await realpath(process.env.TMPDIR ?? "");
const base = await realpath("/workspaces/astraprojects/.tmp");
assert.ok(temp.startsWith(base + sep), "A unique owned disk-backed TMPDIR is required");
assert.equal(process.env.TMP, process.env.TMPDIR);
assert.equal(process.env.TEMP, process.env.TMPDIR);
const root = await mkdtemp(join(temp, "context-"));
const profile = join(root, "profile"), cwd = join(root, "checkout"), bin = join(root, "bin");
const prior = Object.fromEntries(["PATH", "HOME", "PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "PI_OFFLINE"].map(key => [key, process.env[key]]));
const hostSettings = join(homedir(), ".pi/agent/settings.json");
const hostBefore = await readFile(hostSettings);
for (const path of [profile, cwd, bin, join(cwd, ".pi")]) await mkdir(path, { recursive: true });
await writeFile(join(cwd, ".pi/legion.json"), JSON.stringify({ context: { warningTokens: 100, escalationTokens: 200 } }));
// Only prerequisite discovery is controlled. No Herdr actor or native child is launched.
await writeFile(join(bin, "herdr"), `#!/usr/bin/env node\nconsole.log(process.argv.includes('--version')?'0.9.1':JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(join(root, "fixture.sock"))}}));\n`, { mode: 0o700 });
const fork = resolve(process.env.PI_TEST_PSTACK ?? join(homedir(), ".pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack"));
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const discovery = [
  { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } },
  ...["herdr", "poteto-mode", "matt-tdd", "matt-teach", "handoff", "code-review", "implement", "implement-spec"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: name === "poteto-mode" ? join(fork, "skills/poteto-mode/SKILL.md") : `/controlled/${name}/SKILL.md` } })),
];
process.env.PATH = `${bin}:${prior.PATH}`;
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = profile;
process.env.PI_OFFLINE = "1";
delete process.env.PI_SUBAGENT_CHILD;
const notices = [], statuses = [], errors = [], requests = [], samples = [], deliveries = [], timeline = [];
let session, calls = 0, networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("Native context fixture forbids network requests"); };
const provider = pi => pi.registerProvider("context-fixture", {
  baseUrl: "http://fixture.invalid", apiKey: "disposable-not-a-credential", api: "context-fixture",
  models: [{ id: "principal", name: "deterministic local principal", reasoning: false, input: ["text"], contextWindow: 272000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  streamSimple(model, context) {
    const call = ++calls;
    requests.push(structuredClone(context)); timeline.push(`request:${call}`);
    assert.ok(call <= 7, "Unexpected extra inference (possible telemetry turn)");
    const tool = call === 2 ? "effect_one" : call === 3 ? "effect_two" : null;
    const content = tool ? [{ type: "toolCall", id: `call_${call}`, name: tool, arguments: {} }] : [{ type: "text", text: call >= 6 ? "## Goal\nFixture checkpoint\n## Progress\nTwo local effects complete." : "Fixture response." }];
    const stopReason = tool ? "toolUse" : "stop";
    const input = call === 1 ? 10 : 300;
    const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content, stopReason, usage: { input, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: input + 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = new AssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: stopReason, message }); stream.end(); });
    return stream;
  },
});
const fixture = pi => {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify = (message, level) => notices.push({ message, level });
    ctx.ui.setStatus = (key, text) => statuses.push({ key, text });
  });
  pi.registerCommand("fixture-response", { handler: () => pi.sendUserMessage("Local deterministic fixture response") });
  for (const name of ["effect_one", "effect_two"]) pi.registerTool({ name, label: name, description: "Local fixture effect", parameters: Type.Object({}), execute: async () => {
    await writeFile(join(root, name), "complete"); timeline.push(name);
    return { content: [{ type: "text", text: `${name} complete` }], details: undefined };
  } });
  pi.on("turn_end", (_event, ctx) => { samples.push(ctx.getContextUsage()); });
};
const observedLegion = pi => legion({ ...pi,
  getCommands: () => [...pi.getCommands(), ...discovery],
  getAllTools: () => [...pi.getAllTools(), { name: "subagent", exposure: "direct", sourceInfo: { path: subagentsEntry } }],
  sendMessage: (message, options) => { deliveries.push({ message, options }); timeline.push(`advisory:${message.details?.level}`); pi.sendMessage(message, options); },
});
async function state() {
  await session.prompt("/legion status");
  const text = notices.at(-1)?.message;
  assert.ok(text?.includes("State\n"), JSON.stringify({ notices, errors }));
  return JSON.parse(text.split("State\n")[1].split("\n")[0]);
}
const containsAdvisory = context => JSON.stringify(context.messages).includes("Advisory context escalation");
try {
  // A tiny retained tail permits real default summarization without a large-context trial.
  const settings = SettingsManager.inMemory({ compaction: { enabled: true, keepRecentTokens: 1 }, retry: { enabled: false } });
  const compactionBefore = settings.getCompactionSettings();
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  provider(modelRuntime);
  const model = modelRuntime.getModel("context-fixture", "principal"); assert.ok(model);
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [provider, fixture, observedLegion] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd, agentDir: profile, settingsManager: settings, modelRuntime, model, thinkingLevel: "off", tools: ["effect_one", "effect_two"], resourceLoader: loader }));
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  await session.prompt("/legion on");
  assert.equal((await state()).mode, "active", JSON.stringify(notices));
  assert.equal(calls, 0);
  await session.prompt("/fixture-response"); await session.waitForIdle();
  const routine = await state();
  assert.equal(calls, 1, "Only the requested ordinary response runs");
  assert.equal(routine.context.legatus.sample.kind, "fresh");
  assert.equal(routine.context.legatus.sample.tokens, session.getContextUsage().tokens);
  assert.equal(routine.context.legatus.sample.contextWindow, 272000);
  assert.ok(routine.context.legatus.sample.tokens < 100);
  assert.equal(deliveries.length, 0);
  assert.equal(session.sessionManager.getEntries().filter(entry => entry.type === "custom_message").length, 0, "Routine observations add no custom transcript messages");
  const entriesBeforeStatus = session.sessionManager.getEntries();
  await state(); await state();
  assert.deepEqual(session.sessionManager.getEntries(), entriesBeforeStatus);
  assert.equal(calls, 1, "Status refreshes are model-free");

  await session.prompt("/fixture-response"); await session.waitForIdle();
  assert.equal(calls, 5, "Three current-work requests plus exactly one advisory response");
  assert.equal(deliveries.length, 1, "A direct escalation emits no separate warning or duplicate");
  assert.deepEqual(deliveries[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(deliveries[0].message.details.level, "escalation");
  assert.equal(notices.filter(notice => notice.message.startsWith("Advisory context ")).length, 1);
  assert.equal(containsAdvisory(requests[2]), false, "Not steering into the first tool continuation");
  assert.equal(containsAdvisory(requests[3]), false, "Current effects finish before follow-up");
  assert.equal(containsAdvisory(requests[4]), true, "Advisory actually reaches the native next request");
  assert.ok(timeline.indexOf("effect_one") < timeline.indexOf("advisory:escalation"));
  assert.ok(timeline.indexOf("advisory:escalation") < timeline.indexOf("effect_two"));
  assert.ok(timeline.indexOf("effect_two") < timeline.indexOf("request:5"));
  for (const name of ["effect_one", "effect_two"]) assert.equal(await readFile(join(root, name), "utf8"), "complete");
  const custom = session.sessionManager.getEntries().filter(entry => entry.type === "custom_message");
  assert.equal(custom.length, 1); assert.equal(custom[0].customType, "legion-context-alert");
  const escalated = await state();
  assert.equal(escalated.context.legatus.sample.tokens, session.getContextUsage().tokens);
  assert.ok(statuses.some(status => status.key === "legion-context" && status.text?.includes("272000 tokens (fresh")));

  const compaction = await session.compact("Preserve the two fixture effects.");
  assert.equal(calls, 7, "Native history and split-span summaries only; no telemetry request");
  assert.ok(compaction.summary.includes("Fixture checkpoint"));
  assert.notEqual(session.sessionManager.getEntries().findLast(entry => entry.type === "compaction").fromHook, true, "Native summarization, not a replacement compaction hook");
  const compactedUsage = session.getContextUsage();
  assert.deepEqual(compactedUsage, { tokens: null, contextWindow: 272000, percent: null });
  const compacted = await state();
  assert.equal(compacted.context.legatus.sample.kind, "unknown");
  assert.equal(compacted.context.legatus.sample.tokens, null);
  assert.equal(compacted.context.legatus.sample.contextWindow, 272000);
  assert.equal(deliveries.length, 1, "Null compaction estimate does not emit another alert");
  assert.equal(settings.getCompactionEnabled(), true);
  assert.deepEqual(settings.getCompactionSettings(), compactionBefore, "Extension leaves native settings unchanged");
  assert.equal(networkCalls, 0); assert.deepEqual(errors, []);
  assert.deepEqual(await readFile(hostSettings), hostBefore, "Host settings untouched");
  console.log(JSON.stringify({ result: "passed", root, pi: VERSION, node: process.version, networkCalls, providerRequests: calls, thresholds: { warningTokens: 100, escalationTokens: 200 }, routineUsage: routine.context.legatus.sample, escalatedUsage: escalated.context.legatus.sample, compactedUsage, compaction: compactionBefore, advisoryCount: deliveries.length, routineCustomMessages: 0, followUpAfterEffects: true, timeline, samples, errors }, null, 2));
} finally {
  if (session) { await session.waitForIdle(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); session.dispose(); }
  console.error(JSON.stringify({ calls, timeline, samples, errors }));
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
  console.error(`Settled disposable evidence: ${root}`);
}
