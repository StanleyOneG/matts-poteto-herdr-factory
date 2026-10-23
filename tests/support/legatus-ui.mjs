import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { localHerdrIdentity } from "../../src/tribunus-host.ts";
import { installTribunus } from "../../src/tribunus-host.ts";
import { composedRuntime } from "./composed-transport.mjs";
import extension from "../../src/extension.ts";

// Controlled root Pi/UI adapter, real public extension and storage; no SDK session or real Herdr actors.
export async function legatusUiFixture({ parent = "main", nested = false, linked = false, cleanup = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "u-"));
  const profile = join(root, "a"), repo = join(root, "repo"), bin = join(root, "bin");
  for (const path of [profile, repo, bin]) fs.mkdirSync(path);
  execFileSync("git", ["init", "-q", "-b", linked ? "primary-control" : parent, repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=UI trial", "-c", "user.email=ui@example.invalid", "commit", "--allow-empty", "-qm", "base"]);
  const owning = linked ? join(root, "owning") : repo;
  if (linked) execFileSync("git", ["-C", repo, "worktree", "add", "-qb", parent, owning]);
  const cwd = nested ? join(owning, "nested") : owning;
  if (nested) fs.mkdirSync(cwd);
  assert.ok(Buffer.byteLength(join(profile, "legion", "tribuni", `s-${"a".repeat(32)}.sock`)) < 108);
  const herdr = createServer(), socket = join(root, "h.sock");
  await new Promise(resolve => herdr.listen(socket, resolve));
  const owner = { workspace_id: "workspace", tab_id: "owner", pane_id: "owner", terminal_id: "owner", foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: "root-legatus" } };
  const closedPath = join(root, "closed.json");
  const panePath = join(root, "pane.json"), bootstrapPath = join(root, "created.json");
  fs.writeFileSync(panePath, JSON.stringify(owner));
  fs.writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nconst fs=require('node:fs'),a=process.argv.slice(2);let pane=JSON.parse(fs.readFileSync(${JSON.stringify(panePath)}));if(a[0]==='tab'&&a[1]==='close'){fs.writeFileSync(${JSON.stringify(closedPath)},JSON.stringify({tab:a[2]}));console.log(JSON.stringify({result:{type:'ok'}}));}else if(a[0]==='--version')console.log('0.9.1');else if(a[0]==='status')console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));else if(a[0]==='tab'||a[0]==='workspace'){delete pane.agent;delete pane.agent_session;pane.tab_id='worker';pane.pane_id='worker';pane.terminal_id='worker';pane.foreground_cwd=a[a.indexOf('--cwd')+1];fs.writeFileSync(${JSON.stringify(panePath)},JSON.stringify(pane));fs.writeFileSync(${JSON.stringify(bootstrapPath)},JSON.stringify(a[a.indexOf('--env')+1].split('=').slice(1).join('=')));console.log(JSON.stringify({result:{root_pane:pane}}));}else if(a[0]==='pane'&&a[1]==='run'){
  if(a[2]!==pane.pane_id||pane.agent)throw new Error('Cache input requires the exact available worker shell');
  const output=require('node:child_process').execFileSync('/bin/bash',['-c',a[3]],{encoding:'utf8'});
  fs.writeFileSync(${JSON.stringify(join(root, "cache-setup.json"))},JSON.stringify({pane:pane.pane_id,terminal:pane.terminal_id,shell:${process.pid},output}));
  console.log(JSON.stringify({result:{type:'ok'}}));
}else if(a[0]==='pane'&&a[1]==='wait-output'){
  const receipt=JSON.parse(fs.readFileSync(${JSON.stringify(join(root, "cache-setup.json"))},'utf8'));
  if(a[2]!==pane.pane_id||receipt.pane!==pane.pane_id||receipt.terminal!==pane.terminal_id||receipt.shell!==${process.pid})throw new Error('Cache receipt identity changed');
  const pattern=new RegExp(a[a.indexOf('--regex')+1]),matched_line=receipt.output.trimEnd().split(String.fromCharCode(10)).find(line=>pattern.test(line));
  if(!matched_line)throw new Error('Cache setup did not execute the requested receipt');
  console.log(JSON.stringify({result:{type:'output_matched',pane_id:pane.pane_id,matched_line}}));
}else if(a[1]==='get')console.log(JSON.stringify({result:{pane:a[2]==='owner'?${JSON.stringify(owner)}:pane}}));else console.log(JSON.stringify({result:{process_info:{pane_id:pane.pane_id,shell_pid:${process.pid},foreground_process_group_id:${process.pid},foreground_processes:[{pid:${process.pid}}]}}}));\n`, { mode: 0o700 });
  const keys = ["PATH", "PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "LEGION_TRIBUNUS_BOOTSTRAP", "HERDR_ENV", "HERDR_PANE_ID"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PATH: `${bin}:${prior.PATH}`, PI_CODING_AGENT_DIR: profile, HERDR_ENV: "1", HERDR_PANE_ID: "owner" });
  delete process.env.PI_SUBAGENT_CHILD; delete process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  const runtime = composedRuntime(cwd, "root-legatus", join(root, "root.jsonl"));
  // Resume's read-only Git observations use the public Pi exec boundary, not native tool admission.
  runtime.pi.exec = async (command, args) => {
    try { return { code: 0, stdout: execFileSync(command, args, { encoding: "utf8" }), stderr: "" }; }
    catch (error) { return { code: error.status ?? 1, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") }; }
  };
  let worker = null, workerFailure = null, workerRoot = null;
  runtime.external(async (name, { command }) => {
    if (name !== "bash" || !command.startsWith("herdr agent start ")) return undefined;
    const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
    const descriptor = JSON.parse(fs.readFileSync(bootstrap, "utf8"));
    workerRoot = dirname(bootstrap);
    worker = composedRuntime(descriptor.cwd, "worker-session", join(root, "worker.jsonl"));
    worker.pi.sendUserMessage = prompt => {
      worker.prompts.push(prompt);
      if (prompt.startsWith("Legion native initialization ")) {
        void worker.start(prompt).then(() => worker.settle()).catch(error => { workerFailure = error; });
      } else if (prompt.startsWith("Legion bounded assignment ")) {
        void worker.start(prompt).catch(error => { workerFailure = error; });
      }
    };
    installTribunus(worker.pi, bootstrap);
    process.env.HERDR_PANE_ID = "worker";
    try { await worker.emit("session_start"); } finally { process.env.HERDR_PANE_ID = "owner"; }
    const pane = JSON.parse(fs.readFileSync(panePath, "utf8"));
    fs.writeFileSync(panePath, JSON.stringify({ ...pane, agent: "pi", agent_session: { kind: "id", value: "worker-session" } }));
    return { result: { structuredContent: { output: JSON.stringify({ started: true }), exit_code: 0, truncated: false }, content: [{ type: "text", text: "Worker started in controlled adapter" }] } };
  });
  let systemPrompt = "";
  const on = runtime.pi.on;
  runtime.pi.on = (name, handler) => on(name, async (event, ctx) => {
    const result = await handler(event, ctx);
    if (name === "before_agent_start" && result?.systemPrompt) systemPrompt = result.systemPrompt;
    return result;
  });
  const tools = new Map(), commands = new Map();
  const registerTool = runtime.pi.registerTool, registerCommand = runtime.pi.registerCommand;
  runtime.pi.registerTool = tool => { tools.set(tool.name, tool); registerTool(tool); };
  runtime.pi.registerCommand = (name, command) => { commands.set(name, command); registerCommand(name, command); };
  const forbiddenUi = [];
  for (const name of ["confirm", "select", "custom", "setEditorComponent", "setFooter", "setWidget", "setEditorText", "setTitle"]) runtime.ctx.ui[name] = () => { forbiddenUi.push(name); throw new Error(`Forbidden UI replacement/modal/focus: ${name}`); };
  const cleanupNative = cleanup ? {
    identity: localHerdrIdentity,
    snapshot: async () => {
      if (cleanup.snapshotUnavailable && fs.existsSync(closedPath)) throw new Error("Controlled lost acknowledgment/postcondition after saved successful native receipt");
      const pane = JSON.parse(fs.readFileSync(panePath, "utf8"));
      return { result: { snapshot: { version: "0.9.1", protocol: 22,
        tabs: fs.existsSync(closedPath) ? [] : [{ workspace_id: pane.workspace_id, tab_id: pane.tab_id, pane_count: 1 }],
        panes: fs.existsSync(closedPath) ? [] : [{ ...pane, agent_status: cleanup.activity ?? "done" }],
      } } };
    },
    processes: async ({ pane }) => ({ result: { process_info: { pane_id: pane, shell_pid: 10000001, foreground_processes: [{ pid: process.pid }] } } }),
    occupants: async ({ worker }) => { const shell = { ...worker, pid: 10000001, start: "1" }; return { shell, processes: [shell, worker] }; },
    close: async () => { throw new Error("Controlled native close must execute the actual authorized Bash CLI, not raw native.close."); },
  } : undefined;
  extension(runtime.pi, cleanup ? { tabs: cleanupNative, ...(cleanup.usage ? { usage: cleanup.usage } : {}) } : {});
  await runtime.emit("session_start");
  const state = async () => {
    await runtime.command("status --details");
    const text = runtime.notices.at(-1);
    const start = text?.indexOf("State\n");
    assert.ok(start >= 0, `Detailed status must expose observable state: ${text}`);
    return JSON.parse(text.slice(start + "State\n".length));
  };
  const startPending = async () => {
    for (let i = 0; i < 200 && !runtime.prompts.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(runtime.prompts.length, "Expected explicit saved-input interpretation");
    assert.equal(await runtime.start(runtime.prompts.shift()), true);
  };
  const close = async () => {
    await runtime.emit("session_shutdown");
    if (worker) await worker.emit("session_shutdown");
    await new Promise(resolve => herdr.close(resolve));
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.writeFileSync(join(root, "ui-evidence.json"), JSON.stringify({ notices: runtime.notices, statuses: runtime.statuses, forbiddenUi, sent: runtime.sent }, null, 2));
    assert.deepEqual(forbiddenUi, [], "Legion must preserve editor/footer/widgets and never force modals or focus changes");
  };
  const launch = async target => {
    const reserved = await runtime.call("legion_request", { command: `reserve ${target.id}@${target.revision} --parent refs/heads/${parent}` });
    assert.equal(reserved.details?.kind, "deferred", JSON.stringify(reserved));
    const stage = await runtime.call("legion_request", { command: `workspace ${reserved.details.receipt.requestKey}` });
    assert.equal(stage.details?.kind, "workspace-stage", JSON.stringify(stage));
    assert.equal((await runtime.call("legion_workspace", { requestId: stage.details.requestId })).isError, false);
    const launched = await runtime.call("legion_request", { command: `launch ${target.id}@${target.revision}` });
    assert.equal(launched.details?.kind, "launch-stage", JSON.stringify(launched));
    const result = await runtime.call("legion_launch", { requestId: launched.details.requestId });
    if (workerFailure) throw workerFailure;
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(worker);
    // Leave the assigned turn active; safe correction delivery must wait for actual controlled settlement.
    const assignment = worker.prompts.at(-1);
    assert.ok(assignment?.startsWith("Legion bounded assignment"), assignment);
    assert.equal(worker.ctx.isIdle(), false);
    return worker;
  };
  const loseReceiptEvidence = id => {
    assert.ok(workerRoot);
    const hello = JSON.parse(fs.readFileSync(join(workerRoot, "hello.json"), "utf8"));
    const path = join(workerRoot, hello.address.generation, `${id}.correction-receipt.json`);
    assert.ok(fs.existsSync(path), "Fault injection requires genuine production receipt publication first");
    const bytes = fs.readFileSync(path); fs.writeFileSync(join(root, "lost-receipt-evidence.json"), bytes);
    fs.unlinkSync(path);
  };
  return { root, runtime, tools, commands, closedPath, panePath, state, startPending, launch, loseReceiptEvidence, systemPrompt: () => systemPrompt, call: (name, input) => runtime.call(name, input), close };
}
