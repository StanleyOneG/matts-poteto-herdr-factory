import { Centuriones, CenturioRequest, type CenturioIntent } from "./centuriones.js";
import { privateFile, publish } from "./private-evidence.js";
import { approvedSeam, engineeringResult } from "./engineering.js";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:net";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import { mkdirSync, openSync, readFileSync, closeSync, fsyncSync, existsSync, lstatSync, realpathSync, readdirSync, watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createBashToolDefinition, createWriteToolDefinition, createEditToolDefinition, getAgentDir, stripFrontmatter, type ToolDefinition, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { EngineeringProposal, EngineeringRecord, EngineeringDeliveryReceipt, EffectIntent, EffectMessage, EffectReply, EffectRecord, EffectOutcome, CenturioOwnerCheck } from "./snapshot.js";
import { preflight } from "./preflight.js";
import { discoverContract, EngineeringContract } from "./engineering-contract.js";
import { CenturioObservation, ContractObservation, EngineeringPublication, EngineeringObservation, EngineeringRequest, BoundedAssignment, Initialization, LaunchRecord, VerifiedWorker, WindowIdentity, WorkerAddress, WorkerReport, type TribunusHost } from "./tribunus.js";
import type { GuardedCommand } from "./git-workspace.js";
import { prepareCenturioWorkspace, CenturioAllocationHeld } from "./centurio-workspace.js";
const exec = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const Authority = z.object({
  owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative()
});
const Descriptor = z.object({
  launch: LaunchRecord, cwd: z.string(), capability: z.string(), authority: Authority
});
const Hello = z.object({
  address: WorkerAddress, endpoint: z.string(), journal: z.string(), pid: z.int().positive()
});
const Frame = z.object({
  capability: z.string(), authority: Authority, reservation: z.uuid(), scope: z.string(), address: WorkerAddress, command: z.uuid(), kind: z.enum(["inspect", "initialize", "assign", "engineering"]), assignment: BoundedAssignment.nullable(), engineering: EngineeringRecord.nullable().default(null)
}).strict();
const Envelope = z.discriminatedUnion("kind", [z.object({
    kind: z.literal("ok"), value: z.unknown()
  }), z.object({
    kind: z.literal("held"), message: z.string()
  })]);
