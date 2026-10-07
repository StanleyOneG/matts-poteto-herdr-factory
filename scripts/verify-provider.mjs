import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, chmod } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

assert.equal(process.env.LEGION_PROVIDER_TRIAL, "authorized", "Set LEGION_PROVIDER_TRIAL=authorized only with permission to use configured test authentication.");
const host = process.env.LEGION_PROVIDER_AGENT_DIR ?? join(homedir(), ".pi/agent");
const provider = "openai-codex";
const model = "gpt-6-astra";
const originals = new Map();
for (const name of ["auth.json", "settings.json", "models.json", "models-store.json"])
  originals.set(name, await readFile(join(host, name)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const settings = JSON.parse(originals.get("settings.json"));
assert.equal(settings.defaultProvider, provider, "No provider fallback is allowed.");
assert.equal(settings.defaultModel, model, "No model fallback is allowed.");
assert.equal(JSON.parse(originals.get("models.json")).providers?.[provider], undefined, "Custom provider configuration requires separate safety review.");
const credential = JSON.parse(originals.get("auth.json"))[provider];
assert.equal(credential?.type, "oauth", "Existing OAuth authentication is required.");
assert.ok(credential.expires > Date.now() + 15 * 60 * 1000, "Authentication must remain outside Pi's five-minute refresh window throughout this bounded test.");
const catalog = JSON.parse(originals.get("models-store.json"))[provider];
assert.ok(catalog?.models.some((m) => m.id === model), "Configured selected model must exist in the cached catalog.");
const root = await mkdtemp(join(tmpdir(), "legion-provider-"));
await chmod(root, 0o700);
const agent = join(root, "agent");
const cwd = join(root, "repo");
await mkdir(agent, { mode: 0o700 });
await mkdir(cwd);
const env = {
  PATH: process.env.PATH,
  HOME: root,
  PI_CODING_AGENT_DIR: agent,
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
  PI_TELEMETRY: "0",
  TERM: "xterm-256color",
};
const transportNames = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"].filter((name) => process.env[name] !== undefined);
const subjectEnv = { ...env, NODE_OPTIONS: "--use-env-proxy" };
for (const name of transportNames) subjectEnv[name] = process.env[name];
let testAuthenticationUnchanged = null;
let testSettingsUnchanged = null;
let evidenceContainsNoSecrets = false;
let child;
let seq = 0;
let buffer = "";
let protocolFailed = false;
const records = [];
const waiters = new Map();
const checkpoints = [];
const providerOutcomes = [];
function redact(text) {
  let clean = text;
  for (const key of ["access", "refresh", "accountId"])
    if (typeof credential[key] === "string" && credential[key].length)
      clean = clean.split(credential[key]).join("[redacted]");
  for (const name of transportNames)
    if (process.env[name]) clean = clean.split(process.env[name]).join("[redacted]");
  if (/<(?:html|!doctype)/i.test(clean)) return "Provider returned an HTML error body.";
  if (/proxy|fetch failed|network|TLS|certificate/i.test(clean)) return "Provider transport failed.";
  return "Provider request failed. Raw error body not retained.";
}
let diagnostics = [];
let verdict = "NOT VERIFIED";
let failure = null;
async function rpc(type, fields = {}) {
  const id = String(++seq);
  const response = await Promise.race([
    new Promise((r) => {
      waiters.set(id, r);
      child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`RPC ${type} deadline exceeded`)), 20000).unref()),
  ]);
  assert.equal(response.success, true, `RPC ${type} rejected. Raw provider errors are not retained.`);
  return response.data;
}
async function view() {
  const start = records.length;
  await rpc("prompt", { message: "/legion status" });
  const notice = records.slice(start).find((r) => r.type === "extension_ui_request" && r.message?.includes("\nState\n"));
  assert.ok(notice, "Public status must expose saved records.");
  return JSON.parse(notice.message.split("\nState\n")[1]);
}
async function turn(text) {
  assert.ok(credential.expires > Date.now() + 6 * 60 * 1000, "Stop before the OAuth refresh window.");
  const start = records.length;
  assert.equal((await rpc("prompt", { message: text })).disposition, "handled");
  const deadline = Date.now() + 120000;
  while (!records.slice(start).some((r) => r.type === "agent_settled")) {
    if (protocolFailed) throw new Error("Pi test subject protocol failed.");
    if (Date.now() > deadline) throw new Error("Selected-provider interpretation did not settle within the test deadline.");
    if (child.exitCode !== null) throw new Error("Pi test subject exited before settlement.");
    await new Promise((r) => setTimeout(r, 50));
  }
  const events = records.slice(start);
  providerOutcomes.push({ input: text, messages: events.filter((r) => r.type === "message_end" && r.message?.role === "assistant").map((r) => ({ provider: r.message.provider, model: r.message.model, stopReason: r.message.stopReason, error: r.message.errorMessage ? redact(r.message.errorMessage) : null })) });
  const state = await view();
  const tools = events.filter((r) => r.type === "tool_execution_start").map((r) => r.toolName);
  checkpoints.push({ input: text, tools, state });
  assert.equal(events.filter((r) => r.type === "extension_error").length, 0, "No extension errors are allowed.");
  assert.ok(tools.length, "Representative provider must propose intake, not merely describe it.");
  assert.ok(tools.every((name) => name === "legion_intake"), "Only legion_intake may run.");
  assert.equal(events.filter((r) => r.type === "tool_execution_end" && r.isError).length, 0, "Intake proposals must commit.");
  return state;
}
try {
  execFileSync("git", ["init", "-q", cwd]);
  for (const path of [resolve("."), process.env.PI_TEST_PSTACK ?? join(host, "npm/node_modules/@zenspc/pi-pstack"), process.env.PI_TEST_SUBAGENTS ?? join(host, "npm/node_modules/pi-subagents")])
    execFileSync("pi", ["install", path], { cwd, env, stdio: "ignore" });
  const skillRoot = join(agent, "skills");
  await mkdir(skillRoot);
  for (const name of ["matt-tdd", "implement", "code-review"])
    await symlink(resolve(".agents/skills", name), join(skillRoot, name), "dir");
  await mkdir(join(skillRoot, "herdr"));
  await writeFile(join(skillRoot, "herdr/SKILL.md"), execFileSync("herdr", ["--skill"]));
  const localHerdr = JSON.parse(execFileSync("herdr", ["status", "server", "--json"]).toString());
  await mkdir(join(root, ".config/herdr"), { recursive: true });
  await symlink(localHerdr.socket, join(root, ".config/herdr/herdr.sock"));
  const isolated = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
  Object.assign(isolated, { defaultProvider: provider, defaultModel: model, defaultThinkingLevel: settings.defaultThinkingLevel, lastChangelogVersion: "1.0.4" });
  await writeFile(join(agent, "settings.json"), JSON.stringify(isolated), { mode: 0o600 });
  await writeFile(join(agent, "models-store.json"), JSON.stringify({ [provider]: { ...catalog, models: catalog.models.filter((m) => m.id === model) } }), { mode: 0o600 });
  await writeFile(join(agent, "auth.json"), JSON.stringify({ [provider]: credential }), { mode: 0o600 });
  const isolatedSettingsHash = hash(await readFile(join(agent, "settings.json")));
  child = spawn("pi", ["--mode", "rpc", "--no-context-files", "--provider", provider, "--model", model], { cwd, env: subjectEnv, stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", () => { protocolFailed = true; });
  child.stderr.on("data", () => {});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    buffer += text;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); }
      catch { protocolFailed = true; continue; }
      records.push(record);
      if (record.type === "response") {
        waiters.get(record.id)?.(record);
        waiters.delete(record.id);
      }
    }
  });
  const before = await rpc("get_state");
  assert.equal(before.model.provider, provider);
  assert.equal(before.model.id, model);
  await rpc("prompt", { message: "/legion doctor" });
  assert.equal(records.filter((r) => r.type === "agent_start").length, 0);
  diagnostics = records.filter((r) => r.method === "notify").map((r) => r.message);
  assert.equal(diagnostics.filter((text) => / (missing|unverified|incompatible)\./.test(text)).length, 0, "Actual loaded prerequisites must be ready.");
  const direct = "/legion Record a direct task to fix the spelling of the text-only fixture label from 'Helo' to 'Hello'. The approved scope is only that spelling change. Do not execute it.";
  const admitted = await turn(direct);
  assert.equal(admitted.tasks.length, 1);
  assert.equal(admitted.tasks[0].eligibility, "admitted");
  assert.equal(admitted.snapshot.submissions[0].text, direct.slice(8));
  const ambiguous = "/legion Record a separate task to add a greeting to the text-only fixture page. The product owner has not decided whether its language must be English or French. That is a material product choice, so ask before admitting the greeting. Do not execute it.";
  const blocked = await turn(ambiguous);
  assert.equal(blocked.tasks.length, 2);
  assert.equal(blocked.tasks[0].eligibility, "admitted");
  assert.equal(blocked.tasks[1].eligibility, "blocked");
  const decision = blocked.snapshot.decisions.find((d) => d.state.kind === "open" && d.history.at(-1).affected.some((t) => t.id === blocked.tasks[1].id));
  assert.ok(decision, "Material product ambiguity must persist with affected work.");
  assert.ok(decision.history.at(-1).recommendation.length);
  const entries = await rpc("get_entries");
  assert.ok(entries.entries.some((e) => e.type === "custom_message" && e.customType === "legion-decision" && e.display && e.details.decision.id === decision.id), "Decision must be presented before the answer.");
  const answer = "Use French for that greeting, please.";
  const answered = await turn(answer);
  assert.deepEqual(answered.tasks.map((t) => t.eligibility), ["admitted", "admitted"]);
  const resolution = answered.snapshot.resolutions.find((r) => r.decision.id === decision.id);
  assert.equal(resolution?.effect.kind, "record-clarification");
  assert.equal(resolution.effect.answer, answer);
  assert.equal(answered.snapshot.submissions.at(-1).evidence.transport, "rpc");
  assert.ok(answered.snapshot.submissions.at(-1).evidence.presented.some((p) => p.decision.id === decision.id));
  const after = await rpc("get_state");
  assert.deepEqual(after.model, before.model);
  assert.equal(after.thinkingLevel, before.thinkingLevel);
  assert.equal(after.autoCompactionEnabled, before.autoCompactionEnabled);
  assert.equal(hash(await readFile(join(agent, "settings.json"))), isolatedSettingsHash);
  assert.deepEqual(JSON.parse(await readFile(join(agent, "auth.json"), "utf8")), { [provider]: credential }, "Test authentication must not refresh or change.");
  await rpc("prompt", { message: "/legion off" });
  verdict = "passed";
} catch (error) {
  failure = error instanceof assert.AssertionError ? String(error.message) : "Test prerequisite, RPC, or settlement failure. No raw authentication or provider payload is retained.";
} finally {
  if (child && child.exitCode === null) {
    child.stdin.end();
    await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
  }
  try {
    testAuthenticationUnchanged = JSON.stringify(JSON.parse(await readFile(join(agent, "auth.json"), "utf8"))) === JSON.stringify({ [provider]: credential });
    const isolated = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
    testSettingsUnchanged = isolated.defaultProvider === provider && isolated.defaultModel === model;
  } catch {}
  await rm(agent, { recursive: true, force: true });
  if (testAuthenticationUnchanged === false) {
    verdict = "NOT VERIFIED";
    failure = "Test authentication changed. No representative acceptance claim is allowed.";
  }
  const originalsUnchanged = {};
  for (const [name, bytes] of originals)
    originalsUnchanged[name] = hash(await readFile(join(host, name))) === hash(bytes);
  if (Object.values(originalsUnchanged).some((ok) => !ok)) {
    verdict = "NOT VERIFIED";
    failure = "Host configuration changed during the trial. Investigate before claiming isolation.";
  }
  const result = { result: verdict, provider, model, node: process.version, transportVariables: transportNames, nodeOptions: "--use-env-proxy", root, originalsUnchanged, testAuthenticationUnchanged, testSettingsUnchanged, testAuthenticationRemoved: true, reasoningOrCompleteProviderResponsesRetained: false, failure, diagnostics, providerOutcomes, checkpoints };
  const serialized = JSON.stringify(result);
  const secrets = [credential.access, credential.refresh, credential.accountId, ...transportNames.map((name) => process.env[name])].filter((value) => typeof value === "string" && value.length);
  evidenceContainsNoSecrets = secrets.every((value) => !serialized.includes(value));
  assert.equal(evidenceContainsNoSecrets, true, "Sanitized evidence must not contain authentication or transport values.");
  result.evidenceContainsNoSecrets = evidenceContainsNoSecrets;
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, checkpoints: checkpoints.map((c) => ({ input: c.input, tools: c.tools, eligibility: c.state.tasks.map((t) => t.eligibility) })) }));
  console.error(`Evidence ${join(root, "result.json")}`);
  if (verdict !== "passed") process.exitCode = 1;
}
