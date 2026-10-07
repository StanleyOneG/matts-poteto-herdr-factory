import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { Legion } from "../src/intake.ts";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  access,
  rm,
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
    `export default async function(pi) {
    let race = false;
    const fs = await import('node:fs');
    pi.registerProvider('held-auth', { ...${JSON.stringify(models.providers.fixture)}, oauth: {
      name: 'Test-owned held authentication',
      login: async () => { throw new Error('Fixture login is forbidden'); },
      refreshToken: async credential => {
        fs.writeFileSync(${JSON.stringify(join(root, "auth-check-started"))}, 'checking');
        while (!fs.existsSync(${JSON.stringify(join(root, "auth-check-release"))})) await new Promise(r => setTimeout(r, 20));
        return { ...credential, expires: Date.now() + 3600000 };
      },
      getApiKey: credential => credential.access,
    } });
    pi.registerCommand('fixture-restore-auth', { handler: async () => { pi.registerProvider('fixture', ${JSON.stringify(models.providers.fixture)}); } });
    pi.registerCommand('fixture-host-command', { handler: async () => { pi.sendUserMessage('/legion task Host-command fixture input', {expandPromptTemplates: true}); } });
    pi.registerCommand('fixture-extension-input', { handler: async () => { pi.sendUserMessage('Injected ordinary answer'); } });
    pi.registerCommand('fixture-uncorrelated-error', { handler: async () => { pi.sendUserMessage('Unrelated host message during a running turn'); } });
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
  handler = (body) => propose(body, (data) => ({ kind: "new-task", source: data.sources[0], goal: "Held authentication task", acceptance: [], questions: [] }));
  for (const interrupt of ["resume", "off", "busy", "settled"]) {
    await rm(join(root, "auth-check-started"), { force: true });
    await rm(join(root, "auth-check-release"), { force: true });
    await writeFile(join(agent, "auth.json"), JSON.stringify({ "held-auth": { type: "oauth", access: "test-owned-not-a-secret", refresh: "test-owned-refresh", expires: 0 } }));
    const checking = client(["--provider", "held-auth", "--model", "controlled"]);
    const checkStart = checking.records.length;
    const requestsBeforeCheck = requests;
    await checking.prompt(`/legion Held auth ${interrupt}`);
    await until(() => existsSync(join(root, "auth-check-started")), "authentication check is actually held");
    const checkingView = await checking.state();
    let releaseOrdinary;
    let ordinaryWaiting = false;
    if (interrupt === "busy" || interrupt === "settled") {
      await checking.rpc("set_model", { provider: "fixture", modelId: "controlled" });
      const ordinaryHeld = new Promise(r => { releaseOrdinary = r; });
      handler = async body => {
        if (JSON.stringify(body.messages.at(-1)?.content).includes("Injected ordinary answer")) {
          ordinaryWaiting = true;
          if (interrupt === "busy") await ordinaryHeld;
          return { content: "Unrelated turn settled." };
        }
        return propose(body, data => ({ kind: "new-task", source: data.sources[0], goal: "Deferred held-auth task", acceptance: [], questions: [] }));
      };
      await checking.prompt("/fixture-extension-input");
      await until(() => ordinaryWaiting, "unrelated turn starts while local auth check is held");
    } else if (interrupt === "resume") await checking.prompt(`/legion resume ${checkingView.snapshot.id}`);
    else await checking.prompt("/legion off");
    await new Promise((r) => setTimeout(r, 100));
    if (interrupt !== "busy" && interrupt !== "settled") {
      noTurn(checking, checkStart);
      assert.equal(requests, requestsBeforeCheck, "Held local authentication must not forward or overlap a turn");
    }
    if (interrupt === "settled")
      await until(() => checking.records.slice(checkStart).some(r => r.type === "agent_settled"), "unrelated run settles before local auth completes");
    await writeFile(join(root, "auth-check-release"), "released");
    if (interrupt === "busy") {
      await until(() => checking.records.slice(checkStart).some(r => r.method === "notify" && r.message.includes("Interpretation deferred. Inputs remain saved.")), "busy race after local auth check is consumed before forwarding");
      assert.equal(requests, requestsBeforeCheck + 1, "Only the unrelated request runs before settlement");
      releaseOrdinary();
      await until(() => checking.records.slice(checkStart).filter(r => r.type === "agent_settled").length === 2, "deferred auth-check input gets a fresh interpretation after settlement");
      assert.equal((await checking.state()).tasks[0].eligibility, "admitted");
    } else if (interrupt === "settled") {
      await until(() => checking.records.slice(checkStart).filter(r => r.type === "agent_settled").length === 2, "unrelated settlement preserves the locally checking dispatch");
      assert.equal((await checking.state()).tasks[0].eligibility, "admitted");
    } else if (interrupt === "resume") {
      await until(() => checking.records.slice(checkStart).some((r) => r.type === "agent_settled"), "one held-check dispatch settles after resume");
      assert.equal(checking.records.slice(checkStart).filter((r) => r.type === "agent_start").length, 1);
      assert.equal((await checking.state()).tasks[0].eligibility, "admitted");
    } else {
      await new Promise((r) => setTimeout(r, 200));
      noTurn(checking, checkStart);
      const cancelled = await checking.state();
      assert.equal(cancelled.mode, "inactive");
      assert.equal(cancelled.snapshot.submissions[0].text, "Held auth off");
      assert.equal(cancelled.snapshot.submissions[0].state.kind, "pending");
      const recheckStart = checking.records.length;
      await checking.prompt(`/legion resume ${cancelled.snapshot.id}`);
      await until(() => checking.records.slice(recheckStart).some((r) => r.type === "agent_settled"), "off during checking retains input for explicit resume");
      assert.equal((await checking.state()).tasks[0].eligibility, "admitted");
    }
    await checking.prompt("/legion off");
    await checking.close();
  }
  await writeFile(join(agent, "auth.json"), "{}");
  checks.push("held auth refuses overlapping resume; off preserves input; busy and unrelated-settlement races preserve fresh dispatch");
  handler = (body) => propose(body, (data) => ({ kind: "new-task", source: data.sources[0], goal: "Authentication restored", acceptance: [], questions: [] }));
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { ...models.providers.fixture, apiKey: undefined } } }));
  const missingAuth = client(["--provider", "fixture", "--model", "controlled"]);
  const missingModel = await missingAuth.rpc("get_state");
  assert.equal(missingModel.model?.provider, "fixture");
  const missingStart = missingAuth.records.length;
  await missingAuth.prompt("/legion Keep exact missing-auth input");
  await until(() => missingAuth.records.slice(missingStart).some((r) => r.method === "notify" && r.message?.includes("Intake stalled before delivery. Authentication is unavailable.")), "real missing-auth failure before agent_start");
  noTurn(missingAuth, missingStart);
  assert.equal(missingAuth.records.slice(missingStart).filter((r) => r.type === "agent_settled").length, 0);
  const missingView = await missingAuth.state();
  assert.equal(missingView.snapshot.submissions[0].text, "Keep exact missing-auth input");
  assert.equal(missingView.snapshot.submissions[0].state.kind, "pending");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(missingAuth.records.slice(missingStart).filter((r) => r.method === "notify" && r.message?.includes("Intake stalled before delivery.")).length, 1, "No autonomous missing-auth retries");
  assert.equal(missingAuth.records.slice(missingStart).filter((r) => r.type === "extension_error").length, 0, "Known auth failure is consumed before host delivery");
  await writeFile(join(agent, "models.json"), JSON.stringify(models));
  await missingAuth.prompt("/fixture-restore-auth");
  await missingAuth.rpc("get_state");
  const retryStart = missingAuth.records.length;
  await missingAuth.prompt(`/legion resume ${missingView.snapshot.id}`);
  await until(() => missingAuth.records.slice(retryStart).some((r) => r.type === "agent_settled"), "explicit resume retries a pre-start authentication failure");
  const recoveredAuth = await missingAuth.state();
  assert.equal(recoveredAuth.snapshot.submissions[0].text, "Keep exact missing-auth input");
  assert.equal(recoveredAuth.snapshot.submissions[0].state.kind, "applied");
  assert.equal(recoveredAuth.tasks[0].eligibility, "admitted");
  await missingAuth.prompt("/legion off");
  await missingAuth.close();
  await writeFile(join(agent, "auth.json"), "{}");
  await writeFile(join(agent, "models.json"), JSON.stringify(models));
  checks.push("real missing authentication leaves original pending, no autonomous retry, explicit resume retries after isolated authentication restoration");
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
  handler = async (body) => {
    const result = propose(body, (data) => {
      const decision = data.state.snapshot.decisions.find((d) => d.state.kind === "open");
      if (decision)
        return { kind: "answer", source: data.sources[0], decision: { id: decision.id, revision: 1 }, effect: { kind: "record-clarification", target: decision.history[0].affected[0], answer: data.state.snapshot.submissions.find((s) => s.id === data.sources[0].id).text } };
      return { kind: "new-task", source: data.sources[0], goal: "TUI greeting", acceptance: [], questions: [{ question: "Which language?", recommendation: "Use English" }] };
    });
    if (!result.tool && interpretation(body).state.snapshot.decisions.length === 0) {
      await until(() => existsSync(join(root, "tui-off")), "TUI switches off before settlement");
      return { content: "TUI inactive settlement." };
    }
    return result;
  };
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
    "real PTY completion, English doctor, off before settlement, inactive refresh without duplicate questions, explicit resume and ordinary answering",
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
  const whitespaceStart = live.records.length;
  const whitespaceEntries = (await live.rpc("get_entries")).entries;
  for (const message of ["/legion  status", "/legion   status   ", "/legion \tstatus\t ", "/legion   doctor   ", "/legion \tdoctor\t"]) {
    await live.prompt(message);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await live.state(), null, "Whitespace observations must remain inactive without creating intake");
    noTurn(live, whitespaceStart);
    assert.deepEqual((await live.rpc("get_entries")).entries, whitespaceEntries, "Whitespace observations do not add conversation entries");
  }
  await live.prompt("/legion on");
  const active = await live.state();
  assert.equal(active.mode, "active");
  const activeEntries = (await live.rpc("get_entries")).entries;
  const activeFiles = await readdir(join(agent, "legion"));
  const activeBytes = await Promise.all(activeFiles.map(async file => [file, await readFile(join(agent, "legion", file))]));
  for (const message of ["/legion  status  ", `/legion   status  ${active.snapshot.id}   `, `/legion \tstatus\t${active.snapshot.id}\t`, "/legion  doctor  "]) {
    await live.prompt(message);
    assert.deepEqual(await live.state(), active, "Active whitespace observations preserve ownership, receipts, tasks and generation");
  }
  assert.deepEqual((await live.rpc("get_entries")).entries, activeEntries);
  assert.deepEqual(await Promise.all((await readdir(join(agent, "legion"))).map(async file => [file, await readFile(join(agent, "legion", file))])), activeBytes, "Whitespace observations preserve all storage bytes");
  await live.prompt("/legion \ton \t");
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
  let releaseInactive;
  const inactiveHeld = new Promise((r) => { releaseInactive = r; });
  let inactiveWaiting = false;
  handler = async () => {
    inactiveWaiting = true;
    await inactiveHeld;
    return { content: "Extension-origin text is not an Emperor answer." };
  };
  const extensionStart = live.records.length;
  await live.prompt("/fixture-extension-input");
  await until(() => inactiveWaiting, "ordinary run held before off");
  await live.prompt("/legion off");
  releaseInactive();
  await until(
    () =>
      live.records
        .slice(extensionStart)
        .some((r) => r.type === "agent_settled"),
    "extension-origin ordinary message settles",
  );
  const extensionView = await live.state();
  assert.equal(extensionView.snapshot.submissions.length, 1);
  assert.equal(extensionView.mode, "inactive");
  assert.equal(extensionView.snapshot.decisions[0].state.kind, "open");
  await live.prompt("/legion off");
  assert.equal((await live.rpc("get_entries")).entries.filter((e) => e.type === "custom_message" && e.customType === "legion-decision").length, 1, "Off, inactive settlement and inactive refresh must not republish questions");
  await live.prompt(`/legion resume ${blocked.snapshot.id}`);
  assert.equal((await live.state()).tasks[0].eligibility, "blocked");
  assert.equal((await live.rpc("get_entries")).entries.filter((e) => e.type === "custom_message" && e.customType === "legion-decision").length, 1, "Resume retains a current actionable question without duplication");
  checks.push(
    "extension-origin input cannot answer; off, inactive settlement and refresh retain one question; resume retains actionable presentation",
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
  const startedView = await live.state();
  const startedRequests = requests;
  await live.prompt("/legion off");
  await live.prompt(`/legion resume ${startedView.snapshot.id}`);
  await live.prompt("/fixture-uncorrelated-error");
  await until(() => live.records.slice(offStart).some((r) => r.type === "extension_error" && r.error.includes("Agent is already processing")), "uncorrelated host delivery fails during the started run");
  assert.equal(requests, startedRequests, "Off and explicit resume cannot dispatch over a genuinely started turn");
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
    "started turn retains guards through off, explicit resume and an uncorrelated delivery error until settlement; late proposals reject",
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
  handler = body => propose(body, data => ({ kind: "new-task", source: data.sources[0], goal: "Literal retained", acceptance: [], questions: [] }));
  const literal = client();
  for (const [message, text] of [["/legion  Fix literal label  ", " Fix literal label  "], ["/legion  \ttask\t  status \n", "  status \n"]]) {
    const literalStart = literal.records.length;
    await literal.prompt(message);
    await until(() => literal.records.slice(literalStart).some(r => r.type === "agent_settled"), "literal command task settles");
    assert.equal((await literal.state()).snapshot.submissions.at(-1).text, text);
    assert.equal((await literal.state()).snapshot.submissions.at(-1).originIntent.kind, "new-task");
  }
  const literalView = await literal.state();
  const literalObserveStart = literal.records.length;
  await literal.prompt("/legion \toff \t");
  assert.equal((await literal.state()).mode, "inactive");
  await literal.prompt(`/legion \tresume\t${literalView.snapshot.id}  `);
  assert.equal((await literal.state()).snapshot.id, literalView.snapshot.id);
  assert.equal((await literal.state()).snapshot.submissions.length, 2);
  noTurn(literal, literalObserveStart);
  await literal.prompt("/legion off");
  await literal.close();
  checks.push("real whitespace observations stay model-free and byte-preserving; reserved on/off/resume route consistently; direct and task-escaped literal text remains exact");

  for (const [round, taskBearing] of [false, false, false, true].entries()) {
    const session = randomUUID();
    const pair = [client(["--session-id", session]), client(["--session-id", session])];
    await Promise.all(pair.map(c => c.rpc("get_state")));
    const starts = pair.map(c => c.records.length);
    await Promise.all(pair.map((c, i) => c.prompt(taskBearing ? `/legion task Exact association task ${i}  ` : "/legion on")));
    const states = await Promise.all(pair.map(c => c.state()));
    assert.equal(states.filter(s => s?.mode === "active").length, 1, "Same-session concurrent Pi RPC activation must have exactly one owner");
    const winner = states.findIndex(s => s?.mode === "active");
    const loser = 1 - winner;
    const id = states[winner].snapshot.id;
    assert.equal(states[loser].mode, "inactive");
    assert.equal(states[loser].snapshot.id, id);
    noTurn(pair[loser], starts[loser]);
    assert.equal(pair[loser].records.slice(starts[loser]).filter(r => r.method === "notify" && /\nReceipt /.test(r.message)).length, 0, "A rejected contender has no successful receipt");
    if (taskBearing) {
      await until(() => pair[winner].records.slice(starts[winner]).some(r => r.type === "agent_settled"), "single association owner's task settles");
      const saved = await pair[winner].state();
      assert.equal(saved.snapshot.submissions.length, 1);
      assert.equal(saved.snapshot.submissions[0].text, `Exact association task ${winner}  `);
      assert.equal(saved.snapshot.tasks.length, 1);
    } else {
      noTurn(pair[winner], starts[winner]);
      assert.equal(states[winner].snapshot.receipts.length, 1);
    }
    if (round !== 1) await pair[winner].prompt("/legion off");
    await Promise.all(pair.map(c => c.close()));
    const restart = client(["--session-id", session]);
    assert.equal((await restart.state()).snapshot.id, id);
    await restart.prompt("/legion on");
    assert.equal((await restart.state()).snapshot.id, id);
    assert.equal((await restart.state()).mode, "active");
    await restart.prompt("/legion off");
    await restart.close();
  }
  checks.push("real same-session concurrent activation has one owner and identity; rejected contender has no receipt or turn; exact task retained; restart and off release remain stable");

  const ancestor = client(["--session-id", randomUUID()]);
  await ancestor.prompt("/legion on");
  const ancestorId = (await ancestor.state()).snapshot.id;
  await ancestor.close();
  for (const concurrent of [true, false]) {
    const session = randomUUID();
    const pair = [client(["--session-id", session]), client(["--session-id", session])];
    await Promise.all(pair.map(c => c.rpc("get_state")));
    if (concurrent) {
      await Promise.all([pair[0].prompt("/legion on"), pair[1].prompt(`/legion resume ${ancestorId}`)]);
    } else {
      await pair[0].prompt("/legion on");
      assert.notEqual((await pair[0].state()).snapshot.id, ancestorId);
      await pair[1].prompt(`/legion resume ${ancestorId}`);
    }
    const states = await Promise.all(pair.map(c => c.state()));
    assert.equal(states.filter(s => s?.mode === "active").length, 1, "Activation and different-ID resume cannot own the same association");
    const winner = states.findIndex(s => s?.mode === "active");
    assert.equal(states[1 - winner].snapshot.id, states[winner].snapshot.id);
    noTurn(pair[0], 0);
    noTurn(pair[1], 0);
    await Promise.all(pair.map(c => c.close()));
    const reopened = client(["--session-id", session]);
    assert.equal((await reopened.state()).snapshot.id, states[winner].snapshot.id);
    await reopened.prompt("/legion on");
    assert.equal((await reopened.state()).mode, "active");
    await reopened.close();
  }
  checks.push("real concurrent activation versus different-ID resume and an already-live initial owner retain one association; normal shutdown releases both leases");

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
