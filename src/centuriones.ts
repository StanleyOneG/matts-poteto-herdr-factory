import { ResearchOwner, ResearchObservation } from "./owned-children.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, openSync, closeSync, fsyncSync, watch, type FSWatcher } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolCallEvent, type ToolExecutionEndEvent, type ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { registerAgentViaEvents } from "pi-subagents/agents";
import { registerRequiredChildExtensions } from "pi-subagents/required-child-extensions";
import { BoundedAssignment, WorkerAddress, CenturioView, CenturioObservation } from "./tribunus.js";
import { privateFile, publish } from "./private-evidence.js";
import { Reservation } from "./assignments.js";
import { EngineeringRecord, EffectMessage, EffectReply } from "./snapshot.js";
import { verifyCenturioWorkspace } from "./centurio-workspace.js";

export const CenturioRequest = z.strictObject({
  purpose: z.enum(["exploration", "review", "implementation"]),
  role: z.enum(["how explorer", "why investigators", "interrogate reviewers", "arena cross-judge pool", "feature, refactoring", "bug-fix", "perf-issue", "hardest tasks"]),
  modelIndex: z.int().nonnegative().default(0), task: z.string().min(1), timeoutMs: z.int().positive().optional(),
  baseRef: z.string().startsWith("refs/heads/").optional(), baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).optional(),
});
const Role = z.strictObject({ name: CenturioRequest.shape.role, index: z.int().nonnegative(), selector: z.string(), model: z.string(), configuration: z.string(), digest: z.string(), parentModel: z.string() });
const IntentFields = {
  id: z.uuid(),
  authority: z.strictObject({ owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() }),
  purpose: CenturioRequest.shape.purpose, role: Role, cwd: z.string(), task: z.string(), timeoutMs: z.int().positive().optional(),
  writable: z.strictObject({ parentCwd: z.string(), workspace: Reservation, engineering: EngineeringRecord, seam: EngineeringRecord }).optional(),
  agent: z.string(), definitionDigest: z.string(), endpoint: z.string(), capability: z.string(),
};
export const CenturioIntent = z.union([
  z.strictObject({ ...IntentFields, owner: WorkerAddress, assignment: z.strictObject({ command: z.uuid(), value: BoundedAssignment }) }),
  z.strictObject({ ...IntentFields, owner: ResearchOwner, assignment: z.strictObject({ command: z.uuid(), research: z.literal("preparatory-read-only"), value: z.never().optional() }), purpose: z.literal("exploration"), writable: z.never().optional() }),
]);
export const CenturioRecord = z.strictObject({ intent: CenturioIntent, digest: z.string() });
export const CenturioBinding = z.strictObject({ path: z.string(), digest: z.string() });
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const definition = {
  description: "An owned read-only Legion Centurio",
  systemPrompt: "You own only the bound exploration or review assignment. Read and return findings. Do not mutate files, execute commands, delegate, assume graph ownership, or claim acceptance. Your mandatory Legion guard verifies the owner and runtime before work.",
  tools: ["read", "grep", "find", "ls"], allowNestedSubagents: false,
};
const writableDefinition = {
  description: "An owned bounded implementation Legion Centurio",
  systemPrompt: "Own only this bounded implementation in its retained workspace. Matt TDD is primary; pstack supplements it. Read the actual selected matt-tdd and its tests.md/mocking.md and poteto-mode resources before mutations. Follow the supplied approved seam/exception; never self-approve omissions. Return exact verification and result references. No delegation, graph ownership, integration, publication or cleanup. Bash retains normal permissions and is not filesystem confinement.",
  tools: ["read", "grep", "find", "ls", "write", "edit", "bash"], allowNestedSubagents: false, inheritSkills: true,
};
function resolveRole(request: z.infer<typeof CenturioRequest>, ctx: ExtensionContext) {
  const allowed = request.purpose === "implementation" ? ["feature, refactoring", "bug-fix", "perf-issue", "hardest tasks"] : request.purpose === "exploration" ? ["how explorer", "why investigators"] : ["interrogate reviewers", "arena cross-judge pool"];
  if (!allowed.includes(request.role)) throw new Error("The selected pstack role does not match the child purpose.");
  if (!ctx.model) throw new Error("The owning principal's actual model is unavailable.");
  const configuration = join(getAgentDir(), "pstack", "models.json");
  const bytes = existsSync(configuration) ? readFileSync(configuration, "utf8") : null;
  const config = z.object({ version: z.literal(1), roles: z.record(z.string(), z.union([z.string(), z.array(z.string()).nonempty()])) }).parse(bytes === null ? { version: 1, roles: {} } : JSON.parse(bytes));
  const configured = config.roles[request.role] ?? "inherit-parent";
  const selectors = Array.isArray(configured) ? configured : [configured];
  const selector = selectors[request.modelIndex];
  if (!selector) throw new Error("The configured pstack role has no model at this index. No fallback.");
  const parentModel = `${ctx.model.provider}/${ctx.model.id}`;
  const model = ["auto", "inherit-parent"].includes(selector) ? parentModel : selector;
  if (!ctx.modelRegistry.getAvailable().some(candidate => `${candidate.provider}/${candidate.id}` === model)) throw new Error(`Configured role model ${model} is unavailable or restricted. No fallback.`);
  return Role.parse({ name: request.role, index: request.modelIndex, selector, model, parentModel, configuration, digest: digest(bytes) });
}
export function nativeChildInput(record: z.infer<typeof CenturioRecord>, path: string) {
  const intent = record.intent;
  return {
    agent: intent.agent, task: intent.writable && intent.assignment.value ? `${intent.task}\n\nRecorded engineering authority (not child approval authority): ${JSON.stringify({ assignment: intent.assignment.command, task: intent.assignment.value.task, scope: intent.assignment.value.scope, engineering: { id: intent.writable.engineering.id, digest: intent.writable.engineering.digest, proposal: intent.writable.engineering.proposal, state: intent.writable.engineering.state }, approvedSeam: { id: intent.writable.seam.id, digest: intent.writable.seam.digest, proposal: intent.writable.seam.proposal }, policy: "Matt TDD is primary; pstack supplements it. Only the recorded omitted-test exception, if any, applies; preserve its rationale and exact alternative verification. No delegation or graph ownership." })}` : intent.task, async: true, context: "fresh", cwd: intent.cwd, model: intent.role.model,
    worktree: false, artifacts: true, ...(intent.timeoutMs === undefined ? {} : { timeoutMs: intent.timeoutMs }),
    extensionBindings: { "pi-legion/1": { path, digest: record.digest } },
  };
}
export function readCenturio(binding: z.infer<typeof CenturioBinding>) {
  const record = CenturioRecord.parse(privateFile(binding.path));
  if (record.digest !== binding.digest || digest(record.intent) !== record.digest) throw new Error("Centurio binding does not match the durable intent.");
  return record;
}
class NativeMismatch extends Error {}
class PublicationPending extends Error {}
const NativeActivity = z.object({
  id: z.string().min(1), runId: z.string().min(1).optional(), sessionId: z.string().min(1), completionOwnerId: z.string().min(1),
  asyncDir: z.string().min(1), cwd: z.string().min(1), mode: z.literal("single"), agent: z.string().min(1), sessionFile: z.string().optional(),
  results: z.array(z.object({ agent: z.string(), sessionFile: z.string(), model: z.string(), requestedModel: z.string(), context: z.string() })).optional(),
});

