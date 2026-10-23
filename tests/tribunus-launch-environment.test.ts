import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { LaunchRecord } from "../src/tribunus.js";
import type { GuardedCommand } from "../src/git-workspace.js";
import { exerciseNativeAssignment } from "./support/composed-transport.mjs";

const execute = promisify(exec);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

type Fault = "observation-denied" | "observation-unknown" | "observation-empty" | "observation-malformed"
  | "run-denied" | "run-unknown" | "wait-denied" | "wait-unknown" | "wait-empty" | "wait-malformed"
  | "missing-receipt" | "echo-receipt" | "stale-receipt" | "wrong-pane-receipt"
  | "wrong-workspace-before" | "wrong-tab-before" | "wrong-terminal-before" | "busy-before"
  | "wrong-workspace-after" | "wrong-tab-after" | "wrong-pane-after" | "wrong-terminal-after"
  | "shell-changed-after" | "busy-after" | "helper-before" | "group-changed-after" | "group-missing-after"
  | "duplicate-shell-after" | "duplicate-helper-after" | "empty-group-after" | "invalid-pid-after"
  | "agent-after" | "session-after" | "owner-session-after" | "owner-process-after" | "owner-terminal-after" | "owner-missing-after"
  | "server-after" | "endpoint-after" | "post-observation-denied" | "post-observation-unknown" | "post-observation-empty" | "post-observation-malformed"
  | "start-denied" | "start-unknown" | "start-empty" | "start-malformed";
