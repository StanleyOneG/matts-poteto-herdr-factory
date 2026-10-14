import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { connect, createServer } from "node:net";
import { composedRuntime } from "./composed-transport.mjs";
import { installTribunus } from "../../src/tribunus-host.ts";

export async function handoffFixture({ successor = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "hB-"));
  const cwd = join(root, "work"), bin = join(root, "bin"), actor = join(root, "actor");
  for (const dir of [cwd, bin, actor]) fs.mkdirSync(dir);
  const prior = Object.fromEntries(["PATH", "HERDR_ENV", "HERDR_PANE_ID"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: "worker" });
  const socketPath = join(root, "herdr.sock"), herdr = createServer();
  await new Promise(resolve => herdr.listen(socketPath, resolve));
  const authority = { owner: randomUUID(), session: "original-controller", generation: 1, epoch: 0 };
  const panePath = join(root, "panes.json");
  const pane = id => ({ workspace_id: "workspace", tab_id: id, pane_id: id, terminal_id: id, foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: id === "owner" ? authority.session : "worker-session" } });
  fs.writeFileSync(panePath, JSON.stringify({ owner: pane("owner"), worker: pane("worker") }));
  fs.writeFileSync(join(bin, "herdr"), `#!/usr/bin/env node\nconst fs=require('node:fs'),a=process.argv.slice(2);if(a[0]==='--version')console.log('0.9.1');else if(a[0]==='status')console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socketPath)}}));else if(a[1]==='get')console.log(JSON.stringify({result:{pane:JSON.parse(fs.readFileSync(${JSON.stringify(panePath)}))[a[2]]}}));else console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));\n`, { mode: 0o700 });
  const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  const socketStat = fs.lstatSync(socketPath);
  const window = id => ({ endpoint: socketPath, server: `${socketStat.dev}:${socketStat.ino}:${socketStat.ctimeMs}`, workspace: "workspace", tab: id, pane: id, terminal: id });
  const workflowChoice = { profile: "matt", requestedWorkflow: "implement-spec" };
  const modelPin = { model: "controlled/selected", thinking: "high", profile: "matt" };
  const launch = { id: randomUUID(), reservation: randomUUID(), revision: 0, scope: "handoff trial", state: { kind: "prepared" } };
  if (successor) {
    const artifact = join(root, "upstream.md"); fs.writeFileSync(artifact, "Read first continuation");
    launch.successor = { handoff: randomUUID(), predecessor: randomUUID(), assignment: randomUUID(), artifact: { path: artifact, tempRoot: root, evidence: "predecessor-native-write" }, modelPin, workflowChoice, continuation: "Finish the retained task" };
  }
  const descriptor = { launch, cwd, capability: "exact-handoff-capability", authority, workflowChoice, ...(successor ? { startupSelection: { kind: "exact", selection: { model: modelPin.model, thinking: modelPin.thinking } } } : {}), ownerProcess: { pid: process.pid, boot, start, window: window("owner") } };
  const bootstrap = join(actor, "bootstrap.json");
  fs.writeFileSync(bootstrap, JSON.stringify(descriptor), { mode: 0o600 });
  const runtime = composedRuntime(cwd, "worker-session", join(root, "native.jsonl"));
  runtime.resources(runtime.pi.getCommands().map(command => command.name === "skill:handoff" ? { ...command, sourceInfo: { path: new URL("../../.agents/skills/handoff/SKILL.md", import.meta.url).pathname } } : command));
  const sends = [];
  runtime.pi.sendUserMessage = (prompt, options) => { runtime.prompts.push(prompt); sends.push({ prompt, options }); };
  installTribunus(runtime.pi, bootstrap);
  await runtime.emit("session_start");
  const hello = JSON.parse(fs.readFileSync(join(actor, "hello.json"), "utf8"));
  const address = hello.address;
  async function control(frame) {
    return await new Promise((resolve, reject) => {
      const socket = connect(hello.endpoint); let buffer = "";
      socket.once("connect", () => socket.write(JSON.stringify({ capability: descriptor.capability, authority, reservation: launch.reservation, scope: launch.scope, address, assignment: null, ...frame }) + "\n"));
      socket.on("data", chunk => { buffer += chunk; if (buffer.includes("\n")) { resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n")))); socket.destroy(); } });
      socket.once("error", reject); socket.once("close", () => reject(new Error("No complete addressed receipt")));
    });
  }
  async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error("Fixture observation incomplete"); }
  const close = async () => { await runtime.emit("session_shutdown"); await new Promise(resolve => herdr.close(resolve)); for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value; };
  try {
  const initialization = randomUUID();
  const init = control({ kind: "initialize", command: initialization }).then(reply => { if (reply.kind !== "ok") throw new Error(reply.message); return reply; });
  await until(() => sends.length === 1); await runtime.start(sends[0].prompt); await runtime.settle();
  assert.equal((await init).kind, "ok");
  const command = randomUUID();
  const assignment = { ...(launch.successor ? { handoff: launch.successor } : {}), workflowChoice, modelPin, task: { id: randomUUID(), revision: 1 }, scope: launch.scope, goal: "Preserve dirty work", acceptance: ["Preserve"], workflow: "implement-spec", authority: "bounded-implementation-only" };
  const assigned = control({ kind: "assign", command, assignment });
  await until(() => sends.length === 2); await runtime.start(sends[1].prompt); assert.equal((await assigned).kind, "ok");
  const request = { id: randomUUID(), pin: { ...authority, task: assignment.task, scope: launch.scope, reservation: launch.reservation, assignment: command, launch: launch.id, workerSession: address.session, workerGeneration: address.generation, addressDigest: createHash("sha256").update(JSON.stringify(address)).digest("hex") }, stop: randomUUID(), command: randomUUID(), purpose: "Transfer the dirty task", continuation: "Finish the focused verification", modelPin, workflowChoice };
  const stage = (kind = "handoff", changes = {}) => control({ assignment: undefined, kind, command: request.command, request, ...changes });
  return { root, cwd, actor, runtime, sends, request, address, authority, command, assignment, control, stage, until, panePath,
    denyArtifact: () => runtime.pi.on("tool_call", event => event.toolName === "write" ? { block: true, reason: "Controlled ordinary native permission refusal" } : undefined), close };
  } catch (error) { await close(); throw error; }
}
