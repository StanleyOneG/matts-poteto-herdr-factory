import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, appendFile, readdir, realpath, symlink } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Legion } from "../src/intake.ts";
import { GitWorkspace } from "../src/git-workspace.ts";
import { LocalTribunusHost } from "../src/tribunus-host.ts";
import { getAgentDir, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const execute = promisify(execFile);

/** Verify public owned-child state against independently retained native artifacts. */
export async function verifyWritablePublicEvidence(view) {
  const task = view.tasks[0], launch = task.launch;
  assert.ok(["assigned", "reported"].includes(launch.kind));
  const children = launch.worker.resources.children.filter(child => child.purpose === "implementation");
  assert.equal(children.length, 1);
  const child = children[0];
  assert.equal(child.state.kind, "process-terminal", "Logical/model completion does not prove native process termination.");
  assert.ok(child.result);
  const proof = await json(child.state.proof);
  assert.equal(proof.state, "observed"); assert.equal(proof.runId, child.state.run);
  const runners = proof.instances.filter(instance => instance.kind === "runner" && instance.processInstanceId === proof.runnerProcessInstanceId);
  assert.equal(runners.length, 1); assert.equal(runners[0].exitCode, 0); assert.equal(runners[0].signal, null);
  const result = await json(child.result.evidence);
  assert.equal(hash(Buffer.from(result.bytes, "base64")), child.result.sha256);
  const journal = Buffer.from(result.journalBytes, "base64");
  assert.equal(hash(journal), result.journalSha256);
  const entries = journal.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  const intentPath = child.evidence.find(path => path.endsWith(".centurio-intent.json"));
  const record = await json(intentPath), intent = record.intent;
  const startup = await json(intentPath.replace(".centurio-intent.json", ".centurio-startup.json"));
  assert.equal(startup.child.model, intent.role.model, "Startup model must independently join the configured role.");
  assert.equal(startup.kind, "startup-authorized");
  assert.deepEqual(startup.owner, intent.owner);
  assert.deepEqual(startup.child.binding, { path: intentPath, digest: record.digest });
  assert.equal(startup.child.session, child.state.session);
  assert.equal(startup.child.cwd, intent.cwd);
  assert.equal(entries[0].id, startup.child.session);
  assert.equal(entries[0].cwd, intent.cwd);
  assert.equal(result.session, startup.child.session);
  assert.equal(result.run, child.state.run);
  assert.equal(result.source.split("#")[0], startup.child.journal);
  // Retention may precede later append-only native entries. Corroborate the
  // entire raw snapshot prefix, never its self-hash alone or reserialized JSON.
  const originalJournal = await readFile(startup.child.journal);
  assert.ok(journal.length > 0 && journal.at(-1) === 10, "Original native journal snapshot must end on an entry boundary.");
  assert.deepEqual(originalJournal.subarray(0, journal.length), journal, "Original native journal bytes must corroborate the retained snapshot.");
  assert.equal(child.result.source, result.source, "Exact retained native finding source required.");
  const findings = entries.filter(entry => `${startup.child.journal}#${entry.id}` === result.source);
  assert.equal(findings.length, 1, "Exact retained native finding entry required.");
  const finding = findings[0];
  assert.equal(finding.type, "message"); assert.equal(finding.message.role, "assistant"); assert.equal(finding.message.stopReason, "stop");
  const findingBytes = Buffer.from(finding.message.content.filter(part => part.type === "text").map(part => part.text).join("\n"));
  assert.deepEqual(Buffer.from(result.bytes, "base64"), findingBytes, "Exact retained native finding bytes required.");
  assert.equal(result.sha256, child.result.sha256);
  assert.equal(result.message.id, finding.id);
  assert.deepEqual(result.message.message.content, finding.message.content);
  const statuses = await Promise.all(child.evidence.filter(path => path.endsWith(".centurio-status.json")).map(json));
  assert.ok(statuses.length > 0, "Independent native status required.");
  for (const status of statuses) {
    assert.equal(status.runId, child.state.run);
    assert.equal(status.cwd, intent.cwd);
    assert.equal(status.mode, "single"); assert.equal(status.currentStep, 0);
    assert.equal(status.steps.length, 1);
    const step = status.steps[0];
    assert.equal(step.agent, intent.agent); assert.equal(step.context, "fresh");
    assert.equal(step.model, intent.role.model); assert.equal(step.requestedModel, intent.role.model);
    assert.equal(step.sessionFile, startup.child.journal);
    assert.equal(status.launchContractDigest, step.launchContractDigest);
    assert.equal(status.launchResolvedExtensions.disableAmbientExtensions, false);
    assert.ok(status.launchResolvedExtensions.required.includes("pi-legion-centurio"));
    assert.equal(status.processTerminal.runnerProcessInstanceId, proof.runnerProcessInstanceId);
  }
  assert.equal(intent.purpose, "implementation"); assert.ok(intent.writable);
  assert.equal(child.model, intent.role.model); assert.equal(intent.role.name, "feature, refactoring");
  let roleBytes = null;
  try { roleBytes = await readFile(intent.role.configuration, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  assert.equal(hash(JSON.stringify(roleBytes)), intent.role.digest);
  const roleConfig = roleBytes === null ? { version: 1, roles: {} } : JSON.parse(roleBytes);
  const selected = roleConfig.roles[intent.role.name] ?? "inherit-parent";
  const selector = Array.isArray(selected) ? selected[intent.role.index] : selected;
  assert.equal(["auto", "inherit-parent"].includes(selector) ? intent.role.parentModel : selector, child.model);
  assert.equal(intent.owner.session, launch.worker.address.session);
  assert.equal(intent.assignment.command, launch.command);
  const nativeTools = new Map([createWriteToolDefinition(intent.cwd), createEditToolDefinition(intent.cwd), createBashToolDefinition(intent.cwd)].map(tool => [tool.name, tool]));
  const effects = view.snapshot.effects.filter(effect => effect.intent.origin?.kind === "centurio" && effect.intent.origin.child.id === child.id);
  assert.ok(effects.some(effect => effect.intent.call.name === "write" && effect.state.kind === "completed"));
  assert.ok(effects.some(effect => effect.intent.call.name === "bash" && effect.state.kind === "completed" && effect.state.exitCode === 0));
  const outcomes = new Map();
  function joinResult(nativeResult, message) {
    assert.deepEqual(nativeResult.content ?? [], message.content, "Native outcome content must match the persisted tool result.");
    assert.deepEqual(nativeResult.details, message.details, "Native outcome details must match the persisted tool result.");
    assert.deepEqual(nativeResult.usage, message.usage, "Native outcome usage must match the persisted tool result.");
    assert.equal(nativeResult.isError ?? false, message.isError, "Native outcome error status must match the persisted tool result.");
    // Native Pi persists content/details/usage, not structuredContent. Controlled
    // adapters may retain it as well, in which case it must agree exactly.
    if (message.structuredContent !== undefined) assert.deepEqual(nativeResult.structuredContent, message.structuredContent, "Native structured outcome must match the persisted tool result.");
  }
  for (const effect of effects) {
    assert.notEqual(effect.state.kind, "outstanding"); assert.notEqual(effect.state.kind, "unknown");
    assert.equal(effect.intent.origin.run, child.state.run);
    assert.equal(effect.intent.origin.cwd, intent.cwd);
    assert.equal(effect.intent.origin.branch, intent.writable.workspace.plan.branch);
    assert.equal(effect.intent.origin.base, intent.writable.workspace.plan.commit);
    assert.equal(effect.intent.contract.verification.kind, "verified");
    for (const resource of effect.intent.contract.resources) {
      const bytes = await readFile(resource.canonicalPath);
      assert.equal(hash(bytes), resource.digest, "Exact selected resource bytes must remain pinned.");
      if (resource.load.kind === "not-required") continue;
      assert.equal(resource.load.kind, "complete", "Actual native resource loading required.");
      const covered = new Set();
      const lines = bytes.toString("utf8").split("\n");
      // Render pinned text bytes through the supported native definition, not a
      // verifier-specific approximation of its limits and continuation notices.
      const nativeRead = createReadToolDefinition(intent.cwd, { operations: {
        access: async path => assert.equal(await realpath(path), resource.canonicalPath, "Exact selected native read path required."),
        readFile: async () => bytes,
      } });
      for (const load of resource.load.evidence) {
        assert.equal(load.kind, "read", "Writable child must actually read its selected resources.");
        const [path, callEntry] = load.call.split("#"), [resultPath, resultEntry] = load.result.split("#");
        assert.equal(path, startup.child.journal); assert.equal(resultPath, path);
        const calls = entries.flatMap(entry => entry.type === "message" && entry.message.role === "assistant"
          ? entry.message.content.filter(part => part.type === "toolCall" && part.name === "read" && part.id === load.toolCallId).map(read => ({ assistant: entry, read })) : []);
        assert.equal(calls.length, 1, "Exact unique resource read call required.");
        const { assistant, read } = calls[0];
        assert.equal(assistant.id, callEntry);
        assert.equal(load.call, `${path}#${assistant.id}`, "Exact resource call provenance required.");
        const raw = structuredClone(read.arguments);
        const prepared = nativeRead.prepareArguments ? nativeRead.prepareArguments(raw) : raw;
        const input = validateToolArguments(nativeRead, { type: "toolCall", id: read.id, name: "read", arguments: prepared });
        const expected = await nativeRead.execute(read.id, input);
        const truncation = expected.details?.truncation;
        assert.ok(!truncation?.firstLineExceedsLimit && !truncation?.lastLinePartial, "Only complete native resource lines prove coverage.");
        const startLine = (input.offset ? Math.max(0, input.offset - 1) : 0) + 1;
        const endLine = truncation?.truncated ? startLine + truncation.outputLines - 1
          : Math.min(lines.length, startLine - 1 + (input.limit ?? lines.length));
        assert.ok(Number.isInteger(startLine) && Number.isInteger(endLine) && startLine <= endLine, "Complete native resource read range required.");
        assert.equal(load.startLine, startLine, "Claimed resource read range must match normalized native offset.");
        assert.equal(load.endLine, endLine, "Claimed resource read range must match normalized native limit/truncation.");
        const results = entries.filter(entry => entry.message?.role === "toolResult" && entry.message.toolName === "read" && entry.message.toolCallId === read.id);
        assert.equal(results.length, 1, "Unique native resource result required.");
        assert.equal(results[0].id, resultEntry);
        assert.equal(load.result, `${path}#${results[0].id}`, "Exact resource result provenance required.");
        assert.ok(entries.indexOf(results[0]) > entries.indexOf(assistant), "Native resource result must follow its exact read call.");
        const message = results[0].message;
        assert.equal(message.isError, false);
        assert.deepEqual(message.content, expected.content, "Successful native resource read must match exact supported output.");
        assert.deepEqual(message.details, expected.details, "Native resource truncation metadata must match exact supported output.");
        if (message.structuredContent !== undefined) assert.deepEqual(message.structuredContent, expected.structuredContent, "Native resource structured output must agree.");
        for (let line = startLine; line <= endLine; line++) covered.add(line);
      }
      assert.equal(covered.size, lines.length, "Complete actual resource coverage required.");
    }
    const call = effect.intent.call;
    const [journalPath, entryId] = call.journal.split("#");
    assert.equal(journalPath, effect.intent.origin.journal, "Exact original child journal required.");
    assert.equal(result.source.split("#")[0], journalPath, "Effect must join the retained result journal.");
    const calls = entries.flatMap(entry => entry.id === entryId && entry.type === "message" && entry.message.role === "assistant" ? entry.message.content.filter(part => part.type === "toolCall" && part.id === call.id && part.name === call.name) : []);
    assert.equal(calls.length, 1, "Exact persisted child assistant call required.");
    assert.deepEqual(calls[0].arguments, call.rawInput, "Original persisted arguments must match retained raw input.");
    const native = nativeTools.get(call.name);
    assert.ok(native, "Supported native effect required.");
    const raw = structuredClone(calls[0].arguments);
    const prepared = native.prepareArguments ? native.prepareArguments(raw) : raw;
    assert.deepEqual(validateToolArguments(native, { type: "toolCall", id: call.id, name: call.name, arguments: prepared }), call.input, "Admitted native input must match prepared persisted arguments.");
    const results = entries.filter(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === call.id && entry.message.toolName === call.name);
    assert.equal(results.length, 1, "Exact corresponding persisted native child result required.");
    assert.ok(entries.indexOf(results[0]) > entries.findIndex(entry => entry.id === entryId), "Native result must follow its exact assistant call.");
    const outcome = await json(effect.state.evidence), message = results[0].message;
    if (effect.state.kind === "completed") {
      assert.equal(outcome.kind, "native-result", "Completed effect requires its actual native outcome.");
      assert.equal(outcome.id, effect.intent.id, "Native outcome must join this exact effect.");
      assert.equal(outcome.call, call.id, "Native outcome must join this exact call.");
      assert.equal(effect.state.isError, outcome.result.isError ?? false, "Recorded native error status contradicts the native outcome.");
      joinResult(outcome.result, message);
      const exitCode = call.name === "bash" ? outcome.result.structuredContent?.exit_code : undefined;
      if (call.name === "bash") assert.ok(Number.isInteger(exitCode), "Native bash exit required.");
      assert.equal(effect.state.exitCode, exitCode, "Recorded native exit contradicts the native outcome.");
      outcomes.set(effect.intent.id, outcome);
    } else {
      assert.equal(effect.state.kind, "refused");
      assert.equal(message.isError, true, "Refused effect requires a persisted error result.");
      if (outcome.kind === "tool-pipeline-end") {
        assert.equal(outcome.isError, true, "Ordinary pipeline refusal must retain its error status.");
        joinResult({ ...outcome.result, isError: outcome.isError }, message);
      } else {
        assert.equal(outcome.kind, "refused", "Refused effect requires corresponding refusal evidence.");
        assert.equal(outcome.reason, effect.state.reason, "Recorded refusal must match the native boundary reason.");
      }
    }
  }
  const testCommands = effects.filter(effect => effect.intent.call.name === "bash" && effect.intent.call.input.command === "node --test status.test.mjs")
    .sort((a, b) => entries.findIndex(entry => `${a.intent.origin.journal}#${entry.id}` === a.intent.call.journal) - entries.findIndex(entry => `${b.intent.origin.journal}#${entry.id}` === b.intent.call.journal));
  assert.equal(testCommands.length, 2, "Exactly the meaningful behavioral red and green commands are required.");
  const [red, green] = testCommands;
  assert.equal(red.state.kind, "completed"); assert.equal(red.state.exitCode, 1); assert.equal(red.state.isError, true);
  assert.equal(green.state.kind, "completed"); assert.equal(green.state.exitCode, 0); assert.equal(green.state.isError, false);
  assert.match(outcomes.get(red.intent.id).result.structuredContent.output, /ERR_ASSERTION|AssertionError/, "Red must retain an actual behavioral assertion failure, not setup or unrelated command failure.");
  const greenOutput = outcomes.get(green.intent.id).result.structuredContent.output;
  assert.match(greenOutput, /^# pass [1-9]\d*$/m, "Green must run and pass actual behavioral tests, not skip execution.");
  assert.match(greenOutput, /^# fail 0$/m, "Green must retain a zero-failure behavioral test result.");
  return { child, intent, effects, proof, result, entries };
}

// The CLI only authors a new fixture and starts ordinary interactive Pi.
// The public production driver executes from its own model-only root tool.
async function trial(root, ownerSession) {
  const checkout = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const trees = (await execute("git", ["-C", checkout, "worktree", "list", "--porcelain", "-z"])).stdout;
  const primary = await realpath(trees.split("\0")[0].slice("worktree ".length));
  const container = join(dirname(primary), `worktrees-${basename(primary)}_legion`);
  assert.equal(dirname(root), container);
  assert.equal(process.env.HERDR_ENV, "1"); assert.ok(process.env.HERDR_PANE_ID);
  await mkdir(container, { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  const repo = join(root, "repo"), evidence = join(root, "evidence");
  await mkdir(repo); await mkdir(evidence, { mode: 0o700 });
  let coordinator = null;
  async function command(file, args) {
    try { const result = await execute(file, args, { maxBuffer: 4 * 1024 * 1024 }); await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, exitCode: 0, ...result }) + "\n"); return result.stdout; }
    catch (error) { await appendFile(join(evidence, "commands.jsonl"), JSON.stringify({ file, args, exitCode: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n"); throw error; }
  }
  try {
    const caller = (await jsonFromCommand("herdr", ["pane", "get", process.env.HERDR_PANE_ID])).result.pane;
    const callerSession = caller.agent_session?.kind === "id" ? caller.agent_session.value : JSON.parse((await readFile(caller.agent_session.value, "utf8")).split("\n")[0]).id;
    assert.equal(callerSession, ownerSession); assert.equal(caller.workspace_id, "w1");
    await writeFile(join(evidence, "caller.json"), JSON.stringify(caller, null, 2));
    await command("git", ["init", "-q", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "Newly authored disposable Unit B fixture. No development task bytes copied.\n");
    await writeFile(join(repo, "status.mjs"), 'export function statusLabel() { return "Red"; }\n');
    await writeFile(join(repo, "denied.txt"), "Protected fixture bytes stay unchanged.\n");
    const skillDirectory = join(repo, ".pi", "skills"); await mkdir(skillDirectory, { recursive: true });
    const resources = [];
    for (const name of ["matt-tdd", "matt-teach", "implement", "code-review"]) {
      const target = join(checkout, ".agents", "skills", name);
      await symlink(target, join(skillDirectory, name));
      const files = name === "matt-tdd" ? ["SKILL.md", "tests.md", "mocking.md"] : ["SKILL.md"];
      for (const file of files) resources.push({ path: join(target, file), sha256: hash(await readFile(join(target, file))) });
    }
    const extensions = join(repo, ".pi", "extensions"); await mkdir(extensions, { recursive: true });
    await writeFile(join(extensions, "permissions.ts"), `import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
export default function (pi) {
  const child = process.env.PI_SUBAGENT_CHILD === "1";
  const record = value => appendFileSync(${JSON.stringify(join(evidence, "permissions.jsonl"))}, JSON.stringify({ child, ...value }) + "\\n");
  pi.on("session_start", (_event, ctx) => record({ kind: "loaded", cwd: ctx.cwd, session: ctx.sessionManager.getSessionId(), journal: ctx.sessionManager.getSessionFile(), pid: process.pid, model: ctx.model?.provider + "/" + ctx.model?.id, tools: pi.getAllTools().map(tool => ({ name: tool.name, exposure: tool.exposure, sourceInfo: tool.sourceInfo })) }));
  pi.on("tool_call", (event, ctx) => {
    if (child && event.toolName === "write" && resolve(ctx.cwd, event.input.path) === resolve(ctx.cwd, "denied.txt")) { record({ kind: "denied", session: ctx.sessionManager.getSessionId(), event }); return { block: true, reason: "Independent ordinary fixture permission policy denied this exact child write." }; }
  });
  pi.on("tool_execution_end", (event, ctx) => record({ kind: "result", session: ctx.sessionManager.getSessionId(), event }));
}
`);
    const poteto = join(getAgentDir(), "npm", "node_modules", "@zenspc", "pi-pstack", "skills", "poteto-mode", "SKILL.md");
    resources.push({ path: await realpath(poteto), sha256: hash(await readFile(poteto)) });
    await command("git", ["-C", repo, "add", "README.md", "status.mjs", "denied.txt", ".pi"]);
    await command("git", ["-C", repo, "-c", "user.name=Legion fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Explicit authored writable fixture baseline"]);
    const base = (await command("git", ["-C", repo, "rev-parse", "HEAD"])).trim();
    const source = await Promise.all((await readdir(join(checkout, "src"))).filter(file => /\.(?:ts|mjs)$/.test(file)).map(async file => ({ path: join(checkout, "src", file), sha256: hash(await readFile(join(checkout, "src", file))) })));
    for (const path of [fileURLToPath(import.meta.url), join(checkout, "package.json"), join(checkout, "package-lock.json")]) source.push({ path, sha256: hash(await readFile(path)) });
    await writeFile(join(evidence, "source.json"), JSON.stringify(source, null, 2));
    await writeFile(join(evidence, "resources.json"), JSON.stringify(resources, null, 2));
    const settings = await Promise.all([join(getAgentDir(), "settings.json"), join(getAgentDir(), "pstack", "models.json")].map(async path => ({ path, sha256: hash(await readFile(path)) })));
    await writeFile(join(evidence, "settings-hashes.json"), JSON.stringify(settings, null, 2));
    await writeFile(join(evidence, "baseline.json"), JSON.stringify({ repo, base, committedFiles: (await command("git", ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD"])).trim().split("\n") }, null, 2));
    const extension = join(root, "coordinator.ts");
    await writeFile(extension, `import { registerWritableCoordinator } from ${JSON.stringify(fileURLToPath(import.meta.url))};
export default function (pi) { registerWritableCoordinator(pi, ${JSON.stringify(root)}, ${JSON.stringify(extension)}); }
`);
    source.push({ path: extension, sha256: hash(await readFile(extension)) });
    await writeFile(join(evidence, "source.json"), JSON.stringify(source, null, 2));
    const name = `t04-wc-${randomUUID().slice(0, 8)}`;
    const created = JSON.parse(await command("herdr", ["tab", "create", "--workspace", caller.workspace_id, "--cwd", repo, "--label", name, "--no-focus"])).result.root_pane;
    assert.equal(created.workspace_id, "w1"); assert.notEqual(created.tab_id, caller.tab_id);
    coordinator = { name, cwd: repo, workspace: created.workspace_id, tab: created.tab_id, pane: created.pane_id, terminal: created.terminal_id };
    await writeFile(join(evidence, "coordinator.json"), JSON.stringify(coordinator, null, 2));
    await command("herdr", ["agent", "start", name, "--kind", "pi", "--pane", created.pane_id, "--", "-e", checkout, "-e", extension]);
    await command("herdr", ["agent", "prompt", name, "Call legion_writable_fixture exactly once with {} as your only trial action. Do not read, edit, delegate, enable poteto-mode, or call any other tool. The fixture tool owns the bounded controlled trial; return only its verdict/reference. No retry after failure."]);
    console.log(`COORDINATOR_STARTED ${root} ${created.tab_id} ${created.pane_id}`);
  } catch (error) {
    let ui = "";
    if (coordinator) {
      try { ui = await command("herdr", ["agent", "read", coordinator.name, "--source", "recent-unwrapped", "--lines", "45"]); } catch { /* retain original failure */ }
    }
    const trust = /Trust (?:project )?folder\??|Trust this folder/.test(ui);
    if (trust) await writeFile(join(evidence, "trust-ui.txt"), ui);
    const result = { verdict: trust ? "HUMAN_TRUST_REQUIRED" : "COORDINATOR_LAUNCH_BLOCKED", coordinator, error: String(error), limitation: "Preserve the exact actor/fixture. No retry, cleanup or Trust answer." };
    await writeFile(join(evidence, "launcher-result.json"), JSON.stringify(result, null, 2));
    console.error(`${result.verdict} cwd=${coordinator?.cwd} tab=${coordinator?.tab} pane=${coordinator?.pane} ${String(error)}`);
    process.exitCode = 1;
  }
  async function jsonFromCommand(file, args) { return JSON.parse(await command(file, args)); }
}

/** Fixture-only registration: no activation, model switching or effect until a real root call. */
export function registerWritableCoordinator(pi, root, extension) {
  let used = false;
  pi.registerTool({
    name: "legion_writable_fixture", label: "Bounded writable fixture",
    description: "Run the authorized disposable controlled Unit B trial exactly once. Input must be {}. Controlled decisions are not model-origin Legatus approvals. Returns bounded evidence references.",
    parameters: Type.Object({}, { additionalProperties: false }), exposure: "model-only",
    async execute(toolCallId, input, _signal, _onUpdate, ctx) {
      assert.equal(used, false, "The fixture root call is one-shot; preserve failures without retry.");
      used = true;
      assert.deepEqual(input, {});
      const registered = pi.getAllTools().filter(tool => tool.name === "legion_writable_fixture");
      assert.equal(registered.length, 1);
      assert.equal(registered[0].exposure, "model-only");
      assert.equal(await realpath(registered[0].sourceInfo.path), await realpath(extension), "Exact registered fixture provenance required.");
      const result = await runWritableCoordinator(root, toolCallId, ctx);
      return { content: [{ type: "text", text: `${result.verdict} ${join(root, "evidence", "result.json")}` }], details: { verdict: result.verdict, evidence: join(root, "evidence", "result.json") }, isError: result.verdict !== "WRITABLE_NATIVE_CENTURIO_PASS", terminate: true };
    },
  });
}

export function writableFixtureCommand(text, session, sequence) {
  return { text, requestKey: `fixture-${sequence}`, evidence: { origin: "host-command", transport: "source-unavailable", session, generation: null, presented: [] } };
}

export function writableFixtureInterpretation(initial, session, goal) {
  const sourceRef = initial.snapshot.submissions[0];
  return { kind: "interpretation", requestKey: "fixture-intake", proposal: { kind: "new-task", source: { id: sourceRef.id, revision: 1 }, goal, acceptance: ["Ready behavior red/green in isolated retained native child; denied write unchanged; parent base preserved"], questions: [] }, evidence: { session, generation: initial.snapshot.generation, legatus: initial.snapshot.id, run: "controlled-fixture-intake", sources: [{ id: sourceRef.id, revision: 1 }] } };
}

export function writableFixtureDecision(open, session) {
  return { kind: "engineering-decision", requestKey: randomUUID(), request: { id: open.id, digest: open.digest }, decision: { kind: "approve", rationale: "Controlled fixture authority approves the meaningful in-scope public statusLabel Ready assertion; no exception or graph authority." }, evidence: { kind: "legatus", owner: open.pin.owner, session, generation: open.pin.generation, epoch: open.pin.epoch, run: "controlled-fixture-decision-not-model-origin", requests: [{ id: open.id, digest: open.digest }] } };
}

async function runWritableCoordinator(root, toolCallId, ctx) {
  const repo = join(root, "repo"), evidence = join(root, "evidence");
  let actor = null, legion = null;
  const ownerSession = ctx.sessionManager.getSessionId();
  async function run(command) {
    const outcome = await ctx.executeTool("bash", { command });
    await appendFile(join(evidence, "controller-commands.jsonl"), JSON.stringify({ command, outcome }) + "\n");
    const result = outcome.result.structuredContent;
    return result && Number.isInteger(result.exit_code) && typeof result.output === "string"
      ? { kind: "finished", code: result.exit_code, output: result.output }
      : { kind: "unknown", message: "Ordinary nested bash completion unavailable; preserve its native outcome." };
  }
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  async function command(file, args) {
    const outcome = await run([file, ...args].map(quote).join(" "));
    assert.ok(outcome.kind === "finished" && outcome.code === 0, `Ordinary guarded command failed: ${file}`);
    return outcome.output;
  }
  async function trustCheck() {
    if (!actor) return;
    const ui = await command("herdr", ["agent", "read", actor.name, "--source", "recent-unwrapped", "--lines", "45"]);
    if (/Trust (?:project )?folder\??|Trust this folder/.test(ui)) {
      await writeFile(join(evidence, "trust-ui.txt"), ui);
      throw new Error(`HUMAN_TRUST_REQUIRED cwd=${actor.cwd} tab=${actor.tab} pane=${actor.pane}`);
    }
  }
  try {
    assert.equal(ctx.cwd, repo); assert.notEqual(process.env.PI_SUBAGENT_CHILD, "1");
    const coordinator = await json(join(evidence, "coordinator.json"));
    assert.equal(process.env.HERDR_PANE_ID, coordinator.pane);
    const journal = ctx.sessionManager.getSessionFile();
    const entries = (await readFile(journal, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    assert.equal(entries[0].id, ownerSession); assert.equal(entries[0].cwd, repo);
    const calls = entries.flatMap(entry => entry.type === "message" && entry.message.role === "assistant" ? entry.message.content.filter(part => part.type === "toolCall") : []);
    assert.equal(calls.length, 1, "A fresh actual model root call, not a fabricated or nested caller, is required.");
    assert.equal(calls[0].id, toolCallId); assert.equal(calls[0].name, "legion_writable_fixture"); assert.deepEqual(calls[0].arguments, {});
    const caller = JSON.parse(await command("herdr", ["pane", "get", coordinator.pane])).result.pane;
    const session = caller.agent_session.kind === "id" ? caller.agent_session.value : JSON.parse((await readFile(caller.agent_session.value, "utf8")).split("\n")[0]).id;
    assert.equal(session, ownerSession); assert.equal(caller.workspace_id, "w1");
    const processes = JSON.parse(await command("herdr", ["pane", "process-info", "--pane", coordinator.pane])).result.process_info;
    assert.ok(processes.foreground_processes.some(item => item.pid === process.pid));
    await writeFile(join(evidence, "coordinator-runtime.json"), JSON.stringify({ coordinator, caller, processes, session: ownerSession, pid: process.pid, journal, rootCall: calls[0], model: `${ctx.model.provider}/${ctx.model.id}`, controlledDecisions: true }, null, 2));
    const { base } = await json(join(evidence, "baseline.json"));
    const source = await json(join(evidence, "source.json")), resources = await json(join(evidence, "resources.json")), settings = await json(join(evidence, "settings-hashes.json"));
    for (const pin of [...source, ...resources, ...settings]) assert.equal(hash(await readFile(pin.path)), pin.sha256);
    let host;
    legion = new Legion({ storagePath: join(root, "state"), context: repo, session: ownerSession, preflight: async () => [], assignments: { repository: () => new GitWorkspace(repo, run) }, tribuni: { host: () => host, onEngineering: message => { if (message) void appendFile(join(evidence, "transport-diagnostics.jsonl"), JSON.stringify({ message }) + "\n"); } } });
    let sequence = 0;
    const control = text => legion.command(writableFixtureCommand(text, ownerSession, ++sequence));
    assert.equal((await control("task Delegate the bounded Ready status change")).kind, "saved");
    const initial = await legion.state();
    const goal = `Bounded disposable Unit B implementation. Do not write task files in your principal worktree; delegate exactly one implementation Centurio with role feature, refactoring. First read the actual selected matt-tdd/SKILL.md, tests.md, mocking.md; propose through legion_engineering the public statusLabel() behavior in status.mjs with node --test status.test.mjs, expecting statusLabel() to return Ready. Yield for external-controller seam approval. After approved continuation, use native bash only to observe current branch and HEAD (explicit committed clean base), then prepare legion_centurio using those exact baseRef/baseCommit. Its bounded task: read actual selected matt-tdd plus references and poteto-mode; write status.test.mjs using node:test/assert with meaningful equality assertion Ready; run node --test status.test.mjs and retain assertion-failure exit 1 BEFORE changing status.mjs; edit statusLabel() to return Ready; rerun same command exit 0; attempt exactly one write {path:"denied.txt",content:"Forbidden child mutation"}, expect ordinary denial and never retry or bypass; return exact results/references and yield. Launch using exactly prepared native subagent input (loader/capability discovery allowed). No nested graph, no other children, no commit/integration/publication/cleanup or TDD exception. Retain child worktree/branch and leave your own committed task files unchanged. Report only after independently observed child lifecycle settles; model text is not proof.`;
    assert.equal((await legion.submit(writableFixtureInterpretation(initial, ownerSession, goal))).kind, "applied");
    const admitted = await legion.state(), task = admitted.tasks[0];
    await control(`reserve ${task.id}@1 --parent refs/heads/main`);
    const reserved = await legion.command({ workspaceRequest: `fixture-${sequence}` });
    assert.equal(reserved.kind, "reserved"); assert.equal(reserved.workspace.kind, "ready");
    await control(`launch ${task.id}@1`);
    const launchPin = (await legion.state()).snapshot.launchRequests.at(-1);
    host = new LocalTribunusHost(run, { owner: admitted.snapshot.id, session: ownerSession, generation: launchPin.generation, epoch: launchPin.epoch }, message => { void appendFile(join(evidence, "host-diagnostics.jsonl"), JSON.stringify({ message }) + "\n"); });
    const launched = await legion.command({ launchRequest: `fixture-${sequence}` });
    await writeFile(join(evidence, "launch-result.json"), JSON.stringify(launched, null, 2));
    const state = await legion.state(), live = state.tasks[0].launch;
    const window = live.worker?.address.window ?? live.last?.window;
    if (window) { actor = { name: `lg-${launched.launch.id.replaceAll("-", "").slice(0, 24)}`, cwd: reserved.receipt.reservation.plan.path, workspace: window.workspace, tab: window.tab, pane: window.pane, terminal: window.terminal }; await writeFile(join(evidence, "actor.json"), JSON.stringify(actor, null, 2)); }
    await trustCheck();
    assert.equal(launched.kind, "launched"); assert.equal(live.kind, "assigned", "Production launch has not admitted this exact managed actor. Preserve the held outcome; no repair or relaunch.");
    let latest;
    do {
      latest = await legion.state();
      await writeFile(join(evidence, "public-state.json"), JSON.stringify(latest, null, 2));
      await trustCheck();
      const open = latest.snapshot.engineering.find(record => record.state.kind === "open");
      if (open) {
        assert.equal(open.proposal.kind, "seam");
        const request = writableFixtureDecision(open, ownerSession);
        const receipt = await legion.submit(request);
        await writeFile(join(evidence, "controlled-decision.json"), JSON.stringify({ request, receipt, controlled: true, modelOrigin: false }, null, 2));
        assert.equal(receipt.kind, "applied", `Controlled decision did not apply: ${JSON.stringify(receipt)}`);
        const delivered = await legion.command({ engineeringDelivery: open.id });
        await writeFile(join(evidence, "controlled-delivery.json"), JSON.stringify(delivered, null, 2));
        assert.equal(delivered.kind, "applied", `Controlled delivery did not apply: ${JSON.stringify(delivered)}`);
      }
      const children = latest.tasks[0].launch.worker?.resources.children ?? [];
      if (children.some(child => ["unknown", "mismatch"].includes(child.state.kind))) throw new Error("Native child/effect hold remains unresolved; no retry or replacement.");
      if (children.some(child => child.state.kind === "process-terminal")) break;
      if (!latest.tasks[0].launch.worker || latest.tasks[0].launch.kind === "reported" && children.length === 0) throw new Error("Managed principal settled without the required owned child; preserve its exact report.");
      await delay(2000);
    } while (true);
    const verified = await verifyWritablePublicEvidence(latest), childCwd = verified.intent.cwd;
    const testCommands = verified.effects.filter(effect => effect.intent.call.name === "bash" && effect.intent.call.input.command === "node --test status.test.mjs");
    assert.equal(testCommands.length, 2, "Retain exactly the meaningful behavioral red and green commands.");
    assert.equal(testCommands[0].state.exitCode, 1); assert.equal(testCommands[1].state.exitCode, 0);
    const red = await json(testCommands[0].state.evidence);
    assert.match(red.result.structuredContent.output, /ERR_ASSERTION|AssertionError/);
    const policies = (await readFile(join(evidence, "permissions.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    assert.ok(policies.some(row => row.child && row.kind === "denied" && row.session === verified.effects[0].intent.origin.session));
    assert.equal(await readFile(join(childCwd, "denied.txt"), "utf8"), "Protected fixture bytes stay unchanged.\n");
    assert.equal(await readFile(join(actor.cwd, "status.mjs"), "utf8"), 'export function statusLabel() { return "Red"; }\n');
    assert.equal((await command("git", ["-C", actor.cwd, "rev-parse", "HEAD"])).trim(), base);
    assert.equal((await command("git", ["-C", actor.cwd, "status", "--porcelain=v1", "--untracked-files=all"])).trim(), "");
    assert.equal((await command("git", ["-C", childCwd, "symbolic-ref", "HEAD"])).trim(), verified.intent.writable.workspace.plan.branch);
    for (const pin of [...source, ...resources, ...settings]) assert.equal(hash(await readFile(pin.path)), pin.sha256, "Source/resource changed during trial.");
    const result = { verdict: "WRITABLE_NATIVE_CENTURIO_PASS", actor, childCwd, base, run: verified.child.state.run, model: verified.child.model, child: verified.child, controlledController: true, integratedLegionAcceptance: false, limitation: "Actual production managed Tribunus/child/effect/lifecycle path with controlled external intake/seam decision, not a model-origin Legatus decision or complete #5 exception/research/integration acceptance. Ordinary bash is not filesystem confinement. No cleanup, publication or settings changes." };
    await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const verdict = String(error).includes("HUMAN_TRUST_REQUIRED") ? "HUMAN_TRUST_REQUIRED" : "CONTINUATION_BLOCKED";
    const result = { verdict, actor, error: String(error), stack: error.stack, state: await legion?.state(), limitation: "Exact failed actor/claim retained; no retry, relaunch, cleanup, settings/Trust bypass or unrelated repair." };
    await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
    ctx.ui.notify(`${verdict} ${String(error)}`, "error");
    return result;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2] && process.argv[3], "Supply a NEW fixture directory and verified authorizing parent session ID.");
  await trial(resolve(process.argv[2]), process.argv[3]);
}