async function fixture({ fault, helperName, startupSelection = { kind: "exact", selection: { model: "openai-codex/gpt-6.1-sol", thinking: "high" } } }: { fault?: Fault; helperName?: string; startupSelection?: Parameters<LocalTribunusHost["createWindow"]>[0]["startupSelection"] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "le-")), bin = join(root, "b");
  await mkdir(bin);
  const prior = { ...process.env };
  const authority = { owner: randomUUID(), session: "fixture-legatus", generation: 1, epoch: 0 };
  const launch = LaunchRecord.parse({ id: randomUUID(), reservation: randomUUID(), revision: 0, scope: "launch environment", state: { kind: "prepared" } });
  const owner = { workspace_id: "fixture-workspace", tab_id: "owner-tab", pane_id: "owner-pane", terminal_id: "owner-terminal", agent: "pi", agent_session: { kind: "id", value: authority.session } };
  const pane = { workspace_id: "fixture-workspace", tab_id: "worker-tab", pane_id: "worker-pane", terminal_id: "worker-terminal" };
  const paneFile = join(root, "pane.json"), processFile = join(root, "process.json"), observedFile = join(root, "observed.json");
  const ownerFile = join(root, "owner.json"), ownerProcesses = join(root, "owner-processes.json"), endpointFile = join(root, "endpoint.json");
  await writeFile(ownerFile, JSON.stringify(owner));
  await writeFile(ownerProcesses, JSON.stringify({ foreground_processes: [{ pid: process.pid }] }));
  await writeFile(paneFile, JSON.stringify(pane));
  await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: process.pid, foreground_process_group_id: process.pid, foreground_processes: [{ pid: process.pid }] }));
  await writeFile(join(root, "capture.cjs"), `require('node:fs').writeFileSync(${JSON.stringify(observedFile)}, JSON.stringify({ args: process.argv.slice(2), env: process.env })); console.log('FIXTURE_PI_COMPLETE');`);
  await writeFile(join(root, ".zshrc"), `export XDG_CACHE_HOME='/shell/cache' npm_config_cache='/shell/npm' NPM_CONFIG_CACHE='/shell/NPM'
PS1='' PS2='' RPS1=''
pi() { ${quote(process.execPath)} ${quote(join(root, "capture.cjs"))} "$@"; }
printf '%s\\n' FIXTURE_SHELL_READY
`);
  let shell: ChildProcessWithoutNullStreams | null = null;
  let shellOutput = "", shellErrors = "", shellInput = "";
  let shellClosed: Promise<void> | null = null;
  async function waitLine(pattern: RegExp) {
    const current = shell; assert.ok(current);
    const match = () => shellOutput.split(/\r?\n/).find(line => pattern.test(line));
    const found = match(); if (found !== undefined) return found;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error(`Fixture shell output missing: ${pattern}; ${shellErrors}`)), 5000);
      const check = () => { const found = match(); if (found !== undefined) done(null, found); };
      const done = (error: Error | null, line = "") => { clearTimeout(timer); current.stdout.off("data", check); error ? reject(error) : resolve(line); };
      current.stdout.on("data", check);
    });
  }
  const server = createServer(), socket = join(root, "herdr.sock");
  await new Promise<void>(resolve => server.listen(socket, resolve));
  await writeFile(endpointFile, JSON.stringify(socket));
  await writeFile(join(bin, "herdr"), `#!${process.execPath}
const fs = require('node:fs'), a = process.argv.slice(2);
const result = a[0] === 'status' ? { running: true, version: '0.9.1', protocol: 22, compatible: true, endpoint_compatible: true, restart_needed: false, socket: JSON.parse(fs.readFileSync(${JSON.stringify(endpointFile)}, 'utf8')) }
  : a[0] === 'pane' && a[1] === 'get' ? { result: { pane: JSON.parse(fs.readFileSync(a[2] === 'owner-pane' ? ${JSON.stringify(ownerFile)} : ${JSON.stringify(paneFile)}, 'utf8')) } }
  : a[0] === 'pane' && a[1] === 'process-info' ? { result: { process_info: JSON.parse(fs.readFileSync(a[a.indexOf('--pane') + 1] === 'owner-pane' ? ${JSON.stringify(ownerProcesses)} : ${JSON.stringify(processFile)}, 'utf8')) } }
  : { args: a };
console.log(JSON.stringify(result));
`, { mode: 0o700 });
  Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, PI_CODING_AGENT_DIR: join(root, "profile 'quoted;$()"), HERDR_ENV: "1", HERDR_PANE_ID: owner.pane_id });
  const commands: string[] = [];
  let forwarded: Record<string, string> = {};
  let observations = 0;
  const nativeReadiness: string[] = [];
  const run: GuardedCommand = async command => {
    commands.push(command);
    if (command.startsWith("herdr pane process-info ")) {
      observations++;
      if (observations === 2) {
        if (fault === "post-observation-denied") return { kind: "finished", code: 1, output: "Ordinary observation permission denied" };
        if (fault === "post-observation-unknown") return { kind: "unknown", message: "Observation acknowledgment lost" };
        if (fault === "post-observation-empty" || fault === "post-observation-malformed") return { kind: "finished", code: 0, output: fault === "post-observation-empty" ? "" : "not-json" };
      }
      if (fault === "observation-denied") return { kind: "finished", code: 1, output: "Ordinary observation permission denied" };
      if (fault === "observation-unknown") return { kind: "unknown", message: "Observation permission/acknowledgment held" };
      if (fault === "observation-empty" || fault === "observation-malformed") return { kind: "finished", code: 0, output: fault === "observation-empty" ? "" : "not-json" };
      return { kind: "finished", code: 0, output: (await execute(command)).stdout };
    }
    const args = z.object({ args: z.array(z.string()) }).parse(JSON.parse((await execute(command)).stdout)).args;
    if (args[0] === "tab" && args[1] === "create") {
      forwarded = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== "--env") continue;
        const value = args[++i]; assert.ok(value);
        const equals = value.indexOf("=");
        forwarded[value.slice(0, equals)] = value.slice(equals + 1);
      }
      shell = spawn("/usr/bin/zsh", ["-d", "-i"], { env: { PATH: prior.PATH, ZDOTDIR: root, ...forwarded } });
      shell.stdout.on("data", data => { shellOutput += String(data); });
      shell.stderr.on("data", data => { shellErrors += String(data); });
      shellClosed = new Promise<void>((resolve, reject) => shell?.once("close", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error(`Fixture shell exit ${code}/${signal}: ${shellErrors}`))));
      await waitLine(/^FIXTURE_SHELL_READY$/);
      await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell.pid, foreground_process_group_id: shell.pid, foreground_processes: [{ pid: fault === "busy-before" ? process.pid : shell.pid }] }));
      if (fault === "helper-before") await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell.pid, foreground_process_group_id: shell.pid, foreground_processes: [{ pid: shell.pid }, { pid: process.pid }] }));
      if (fault === "wrong-workspace-before") await writeFile(paneFile, JSON.stringify({ ...pane, workspace_id: "foreign" }));
      if (fault === "wrong-tab-before") await writeFile(paneFile, JSON.stringify({ ...pane, tab_id: "foreign" }));
      if (fault === "wrong-terminal-before") await writeFile(paneFile, JSON.stringify({ ...pane, terminal_id: "foreign" }));
      return { kind: "finished", code: 0, output: JSON.stringify({ result: { root_pane: pane } }) };
    }
    if (args[0] === "pane" && args[1] === "run") {
      assert.equal(args[2], pane.pane_id);
      if (fault === "run-denied") return { kind: "finished", code: 1, output: "Ordinary permission denied" };
      assert.ok(shell); shellInput = args[3] ?? ""; shell.stdin.write(`${shellInput}\n`);
      if (fault === "run-unknown") return { kind: "unknown", message: "Native input acknowledgment lost" };
      return { kind: "finished", code: 0, output: "" };
    }
    if (args[0] === "pane" && args[1] === "wait-output") {
      assert.equal(args[2], pane.pane_id);
      const pattern = args[args.indexOf("--regex") + 1]; assert.ok(pattern);
      assert.match(pattern, /^\^LEGION_CACHE_READY=[a-f0-9-]+\$$/);
      assert.equal(shellInput.includes(pattern.slice(1, -1)), false, "Echoed input cannot contain the complete receipt");
      if (fault === "wait-denied") return { kind: "finished", code: 1, output: "Ordinary permission denied" };
      if (fault === "wait-unknown") return { kind: "unknown", message: "Native output acknowledgment lost" };
      const executed = await waitLine(new RegExp(pattern));
      if (fault === "wait-empty" || fault === "wait-malformed") return { kind: "finished", code: 0, output: fault === "wait-empty" ? "" : "not-json" };
      const matched_line = fault === "missing-receipt" ? null : fault === "echo-receipt" ? shellInput : fault === "stale-receipt" ? "LEGION_CACHE_READY=00000000-0000-4000-8000-000000000000" : executed;
      if (helperName) await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell?.pid, foreground_process_group_id: shell?.pid,
        foreground_processes: [{ pid: shell?.pid, name: "zsh" }, { pid: process.pid, name: helperName }] }));
      for (const [condition, key] of [["wrong-workspace-after", "workspace_id"], ["wrong-tab-after", "tab_id"], ["wrong-pane-after", "pane_id"], ["wrong-terminal-after", "terminal_id"]] satisfies [Fault, keyof typeof pane][])
        if (fault === condition) await writeFile(paneFile, JSON.stringify({ ...pane, [key]: "foreign" }));
      if (fault === "agent-after") await writeFile(paneFile, JSON.stringify({ ...pane, agent: "pi" }));
      if (fault === "session-after") await writeFile(paneFile, JSON.stringify({ ...pane, agent_session: { kind: "id", value: "foreign-session" } }));
      if (fault === "owner-session-after") await writeFile(ownerFile, JSON.stringify({ ...owner, agent_session: { kind: "id", value: "foreign-session" } }));
      if (fault === "owner-terminal-after") await writeFile(ownerFile, JSON.stringify({ ...owner, terminal_id: "foreign" }));
      if (fault === "owner-process-after") await writeFile(ownerProcesses, JSON.stringify({ foreground_processes: [{ pid: shell?.pid }] }));
      if (fault === "owner-missing-after") delete process.env.HERDR_PANE_ID;
      if (fault === "server-after" || fault === "endpoint-after") {
        await new Promise<void>(resolve => server.close(() => resolve()));
        const endpoint = fault === "endpoint-after" ? join(root, "other.sock") : socket;
        await new Promise<void>(resolve => server.listen(endpoint, resolve));
        await writeFile(endpointFile, JSON.stringify(endpoint));
      }
      if (fault === "group-changed-after" || fault === "group-missing-after" || fault === "duplicate-shell-after" || fault === "duplicate-helper-after" || fault === "empty-group-after" || fault === "invalid-pid-after")
        await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell?.pid,
          ...(fault === "group-missing-after" ? {} : { foreground_process_group_id: fault === "group-changed-after" ? process.pid : shell?.pid }),
          foreground_processes: fault === "empty-group-after" ? [] : fault === "duplicate-shell-after" ? [{ pid: shell?.pid }, { pid: shell?.pid }]
            : fault === "duplicate-helper-after" ? [{ pid: shell?.pid }, { pid: process.pid }, { pid: process.pid }]
            : [{ pid: shell?.pid }, { pid: fault === "invalid-pid-after" ? 0 : process.pid }] }));
      if (fault === "shell-changed-after") await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: process.pid, foreground_process_group_id: process.pid, foreground_processes: [{ pid: process.pid }] }));
      if (fault === "busy-after") await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell?.pid, foreground_process_group_id: shell?.pid, foreground_processes: [{ pid: process.pid }] }));
      return { kind: "finished", code: 0, output: JSON.stringify({ result: { type: "output_matched", pane_id: fault === "wrong-pane-receipt" ? "foreign" : pane.pane_id, matched_line } }) };
    }
    if (args[0] === "agent" && args[1] === "start") {
      assert.ok(shell);
      if (fault === "start-denied") return { kind: "finished", code: 1, output: "Native start failed" };
      if (fault === "start-unknown") return { kind: "unknown", message: "Start transport acknowledgment lost" };
      if (fault === "start-empty" || fault === "start-malformed") return { kind: "finished", code: 0, output: fault === "start-empty" ? "" : "not-json" };
      // Controlled native boundary only: an explicit busy/no-input response settles
      // inside this single start invocation, not via another Legion submission.
      if (helperName) {
        nativeReadiness.push("busy-no-input");
        await writeFile(processFile, JSON.stringify({ pane_id: pane.pane_id, shell_pid: shell.pid, foreground_process_group_id: shell.pid, foreground_processes: [{ pid: shell.pid }] }));
      }
      nativeReadiness.push("sole-input");
      shell.stdin.write(`pi ${args.slice(args.indexOf("--") + 1).map(quote).join(" ")}\n`);
      await waitLine(/^FIXTURE_PI_COMPLETE$/);
      return { kind: "finished", code: 0, output: JSON.stringify({ started: true }) };
    }
    throw new Error(`Unexpected guarded command: ${args.slice(0, 2).join(" ")}`);
  };
  const host = new LocalTribunusHost(run, authority);
  return { root, host, launch, startupSelection, commands, nativeReadiness, forwarded: () => forwarded,
    observed: async () => z.object({ args: z.array(z.string()), env: z.record(z.string(), z.string()) }).parse(JSON.parse(await readFile(observedFile, "utf8"))),
    create: () => host.createWindow({ launch, cwd: join(root, "cwd 'special;$(false)"), workflowChoice: { profile: "matt", requestedWorkflow: "implement-spec" }, startupSelection }),
    cleanup: async () => {
      if (shell) { shell.stdin.end("exit\n"); await shellClosed; }
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
      Object.assign(process.env, prior);
      await rm(root, { recursive: true, force: true });
    } };
}