async function localIdentity() {
  if (process.env.HERDR_ENV !== "1")
    throw new Error("Launch requires the current local Herdr environment.");
  const status = z.object({
    running: z.literal(true), version: z.literal("0.9.1"), protocol: z.literal(22), compatible: z.literal(true), endpoint_compatible: z.literal(true), restart_needed: z.literal(false), socket: z.string()
  }).parse(JSON.parse((await exec("herdr", ["status", "server", "--json"])).stdout));
  const endpoint = realpathSync(status.socket), stat = lstatSync(endpoint);
  if (!stat.isSocket() || stat.uid !== process.getuid?.())
    throw new Error("Local Herdr socket identity is unavailable.");
  return {
    endpoint, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}`
  };
}
const Pane = z.object({
  workspace_id: z.string(), tab_id: z.string(), pane_id: z.string(), terminal_id: z.string(), foreground_cwd: z.string().optional(), agent: z.string().optional(), agent_session: z.object({
    kind: z.enum(["id", "path"]), value: z.string()
  }).optional()
});
async function paneAt(pane: string) {
  return z.object({
    result: z.object({
      pane: Pane
    })
  }).parse(JSON.parse((await exec("herdr", ["pane", "get", pane])).stdout)).result.pane;
}
export class LocalTribunusHost implements TribunusHost {
  private root = join(getAgentDir(), "legion", "tribuni");
  constructor(private run: GuardedCommand, private authority: z.infer<typeof Authority>, private notify: (message: string) => void = () => { }) { }
  private descriptor(launch: string) { return join(this.root, launch, "bootstrap.json"); }
  private async effect(command: string, launch: string) {
    const evidence = randomUUID();
    const root = join(this.root, launch);
    publish(join(root, `${evidence}.effect-intent.json`), {
      command, evidence
    });
    let result: Awaited<ReturnType<GuardedCommand>>;
    try {
      result = await this.run(command);
    }
    catch (error) {
      result = {
        kind: "unknown", message: String(error)
      };
    }
    publish(join(root, `${evidence}.effect-outcome.json`), result);
    if (result.kind !== "finished" || result.code !== 0)
      throw new Error(`Guarded local effect has no successful completion. Preserve effect evidence ${evidence} for launch ${launch}. No fallback.`);
    return JSON.parse(result.output);
  }
  async createWindow({ launch, cwd }: Parameters<TribunusHost["createWindow"]>[0]) {
    const local = await localIdentity();
    const callerId = process.env.HERDR_PANE_ID;
    if (!callerId) throw new Error("The owning Legatus has no Herdr caller identity. No tab created.");
    const caller = await paneAt(callerId);
    const session = caller.agent_session?.kind === "id" ? caller.agent_session.value
      : caller.agent_session?.kind === "path" ? z.object({ type: z.literal("session"), id: z.string() }).parse(JSON.parse(readFileSync(caller.agent_session.value, "utf8").split("\n")[0] ?? "")).id : null;
    const processInfo = z.object({ result: z.object({ process_info: z.object({ foreground_processes: z.array(z.object({ pid: z.int() })) }) }) })
      .parse(JSON.parse((await exec("herdr", ["pane", "process-info", "--pane", callerId])).stdout));
    if (caller.agent !== "pi" || session !== this.authority.session || !processInfo.result.process_info.foreground_processes.some(p => p.pid === process.pid))
      throw new Error("Herdr caller does not verify this owning Legatus session/process. No tab created.");
    mkdirSync(join(this.root, launch.id), {
      recursive: true, mode: 0o700
    });
    const path = this.descriptor(launch.id);
    publish(path, Descriptor.parse({
      launch, cwd, capability: randomBytes(32).toString("hex"), authority: this.authority
    }));
    const created = z.object({
      result: z.object({
        root_pane: Pane
      })
    }).parse(await this.effect(`herdr tab create --workspace ${quote(caller.workspace_id)} --cwd ${quote(cwd)} --label ${quote(`Legion ${launch.id}`)} --env ${quote(`LEGION_TRIBUNUS_BOOTSTRAP=${path}`)} --no-focus`, launch.id)).result.root_pane;
    if (created.workspace_id !== caller.workspace_id || created.tab_id === caller.tab_id || created.pane_id === caller.pane_id)
      throw new Error("Created Herdr tab does not match the owning-workspace placement. Preserve the launch; no alternate layout.");
    return WindowIdentity.parse({
      ...local, workspace: created.workspace_id, tab: created.tab_id, pane: created.pane_id, terminal: created.terminal_id
    });
  }
  async startPi({ launch, window }: Parameters<TribunusHost["startPi"]>[0]) {
    const local = await localIdentity();
    if (local.endpoint !== window.endpoint || local.server !== window.server)
      throw new Error("Local Herdr endpoint/server changed. No start.");
    const pane = await paneAt(window.pane);
    if (pane.terminal_id !== window.terminal || pane.agent)
      throw new Error("Owned terminal is not an available shell. No alternate launch path.");
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    await this.effect(`herdr agent start ${quote(`lg-${launch.id.replaceAll("-", "").slice(0, 24)}`)} --kind pi --pane ${quote(window.pane)} -- -e ${quote(packageRoot)}`, launch.id);
  }
  private async hello(launch: string) { return Hello.parse(privateFile(join(this.root, launch, "hello.json"))); }
  private async control(hello: z.infer<typeof Hello>, kind: z.infer<typeof Frame>["kind"], command: string, assignment: z.infer<typeof BoundedAssignment> | null, engineering: z.infer<typeof EngineeringRecord> | null = null) {
    const descriptor = Descriptor.parse(privateFile(this.descriptor(hello.address.launch)));
    const frame = {
      authority: this.authority, reservation: descriptor.launch.reservation, scope: descriptor.launch.scope, address: hello.address, command, kind, assignment, ...(engineering ? { engineering } : {})
    };
    const path = join(this.root, hello.address.launch, `${command}.${this.authority.generation}.${this.authority.epoch}.request.json`);
    publish(path, frame);
    const client = fileURLToPath(new URL("./tribunus-client.mjs", import.meta.url));
    const response = Envelope.parse(await this.effect(`node ${quote(client)} ${quote(this.descriptor(hello.address.launch))} ${quote(hello.endpoint)} ${quote(path)}`, hello.address.launch));
    if (response.kind === "held")
      throw new Error(response.message);
    return response.value;
  }
  async inspectWorker({ launch, window, cwd }: Parameters<TribunusHost["inspectWorker"]>[0]) {
    if (!existsSync(join(this.root, launch.id, "hello.json")))
      return null;
    const hello = await this.hello(launch.id), pane = await paneAt(window.pane), local = await localIdentity();
    if (JSON.stringify(hello.address.window) !== JSON.stringify(window) || local.endpoint !== window.endpoint || local.server !== window.server || pane.terminal_id !== window.terminal || pane.foreground_cwd !== cwd || pane.agent !== "pi" || !pane.agent_session)
      throw new Error("Exact local Herdr terminal, cwd, and Pi session evidence disagree.");
    if (pane.agent_session.kind === "id" ? pane.agent_session.value !== hello.address.session : pane.agent_session.value !== hello.journal)
      throw new Error("Herdr does not identify the addressed Pi session. No journal guessing.");
    return VerifiedWorker.parse(await this.control(hello, "inspect", randomUUID(), null));
  }
  async initialize({ worker, command }: Parameters<TribunusHost["initialize"]>[0]) {
    const hello = await this.hello(worker.address.launch);
    if (JSON.stringify(hello.address) !== JSON.stringify(worker.address))
      throw new Error("Worker generation changed.");
    const value = await this.control(hello, "initialize", command, null);
    return value === null ? null : Initialization.parse(value);
  }
  watchReports({ worker, command }: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
  }, onReport: (report: z.infer<typeof WorkerReport>) => Promise<void>, onUnavailable: (message: string) => Promise<void>, onContract?: (observation: z.infer<typeof ContractObservation>) => Promise<void>, onChildren?: (observation: z.infer<typeof CenturioObservation>) => Promise<void>) {
    const root = join(this.root, worker.address.launch, worker.address.generation);
    const path = join(root, `${command}.report.json`);
    let watching: ReturnType<typeof watch> | null = null;
    let sequence = 0, childSequence = 0, reported = false;
    let collecting = Promise.resolve();
    const collect = async () => {
      const children = readdirSync(root).filter(file => file.startsWith(`${command}.`) && file.endsWith(".centuriones.json"))
        .map(file => CenturioObservation.parse(privateFile(join(root, file)))).sort((a, b) => a.sequence - b.sequence);
      for (const observation of children) {
        if (observation.command !== command || !isDeepStrictEqual(observation.address, worker.address)) throw new Error("Child observation does not address this assignment.");
        if (observation.sequence <= childSequence) continue;
        await onChildren?.(observation);
        childSequence = observation.sequence;
      }
      if (reported) return;
      const observations = readdirSync(root).filter(file => file.startsWith(`${command}.`) && file.endsWith(".contract.json"))
        .map(file => ContractObservation.parse(privateFile(join(root, file)))).sort((a, b) => a.sequence - b.sequence);
      for (const observation of observations) {
        if (observation.command !== command || JSON.stringify(observation.address) !== JSON.stringify(worker.address))
          throw new Error("Contract evidence does not address the applied assignment.");
        if (observation.sequence <= sequence) continue;
        await onContract?.(observation);
        sequence = observation.sequence;
      }
      if (!existsSync(path)) return;
      const report = WorkerReport.parse(privateFile(path));
      if (report.command !== command || JSON.stringify(report.address) !== JSON.stringify(worker.address))
        throw new Error("Worker report does not address the applied assignment.");
      await onReport(report);
      reported = true;
    };
    const enqueue = () => {
      collecting = collecting.then(collect).catch(error => {
        watching?.close();
        return onUnavailable(String(error)).catch(publication => this.notify(`Worker report evidence/publication unavailable. Preserve the receipt and assignment. ${String(publication)}`));
      });
    };
    watching = watch(root, enqueue);
    watching.unref();
    enqueue();
  }
  watchEffects({ worker, command }: Parameters<NonNullable<TribunusHost["watchEffects"]>>[0], onMessage: Parameters<NonNullable<TribunusHost["watchEffects"]>>[1], onUnavailable: (message: string) => void) {
    const root = join(this.root, worker.address.launch, worker.address.generation);
    const descriptor = Descriptor.parse(privateFile(this.descriptor(worker.address.launch)));
    const seen = new Set<string>();
    let collecting = Promise.resolve();
    const enqueue = () => {
      collecting = collecting.then(async () => {
        const files = readdirSync(root).filter(file => file.startsWith(`${command}.`) && (file.endsWith(".effect-request.json") || file.endsWith(".effect-observation.json"))).sort((a, b) => Number(a.endsWith(".effect-observation.json")) - Number(b.endsWith(".effect-observation.json")));
        for (const file of files) {
          if (seen.has(file)) continue;
          const envelope = z.strictObject({ capability: z.string(), address: WorkerAddress, assignment: z.string(), message: EffectMessage }).parse(privateFile(join(root, file)));
          const received = Buffer.from(envelope.capability), expected = Buffer.from(descriptor.capability);
          if (received.length !== expected.length || !timingSafeEqual(received, expected) || !isDeepStrictEqual(envelope.address, worker.address) || envelope.assignment !== command)
            throw new Error("Effect publication does not authenticate the addressed assignment.");
          const message = envelope.message;
          if (message.kind === "centurio-owner-check" && (message.pin.assignment !== command || message.pin.addressDigest !== createHash("sha256").update(JSON.stringify(worker.address)).digest("hex"))) throw new Error("Child owner check does not bind the authenticated principal.");
          if (message.kind === "effect-admission" && (message.intent.pin.assignment !== command || message.intent.pin.addressDigest !== createHash("sha256").update(JSON.stringify(worker.address)).digest("hex")))
            throw new Error("Effect intent does not bind the authenticated principal.");
          if (message.kind === "effect-observation") {
            const admitted = EffectReply.parse(privateFile(join(root, `${command}.${message.id}.effect-response.json`)));
            if (admitted.kind !== "effect" || admitted.effect.digest !== message.digest) throw new Error("Effect observation has no authenticated admission response.");
          }
          const reply = await onMessage(message);
          if (message.kind === "centurio-owner-check") publish(join(root, `${command}.${message.id}.effect-response.json`), reply);
          else if (message.kind === "effect-admission") publish(join(root, `${command}.${message.intent.id}.effect-response.json`), reply);
          else if (reply.kind !== "effect") { onUnavailable(JSON.stringify(reply)); continue; }
          seen.add(file);
        }
      }).catch(error => onUnavailable(`Effect transport is held. Preserve the same identities. ${String(error)}`));
    };
    const watcher = watch(root, enqueue);
    watcher.unref();
    enqueue();
  }
  async deliverEngineering({ worker, record }: Parameters<NonNullable<TribunusHost["deliverEngineering"]>>[0]) {
    const hello = await this.hello(worker.address.launch);
    if (JSON.stringify(hello.address) !== JSON.stringify(worker.address) || record.state.kind !== "decided")
      throw new Error("Decision does not address the verified worker.");
    return EngineeringDeliveryReceipt.parse(await this.control(hello, "engineering", record.state.delivery.command, null, {
      ...record, state: { ...record.state, delivery: { kind: "pending", command: record.state.delivery.command } }
    }));
  }
  watchEngineering({ worker, command }: Parameters<NonNullable<TribunusHost["watchEngineering"]>>[0], onRequest: Parameters<NonNullable<TribunusHost["watchEngineering"]>>[1], onUnavailable: (message: string) => Promise<void>) {
    const root = join(this.root, worker.address.launch, worker.address.generation);
    const seen = new Set<string>();
    let collecting = Promise.resolve();
    const collect = () => {
      collecting = collecting.then(async () => {
        for (const file of readdirSync(root).filter(file => file.startsWith(`${command}.`) && (file.endsWith(".engineering.json") || file.endsWith(".delivery.json")))) {
          if (seen.has(file)) continue;
          const request = EngineeringPublication.parse(privateFile(join(root, file)));
          if (request.evidence.assignment !== command || JSON.stringify(request.evidence.address) !== JSON.stringify(worker.address))
            throw new Error("Engineering publication does not address the applied assignment.");
          await onRequest(request);
          seen.add(file);
        }
      }).catch(async error => { watcher.close(); await onUnavailable(String(error)); });
    };
    const watcher = watch(root, collect);
    watcher.unref();
    collect();
  }
  async assign({ worker, command, assignment }: Parameters<TribunusHost["assign"]>[0]) {
    const hello = await this.hello(worker.address.launch);
    if (JSON.stringify(hello.address) !== JSON.stringify(worker.address))
      throw new Error("Worker generation changed.");
    const value = await this.control(hello, "assign", command, assignment);
    return value === null ? null : z.object({
      application: z.string()
    }).parse(value);
  }
}
export function managedBootstrap() {
  const path = process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  delete process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  return path;
}
export function installTribunus(pi: ExtensionAPI, path: string) {
  const descriptor = Descriptor.parse(privateFile(path));
  let server: Server | null = null;
  let context: ExtensionContext | null = null;
  let address: z.infer<typeof WorkerAddress> | null = null;
  let manual = false;
  let active: {
    kind: "checking";
    frame: z.infer<typeof Frame>;
  } | {
    kind: "running";
    frame: z.infer<typeof Frame>;
    prompt: string;
    expanded: string | null;
    priorMode: Set<string>;
    resolve: (value: unknown) => void;
  } | null = null;
  let continuation: { command: string; prompt: string; authority: z.infer<typeof Authority>; expanded: boolean } | null = null;
  let decision: z.infer<typeof EngineeringRecord> | null = null;
  const deliveredDecisions = new Map<string, z.infer<typeof EngineeringRecord>>();
  let waiting: z.infer<typeof EngineeringRequest> | null = null;
  let initialized: z.infer<typeof Initialization> | null = null;
  let controller = descriptor.authority;
  let generationRoot = "";
  let journal = "";
  let contractTracker: EngineeringContract | null = null;
  let assignmentCommand: string | null = null;
  let pendingSettlement: { report: z.infer<typeof WorkerReport>; authority: z.infer<typeof Authority>; ctx: ExtensionContext; decision: z.infer<typeof EngineeringRecord> | null } | null = null;
  let settling = false, settlementDirty = false;
  let contractSequence = 0;
  let admissionHold: string | null = null;
  const unknownChildEvidence = new Set<string>();
  let centuriones: Centuriones | null = null;
  const attemptedEffects = new Set<string>();
  const effects = new Map<string, { record: z.infer<typeof EffectRecord>; execution: "admitted" | "executing" | "observed" }>();
  const effectOwners = new Map<string, string>();
  const nativeArguments = new Map<string, (id: string, raw: unknown) => unknown>();
  const NativeCall = z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }).passthrough();
  const NativeMessage = z.object({ id: z.string(), type: z.literal("message"), message: z.object({ role: z.literal("assistant"), content: z.array(z.unknown()) }).passthrough() }).passthrough();
  function preparedEntry(entry: unknown) {
    const parsed = NativeMessage.safeParse(entry);
    if (!parsed.success) return entry;
    return { ...parsed.data, message: { ...parsed.data.message, content: parsed.data.message.content.map(part => {
      const call = NativeCall.safeParse(part);
      if (!call.success) return part;
      const prepare = nativeArguments.get(call.data.name);
      if (!prepare) return part;
      try { return { ...call.data, arguments: prepare(call.data.id, call.data.arguments) }; }
      catch { return part; }
    }) } };
  }
  let workspacePreparation: { child: string; rootCall: string; journal: string; command: string | null } | null = null;
  async function effectRequest(message: z.infer<typeof EffectMessage>, command: string, ctx: ExtensionContext) {
    if (!address || !incarnation(ctx)) throw new Error("Current principal unavailable for effect transport.");
    const id = message.kind === "effect-admission" ? message.intent.id : message.id;
    const responsePath = join(generationRoot, `${command}.${id}.effect-response.json`);
    publish(join(generationRoot, `${command}.${id}.${message.kind === "effect-observation" ? "effect-observation" : "effect-request"}.json`), { capability: descriptor.capability, address, assignment: command, message });
    const deadline = Date.now() + 5000;
    while (!existsSync(responsePath)) {
      if (Date.now() >= deadline || ctx.signal?.aborted) throw new Error(`Effect response ${id} is unresolved. Preserve it; do not retry.`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return EffectReply.parse(privateFile(responsePath));
  }
  let shellSettings: { shellPath: string | undefined; shellCommandPrefix: string | undefined } | null = null;
  function observeEffect(call: string, outcome: z.infer<typeof EffectOutcome>) {
    const effect = effects.get(call);
    if (!effect || effect.execution === "observed" || !address) return;
    const message = EffectMessage.parse({ kind: "effect-observation", id: effect.record.intent.id, digest: effect.record.digest, state: outcome });
    publish(join(generationRoot, `${effect.record.intent.pin.assignment}.${effect.record.intent.id}.effect-observation.json`), { capability: descriptor.capability, address, assignment: effect.record.intent.pin.assignment, message });
    effect.record.state = outcome;
    effect.execution = "observed";
    resumeSettlement(effect.record.intent.pin.assignment);
  }
  function effectEvidence(call: string, value: unknown) {
    const effect = effects.get(call);
    if (!effect) throw new Error("Effect admission is unavailable.");
    const path = receipt(effect.record.intent.id, "effect-outcome");
    publish(path, value);
    return path;
  }
  function publishContract(ctx: ExtensionContext) {
    if (!contractTracker || !assignmentCommand || !address || !incarnation(ctx)) return;
    const observation = ContractObservation.parse({ address, command: assignmentCommand, sequence: ++contractSequence, contract: contractTracker.snapshot(ctx) });
    publish(join(generationRoot, `${assignmentCommand}.${contractSequence}.contract.json`), observation);
  }
  async function checkChildOwner(intent: z.infer<typeof CenturioIntent>, stage: "launch" | "read", ctx: ExtensionContext) {
    if (!intent.assignment.value || !address || !incarnation(ctx) || intent.assignment.command !== assignmentCommand || !isDeepStrictEqual(intent.authority, controller)) throw new Error("Child principal authority changed.");
    const command = intent.assignment.command;
    const message = CenturioOwnerCheck.parse({ kind: "centurio-owner-check", id: randomUUID(), child: { id: intent.id, digest: createHash("sha256").update(JSON.stringify(intent)).digest("hex") }, stage,
      pin: { ...intent.authority, task: intent.assignment.value.task, scope: intent.assignment.value.scope, reservation: descriptor.launch.reservation, assignment: command,
        launch: address.launch, workerSession: address.session, workerGeneration: address.generation, addressDigest: createHash("sha256").update(JSON.stringify(address)).digest("hex") } });
    const responsePath = join(generationRoot, `${command}.${message.id}.effect-response.json`);
    publish(join(generationRoot, `${command}.${message.id}.effect-request.json`), { capability: descriptor.capability, address, assignment: command, message });
    const deadline = Date.now() + 5000;
    while (!existsSync(responsePath)) {
      if (Date.now() >= deadline || ctx.signal?.aborted) throw new Error("Current child-owner response is unavailable. Preserve this intent.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const reply = EffectReply.parse(privateFile(responsePath));
    if (!incarnation(ctx) || intent.assignment.command !== assignmentCommand || !isDeepStrictEqual(intent.authority, controller) || reply.kind !== "centurio-owner-current" || reply.id !== message.id || !isDeepStrictEqual(reply.child, message.child)) throw new Error(`Current child-owner check refused. ${JSON.stringify(reply)}`);
  }
  function settlementCurrent(pending: NonNullable<typeof pendingSettlement>) {
    return pendingSettlement === pending && assignmentCommand === pending.report.command && incarnation(pending.ctx) && isDeepStrictEqual(pending.authority, controller) && isDeepStrictEqual(address, pending.report.address) && !pending.ctx.hasPendingMessages() && !existsSync(receipt(pending.report.command, "report"));
  }
  function resumeSettlement(command: string) {
    if (pendingSettlement?.report.command !== command) return;
    settlementDirty = true;
    if (settling) return;
    settling = true;
    void (async () => {
      try {
        while (settlementDirty) {
          settlementDirty = false;
          const pending = pendingSettlement;
          if (!pending || !settlementCurrent(pending) || !centuriones || centuriones.outstanding) continue;
          const terminal = await centuriones.terminalReport(command);
          const assignmentEffects = [...effects.values()].filter(effect => effect.record.intent.pin.assignment === command);
          if (!terminal || !settlementCurrent(pending) || centuriones.outstanding || assignmentEffects.some(effect => effect.execution !== "observed")) continue;
          const engineering = pending.decision ? engineeringResult(pending.decision, assignmentEffects.map(effect => effect.record), [...deliveredDecisions.values()]) : undefined;
          const blocked = admissionHold || centuriones.held || assignmentEffects.some(effect => effect.record.state.kind === "unknown") || engineering?.alternative.kind === "unverified" || engineering?.priorExceptions.some(prior => prior.alternative.kind === "unverified");
          const outcome = pending.report.outcome === "failed" || terminal.failed ? "failed" : pending.report.outcome === "blocked" || blocked ? "blocked" : "reported-result";
          const children = terminal.children;
          const assistantText = children.length ? `Principal settlement: ${pending.report.outcome === "failed" ? "failed" : "stopped; no implementation success inferred"}.\nOwned child terminal findings; not verified implementation success or acceptance.\n${children.map(child => `${child.id}: ${child.state.kind === "process-terminal" ? child.state.outcome : child.state.kind}\n${child.result?.preview ?? ""}`).join("\n")}`.slice(0, 4000) : pending.report.assistantText;
          // No await between the final state checks and publication. Terminal children cannot admit new effects.
          publish(receipt(command, "report"), WorkerReport.parse({ ...pending.report, outcome, assistantText, ...(engineering ? { engineering } : {}),
            evidence: [...new Set([...pending.report.evidence, receipt(command, "settlement-pending"), ...unknownChildEvidence, ...centuriones.evidence, ...children.flatMap(child => [...child.evidence, ...(child.result ? [child.result.evidence, child.result.source] : [])]), ...assignmentEffects.flatMap(effect => effect.record.state.kind === "outstanding" ? [] : [effect.record.state.evidence])])] }));
          pendingSettlement = null;
          pending.ctx.ui.setStatus("legion-intake", `Tribunus ${outcome}. Waiting. Not accepted.`);
        }
      } catch (error) { pendingSettlement?.ctx.ui.setStatus("legion-intake", `Assignment settlement held. Preserve current child/effect evidence. ${String(error)}`); }
      finally { settling = false; }
    })();
  }
  function settleAssignment(report: z.infer<typeof WorkerReport>, ctx: ExtensionContext, appliedDecision: z.infer<typeof EngineeringRecord> | null = null) {
    if (pendingSettlement || existsSync(receipt(report.command, "report"))) return;
    pendingSettlement = { report, ctx, authority: { ...controller }, decision: appliedDecision };
    publish(receipt(report.command, "settlement-pending"), { report, authority: controller, decision: appliedDecision });
    ctx.ui.setStatus("legion-intake", "Principal settled. Assignment pending independently proven child/effect termination. Not accepted.");
    resumeSettlement(report.command);
  }
  const receipt = (id: string, suffix: string) => join(generationRoot, `${id}.${suffix}.json`);
  function deliveryReceipt(command: string) {
    const applied = receipt(command, "engineering-applied");
    const continued = receipt(command, "continuation-applied");
    const dispatched = receipt(command, "continuation-intent");
    return EngineeringDeliveryReceipt.parse({ kind: "applied", command, evidence: applied,
      continuation: existsSync(continued) ? { kind: "applied", evidence: z.object({ evidence: z.string() }).parse(privateFile(continued)).evidence }
        : existsSync(dispatched) ? { kind: "dispatched", evidence: dispatched } : { kind: "pending" }
    });
  }
  function publishDelivery() {
    if (!waiting || decision?.state.kind !== "decided" || !address) return;
    const command = decision.state.delivery.command;
    const delivery = deliveryReceipt(command);
    publish(join(generationRoot, `${waiting.evidence.assignment}.${command}.${delivery.continuation.kind}.delivery.json`), EngineeringObservation.parse({
      kind: "engineering-observation", request: { id: decision.id, digest: decision.digest }, delivery, evidence: waiting.evidence
    }));
  }
  function continueWhenIdle() {
    setTimeout(() => {
      try {
        if (!context || !incarnation(context) || active || continuation || pendingSettlement || !context.isIdle() || context.hasPendingMessages() || decision?.state.kind !== "decided") return;
        const pin = decision.pin, command = decision.state.delivery.command;
        if (pin.session !== controller.session || pin.generation !== controller.generation || pin.epoch !== controller.epoch || existsSync(receipt(command, "continuation-intent"))) return;
        const prompt = `Legion engineering continuation ${command} for assignment ${pin.assignment}\n${JSON.stringify({ request: decision.id, proposal: decision.proposal, decision: decision.state.decision })}\nDecision delivery is not effect admission. With approved seam and complete current native loading, each root bash, write, or edit requires deterministic current-controller admission and ordinary permissions. Delegation and unknown tools remain locked. Follow Matt red-before-green for this approved seam except only the explicitly approved omitted test, if any. An exception applies only to its named behavior. Run its exact alternative native bash input after the relevant changes. A successful unrelated command or a model summary is not alternative verification. Include the exception in the result. Use legion_engineering for another proposal; old approval cannot authorize it. Do not claim assignment acceptance.`;
        publish(receipt(command, "continuation-intent"), { command, prompt });
        publishDelivery();
        continuation = { command, prompt, authority: { ...controller }, expanded: false };
        pi.sendUserMessage(prompt);
      } catch (error) {
        context?.ui.setStatus("legion-intake", `Engineering continuation is unresolved. Preserve the decision and continuation intent. ${String(error)}`);
      }
    }, 0);
  }
  async function resources(ctx: ExtensionContext) {
    const contract = contractTracker?.snapshot(ctx) ?? discoverContract(pi, realpathSync(ctx.cwd));
    return {
      contract,
      cwd: realpathSync(ctx.cwd), skills: pi.getCommands().filter((c) => c.source === "skill").map((c) => ({
        name: c.name.replace(/^skill:/, ""), path: c.sourceInfo.path
      })), diagnostics: [...await preflight(pi), ...contract.diagnostics]
    };
  }
  const incarnation = (ctx: ExtensionContext) => !!address && ctx.mode === "tui" && ctx.sessionManager.getSessionId() === address.session && !manual;
  pi.on("session_start", async (_event, ctx) => {
    server?.close();
    server = null;
    if (address) {
      manual = true;
      return;
    }
    if (ctx.mode !== "tui" || realpathSync(ctx.cwd) !== descriptor.cwd || !ctx.isProjectTrusted())
      throw new Error("Managed Tribunus requires trusted target cwd and ordinary interactive Pi. No assignment authorized.");
    context = ctx;
    for (const name of ["bash", "write", "edit"]) {
      if (pi.getAllTools().find(tool => tool.name === name)?.sourceInfo.path !== `builtin:${name}`)
        throw new Error(`Managed effect admission requires the native ${name} implementation. A configured override must not be replaced. Mutation remains locked.`);
    }
    const settings = pi.getSettings();
    shellSettings = { shellPath: settings.shellPath, shellCommandPrefix: settings.shellCommandPrefix };
    function wrap<T extends TSchema, D, S>(native: ToolDefinition<T, D, S>): ToolDefinition<T, D, S> {
      nativeArguments.set(native.name, (id, raw) => {
        const original = structuredClone(raw);
        const prepared = native.prepareArguments ? native.prepareArguments(original) : original;
        const input = z.record(z.string(), z.json()).parse(prepared);
        return z.json().parse(validateToolArguments(native, { type: "toolCall", id, name: native.name, arguments: input }));
      });
      return { ...native, execute: async (id, args, signal, update, toolContext) => {
        const effect = effects.get(id);
        if (!effect || effect.execution !== "admitted") throw new Error("No unused exact-call effect admission. Do not replay this call.");
        const intent = effect.record.intent;
        const currentSettings = pi.getSettings();
        if (signal?.aborted || !incarnation(toolContext) || realpathSync(toolContext.cwd) !== descriptor.cwd || native.name !== intent.call.name || !isDeepStrictEqual(args, intent.call.input) || pi.getAllTools().find(tool => tool.name === native.name)?.sourceInfo.path !== effectOwners.get(native.name) || !isDeepStrictEqual(shellSettings, { shellPath: currentSettings.shellPath, shellCommandPrefix: currentSettings.shellCommandPrefix }) || !isDeepStrictEqual(contractTracker?.snapshot(toolContext), intent.contract)) {
          const reason = "Final input, selected resources, tool ownership, settings, or principal differs from the admitted intent.";
          observeEffect(id, { kind: "refused", reason, evidence: effectEvidence(id, { kind: "refused", reason }) });
          throw new Error(reason);
        }
        if (intent.origin?.kind === "workspace-preparation") {
          const reply = await effectRequest({ kind: "centurio-owner-check", id: randomUUID(), pin: intent.pin, stage: "launch", child: { id: intent.origin.child, digest: effect.record.digest } }, intent.pin.assignment, toolContext);
          const settings = pi.getSettings();
          if (reply.kind !== "centurio-owner-current" || signal?.aborted || !incarnation(toolContext) || !isDeepStrictEqual(args, intent.call.input) || pi.getAllTools().find(tool => tool.name === native.name)?.sourceInfo.path !== effectOwners.get(native.name) || !isDeepStrictEqual(shellSettings, { shellPath: settings.shellPath, shellCommandPrefix: settings.shellCommandPrefix }) || !isDeepStrictEqual(contractTracker?.snapshot(toolContext), intent.contract)) throw new Error("Workspace preparation owner/input/tool/settings/resources changed at final execute.");
        }
        effect.execution = "executing";
        try {
          const result = await native.execute(id, structuredClone(args), signal, update, toolContext);
          const shell = native.name === "bash" ? z.object({ exit_code: z.int() }).safeParse(result.structuredContent) : null;
          observeEffect(id, { kind: "completed", isError: result.isError ?? false, evidence: effectEvidence(id, { kind: "native-result", result }), ...(shell?.success ? { exitCode: shell.data.exit_code } : {}) });
          return result;
        } catch (error) {
          admissionHold = `Native effect ${intent.id} has an unresolved outcome. Reconcile this identity before further work.`;
          observeEffect(id, { kind: "unknown", reason: String(error), evidence: effectEvidence(id, { kind: "native-outcome-unknown", error: String(error) }) });
          throw error;
        }
      } };
    }
    pi.registerTool(wrap(createBashToolDefinition(ctx.cwd, { ...(settings.shellPath ? { shellPath: settings.shellPath } : {}), ...(settings.shellCommandPrefix ? { commandPrefix: settings.shellCommandPrefix } : {}) })));
    pi.registerTool(wrap(createWriteToolDefinition(ctx.cwd)));
    pi.registerTool(wrap(createEditToolDefinition(ctx.cwd)));
    for (const name of ["bash", "write", "edit"]) {
      const owner = pi.getAllTools().find(tool => tool.name === name)?.sourceInfo.path;
      if (!owner || owner === `builtin:${name}`) throw new Error(`Managed ${name} final-execution boundary is unavailable.`);
      effectOwners.set(name, owner);
    }
    const paneId = process.env.HERDR_PANE_ID;
    if (!paneId)
      throw new Error("Managed worker has no local Herdr pane identity.");
    const pane = await paneAt(paneId), local = await localIdentity();
    const processInfo = z.object({
      result: z.object({
        process_info: z.object({
          foreground_processes: z.array(z.object({
            pid: z.int()
          }))
        })
      })
    }).parse(JSON.parse((await exec("herdr", ["pane", "process-info", "--pane", paneId])).stdout));
    if (!processInfo.result.process_info.foreground_processes.some((p) => p.pid === process.pid) || pane.foreground_cwd !== ctx.cwd)
      throw new Error("This process is not the principal in the owned local terminal.");
    address = WorkerAddress.parse({
      launch: descriptor.launch.id, window: {
        ...local, workspace: pane.workspace_id, tab: pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id
      }, session: ctx.sessionManager.getSessionId(), generation: randomUUID()
    });
    journal = ctx.sessionManager.getSessionFile() ?? "";
    if (!journal)
      throw new Error("Exact worker journal locator unavailable.");
    contractTracker = new EngineeringContract(pi, descriptor.cwd, journal);
    generationRoot = join(dirname(path), address.generation);
    mkdirSync(generationRoot, {
      mode: 0o700
    });
    const endpoint = join(dirname(dirname(path)), `s-${createHash("sha256").update(JSON.stringify(address)).digest("hex").slice(0, 32)}.sock`);
    if (Buffer.byteLength(endpoint) >= 108 || existsSync(endpoint))
      throw new Error("Generation-specific Unix endpoint is unsupported or collides. No transport fallback.");
    centuriones = new Centuriones(pi, generationRoot, address, endpoint, descriptor.capability, checkChildOwner, resumeSettlement);
    pi.appendEntry("legion-tribunus-generation", {
      launch: address.launch, generation: address.generation
    });
    server = createServer((socket) => {
      let buffer = "";
      socket.on("data", async (chunk) => {
        let accepted: string | null = null;
        buffer += chunk;
        if (!buffer.includes("\n"))
          return;
        socket.removeAllListeners("data");
        try {
          const raw: unknown = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
          if (z.object({ kind: z.literal("centurio-effect") }).safeParse(raw).success) {
            if (!centuriones || !context || !incarnation(context)) throw new Error("The owning principal is unavailable.");
            const ownerContext = context;
            const reply = await centuriones.childEffect(raw, ownerContext, async (message, command) => {
              if (message.kind === "effect-observation") {
                const found = [...effects.entries()].find(([, value]) => value.record.intent.id === message.id && value.record.digest === message.digest);
                if (!found) throw new Error("Child result does not join a retained admission.");
                observeEffect(found[0], message.state);
                if (message.state.kind === "unknown") admissionHold = `Owned child effect ${message.id} is unresolved.`;
                return { kind: "effect", effect: found[1].record };
              }
              const response = await effectRequest(message, command, ownerContext);
              if (message.kind === "effect-admission" && response.kind === "effect") effects.set(`${message.intent.origin?.kind === "centurio" ? message.intent.origin.session : "child"}/${message.intent.call.id}`, { record: response.effect, execution: "admitted" });
              return response;
            });
            socket.end(JSON.stringify(reply) + "\n");
            return;
          }
          if (z.object({ kind: z.literal("centurio-check") }).safeParse(raw).success) {
            if (!centuriones || !context || !incarnation(context)) throw new Error("The owning principal is unavailable.");
            socket.end(JSON.stringify(await centuriones.checkChild(raw, context)) + "\n");
            return;
          }
          const frame = Frame.parse(raw);
          const received = Buffer.from(frame.capability), expected = Buffer.from(descriptor.capability);
          if (received.length !== expected.length || !timingSafeEqual(received, expected) || !address || JSON.stringify(frame.address) !== JSON.stringify(address) || frame.reservation !== descriptor.launch.reservation || frame.scope !== descriptor.launch.scope || frame.authority.owner !== descriptor.authority.owner || frame.authority.generation < controller.generation || (frame.authority.generation === controller.generation && (frame.authority.session !== controller.session || frame.authority.epoch !== controller.epoch)) || !context || !incarnation(context))
            throw new Error("Control does not address this authorized worker incarnation.");
          if (frame.authority.generation > controller.generation) {
            publish(join(generationRoot, `${frame.authority.generation}.controller.json`), frame.authority);
            controller = frame.authority;
          }
          if (frame.kind === "inspect") {
            const value = {
              address, resources: await resources(context), identityEvidence: journal
            };
            socket.end(JSON.stringify({
              kind: "ok", value
            }) + "\n");
            return;
          }
          if (frame.kind === "engineering") {
            if (pendingSettlement) throw new Error("The original assignment is awaiting owned child settlement. No new engineering continuation.");
            const record = frame.engineering;
            if (!waiting || !record || record.state.kind !== "decided" || record.state.delivery.command !== frame.command || record.id !== waiting.requestKey)
              throw new Error("Decision has no exact waiting worker proposal.");
            const evidence = waiting.evidence;
            const pin = { owner: evidence.owner, session: evidence.session, generation: evidence.generation, epoch: evidence.epoch,
              task: evidence.task, scope: evidence.scope, reservation: evidence.reservation, assignment: evidence.assignment,
              launch: evidence.address.launch, workerSession: evidence.address.session, workerGeneration: evidence.address.generation,
              addressDigest: createHash("sha256").update(JSON.stringify(evidence.address)).digest("hex") };
            const digest = createHash("sha256").update(JSON.stringify({ pin, proposal: waiting.proposal, ...(waiting.previous ? { previous: waiting.previous } : {}) })).digest("hex");
            if (record.digest !== digest || JSON.stringify(record.pin) !== JSON.stringify(pin) || JSON.stringify(record.proposal) !== JSON.stringify(waiting.proposal) || !isDeepStrictEqual(record.previous, waiting.previous) || record.state.by.session !== frame.authority.session || record.state.by.generation !== frame.authority.generation || pin.session !== frame.authority.session || pin.generation !== frame.authority.generation || pin.epoch !== frame.authority.epoch || frame.authority.session === address.session)
              throw new Error("Decision authority, task, scope, or proposal does not match this waiting assignment.");
            if (decision && JSON.stringify(decision) !== JSON.stringify(record)) throw new Error("Decision conflicts with the retained worker delivery.");
            publish(receipt(frame.command, "engineering-applied"), record);
            decision = record;
            deliveredDecisions.set(record.id, { ...record, state: { ...record.state, delivery: deliveryReceipt(frame.command) } });
            publishDelivery();
            socket.end(JSON.stringify({ kind: "ok", value: deliveryReceipt(frame.command) }) + "\n");
            continueWhenIdle();
            return;
          }
          const fingerprint = createHash("sha256").update(JSON.stringify({
            address: frame.address, command: frame.command, kind: frame.kind, assignment: frame.assignment, reservation: frame.reservation, scope: frame.scope
          })).digest("hex");
          if (existsSync(receipt(frame.command, "intent"))) {
            const intent = z.object({
              fingerprint: z.string()
            }).parse(privateFile(receipt(frame.command, "intent")));
            if (intent.fingerprint !== fingerprint)
              throw new Error("Control ID conflicts with retained payload.");
            socket.end(JSON.stringify({
              kind: "ok", value: existsSync(receipt(frame.command, "applied")) ? privateFile(receipt(frame.command, "applied")) : null
            }) + "\n");
            return;
          }
          if (active || pendingSettlement || !context.isIdle() || context.hasPendingMessages())
            throw new Error("Worker has an unsettled operation. No queued control or alternate delivery.");
          active = {
            kind: "checking", frame
          };
          accepted = frame.command;
          const observed = await resources(context);
          if (observed.diagnostics.some((d) => d.status !== "ready") || !incarnation(context) || frame.authority.generation !== controller.generation || frame.authority.session !== controller.session || frame.authority.epoch !== controller.epoch)
            throw new Error("Actual target resources or incarnation are unavailable. Assignment withheld.");
          const currentMode = context.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "pstack-mode").at(-1);
          const modeEnabled = currentMode?.type === "custom" && z.object({
            enabled: z.literal(true)
          }).safeParse(currentMode.data).success;
          if (frame.kind === "assign" && (!initialized || !modeEnabled || !existsSync(receipt(initialized.command, "applied")) || !frame.assignment || frame.assignment.scope !== descriptor.launch.scope))
            throw new Error("Worker has no same-generation applied initialization or matching bounded assignment.");
          if (frame.kind === "assign") publish(receipt(frame.command, "assignment"), { assignment: frame.assignment });
          publish(receipt(frame.command, "intent"), {
            fingerprint, command: frame.command, address, authority: frame.authority
          });
          const prompt = frame.kind === "initialize"
            ? `/skill:poteto-mode Legion native initialization ${frame.command}. No implementation assignment is authorized yet. Do not use tools, delegate, edit files, or run commands. Reply in one sentence that you are waiting for the bounded assignment.`
            : `Legion bounded assignment ${frame.command}\n${JSON.stringify(frame.assignment)}\nYou own only this assignment. Do not schedule the spec, integrate, accept, clean up, publish, or close issues. Matt TDD is primary; pstack supplements it and cannot override its red-before-green contract. Load the complete native matt-tdd SKILL.md, tests.md, and mocking.md from this worktree before implementation. matt-teach is distinct from pstack teach; load teaching instructions only when the workflow needs teaching. Partial, truncated, or failed reads do not prove loading. Tests, writes, shell commands, and delegation remain locked even after loading. Request seam approval or a documented exception from your Legatus within this scope. A result is not acceptance.`;
          const done = new Promise<unknown>((resolve) => { active = {
            kind: "running", frame, prompt, expanded: null, priorMode: new Set(context?.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "pstack-mode").map((e) => e.id)), resolve
          }; });
          if (!incarnation(context))
            throw new Error("Worker incarnation changed before injection.");
          pi.sendUserMessage(prompt, {
            expandPromptTemplates: frame.kind === "initialize"
          });
          const value = await done;
          socket.end(JSON.stringify({
            kind: "ok", value
          }) + "\n");
        }
        catch (error) {
          if (active?.kind === "checking" && active.frame.command === accepted)
            active = null;
          socket.end(JSON.stringify({
            kind: "held", message: String(error)
          }) + "\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server?.once("error", reject); server?.listen(endpoint, resolve); });
    publish(join(dirname(path), "hello.json"), {
      address, endpoint, journal, pid: process.pid
    });
    ctx.ui.setStatus("legion-intake", "Tribunus awaiting verified initialization. No assignment.");
  });
  function holdUnknownChildren(evidence: unknown) {
    const reason = "Native child activity requires owned child reconciliation. No child completion or process termination is established.";
    admissionHold ??= reason;
    if (generationRoot) {
      try {
        const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
        const path = receipt(digest, "child-unresolved");
        publish(path, { kind: "unknown", address, assignment: assignmentCommand, journal, reason, evidence });
        unknownChildEvidence.add(path);
      } catch {
        context?.ui.setStatus("legion-intake", "Child evidence retention failed. Preserve the principal journal. Effects remain held.");
      }
    }
    return reason;
  }
  const pendingChildActivity: { kind: "started" | "complete"; raw: unknown }[] = [];
  function observeChildActivity(kind: "started" | "complete", raw: unknown, allowPending = true) {
    if (!context || !incarnation(context)) return;
    try {
      const result = centuriones?.observeActivity(kind, raw);
      if (result === "owned") return;
      if (result === "pending" && allowPending) { pendingChildActivity.push({ kind, raw }); return; }
      holdUnknownChildren({ kind, sha256: createHash("sha256").update(JSON.stringify(raw) ?? "null").digest("hex") });
    } catch (error) { holdUnknownChildren({ kind, error: String(error) }); }
  }
  const childEventSubscriptions = [
    pi.events.on("subagent:async-started", raw => observeChildActivity("started", raw)),
    pi.events.on("subagent:async-complete", raw => observeChildActivity("complete", raw)),
  ];
  function retainChildNotice(evidence: unknown) {
    const message = "Native child notice retained for diagnostics only. Inspect owned child state; this notice proves no completion or process termination.";
    if (generationRoot) {
      try {
        const sha256 = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
        const path = receipt(sha256, "child-notice");
        publish(path, { kind: "informational", address, assignment: assignmentCommand, journal, sha256, message });
        unknownChildEvidence.add(path);
      } catch { context?.ui.setStatus("legion-intake", "Child notice retention failed. Inspect the principal journal and owned child state."); }
    }
    return message;
  }
  pi.on("context", (event, ctx) => {
    if (!incarnation(ctx)) return;
    return { messages: event.messages.map(message => {
      if (message.role !== "custom" || message.customType !== "subagent-notify") return message;
      return { role: message.role, customType: message.customType, content: retainChildNotice({ kind: "notification", message }), display: message.display, timestamp: message.timestamp };
    }) };
  });
  pi.on("input", (event) => {
    if (continuation && event.source === "extension" && event.text === continuation.prompt && context && incarnation(context) && JSON.stringify(continuation.authority) === JSON.stringify(controller)) return { action: "continue" };
    if (active?.kind === "running" && event.source === "extension" && event.text === active.prompt)
      return {
        action: "continue"
      };
    if (event.source === "extension") {
      if (event.text === "Subagent updates above.") {
        retainChildNotice({ kind: "wake", text: event.text });
      }
      return { action: "handled" };
    }
    manual = true;
    return {
      action: "handled"
    };
  });
  pi.on("before_agent_start", (event) => {
    if (continuation && event.prompt === continuation.prompt && context && incarnation(context)) { continuation.expanded = true; return; }
    if (active?.kind !== "running" || !context || !incarnation(context))
      return;
    const skill = pi.getCommands().find((c) => c.name === "skill:poteto-mode" && c.source === "skill");
    if (active.frame.kind === "initialize") {
      if (!skill)
        return;
      const bytes = readFileSync(skill.sourceInfo.path, "utf8");
      const body = stripFrontmatter(bytes).trim();
      const expansion = `<skill name="poteto-mode" location="${skill.sourceInfo.path}">\nReferences are relative to ${dirname(skill.sourceInfo.path)}.\n\n${body}\n</skill>\n\n${active.prompt.slice("/skill:poteto-mode ".length)}`;
      if (event.prompt !== expansion)
        return;
      contractTracker?.captureExpansion(skill.sourceInfo.path, bytes, expansion);
    }
    else if (event.prompt !== active.prompt)
      return;
    active.expanded = event.prompt;
  });
  function assignmentApplied(ctx: ExtensionContext) {
    const pending = active;
    if (pending?.kind !== "running" || pending.frame.kind !== "assign" || !pending.expanded || !address || !incarnation(ctx)) return false;
    const user = ctx.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user" && Array.isArray(entry.message.content) && entry.message.content.some((part) => part.type === "text" && part.text === pending.expanded));
    if (!user || !existsSync(journal)) return false;
    const actual = readFileSync(journal, "utf8").trimEnd().split("\n").map((line) => z.object({ id: z.string() }).parse(JSON.parse(line))).some((entry) => entry.id === user.id);
    if (!actual) return false;
    const fd = openSync(journal, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const application = { application: `${journal}#${user.id}` };
    publish(receipt(pending.frame.command, "applied"), application);
    assignmentCommand = pending.frame.command;
    pending.resolve(application);
    return true;
  }
  pi.on("message_end", (event, ctx) => {
    if (continuation?.expanded && event.message.role === "user") {
      const pending = continuation;
      setImmediate(() => {
        try {
          const user = ctx.sessionManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user" && Array.isArray(entry.message.content) && entry.message.content.some(part => part.type === "text" && part.text === pending.prompt));
          if (!user || !incarnation(ctx)) return;
          const bytes = readFileSync(journal, "utf8").trimEnd().split("\n").map(line => z.object({ id: z.string() }).parse(JSON.parse(line)));
          if (!bytes.some(entry => entry.id === user.id)) return;
          const fd = openSync(journal, "r");
          try { fsyncSync(fd); } finally { closeSync(fd); }
          publish(receipt(pending.command, "continuation-applied"), { evidence: `${journal}#${user.id}` });
          publishDelivery();
        } catch (error) {
          ctx.ui.setStatus("legion-intake", `Engineering continuation evidence is unresolved. Preserve the journal and dispatch. ${String(error)}`);
        }
      });
      return;
    }
    if (active?.kind !== "running" || active.frame.kind !== "assign" || event.message.role !== "user") return;
    const pending = active;
    setImmediate(() => {
      if (active !== pending) return;
      try { assignmentApplied(ctx); }
      catch { pending.resolve(null); }
    });
  });
  pi.registerTool({
    name: "legion_centurio", label: "Prepare Legion Centurio", exposure: "model-only",
    description: "Prepare a durable owned native child intent. Does not launch. Exploration/review are read-only. Implementation requires current approved engineering, loaded contract, explicit clean committed baseRef/baseCommit and a retained isolated branch/worktree.",
    parameters: Type.Unsafe<z.infer<typeof CenturioRequest>>(z.toJSONSchema(CenturioRequest, { io: "input" })),
    execute: async (rootCall, raw, _signal, _update, ctx) => {
      const initial = active?.kind === "running" && active.frame.kind === "assign" && active.frame.assignment && assignmentApplied(ctx) ? active.frame : null;
      const prior = continuation?.expanded && decision?.state.kind === "decided" && continuation.command === decision.state.delivery.command ? decision : null;
      if (!centuriones || !incarnation(ctx) || admissionHold || centuriones.held || waiting && !prior) throw new Error("No current unheld assignment for Centurio preparation.");
      const command = initial?.command ?? prior?.pin.assignment;
      const value = initial?.assignment ?? (command ? z.object({ assignment: BoundedAssignment }).safeParse(privateFile(receipt(command, "assignment"))).data?.assignment : null);
      if (!command || !value) throw new Error("No applied bounded assignment for Centurio preparation.");
      const request = CenturioRequest.parse(raw);
      centuriones.validateRequest(request, ctx);
      let writable: z.infer<typeof CenturioIntent>["writable"];
      const id = randomUUID();
      if (request.purpose === "implementation") {
        const seam = prior ? approvedSeam([...deliveredDecisions.values()], prior) : null;
        if (!prior || prior.state.kind !== "decided" || prior.state.decision.kind !== "approve" || !seam || contractTracker?.snapshot(ctx).verification.kind !== "verified") throw new Error("Writable child requires current applied seam/exception approval and loaded contract.");
        if (!request.baseRef || !request.baseCommit) throw new Error("Writable child requires an explicit committed baseRef/baseCommit. Dirty work is not copied or silently omitted.");
        if (workspacePreparation) throw new Error("Another child workspace allocation is in progress or unresolved.");
        const calls = ctx.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall" && part.id === rootCall && part.name === "legion_centurio" && isDeepStrictEqual(part.arguments, raw)));
        const origin = calls[0];
        if (calls.length !== 1 || !origin || !readFileSync(journal, "utf8").trimEnd().split("\n").some(line => isDeepStrictEqual(JSON.parse(line), origin))) throw new Error("Exact authenticated fresh root preparation origin is unavailable.");
        workspacePreparation = { child: id, rootCall, journal: `${journal}#${origin.id}`, command: null };
        try {
          const workspace = await prepareCenturioWorkspace({ id, cwd: ctx.cwd, owner: controller.owner, scope: `${value.scope}; bounded child of ${command}`, baseRef: request.baseRef, baseCommit: request.baseCommit,
            current: () => incarnation(ctx) && !admissionHold && decision === prior,
            run: async command => {
              if (!workspacePreparation || admissionHold || decision !== prior) throw new Error("Workspace preparation authority unavailable.");
              workspacePreparation.command = command;
              const result = await ctx.executeTool("bash", { command });
              workspacePreparation.command = null;
              const shell = z.object({ exit_code: z.int(), output: z.string(), truncated: z.literal(false) }).safeParse(result.result.structuredContent);
              if (!shell.success && effects.get(result.toolCall.id)?.record.state.kind === "refused") return { kind: "finished", code: 1, output: "Ordinary native permission/execution pipeline refused child Git preparation; no execution occurred." };
              if (!shell.success) admissionHold = `Guarded child workspace operation is unresolved. Preserve preparation ${id}; do not allocate again.`;
              return shell.success ? { kind: "finished", code: shell.data.exit_code, output: shell.data.output } : { kind: "unknown", message: "Ordinary guarded Git preparation has no conclusive native result. Preserve allocation evidence." };
            } });
          writable = { parentCwd: realpathSync(ctx.cwd), workspace, engineering: prior, seam };
        } catch (error) {
          if (error instanceof CenturioAllocationHeld) {
            const evidence = receipt(id, "centurio-workspace-held");
            publish(evidence, { reservation: error.reservation, parentAssignment: command, origin: workspacePreparation, reason: error.message });
            admissionHold = `Child workspace allocation ${id} is held. Preserve ${evidence}; no duplicate allocation or automatic cleanup.`;
            unknownChildEvidence.add(evidence);
          }
          throw error;
        } finally { workspacePreparation = null; }
      }
      const prepared = centuriones.prepare(request, { command, value }, controller, ctx, writable, id);
      return { content: [{ type: "text", text: JSON.stringify(prepared) }], details: prepared };
    }
  });
  pi.registerTool({
    name: "legion_engineering", label: "Legion engineering", exposure: "model-only",
    description: "Propose a test seam or one justified omitted-test exception with an exact current seam reference, behavior, and native bash alternative plan. The Legatus decides. New proposals hold effects until a fresh decision.",
    parameters: Type.Unsafe<z.infer<typeof EngineeringProposal>>(z.toJSONSchema(EngineeringProposal)),
    execute: async (toolCallId, raw, _signal, _update, ctx) => {
      const pending = active;
      const proposal = EngineeringProposal.parse(raw);
      const initial = pending?.kind === "running" && pending.frame.kind === "assign" && pending.frame.assignment && assignmentApplied(ctx) ? pending.frame : null;
      const prior = continuation?.expanded && decision?.state.kind === "decided" && continuation.command === decision.state.delivery.command && waiting ? decision : null;
      if (!address || !incarnation(ctx) || (!initial && !prior)) throw new Error("No applied bounded assignment or delivered continuation for an engineering proposal.");
      if (waiting && !prior) throw new Error("An engineering proposal is already waiting. Preserve it and yield.");
      if (proposal.kind === "exception" && (!prior || !approvedSeam([...deliveredDecisions.values()], { ...prior, proposal })))
        throw new Error("An exception requires the exact current approved seam and behavior. It cannot expand product scope.");
      if (admissionHold || centuriones?.held || [...effects.values()].some(effect => effect.execution !== "observed")) throw new Error("Resolve admitted effects and unknown children before another proposal.");
      const assignment = initial?.assignment;
      const pin = prior?.pin;
      const command = initial?.command ?? pin?.assignment;
      const task = assignment?.task ?? pin?.task, scope = assignment?.scope ?? pin?.scope;
      if (!command || !task || !scope) throw new Error("The bounded assignment is unavailable.");
      pi.appendEntry("legion-engineering-request", { toolCallId, assignment: command });
      const entry = ctx.sessionManager.getLeafId();
      if (!entry) throw new Error("Engineering request journal evidence is unavailable.");
      const request = EngineeringRequest.parse({
        kind: "engineering-request", requestKey: randomUUID(), proposal, ...(prior ? { previous: { id: prior.id, digest: prior.digest } } : {}),
        evidence: { kind: "tribunus", ...controller, address, assignment: command, reservation: descriptor.launch.reservation,
          task, scope, journal: `${journal}#${entry}` }
      });
      waiting = request;
      decision = null;
      publish(join(generationRoot, `${command}.${request.requestKey}.engineering.json`), request);
      return { content: [{ type: "text", text: "Proposal published. Yield while the Legatus decides. Tests and implementation remain locked." }], details: { kind: "waiting", request: request.requestKey } };
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (["subagent", "subagents_enable"].includes(event.toolName) && incarnation(ctx)) {
      try {
        if (!centuriones || pendingSettlement || admissionHold || !initialized || !(continuation?.expanded || active?.kind === "running" && active.frame.kind === "assign" && assignmentApplied(ctx))) throw new Error("No applied child-owning assignment.");
        await centuriones.admit(event, ctx);
        return;
      } catch (error) { return { block: true, reason: String(error) }; }
    }
    if (continuation?.expanded && incarnation(ctx) && ["bash", "write", "edit"].includes(event.toolName)) {
      if (admissionHold || centuriones?.held) return { block: true, reason: admissionHold ?? "Owned child state is unresolved. No new principal effects are authorized." };
      const allocation = event.toolName === "bash" && workspacePreparation && event.parentToolCallId === workspacePreparation.rootCall && isDeepStrictEqual(event.input, { command: workspacePreparation.command }) ? { ...workspacePreparation } : null;
      if (event.parentToolCallId && !allocation || attemptedEffects.has(event.toolCallId)) return { block: true, reason: "Only fresh model-origin effects or the exact mechanically derived owned workspace preparation may request admission." };
      attemptedEffects.add(event.toolCallId);
      let requested: string | null = null, conclusive = false;
      try {
        if (!address || decision?.state.kind !== "decided" || decision.state.decision.kind !== "approve" || continuation.command !== decision.state.delivery.command || !waiting || !initialized) throw new Error("No approved same-assignment seam decision.");
        if (pi.getAllTools().find(tool => tool.name === event.toolName)?.sourceInfo.path !== effectOwners.get(event.toolName)) throw new Error("Managed final-execution tool ownership changed. Restore the native managed boundary.");
        const contract = contractTracker?.snapshot(ctx);
        if (contract?.verification.kind !== "verified") throw new Error("Current selected resources and complete native loading are required. Reread the current contract.");
        const input = structuredClone(event.input);
        const persisted = new Map(readFileSync(journal, "utf8").trimEnd().split("\n").map(line => { const entry = z.object({ id: z.string() }).passthrough().parse(JSON.parse(line)); return [entry.id, entry]; }));
        const branch = ctx.sessionManager.getBranch().filter(entry => isDeepStrictEqual(preparedEntry(persisted.get(entry.id)), preparedEntry(entry)));
        const prepare = nativeArguments.get(event.toolName);
        const calls = branch.flatMap(entry => {
          const stored = NativeMessage.safeParse(persisted.get(entry.id));
          if (!stored.success || !prepare) return [];
          return stored.data.message.content.flatMap(part => {
            const call = NativeCall.safeParse(part);
            if (!call.success || call.data.id !== event.toolCallId || call.data.name !== event.toolName || !isDeepStrictEqual(prepare(call.data.id, call.data.arguments), input)) return [];
            return [{ entry: entry.id, rawInput: call.data.arguments }];
          });
        });
        const call = allocation ? { entry: allocation.journal.slice(allocation.journal.lastIndexOf("#") + 1), rawInput: input } : calls[0];
        if ((!allocation && calls.length !== 1) || !call || branch.some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === (allocation?.rootCall ?? event.toolCallId))) throw new Error("Exact fresh native journal tool-call provenance is unavailable.");
        if (allocation && !branch.some(entry => entry.id === call.entry && entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall" && part.id === allocation.rootCall && part.name === "legion_centurio"))) throw new Error("Workspace preparation origin changed.");
        const fd = openSync(journal, "r");
        try { fsyncSync(fd); } finally { closeSync(fd); }
        const intent = EffectIntent.parse({ id: randomUUID(), pin: decision.pin, decision: { id: decision.id, digest: decision.digest, command: decision.state.delivery.command }, seam: decision.proposal.kind === "seam" ? { id: decision.id, digest: decision.digest } : decision.proposal.seam, call: { id: event.toolCallId, name: event.toolName, rawInput: call.rawInput, input, journal: `${journal}#${call.entry}` }, contract, ...(allocation ? { origin: { kind: "workspace-preparation", child: allocation.child, rootCall: allocation.rootCall, journal: allocation.journal } } : {}) });
        const requestPath = join(generationRoot, `${intent.pin.assignment}.${intent.id}.effect-request.json`);
        const responsePath = join(generationRoot, `${intent.pin.assignment}.${intent.id}.effect-response.json`);
        requested = intent.id;
        publish(requestPath, { capability: descriptor.capability, address, assignment: intent.pin.assignment, message: { kind: "effect-admission", intent } });
        const deadline = Date.now() + 5000;
        while (!existsSync(responsePath)) {
          if (Date.now() >= deadline || ctx.signal?.aborted) throw new Error(`Current-controller admission response is unavailable. Preserve intent ${intent.id}; do not retry.`);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const reply = EffectReply.parse(privateFile(responsePath));
        if (reply.kind === "resource-invalidated") {
          if (reply.intent.id !== intent.id || reply.intent.digest !== createHash("sha256").update(JSON.stringify(intent)).digest("hex"))
            throw new Error("Resource invalidation does not address the exact requested intent.");
          contractTracker?.retireProof();
          publish(receipt(intent.id, "contract-retired"), { request: requestPath, refusal: reply });
          conclusive = true;
          throw new Error(reply.message);
        }
        if (reply.kind !== "effect") {
          conclusive = reply.kind === "rejected";
          throw new Error(reply.kind === "centurio-owner-current" ? "Unrelated child-owner response cannot admit an effect." : reply.message);
        }
        if (!isDeepStrictEqual(reply.effect.intent, intent) || reply.effect.state.kind !== "outstanding" || reply.effect.digest !== createHash("sha256").update(JSON.stringify(intent)).digest("hex")) throw new Error("Admission response does not match the exact outstanding intent.");
        effects.set(event.toolCallId, { record: reply.effect, execution: "admitted" });
        return;
      } catch (error) {
        if (requested && !conclusive) admissionHold = `Admission ${requested} is unresolved. Reconcile this same identity before new effects. ${String(error)}`;
        return { block: true, reason: admissionHold ?? `Effect admission refused. ${String(error)}` };
      }
    }
    if (continuation?.expanded && incarnation(ctx) && ["read", "grep", "find", "ls", "legion_engineering", "legion_centurio"].includes(event.toolName)) { contractTracker?.captureRead(event); return; }
    if (active?.kind !== "running" || active.frame.kind !== "assign" || !active.expanded || !initialized || !assignmentApplied(ctx))
      return {
        block: true, reason: "Managed Tribunus implementation tools require this generation's settled native initialization and bounded assignment."
      };
    if (!["read", "grep", "find", "ls", "legion_engineering", "legion_centurio"].includes(event.toolName))
      return {
        block: true, reason: "Legatus engineering approval is required before tests or implementation. Only reads are currently authorized."
      };
    contractTracker?.captureRead(event);
  });
  pi.on("tool_result", event => { centuriones?.observeInput(event); });
  pi.on("tool_execution_end", (event, ctx) => {
    centuriones?.observeLaunch(event, ctx);
    if (event.toolName === "subagent") for (const activity of pendingChildActivity.splice(0)) observeChildActivity(activity.kind, activity.raw, false);
    const effect = effects.get(event.toolCallId);
    if (effect?.execution !== "admitted") return;
    const reason = "Native execution did not start. The ordinary tool pipeline ended this call after admission.";
    observeEffect(event.toolCallId, { kind: event.isError ? "refused" : "unknown", reason, evidence: effectEvidence(event.toolCallId, { kind: "tool-pipeline-end", isError: event.isError, result: event.result }) });
  });
  pi.on("agent_settled", async (_event, ctx) => {
    publishContract(ctx);
    if (pendingSettlement) { resumeSettlement(pendingSettlement.report.command); return; }
    if (continuation) {
      if (decision?.state.kind === "decided" && decision.id === waiting?.requestKey && continuation.command === decision.state.delivery.command && address && incarnation(ctx) && continuation.expanded && !ctx.hasPendingMessages()) {
        const assistant = ctx.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "assistant").at(-1);
        if (assistant?.type === "message" && assistant.message.role === "assistant" && assistant.message.stopReason !== "toolUse") {
          const engineering = engineeringResult(decision, [...effects.values()].map(effect => effect.record), [...deliveredDecisions.values()]);
          const outcome = assistant.message.stopReason !== "stop" ? "failed" : decision.state.decision.kind !== "approve" ? "blocked" : "reported-result";
          settleAssignment(WorkerReport.parse({
            address, command: decision.pin.assignment, outcome,
            assistantText: assistant.message.content.filter(part => part.type === "text").map(part => part.text).join("\n").slice(0, 4000),
            evidence: [`${journal}#${assistant.id}`, receipt(decision.state.delivery.command, "engineering-applied"), ...unknownChildEvidence, ...(centuriones?.evidence ?? [])],
            contract: contractTracker?.snapshot(ctx), engineering,
          }), ctx, decision);
        }
      }
      continuation = null;
      continueWhenIdle();
      return;
    }
    const pending = active;
    if (pending?.kind !== "running" || !address)
      return;
    const branch = ctx.sessionManager.getBranch();
    const user = branch.find((e) => e.type === "message" && e.message.role === "user" && Array.isArray(e.message.content) && e.message.content.some((c) => c.type === "text" && c.text === pending.expanded));
    const assistant = branch.filter((e) => e.type === "message" && e.message.role === "assistant").at(-1);
    if (manual || !incarnation(ctx) || !pending.expanded || !user || !assistant || assistant.type !== "message" || assistant.message.role !== "assistant" || ctx.hasPendingMessages()) {
      pending.resolve(null);
      return;
    }
    if (assistant.message.stopReason !== "stop") {
      if (pending.frame.kind === "assign" && (assistant.message.stopReason === "error" || assistant.message.stopReason === "aborted")) {
        if (!assignmentApplied(ctx)) { pending.resolve(null); return; }
        settleAssignment(WorkerReport.parse({
          address, command: pending.frame.command, outcome: "failed",
          assistantText: `Assignment ${assistant.message.stopReason}. ${assistant.message.errorMessage ?? "No successful completion was observed."}`.slice(0, 4000),
          evidence: [`${journal}#${assistant.id}`, ...unknownChildEvidence, ...(centuriones?.evidence ?? [])], contract: contractTracker?.snapshot(ctx)
        }), ctx);
        active = null;
      }
      pending.resolve(null);
      return;
    }
    if (pending.frame.kind === "initialize") {
      const skill = pi.getCommands().find((c) => c.name === "skill:poteto-mode" && c.source === "skill");
      const mode = branch.find((e) => e.type === "custom" && e.customType === "pstack-mode" && !pending.priorMode.has(e.id) && z.object({
        enabled: z.literal(true)
      }).safeParse(e.data).success);
      if (!skill || !mode || (await resources(ctx)).diagnostics.some((d) => d.status !== "ready")) {
        pending.resolve(null);
        return;
      }
      pi.appendEntry("legion-tribunus-settled", { command: pending.frame.command, generation: address.generation, outcome: "initialized" });
      const settlement = ctx.sessionManager.getLeafId();
      const proof = Initialization.parse({
        command: pending.frame.command, address, nativePrompt: pending.expanded, skillPath: skill.sourceInfo.path, modeEntry: `${journal}#${mode.id}`, settledEntry: `${journal}#${settlement}`
      });
      publish(receipt(pending.frame.command, "applied"), proof);
      initialized = proof;
      ctx.ui.setStatus("legion-intake", "Tribunus initialized. Awaiting bounded assignment.");
      active = null;
      pending.resolve(proof);
    }
    else {
      if (!assignmentApplied(ctx)) { pending.resolve(null); return; }
      if (waiting) {
        active = null;
        pending.resolve({ application: `${journal}#${user.id}` });
        ctx.ui.setStatus("legion-intake", "Tribunus waiting for the Legatus engineering decision. Mutation locked.");
        continueWhenIdle();
        return;
      }
      const application = { application: `${journal}#${user.id}` };
      const text = assistant.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, 4000);
      settleAssignment(WorkerReport.parse({
        address, command: pending.frame.command, outcome: "reported-result", assistantText: text, evidence: [`${journal}#${assistant.id}`, ...unknownChildEvidence, ...(centuriones?.evidence ?? [])], contract: contractTracker?.snapshot(ctx)
      }), ctx);
      active = null;
      pending.resolve(application);
    }
  });
  pi.on("session_shutdown", () => { manual = true; server?.close(); centuriones?.dispose(); for (const unsubscribe of childEventSubscriptions) unsubscribe(); });
}
