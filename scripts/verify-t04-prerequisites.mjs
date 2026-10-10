import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, cp, appendFile, lstat, readlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const exec = promisify(execFile);
const root = resolve(process.argv[2] ?? "");
const nativeChild = process.argv[3] === "--native-child";
assert.ok(process.argv[2], "Supply a new disposable output directory.");
assert.equal(process.env.HERDR_ENV, "1", "Run inside the authorized local Herdr environment.");
await mkdir(root, { recursive: false, mode: 0o700 });
const repository = process.cwd();
const cwd = join(root, "repo");
const evidence = join(root, "evidence");
await mkdir(cwd);
await mkdir(evidence);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function command(file, args, options = {}) {
  try {
    const result = await exec(file, args, { maxBuffer: 8 * 1024 * 1024, ...options });
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, code: 0, ...result }) + "\n");
    return result.stdout;
  } catch (error) {
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n");
    throw error;
  }
}
let identity = null;
try {
  const source = (await command("git", ["rev-parse", "HEAD"])).trim();
  const trackedDiff = await command("git", ["diff", "--binary", "HEAD"]);
  const files = (await command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const manifest = [];
  for (const path of files.sort()) {
    const absolute = join(repository, path);
    const stat = await lstat(absolute);
    manifest.push({ path, kind: stat.isSymbolicLink() ? "symlink" : "file", sha256: hash(stat.isSymbolicLink() ? await readlink(absolute) : await readFile(absolute)) });
  }
  await writeFile(join(evidence, "source.json"), JSON.stringify({ source, trackedDiffSha256: hash(trackedDiff), files: manifest }, null, 2));
  const server = JSON.parse(await command("herdr", ["status", "server", "--json"]));
  assert.equal(server.running, true);
  assert.equal(server.version, "0.9.1");
  assert.equal(server.protocol, 22);
  assert.equal(server.restart_needed, false);
  await command("git", ["init", "-b", "main", cwd]);
  await writeFile(join(cwd, "README.md"), "Disposable T04 installed-runtime prerequisite trial. No product acceptance.\n");
  for (const skill of ["matt-tdd", "matt-teach"]) await cp(join(repository, ".agents", "skills", skill), join(cwd, ".agents", "skills", skill), { recursive: true });
  await command("git", ["-C", cwd, "add", "."]);
  await command("git", ["-C", cwd, "-c", "user.name=Legion trial", "-c", "user.email=trial@example.invalid", "commit", "-m", "Disposable prerequisite fixture"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "pi-subagents": "0.76.1" } }));
  await command("npm", ["install", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund"], { cwd: root });
  const guard = join(root, "guard.mjs");
  await writeFile(guard, `import { writeFileSync, appendFileSync } from "node:fs";
export default function (pi) {
  const binding = JSON.parse(process.env.PI_SUBAGENT_EXTENSION_BINDINGS ?? "null");
  if (binding?.["pi-legion/1"]?.trial !== ${JSON.stringify(root)}) throw new Error("Missing or foreign T04 trial binding.");
  pi.on("session_start", (_event, ctx) => {
    if (ctx.cwd !== ${JSON.stringify(cwd)}) throw new Error("Foreign T04 trial cwd.");
    writeFileSync(${JSON.stringify(join(evidence, "child-start.json"))}, JSON.stringify({ cwd: ctx.cwd, session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), childMarker: process.env.PI_SUBAGENT_CHILD, binding }), { flag: "wx", mode: 0o600 });
  });
  pi.on("tool_call", event => {
    appendFileSync(${JSON.stringify(join(evidence, "child-tools.jsonl"))}, JSON.stringify({ kind: "call", name: event.toolName, input: event.input, id: event.toolCallId }) + "\\n");
    if (event.toolName !== "read") return { block: true, reason: "T04 preparation trial has no write authority." };
  });
  pi.on("tool_result", event => appendFileSync(${JSON.stringify(join(evidence, "child-tools.jsonl"))}, JSON.stringify({ kind: "result", ...event }) + "\\n"));
  pi.on("session_shutdown", () => writeFileSync(${JSON.stringify(join(evidence, "child-shutdown.json"))}, JSON.stringify({ at: new Date().toISOString() }), { flag: "wx", mode: 0o600 }));
}
`);
  const probe = join(root, "probe.mjs");
  await writeFile(probe, `import { writeFileSync, readFileSync } from "node:fs";
import { registerRequiredChildExtensions } from "pi-subagents/required-child-extensions";
import { isDeepStrictEqual } from "node:util";
export default function (pi) {
  let registration;
  let agentRegistration;
  let launched = false;
  pi.on("session_start", async (_event, ctx) => {
    const result = { mode: ctx.mode, cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), childMarker: process.env.PI_SUBAGENT_CHILD ?? null, model: ctx.model ? ctx.model.provider + "/" + ctx.model.id : null, skills: pi.getCommands().filter(c => c.source === "skill").map(c => ({ name: c.name, path: c.sourceInfo.path })), tools: pi.getAllTools().map(t => ({ name: t.name, exposure: t.exposure })) };
    try {
      registration = registerRequiredChildExtensions({ sessionId: result.session, extensions: [{ id: "legion-t04-prerequisite", path: ${JSON.stringify(guard)} }], requireForAllRunners: true });
      result.requiredGuardRegistered = true;
      const request = { version: 1, name: "legion-t04-probe", definition: { description: "Disposable native child prerequisite", systemPrompt: "Perform only the explicitly requested runtime probe. Do not delegate, launch processes, change settings, or control sessions.", tools: ["read", "write"], allowNestedSubagents: false } };
      pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
      if (!request.result?.ok) throw new Error("Runtime agent registration unavailable: " + String(request.result?.error));
      agentRegistration = request.result.registration;
      result.activeTools = pi.getActiveTools();
      const models = JSON.parse(readFileSync(${JSON.stringify(join(process.env.HOME, ".pi/agent/pstack/models.json"))}, "utf8"));
      result.roles = models.roles;
      result.availableModels = ctx.modelRegistry.getAvailable().map(m => m.provider + "/" + m.id);
    } catch (error) { result.error = String(error); }
    writeFileSync(${JSON.stringify(join(evidence, "runtime.json"))}, JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
  });
  pi.on("tool_call", event => {
    if (!${nativeChild}) return { block: true, reason: "No model work is authorized by this prerequisite trial." };
    if (event.toolName === "subagents_enable" && isDeepStrictEqual(event.input, {}) && !launched) return;
    if (event.toolName === "subagent" && isDeepStrictEqual(event.input, { action: "list", capabilities: true }) && !launched) return;
    if (event.toolName !== "subagent" || launched || !isDeepStrictEqual(event.input, JSON.parse(readFileSync(${JSON.stringify(join(evidence, "child-input.json"))}, "utf8")))) return { block: true, reason: "Only the one exact native child trial is authorized." };
    launched = true;
    writeFileSync(${JSON.stringify(join(evidence, "root-admission.json"))}, JSON.stringify(event, null, 2), { flag: "wx", mode: 0o600 });
  });
  pi.on("tool_result", event => {
    if (event.toolName === "subagent" && event.input?.action !== "list") writeFileSync(${JSON.stringify(join(evidence, "native-result.json"))}, JSON.stringify(event, null, 2), { mode: 0o600 });
  });
  pi.on("agent_settled", (_event, ctx) => {
    writeFileSync(${JSON.stringify(join(evidence, "principal-settled.json"))}, JSON.stringify({ session: ctx.sessionManager.getSessionId(), at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  });
  pi.on("session_shutdown", () => { agentRegistration?.dispose(); registration?.dispose(); });
}
`);
  const name = `t04-pre-${randomUUID().slice(0, 8)}`;
  const created = JSON.parse(await command("herdr", ["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus"]));
  identity = { name, pane: created.result.root_pane, server, cwd };
  await writeFile(join(evidence, "identity.json"), JSON.stringify(identity, null, 2));
  const pane = identity.pane.pane_id;
  const observed = JSON.parse(await command("herdr", ["pane", "get", pane])).result.pane;
  assert.equal(observed.terminal_id, identity.pane.terminal_id);
  assert.equal(observed.foreground_cwd, cwd);
  assert.equal(observed.agent, undefined);
  await writeFile(join(evidence, "start-intent.json"), JSON.stringify({ name, pane, argv: ["pi", "--approve", "-e", probe] }), { flag: "wx" });
  await command("herdr", ["agent", "start", name, "--kind", "pi", "--pane", pane, "--", "--approve", "-e", probe]);
  await writeFile(join(evidence, "startup.txt"), await command("herdr", ["agent", "read", name, "--source", "recent-unwrapped", "--lines", "120"]));
  const runtime = JSON.parse(await readFile(join(evidence, "runtime.json"), "utf8"));
  assert.equal(runtime.error, undefined);
  assert.equal(runtime.mode, "tui");
  assert.equal(runtime.cwd, cwd);
  assert.equal(runtime.trusted, true);
  assert.equal(runtime.childMarker, null, "An ordinary principal must not inherit child runtime identity.");
  assert.equal(runtime.requiredGuardRegistered, true);
  assert.ok(runtime.journal);
  assert.ok(runtime.tools.some(t => t.name === "subagent" && t.exposure === "model-only"));
  for (const name of ["poteto-mode", "matt-tdd", "matt-teach"]) assert.ok(runtime.skills.some(s => s.name === `skill:${name}`), `Missing native skill ${name}`);
  for (const role of ["feature, refactoring", "how explorer", "judgment and prose"]) {
    const selected = runtime.roles[role];
    assert.equal(typeof selected, "string", `Missing role ${role}`);
    assert.ok(runtime.availableModels.includes(selected), `Configured model unavailable for ${role}: ${selected}`);
  }
  if (nativeChild) {
    const poteto = runtime.skills.find(s => s.name === "skill:poteto-mode").path;
    const childInput = {
      agent: "legion-t04-probe", async: true, context: "fresh", cwd, worktree: false, artifacts: true, timeoutMs: 5400000,
      model: runtime.roles["feature, refactoring"], extensionBindings: { "pi-legion/1": { trial: root } },
      task: `This is a disposable runtime check, not implementation. First call write with path ${join(cwd, "must-not-exist.txt")} and content denied. An installed guard must refuse it. Do not retry. Then read these actual resource files in full with read: ${[poteto, join(cwd, ".agents/skills/matt-tdd/SKILL.md"), join(cwd, ".agents/skills/matt-tdd/tests.md"), join(cwd, ".agents/skills/matt-tdd/mocking.md")].join(", ")}. Do not execute the workflows or delegate. Return the fact that the write was refused and the resource paths read. Do not claim product approval.`
    };
    await writeFile(join(evidence, "child-input.json"), JSON.stringify(childInput, null, 2));
    await command("herdr", ["agent", "prompt", name, `Disposable runtime integration trial. If the native subagent tool is not exposed, first call the installed subagents_enable tool. The native read-only subagent capability listing is also allowed. Launch exactly one child with this input through the native subagent tool. Do not call other tools, change the launch input, use another executor, or wait with a tool. After launch, yield. ${JSON.stringify(childInput)}`, "--wait", "--timeout", "120000"]);
    const result = JSON.parse(await readFile(join(evidence, "native-result.json"), "utf8"));
    assert.equal(result.isError, false, "Native child launch must succeed without fallback.");
    assert.ok(result.details?.runId, "Native run identity is required.");
    await writeFile(join(evidence, "native-launch.json"), JSON.stringify(result.details, null, 2));
  }
  await writeFile(join(evidence, "result.json"), JSON.stringify({ verdict: nativeChild ? "NATIVE_LAUNCH_ONLY" : "PREREQUISITES_ONLY", source, identity, note: "Ordinary shell prerequisite trial only. Not Legion approval or TDD behavior proof. Child launch is not child completion." }, null, 2));
  process.stdout.write(`${nativeChild ? "NATIVE_LAUNCH_ONLY" : "PREREQUISITES_ONLY"} ${evidence}\n`);
} catch (error) {
  await writeFile(join(evidence, "result.json"), JSON.stringify({ verdict: "BLOCKED", error: String(error), identity, note: "No alternate launcher or retry. Preserve this actor and inspect the exact startup." }, null, 2));
  process.stderr.write(`BLOCKED ${evidence}: ${String(error)}\n`);
  process.exitCode = 1;
}