test("new tab forwards only captured nonsecret profile/session/temp/subagents/cache paths with literal shell-safe values", async () => {
  const f = await fixture();
  try {
    const paths = {
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
      PI_CODING_AGENT_SESSION_DIR: `${f.root}/sessions ' ; $(false) \" * = !`,
      TMPDIR: `${f.root}/temp`, TMP: `${f.root}/temp`, TEMP: `${f.root}/temp`,
      PI_SUBAGENTS_TEMP_ROOT: `${f.root}/subagents`,
      XDG_CACHE_HOME: `${f.root}/cache ' ; $(false)`,
      npm_config_cache: `${f.root}/npm lower`, NPM_CONFIG_CACHE: `${f.root}/npm upper`,
    };
    Object.assign(process.env, paths, { OPENAI_API_KEY: "fixture-not-a-credential", UNRELATED_PATH: "/unrelated", PI_OFFLINE: "1" });
    const window = await f.create();
    const { LEGION_TRIBUNUS_BOOTSTRAP: bootstrap, ...forwarded } = f.forwarded();
    assert.deepEqual(forwarded, paths);
    assert.equal(bootstrap, join(process.env.PI_CODING_AGENT_DIR ?? "", "legion", "tribuni", f.launch.id, "bootstrap.json"));
    assert.equal(window.workspace, "fixture-workspace");
    assert.equal(window.pane, "worker-pane");
    assert.match(f.commands[0] ?? "", /--no-focus$/);
    const args = z.object({ args: z.array(z.string()) }).parse(JSON.parse((await execute(f.commands[0] ?? "")).stdout)).args;
    assert.equal(args[args.indexOf("--cwd") + 1], join(f.root, "cwd 'special;$(false)"));
  } finally { await f.cleanup(); }
});

