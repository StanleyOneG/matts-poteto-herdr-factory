import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createServer, createConnection } from "node:net";
import { createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { installTribunus, LocalTribunusHost } from "../../src/tribunus-host.ts";
import { Initialization } from "../../src/tribunus.ts";

// Real fresh SDK persistence and lifecycle; Herdr/discovery/TUI identity are controlled boundaries.
const root = mkdtempSync(join(tmpdir(), "mi-")), profile = join(root, "a"), cwd = join(root, "c"), bin = join(root, "b");
for (const directory of [profile, cwd, bin]) mkdirSync(directory);
const launch = { id: randomUUID(), reservation: randomUUID(), revision: 1, scope: "SDK Matt persistence", state: { kind: "prepared" } };
const authority = { owner: randomUUID(), session: "owning-controller", generation: 1, epoch: 0 };
const workflowChoice = { profile: "matt", requestedWorkflow: "implement-spec" };
const launchRoot = join(profile, "legion", "tribuni", launch.id);
mkdirSync(launchRoot, { recursive: true });
const bootstrap = join(launchRoot, "bootstrap.json"), capability = "disposable-fixture-capability";
const manager = SessionManager.create(cwd, join(root, "s")), sessionId = manager.getSessionId(), journal = manager.getSessionFile();
assert.ok(journal); assert.equal(existsSync(journal), false);
const server = createServer(), localSocket = join(root, "herdr.sock");
await new Promise(resolve => server.listen(localSocket, resolve));
const ownerPane = { workspace_id: "w", tab_id: "owner-t", pane_id: "owner-p", terminal_id: "owner-term", foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: authority.session } };
const pane = { workspace_id: "w", tab_id: "t", pane_id: "p", terminal_id: "term", foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: sessionId } };
// Controlled owner and worker panes share this fixture process, not a separate live Legatus.
const ownerStat = readFileSync(`/proc/${process.pid}/stat`, "utf8"), socketStat = lstatSync(localSocket);
const ownerProcess = {
  pid: process.pid, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), start: ownerStat.slice(ownerStat.lastIndexOf(")") + 2).split(" ")[19],
  window: { endpoint: realpathSync(localSocket), server: `${socketStat.dev}:${socketStat.ino}:${socketStat.ctimeMs}`, workspace: ownerPane.workspace_id, tab: ownerPane.tab_id, pane: ownerPane.pane_id, terminal: ownerPane.terminal_id },
};
writeFileSync(bootstrap, JSON.stringify({ launch, cwd, capability, authority, workflowChoice, ownerProcess }), { mode: 0o600 });
writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nconst a=process.argv.slice(2);console.log(a[0]==='--version'?'0.9.1':JSON.stringify(a[0]==='status'?{status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(localSocket)}}:a[1]==='get'?{result:{pane:a[2]==='owner-p'?${JSON.stringify(ownerPane)}:${JSON.stringify(pane)}}}:{result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));\n`, { mode: 0o700 });
const prior = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID, PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD };
Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, PI_CODING_AGENT_DIR: profile, HERDR_ENV: "1", HERDR_PANE_ID: "p" });
delete process.env.PI_SUBAGENT_CHILD;
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const { default: nativeSubagents } = await import("pi-subagents");
const fork = "/home/vscode/.pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack";
const discovery = [
  { name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } },
  ...["herdr", "matt-tdd", "matt-teach", "implement-spec", "handoff", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: `/controlled/${name}/SKILL.md` } })),
];
const requests = [], errors = [];
let release = null;
const defer = process.argv.includes("late"), fail = process.argv.includes("error"), lost = process.argv.includes("lost");
const provider = pi => pi.registerProvider("matt-persistence-fixture", {
  baseUrl: "http://fixture.invalid", apiKey: "disposable-not-a-credential", api: "matt-persistence-fixture",
  models: [{ id: "principal", name: "zero-network principal", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 1024 }],
  streamSimple(model, context) {
    requests.push(context);
    const stream = new AssistantMessageEventStream();
    const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [{ type: "text", text: "Waiting for the bounded assignment." }], stopReason: fail ? "error" : "stop", ...(fail ? { errorMessage: "Scripted bootstrap failure" } : {}), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const finish = () => { stream.push({ type: "start", partial: message }); stream.push(fail ? { type: "error", reason: "error", error: message } : { type: "done", reason: "stop", message }); stream.end(); };
    if (defer) release = finish; else queueMicrotask(finish);
    return stream;
  },
});
const controlledWorker = pi => installTribunus({ ...pi,
  getCommands: () => [...pi.getCommands(), ...discovery],
  getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? { ...tool, sourceInfo: { path: subagentsEntry } } : tool),
  on: (name, handler) => pi.on(name, (event, ctx) => handler(event, { ...ctx, mode: "tui", isProjectTrusted: () => true })),
}, bootstrap);
let session;
const clients = new Set();
async function control(command, loseResponse = false) {
  const hello = JSON.parse(readFileSync(join(launchRoot, "hello.json"), "utf8"));
  return new Promise((resolve, reject) => {
    const client = createConnection(hello.endpoint); clients.add(client);
    let data = "";
    client.on("connect", () => client.write(JSON.stringify({ capability, authority, reservation: launch.reservation, scope: launch.scope, address: hello.address, command, kind: "initialize", assignment: null }) + "\n"));
    client.on("data", chunk => { if (!loseResponse) data += chunk; });
    client.on("error", reject);
    client.on("close", () => { clients.delete(client); try { resolve(loseResponse ? { kind: "lost" } : JSON.parse(data)); } catch (error) { reject(error); } });
  });
}
async function until(predicate) {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("SDK fixture did not reach expected observable state");
}
try {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  provider(modelRuntime);
  const model = modelRuntime.getModel("matt-persistence-fixture", "principal"); assert.ok(model);
  const loader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [provider, nativeSubagents, controlledWorker] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd, agentDir: profile, settingsManager: settings, modelRuntime, model, thinkingLevel: "high", sessionManager: manager, resourceLoader: loader }));
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
  assert.deepEqual(errors, [], "Worker startup must verify exact process/cwd/session before bootstrap");
  assert.equal(existsSync(journal), false, "Custom generation alone must not eagerly create a journal");
  const hello = JSON.parse(readFileSync(join(launchRoot, "hello.json"), "utf8"));
  assert.equal(hello.address.session, sessionId);
  const host = new LocalTribunusHost(async command => ({ kind: "finished", code: 0, output: (await promisify(exec)(command)).stdout }), authority);
  const worker = await host.inspectWorker({ launch, window: hello.address.window, cwd });
  assert.ok(worker);
  assert.equal(existsSync(worker.identityEvidence), true, "Fresh identity evidence must exist before native journal persistence");
  assert.equal(requests.length, 0, "Verified startup identity alone must not request a model turn");
  const command = randomUUID();
  const pending = control(command, lost);
  // Before the fix this response is held with ENOENT; it is a behavioral red, not fixture setup failure.
  if (!defer) {
    const response = await pending;
    assert.equal(response.kind, lost ? "lost" : "ok", JSON.stringify(response));
    if (fail) assert.equal(response.value, null);
    else if (!lost) assert.ok(response.value, "Fresh Matt initialization must return an applied receipt");
  } else {
    await until(() => requests.length === 1);
    assert.deepEqual(await control(command), { kind: "ok", value: null }, "Same uncertain intent cannot enqueue a second bootstrap");
    release();
    const response = await pending;
    assert.equal(response.kind, "ok", JSON.stringify(response)); assert.ok(response.value);
  }
  await session.waitForIdle();
  assert.equal(requests.length, 1, "Exactly one bounded bootstrap request; no replay");
  const replay = await control(command);
  assert.equal(replay.kind, "ok");
  if (fail) {
    assert.equal(replay.value, null, "Failed bootstrap stays uncertain and cannot be resent");
  } else {
    const proof = Initialization.parse(replay.value);
    assert.equal(proof.profile, "matt"); assert.deepEqual(proof.address, worker.address);
    assert.equal(proof.skillPath, ""); assert.ok(!proof.nativePrompt.startsWith("/skill:"));
    const restored = SessionManager.open(journal);
    assert.equal(restored.getSessionId(), sessionId);
    const witnesses = restored.getBranch();
    for (const locator of [proof.modeEntry, proof.settledEntry]) assert.ok(witnesses.some(entry => `${journal}#${entry.id}` === locator), "Applied witnesses must survive native journal reload");
    assert.ok(witnesses.some(entry => entry.type === "message" && entry.message.role === "user" && entry.message.content.some(part => part.type === "text" && part.text === proof.nativePrompt)));
    assert.equal(witnesses.some(entry => entry.type === "custom" && entry.customType === "pstack-mode"), false, "Matt must never toggle poteto");
    assert.equal(existsSync(worker.identityEvidence), true, "Verified startup identity must point to retained evidence, not a future journal");
    assert.deepEqual(await control(command), replay, "A lost applied response reconciles to the same receipt without replay");
  }
  assert.equal(requests.length, 1); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ root, pi: VERSION, networkCalls: 0, bootstrapRequests: requests.length, scenario: fail ? "error" : defer ? "late" : lost ? "lost" : "fresh", persisted: existsSync(journal), sameWorker: manager.getSessionId() === sessionId, noReplay: true }));
} finally {
  release?.();
  if (session) { await session.waitForIdle(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" }); session.dispose(); }
  for (const client of clients) client.destroy();
  await new Promise(resolve => server.close(resolve));
  for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
