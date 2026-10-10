import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, appendFile, readdir, utimes, stat, realpath } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.env.HERDR_ENV, "1");
assert.ok(process.argv[2], "Supply a new disposable production trial directory.");
const mode = process.argv[3] ?? "allowed";
assert.ok(["allowed", "read-effects", "root-deny"].includes(mode), "Select allowed, read-effects, or root-deny.");
assert.ok(process.argv[4], "Supply the authorizing Legatus session ID for verified owning-workspace placement.");
const expectedOwner = process.argv[4];
const root = resolve(process.argv[2]), cwd = join(root, "repo"), evidence = join(root, "evidence"), owned = join(root, "owned");
const retrospective = process.argv[5] === "observe";
const summaryPath = join(evidence, retrospective ? "retrospective-result.json" : "result.json");
const resume = process.argv[5] === "resume" || retrospective;
assert.ok(process.argv[5] === undefined || resume, "Only explicit resume or read-only observe may reuse a preserved fixture.");
const oldAccess = new Date("2000-01-01T00:00:00Z");
const execute = promisify(execFile);
const checkout = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const worktrees = await execute("git", ["-C", checkout, "worktree", "list", "--porcelain", "-z"], { maxBuffer: 4 * 1024 * 1024 });
const primary = worktrees.stdout.split("\0")[0];
assert.ok(primary?.startsWith("worktree "), "Primary Git project identity is unavailable. No trial directory allocated.");
const project = await realpath(primary.slice("worktree ".length));
const container = join(dirname(project), `worktrees-${basename(project)}_legion`);
assert.equal(dirname(root), container, `Trial cwd must be in a unique owned run directory under ${container}, not an arbitrary new directory.`);
assert.ok(Buffer.byteLength(join(root, "owner.sock")) < 108, "Use a shorter unique run name under the approved container for the native Unix endpoint.");
await mkdir(container, { recursive: true, mode: 0o700 });
assert.equal(await realpath(container), container, "The approved container must not redirect through a symlink.");
if (!resume) {
  await mkdir(root, { mode: 0o700 });
  for (const directory of [cwd, evidence, owned]) await mkdir(directory, { mode: 0o700 });
}
async function command(file, args) {
  try {
    const result = await execute(file, args, { maxBuffer: 4 * 1024 * 1024 });
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, exitCode: 0, ...result }) + "\n");
    return result.stdout;
  } catch (error) {
    await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, exitCode: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n");
    throw error;
  }
}
async function trial() {
let actor = null, name;
try {
  if (resume) {
    actor = JSON.parse(await readFile(join(evidence, "actor.json"), "utf8"));
    assert.equal(actor.cwd, cwd); assert.equal(actor.mode, mode);
    name = actor.name;
    const pinned = JSON.parse(await readFile(join(evidence, "source.json"), "utf8"));
    for (const source of pinned) assert.equal(createHash("sha256").update(await readFile(source.path)).digest("hex"), source.sha256, "Preserved actor source changed; do not reuse stale acceptance.");
    if (mode !== "allowed") assert.deepEqual(await readFile(join(cwd, ".pi", "extensions", "permissions.ts")), await readFile(join(evidence, "permission-source.ts")), "Preserved denial fixture changed.");
  } else {
  const server = JSON.parse(await command("herdr", ["status", "server", "--json"]));
  assert.equal(server.version, "0.9.1"); assert.equal(server.protocol, 22); assert.equal(server.restart_needed, false);
  name = `t04-prod-${randomUUID().slice(0, 8)}`;
  await command("git", ["init", "-q", "-b", "main", cwd]);
  await writeFile(join(cwd, "README.md"), "Production Centurio reads this disposable file.\n");
  if (mode !== "allowed") {
    const extensionDirectory = join(cwd, ".pi", "extensions");
    await mkdir(extensionDirectory, { recursive: true, mode: 0o700 });
    const policy = `import { appendFileSync } from "node:fs";
export default function (pi) {
  const child = process.env.PI_SUBAGENT_CHILD === "1";
  const record = value => appendFileSync(${JSON.stringify(join(evidence, "permissions.jsonl"))}, JSON.stringify({ child, ...value }) + "\\n");
  pi.on("session_start", (_event, ctx) => record({ kind: "loaded", session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), pid: process.pid, model: ctx.model.provider + "/" + ctx.model.id, tools: pi.getAllTools() }));
  pi.on("tool_call", (event, ctx) => {
    if ((${JSON.stringify(mode)} === "root-deny" && !child && event.toolName === "subagent" && event.input.agent) ||
        (child && event.toolName === "read" && event.input.path === ${JSON.stringify(join(cwd, "denied.txt"))})) {
      record({ kind: "denied", session: ctx.sessionManager.getSessionId(), event });
      return { block: true, reason: "Independent test-owned ordinary permission policy denied this exact effect." };
    }
  });
  pi.on("tool_execution_end", (event, ctx) => { if (child && event.toolName === "read") record({ kind: "result", session: ctx.sessionManager.getSessionId(), event }); });
}
`;
    await writeFile(join(extensionDirectory, "permissions.ts"), policy);
    await writeFile(join(evidence, "permission-source.ts"), policy);
    await writeFile(join(cwd, "denied.txt"), "DENIED_NATIVE_CONTENT_MUST_NOT_ESCAPE\n");
  }
  await command("git", ["-C", cwd, "add", "README.md"]);
  await command("git", ["-C", cwd, "-c", "user.name=Trial", "-c", "user.email=trial@example.invalid", "commit", "-qm", "Disposable production runtime trial"]);
  assert.ok(process.env.HERDR_PANE_ID, "The authorizing Legatus pane is unavailable.");
  const caller = JSON.parse(await command("herdr", ["pane", "get", process.env.HERDR_PANE_ID])).result.pane;
  assert.equal(caller.agent, "pi");
  assert.ok(caller.agent_session, "The authorizing Legatus Pi session is unavailable.");
  const session = caller.agent_session.kind === "id" ? caller.agent_session.value
    : JSON.parse((await readFile(caller.agent_session.value, "utf8")).split("\n")[0]).id;
  assert.equal(session, expectedOwner, "Caller identity must match the authorizing Legatus session.");
  await writeFile(join(evidence, "caller.json"), JSON.stringify({ caller, session }, null, 2));
  await utimes(join(cwd, "README.md"), oldAccess, oldAccess);
  if (mode !== "allowed") await utimes(join(cwd, "denied.txt"), oldAccess, oldAccess);
  const created = JSON.parse(await command("herdr", ["tab", "create", "--workspace", caller.workspace_id, "--cwd", cwd, "--label", name, "--no-focus"]));
  assert.equal(created.result.root_pane.workspace_id, caller.workspace_id);
  assert.notEqual(created.result.root_pane.tab_id, caller.tab_id);
  actor = { name, cwd, mode, server, pane: created.result.root_pane };
  await writeFile(join(evidence, "actor.json"), JSON.stringify(actor, null, 2));
  const production = fileURLToPath(new URL("../src/centuriones.ts", import.meta.url));
  const files = (await readdir(fileURLToPath(new URL("../src/", import.meta.url)))).filter(file => file.endsWith(".ts"));
  await writeFile(join(evidence, "source.json"), JSON.stringify(await Promise.all(files.map(async file => {
    const path = fileURLToPath(new URL(`../src/${file}`, import.meta.url));
    return { path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
  })), null, 2));
  const parent = join(root, "parent.mjs"), endpoint = join(root, "owner.sock");
  await writeFile(parent, `import { Centuriones, CenturioRequest } from ${JSON.stringify(production)};
import { createServer } from "node:net";
import { writeFileSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
export default function (pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  let children, server, context, launch, activityHold = false;
  const pendingActivity = [];
  function observeActivity(kind, raw, allowPending = true) {
    appendFileSync(${JSON.stringify(join(evidence, "native-activity.jsonl"))}, JSON.stringify({ kind, raw }) + "\\n");
    try {
      const result = children?.observeActivity(kind, raw);
      if (result === "owned") return;
      if (result === "pending" && allowPending) { pendingActivity.push({ kind, raw }); return; }
      throw new Error("Structured native activity is not this exact owned launch.");
    } catch (error) {
      activityHold = true;
      writeFileSync(${JSON.stringify(join(evidence, "native-activity-hold.json"))}, JSON.stringify({ kind, error: String(error) }));
    }
  }
  const subscriptions = [pi.events.on("subagent:async-started", raw => observeActivity("started", raw)), pi.events.on("subagent:async-complete", raw => observeActivity("complete", raw))];
  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    const owner = { launch: randomUUID(), generation: randomUUID(), session: ctx.sessionManager.getSessionId(), window: { endpoint: ${JSON.stringify(server.socket)}, server: "trial-owned-server", workspace: ${JSON.stringify(actor.pane.workspace_id)}, tab: ${JSON.stringify(actor.pane.tab_id)}, pane: ${JSON.stringify(actor.pane.pane_id)}, terminal: ${JSON.stringify(actor.pane.terminal_id)} } };
    children = new Centuriones(pi, ${JSON.stringify(owned)}, owner, ${JSON.stringify(endpoint)}, randomUUID(), async (intent, stage, actual) => {
      if (actual.sessionManager.getSessionId() !== owner.session || actual.cwd !== ${JSON.stringify(cwd)} || intent.owner.session !== owner.session) throw new Error("Controlled external authority rejected a foreign principal.");
      appendFileSync(${JSON.stringify(join(evidence, "authority-checks.jsonl"))}, JSON.stringify({ intent: intent.id, stage, session: actual.sessionManager.getSessionId() }) + "\\n");
    });
    server = createServer(socket => {
      let buffer = "";
      socket.on("data", async chunk => {
        buffer += chunk;
        if (!buffer.includes("\\n")) return;
        socket.removeAllListeners("data");
        try { socket.end(JSON.stringify(await children.checkChild(JSON.parse(buffer.slice(0, buffer.indexOf("\\n"))), context)) + "\\n"); }
        catch (error) { appendFileSync(${JSON.stringify(join(evidence, "guard-errors.jsonl"))}, JSON.stringify({ error: String(error) }) + "\\n"); socket.end(JSON.stringify({ kind: "held", message: String(error) }) + "\\n"); }
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(${JSON.stringify(endpoint)}, resolve); });
    const assignment = { command: randomUUID(), value: { task: { id: randomUUID(), revision: 1 }, scope: "disposable-production-trial", goal: "Read the disposable README", acceptance: ["Return the actual README text"], workflow: "implement", testContract: "Matt TDD at Legatus-approved public seams; request an explicit exception if impractical", authority: "bounded-implementation-only" } };
    const prepared = children.prepare(CenturioRequest.parse({ purpose: "exploration", role: "how explorer", task: ${JSON.stringify(`Read ${join(cwd, "README.md")} once with the native read tool.${mode === "read-effects" ? ` Then attempt exactly one native read of ${join(cwd, "denied.txt")}; expect ordinary permission denial and do not retry or use another tool. Report the successful README contents and the refusal, not denied contents.` : " Return its text."} Do not mutate or delegate. This disposable runtime trial grants no implementation authority.`)}, timeoutMs: 5400000 }), assignment, { owner: randomUUID(), session: "controlled-external-trial-controller", generation: 1, epoch: 0 }, ctx);
    launch = prepared.launch;
    writeFileSync(${JSON.stringify(join(evidence, "principal.json"))}, JSON.stringify({ owner, assignment, launch, pid: process.pid, model: ctx.model.provider + "/" + ctx.model.id, journal: ctx.sessionManager.getSessionFile(), limitation: "The external controller is controlled. Registration, role resolution, native admission, guard, runtime joins and observation use production code." }), { flag: "wx", mode: 0o600 });
  });
  pi.on("tool_call", async (event, ctx) => {
    if (activityHold || !["subagent", "subagents_enable"].includes(event.toolName)) return { block: true, reason: "The trial permits one exact native production child launch with reconciled activity." };
    try { await children.admit(event, ctx); }
    catch (error) { return { block: true, reason: String(error) }; }
  });
  pi.on("tool_result", event => { children?.observeInput(event); });
  pi.on("tool_execution_end", (event, ctx) => {
    children?.observeLaunch(event, ctx);
    if (event.toolName === "subagent") for (const activity of pendingActivity.splice(0)) observeActivity(activity.kind, activity.raw, false);
    if (event.toolName === "subagent") appendFileSync( ${JSON.stringify(join(evidence, "native-calls.jsonl"))}, JSON.stringify(event) + "\\n");
    const exact = ctx.sessionManager.getBranch().some(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(call => call.type === "toolCall" && call.id === event.toolCallId && call.name === "subagent" && isDeepStrictEqual(call.arguments, launch)));
    if (event.toolName === "subagent" && exact && (event.isError || event.result?.details?.runId)) writeFileSync(${JSON.stringify(join(evidence, "native-result.json"))}, JSON.stringify(event), { flag: "wx", mode: 0o600 });
  });
  pi.on("input", event => event.source === "extension" ? { action: "handled" } : undefined);
  pi.on("context", event => ({ messages: event.messages.map(message => message.role === "custom" && message.customType === "subagent-notify" ? { ...message, content: "Native child lifecycle retained in the disposable production trial evidence.", details: undefined } : message) }));
  pi.on("session_shutdown", () => { children?.dispose(); server?.close(); for (const unsubscribe of subscriptions) unsubscribe(); });
}
`);
  const observed = JSON.parse(await command("herdr", ["pane", "get", actor.pane.pane_id])).result.pane;
  assert.equal(observed.terminal_id, actor.pane.terminal_id); assert.equal(observed.foreground_cwd, cwd); assert.equal(observed.agent, undefined);
  await command("herdr", ["agent", "start", name, "--kind", "pi", "--pane", actor.pane.pane_id, "--", "-e", parent]);
  }
  assert.ok(process.env.HERDR_PANE_ID, "Current authorizing caller is unavailable.");
  const requester = JSON.parse(await command("herdr", ["pane", "get", process.env.HERDR_PANE_ID])).result.pane;
  assert.equal(requester.agent, "pi"); assert.ok(requester.agent_session);
  const requesterSession = requester.agent_session.kind === "id" ? requester.agent_session.value : JSON.parse((await readFile(requester.agent_session.value, "utf8")).split("\n")[0]).id;
  assert.equal(requesterSession, expectedOwner); assert.equal(requester.workspace_id, actor.pane.workspace_id);
  const current = JSON.parse(await command("herdr", ["agent", "get", name])).result.agent;
  assert.equal(current.pane_id, actor.pane.pane_id); assert.equal(current.terminal_id, actor.pane.terminal_id); assert.equal(current.foreground_cwd, cwd);
  const startupDeadline = Date.now() + 30000;
  while (!(await readdir(evidence)).includes("principal.json") && Date.now() < startupDeadline) {
    const ui = await command("herdr", ["agent", "read", name, "--source", "recent-unwrapped", "--lines", "45"]);
    if (ui.includes("Trust project folder?")) {
      await writeFile(join(evidence, "startup-ui.txt"), ui);
      throw new Error(`HUMAN_TRUST_REQUIRED cwd=${cwd} pane=${actor.pane.pane_id} tab=${actor.pane.tab_id}. Operator must personally review and resolve ordinary project trust. No prompt or trust action performed.`);
    }
    await delay(250);
  }
  if (!(await readdir(evidence)).includes("principal.json")) {
    await writeFile(join(evidence, "startup-agent.json"), await command("herdr", ["agent", "get", name]));
    await writeFile(join(evidence, "startup-ui.txt"), await command("herdr", ["agent", "read", name, "--source", "recent-unwrapped", "--lines", "80"]));
    throw new Error("Native startup identity is unavailable. Inspect retained UI for normal project-trust or extension diagnostics; no prompt, approval, retry, or alternate launch was performed.");
  }
  const principal = JSON.parse(await readFile(join(evidence, "principal.json"), "utf8"));
  const addressed = JSON.parse(await command("herdr", ["agent", "get", name])).result.agent;
  assert.equal(addressed.pane_id, actor.pane.pane_id); assert.equal(addressed.terminal_id, actor.pane.terminal_id); assert.equal(addressed.foreground_cwd, cwd);
  assert.ok(addressed.agent_session, "Actual native principal session is unavailable.");
  assert.equal(addressed.agent_session.value, addressed.agent_session.kind === "id" ? principal.owner.session : principal.journal, "Do not adopt a replacement principal.");
  if (!retrospective) {
    assert.equal((await readdir(evidence)).includes("native-calls.jsonl"), false, "A preserved submitted trial must be reconciled, not reprompted.");
    await command("herdr", ["agent", "prompt", name, `Authorized disposable production runtime trial. Use subagents_enable if needed, then call the native root subagent tool once with exactly this input. Strict subagent capability discovery {action:"list",capabilities:true} is allowed preparation if the loader requests it. Then perform the exact launch below. No other tools or executors. Yield after launch. ${JSON.stringify(principal.launch)}`, "--wait", "--timeout", "120000"]);
  }
  const entries = (await readFile(principal.journal, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  const exactCalls = entries.flatMap(entry => entry.type === "message" && entry.message.role === "assistant" ? entry.message.content : []).filter(call => call.type === "toolCall" && call.name === "subagent" && isDeepStrictEqual(call.arguments, principal.launch));
  assert.equal(exactCalls.length, 1, "Exactly one durable launch must be correlated; do not selectively accept repeated calls.");
  const nativeEvents = (await readFile(join(evidence, "native-calls.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  const selected = nativeEvents.filter(event => event.toolName === "subagent" && event.toolCallId === exactCalls[0].id);
  assert.equal(selected.length, 1, "The exact durable launch must have exactly one native result.");
  const result = selected[0];
  const interpreterSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  await writeFile(join(evidence, "selected-native-result.json"), JSON.stringify({ retrospective, interpreterSha256, principal: principal.owner, launch: principal.launch, event: result }, null, 2));
  if (mode === "root-deny") {
    assert.equal(result.isError, true);
    const policies = (await readFile(join(evidence, "permissions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.ok(policies.some(row => row.kind === "loaded" && !row.child && row.session === principal.owner.session));
    assert.ok(policies.some(row => row.kind === "denied" && !row.child && row.session === principal.owner.session && row.event.toolName === "subagent" && row.event.toolCallId === result.toolCallId && isDeepStrictEqual(row.event.input, principal.launch)));
    assert.equal(nativeEvents.some(event => event.result?.details?.runId), false, "No native child launch may escape root denial.");
    assert.equal(policies.some(row => row.child), false, "Root denial must not create a child runtime.");
    const checks = (await readdir(evidence)).includes("authority-checks.jsonl") ? (await readFile(join(evidence, "authority-checks.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    assert.equal(checks.some(row => row.stage === "read"), false, "Root denial must not authorize child effects.");
    await writeFile(summaryPath, JSON.stringify({ verdict: "ROOT_PERMISSION_DENIAL_PASS", retrospective, interpreterSha256, actor, principal, policies, limitation: "Independent test-owned denial policy exercises ordinary native tool_call, not every user policy. No child was launched." }, null, 2));
    process.stdout.write(`ROOT_PERMISSION_DENIAL_PASS ${root}\n`);
    process.exitCode = 0;
    return;
  }
  assert.equal(result.isError, false);
  assert.ok(result.result?.details?.runId && result.result.details.asyncDir, "Exact native child identity is unavailable.");
  const nativeDirectory = result.result.details.asyncDir;
  const deadline = Date.now() + (retrospective ? 0 : 120000);
  let status, proof;
  do {
    status = JSON.parse(await readFile(join(nativeDirectory, "status.json"), "utf8"));
    if ((await readdir(nativeDirectory)).includes("process-terminal.json")) proof = JSON.parse(await readFile(join(nativeDirectory, "process-terminal.json"), "utf8"));
    if (proof?.state === "observed" && isDeepStrictEqual(proof, status.processTerminal)) break;
    if (retrospective) break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.equal(status.runId, result.result.details.runId); assert.equal(status.cwd, cwd);
  assert.ok([principal.owner.session, principal.journal].includes(status.sessionId));
  assert.equal(status.steps.length, 1); assert.equal(status.steps[0].agent, principal.launch.agent);
  assert.equal(status.steps[0].model, principal.launch.model); assert.equal(status.steps[0].requestedModel, principal.launch.model);
  assert.equal(status.steps[0].context, "fresh"); assert.equal(status.launchContractDigest, result.result.details.launchContractDigest);
  assert.ok(status.launchResolvedExtensions.required.includes("pi-legion-centurio"));
  assert.equal(proof?.state, "observed", "Native process close is unresolved; do not infer termination from a report.");
  assert.equal(proof.runId, status.runId); assert.deepEqual(proof, status.processTerminal);
  const runner = proof.instances.filter(instance => instance.kind === "runner" && instance.processInstanceId === proof.runnerProcessInstanceId);
  assert.equal(runner.length, 1); assert.equal(runner[0].exitCode, 0); assert.equal(runner[0].signal, null);
  assert.ok(runner[0].closeObservedAt <= proof.observedAt);
  let projection, latest;
  do {
    const files = (await readdir(owned)).filter(file => file.endsWith(".centuriones.json"));
    const observations = await Promise.all(files.map(async file => ({ path: join(owned, file), value: JSON.parse(await readFile(join(owned, file), "utf8")) })));
    projection = observations.sort((a, b) => b.value.sequence - a.value.sequence)[0];
    latest = projection?.value.children[0];
    if (retrospective || latest?.state.kind === "process-terminal" || ["unknown", "mismatch"].includes(latest?.state.kind)) break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.ok(latest, "Production child projection is unavailable.");
  assert.equal(latest.state.kind, "process-terminal", "Production child lifecycle must independently settle to process-terminal; no pending/unknown/mismatch hold is acceptance.");
  assert.equal(latest.state.run, status.runId);
  assert.deepEqual(JSON.parse(await readFile(latest.state.proof, "utf8")), proof);
  assert.equal((await readdir(evidence)).includes("native-activity-hold.json"), false, "Structured native activity must be exactly owned, not ignored.");
  const binding = principal.launch.extensionBindings["pi-legion/1"];
  const intent = JSON.parse(await readFile(binding.path, "utf8"));
  assert.equal(latest.id, intent.intent.id); assert.deepEqual(intent.intent.owner, principal.owner);
  assert.equal(intent.digest, binding.digest); assert.equal(intent.intent.role.model, principal.launch.model); assert.equal(intent.intent.cwd, cwd);
  const startup = JSON.parse(await readFile(join(owned, `${latest.id}.centurio-startup.json`), "utf8"));
  assert.equal(startup.kind, "startup-authorized"); assert.deepEqual(startup.owner, principal.owner);
  assert.equal(startup.child.model, principal.launch.model); assert.equal(startup.child.cwd, cwd);
  assert.equal(startup.child.journal, status.steps[0].sessionFile); assert.deepEqual(startup.child.binding, binding);
  const childJournalText = await readFile(startup.child.journal, "utf8");
  const childEntries = childJournalText.trimEnd().split("\n").map(line => JSON.parse(line));
  assert.equal(childEntries[0].id, startup.child.session);
  assert.equal(latest.state.session, startup.child.session);
  assert.ok(latest.result, "Completed native findings must be retained.");
  const retained = JSON.parse(await readFile(latest.result.evidence, "utf8"));
  const final = childEntries.filter(entry => entry.type === "message" && entry.message.role === "assistant").at(-1);
  assert.equal(final?.message.stopReason, "stop");
  assert.deepEqual(retained.message, { type: final.type, id: final.id, message: { role: final.message.role, stopReason: final.message.stopReason, content: final.message.content } });
  assert.deepEqual(Buffer.from(retained.journalBytes, "base64"), Buffer.from(childJournalText), "Retained full native journal bytes must match the independently observed finding source.");
  assert.equal(retained.journalSha256, createHash("sha256").update(Buffer.from(retained.journalBytes, "base64")).digest("hex"));
  assert.equal(retained.source, `${startup.child.journal}#${final.id}`);
  assert.equal(retained.source, latest.result.source);
  const completedText = final.message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  assert.equal(Buffer.from(retained.bytes, "base64").toString("utf8"), completedText);
  assert.equal(createHash("sha256").update(Buffer.from(retained.bytes, "base64")).digest("hex"), latest.result.sha256);
  const reads = childEntries.flatMap(entry => entry.type === "message" && entry.message.role === "assistant" ? entry.message.content : []).filter(call => call.type === "toolCall" && call.name === "read");
  const permittedCalls = reads.filter(call => call.arguments.path === join(cwd, "README.md"));
  assert.equal(permittedCalls.length, 1);
  const permittedResults = childEntries.filter(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === permittedCalls[0].id);
  assert.equal(permittedResults.length, 1); assert.equal(permittedResults[0].message.isError, false);
  assert.ok(permittedResults[0].message.content.some(part => part.text === "Production Centurio reads this disposable file.\n"));
  let completions = [];
  do {
    if ((await readdir(evidence)).includes("native-activity.jsonl")) completions = (await readFile(join(evidence, "native-activity.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line)).filter(event => event.kind === "complete" && event.raw.runId === status.runId);
    if (completions.length || retrospective) break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.ok(completions.length, "This native correlation trial must retain the structured completion, not notification prose.");
  for (const { raw: completion } of completions) {
    assert.equal(completion.id, status.runId);
    assert.equal(completion.sessionId, status.sessionId);
    assert.equal(completion.completionOwnerId, status.completionOwnerId);
    assert.equal(completion.asyncDir, nativeDirectory);
    assert.equal(completion.sessionFile, startup.child.journal);
  }
  const finalObservations = await Promise.all((await readdir(owned)).filter(file => file.endsWith(".centuriones.json")).map(async file => JSON.parse(await readFile(join(owned, file), "utf8"))));
  const finalProjection = finalObservations.sort((a, b) => b.sequence - a.sequence)[0];
  assert.deepEqual(finalProjection.children[0].state, latest.state, "Completion observation must not hide a later child hold.");
  assert.equal((await readdir(evidence)).includes("native-activity-hold.json"), false);
  const permittedReadRecordedAt = Date.parse(permittedResults[0].timestamp);
  assert.ok(Number.isFinite(permittedReadRecordedAt));
  await writeFile(join(evidence, "native-joined-evidence.json"), JSON.stringify({ retrospective, interpreterSha256, exactCall: exactCalls[0], native: result, status, proof, startup, latest, completions, productionProjection: projection.path, permittedReadRecordedAt, limitation: "Production read-only lifecycle and native effect/permission joins with a controlled external controller, not integrated Legion acceptance; timestamps are supplemental." }, null, 2));
  if (mode === "read-effects") {
    const policies = (await readFile(join(evidence, "permissions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.ok(policies.some(row => row.kind === "loaded" && row.child && row.session === startup.child.session), "Independent child permission fixture must actually load.");
    assert.ok(policies.some(row => row.kind === "denied" && row.child && row.session === startup.child.session));
    const results = policies.filter(row => row.kind === "result" && row.child && row.session === startup.child.session);
    assert.ok(results.some(row => !row.event.isError && row.event.result.content.some(part => part.text?.includes("Production Centurio reads this disposable file."))), "Permitted native baseline read must execute.");
    assert.ok(results.some(row => row.event.isError && row.event.result.content.some(part => part.text?.includes("Independent test-owned ordinary permission policy denied"))), "Ordinary child denial must prevent the native read.");
    assert.equal(results.some(row => row.event.result.content.some(part => part.text?.includes("DENIED_NATIVE_CONTENT_MUST_NOT_ESCAPE"))), false);
    assert.equal(childJournalText.includes("DENIED_NATIVE_CONTENT_MUST_NOT_ESCAPE"), false, "Protected contents must not appear in the actual execution journal.");
    const deniedCalls = reads.filter(call => call.arguments.path === join(cwd, "denied.txt"));
    assert.equal(deniedCalls.length, 1, "No retries or alternative reads of the denied target.");
    const blocked = policies.filter(row => row.kind === "denied" && row.child && row.session === startup.child.session && row.event.toolCallId === deniedCalls[0].id);
    assert.equal(blocked.length, 1); assert.equal(blocked[0].event.toolName, "read");
    assert.ok(Object.keys(deniedCalls[0].arguments).every(key => ["path", "offset", "limit"].includes(key)));
    const runtimeReadInput = Object.fromEntries(Object.entries(deniedCalls[0].arguments).filter(([key, value]) => !(["offset", "limit"].includes(key) && value === null)));
    assert.deepEqual(blocked[0].event.input, runtimeReadInput, "Supported optional-null transport normalization must still identify the exact blocked read.");
    const deniedResults = childEntries.filter(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === deniedCalls[0].id);
    assert.equal(deniedResults.length, 1); assert.equal(deniedResults[0].message.isError, true);
    assert.ok(deniedResults[0].message.content.some(part => part.text === "Independent test-owned ordinary permission policy denied this exact effect."));
    const loaded = policies.find(row => row.kind === "loaded" && row.child && row.session === startup.child.session);
    assert.equal(loaded.journal, startup.child.journal); assert.equal(loaded.model, principal.launch.model);
    assert.equal(loaded.tools.find(tool => tool.name === "read").sourceInfo.path, fileURLToPath(new URL("../src/centurio-guard.ts", import.meta.url)));
    const access = { permitted: (await stat(join(cwd, "README.md"))).atimeMs, denied: (await stat(join(cwd, "denied.txt"))).atimeMs, baseline: oldAccess.getTime() };
    await writeFile(join(evidence, "native-access.json"), JSON.stringify(access, null, 2));
    assert.ok(access.permitted > access.baseline, "Baseline native read must produce real filesystem access.");
    assert.equal(access.denied, access.baseline, "Denied native read must not access its target.");
  }
  const verdict = mode === "read-effects" ? "OWNED_READ_ONLY_LIFECYCLE_PERMISSION_PASS" : "OWNED_READ_ONLY_LIFECYCLE_PASS";
  const outcome = { verdict, retrospective, interpreterSha256, actor, latest, integratedLegionAcceptance: false, lifecycleHoldUnresolved: false, limitation: "Controlled external controller. Production owned read-only lifecycle, native effects and independent process-close evidence; not integrated managed-Tribunus acceptance, Unit A, or #5 acceptance. Does not prove every user-installed permission policy." };
  await writeFile(summaryPath, JSON.stringify(outcome, null, 2));
  process.stdout.write(`${verdict} ${root}\n`);
} catch (error) {
  const verdict = String(error).includes("HUMAN_TRUST_REQUIRED") ? "HUMAN_TRUST_REQUIRED" : "CONTINUATION_BLOCKED";
  await writeFile(join(evidence, `attempt-${randomUUID()}.json`), JSON.stringify({ verdict, actor, error: String(error) }, null, 2));
  await writeFile(summaryPath, JSON.stringify({ verdict, retrospective, actor, error: String(error), limitation: "No retry, alternate executor, permission changes or actor cleanup. Trust remains a human decision; resume requires exact preserved actor verification." }, null, 2));
  process.stderr.write(`${verdict} ${root} ${String(error)}\n`);
  process.exitCode = 1;
}
}
await trial();