test("successful empty-output cache submission restores captured routing after interactive zsh startup before the ordinary pi function and exact overrides", async () => {
  const f = await fixture();
  try {
    const caches = { XDG_CACHE_HOME: `${f.root}/cache ' ; $(false) \" * ! =`, npm_config_cache: `${f.root}/npm 'lower`, NPM_CONFIG_CACHE: `${f.root}/npm upper` };
    Object.assign(process.env, caches);
    const window = await f.create();
    Object.assign(process.env, { XDG_CACHE_HOME: "/later/ambient", npm_config_cache: "/later/npm", NPM_CONFIG_CACHE: "/later/NPM" });
    await f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection });
    assert.deepEqual(f.commands.map(command => command.split(" ").slice(0, 3).join(" ")), [
      "herdr tab create", "herdr pane process-info", "herdr pane run",
      "herdr pane wait-output", "herdr pane process-info", "herdr agent start"
    ]);
    const observed = await f.observed();
    assert.equal(observed.env.XDG_CACHE_HOME, caches.XDG_CACHE_HOME);
    assert.equal(observed.env.npm_config_cache, caches.npm_config_cache);
    assert.equal(observed.env.NPM_CONFIG_CACHE, caches.NPM_CONFIG_CACHE);
    assert.deepEqual(observed.args, ["-e", process.cwd(), "--model", "openai-codex/gpt-6.1-sol", "--thinking", "high"]);
    assert.match(f.commands.at(-1) ?? "", /^herdr agent start .* --kind pi --pane 'worker-pane' -- -e .* --model 'openai-codex\/gpt-6.1-sol' --thinking 'high'$/);
    assert.equal(f.commands.some(command => /--(?:approve|no-approve|no-tools|no-extensions|mode)(?:\s|$)|\bexec\b/.test(command)), false);
  } finally { await f.cleanup(); }
});