export class Centuriones {
  private agentRegistration: { dispose(): void } | null = null;
  private guardRegistration: { dispose(): void } | null = null;
  readonly evidence = new Set<string>();
  private readonly agent: string;
  private readonly nativeOwner: string;
  private writableRegistration: { dispose(): void } | null = null;
  private readonly views = new Map<string, z.infer<typeof CenturioView>>();
  private readonly runtimes = new Map<string, { run: string; directory: string; watcher: FSWatcher; context: ExtensionContext; child: Omit<z.infer<typeof CenturioCheck>, "stage"> | null; runner: string | null; completionOwner: string | null; activities: z.infer<typeof NativeActivity>[]; reconciling: boolean; dirty: boolean }>();
  private readonly children = new Map<string, Omit<z.infer<typeof CenturioCheck>, "stage">>();
  private readonly finalInputs = new Map<string, unknown>();
  private readonly childEffects = new Map<string, { child: string; digest: string }>();
  private sequence = 0;
  private disposed = false;
  private readonly prepared = new Map<string, { record: z.infer<typeof CenturioRecord>; path: string }>();
  private readonly launched = new Map<string, { record: z.infer<typeof CenturioRecord>; path: string; input: ReturnType<typeof nativeChildInput>; context: ExtensionContext }>();
  get held() { return [...this.views.values()].some(view => ["unknown", "mismatch", "launch-unresolved", "corroboration-pending"].includes(view.state.kind)); }
  get outstanding() { return [...this.views.values()].some(view => !["prepared", "process-terminal"].includes(view.state.kind)); }
  private project(command: string) {
    const observation = "role" in this.owner
      ? ResearchObservation.parse({ kind: "research-observation", owner: this.owner, command, sequence: ++this.sequence, children: [...this.views.values()] })
      : CenturioObservation.parse({ address: this.owner, command, sequence: ++this.sequence, children: [...this.views.values()] });
    publish(join(this.root, `${command}.${this.sequence}.centuriones.json`), observation);
    if ("role" in this.owner) this.onObservation(command, observation);
  }
  private change(id: string, state: z.infer<typeof CenturioView>["state"]) {
    const view = this.views.get(id);
    if (!view || ["unknown", "mismatch"].includes(view.state.kind) || isDeepStrictEqual(view.state, state)) return;
    view.state = state;
    const intent = [...this.launched.values()].find(item => item.record.intent.id === id)?.record.intent ?? this.prepared.get(id)?.record.intent;
    if (intent) {
      this.project(intent.assignment.command);
      if (!("role" in this.owner)) this.onObservation(intent.assignment.command);
    }
  }
  async terminalReport(command: string) {
    const owned = [...this.launched.values()].filter(item => item.record.intent.assignment.command === command);
    const sequence = this.sequence;
    const children: z.infer<typeof CenturioView>[] = [];
    let failed = false;
    for (const item of owned) {
      const view = this.views.get(item.record.intent.id);
      if (this.disposed || !view || view.state.kind !== "process-terminal" || !view.result) return null;
      await this.checkOwner(item.record.intent, "launch", item.context);
      if (this.disposed || this.sequence !== sequence) return null;
      const proof = ProcessProof.parse(privateFile(view.state.proof));
      if (proof.state !== "observed") return null;
      // A closed runner is not implementation success; retain the actual lifecycle outcome.
      failed ||= view.state.outcome !== "complete" || proof.instances.some(instance => instance.exitCode !== 0 || instance.signal !== null);
      children.push(structuredClone(view));
    }
    return { children, failed };
  }
  constructor(private pi: ExtensionAPI, private root: string, private owner: z.infer<typeof WorkerAddress> | z.infer<typeof ResearchOwner>, private endpoint: string, private capability: string, private checkOwner: (intent: z.infer<typeof CenturioIntent>, stage: "launch" | "read", ctx: ExtensionContext) => Promise<void>, private onObservation: (command: string, observation?: z.infer<typeof ResearchObservation> | z.infer<typeof CenturioObservation>) => void = () => {}) {
    this.agent = `legion-centurio-${owner.generation}`;
    const native = pi.getAllTools().find(tool => tool.name === "subagent");
    if (!native || native.exposure !== "model-only") throw new Error("Owned children require the ordinary model-only native subagent tool.");
    this.nativeOwner = native.sourceInfo.path;
    try {
      this.guardRegistration = registerRequiredChildExtensions({ sessionId: owner.session, extensions: [{ id: "pi-legion-centurio", path: fileURLToPath(new URL("./centurio-guard.ts", import.meta.url)) }], requireForAllRunners: true });
      this.agentRegistration = registerAgentViaEvents({ pi, name: this.agent, definition });
      this.writableRegistration = registerAgentViaEvents({ pi, name: `${this.agent}-implementation`, definition: writableDefinition });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  validateRequest(request: z.infer<typeof CenturioRequest>, ctx: ExtensionContext) {
    resolveRole(request, ctx);
  }
  prepare(request: z.infer<typeof CenturioRequest>, assignment: z.infer<typeof CenturioIntent>["assignment"], authority: z.infer<typeof CenturioIntent>["authority"], ctx: ExtensionContext, writable?: z.infer<typeof CenturioIntent>["writable"], id: string = randomUUID()) {
    if (request.purpose === "implementation" && !writable) throw new Error("Implementation Centuriones require a retained writable workspace and child-local effect admission.");
    if (ctx.sessionManager.getSessionId() !== this.owner.session) throw new Error("The Centurio intent belongs to another principal session.");
    const intent = CenturioIntent.parse({ id, owner: this.owner, assignment, authority, purpose: request.purpose, role: resolveRole(request, ctx), cwd: writable ? realpathSync(writable.workspace.plan.path) : realpathSync(ctx.cwd), ...(writable ? { writable } : {}), task: request.task, ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }), agent: writable ? `${this.agent}-implementation` : this.agent, definitionDigest: digest(writable ? writableDefinition : definition), endpoint: this.endpoint, capability: this.capability });
    const record = CenturioRecord.parse({ intent, digest: digest(intent) });
    const path = join(this.root, `${intent.id}.centurio-intent.json`);
    publish(path, record);
    this.evidence.add(path);
    this.prepared.set(intent.id, { record, path });
    this.views.set(intent.id, CenturioView.parse({ id: intent.id, purpose: intent.purpose, model: intent.role.model, state: { kind: "prepared" }, result: null, evidence: [path] }));
    this.project(assignment.command);
    return { kind: "prepared", intent: intent.id, evidence: path, launch: nativeChildInput(record, path) };
  }
  async admit(event: ToolCallEvent, ctx: ExtensionContext) {
    if (event.parentToolCallId || piToolOwner(this.pi) !== this.nativeOwner || ctx.sessionManager.getSessionId() !== this.owner.session) throw new Error("Native child preparation requires the owning principal and unchanged root tool.");
    if (event.toolName === "subagents_enable") {
      const loader = this.pi.getAllTools().find(tool => tool.name === "subagents_enable");
      if (loader?.exposure !== "model-only" || loader.sourceInfo.path !== this.nativeOwner || !isDeepStrictEqual(event.input, {})) throw new Error("Only the unchanged native loader with empty input is allowed.");
      return;
    }
    if (event.toolName !== "subagent") throw new Error("Not a native child tool.");
    if (isDeepStrictEqual(event.input, { action: "list", capabilities: true })) return;
    if (this.held || this.launched.has(event.toolCallId)) throw new Error("Native child launch requires a fresh root call and reconciled owned children.");
    const match = [...this.prepared.values()].find(item => isDeepStrictEqual(nativeChildInput(item.record, item.path), event.input));
    if (!match) throw new Error("Native child input differs from every exact durable intent. No launch.");
    if (piToolOwner(this.pi) !== this.nativeOwner || ctx.sessionManager.getSessionId() !== this.owner.session || realpathSync(ctx.cwd) !== (match.record.intent.writable?.parentCwd ?? match.record.intent.cwd)) throw new Error("Native child tool ownership or principal changed.");
    const role = resolveRole(CenturioRequest.parse({ purpose: match.record.intent.purpose, role: match.record.intent.role.name, modelIndex: match.record.intent.role.index, task: match.record.intent.task }), ctx);
    if (!isDeepStrictEqual(role, match.record.intent.role)) throw new Error("Configured role/model changed after child preparation.");
    const journal = ctx.sessionManager.getSessionFile();
    if (!journal) throw new Error("Native root journal unavailable.");
    const Message = z.object({ id: z.string(), type: z.literal("message"), message: z.object({ role: z.literal("assistant"), content: z.array(z.unknown()) }) });
    const Call = z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.unknown() });
    const persisted = readFileSync(journal, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    const branch = ctx.sessionManager.getBranch();
    const calls = persisted.flatMap(entry => {
      const parsed = Message.safeParse(entry);
      if (!parsed.success || !branch.some(item => item.id === parsed.data.id && isDeepStrictEqual(item, entry))) return [];
      return parsed.data.message.content.filter(part => { const call = Call.safeParse(part); return call.success && call.data.id === event.toolCallId && call.data.name === "subagent" && isDeepStrictEqual(call.data.arguments, event.input); }).map(() => parsed.data.id);
    });
    if (calls.length !== 1 || branch.some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === event.toolCallId)) throw new Error("Exact fresh native root journal provenance is unavailable.");
    const fd = openSync(journal, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    await this.checkOwner(match.record.intent, "launch", ctx);
    const admission = join(this.root, `${match.record.intent.id}.centurio-launch.json`);
    const input = nativeChildInput(match.record, match.path);
    publish(admission, { intent: match.record.intent.id, digest: match.record.digest, call: event.toolCallId, journal: `${journal}#${calls[0]}`, input, state: "launch-unresolved" });
    this.evidence.add(admission);
    this.prepared.delete(match.record.intent.id);
    this.launched.set(event.toolCallId, { ...match, input, context: ctx });
    this.change(match.record.intent.id, { kind: "launch-unresolved" });
  }
  observeInput(event: ToolResultEvent) {
    const owned = this.launched.get(event.toolCallId);
    if (!owned) return;
    this.finalInputs.set(event.toolCallId, structuredClone(event.input));
    if (!isDeepStrictEqual(event.input, owned.input)) this.change(owned.record.intent.id, { kind: "mismatch", reason: "Native final input differs from the admitted child intent." });
  }
  observeLaunch(event: ToolExecutionEndEvent, ctx: ExtensionContext) {
    const owned = this.launched.get(event.toolCallId);
    if (!owned || event.toolName !== "subagent") return;
    const path = join(this.root, `${owned.record.intent.id}.centurio-native-result.json`);
    publish(path, { intent: owned.record.intent.id, digest: owned.record.digest, call: event.toolCallId, isError: event.isError, result: event.result });
    this.evidence.add(path);
    try {
      if (event.isError || !isDeepStrictEqual(this.finalInputs.get(event.toolCallId), owned.input)) throw new Error("Native launch was refused or final input is unavailable/mismatched. Preserve this intent.");
      const native = z.object({ details: z.object({ runId: z.string().min(1), asyncDir: z.string().min(1) }) }).parse(event.result).details;
      const directory = realpathSync(native.asyncDir);
      const watcher = watch(directory, () => this.reconcile(owned.record.intent.id));
      watcher.unref();
      this.runtimes.set(owned.record.intent.id, { run: native.runId, directory, watcher, context: ctx, child: this.children.get(owned.record.intent.id) ?? null, runner: null, completionOwner: null, activities: [], reconciling: false, dirty: false });
      this.reconcile(owned.record.intent.id);
    } catch (error) { this.change(owned.record.intent.id, { kind: "unknown", reason: String(error) }); }
  }
  observeActivity(kind: "started" | "complete", raw: unknown): "owned" | "pending" | "unknown" {
    const parsed = (kind === "complete" ? NativeActivity.extend({ runId: z.string().min(1) }) : NativeActivity).safeParse(raw);
    if (!parsed.success || this.disposed) return "unknown";
    const activity = parsed.data, run = activity.runId ?? activity.id;
    const known = [...this.runtimes.entries()].find(([, runtime]) => runtime.run === run);
    if (!known) {
      const awaiting = [...this.launched.values()].some(({ record, context }) => this.views.get(record.intent.id)?.state.kind === "launch-unresolved" && activity.id === run && activity.agent === record.intent.agent && activity.cwd === record.intent.cwd && [this.owner.session, context.sessionManager.getSessionFile()].includes(activity.sessionId));
      return awaiting ? "pending" : "unknown";
    }
    const [id, runtime] = known;
    runtime.activities.push(activity);
    try { this.observed(id); }
    catch (error) {
      if (!(error instanceof PublicationPending)) {
        this.change(id, { kind: error instanceof NativeMismatch ? "mismatch" : "unknown", reason: String(error) });
        return "unknown";
      }
    }
    const path = join(this.root, `${id}.${digest({ kind, activity })}.centurio-native-activity.json`);
    publish(path, { kind, activity });
    this.evidence.add(path);
    this.reconcile(id);
    return "owned";
  }
  private observed(id: string) {
    const owned = [...this.launched.values()].find(item => item.record.intent.id === id), runtime = this.runtimes.get(id);
    if (!owned || !runtime) throw new Error("Native launch identity has not been independently observed.");
    const path = join(runtime.directory, "status.json");
    if (!existsSync(path)) throw new PublicationPending("Native status publication is pending.");
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const published = NativeStatus.partial().extend({ steps: z.array(NativeStatus.shape.steps.element.partial()).optional() }).parse(raw);
    if (published.runId !== undefined && published.runId !== runtime.run || published.sessionId !== undefined && ![this.owner.session, runtime.context.sessionManager.getSessionFile()].includes(published.sessionId) || published.cwd !== undefined && published.cwd !== owned.record.intent.cwd || published.mode !== undefined && published.mode !== "single" || published.currentStep !== undefined && published.currentStep !== 0) throw new NativeMismatch("Published native identity differs from the admitted intent.");
    const publishedStep = published.steps?.[0], intent = owned.record.intent;
    if (published.steps !== undefined && published.steps.length > 1 || publishedStep && (
      publishedStep.agent !== undefined && publishedStep.agent !== intent.agent ||
      publishedStep.model !== undefined && publishedStep.model !== intent.role.model ||
      publishedStep.requestedModel !== undefined && publishedStep.requestedModel !== intent.role.model ||
      publishedStep.context !== undefined && publishedStep.context !== "fresh" ||
      publishedStep.sessionFile !== undefined && runtime.child !== null && publishedStep.sessionFile !== runtime.child.journal ||
      publishedStep.launchContractDigest !== undefined && published.launchContractDigest !== undefined && publishedStep.launchContractDigest !== published.launchContractDigest
    )) throw new NativeMismatch("Published native step identity differs from the admitted intent.");
    if (published.completionOwnerId !== undefined) {
      if (runtime.completionOwner !== null && published.completionOwnerId !== runtime.completionOwner) throw new NativeMismatch("Native completion owner instance changed.");
      runtime.completionOwner = published.completionOwnerId;
    }
    if (published.processTerminal) {
      if (published.processTerminal.runId !== runtime.run || runtime.runner !== null && runtime.runner !== published.processTerminal.runnerProcessInstanceId) throw new NativeMismatch("Native status runner instance changed.");
      runtime.runner = published.processTerminal.runnerProcessInstanceId;
      if (published.processTerminal.state === "unknown") throw new Error("Native status reports genuinely unknown process effects. Preserve this child hold.");
    }
    const parsed = NativeStatus.safeParse(raw);
    if (!parsed.success) throw new PublicationPending("Native status identity fields are not fully published.");
    const status = parsed.data;
    const step = status.steps[0];
    if (!step || status.steps.length !== 1 || status.currentStep !== 0 || status.mode !== "single" || status.runId !== runtime.run || ![this.owner.session, runtime.context.sessionManager.getSessionFile()].includes(status.sessionId) || status.cwd !== owned.record.intent.cwd || step.agent !== owned.record.intent.agent || step.context !== "fresh" || step.model !== owned.record.intent.role.model || step.requestedModel !== owned.record.intent.role.model || status.launchContractDigest !== step.launchContractDigest || status.launchResolvedExtensions.disableAmbientExtensions || !status.launchResolvedExtensions.required.includes("pi-legion-centurio"))
      throw new NativeMismatch("Observed native run, owner, model, context, agent, or mandatory guard differs from the intent.");
    for (const activity of runtime.activities) {
      if (activity.id !== runtime.run || activity.runId !== undefined && activity.runId !== runtime.run || ![this.owner.session, runtime.context.sessionManager.getSessionFile()].includes(activity.sessionId) || realpathSync(activity.asyncDir) !== runtime.directory || activity.cwd !== intent.cwd || activity.agent !== intent.agent || activity.sessionFile !== undefined && activity.sessionFile !== step.sessionFile || activity.completionOwnerId !== runtime.completionOwner && runtime.completionOwner !== null || activity.results !== undefined && (activity.results.length !== 1 || activity.results.some(result => result.agent !== intent.agent || result.sessionFile !== step.sessionFile || result.model !== intent.role.model || result.requestedModel !== intent.role.model || result.context !== "fresh"))) throw new NativeMismatch("Structured native activity does not join this exact owner, run, child session, and launch.");
      if (runtime.completionOwner === null) throw new PublicationPending("Native completion owner publication is pending.");
    }
    return { owned, runtime, status, step };
  }
  async checkChild(raw: unknown, ctx: ExtensionContext) {
    const { stage, ...check } = CenturioCheck.parse(raw);
    const record = readCenturio(check.binding), intent = record.intent;
    const owned = [...this.launched.values()].find(item => item.record.intent.id === intent.id);
    if (!owned || owned.path !== check.binding.path || record.digest !== owned.record.digest || check.capability !== this.capability || !isDeepStrictEqual(intent.owner, this.owner)) throw new Error("Child does not authenticate this exact owned intent.");
    const view = this.views.get(intent.id);
    if (view && ["unknown", "mismatch", "process-terminal"].includes(view.state.kind)) throw new Error("Owned child is held or terminal. No further child work authorized.");
    try {
    if (intent.writable) verifyCenturioWorkspace(intent.writable.workspace, intent.writable.parentCwd);
    if (check.cwd !== intent.cwd || check.model !== intent.role.model) throw new NativeMismatch("Authenticated child cwd or model differs from its durable intent.");
    const child = this.children.get(intent.id);
    if (check.session === this.owner.session || child && !isDeepStrictEqual(child, check) || [...this.children.entries()].some(([id, other]) => id !== intent.id && (other.session === check.session || other.journal === check.journal))) throw new NativeMismatch("Another child session cannot adopt an owned intent.");
    if (this.runtimes.has(intent.id)) {
      try {
        const { status, step } = this.observed(intent.id);
        if (check.journal !== step.sessionFile || !["running", "queued"].includes(status.state)) throw new NativeMismatch("Native child session differs or is no longer active.");
      } catch (error) { if (stage !== "startup" || !(error instanceof PublicationPending)) throw error; }
    } else if (stage === "effect") throw new Error("Native launch corroboration is pending. No child effects authorized.");
    if (stage === "effect") this.corroborate(check, intent);
    await this.checkOwner(intent, "read", ctx);
    const startup = join(this.root, `${intent.id}.centurio-startup.json`);
    publish(startup, { kind: "startup-authorized", corroboration: "pending", child: check, owner: this.owner });
    this.evidence.add(startup);
    this.children.set(intent.id, check);
    const runtime = this.runtimes.get(intent.id);
    if (runtime) runtime.child = check;
    this.change(intent.id, { kind: "corroboration-pending", reason: "Actual startup identity is authorized; persisted journal and native package join remain required." });
    if (stage === "effect") this.reconcile(intent.id);
    return { kind: "centurio-authorized", digest: record.digest, session: check.session, ...(intent.writable && runtime ? { run: runtime.run } : {}) };
    } catch (error) {
      this.change(intent.id, { kind: error instanceof NativeMismatch ? "mismatch" : error instanceof PublicationPending ? "corroboration-pending" : "unknown", reason: String(error) });
      throw error;
    }
  }
  async childEffect(raw: unknown, ctx: ExtensionContext, relay: (message: z.infer<typeof EffectMessage>, command: string) => Promise<z.infer<typeof EffectReply>>) {
    const request = z.strictObject({ kind: z.literal("centurio-effect"), check: CenturioCheck, message: EffectMessage }).parse(raw);
    if (request.check.stage !== "effect") throw new Error("Child effects require actual current runtime corroboration.");
    await this.checkChild(request.check, ctx);
    const record = readCenturio(request.check.binding), intent = record.intent;
    const runtime = this.runtimes.get(intent.id);
    if (!intent.writable || !runtime || request.message.kind === "centurio-owner-check") throw new Error("This exact owned child has no writable effect authority.");
    const message = request.message;
    if (message.kind === "effect-admission") {
      const effect = message.intent, origin = effect.origin, engineering = intent.writable.engineering;
      if (origin?.kind !== "centurio" || origin.child.id !== intent.id || origin.child.digest !== record.digest || origin.intent !== request.check.binding.path || origin.run !== runtime.run || origin.session !== request.check.session || origin.journal !== request.check.journal || origin.cwd !== intent.cwd || origin.branch !== intent.writable.workspace.plan.branch || origin.base !== intent.writable.workspace.plan.commit || effect.contract.cwd !== intent.cwd || !isDeepStrictEqual(effect.pin, engineering.pin) || engineering.state.kind !== "decided" || !isDeepStrictEqual(effect.decision, { id: engineering.id, digest: engineering.digest, command: engineering.state.delivery.command })) throw new Error("Child effect does not bind the exact workspace, runtime and applied engineering decision.");
      const [journal, entry] = effect.call.journal.split("#");
      const entries: unknown[] = readFileSync(request.check.journal, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
      const calls = entries.filter(raw => {
        const parsed = z.object({ id: z.string(), type: z.literal("message"), message: z.object({ role: z.literal("assistant"), content: z.array(z.unknown()) }) }).safeParse(raw);
        return parsed.success && parsed.data.id === entry && parsed.data.message.content.some(part => {
          const call = z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.unknown() }).safeParse(part);
          return call.success && call.data.id === effect.call.id && call.data.name === effect.call.name && isDeepStrictEqual(call.data.arguments, effect.call.rawInput);
        });
      });
      if (journal !== request.check.journal || calls.length !== 1 || entries.some(raw => z.object({ message: z.object({ role: z.literal("toolResult"), toolCallId: z.literal(effect.call.id) }) }).safeParse(raw).success)) throw new Error("Exact fresh child assistant journal provenance is unavailable.");
    }
    if (message.kind === "effect-observation") {
      const admitted = this.childEffects.get(message.id);
      if (admitted?.child !== intent.id || admitted.digest !== message.digest) throw new Error("Child observation has no exact owned native effect admission.");
    }
    let reply;
    try { reply = await relay(message, intent.assignment.command); }
    catch (error) { this.change(intent.id, { kind: "unknown", reason: `Child effect transport outcome is unresolved. ${String(error)}` }); throw error; }
    if (message.kind === "effect-admission" && reply.kind === "effect") this.childEffects.set(message.intent.id, { child: intent.id, digest: reply.effect.digest });
    if (message.kind === "effect-observation" && message.state.kind === "unknown") this.change(intent.id, { kind: "unknown", reason: "Owned child native effect outcome is unresolved." });
    return reply;
  }
  private corroborate(check: Omit<z.infer<typeof CenturioCheck>, "stage">, intent: z.infer<typeof CenturioIntent>) {
    const header = z.object({ type: z.literal("session"), id: z.string(), cwd: z.string() }).parse(JSON.parse(readFileSync(check.journal, "utf8").split("\n")[0] ?? "null"));
    if (header.id !== check.session || realpathSync(header.cwd) !== intent.cwd) throw new NativeMismatch("Actual child journal header does not join the native session.");
    const evidence = join(this.root, `${intent.id}.centurio-corroborated.json`);
    publish(evidence, { kind: "journal-corroborated", session: check.session, journal: check.journal, header });
    this.evidence.add(evidence);
  }
  private reconcile(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime || this.disposed) return;
    runtime.dirty = true;
    if (runtime.reconciling) return;
    runtime.reconciling = true;
    void (async () => {
      try {
        while (runtime.dirty && !this.disposed) {
          runtime.dirty = false;
          await this.reconcileOnce(id);
        }
      } finally { runtime.reconciling = false; }
    })();
  }
  private async reconcileOnce(id: string) {
    const view = this.views.get(id), known = this.runtimes.get(id);
    if (!view || !known || ["process-terminal", "unknown", "mismatch"].includes(view.state.kind)) return;
    try {
      const { owned, runtime, status, step } = this.observed(id);
      if (!runtime.child) { this.change(id, { kind: "launch-unresolved" }); return; }
      if (runtime.child.journal !== step.sessionFile) throw new NativeMismatch("Native session locator differs from the startup child.");
      if (!existsSync(runtime.child.journal)) { this.change(id, { kind: "corroboration-pending", reason: "Native journal publication is pending." }); return; }
      this.corroborate(runtime.child, owned.record.intent);
      const identity = { run: runtime.run, index: status.currentStep, session: runtime.child.session };
      if (["running", "queued"].includes(status.state)) { this.change(id, { kind: "active", ...identity }); return; }
      if (!["complete", "failed", "stopped", "paused", "timeout"].includes(status.state)) throw new Error("Unrecognized native lifecycle state.");
      if (!view.result) {
        const journalBytes = readFileSync(runtime.child.journal);
        const messages = journalBytes.toString("utf8").trimEnd().split("\n").flatMap(line => {
          const parsed = z.object({ type: z.literal("message"), id: z.string(), message: z.object({ role: z.literal("assistant"), stopReason: z.string(), content: z.array(z.unknown()) }) }).safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        });
        const final = messages.at(-1);
        if (!final || final.message.stopReason !== "stop") throw new Error("Native terminal finding is absent or incomplete. Streaming logs are not results.");
        const text = final.message.content.flatMap(part => {
          const parsed = z.object({ type: z.literal("text"), text: z.string() }).safeParse(part);
          return parsed.success ? [parsed.data.text] : [];
        }).join("\n");
        if (!text.trim()) throw new Error("Native terminal finding has no completed text.");
        const bytes = Buffer.from(text), sha256 = createHash("sha256").update(bytes).digest("hex"), source = `${runtime.child.journal}#${final.id}`;
        const evidence = join(this.root, `${id}.centurio-retained-result.json`);
        publish(evidence, { run: runtime.run, index: status.currentStep, session: runtime.child.session, source, sha256, bytes: bytes.toString("base64"), message: final, journalSha256: createHash("sha256").update(journalBytes).digest("hex"), journalBytes: journalBytes.toString("base64") });
        view.result = { evidence, source, sha256, preview: text.slice(0, 4000) };
        view.evidence.push(evidence);
      }
      const statusEvidence = join(this.root, `${id}.${digest(status)}.centurio-status.json`);
      publish(statusEvidence, status);
      if (!view.evidence.includes(statusEvidence)) view.evidence.push(statusEvidence);
      const proofPath = join(runtime.directory, "process-terminal.json");
      if (!existsSync(proofPath)) { this.change(id, { kind: "logical-terminal", ...identity, outcome: status.state }); return; }
      const proof = ProcessProof.parse(JSON.parse(readFileSync(proofPath, "utf8")));
      if (proof.state === "unknown") throw new Error("Native process effects are genuinely unknown. Preserve this child hold.");
      if (proof.runId !== runtime.run || runtime.runner !== null && proof.runnerProcessInstanceId !== runtime.runner) throw new NativeMismatch("Process-terminal proof differs from the independently observed native runner.");
      if (proof.state === "pending" || runtime.runner === null) { this.change(id, { kind: "logical-terminal", ...identity, outcome: status.state }); return; }
      if (proof.instances.length !== 1 || !proof.instances.some(instance => instance.kind === "runner" && instance.processInstanceId === proof.runnerProcessInstanceId)) throw new NativeMismatch("Process-terminal proof does not identify this exact native runner.");
      await this.checkOwner(owned.record.intent, "read", runtime.context);
      if (this.disposed || ["unknown", "mismatch"].includes(view.state.kind)) return;
      const current = this.observed(id);
      if (!isDeepStrictEqual(current.status, status) || !isDeepStrictEqual(ProcessProof.parse(JSON.parse(readFileSync(proofPath, "utf8"))), proof)) { runtime.dirty = true; return; }
      const retained = join(this.root, `${id}.centurio-process-terminal.json`);
      publish(retained, proof);
      view.evidence.push(retained);
      this.change(id, { kind: "process-terminal", ...identity, outcome: status.state, proof: retained });
      runtime.watcher.close();
    } catch (error) { this.change(id, { kind: error instanceof NativeMismatch ? "mismatch" : error instanceof PublicationPending ? "corroboration-pending" : "unknown", reason: String(error) }); }
  }
  dispose() {
    this.disposed = true;
    for (const runtime of this.runtimes.values()) runtime.watcher.close();
    this.writableRegistration?.dispose();
    this.writableRegistration = null;
    this.agentRegistration?.dispose();
    this.agentRegistration = null;
    this.guardRegistration?.dispose();
    this.guardRegistration = null;
  }
}

