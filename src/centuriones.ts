import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolExecutionEndEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { BoundedAssignment, WorkerAddress, CenturioView, CenturioObservation } from "./tribunus.js";
import { privateFile, publish } from "./private-evidence.js";
import { Reservation } from "./assignments.js";
import { LegacyCenturioIntent } from "./centurio-legacy.js";
import { verifyCenturioWorkspace } from "./centurio-workspace.js";

export const CenturioRequest = z.strictObject({
  purpose: z.enum(["exploration", "review", "implementation"]), agent: z.string().min(1), task: z.string().min(1),
  baseRef: z.string().startsWith("refs/heads/"), baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
});
const OwnedNativeIntent = z.strictObject({
  kind: z.literal("owned-native"), id: z.uuid(), owner: WorkerAddress,
  assignment: z.strictObject({ command: z.uuid(), value: BoundedAssignment }),
  authority: z.strictObject({ owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() }),
  purpose: CenturioRequest.shape.purpose, agent: z.string(), task: z.string(), cwd: z.string(),
  writable: z.strictObject({ parentCwd: z.string(), workspace: Reservation }),
});
export type NativeCenturioIntent = z.infer<typeof OwnedNativeIntent>;
export const CenturioIntent = z.union([OwnedNativeIntent, LegacyCenturioIntent]);
export const CenturioRecord = z.strictObject({ intent: CenturioIntent, digest: z.string() });
export const CenturioBinding = z.strictObject({ path: z.string(), digest: z.string() });
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function readCenturio(binding: z.infer<typeof CenturioBinding>) {
  const record = CenturioRecord.parse(privateFile(binding.path));
  if (record.digest !== binding.digest || digest(record.intent) !== record.digest) throw new Error("Centurio binding differs from its retained intent.");
  return record;
}
export function nativeChildInput(record: { intent: z.infer<typeof OwnedNativeIntent> }) {
  const intent = record.intent;
  return { agent: intent.agent, task: `${intent.task}\n\nBounded parent assignment: ${JSON.stringify(intent.assignment.value)}\nNo integration, publication, acceptance or cleanup authority.`, async: true, cwd: intent.cwd, worktree: false, artifacts: true };
}
// pi-subagents 0.77.0 action dispatch: these actions do not execute children.
const NativeInspectionActions = new Set(["list", "get", "models", "children.list", "guide", "validate", "status", "debug.run", "doctor", "mission.list", "mission.show", "lane.status", "refine.show", "inspector.command", "inspector.status", "project.status", "command.status", "watchdog.status", "watchdog.check", "watchdog.recommend-model", "schedule.list", "schedule.show", "schedule.history"]);
const NativeSettingsActions = new Set(["create", "update", "delete", "eject", "disable", "enable", "reset", "grant-spawn-budget", "watchdog.configure"]);
const NativeControlActions = new Set(["stop", "interrupt", "steer", "command.yield", "command.cancel"]);
const NativeAction = z.object({ action: z.string().optional() });
const NativeControl = z.object({
  id: z.string().min(1).optional(), runId: z.string().min(1).optional(), dir: z.never().optional(),
  index: z.literal(0).optional(), mode: z.literal("steer").optional(), steeringRecovery: z.literal(false).optional(),
  options: z.object({ index: z.literal(0).optional(), dir: z.never().optional(), mode: z.literal("steer").optional(), steeringRecovery: z.literal(false).optional() }).optional(),
});
const NativeProcessIdentity = z.object({ version: z.literal(1), runId: z.string().min(1), runnerProcessInstanceId: z.string().min(1), state: z.enum(["pending", "observed", "unknown", "not-started"]) });
// The launcher publishes identity before cwd/journal; the fresh journal may later be top-level.
const NativeStatus = z.object({
  lifecycleArtifactVersion: z.literal(3), runId: z.string().min(1), sessionId: z.string().min(1).optional(), cwd: z.string().min(1).optional(), mode: z.literal("single"),
  state: z.enum(["running", "queued", "complete", "failed", "stopped", "paused", "timeout", "rejected", "partial"]), currentStep: z.literal(0), sessionFile: z.string().min(1).optional(),
  steps: z.array(z.object({ agent: z.string().min(1), sessionFile: z.string().min(1).optional(), processTerminal: NativeProcessIdentity.optional() })).length(1),
  processTerminal: NativeProcessIdentity.optional(),
});
const ProcessInstance = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("runner"), processInstanceId: z.string().min(1), closeObservedAt: z.number(), exitCode: z.int().nullable(), signal: z.string().nullable(), attempt: z.never().optional() }).passthrough(),
  z.object({ kind: z.literal("pi-writer"), processInstanceId: z.string().min(1), closeObservedAt: z.number(), exitCode: z.int().nullable(), signal: z.string().nullable(), attempt: z.int().nonnegative(),
    processTree: z.object({ state: z.literal("observed"), mechanism: z.literal("posix-process-group"), processGroupId: z.int().positive(), verifiedAt: z.number() }) }).passthrough(),
]);
const ProcessProof = z.discriminatedUnion("state", [
  NativeProcessIdentity.extend({ state: z.literal("pending") }),
  NativeProcessIdentity.extend({ state: z.literal("unknown") }),
  NativeProcessIdentity.extend({ state: z.literal("not-started") }),
  NativeProcessIdentity.extend({ state: z.literal("observed"), observedAt: z.number(), instances: z.array(ProcessInstance).min(1) }).passthrough(),
]);
const ChildEvent = z.object({ type: z.string(), subagentSource: z.literal("child"), subagentRunId: z.string(), subagentStepIndex: z.literal(0), subagentAgent: z.string() }).passthrough();
class NativeMismatch extends Error {}
class PublicationPending extends Error {}
type Owned = { record: { intent: z.infer<typeof OwnedNativeIntent>; digest: string }; path: string; input: ReturnType<typeof nativeChildInput>; context: ExtensionContext };