for (const helperName of ["starship", "arbitrary-prompt-helper"]) test(`same-shell post-marker ${helperName} overlap delegates readiness to one ordinary native start`, async () => {
  const f = await fixture({ helperName });
  try {
    process.env.XDG_CACHE_HOME = join(f.root, "cache");
    const window = await f.create();
    await f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection });
    const observed = await f.observed();
    assert.deepEqual(f.nativeReadiness, ["busy-no-input", "sole-input"]);
    assert.equal(observed.env.XDG_CACHE_HOME, join(f.root, "cache"));
    assert.deepEqual(observed.args, ["-e", process.cwd(), "--model", "openai-codex/gpt-6.1-sol", "--thinking", "high"]);
    assert.deepEqual(f.commands.map(command => command.split(" ").slice(0, 3).join(" ")), [
      "herdr tab create", "herdr pane process-info", "herdr pane run",
      "herdr pane wait-output", "herdr pane process-info", "herdr agent start"
    ]);
  } finally { await f.cleanup(); }
});

test("unset optional routes do not invent defaults, unset shell values or alter native startup selection", async () => {
  const f = await fixture({ startupSelection: { kind: "native-defaults" } });
  try {
    for (const key of ["PI_CODING_AGENT_SESSION_DIR", "TMPDIR", "TMP", "TEMP", "PI_SUBAGENTS_TEMP_ROOT", "XDG_CACHE_HOME", "npm_config_cache", "NPM_CONFIG_CACHE"]) delete process.env[key];
    const window = await f.create();
    assert.deepEqual(Object.keys(f.forwarded()).sort(), ["LEGION_TRIBUNUS_BOOTSTRAP", "PI_CODING_AGENT_DIR"]);
    await f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection });
    const observed = await f.observed();
    assert.equal(observed.env.XDG_CACHE_HOME, "/shell/cache");
    assert.equal(observed.env.npm_config_cache, "/shell/npm");
    assert.equal(observed.env.NPM_CONFIG_CACHE, "/shell/NPM");
    assert.deepEqual(observed.args, ["-e", process.cwd()]);
    assert.equal(f.commands.some(command => command.startsWith("herdr pane run ") || command.startsWith("herdr pane wait-output ")), false);
  } finally { await f.cleanup(); }
});

