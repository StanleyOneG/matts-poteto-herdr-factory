import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, appendFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.env.HERDR_ENV, "1", "This trial requires the authorized local Herdr environment.");
assert.ok(process.argv[2], "Supply a new disposable trial directory.");
const root = resolve(process.argv[2]), cwd = join(root, "repo"), evidence = join(root, "evidence");
await mkdir(root, { mode: 0o700 });
await mkdir(cwd); await mkdir(evidence);
const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const production = fileURLToPath(new URL("../src/extension.ts", import.meta.url));
const requiredApi = import.meta.resolve("pi-subagents/required-child-extensions");
async function command(file, args) {
  try {
    const result = await execute(file, args, { maxBuffer: 4 * 1024 * 1024 });
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, code: 0, ...result }) + "\n");
    return result.stdout;
  } catch (error) {
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n");
    throw error;
  }
}
const name = `t04-child-${randomUUID().slice(0, 8)}`;
let actor = null;
try {
  await writeFile(join(evidence, "source.json"), JSON.stringify({ head: (await command("git", ["rev-parse", "HEAD"])).trim(), files: await Promise.all([production, fileURLToPath(import.meta.url)].map(async path => ({ path, sha256: hash(await readFile(path)) }))) }, null, 2));
  const server = JSON.parse(await command("herdr", ["status", "server", "--json"]));
  assert.equal(server.version, "0.9.1"); assert.equal(server.protocol, 22); assert.equal(server.restart_needed, false);
  await command("git", ["init", "-q", "-b", "main", cwd]);
  await writeFile(join(cwd, "README.md"), "Disposable production child-isolation trial.\n");
  await command("git", ["-C", cwd, "add", "README.md"]);
  await command("git", ["-C", cwd, "-c", "user.name=Trial", "-c", "user.email=trial@example.invalid", "commit", "-qm", "Disposable trial"]);
  const bootstrap = join(root, "principal-bootstrap.json");
  await writeFile(bootstrap, JSON.stringify({ launch: { id: randomUUID(), reservation: randomUUID(), revision: 0, scope: name, state: { kind: "prepared" } }, cwd, capability: randomUUID(), authority: { owner: randomUUID(), session: "unclaimed-trial-principal", generation: 1, epoch: 0 } }), { mode: 0o600 });
  const verifier = join(root, "child-verifier.mjs");
  await writeFile(verifier, `import legion from ${JSON.stringify(production)};
import { writeFileSync } from "node:fs";
export default function (pi) {
  if (process.env.PI_SUBAGENT_CHILD !== "1") throw new Error("Expected a native child marker.");
  const binding = JSON.parse(process.env.PI_SUBAGENT_EXTENSION_BINDINGS ?? "null");
  if (binding?.["pi-legion/1"]?.trial !== ${JSON.stringify(root)}) throw new Error("Foreign trial binding.");
  process.env.LEGION_TRIBUNUS_BOOTSTRAP = ${JSON.stringify(bootstrap)};
  legion(pi);
  if (process.env.LEGION_TRIBUNUS_BOOTSTRAP !== ${JSON.stringify(bootstrap)}) throw new Error("Production extension consumed the principal bootstrap.");
  pi.on("session_start", (_event, ctx) => {
    if (ctx.cwd !== ${JSON.stringify(cwd)}) throw new Error("Foreign child cwd.");
    if (pi.getCommands().some(command => command.name === "legion")) throw new Error("Child acquired Legatus command.");
    if (pi.getAllTools().some(tool => tool.name.startsWith("legion_"))) throw new Error("Child acquired Legion orchestration tools.");
    writeFileSync(${JSON.stringify(join(evidence, "child-start.json"))}, JSON.stringify({ session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), cwd: ctx.cwd, binding, childMarker: process.env.PI_SUBAGENT_CHILD, bootstrapUntouched: true }), { flag: "wx", mode: 0o600 });
    pi.events.emit("subagent:acknowledge-extension", { id: "legion-child-isolation-trial" });
  });
  pi.on("tool_call", event => { if (event.toolName !== "read") return { block: true, reason: "The disposable isolation trial permits native reads only." }; });
}
`);
  const parent = join(root, "parent.mjs");
  await writeFile(parent, `import { registerRequiredChildExtensions } from ${JSON.stringify(requiredApi)};
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isDeepStrictEqual } from "node:util";
export default function (pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  let guard, agent, launch = null, launched = false;
  pi.on("session_start", (_event, ctx) => {
    guard = registerRequiredChildExtensions({ sessionId: ctx.sessionManager.getSessionId(), extensions: [{ id: "legion-child-isolation-trial", path: ${JSON.stringify(verifier)} }], requireForAllRunners: true });
    const request = { version: 1, name: ${JSON.stringify(name)}, definition: { description: "Disposable child isolation verifier", systemPrompt: "Read the supplied disposable README and return one sentence. Do not delegate or perform any mutation.", tools: ["read"], allowNestedSubagents: false } };
    pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
    if (!request.result?.ok) throw new Error("Native runtime agent registration unavailable: " + String(request.result?.error));
    agent = request.result.registration;
    const configPath = join(getAgentDir(), "pstack", "models.json");
    const configBytes = readFileSync(configPath, "utf8"), config = JSON.parse(configBytes);
    const role = config.roles?.["how explorer"];
    const model = role === "auto" || role === "inherit-parent" ? ctx.model.provider + "/" + ctx.model.id : role;
    if (typeof model !== "string" || !ctx.modelRegistry.getAvailable().some(item => item.provider + "/" + item.id === model)) throw new Error("Configured how explorer model unavailable.");
    launch = { agent: ${JSON.stringify(name)}, task: ${JSON.stringify(`Read ${join(cwd, "README.md")} once with the native read tool. Return one sentence confirming the text. This is a disposable integration trial, not implementation or delegation authority.`)}, async: true, context: "fresh", cwd: ${JSON.stringify(cwd)}, model, worktree: false, artifacts: true, timeoutMs: 5400000, extensionBindings: { "pi-legion/1": { trial: ${JSON.stringify(root)} } } };
    writeFileSync(${JSON.stringify(join(evidence, "principal.json"))}, JSON.stringify({ session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), mode: ctx.mode, model: ctx.model.provider + "/" + ctx.model.id, guardRegistered: true, agentRegistered: true, role: "how explorer", configPath, launch }), { flag: "wx", mode: 0o600 });
  });
  pi.on("tool_call", event => {
    if (event.toolName === "subagents_enable" && !launched && isDeepStrictEqual(event.input, {})) return;
    if (event.toolName === "subagent" && !launched && isDeepStrictEqual(event.input, { action: "list", capabilities: true })) return;
    if (event.toolName !== "subagent" || event.parentToolCallId || launched || !launch || !isDeepStrictEqual(event.input, launch)) return { block: true, reason: "Only the exact single model-origin native trial launch is authorized." };
    launched = true;
    writeFileSync(${JSON.stringify(join(evidence, "root-admission.json"))}, JSON.stringify(event), { flag: "wx", mode: 0o600 });
  });
  pi.on("tool_result", event => {
    if (event.toolName === "subagent" && event.input?.action !== "list") writeFileSync(${JSON.stringify(join(evidence, "native-result.json"))}, JSON.stringify(event), { flag: "wx", mode: 0o600 });
  });
  pi.on("session_shutdown", () => { agent?.dispose(); guard?.dispose(); });
}
`);
  const created = JSON.parse(await command("herdr", ["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus"]));
  actor = { name, cwd, server, pane: created.result.root_pane };
  await writeFile(join(evidence, "actor.json"), JSON.stringify(actor, null, 2));
  const observed = JSON.parse(await command("herdr", ["pane", "get", actor.pane.pane_id])).result.pane;
  assert.equal(observed.terminal_id, actor.pane.terminal_id); assert.equal(observed.foreground_cwd, cwd); assert.equal(observed.agent, undefined);
  await command("herdr", ["agent", "start", name, "--kind", "pi", "--pane", actor.pane.pane_id, "--", "-e", parent]);
  const principal = JSON.parse(await readFile(join(evidence, "principal.json"), "utf8"));
  assert.equal(principal.mode, "tui");
  await command("herdr", ["agent", "prompt", name, `Authorized disposable product-runtime trial. Activate subagents_enable if needed. You may list capabilities. Call the native root subagent tool once with exactly this input, without modifying fields or using another executor. Yield after launch. ${JSON.stringify(principal.launch)}`, "--wait", "--timeout", "120000"]);
  const result = JSON.parse(await readFile(join(evidence, "native-result.json"), "utf8"));
  assert.equal(result.isError, false);
  assert.ok(result.details?.runId); assert.ok(result.details?.asyncDir);
  const asyncDir = await realpath(result.details.asyncDir);
  const deadline = Date.now() + 90000;
  let terminal;
  while (Date.now() < deadline) {
    try { terminal = JSON.parse(await readFile(join(asyncDir, "process-terminal.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (terminal?.state === "observed") break;
    await delay(500);
  }
  assert.equal(terminal?.state, "observed", "Process-terminal evidence remains unknown. Preserve this exact actor and run.");
  assert.equal(terminal.runId, result.details.runId);
  await writeFile(join(evidence, "process-terminal.json"), JSON.stringify(terminal, null, 2));
  const statusBytes = await readFile(join(asyncDir, "status.json")), status = JSON.parse(statusBytes);
  await writeFile(join(evidence, "status.json"), statusBytes);
  assert.ok([principal.session, principal.journal].includes(status.sessionId));
  const child = JSON.parse(await readFile(join(evidence, "child-start.json"), "utf8"));
  assert.notEqual(child.session, principal.session);
  assert.equal(child.bootstrapUntouched, true);
  await writeFile(join(evidence, "result.json"), JSON.stringify({ verdict: "CHILD_ISOLATION_ONLY", actor, runId: result.details.runId, child, limitation: "This exercises production startup isolation through a trial-owned mandatory verifier. It does not prove production child intent, registration, guard, role resolution, ownership joins, or retained results." }, null, 2));
  process.stdout.write(`CHILD_ISOLATION_ONLY ${evidence}\n`);
} catch (error) {
  await writeFile(join(evidence, "result.json"), JSON.stringify({ verdict: "CONTINUATION_BLOCKED", error: String(error), actor, limitation: "No retry, permission change, alternate launcher, or actor cleanup was attempted." }, null, 2));
  process.stderr.write(`CONTINUATION_BLOCKED ${evidence} ${String(error)}\n`);
  process.exitCode = 1;
}