/** Assignment-level launch association only. Native tools and permissions are not replaced or vetoed per child call. */
export class Centuriones {
  readonly evidence = new Set<string>();
  private readonly prepared = new Map<string, Owned>();
  private readonly launched = new Map<string, Owned>();
  private readonly views = new Map<string, z.infer<typeof CenturioView>>();
  private readonly runtimes = new Map<string, { run: string; directory: string; watcher: FSWatcher; runner: string | null; child: { session: string; journal: string } | null; reconciling: boolean; dirty: boolean }>();
  private readonly finalInputs = new Map<string, unknown>();
  private disposed = false;
  private sequence = 0;
  constructor(private pi: ExtensionAPI, private root: string, private owner: z.infer<typeof WorkerAddress>,
    private checkOwner: (intent: z.infer<typeof OwnedNativeIntent>, stage: "launch" | "read", ctx: ExtensionContext) => Promise<void>,
    private onObservation: (command: string) => void = () => {}) {}
  get held() { return [...this.views.values()].some(view => ["unknown", "mismatch", "launch-unresolved", "corroboration-pending"].includes(view.state.kind)); }
  get outstanding() { return [...this.views.values()].some(view => !["prepared", "process-terminal"].includes(view.state.kind)); }
  private project(command: string) {
    publish(join(this.root, `${command}.${++this.sequence}.centuriones.json`), CenturioObservation.parse({ address: this.owner, command, sequence: this.sequence, children: [...this.views.values()] }));
    this.onObservation(command);
  }
  private change(id: string, state: z.infer<typeof CenturioView>["state"]) {
    const view = this.views.get(id);
    if (!view || ["unknown", "mismatch"].includes(view.state.kind) || isDeepStrictEqual(view.state, state)) return;
    view.state = state;
    const owned = [...this.launched.values(), ...this.prepared.values()].find(item => item.record.intent.id === id);
    if (owned) this.project(owned.record.intent.assignment.command);
  }
  prepare(request: z.infer<typeof CenturioRequest>, assignment: z.infer<typeof OwnedNativeIntent>["assignment"], authority: z.infer<typeof OwnedNativeIntent>["authority"], ctx: ExtensionContext, writable: z.infer<typeof OwnedNativeIntent>["writable"], id = randomUUID()) {
    if (ctx.sessionManager.getSessionId() !== this.owner.session) throw new Error("Another principal cannot prepare an owned child.");
    verifyCenturioWorkspace(writable.workspace, writable.parentCwd);
    const intent = OwnedNativeIntent.parse({ kind: "owned-native", id, owner: this.owner, assignment, authority, purpose: request.purpose,
      agent: request.agent, task: request.task, cwd: realpathSync(writable.workspace.plan.path), writable });
    const record = { intent, digest: digest(intent) }, path = join(this.root, `${id}.centurio-intent.json`), input = nativeChildInput(record);
    publish(path, record);
    this.evidence.add(path);
    this.prepared.set(id, { record, path, input, context: ctx });
    this.views.set(id, CenturioView.parse({ id, purpose: intent.purpose, model: "native-configured", state: { kind: "prepared" }, result: null, evidence: [path] }));
    this.project(assignment.command);
    return { kind: "prepared", intent: id, evidence: path, launch: input };
  }
  async admit(event: ToolCallEvent, ctx: ExtensionContext) {
    if (event.toolName === "subagents_enable") return;
    if (event.toolName !== "subagent") return;
    const { action } = NativeAction.parse(event.input);
    if (action && NativeInspectionActions.has(action)) return;
    if (action && NativeSettingsActions.has(action)) return "effect";
    if (action && NativeControlActions.has(action)) {
      const control = NativeControl.parse(event.input);
      const run = control.runId ?? control.id;
      if (!run || control.id && control.runId && control.id !== control.runId) throw new Error("Native control requires one exact owned run identity.");
      if (action === "steer" && (control.steeringRecovery ?? control.options?.steeringRecovery) !== false) throw new Error("Recovery-capable steering is an unsupported launch. Use native steer with steeringRecovery:false and mode:steer for this owned run.");
      const known = [...this.runtimes.entries()].find(([, runtime]) => runtime.run === run);
      const owned = known && [...this.launched.values()].find(item => item.record.intent.id === known[0]);
      if (!owned || this.disposed || ctx.sessionManager.getSessionId() !== this.owner.session || realpathSync(ctx.cwd) !== owned.record.intent.writable.parentCwd) throw new Error("Native control requires the current principal and its exact owned child; foreign children are preserved.");
      await this.checkOwner(owned.record.intent, "read", ctx);
      return;
    }
    if (event.parentToolCallId) throw new Error("Managed child execution requires a fresh assignment-owned prepared launch.");
    const owned = [...this.prepared.values()].find(item => isDeepStrictEqual(item.input, event.input));
    if (!owned) {
      if ([...this.launched.values()].some(item => isDeepStrictEqual(item.input, event.input))) throw new Error("Owned native intent already consumed. No duplicate launch.");
      throw new Error("Managed child execution requires the exact current assignment-owned isolated launch returned by legion_centurio. This launch shape is not prepared/supported.");
    }
    if (this.held || ctx.sessionManager.getSessionId() !== this.owner.session || realpathSync(ctx.cwd) !== owned.record.intent.writable.parentCwd) throw new Error("Owned child launch requires current principal and reconciled children.");
    verifyCenturioWorkspace(owned.record.intent.writable.workspace, owned.record.intent.writable.parentCwd);
    await this.checkOwner(owned.record.intent, "launch", ctx);
    if (this.disposed || !this.prepared.has(owned.record.intent.id)) throw new Error("Owned native launch changed during admission.");
    publish(join(this.root, `${owned.record.intent.id}.centurio-launch.json`), { call: event.toolCallId, input: event.input, intent: owned.record.intent.id, digest: owned.record.digest });
    this.prepared.delete(owned.record.intent.id);
    this.launched.set(event.toolCallId, owned);
    this.change(owned.record.intent.id, { kind: "launch-unresolved" });
  }
  observeInput(event: ToolResultEvent) {
    if (!this.launched.has(event.toolCallId)) return;
    this.finalInputs.set(event.toolCallId, structuredClone(event.input));
  }
  observeLaunch(event: ToolExecutionEndEvent, _ctx: ExtensionContext) {
    const owned = this.launched.get(event.toolCallId);
    if (!owned) return;
    const id = owned.record.intent.id;
    try {
      if (event.isError || !isDeepStrictEqual(this.finalInputs.get(event.toolCallId), owned.input)) throw new Error("Native launch refused or final input unavailable/mismatched; preserve this intent.");
      const native = z.object({ details: z.object({ runId: z.string(), asyncDir: z.string() }) }).parse(event.result).details;
      if ([...this.runtimes.values()].some(runtime => runtime.run === native.runId)) throw new NativeMismatch("Native run already associated with another intent.");
      const directory = realpathSync(native.asyncDir), watcher = watch(directory, () => this.reconcile(id));
      watcher.unref();
      this.runtimes.set(id, { run: native.runId, directory, watcher, runner: null, child: null, reconciling: false, dirty: false });
      this.reconcile(id);
    } catch (error) { this.change(id, { kind: error instanceof NativeMismatch ? "mismatch" : "unknown", reason: String(error) }); }
  }
  observeActivity(_kind: "started" | "complete", raw: unknown): "owned" | "pending" | "unknown" {
    const parsed = z.object({ id: z.string(), runId: z.string().optional(), sessionId: z.string(), cwd: z.string(), asyncDir: z.string(), agent: z.string() }).safeParse(raw);
    if (!parsed.success) return "unknown";
    const activity = parsed.data, run = activity.runId ?? activity.id;
    const known = [...this.runtimes.entries()].find(([, runtime]) => runtime.run === run);
    if (!known) return [...this.launched.values()].some(item => this.views.get(item.record.intent.id)?.state.kind === "launch-unresolved" && activity.agent === item.record.intent.agent && activity.cwd === item.record.intent.cwd) ? "pending" : "unknown";
    const [id, runtime] = known, owned = [...this.launched.values()].find(item => item.record.intent.id === id);
    if (!owned || ![this.owner.session, owned.context.sessionManager.getSessionFile()].includes(activity.sessionId) || activity.cwd !== owned.record.intent.cwd || realpathSync(activity.asyncDir) !== runtime.directory || activity.agent !== owned.record.intent.agent) {
      this.change(id, { kind: "mismatch", reason: "Native activity does not join exact owner/run/workspace." }); return "unknown";
    }
    this.reconcile(id);
    return "owned";
  }
  private observed(id: string) {
    const owned = [...this.launched.values()].find(item => item.record.intent.id === id), runtime = this.runtimes.get(id);
    if (!owned || !runtime) throw new PublicationPending("Native launch identity is unavailable.");
    const path = join(runtime.directory, "status.json");
    if (!existsSync(path)) throw new PublicationPending("Native status publication is missing.");
    const status = NativeStatus.parse(JSON.parse(readFileSync(path, "utf8"))), step = status.steps[0];
    if (!step || status.runId !== runtime.run || status.sessionId !== undefined && ![this.owner.session, owned.context.sessionManager.getSessionFile()].includes(status.sessionId) || status.cwd !== undefined && status.cwd !== owned.record.intent.cwd || step.agent !== owned.record.intent.agent) throw new NativeMismatch("Native status does not join exact owner/run/workspace.");
    for (const process of [status.processTerminal, step.processTerminal]) {
      if (!process) continue;
      if (process.runId !== runtime.run || runtime.runner !== null && runtime.runner !== process.runnerProcessInstanceId) throw new NativeMismatch("Native runner instance changed.");
      runtime.runner = process.runnerProcessInstanceId;
      if (process.state === "unknown") throw new Error("Native process effects are unknown.");
    }
    const proofPath = join(runtime.directory, "process-terminal.json");
    if (existsSync(proofPath)) {
      const proof = ProcessProof.parse(JSON.parse(readFileSync(proofPath, "utf8")));
      if (proof.runId !== runtime.run || runtime.runner !== null && runtime.runner !== proof.runnerProcessInstanceId) throw new NativeMismatch("Native process proof identifies another runner.");
      if (proof.state === "observed" && (proof.instances.filter(instance => instance.kind === "runner").length !== 1 || proof.instances.find(instance => instance.kind === "runner")?.processInstanceId !== proof.runnerProcessInstanceId)) throw new NativeMismatch("Native process closure does not identify its published runner.");
      if (proof.state === "unknown") throw new Error("Native process effects are unknown; preserve this hold.");
    }
    if (step.sessionFile && status.sessionFile && step.sessionFile !== status.sessionFile) throw new NativeMismatch("Native status publishes conflicting child journals.");
    const journal = step.sessionFile ?? status.sessionFile;
    if (!status.sessionId || !status.cwd || !journal) throw new PublicationPending("Native startup identity is not fully published; awaiting owner/workspace/child journal corroboration.");
    return { owned, runtime, status, journal };
  }
  private childSettlement({ directory, run, agent }: { directory: string; run: string; agent: string }) {
    const path = join(directory, "events.jsonl");
    if (!existsSync(path)) throw new PublicationPending("Native child event evidence is missing; no absence of effects inferred.");
    const bytes = readFileSync(path, "utf8");
    if (!bytes.endsWith("\n")) throw new PublicationPending("Native child event publication incomplete.");
    const calls = new Set<string>();
    let started = false, settled = false;
    for (const line of bytes.trimEnd().split("\n")) {
      const raw: unknown = JSON.parse(line), parsed = ChildEvent.safeParse(raw);
      if (!parsed.success) {
        if (z.object({ subagentSource: z.literal("child") }).safeParse(raw).success) throw new Error("Malformed native child event evidence.");
        continue;
      }
      const event = parsed.data;
      if (event.subagentRunId !== run || event.subagentAgent !== agent) throw new NativeMismatch("Native child event belongs to another run/agent.");
      if (event.type === "agent_start") { started = true; settled = false; }
      if (event.type === "agent_settled") settled = true;
      if (event.type === "tool_execution_start") {
        const call = z.object({ toolCallId: z.string() }).parse(event);
        if (calls.has(call.toolCallId)) throw new Error("Duplicate native tool start is ambiguous.");
        calls.add(call.toolCallId);
      }
      if (event.type === "tool_execution_end") {
        const call = z.object({ toolCallId: z.string(), isError: z.boolean(), durationMs: z.number().optional(), result: z.unknown() }).parse(event);
        if (!calls.delete(call.toolCallId)) throw new Error("Native tool end has no corresponding start.");
        const exit = z.object({ structuredContent: z.object({ exit_code: z.int() }) }).safeParse(call.result);
        if (call.isError && call.durationMs !== undefined && !exit.success) throw new Error("Native executed tool failure has unknown effect outcome.");
      }
    }
    if (!started || !settled || calls.size) throw new PublicationPending("Native child settlement or tool outcomes missing. Idle/prose/cancellation is not proof.");
    return { path, sha256: digest(bytes) };
  }
  private reconcile(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime || this.disposed) return;
    runtime.dirty = true;
    if (runtime.reconciling) return;
    runtime.reconciling = true;
    void (async () => {
      try { while (runtime.dirty && !this.disposed) { runtime.dirty = false; await this.reconcileOnce(id); } }
      finally { runtime.reconciling = false; }
    })();
  }
  private async reconcileOnce(id: string) {
    const view = this.views.get(id);
    if (!view || ["process-terminal", "unknown", "mismatch"].includes(view.state.kind)) return;
    try {
      const { owned, runtime, status, journal } = this.observed(id);
      if (!existsSync(journal)) throw new PublicationPending("Native child journal is missing.");
      const header = z.object({ type: z.literal("session"), id: z.string(), cwd: z.string() }).parse(JSON.parse(readFileSync(journal, "utf8").split("\n")[0] ?? "null"));
      if (header.id === this.owner.session || realpathSync(header.cwd) !== owned.record.intent.cwd) throw new NativeMismatch("Native child journal does not join isolated workspace/session.");
      const child = { session: header.id, journal: realpathSync(journal) };
      if (runtime.child && !isDeepStrictEqual(runtime.child, child)) throw new NativeMismatch("Native child session or journal changed within an owned run.");
      runtime.child ??= child;
      const identity = { run: runtime.run, index: 0, session: header.id };
      if (["running", "queued"].includes(status.state)) { this.change(id, { kind: "active", ...identity }); return; }
      if (!["complete", "failed", "stopped", "paused", "timeout"].includes(status.state)) throw new Error("Unrecognized native lifecycle state.");
      const events = this.childSettlement({ directory: runtime.directory, run: runtime.run, agent: owned.record.intent.agent });
      const path = join(runtime.directory, "process-terminal.json");
      if (!existsSync(path)) { this.change(id, { kind: "logical-terminal", ...identity, outcome: status.state }); return; }
      const proof = ProcessProof.parse(JSON.parse(readFileSync(path, "utf8")));
      if (proof.state === "unknown") throw new Error("Native process effects are unknown; preserve this hold.");
      if (proof.runId !== runtime.run || runtime.runner !== null && runtime.runner !== proof.runnerProcessInstanceId) throw new NativeMismatch("Native process proof identifies another runner.");
      if (proof.state !== "observed" || runtime.runner === null) { this.change(id, { kind: "logical-terminal", ...identity, outcome: status.state }); return; }
      if (proof.instances.filter(instance => instance.kind === "runner").length !== 1 || proof.instances.find(instance => instance.kind === "runner")?.processInstanceId !== runtime.runner) throw new NativeMismatch("Native process closure does not identify the observed runner.");
      await this.checkOwner(owned.record.intent, "read", owned.context);
      if (this.disposed || ["unknown", "mismatch"].includes(view.state.kind)) return;
      if (!isDeepStrictEqual(this.observed(id).status, status) || !isDeepStrictEqual(ProcessProof.parse(JSON.parse(readFileSync(path, "utf8"))), proof) || !isDeepStrictEqual(this.childSettlement({ directory: runtime.directory, run: runtime.run, agent: owned.record.intent.agent }), events)) { runtime.dirty = true; return; }
      const evidence = join(this.root, `${id}.centurio-process-terminal.json`);
      publish(evidence, { ...proof, childEvents: events, nativeStatus: status });
      view.evidence.push(evidence);
      this.evidence.add(evidence);
      this.change(id, { kind: "process-terminal", ...identity, outcome: status.state, proof: evidence });
      runtime.watcher.close();
    } catch (error) { this.change(id, { kind: error instanceof NativeMismatch ? "mismatch" : error instanceof PublicationPending ? "corroboration-pending" : "unknown", reason: String(error) }); }
  }
  async terminalReport(command: string) {
    const children: z.infer<typeof CenturioView>[] = [];
    let failed = false;
    for (const owned of this.launched.values()) {
      if (owned.record.intent.assignment.command !== command) continue;
      const view = this.views.get(owned.record.intent.id);
      if (this.disposed || view?.state.kind !== "process-terminal") return null;
      await this.checkOwner(owned.record.intent, "read", owned.context);
      const proof = ProcessProof.parse(privateFile(view.state.proof));
      if (proof.state !== "observed" || this.disposed) return null;
      failed ||= view.state.outcome !== "complete" || proof.instances.some(instance => instance.exitCode !== 0 || instance.signal !== null);
      children.push(structuredClone(view));
    }
    return { children, failed };
  }
  dispose() { this.disposed = true; for (const runtime of this.runtimes.values()) runtime.watcher.close(); }
}