test("explicit empty cache route remains empty rather than using the shell or an invented default", async () => {
  const f = await fixture();
  try {
    process.env.XDG_CACHE_HOME = "";
    delete process.env.npm_config_cache; delete process.env.NPM_CONFIG_CACHE;
    const window = await f.create();
    assert.equal(f.forwarded().XDG_CACHE_HOME, "");
    await f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection });
    const observed = await f.observed();
    assert.equal(observed.env.XDG_CACHE_HOME, "");
    assert.equal(observed.env.npm_config_cache, "/shell/npm");
    assert.equal(observed.env.NPM_CONFIG_CACHE, "/shell/NPM");
  } finally { await f.cleanup(); }
});

const faults: Fault[] = ["observation-denied", "observation-unknown", "observation-empty", "observation-malformed", "run-denied", "run-unknown", "wait-denied", "wait-unknown", "wait-empty", "wait-malformed", "missing-receipt", "echo-receipt", "stale-receipt", "wrong-pane-receipt", "wrong-workspace-before", "wrong-tab-before", "wrong-terminal-before", "busy-before", "wrong-terminal-after", "shell-changed-after", "busy-after",
  "helper-before", "wrong-workspace-after", "wrong-tab-after", "wrong-pane-after", "group-changed-after", "group-missing-after", "duplicate-shell-after", "duplicate-helper-after", "empty-group-after", "invalid-pid-after",
  "agent-after", "session-after", "owner-session-after", "owner-process-after", "owner-terminal-after", "owner-missing-after", "server-after", "endpoint-after",
  "post-observation-denied", "post-observation-unknown", "post-observation-empty", "post-observation-malformed"];
for (const fault of faults) test(`cache setup ${fault} preserves the launch without Pi start, input resend or tab recreation`, async () => {
  const f = await fixture({ fault });
  try {
    process.env.XDG_CACHE_HOME = join(f.root, "cache");
    const window = await f.create();
    const start = f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection });
    if (fault.endsWith("-empty") || fault.endsWith("-malformed")) await assert.rejects(start, SyntaxError);
    else await assert.rejects(start);
    assert.equal(f.commands.filter(command => command.startsWith("herdr tab create ")).length, 1);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane run ")).length, fault.endsWith("-before") || fault.startsWith("observation-") ? 0 : 1);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane wait-output ")).length, fault.endsWith("-before") || fault.startsWith("observation-") || fault.startsWith("run-") ? 0 : 1);
    assert.equal(f.commands.some(command => command.startsWith("herdr agent start ")), false);
    await assert.rejects(f.observed(), { code: "ENOENT" });
  } finally { await f.cleanup(); }
});

for (const fault of ["start-denied", "start-unknown", "start-empty", "start-malformed"] satisfies Fault[]) test(`${fault} never resubmits native start or invents a successful effect receipt`, async () => {
  const f = await fixture({ fault, helperName: "arbitrary-prompt-helper" });
  try {
    process.env.XDG_CACHE_HOME = join(f.root, "cache");
    const window = await f.create();
    await assert.rejects(f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection }));
    assert.equal(f.commands.filter(command => command.startsWith("herdr agent start ")).length, 1);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane run ")).length, 1);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane process-info ")).length, 2);
    assert.deepEqual(f.nativeReadiness, [], "Failure is not reclassified as busy or successful native input");
    const bootstrap = f.forwarded().LEGION_TRIBUNUS_BOOTSTRAP; assert.ok(bootstrap);
    const outcomeSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("finished"), code: z.number(), output: z.string() }), z.object({ kind: z.literal("unknown"), message: z.string() })]);
    const root = dirname(bootstrap), outcomes = await Promise.all((await readdir(root)).filter(file => file.endsWith(".effect-outcome.json")).map(async file => outcomeSchema.parse(JSON.parse(await readFile(join(root, file), "utf8")))));
    assert.equal(outcomes.length, 6);
    assert.deepEqual(outcomes.filter(outcome => outcome.kind === "unknown"), fault === "start-unknown" ? [{ kind: "unknown", message: "Start transport acknowledgment lost" }] : []);
    assert.ok(outcomes.some(outcome => outcome.kind === "finished" && outcome.code === 0 && outcome.output === ""), "Original empty cache completion is retained");
    if (fault === "start-denied") assert.ok(outcomes.some(outcome => outcome.kind === "finished" && outcome.code === 1 && outcome.output === "Native start failed"));
    if (fault === "start-malformed") assert.ok(outcomes.some(outcome => outcome.kind === "finished" && outcome.code === 0 && outcome.output === "not-json"));
    if (fault === "start-empty") assert.equal(outcomes.filter(outcome => outcome.kind === "finished" && outcome.output === "").length, 2);
    await assert.rejects(f.observed(), { code: "ENOENT" });
  } finally { await f.cleanup(); }
});