function piToolOwner(pi: ExtensionAPI) {
  const tool = pi.getAllTools().find(tool => tool.name === "subagent");
  return tool?.exposure === "model-only" ? tool.sourceInfo.path : null;
}

export const CenturioCheck = z.strictObject({ kind: z.literal("centurio-check"), stage: z.enum(["startup", "effect"]), binding: CenturioBinding, capability: z.string(), session: z.string(), journal: z.string(), cwd: z.string(), model: z.string() });
const NativeStatus = z.object({
  runId: z.string(), sessionId: z.string(), completionOwnerId: z.string().min(1).optional(), mode: z.string(), state: z.string(), cwd: z.string(), currentStep: z.int().nonnegative(), launchContractDigest: z.string().min(1),
  launchResolvedExtensions: z.object({ disableAmbientExtensions: z.boolean(), required: z.array(z.string()) }),
  steps: z.array(z.object({ agent: z.string(), sessionFile: z.string(), model: z.string(), requestedModel: z.string(), context: z.string(), launchContractDigest: z.string() })),
  processTerminal: z.object({ version: z.literal(1), state: z.enum(["pending", "observed", "unknown", "not-started"]), runId: z.string().min(1), runnerProcessInstanceId: z.string().min(1) }).optional(),
  outputFile: z.string().optional(),
});
const ProcessProof = z.discriminatedUnion("state", [
  z.object({ version: z.literal(1), state: z.literal("pending"), runId: z.string(), runnerProcessInstanceId: z.string() }),
  z.object({ state: z.literal("unknown") }),
  z.object({ version: z.literal(1), state: z.literal("observed"), runId: z.string(), runnerProcessInstanceId: z.string(), instances: z.array(z.object({ kind: z.literal("runner"), processInstanceId: z.string(), closeObservedAt: z.number(), exitCode: z.number().nullable(), signal: z.string().nullable() }).passthrough()) }).passthrough(),
]);
