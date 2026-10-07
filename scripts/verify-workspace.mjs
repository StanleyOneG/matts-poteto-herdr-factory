import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
const exec = promisify((await import("node:child_process")).execFile);
import { Legion } from "../src/intake.ts";
const root = await mkdtemp(join(tmpdir(), "legion-workspace-pi-"));
const agent = join(root, "agent"),
  cwd = join(root, "repo");
await mkdir(agent);
await mkdir(cwd);
const herdr = JSON.parse(
  execFileSync("herdr", ["status", "server", "--json"]).toString(),
);
assert.equal(
  herdr.running,
  true,
  "The existing local read-only Herdr prerequisite is available",
);
await mkdir(join(root, ".config/herdr"), { recursive: true });
await symlink(herdr.socket, join(root, ".config/herdr/herdr.sock"));
execFileSync("git", ["init", "-q", cwd]);
execFileSync("git", [
  "-C",
  cwd,
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.test",
  "commit",
  "--allow-empty",
  "-qm",
  "base",
]);
execFileSync("git", ["-C", cwd, "branch", "intended"]);
await writeFile(join(cwd, "sentinel"), "preexisting work\n");
const session = randomUUID();
const initial = new Legion({
  storagePath: join(agent, "legion"),
  context: cwd,
  session,
  preflight: async () => [],
});
const command = (text, requestKey) =>
  initial.command({
    text,
    requestKey,
    evidence: {
      origin: "host-command",
      transport: "source-unavailable",
      session,
      generation: null,
      presented: [],
    },
  });
await command("task Isolated workspace", "task");
let view = await initial.state();
const source = view.snapshot.submissions[0];
await initial.submit({
  kind: "interpretation",
  requestKey: "admit",
  proposal: {
    kind: "new-task",
    source: { id: source.id, revision: 1 },
    goal: "Isolated workspace",
    acceptance: [],
    questions: [],
  },
  evidence: {
    session,
    generation: view.snapshot.generation,
    legatus: view.snapshot.id,
    run: "test",
    sources: [{ id: source.id, revision: 1 }],
  },
});
view = await initial.state();
const task = view.tasks[0],
  owner = view.snapshot.id;
for (const name of ["denied", "stopping", "tui", "reading"]) {
  await command(`task ${name} workspace`, `task-${name}`);
  const pending = await initial.state();
  const next = pending.snapshot.submissions.at(-1);
  await initial.submit({
    kind: "interpretation",
    requestKey: `admit-${name}`,
    proposal: {
      kind: "new-task",
      source: { id: next.id, revision: 1 },
      goal: `${name} workspace`,
      acceptance: [],
      questions: [],
    },
    evidence: {
      session,
      generation: pending.snapshot.generation,
      legatus: owner,
      run: "test",
      sources: [{ id: next.id, revision: 1 }],
    },
  });
}
const prepared = await initial.state();
const deniedTask = prepared.tasks[1],
  stoppingTask = prepared.tasks[2],
  tuiTask = prepared.tasks[3],
  readingTask = prepared.tasks[4];
await command("off", "off");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hostSettings = join(homedir(), ".pi/agent/settings.json");
const hostBefore = hash(await readFile(hostSettings));
let requestId = "",
  responseTool = "legion_workspace";