for (const changed of ["pid", "start", "boot", "missing"]) test(`post-marker live owning Legatus validation refuses ${changed} process evidence`, async () => {
  const f = await fixture({ helperName: "arbitrary-prompt-helper" });
  try {
    process.env.XDG_CACHE_HOME = join(f.root, "cache");
    const window = await f.create(), bootstrap = f.forwarded().LEGION_TRIBUNUS_BOOTSTRAP; assert.ok(bootstrap);
    const descriptor = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(bootstrap, "utf8")));
    const owner = z.object({ pid: z.number(), start: z.string(), boot: z.string() }).passthrough().parse(descriptor.ownerProcess);
    descriptor.ownerProcess = changed === "missing" ? undefined : { ...owner, [changed]: changed === "pid" ? process.pid + 1 : changed === "start" ? "0" : "foreign-boot" };
    await writeFile(bootstrap, JSON.stringify(descriptor), { mode: 0o600 });
    await assert.rejects(f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection }), /Owning Legatus changed/);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane run ")).length, 1);
    assert.equal(f.commands.filter(command => command.startsWith("herdr pane wait-output ")).length, 1);
    assert.equal(f.commands.some(command => command.startsWith("herdr agent start ")), false);
  } finally { await f.cleanup(); }
});

test("cache paths with terminal control characters are refused before tab creation without exposing the value", async () => {
  for (const control of ["\t", "\n", "\r", "\x1b", "\x7f", "\x85", "\x9b"]) {
    const f = await fixture();
    try {
      const value = `${f.root}/private-cache${control}path`;
      process.env.XDG_CACHE_HOME = value;
      await assert.rejects(f.create(), error => {
        assert.match(String(error), /XDG_CACHE_HOME.*unsupported.*control/i);
        assert.equal(String(error).includes(value), false);
        return true;
      });
      assert.deepEqual(f.commands, []);
    } finally { await f.cleanup(); }
  }
});

test("retained descriptor cache controls are refused at the terminal-input boundary without any send", async () => {
  const f = await fixture();
  try {
    process.env.XDG_CACHE_HOME = join(f.root, "cache");
    const window = await f.create(), bootstrap = f.forwarded().LEGION_TRIBUNUS_BOOTSTRAP;
    assert.ok(bootstrap);
    const descriptor = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(bootstrap, "utf8")));
    descriptor.launchEnvironment = { XDG_CACHE_HOME: "fixture\x00unsupported\x1bpath" };
    await writeFile(bootstrap, JSON.stringify(descriptor), { mode: 0o600 });
    await assert.rejects(f.host.startPi({ launch: f.launch, window, startupSelection: f.startupSelection }), /XDG_CACHE_HOME.*unsupported.*control/i);
    assert.equal(f.commands.some(command => command.startsWith("herdr pane run ") || command.startsWith("herdr agent start ")), false);
  } finally { await f.cleanup(); }
});

test("missing cache execution acknowledgment retains command/state startup uncertainty and cannot replay launch effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "le-cache-"));
  const prior = { ...process.env };
  try {
    process.env.XDG_CACHE_HOME = join(root, "cache");
    const result = await exerciseNativeAssignment("launch-cache-unknown");
    const launch = result.view.tasks[0]?.launch;
    assert.ok(launch);
    assert.equal(launch.kind, "held");
    assert.equal(launch.startEvidence.kind, "uncertain");
  } finally {
    if (prior.XDG_CACHE_HOME === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prior.XDG_CACHE_HOME;
    await rm(root, { recursive: true, force: true });
    assert.deepEqual({ ...process.env }, prior);
  }
});
