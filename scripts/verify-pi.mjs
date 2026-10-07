import assert from "node:assert/strict";
import { Legion } from "../src/intake.ts";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "legion-pi-"));
const agent = join(root, "agent");
const cwd = join(root, "repo");
await mkdir(agent);
await mkdir(cwd);
execFileSync("git", ["init", "-q", cwd]);
const env = {
  PATH: process.env.PATH,
  HOME: root,
  PI_CODING_AGENT_DIR: agent,
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
  PI_TELEMETRY: "0",
  TERM: "xterm-256color",
};
const hostSettings = join(homedir(), ".pi/agent/settings.json");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const hostBefore = hash(await readFile(hostSettings));
execFileSync("pi", ["install", resolve(".")], { cwd, env });
const logs = [];
const clients = [];
function client(extra = [], overrides = {}) {
  const p = spawn("pi", ["--mode", "rpc", "--no-context-files", ...extra], {
    cwd,
    env: { ...env, ...overrides },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let seq = 0;
  const records = [];
  const waiters = new Map();
  p.stderr.on("data", (b) => {
    stderr += b;
  });
  p.stdout.on("data", (b) => {
    buffer += b;
    let n;
    while ((n = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, n);
      buffer = buffer.slice(n + 1);
      if (!line) continue;
      const record = JSON.parse(line);
      records.push(record);
      if (record.type === "response") {
        waiters.get(record.id)?.(record);
        waiters.delete(record.id);
      }
    }
  });
  const c = {
    records,
    async rpc(type, fields = {}) {
      const id = String(++seq);
      const response = await Promise.race([
        new Promise((r) => {
          waiters.set(id, r);
          p.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`RPC ${type} timed out. ${stderr}`)),
            20000,
          ).unref(),
        ),
      ]);
      assert.equal(response.success, true, response.error);
      return response.data;
    },
    async prompt(message, fields = {}) {
      return this.rpc("prompt", { message, ...fields });
    },
    async close() {
      if (p.exitCode !== null) return;
      p.stdin.end();
      await new Promise((r, reject) => {
        p.once("exit", (code) =>
          code === 0 ? r() : reject(new Error(`Pi exited ${code}. ${stderr}`)),
        );
      });
      logs.push({ records, stderr });
    },
    async state() {
      const start = records.length;
      await this.prompt("/legion status");
      const record = records
        .slice(start)
        .find(
          (r) =>
            r.type === "extension_ui_request" &&
            r.message?.includes("\nState\n"),
        );
      return record ? JSON.parse(record.message.split("\nState\n")[1]) : null;
    },
  };
  clients.push(c);
  return c;
}
async function until(predicate, description) {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out. ${description}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
function noTurn(c, start) {
  assert.equal(
    c.records.slice(start).filter((r) => r.type === "agent_start").length,
    0,
  );
}
let handler = () => ({ content: "Fixture response", finish: "stop" });
let requests = 0;
const server = createServer(async (req, res) => {
  const body = JSON.parse(
    await new Promise((r) => {
      let b = "";
      req.on("data", (c) => {
        b += c;
      });
      req.on("end", () => r(b));
    }),
  );
  requests++;
  const answer = await handler(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = answer.tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${requests}`,
            type: "function",
            function: {
              name: answer.tool.name,
              arguments: JSON.stringify(answer.tool.arguments),
            },
          },
        ],
      }
    : { role: "assistant", content: answer.content };
  const chunk = (delta, finish_reason) => ({
    id: `chat_${requests}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "controlled",
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
  res.write(
    `data: ${JSON.stringify(chunk({}, answer.tool ? "tool_calls" : "stop"))}\n\n`,
  );
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
function interpretation(body) {
  const texts = body.messages.flatMap((m) =>
    typeof m.content === "string"
      ? [m.content]
      : (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text),
  );
  const data = texts.findLast((t) =>
    t.includes("Legion interpretation data\n"),
  );
  assert.ok(data, "Fresh interpretation includes correlated original data");
  return JSON.parse(
    data.slice(
      data.indexOf("Legion interpretation data\n") +
        "Legion interpretation data\n".length,
    ),
  );
}
function propose(body, choose) {
  const lastData = body.messages.findLastIndex((m) =>
    JSON.stringify(m.content).includes("Legion interpretation data\\n"),
  );
  if (body.messages.slice(lastData + 1).some((m) => m.role === "tool"))
    return { content: "Intake recorded." };
  return {
    tool: { name: "legion_intake", arguments: choose(interpretation(body)) },
  };
}
const checks = [];
try {
  const c = client(["--session-id", randomUUID()]);
  assert.ok(
    (await c.rpc("get_commands")).commands.some((c) => c.name === "legion"),
  );
  const before = await c.rpc("get_state");
  const start = c.records.length;
  assert.equal((await c.prompt("/legion status")).disposition, "handled");
  assert.ok(
    c.records.slice(start).some((r) => r.message === "Legion is inactive."),
  );
  await c.prompt("/legion doctor");
  assert.ok(c.records.some((r) => r.message?.includes("Skill herdr missing.")));
  assert.ok(
    c.records.some((r) => r.message?.includes("@zenspc/pi-pstack missing.")),
  );
  await c.prompt("/legion task Exact input before any provider turn", {
    images: [
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      },
    ],
  });
  assert.ok(
    c.records.some(
      (r) =>
        r.method === "notify" &&
        r.message.includes("Command text only. Attachments were not captured."),
    ),
    "Task-bearing receipts explicitly limit the save to command text",
  );
  const saved = await c.state();
  assert.equal(saved.mode, "inactive");
  assert.equal(
    saved.snapshot.submissions[0].text,
    "Exact input before any provider turn",
  );
  const id = saved.snapshot.id;
  noTurn(c, start);
  const after = await c.rpc("get_state");
  assert.deepEqual(after.model, before.model);
  assert.equal(after.messageCount, 0);
  checks.push(
    "install, literal inactive, missing resources, saved not admitted before provider, model-free doctor/status",
  );
  await c.close();
  const unrelated = client();
  assert.equal(await unrelated.state(), null);
  noTurn(unrelated, 0);
  await unrelated.close();
  const reopened = client();
  const statusStart = reopened.records.length;
  await reopened.prompt(`/legion status ${id}`);
  assert.ok(
    reopened.records
      .slice(statusStart)
      .some((r) => r.message?.includes("Exact input before any provider turn")),
  );
  noTurn(reopened, statusStart);
  await reopened.close();
  checks.push(
    "unrelated sessions inactive, records reopen by logical ID without Pi journal",
  );
  const pstack =
    process.env.PI_TEST_PSTACK ??
    join(homedir(), ".pi/agent/npm/node_modules/@zenspc/pi-pstack");
  const subagents =
    process.env.PI_TEST_SUBAGENTS ??
    join(homedir(), ".pi/agent/npm/node_modules/pi-subagents");
  for (const path of [pstack, subagents])
    execFileSync("pi", ["install", path], { cwd, env });
  const installedButUnloaded = JSON.parse(
    await readFile(join(agent, "settings.json"), "utf8"),
  );
  const actualPackages = installedButUnloaded.packages;
  installedButUnloaded.packages = actualPackages.map((source) =>
    resolve(agent, source) === pstack || resolve(agent, source) === subagents
      ? { source, extensions: [] }
      : source,
  );
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify(installedButUnloaded),
  );
  const unloaded = client();
  await unloaded.prompt("/legion doctor");
  assert.ok(
    unloaded.records.some(
      (r) =>
        r.method === "notify" &&
        r.message.includes("@zenspc/pi-pstack missing."),
    ),
  );
  assert.ok(
    unloaded.records.some(
      (r) =>
        r.method === "notify" && r.message.includes("pi-subagents missing."),
    ),
  );
  noTurn(unloaded, 0);
  await unloaded.close();
  installedButUnloaded.packages = actualPackages;
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify(installedButUnloaded),
  );
  const noStorage = client([], { NODE_OPTIONS: "--no-experimental-sqlite" });
  await noStorage.prompt("/legion doctor");
  assert.ok(
    noStorage.records.some(
      (r) => r.method === "notify" && r.message.includes("Storage missing."),
    ),
    "Unavailable lazy storage still registers doctor",
  );
  noTurn(noStorage, 0);
  await noStorage.close();
  checks.push(
    "installed-but-unloaded extensions and genuinely disabled Node SQLite are diagnosed without repair",
  );
  const skillRoot = join(agent, "skills");
  await mkdir(skillRoot);
  for (const name of ["matt-tdd", "implement", "code-review"])
    await symlink(
      resolve(".agents/skills", name),
      join(skillRoot, name),
      "dir",
    );
  const localHerdr = JSON.parse(
    execFileSync("herdr", ["status", "server", "--json"]).toString(),
  );
  await mkdir(join(root, ".config/herdr"), { recursive: true });
  await symlink(localHerdr.socket, join(root, ".config/herdr/herdr.sock"));
  const missingHerdrSkill = client();
  await missingHerdrSkill.prompt("/legion doctor");
  assert.ok(
    missingHerdrSkill.records.some(
      (r) =>
        r.method === "notify" && r.message.includes("Skill herdr missing."),
    ),
    "Real loaded packages do not fabricate Herdr skill discovery",
  );
  noTurn(missingHerdrSkill, 0);
  await missingHerdrSkill.close();
  const herdrDir = join(skillRoot, "herdr");
  await mkdir(herdrDir);
  await writeFile(
    join(herdrDir, "SKILL.md"),
    execFileSync("herdr", ["--skill"]).toString(),
  );
  const models = {
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        api: "openai-completions",
        apiKey: "test-owned-not-a-secret",
        models: [
          {
            id: "controlled",
            name: "Controlled fixture",
            reasoning: false,
            input: ["text"],
            contextWindow: 200000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  await writeFile(join(agent, "models.json"), JSON.stringify(models));
  const settings = JSON.parse(
    await readFile(join(agent, "settings.json"), "utf8"),
  );
  const fixturePackage = join(root, "fixture-package");
  await mkdir(fixturePackage);
  await writeFile(
    join(fixturePackage, "package.json"),
    JSON.stringify({
      name: "legion-runtime-fixture",
      pi: { extensions: ["./extension.ts"] },
    }),
  );
  await writeFile(
    join(fixturePackage, "extension.ts"),
    `export default function(pi) {
    let race = false;
    pi.registerCommand('fixture-host-command', { handler: async () => { pi.sendUserMessage('/legion task Host-command fixture input', {expandPromptTemplates: true}); } });
    pi.registerCommand('fixture-extension-input', { handler: async () => { pi.sendUserMessage('Injected ordinary answer'); } });
    pi.registerCommand('fixture-stale', { handler: async () => { pi.sendUserMessage('Legion intake dispatch expired'); } });
    pi.registerCommand('fixture-race', { handler: async () => { race = true; } });
    pi.on('input', async event => {
      if (race && event.source === 'extension' && event.text.startsWith('Legion intake dispatch ')) {
        race = false; pi.sendUserMessage('Fixture ordinary busy race');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
  }`,
  );
  settings.packages.unshift(fixturePackage);
  settings.defaultProvider = "fixture";
  settings.defaultModel = "controlled";
  settings.defaultThinkingLevel = "off";
  settings.lastChangelogVersion = "1.0.4";
  await writeFile(join(agent, "settings.json"), JSON.stringify(settings));
  const fixtureSettingsHash = hash(
    await readFile(join(agent, "settings.json")),
  );
  const lostSession = randomUUID();
  const prepared = new Legion({
    storagePath: join(agent, "legion"),
    context: cwd,
    session: lostSession,
    preflight: async () => [],
  });
  const prepEvidence = {
    origin: "host-command",
    transport: "source-unavailable",
    session: lostSession,
    generation: null,
    presented: [],
  };
  await prepared.command({
    text: "Question survives missing Pi conversation",
    requestKey: "prepare",
    evidence: prepEvidence,
  });
  const prepState = await prepared.state();
  const prepSource = prepState.snapshot.submissions[0];
  await prepared.submit({
    kind: "interpretation",
    requestKey: "prep-interpretation",
    evidence: {
      session: lostSession,
      legatus: prepState.snapshot.id,
      generation: prepState.snapshot.generation,
      run: "prep",
      sources: [{ id: prepSource.id, revision: 1 }],
    },
    proposal: {
      kind: "new-task",
      source: { id: prepSource.id, revision: 1 },
      goal: "Persist question",
      acceptance: [],
      questions: [
        { question: "Which format?", recommendation: "Use plain text" },
      ],
    },
  });
  await prepared.command({
    text: "off",
    requestKey: "prep-off",
    evidence: prepEvidence,
  });
  const readOnly = client(["--session-id", lostSession]);
  const entryCount = (await readOnly.rpc("get_entries")).entries.length;
  await readOnly.state();
  await readOnly.prompt("/legion doctor");
  assert.equal(
    (await readOnly.rpc("get_entries")).entries.length,
    entryCount,
    "Status and doctor never present decisions or change the Pi branch",
  );
  noTurn(readOnly, 0);
  await readOnly.close();
  checks.push(
    "status and doctor preserve an empty conversation branch even with durable pending decisions",
  );
  const commandSource = client();
  await commandSource.prompt("/fixture-host-command");
  await until(
    () => commandSource.records.some((r) => r.type === "agent_settled"),
    "host-source fixture settles",
  );
  const sourceView = await commandSource.state();
  assert.equal(
    sourceView.snapshot.submissions[0].text,
    "Host-command fixture input",
  );
  assert.equal(
    sourceView.snapshot.submissions[0].evidence.origin,
    "host-command",
    "Pi command origin is unavailable, not authenticated Emperor provenance",
  );
  await commandSource.prompt("/legion off");
  await commandSource.close();
  checks.push(
    "supported host-command provenance is source-unavailable and trusted extensions can invoke commands",
  );
  const live = client();
  const modelBefore = await live.rpc("get_state");
  const observeStart = live.records.length;
  const staleRequests = requests;
  await live.prompt("/fixture-stale");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    requests,
    staleRequests,
    "Expired extension dispatch markers never start a provider turn",
  );
  await live.prompt("/legion doctor");
  const failures = live.records
    .slice(observeStart)
    .filter(
      (r) =>
        r.method === "notify" &&
        / (missing|unverified|incompatible)\./.test(r.message),
    );
  assert.deepEqual(
    failures,
    [],
    "Fixture prerequisites are actually loaded and compatible",
  );
  noTurn(live, observeStart);
  await live.prompt("/legion on");
  const active = await live.state();
  assert.equal(active.mode, "active");
  await live.prompt("/legion on");
  assert.equal((await live.state()).snapshot.id, active.snapshot.id);
  noTurn(live, observeStart);
  handler = (body) =>
    propose(body, (data) => ({
      kind: "new-task",
      source: data.sources[0],
      goal: "Add greeting",
      acceptance: ["Greeting exists"],
      questions: [
        { question: "Which language?", recommendation: "Use English" },
      ],
    }));
  const settleStart = live.records.length;
  await live.prompt("/legion Add greeting");
  await until(
    () =>
      live.records.slice(settleStart).some((r) => r.type === "agent_settled"),
    "direct interpretation settles",
  );
  const blocked = await live.state();
  assert.equal(blocked.tasks[0].eligibility, "blocked");
  handler = () => ({
    content: "Extension-origin text is not an Emperor answer.",
  });
  const extensionStart = live.records.length;
  await live.prompt("/fixture-extension-input");
  await until(
    () =>
      live.records
        .slice(extensionStart)
        .some((r) => r.type === "agent_settled"),
    "extension-origin ordinary message settles",
  );
  const extensionView = await live.state();
  assert.equal(extensionView.snapshot.submissions.length, 1);
  assert.equal(extensionView.tasks[0].eligibility, "blocked");
  checks.push(
    "extension-origin ordinary input cannot create a submission or answer a decision",
  );
  const entries = await live.rpc("get_entries");
  assert.ok(
    entries.entries.some(
      (e) =>
        e.type === "custom_message" &&
        e.customType === "legion-decision" &&
        e.display &&
        e.content.includes("Recommendation. Use English"),
    ),
    "Decision appears in chat",
  );
  handler = (body) =>
    propose(body, (data) => ({
      kind: "answer",
      source: data.sources[0],
      decision: { id: blocked.snapshot.decisions[0].id, revision: 1 },
      effect: {
        kind: "record-clarification",
        target: { id: blocked.tasks[0].id, revision: 1 },
        answer: data.state.snapshot.submissions.find(
          (s) => s.id === data.sources[0].id,
        ).text,
      },
    }));
  const answerStart = live.records.length;
  assert.equal(
    (await live.prompt("Use French, please.")).disposition,
    "handled",
  );
  await until(
    () =>
      live.records.slice(answerStart).some((r) => r.type === "agent_settled"),
    "conversational answer settles",
  );
  const answered = await live.state();
  assert.equal(answered.tasks[0].eligibility, "admitted");
  assert.equal(
    answered.snapshot.resolutions[0].effect.answer,
    "Use French, please.",
  );
  assert.deepEqual((await live.rpc("get_state")).model, modelBefore.model);
  assert.equal(
    hash(await readFile(join(agent, "settings.json"))),
    fixtureSettingsHash,
  );
  checks.push(
    "actual loaded dependencies, repeated activation, correlated direct interpretation, decision chat rendering, ordinary conversational answer, selected model/settings unchanged",
  );
  assert.equal(
    live.records.filter((r) => r.type === "extension_error").length,
    0,
  );
  const attachmentStart = live.records.length;
  const attachmentRequests = requests;
  assert.equal(
    (
      await live.prompt("Image intake is not supported", {
        images: [
          {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          },
        ],
      })
    ).disposition,
    "handled",
  );
  assert.ok(
    live.records
      .slice(attachmentStart)
      .some(
        (r) =>
          r.method === "notify" &&
          r.message.startsWith("Not saved. T01 accepts text only."),
      ),
  );
  assert.equal((await live.state()).snapshot.submissions.length, 2);
  assert.equal(requests, attachmentRequests);
  handler = (body) =>
    propose(body, (data) => ({
      kind: "propose-amendment",
      source: data.sources[0],
      affected: [{ id: answered.tasks[0].id, revision: 1 }],
      category: "access",
      change: "Read the test service with a read-only account",
      question: "Approve this exact access?",
      recommendation: "Use local data unless needed",
    }));
  const amendmentStart = live.records.length;
  await live.prompt("The report may need external service data.");
  await until(
    () =>
      live.records
        .slice(amendmentStart)
        .some((r) => r.type === "agent_settled"),
    "protected amendment persisted and displayed",
  );
  const protectedView = await live.state();
  const protectedDecision = protectedView.snapshot.decisions.at(-1);
  const amendment = protectedView.snapshot.amendments[0];
  assert.equal(protectedView.tasks[0].eligibility, "blocked");
  assert.ok(
    (await live.rpc("get_entries")).entries.some(
      (e) =>
        e.type === "custom_message" &&
        e.customType === "legion-decision" &&
        e.details.amendment === amendment.id &&
        e.content.includes("Read the test service with a read-only account"),
    ),
  );
  handler = (body) =>
    propose(body, (data) => ({
      kind: "answer",
      source: data.sources[0],
      decision: { id: protectedDecision.id, revision: 1 },
      effect: { kind: "approve-amendment", amendment: amendment.id },
    }));
  const approvalStart = live.records.length;
  await live.prompt("Yes, that read-only access is fine.");
  await until(
    () =>
      live.records.slice(approvalStart).some((r) => r.type === "agent_settled"),
    "conversational protected approval recorded",
  );
  const approved = await live.state();
  assert.deepEqual(approved.tasks[0].scope.amendments, [amendment.id]);
  assert.equal(approved.tasks[0].eligibility, "admitted");
  assert.equal(approved.snapshot.submissions.at(-1).evidence.transport, "rpc");
  checks.push(
    "visible attachments rejected before receipts; exact protected amendment displayed and approved conversationally",
  );
  let releaseRace;
  const raceHeld = new Promise((r) => {
    releaseRace = r;
  });
  let raceWaiting = false;
  handler = async (body) => {
    if (
      JSON.stringify(body.messages.at(-1)?.content).includes(
        "Fixture ordinary busy race",
      )
    ) {
      raceWaiting = true;
      await raceHeld;
      return { content: "Unrelated fixture run settled." };
    }
    return propose(body, (data) => ({
      kind: "new-task",
      source: data.sources[0],
      goal: "Race-safe task",
      acceptance: [],
      questions: [],
    }));
  };
  const raceStart = live.records.length;
  await live.prompt("/fixture-race");
  await live.prompt("/legion Preserve dispatch race");
  await until(
    () => raceWaiting,
    "ordinary run begins while dispatch input is delayed",
  );
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(
    live.records
      .slice(raceStart)
      .some(
        (r) =>
          r.method === "notify" &&
          r.message.includes("Interpretation deferred. Inputs remain saved."),
      ),
    "Busy-race input is consumed and deferred",
  );
  assert.equal(
    live.records.slice(raceStart).filter((r) => r.type === "extension_error")
      .length,
    0,
  );
  releaseRace();
  await until(
    () =>
      live.records.slice(raceStart).filter((r) => r.type === "agent_settled")
        .length === 2,
    "race work dispatched only after ordinary settlement",
  );
  assert.equal(
    (await live.state()).snapshot.submissions.at(-1).state.kind,
    "applied",
  );
  checks.push(
    "real busy race at extension input defers the one-use dispatch marker",
  );
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  let waiting = false;
  handler = async (body) => {
    const result = propose(body, (data) => ({
      kind: "new-task",
      source: data.sources[0],
      goal: "Independent",
      acceptance: [],
      questions: [],
    }));
    if (result.tool && !waiting) {
      waiting = true;
      await held;
    }
    return result;
  };
  const busyStart = live.records.length;
  await live.prompt("/legion A task while busy");
  await until(() => waiting, "interpretation provider waits");
  assert.equal(
    (
      await live.prompt("Another independent task", {
        streamingBehavior: "steer",
      })
    ).disposition,
    "handled",
  );
  const busyView = await live.state();
  assert.equal(
    busyView.snapshot.submissions.at(-1).text,
    "Another independent task",
  );
  assert.equal(
    (await live.rpc("get_state")).pendingMessageCount,
    0,
    "Intake is not queued as steering or followUp",
  );
  release();
  await until(
    () =>
      live.records.slice(busyStart).filter((r) => r.type === "agent_settled")
        .length === 2,
    "settled fresh dispatch for independent busy input",
  );
  assert.deepEqual(
    (await live.state()).tasks.map((t) => t.eligibility),
    ["admitted", "admitted", "admitted", "admitted"],
  );
  checks.push(
    "busy input is durable, not steering, and interpreted in a fresh settled run",
  );
  let releaseOff;
  const offHeld = new Promise((r) => {
    releaseOff = r;
  });
  let offWaiting = false;
  let offStage = 0;
  handler = async (body) => {
    if (offStage++ === 0) {
      offWaiting = true;
      await offHeld;
      return {
        tool: {
          name: "bash",
          arguments: { command: "touch should-not-exist" },
        },
      };
    }
    if (offStage === 2)
      return {
        tool: {
          name: "legion_intake",
          arguments: {
            kind: "new-task",
            source: interpretation(body).sources[0],
            goal: "Late",
            acceptance: [],
            questions: [],
          },
        },
      };
    return { content: "Stopped." };
  };
  const offStart = live.records.length;
  await live.prompt("/legion Saved before off");
  await until(() => offWaiting, "held interpretation before off");
  await live.prompt("/legion off");
  releaseOff();
  await until(
    () => live.records.slice(offStart).some((r) => r.type === "agent_settled"),
    "off interpretation settles",
  );
  const results = live.records
    .slice(offStart)
    .filter((r) => r.type === "tool_execution_end");
  assert.ok(
    results.some(
      (r) =>
        r.toolName === "bash" &&
        r.isError &&
        JSON.stringify(r).includes("only legion_intake"),
    ),
  );
  assert.ok(
    results.some(
      (r) =>
        r.toolName === "legion_intake" &&
        r.isError &&
        r.result.details?.code === "inactive",
    ),
  );
  await assert.rejects(access(join(cwd, "should-not-exist")));
  const stopped = await live.state();
  assert.equal(stopped.mode, "inactive");
  assert.equal(stopped.snapshot.submissions.at(-1).state.kind, "pending");
  checks.push(
    "off preserves input, late proposals rejected, non-intake tools remain blocked until settlement",
  );
  handler = (body) =>
    propose(body, (data) => ({
      kind: "new-task",
      source: data.sources[0],
      goal: "Recovered pending task",
      acceptance: [],
      questions: [],
    }));
  const resumeStart = live.records.length;
  await live.prompt(`/legion resume ${stopped.snapshot.id}`);
  await until(
    () =>
      live.records.slice(resumeStart).some((r) => r.type === "agent_settled"),
    "explicit resume retries saved stalled input",
  );
  assert.equal(
    (await live.state()).snapshot.submissions.at(-1).state.kind,
    "applied",
  );
  const finalLive = await live.rpc("get_state");
  assert.deepEqual(finalLive.model, modelBefore.model);
  assert.equal(finalLive.thinkingLevel, modelBefore.thinkingLevel);
  assert.equal(
    finalLive.autoCompactionEnabled,
    modelBefore.autoCompactionEnabled,
  );
  checks.push(
    "explicit resume retries stalled input once with unchanged model, reasoning, and compaction",
  );
  const forkMessages = await live.rpc("get_fork_messages");
  assert.ok(forkMessages.messages[0]);
  await live.rpc("fork", { entryId: forkMessages.messages[0].entryId });
  assert.equal(
    await live.state(),
    null,
    "Fork starts inactive and does not duplicate logical records",
  );
  const forkStatusStart = live.records.length;
  await live.prompt(`/legion status ${stopped.snapshot.id}`);
  noTurn(live, forkStatusStart);
  assert.ok(
    live.records
      .slice(forkStatusStart)
      .some(
        (r) => r.method === "notify" && r.message.includes("Saved before off"),
      ),
  );
  checks.push(
    "real fork revokes intake, stays inactive, and preserves logical records",
  );
  await live.close();
  handler = (body) =>
    propose(body, (data) => ({
      kind: "new-task",
      source: data.sources[0],
      goal: "TUI greeting",
      acceptance: [],
      questions: [
        { question: "Which language?", recommendation: "Use English" },
      ],
    }));
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify({ env, cwd, root }),
  );
  const tui = spawn(
    "python3",
    [resolve("scripts/verify-tui.py"), join(root, "fixture.json")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let tuiOut = "";
  tui.stdout.on("data", (b) => {
    tuiOut += b;
  });
  tui.stderr.on("data", (b) => {
    tuiOut += b;
  });
  await new Promise((r, reject) =>
    tui.once("exit", (code) => (code === 0 ? r() : reject(new Error(tuiOut)))),
  );
  checks.push(
    "real PTY command completion, English doctor, decision and recommendation rendering",
  );

  await writeFile(join(root, "rpc.json"), JSON.stringify(logs));
  assert.equal(hash(await readFile(hostSettings)), hostBefore);
  assert.equal(
    hash(await readFile(join(agent, "settings.json"))),
    fixtureSettingsHash,
  );
  const result = {
    result: "passed",
    root,
    pi: execFileSync("pi", ["--version"], { env }).toString().trim(),
    node: process.version,
    herdr: localHerdr.version,
    protocol: localHerdr.protocol,
    providerRequests: requests,
    checks,
  };
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const c of clients) await c.close();
  server.close();
  await writeFile(join(root, "rpc.json"), JSON.stringify(logs));
  console.error(`Evidence ${root}`);
}