let calls = 0;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const data of req) raw += data;
  const body = JSON.parse(raw);
  calls++;
  const text = body.messages
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : (message.content ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text),
    )
    .join("\n");
  const ids = [...text.matchAll(/Host workspace request ([0-9a-f-]{36})/g)];
  const correlatedId = ids.at(-1)?.[1] ?? requestId;
  const answer =
    body.messages.at(-1)?.role === "tool"
      ? {
          role: "assistant",
          content: "Workspace stage finished. No worker started.",
        }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `workspace_${calls}`,
              type: "function",
              function: {
                name: responseTool,
                arguments: JSON.stringify(
                  responseTool === "legion_workspace"
                    ? { requestId: correlatedId }
                    : { command: "touch forbidden-root-bash" },
                ),
              },
            },
          ],
        };
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (delta, finish_reason) => ({
    id: `chat_${calls}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "controlled",
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.write(`data: ${JSON.stringify(chunk(answer, null))}\n\n`);
  res.write(
    `data: ${JSON.stringify(chunk({}, answer.tool_calls ? "tool_calls" : "stop"))}\n\n`,
  );
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const packages = ["@zenspc/pi-pstack", "pi-subagents"].map((name) =>
  join(homedir(), ".pi/agent/npm/node_modules", name),
);
await writeFile(
  join(agent, "settings.json"),
  JSON.stringify({
    packages,
    defaultProvider: "fixture",
    defaultModel: "controlled",
    defaultThinkingLevel: "off",
    lastChangelogVersion: "1.0.4",
  }),
);
await writeFile(
  join(agent, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        api: "openai-completions",
        apiKey: "test-owned-not-secret",
        models: [
          {
            id: "controlled",
            name: "Controlled workspace fixture",
            reasoning: false,
            input: ["text"],
            contextWindow: 200000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  }),
);
const guard = join(root, "guard.ts");
await writeFile(
  guard,
  `export default function(pi) {
  let denied = false, held = false, release = null, heldRead = false, releaseRead = null;
  pi.registerCommand('fixture-deny', { handler: async () => { denied = true; } });
  pi.registerCommand('fixture-allow', { handler: async () => { denied = false; } });
  pi.registerCommand('fixture-hold', { handler: async () => { held = true; } });
  pi.registerCommand('fixture-release', { handler: async () => { held = false; release?.(); } });
  pi.registerCommand('fixture-hold-read', { handler: async () => { heldRead = true; } });
  pi.registerCommand('fixture-release-read', { handler: async () => { heldRead = false; releaseRead?.(); } });
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'subagent') return { block: true, reason: 'Test never launches workers' };
    if (heldRead && event.toolName === 'bash' && event.input.command?.includes("'rev-parse'")) {
      ctx.ui.notify('TEST-OWNED Git discovery held', 'info');
      await new Promise(resolve => { releaseRead = resolve; });
    }
    if (event.toolName === 'bash' && event.input.command?.includes("'update-ref'")) {
      if (denied) return { block: true, reason: 'TEST-OWNED permission refusal' };
      if (held) { ctx.ui.notify('TEST-OWNED Git invocation held', 'info'); await new Promise(resolve => { release = resolve; }); }
    }
  });
}`,
);
const args = [
  "--mode",
  "rpc",
  "--no-context-files",
  "--session-id",
  session,
  "-e",
  resolve("src/extension.ts"),
  "-e",
  guard,
];
for (const skill of [
  "skills/herdr",
  ".agents/skills/implement",
  ".pi/skills/matt-tdd",
  ".pi/skills/code-review",
])
  args.push("--skill", resolve(skill));
const child = spawn("pi", args, {
  cwd,
  env: {
    PATH: process.env.PATH,
    HOME: root,
    PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    TERM: "xterm-256color",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const records = [],
  waiters = new Map();
let buffer = "",
  stderr = "",
  seq = 0;
child.stderr.on("data", (data) => {
  stderr += data;
});
child.stdout.on("data", (data) => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const record = JSON.parse(line);
    records.push(record);
    if (record.type === "response") {
      waiters.get(record.id)?.(record);
      waiters.delete(record.id);
    }
  }
});
const rpc = (type, fields = {}) =>
  new Promise((resolve, reject) => {
    const id = String(++seq);
    waiters.set(id, (record) =>
      record.success ? resolve(record) : reject(new Error(record.error)),
    );
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
  });
const prompt = (message) => rpc("prompt", { message });
async function state() {
  const start = records.length;
  await prompt("/legion status");
  const notification = records
    .slice(start)
    .find(
      (record) =>
        record.method === "notify" && record.message?.includes("\nState\n"),
    );
  assert.ok(notification, JSON.stringify(records.slice(start)));
  return JSON.parse(notification.message.split("\nState\n")[1]);
}
async function settled(start) {
  while (
    !records.slice(start).some((record) => record.type === "agent_settled")
  ) {
    if (child.exitCode !== null) throw new Error(stderr);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
try {
  const commands = (await rpc("get_commands")).data.commands;
  assert.ok(
    commands.some(
      (command) =>
        command.name === "legion" &&
        command.description.includes("reserve") &&
        command.description.includes("workspace"),
    ),
    "Command discovery includes reserve and guarded workspace stage",
  );
  assert.equal((await state()).mode, "inactive");
  const beforeResume = records.length;
  await prompt(`/legion resume ${owner}`);
  const active = await state();
  assert.equal(
    active.mode,
    "active",
    JSON.stringify(records.slice(beforeResume)),
  );
  assert.equal(
    records.slice(beforeResume).some((record) => record.type === "agent_start"),
    false,
  );
  const start = records.length;
  await prompt(`/legion reserve ${task.id}@1 --parent refs/heads/intended`);
  const receipt = records
    .slice(start)
    .find(
      (record) =>
        record.method === "notify" &&
        record.message?.includes("Task NOT YET RESERVED"),
    );
  assert.ok(receipt, JSON.stringify(records.slice(start)));
  assert.equal(
    records.slice(start).some((record) => record.type === "agent_start"),
    false,
  );
  requestId = (await state()).snapshot.workspaceRequests.at(-1).id;
  const workspaceStart = records.length;
  await prompt(`/legion workspace ${requestId}`);
  await settled(workspaceStart);
  const ready = await state();
  assert.equal(ready.tasks[0].claim.kind, "owned", JSON.stringify(ready));
  assert.deepEqual(ready.tasks[0].claim.workspace, { kind: "ready" });
  const plan = ready.tasks[0].claim.reservation.plan;
  assert.equal(
    execFileSync("git", ["-C", plan.path, "symbolic-ref", "HEAD"])
      .toString()
      .trim(),
    plan.branch,
  );
  assert.equal(
    await readFile(join(cwd, "sentinel"), "utf8"),
    "preexisting work\n",
  );
  assert.ok(
    records
      .slice(workspaceStart)
      .some(
        (record) =>
          record.method === "notify" &&
          record.message?.includes(
            "Task reserved. Workspace ready. No worker started.",
          ),
      ),
  );
  const rootStart = records.length;
  responseTool = "bash";
  await prompt(`/legion reconcile ${task.id}`);
  requestId = (await state()).snapshot.workspaceRequests.at(-1).id;
  await prompt(`/legion workspace ${requestId}`);
  await settled(rootStart);
  assert.equal(
    execFileSync("git", ["-C", cwd, "status", "--porcelain"])
      .toString()
      .includes("forbidden-root-bash"),
    false,
  );
  assert.ok(
    records
      .slice(rootStart)
      .some(
        (record) =>
          record.type === "tool_execution_end" &&
          record.isError &&
          JSON.stringify(record.result).includes("exact correlated root tool"),
      ),
  );
  responseTool = "legion_workspace";
  await prompt("/fixture-deny");
  await prompt(
    `/legion reserve ${deniedTask.id}@1 --parent refs/heads/intended`,
  );
  requestId = (await state()).snapshot.workspaceRequests.at(-1).id;
  const denyStart = records.length;
  await prompt(`/legion workspace ${requestId}`);
  await settled(denyStart);
  const refused = (await state()).tasks[1].claim;
  assert.equal(refused.kind, "owned");
  assert.equal(refused.workspace.code, "unknown-operation");
  assert.equal(
    execFileSync("git", [
      "-C",
      cwd,
      "for-each-ref",
      "--format=%(refname)",
      refused.reservation.plan.branch,
    ]).toString(),
    "",
  );
  assert.ok(
    records
      .slice(denyStart)
      .some(
        (record) =>
          record.type === "tool_execution_end" &&
          record.toolName === "bash" &&
          record.isError &&
          JSON.stringify(record.result).includes(
            "TEST-OWNED permission refusal",
          ),
      ),
  );
  await prompt("/fixture-allow");
  await prompt("/fixture-hold");
  await prompt(
    `/legion reserve ${stoppingTask.id}@1 --parent refs/heads/intended`,
  );
  requestId = (await state()).snapshot.workspaceRequests.at(-1).id;
  const stopStart = records.length;
  await prompt(`/legion workspace ${requestId}`);
  while (
    !records
      .slice(stopStart)
      .some(
        (record) =>
          record.method === "notify" &&
          record.message === "TEST-OWNED Git invocation held",
      )
  )
    await new Promise((resolve) => setImmediate(resolve));
  await prompt("/legion off");
  assert.equal((await state()).mode, "stopping");
  await prompt(`/legion resume ${owner}`);
  assert.equal((await state()).mode, "stopping");
  await prompt("/legion off");
  await prompt("/fixture-release");
  await settled(stopStart);
  const stopped = await state();
  assert.equal(stopped.mode, "inactive");
  assert.equal(stopped.tasks[2].claim.workspace.code, "approval");
  assert.equal(
    execFileSync("git", ["-C", cwd, "worktree", "list", "--porcelain"])
      .toString()
      .includes(stopped.tasks[2].claim.reservation.plan.path),
    false,
  );
  await prompt(`/legion resume ${owner}`);
  await prompt("/fixture-hold-read");
  await prompt(
    `/legion reserve ${readingTask.id}@1 --parent refs/heads/intended`,
  );
  requestId = (await state()).snapshot.workspaceRequests.at(-1).id;
  const readStart = records.length;
  await prompt(`/legion workspace ${requestId}`);
  while (
    !records
      .slice(readStart)
      .some(
        (record) =>
          record.method === "notify" &&
          record.message === "TEST-OWNED Git discovery held",
      )
  )
    await new Promise((resolve) => setImmediate(resolve));
  await prompt("/legion off");
  assert.equal((await state()).mode, "stopping");
  await prompt(`/legion resume ${owner}`);
  assert.equal((await state()).mode, "stopping");
  await prompt("/fixture-release-read");
  await settled(readStart);
  const afterRead = await state();
  assert.equal(afterRead.mode, "inactive");
  assert.equal(afterRead.tasks[4].claim.kind, "unreserved");
  assert.equal(
    records.some(
      (record) =>
        record.type === "tool_execution_start" &&
        record.toolName === "subagent",
    ),
    false,
  );
  await prompt("/legion off");
  assert.equal((await state()).mode, "inactive");
  child.stdin.end();
  if (child.exitCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  const tuiFixture = join(root, "tui-fixture.json");
  await writeFile(
    tuiFixture,
    JSON.stringify({
      root,
      cwd,
      owner,
      task: tuiTask.id,
      args: args.slice(2),
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PI_CODING_AGENT_DIR: agent,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
        TERM: "xterm-256color",
      },
    }),
  );
  const tui = await exec("python3", [
    resolve("scripts/verify-workspace-tui.py"),
    tuiFixture,
  ]);
  assert.match(tui.stdout, /passed real TUI/);
  const hostAfter = hash(await readFile(hostSettings));
  assert.equal(hostAfter, hostBefore);
  const evidence = {
    root,
    session,
    owner,
    task: task.id,
    hostBefore,
    hostAfter,
    version: execFileSync("pi", ["--version"]).toString().trim(),
    records,
    stderr,
    tui: tui.stdout,
    tuiLog: join(root, "workspace-tui.txt"),
    result: "passed",
  };
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      root,
      hostBefore,
      hostAfter,
      branch: plan.branch,
      path: plan.path,
    }),
  );
} finally {
  child.stdin.end();
  if (child.exitCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  await new Promise((resolve) => server.close(resolve));
}
