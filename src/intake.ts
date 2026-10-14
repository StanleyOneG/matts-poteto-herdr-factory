import { ContextAlerts, ContextSample, type ContextAlert, type ContextObservation } from "./context-alerts.js";
import { isDeepStrictEqual } from "node:util";
import { checkoutIdentity } from "./checkout-identity.js";
import { loadLegionSettings, selectTribunusModel, type LegionSettings, type TribunusModelIntent, type WorkflowChoice } from "./legion-settings.js";
import { existsSync, readFileSync, realpathSync, lstatSync, accessSync, constants } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { join, dirname, relative, isAbsolute, sep } from "node:path";
import { CorrectionDelivery, CorrectionObservation, mattInitializationPrompt, requiredWorkflowSkills, successorStartupSelection, HandoffStageObservation, LaunchRecord, VerifiedWorker, Initialization, BoundedAssignment, WorkerAddress, WorkerStop, projectLaunch, type LaunchResult, type LaunchView, type TribunusHost } from "./tribunus.js";
import {
  AssignmentLedger,
  AssignmentConflict,
  sharedIdentity,
  persistentRoot,
  type ClaimView,
  type Reservation,
  type ReservationReceipt,
  type WorkspaceState,
  type AssignmentFaultPoint,
} from "./assignments.js";
import type { ResumeResourceReader, WorkerResourceObservation } from "./resume.js";
import type {
  GitWorkspace,
  WorkspaceRepository,
  GitOutcome,
  WorkspaceObservation,
} from "./git-workspace.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  CorrectionId, CorrectionAuthorization, CorrectionRecord, CorrectionTurn, AssignmentPin, correctionDigest,
  HandoffRequest, HandoffRecord, SettledHandoff,
  SnapshotStore,
  createSnapshot,
  type StorageFaultPoint,
  SnapshotSchema,
  LegatusId,
  SubmissionId,
  InputEvidence,
  TaskId,
  SubmissionRef,
  TaskRef,
  DecisionId,
  Ref,
  DecisionEffectSchema,
  AmendmentId,
  type LegatusSnapshot,
  type CommittedResult,
  WorkspaceRequest,
  LaunchRequest,
  EffectMessage, EffectRecord, EffectReply, WorkflowInvocation, NativeWorkflowInvocation, WorkflowDispatch,
} from "./snapshot.js";

export type Diagnostic = {
  name: string;
  status: "ready" | "missing" | "incompatible" | "unverified";
  message: string;
};
const Command = z.object({
  text: z.string(),
  requestKey: z.string().min(1),
  evidence: InputEvidence,
  workflowInvocation: NativeWorkflowInvocation.optional(),
  nativeDispatch: z.uuid().optional(),
});
const Question = z.object({
  question: z.string().min(1),
  recommendation: z.string().min(1),
});
export const ProposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("correction"), id: CorrectionId, source: SubmissionRef, target: TaskRef,
    authorization: CorrectionAuthorization, previous: CorrectionId.optional() }),
  z.object({
    kind: z.literal("new-task"),
    source: SubmissionRef,
    goal: z.string().min(1),
    acceptance: z.array(z.string()),
    questions: z.array(Question),
  }),
  z.discriminatedUnion("purpose", [
    z.object({
      kind: z.literal("clarify"),
      source: SubmissionRef,
      purpose: z.literal("routing"),
      affected: z.array(TaskRef),
      question: z.string().min(1),
      recommendation: z.string().min(1),
    }),
    z.object({
      kind: z.literal("clarify"),
      source: SubmissionRef,
      purpose: z.literal("product"),
      affected: z.tuple([TaskRef], TaskRef),
      question: z.string().min(1),
      recommendation: z.string().min(1),
    }),
  ]),
  z.object({
    kind: z.literal("propose-amendment"),
    source: SubmissionRef,
    affected: z.array(TaskRef).min(1),
    category: z.enum(["requirements", "acceptance", "verification", "financial", "access", "irreversible"]),
    change: z.string().min(1),
    question: z.string().min(1),
    recommendation: z.string().min(1),
  }),
  z.object({
    kind: z.literal("technical-choice"),
    source: SubmissionRef,
    target: TaskRef,
    choice: z.string().min(1),
  }),
  z.object({ kind: z.literal("conversation"), source: SubmissionRef }),
  z.object({
    kind: z.literal("answer"),
    source: SubmissionRef,
    decision: Ref,
    effect: DecisionEffectSchema,
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;
const Interpretation = z.object({
  kind: z.literal("interpretation"),
  requestKey: z.string().min(1),
  proposal: ProposalSchema,
  evidence: z.object({
    session: z.string(),
    generation: z.int().positive(),
    legatus: LegatusId,
    run: z.string().min(1),
    sources: z.array(SubmissionRef),
    nativeDispatch: z.uuid().optional(),
  }),
});
const Message = z.object({
  kind: z.literal("message"),
  text: z.string().min(1),
  requestKey: z.string().min(1),
  evidence: InputEvidence,
});
export const CorrectionAction = z.strictObject({
  kind: z.literal("correction-control"), correction: z.strictObject({ id: CorrectionId, digest: z.string().min(1) }),
  action: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("deliver") }),
    z.strictObject({ kind: z.literal("observe") }),
    z.strictObject({ kind: z.literal("reconcile"), observation: CorrectionObservation }),
    z.strictObject({ kind: z.literal("verify"), summary: z.string().trim().min(1), evidence: z.array(z.string().trim().min(1)).min(1) }),
  ]),
  evidence: z.strictObject({ session: z.string(), generation: z.int().positive(), legatus: LegatusId, run: z.string().min(1) }),
});
export type LegionView = {
  mode: "inactive" | "active" | "stopping";
  snapshot: LegatusSnapshot | null;
  tasks: Array<
    LegatusSnapshot["tasks"][number] & {
      eligibility: "admitted" | "inactive" | "blocked";
      claim: ClaimView;
      launch: LaunchView;
      tribunusModel: TribunusModelIntent | null;
      workflowChoice: WorkflowChoice | null;
      workflowHold: string | null;
      resumeHold: string | null;
      correctionHold: string | null;
    }
  >;
  settings: LegionSettings | null;
  tribuniModel: TribunusModelIntent | null;
  diagnostics: Diagnostic[];
  unavailable: string | null;
  ownerObservations?: ClaimView[];
  context: Record<string, ContextObservation>;
};
export type OperationResult =
  | z.infer<typeof EffectReply>
  | CommittedResult
  | { kind: "observed"; view: LegionView }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "uncertain"; requestKey: string; message: string }
  | {
      kind: "reserved";
      receipt: ReservationReceipt;
      workspace: WorkspaceState;
      parentObservation:
        | { kind: "observed"; commit: string | null }
        | { kind: "unavailable" };
      message: string;
    }
  | { kind: "ownership-blocked"; reservation: Reservation; message: string }
  | { kind: "workspace-stage"; requestId: string; message: string }
  | { kind: "correction-stage"; correction: z.infer<typeof CorrectionId>; state: CorrectionRecord["state"]; message: string }
  | { kind: "handoff-stage"; requestId: string; message: string }
  | { kind: "launch-stage"; requestId: string; message: string }
  | { kind: "launched"; launch: LaunchResult; message: string }
  | { kind: "native-stage"; source: z.infer<typeof SubmissionRef>; dispatch: z.infer<typeof WorkflowDispatch>; continuation?: true };
type CommandIntent =
  | { kind: "status"; id: string }
  | { kind: "doctor" | "on" | "off" }
  | { kind: "resume"; id: string }
  | { kind: "task"; text: string }
  | { kind: "correction"; target: z.infer<typeof TaskRef>; text: string }
  | { kind: "profile-on"; text: string }
  | { kind: "profile-off" }
  | { kind: "workflow"; text: string }
  | { kind: "workspace"; id: string }
  | { kind: "launch"; task: z.infer<typeof TaskRef> }
  | { kind: "handoff"; task: z.infer<typeof TaskRef>; purpose: string; continuation: string }
  | { kind: "continue-handoff"; id: string }
  | { kind: "retired-research" }
  | z.infer<typeof WorkspaceRequest>["intent"]
  | { kind: "invalid" };
export type CommandResult = OperationResult & {
  disposition:
    | "observe"
    | "off"
    | "activate"
    | "resume"
    | "submit"
    | "workspace"
    | "none";
};
function commandIntent(text: string): CommandIntent {
  const match = /^\s*(\S+)(?:\s([\s\S]*))?$/.exec(text);
  if (!match) return { kind: "on" };
  const token = match[1];
  const payload = match[2] ?? "";
  switch (token) {
    case "implement-spec=on":
      return payload.trim() ? { kind: "workflow", text: payload } : { kind: "invalid" };
    case "poteto-mode=on":
      return payload.trim() ? { kind: "profile-on", text: payload } : { kind: "invalid" };
    case "poteto-mode=off":
      return payload.trim() ? { kind: "invalid" } : { kind: "profile-off" };
    case "status":
      return { kind: "status", id: payload.trim() };
    case "doctor":
    case "on":
    case "off":
      return payload.trim() ? { kind: "invalid" } : { kind: token };
    case "resume":
      return /^\S+$/.test(payload.trim())
        ? { kind: "resume", id: payload.trim() }
        : { kind: "invalid" };
    case "workspace":
      return /^\S+$/.test(payload.trim())
        ? { kind: "workspace", id: payload.trim() }
        : { kind: "invalid" };
    case "handoff": {
      if (z.uuid().safeParse(payload.trim()).success) return { kind: "continue-handoff", id: payload.trim() };
      const parsed = /^(\S+)@(\d+)\s+--purpose\s+("(?:[^"\\]|\\.)*")\s+--continue\s+("(?:[^"\\]|\\.)*")$/.exec(payload.trim());
      const task = TaskRef.safeParse({ id: parsed?.[1], revision: Number(parsed?.[2]) });
      if (!parsed || !task.success) return { kind: "invalid" };
      try {
        const purpose = z.string().trim().min(1).parse(JSON.parse(parsed[3] ?? ""));
        const continuation = z.string().trim().min(1).parse(JSON.parse(parsed[4] ?? ""));
        return { kind: "handoff", task: task.data, purpose, continuation };
      } catch { return { kind: "invalid" }; }
    }
    case "correction": {
      const parsed = /^(\S+)@(\d+)\s+([\s\S]+)$/.exec(payload.trim());
      const target = TaskRef.safeParse({ id: parsed?.[1], revision: Number(parsed?.[2]) });
      return parsed && target.success && parsed[3]?.trim() ? { kind: "correction", target: target.data, text: parsed[3] } : { kind: "invalid" };
    }
    case "launch": {
      const parsed = /^(\S+)@(\d+)$/.exec(payload.trim());
      const task = TaskRef.safeParse({ id: parsed?.[1], revision: Number(parsed?.[2]) });
      return task.success ? { kind: "launch", task: task.data } : { kind: "invalid" };
    }
    case "reserve": {
      const parsed =
        /^(\S+)@(\d+)\s+--parent\s+(refs\/heads\/\S+)(?:\s+--source\s+(\S+))?$/.exec(
          payload.trim(),
        );
      const task = TaskRef.safeParse({
        id: parsed?.[1],
        revision: Number(parsed?.[2]),
      });
      return parsed && task.success
        ? {
            kind: "reserve",
            task: task.data,
            parent: parsed[3] ?? "",
            source: parsed[4] ?? null,
          }
        : { kind: "invalid" };
    }
    case "reconcile": {
      const task = TaskId.safeParse(payload.trim());
      return task.success
        ? { kind: "reconcile", task: task.data }
        : { kind: "invalid" };
    }
    case "research":
      return { kind: "retired-research" };
    case "task":
      return payload.trim()
        ? { kind: "task", text: payload }
        : { kind: "invalid" };
    default:
      return token?.startsWith("poteto-mode=") || token?.startsWith("implement-spec=") ? { kind: "invalid" } : { kind: "task", text };
  }
}
// Retired controller records are evidence only; absence of a controller cannot settle them.
function hasLegacyResearchHold(snapshot: LegatusSnapshot | null) {
  return !!snapshot && (!!snapshot.researchHold || snapshot.researchRequests.some(request => request.state.kind !== "settled") ||
    snapshot.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind)));
}
function taskApprovalScope({ snapshot, task }: { snapshot: LegatusSnapshot; task: LegatusSnapshot["tasks"][number] }): string {
  const resolutions = snapshot.resolutions.filter(resolution => snapshot.decisions.some(decision =>
    decision.id === resolution.decision.id && decision.history.at(-1)?.affected.some(affected => affected.id === task.id)));
  return createHash("sha256").update(JSON.stringify({ history: task.history.at(-1), scope: task.scope, resolutions })).digest("hex");
}
function correctionHold({ snapshot, taskId }: { snapshot: LegatusSnapshot; taskId: string }): string | null {
  const records = snapshot.corrections.filter(record => record.task.id === taskId && !snapshot.corrections.some(next => next.previous === record.id));
  const unknown = records.find(record => record.state.kind === "unknown");
  if (unknown?.state.kind === "unknown") return `Correction ${unknown.id} outcome is unknown. ${unknown.state.message} Observe the exact pinned delivery before retry or replacement.`;
  const task = snapshot.tasks.find(task => task.id === taskId);
  const mismatch = task && records.find(record => record.binding && (record.binding.pin.task.revision !== task.history.at(-1)?.revision ||
    record.binding.pin.scope !== taskApprovalScope({ snapshot, task })));
  if (mismatch) return `Correction ${mismatch.id} targets changed task scope, but its assignment authority still pins revision ${mismatch.binding?.pin.task.revision}. Receipt and performed-correction verification never refresh execution authority. Preserve the worker; explicit reauthorization is required.`;
  const unaddressed = records.find(record => !record.binding && record.state.kind === "queued");
  if (unaddressed) return `Correction ${unaddressed.id} is saved without a matching assigned worker. No worker was launched. Create a linked request when a current assignment is available.`;
  return null;
}
function hasUnsettledWork(snapshot: LegatusSnapshot | null, launches: Map<string, LaunchView>) {
  const shutdown = snapshot?.shutdown;
  return hasLegacyResearchHold(snapshot) || !!snapshot?.effects.some(effect => effect.state.kind === "outstanding" || effect.state.kind === "unknown") ||
    !!shutdown && (shutdown.workers.some(worker => worker.state.kind !== "parked") ||
      [...launches.values()].some(launch => {
        if (launch.kind === "not-launched" || launch.kind === "prepared") return false;
        const progress = launch.kind === "held" ? launch.last : launch;
        if (!("worker" in progress)) return true;
        const addressDigest = createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex");
        return !shutdown.workers.some(worker => worker.addressDigest === addressDigest && worker.state.kind === "parked");
      }));
}
export type LegionOptions = {
  storagePath: string;
  context: string;
  session: string;
  preflight: (settings?: LegionSettings) => Promise<Diagnostic[]>;
  loadSettings?: () => Promise<LegionSettings>;
  onContextAlert?: (alert: ContextAlert) => void;
  onContextUpdate?: () => void;
  storageFault?: (point: StorageFaultPoint) => void;
  tribuni?: { host: () => TribunusHost | null; onUnavailable?: (message: string) => void };
  resume?: {
    repository: (commonDir: string) => Pick<GitWorkspace, "observeResources"> | null;
    worker: (authority: z.infer<typeof WorkerStop>["authority"]) => ResumeResourceReader | null;
  };
  assignments?: {
    workspaceRoot?: string;
    repository: () => WorkspaceRepository | null;
    fault?: (point: AssignmentFaultPoint) => void;
  };
};
const reject = (code: string, message: string): OperationResult => ({
  kind: "rejected",
  code,
  message,
});
function workflowFailure(choice: WorkflowChoice | null): Extract<OperationResult, { kind: "rejected" }> | null {
  if (choice?.profile === "poteto-mode" && choice.requestedWorkflow !== "unknown")
    return { kind: "rejected", code: "workflow-conflict", message: `Poteto profile conflicts with explicitly requested ${choice.requestedWorkflow}. Dispatch withheld. The Emperor must request /legion poteto-mode=off or clarify a different workflow; Legion never silently toggles.` };
  if (!choice || choice.profile === "matt" && choice.requestedWorkflow === "unknown")
    return { kind: "rejected", code: "workflow-unknown", message: "Select an explicit Emperor workflow before dispatch; the requested workflow is unknown. No classifier inference or worker launch." };
  return null;
}
type Binding = {
  generation: number;
  lock: DatabaseSync;
  association: DatabaseSync;
};
function release(lock: DatabaseSync) {
  try {
    lock.exec("ROLLBACK");
  } finally {
    lock.close();
  }
}
export class Legion {
  private contextAlerts = new ContextAlerts();
  private contextWatchers: Array<() => void> = [];
  private contextSequences = new Map<string, number>();
  private contextAssignmentHold(): string | null {
    const sample = this.contextAlerts.view().legatus?.sample;
    return sample && sample.kind !== "fresh" ? "Current Legatus context observation is unresolved. Preserve affected work; no new assignment or cleanup is authorized by this observation. Obtain a fresh current estimate before dispatch." : null;
  }
  async observeContext(input: { session: string; generation: number; model: string | null; sample: unknown }): Promise<void> {
    if (!this.binding || this.stopping || !this.selected || input.session !== this.options.session || input.generation !== this.binding.generation || !this.settings) return;
    const sample = ContextSample.parse(input.sample);
    const alert = this.contextAlerts.observe("legatus", { identity: `${this.selected}:${input.session}:${input.generation}:${this.epoch}`, model: input.model, sample }, this.settings.context);
    if (alert) this.options.onContextAlert?.(alert);
  }
  private store: SnapshotStore;
  private settings: LegionSettings | null = null;
  private activationDiagnostics: Diagnostic[] = [];
  private settingsView() {
    return { settings: this.settings, tribuniModel: this.settings ? selectTribunusModel({ kind: "new", settings: this.settings }) : null };
  }
  private assignmentModelIntent({ launch, handoff }: { launch: LaunchView | undefined; handoff?: HandoffRecord | undefined }): TribunusModelIntent | null {
    const progress = launch?.kind === "held" ? launch.last : launch;
    if (progress && "assignment" in progress)
      return selectTribunusModel({ kind: "existing", ...(progress.assignment.modelPin ? { pin: progress.assignment.modelPin } : {}) });
    if (progress?.kind === "unavailable") return { kind: "existing-unknown" };
    if (handoff) return selectTribunusModel({ kind: "existing", pin: handoff.modelPin });
    return this.settingsView().tribuniModel;
  }
  private taskWorkflow(snapshot: LegatusSnapshot, task: string, launch: LaunchView | undefined) {
    if (launch?.kind === "unavailable")
      return { workflowChoice: null, workflowHold: "Existing assignment workflow pin is unavailable. Preserve launch history; do not reconstruct from future defaults." };
    const progress = launch?.kind === "held" ? launch.last : launch;
    if (progress && "assignment" in progress)
      return { workflowChoice: progress.assignment.workflowChoice ?? null, workflowHold: null };
    const handoff = snapshot.handoffs.find(record => record.pin.task.id === task);
    if (handoff) return { workflowChoice: handoff.workflowChoice, workflowHold: null };
    const pending = snapshot.launchRequests.find(request => request.task.id === task);
    const choice = pending ? pending.workflowChoice ?? null : snapshot.workflowChoice;
    return { workflowChoice: choice, workflowHold: workflowFailure(choice)?.message ?? null };
  }
  private selected: string | null = null;
  private binding: Binding | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private resumeSignal = new AbortController();
  private stopping = false;
  private stopRequested = false;
  private pendingStop: Omit<NonNullable<LegatusSnapshot["shutdown"]>, "workers"> | null = null;
  private stopPublication: Promise<void> | null = null;
  private creating = false;
  private retiredLaunches = new Set<string>();
  private handoffRuns = new Map<string, Promise<OperationResult>>();
  private workerHosts = new Map<string, TribunusHost>();
  private invocations = 0;
  private effectInvocations = new Set<string>();
  private uncertain: { id: string; requestKey: string } | null = null;
  constructor(private options: LegionOptions) {
    this.store = new SnapshotStore(options.storagePath, options.storageFault);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private revoke() {
    this.resumeSignal.abort();
    this.resumeSignal = new AbortController();
    this.epoch++;
    this.contextAlerts.invalidate("Owner authority revoked; observation unresolved");
    for (const dispose of this.contextWatchers.splice(0)) dispose();
    if (this.stopRequested && this.binding) {
      this.stopping = true;
      return;
    }
    if (this.invocations) {
      this.stopping = true;
      return;
    }
    this.stopping = false;
    const previous = this.binding;
    this.binding = null;
    if (previous) {
      try {
        release(previous.lock);
      } finally {
        release(previous.association);
      }
    }
  }
  private async claims(snapshot: LegatusSnapshot | null) {
    const fallback: ClaimView = this.options.assignments
      ? {
          kind: "unavailable",
          message:
            "Repository observation requires guarded workspace execution.",
        }
      : { kind: "unreserved" };
    if (!snapshot)
      return {
        all: Array<ClaimView>(),
        byTask: new Map<string, ClaimView>(),
        fallback,
      };
    const repositories = new Set(snapshot.workspaceRequests.flatMap(request => request.repository ? [request.repository] : []));
    if (!repositories.size)
      return {
        all: Array<ClaimView>(),
        byTask: new Map<string, ClaimView>(),
        fallback,
      };
    try {
      const all: ClaimView[] = [];
      const byTask = new Map<string, ClaimView>();
      for (const commonDir of repositories) {
        const observed = await new AssignmentLedger({
          commonDir, owner: snapshot.id, fault: this.options.assignments?.fault,
          expectedRepository: snapshot.workspaceRequests.find(request => request.repository === commonDir && request.repositoryId)?.repositoryId ?? null,
          historyRequired: true,
        }).observations(snapshot.id);
        all.push(...observed.claims);
        for (const [task, claim] of observed.byTask) {
          if (byTask.has(task)) throw new Error("Task ownership is ambiguous across saved repositories. Preserve history.");
          byTask.set(task, claim);
        }
      }
      return {
        all,
        byTask,
        fallback: { kind: "unreserved" } satisfies ClaimView,
      };
    } catch (error) {
      return {
        all: Array<ClaimView>(),
        byTask: new Map<string, ClaimView>(),
        fallback: {
          kind: "unavailable",
          message: String(error),
        } satisfies ClaimView,
      };
    }
  }
  private approval(
    state: LegatusSnapshot,
    ref: z.infer<typeof TaskRef>,
  ): string {
    if (state.corrections.some(record => record.task.id === ref.id && record.state.kind === "unknown"))
      throw new Error("Affected task has an unknown correction delivery. Reconcile the exact pinned outcome before further authority or handoff.");
    const hold = state.resumeState?.holds.find(hold => hold.task === ref.id);
    if (hold) throw new Error(`Retained assignment is observation-only after resume. ${hold.message}`);
    const task = state.tasks.find((t) => t.id === ref.id);
    if (!task || task.history.at(-1)?.revision !== ref.revision)
      throw new Error("Exact task revision is not current.");
    if (
      state.decisions.some(
        (d) =>
          d.state.kind === "open" &&
          d.history.at(-1)?.affected.some((t) => t.id === ref.id),
      )
    )
      throw new Error("Affected work awaits an Emperor decision.");
    return taskApprovalScope({ snapshot: state, task });
  }
  private workspaceAuthority(
    request: z.infer<typeof WorkspaceRequest> | z.infer<typeof LaunchRequest>,
    epoch: number,
  ) {
    if (
      !this.binding ||
      this.stopping || this.stopRequested ||
      this.epoch !== epoch ||
      request.epoch !== epoch ||
      request.generation !== this.binding.generation ||
      request.evidence.session !== this.options.session
    )
      throw new Error(
        "Workspace execution authority is revoked. Explicitly reserve or reconcile again after resume.",
      );
  }
  private async authorized(
    request: z.infer<typeof WorkspaceRequest> | z.infer<typeof LaunchRequest>,
    epoch: number,
  ) {
    const current = await this.ownedTaskAuthority(request, epoch);
    if (request.nativeDispatch) this.nativeAuthority(current.state, request.nativeDispatch, request.evidence.session, request.generation);
    return current;
  }
  private async ownedTaskAuthority(
    request: z.infer<typeof WorkspaceRequest> | z.infer<typeof LaunchRequest>,
    epoch: number,
  ) {
    this.workspaceAuthority(request, epoch);
    const state = this.selected ? await this.store.read(this.selected) : null;
    this.workspaceAuthority(request, epoch);
    if (!state) throw new Error("Intake authority is unavailable.");
    const task = !("intent" in request) ? request.task :
      request.intent.kind === "reserve"
        ? request.intent.task
        : {
            id: request.intent.task,
            revision:
              state.tasks
                .find((t) => t.id === request.intent.task)
                ?.history.at(-1)?.revision ?? 0,
          };
    if (this.approval(state, task) !== request.scope)
      throw new Error("Approved task scope changed. Reservation retained.");
    return { state, task };
  }
  private recordWorkspace(
    input: z.infer<typeof Command>,
    intent: z.infer<typeof WorkspaceRequest>["intent"],
    epoch: number,
  ): Promise<OperationResult> {
    return this.serialize(async () => {
      if (
        !this.binding ||
        this.stopping ||
        epoch !== this.epoch ||
        !this.selected
      )
        return reject(
          "inactive",
          "Activate or explicitly resume Legion before reserving work.",
        );
      if (!this.options.assignments)
        return reject(
          "dependencies",
          "Workspace dependencies are unavailable. No task was reserved.",
        );
      if (
        input.evidence.generation !== null &&
        input.evidence.generation !== this.binding.generation
      )
        return reject(
          "provenance",
          "Host command association generation is stale.",
        );
      try {
        const state = await this.store.read(this.selected);
        if (!state) return reject("unavailable", "Intake records unavailable.");
        if (input.nativeDispatch) this.nativeAuthority(state, input.nativeDispatch, input.evidence.session, input.evidence.generation ?? 0);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(intent))
          .digest("hex");
        const prior = state.workspaceRequests.find(
          (r) => r.id === input.requestKey,
        );
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            return reject(
              "request-conflict",
              "Request key has a different payload.",
            );
          if (prior.repository) {
            const replay = await new AssignmentLedger({
              commonDir: prior.repository,
              owner: state.id,
              fault: this.options.assignments.fault,
              expectedRepository: state.workspaceRequests.find(
                (r) => r.repository === prior.repository && r.repositoryId,
              )?.repositoryId ?? null,
            }).replay(state.id, prior.id, fingerprint);
            if (replay) return this.reservationResult(replay, state.id);
          }
          const receipt = state.receipts.find(
            (r) => r.result.receipt.requestKey === input.requestKey,
          );
          if (receipt) return receipt.result;
          return reject(
            "unavailable",
            "Pending request receipt is unavailable. No execution authorized.",
          );
        }
        const task =
          intent.kind === "reserve"
            ? intent.task
            : {
                id: intent.task,
                revision:
                  state.tasks.find((t) => t.id === intent.task)?.history.at(-1)
                    ?.revision ?? 0,
              };
        const scope = this.approval(state, task);
        if (intent.kind === "reserve") sharedIdentity(task.id, intent.source);
        const result: CommittedResult = {
          kind: "deferred",
          receipt: {
            legatus: state.id,
            requestKey: input.requestKey,
            sequence: state.receipts.length + 1,
            message: `Workspace request recorded. Task NOT YET RESERVED by this request. Guarded execution required. Run /legion workspace ${input.requestKey}. No worker started.`,
          },
        };
        state.workspaceRequests.push(
          WorkspaceRequest.parse({
            id: input.requestKey,
            fingerprint,
            intent,
            evidence: input.evidence,
            ...(input.nativeDispatch ? { nativeDispatch: input.nativeDispatch } : {}),
            generation: this.binding.generation,
            epoch,
            scope,
            repository: null,
          }),
        );
        state.receipts.push({ fingerprint, result });
        const expected = state.revision;
        state.revision++;
        try {
          await this.store.save(
            state,
            expected,
            () => !!this.binding && !this.stopping && this.epoch === epoch,
          );
        } catch (error) {
          this.uncertain = { id: state.id, requestKey: input.requestKey };
          this.revoke();
          return {
            kind: "uncertain",
            requestKey: input.requestKey,
            message: `Pending workspace request publication is uncertain. No execution is authorized. Inspect status ${state.id}, explicitly resume, and issue a fresh host request. ${String(error)}`,
          };
        }
        return result;
      } catch (error) {
        return reject("workspace-request", String(error));
      }
    });
  }
  private reservationResult(
    result: {
      receipt: ReservationReceipt;
      workspace: WorkspaceState;
      observation?: WorkspaceObservation;
    },
    owner: z.infer<typeof LegatusId>,
  ): OperationResult {
    const reservation = result.receipt.reservation;
    if (reservation.owner !== owner)
      return {
        kind: "ownership-blocked",
        reservation,
        message:
          "Task is reserved by another Legatus. No workspace was created for this request.",
      };
    const unknown =
      result.workspace.kind === "dispatched" ||
      (result.workspace.kind === "held" &&
        result.workspace.code === "unknown-operation");
    const operation =
      result.workspace.kind === "dispatched" || result.workspace.kind === "held"
        ? result.workspace.operation
        : null;
    const message = unknown
      ? `Reservation retained. Git operation completion is unknown. Inspect operation ${operation?.id}, branch ${reservation.plan.branch}, and path ${reservation.plan.path}. Preserve these resources. No retry was performed. Inspection alone does not authorize adoption, deletion, or retry.`
      : result.workspace.kind === "ready"
        ? "Task reserved. Workspace ready. No worker started."
        : "Reservation retained. No worker started.";
    return {
      kind: "reserved",
      receipt: result.receipt,
      workspace: result.workspace,
      parentObservation: result.observation
        ? { kind: "observed", commit: result.observation.parent }
        : { kind: "unavailable" },
      message,
    };
  }
  private async executeWorkspace(id: string): Promise<OperationResult> {
    const epoch = this.epoch;
    const dependencies = this.options.assignments;
    const git = dependencies?.repository();
    if (!dependencies || !git)
      return reject(
        "permission-path",
        "Guarded Git execution requires a live legion_workspace tool context. No task was reserved by this request.",
      );
    let request: z.infer<typeof WorkspaceRequest>;
    try {
      const state = this.selected ? await this.store.read(this.selected) : null;
      const found = state?.workspaceRequests.find((r) => r.id === id);
      if (!found)
        return reject(
          "request",
          "No durably recorded host workspace request exists.",
        );
      request = found;
      await this.authorized(request, epoch);
      this.workspaceAuthority(request, epoch);
      this.invocations++;
    } catch (error) {
      return reject("authority", String(error));
    }
    try {
      const location = await git.locate();
      const locatedAuthority = await this.serialize(() =>
        this.authorized(request, epoch),
      );
      const knownRepository =
        locatedAuthority.state.workspaceRequests.find(
          (r) => r.repository === location.commonDir && r.repositoryId,
        )?.repositoryId ?? null;
      const ledger = new AssignmentLedger({
        commonDir: location.commonDir,
        owner: locatedAuthority.state.id,
        fault: dependencies.fault,
        expectedRepository: knownRepository,
        historyRequired: locatedAuthority.state.workspaceRequests.some(
          (r) => r.repository === location.commonDir,
        ),
      });
      if (request.repository && request.repository !== location.commonDir)
        return reject(
          "repository",
          "Repository metadata changed. Preserve existing records.",
        );
      const prior = await ledger.replay(
        LegatusId.parse(this.selected),
        request.id,
        request.fingerprint,
      );
      if (prior)
        return this.reservationResult(prior, LegatusId.parse(this.selected));
      const current = await this.serialize(() =>
        this.authorized(request, epoch),
      );
      const observed = await ledger.observations(current.state.id);
      const local = observed.byTask.get(current.task.id);
      if (
        request.intent.kind === "reconcile" &&
        (!local || local.kind === "unreserved" || local.kind === "unavailable")
      )
        return reject("reservation", "No reconcilable reservation exists.");
      if (request.intent.kind === "reconcile" && local?.kind === "foreign")
        return {
          kind: "ownership-blocked",
          reservation: local.reservation,
          message:
            "Task is reserved by another Legatus. No workspace was created for this request.",
        };
      const existing = local?.kind === "owned" ? local.reservation : null;
      if (
        existing &&
        request.intent.kind === "reserve" &&
        request.intent.parent !== existing.plan.parent
      )
        return reject(
          "plan-conflict",
          "A fresh request cannot change the stored parent branch. Reservation retained.",
        );
      const parent =
        request.intent.kind === "reserve"
          ? request.intent.parent
          : existing?.plan.parent;
      if (!parent)
        return reject("reservation", "Reservation plan unavailable.");
      this.workspaceAuthority(request, epoch);
      const commit = existing?.plan.commit ?? (await git.parent(parent));
      const planId = randomUUID();
      const plan = existing?.plan ?? {
        branch: `refs/heads/legion/${planId}`,
        path: join(
          persistentRoot(dependencies.workspaceRoot, location),
          planId,
        ),
        parent,
        commit,
      };
      const reserved = await this.serialize(async () => {
        const authority = await this.authorized(request, epoch);
        const replay = await ledger.replay(
          authority.state.id,
          request.id,
          request.fingerprint,
        );
        if (replay) return { ...replay, replayed: true };
        const saved = authority.state.workspaceRequests.find(
          (r) => r.id === request.id,
        );
        if (!saved) throw new Error("Pending request disappeared.");
        saved.repository = location.commonDir;
        const expected = authority.state.revision;
        authority.state.revision++;
        await this.store.save(
          authority.state,
          expected,
          () => !!this.binding && !this.stopping && epoch === this.epoch,
        );
        const result = await ledger.reserve({
          owner: authority.state.id,
          task: authority.task,
          scope: request.scope,
          shared:
            request.intent.kind === "reserve"
              ? sharedIdentity(authority.task.id, request.intent.source)
              : (existing?.shared ?? sharedIdentity(authority.task.id, null)),
          request: request.id,
          fingerprint: request.fingerprint,
          plan,
          owned: () => !!this.binding && !this.stopping && epoch === this.epoch,
        });
        saved.repositoryId = result.receipt.reservation.repository;
        const witnessed = authority.state.revision;
        authority.state.revision++;
        await this.store.save(
          authority.state,
          witnessed,
          () => !!this.binding && !this.stopping && epoch === this.epoch,
        );
        return { ...result, replayed: false };
      });
      if (reserved.replayed)
        return this.reservationResult(reserved, current.state.id);
      if (reserved.receipt.reservation.owner !== current.state.id)
        return this.reservationResult(reserved, current.state.id);
      return await this.prepareWorkspace({
        ledger,
        git,
        request,
        epoch,
        receipt: reserved.receipt,
      });
    } catch (error) {
      if (error instanceof AssignmentConflict)
        return reject(error.code, error.message);
      const followUp =
        request.intent.kind === "reserve"
          ? `reserve ${request.intent.task.id}@${request.intent.task.revision} --parent ${request.intent.parent}${request.intent.source ? ` --source ${request.intent.source}` : ""}`
          : `reconcile ${request.intent.task}`;
      return {
        kind: "uncertain",
        requestKey: id,
        message: `Assignment authority or operation outcome could not be established. Preserve all recorded resources. ${String(error)}. Inspect /legion status ${this.selected}. If inactive, explicitly /legion resume ${this.selected}, then issue a fresh /legion ${followUp}. Preserve the exact pending request ${id} and its saved payload. No automatic retry was performed.`,
      };
    } finally {
      this.invocations--;
      if (this.stopRequested) await this.reconcileStop();
      else if (this.stopping && !this.invocations) this.revoke();
    }
  }
  private async prepareWorkspace(input: {
    ledger: AssignmentLedger;
    git: WorkspaceRepository;
    request: z.infer<typeof WorkspaceRequest>;
    epoch: number;
    receipt: ReservationReceipt;
  }): Promise<OperationResult> {
    const { ledger, git, request, epoch, receipt } = input;
    const reservation = receipt.reservation;
    const plan = reservation.plan;
    const read = async () => {
      const result = await ledger.replay(
        reservation.owner,
        request.id,
        request.fingerprint,
      );
      if (!result)
        throw new Error("Committed reservation receipt unavailable.");
      return result;
    };
    const held = async (
      code: string,
      message: string,
      operation:
        | Extract<WorkspaceState, { kind: "dispatched" }>["operation"]
        | null = null,
    ): Promise<OperationResult> => {
      const workspace: WorkspaceState = {
        kind: "held",
        code,
        message,
        operation,
      };
      await ledger.hold(reservation, workspace);
      return this.reservationResult({ receipt, workspace }, reservation.owner);
    };
    let current = await read();
    if (
      current.workspace.kind === "dispatched" ||
      (current.workspace.kind === "held" &&
        current.workspace.code === "unknown-operation")
    ) {
      const operation = current.workspace.operation;
      let observed = "Git observation unavailable.";
      try {
        this.workspaceAuthority(request, epoch);
        observed = JSON.stringify(await git.inspect(plan));
      } catch (error) {
        observed += ` ${String(error)}`;
      }
      return held(
        "unknown-operation",
        `Reservation retained. Git operation completion is unknown. Inspect operation ${operation?.id}, branch ${plan.branch}, and path ${plan.path}. Preserve these resources. No retry was performed. Inspection alone does not authorize adoption, deletion, or retry. ${observed}`,
        operation,
      );
    }
    for (const step of ["branch", "worktree"] as const) {
      current = {
        ...(await read()),
        workspace: await ledger.progress(reservation),
      };
      if (current.workspace.kind === "ready") {
        this.workspaceAuthority(request, epoch);
        const actual = await git.inspect(plan);
        if (
          !actual.workspace ||
          !actual.workspace.backlink ||
          actual.workspace.commonDir !== ledger.commonDir ||
          actual.workspace.branch !== plan.branch ||
          actual.branch !== actual.workspace.commit ||
          actual.path !== "directory"
        )
          return held(
            "workspace-mismatch",
            "Ready workspace association changed or disappeared. Preserve the branch and path. No repair or recreation was performed.",
          );
        await ledger.hold(reservation, null);
        return this.reservationResult(
          { ...current, observation: actual },
          reservation.owner,
        );
      }
      if (step === "branch" && current.workspace.kind === "branch-owned")
        continue;
      if (
        current.workspace.kind === "held" &&
        current.workspace.operation?.step === "worktree" &&
        step === "branch"
      )
        continue;
      try {
        this.workspaceAuthority(request, epoch);
      } catch (error) {
        return held("approval", String(error));
      }
      const actual = await git.inspect(plan);
      if (actual.path !== "absent" || actual.workspace)
        return held(
          "collision",
          `Existing path or registered worktree at ${plan.path}. Reservation retained. No existing resource was adopted or changed.`,
        );
      if (
        step === "branch"
          ? actual.branch !== null
          : actual.branch !== plan.commit
      )
        return held(
          "collision",
          `Branch ${plan.branch} collides or moved before readiness. Reservation retained. No existing resource was adopted or changed.`,
        );
      let operation;
      try {
        operation = await this.serialize(async () => {
          await this.authorized(request, epoch);
          return ledger.dispatch(
            reservation,
            step,
            () => !!this.binding && !this.stopping && epoch === this.epoch,
          );
        });
      } catch (error) {
        return held("approval", String(error));
      }
      if (!operation)
        return held(
          "unknown-operation",
          "Another operation is dispatched. Preserve the recorded branch and path. No retry was performed.",
        );
      if (!this.binding || this.stopping || this.epoch !== epoch) {
        await ledger.complete(operation, {
          kind: "failed",
          message:
            "Authority revoked before child invocation. No Git invocation was started.",
          noEffect: true,
        });
        return held(
          "approval",
          "Authority revoked before Git invocation. Reservation retained.",
        );
      }
      let outcome: GitOutcome;
      try {
        outcome = await (step === "branch"
          ? git.createBranch(plan)
          : git.createWorktree(plan));
      } catch (error) {
        outcome = { kind: "unknown", message: String(error) } as const;
      }
      try {
        const after = await git.inspect(plan);
        if (
          outcome.kind === "succeeded" &&
          (after.branch !== plan.commit ||
            (step === "worktree" &&
              (!after.workspace ||
                !after.workspace.backlink ||
                after.workspace.commonDir !== ledger.commonDir ||
                after.workspace.branch !== plan.branch ||
                after.workspace.commit !== plan.commit ||
                after.path !== "directory")))
        )
          outcome = {
            kind: "unknown",
            message:
              "Git reported completion but matching repository evidence is unavailable.",
          };
        if (outcome.kind === "failed")
          outcome = {
            ...outcome,
            noEffect:
              outcome.noEffect &&
              (step === "branch"
                ? after.branch === null
                : !after.workspace && after.path === "absent"),
          };
      } catch (error) {
        outcome = {
          kind: "unknown",
          message: `Post-operation observation unavailable. ${String(error)}`,
        };
      }
      await ledger.complete(operation, outcome);
      if (outcome.kind !== "succeeded") {
        const failed = await read();
        return this.reservationResult(failed, reservation.owner);
      }
    }
    return this.reservationResult(
      { ...(await read()), observation: await git.inspect(plan) },
      reservation.owner,
    );
  }
  private currentLaunchId({ snapshot, task }: { snapshot: LegatusSnapshot; task: string }) {
    const record = snapshot.handoffs.find(record => record.pin.task.id === task);
    const progress = record?.state.kind === "held" ? record.state.last : record?.state;
    return progress?.kind === "successor-reserved" ? progress.launch : snapshot.launchRequests.find(request => request.task.id === task && request.attempt)?.attempt ?? null;
  }
  private handoffRequest(record: HandoffRecord) {
    const { state, ...request } = record;
    return HandoffRequest.parse(request);
  }
  private async ordinaryWatcherCurrent(launch: string) {
    if (this.retiredLaunches.has(launch)) return false;
    const state = this.selected ? await this.store.read(this.selected) : null;
    if (!state) return false;
    const handoff = state.handoffs.find(record => record.pin.launch === launch);
    const progress = handoff?.state.kind === "held" ? handoff.state.last : handoff?.state;
    return !handoff || progress?.kind === "stopping";
  }
  private launchOrigin({ snapshot, launch }: { snapshot: LegatusSnapshot; launch: LaunchRecord }) {
    if (!launch.successor) return snapshot.launchRequests.find(request => request.attempt === launch.id);
    const record = snapshot.handoffs.find(record => record.id === launch.successor?.handoff);
    const progress = record?.state.kind === "held" ? record.state.last : record?.state;
    if (!record || progress?.kind !== "successor-reserved" || progress.launch !== launch.id || record.pin.launch !== launch.successor.predecessor) throw new Error("Exact saved successor/handoff authority missing.");
    return this.handoffOrigin({ snapshot, record });
  }
  private handoffOrigin({ snapshot, record }: { snapshot: LegatusSnapshot; record: HandoffRecord }) {
    const origin = snapshot.launchRequests.find(request => request.attempt === record.pin.launch);
    if (!origin || origin.scope !== record.pin.scope || !isDeepStrictEqual(origin.task, record.pin.task) ||
        origin.evidence.session !== record.pin.session || origin.generation !== record.pin.generation || origin.epoch !== record.pin.epoch)
      throw new Error("Exact predecessor authority/history is missing. Preserve handoff; do not reconstruct it.");
    return origin;
  }
  private async handoffAuthority({ record, epoch }: { record: HandoffRecord; epoch: number }) {
    const snapshot = this.selected ? await this.store.read(this.selected) : null;
    if (!snapshot || snapshot.id !== record.pin.owner) throw new Error("Handoff owner history unavailable.");
    const origin = this.handoffOrigin({ snapshot, record });
    const current = await this.ownedTaskAuthority(origin, epoch);
    const saved = current.state.handoffs.find(saved => saved.id === record.id);
    if (!saved || !isDeepStrictEqual(this.handoffRequest(saved), this.handoffRequest(record))) throw new Error("Immutable handoff request changed or disappeared.");
    return { ...current, origin, record: saved };
  }
  private recordHandoff({ input, intent }: { input: z.infer<typeof Command>; intent: Extract<CommandIntent, { kind: "handoff" | "continue-handoff" }> }): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      try {
        const view = await this.state(), snapshot = view.snapshot;
        if (view.mode !== "active" || !snapshot || !this.binding) return reject("inactive", "Explicit current Legatus authority is required for handoff.");
        if (input.evidence.generation !== null && input.evidence.generation !== this.binding.generation) throw new Error("Stale host generation.");
        if (input.nativeDispatch) this.nativeAuthority(snapshot, input.nativeDispatch, input.evidence.session, this.binding.generation);
        if (intent.kind === "continue-handoff") {
          const record = snapshot.handoffs.find(record => record.id === intent.id);
          if (!record) throw new Error("Known handoff request missing; never reconstruct it.");
          await this.handoffAuthority({ record, epoch });
          return { kind: "handoff-stage", requestId: record.id, message: "Continue observation of the exact retained handoff with legion_handoff. No stage/start/assignment replay." };
        }
        const prior = snapshot.handoffs.find(record => record.pin.task.id === intent.task.id);
        if (prior) {
          if (!isDeepStrictEqual(prior.pin.task, intent.task) || prior.purpose !== intent.purpose || prior.continuation !== intent.continuation) throw new Error("Conflicting handoff request. Continue the retained ID; one successor only.");
          await this.handoffAuthority({ record: prior, epoch });
          return { kind: "handoff-stage", requestId: prior.id, message: "Same immutable handoff retained; explicit continuation observes its saved attempt." };
        }
        if (snapshot.corrections.some(record => record.task.id === intent.task.id && record.state.kind === "queued" && record.state.dispatch === "sent"))
          throw new Error("Correction delivery is still pending. Reconcile the exact old delivery before handoff; never transfer it automatically.");
        const scope = this.approval(snapshot, intent.task);
        const task = view.tasks.find(task => task.id === intent.task.id);
        if (task?.claim.kind !== "owned" || task.claim.workspace.kind !== "ready") throw new Error("Exact owned ready reservation required.");
        const reservation = task.claim.reservation;
        const repository = snapshot.workspaceRequests.find(request => request.repositoryId === reservation.repository);
        if (!repository?.repository) throw new Error("Repository history unavailable.");
        const ledger = new AssignmentLedger({ commonDir: repository.repository, owner: snapshot.id, expectedRepository: task.claim.reservation.repository, historyRequired: true });
        const predecessor = await ledger.readLaunch({ reservation: task.claim.reservation, known: this.currentLaunchId({ snapshot, task: task.id }) });
        const progress = predecessor?.state;
        if (!predecessor || !(progress?.kind === "assigned" || progress?.kind === "reported")) throw new Error("Known applied ordinary assignment required. Unknown startup/assignment blocks handoff.");
        const origin = snapshot.launchRequests.find(request => request.attempt === predecessor.id);
        if (!origin) throw new Error("Original launch authority missing.");
        await this.ownedTaskAuthority(origin, epoch);
        const record = HandoffRecord.parse({ id: randomUUID(), stop: randomUUID(), command: randomUUID(), purpose: intent.purpose, continuation: intent.continuation,
          modelPin: progress.assignment.modelPin, workflowChoice: progress.assignment.workflowChoice,
          pin: { owner: snapshot.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch, task: intent.task, scope, reservation: predecessor.reservation, assignment: progress.command, launch: predecessor.id, workerSession: progress.worker.address.session, workerGeneration: progress.worker.address.generation, addressDigest: createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex") }, state: { kind: "stopping" } });
        snapshot.handoffs.push(record);
        const revision = snapshot.revision++;
        await this.store.save(snapshot, revision, () => !!this.binding && !this.stopping && this.epoch === epoch);
        return { kind: "handoff-stage", requestId: record.id, message: "Immutable task-scoped handoff saved. Invoke legion_handoff with this requestId to safe-stop, observe settlement and continue once." };
      } catch (error) { return reject("handoff-authority", String(error)); }
    });
  }
  private async saveHandoff({ record, state, epoch }: { record: HandoffRecord; state: HandoffRecord["state"]; epoch: number }) {
    return this.serialize(async () => {
      const current = await this.handoffAuthority({ record, epoch });
      if (!isDeepStrictEqual(current.record.state, record.state)) throw new Error("Handoff progress changed. Observe retained state; no competing effect.");
      current.record.state = HandoffRecord.parse({ ...record, state }).state;
      const progress = state.kind === "held" ? state.last : state;
      if (progress.kind !== "stopping") this.retiredLaunches.add(record.pin.launch);
      const revision = current.state.revision++;
      await this.store.save(current.state, revision, () => !!this.binding && !this.stopping && this.epoch === epoch);
      return current.record;
    });
  }
  private checkArtifact({ record, worktree }: { record: SettledHandoff; worktree: string }) {
    const { path, tempRoot } = record.state.receipt.artifact;
    accessSync(path, constants.R_OK);
    const outside = relative(worktree, path);
    const rootOutside = relative(worktree, tempRoot);
    if (realpathSync(tempRoot) !== tempRoot || !lstatSync(tempRoot).isDirectory() || dirname(path) !== tempRoot ||
        realpathSync(path) !== path || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() ||
        !(outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside)) ||
        !(rootOutside === ".." || rootOutside.startsWith(`..${sep}`) || isAbsolute(rootOutside)))
      throw new Error("Exact native temporary artifact/root is unavailable or changed. No copy or reconstruction.");
  }
  private handoffSettlementUnresolved({ snapshot, record, observation }: { snapshot: LegatusSnapshot; record: HandoffRecord; observation: WorkerResourceObservation }) {
    return observation.live.kind !== "observed" || observation.live.value.principal !== "settled" || observation.live.value.busy || observation.live.value.pendingMessages || observation.live.value.admissionHold || observation.live.value.childrenOutstanding || observation.live.value.childrenHeld || observation.live.value.effectsOutstanding ||
      observation.children.some(child => child.disposition !== "settled") || snapshot.effects.some(effect => effect.intent.pin.launch === record.pin.launch && (effect.state.kind === "outstanding" || effect.state.kind === "unknown"));
  }
  private async validateHandoff({ record, epoch, host }: { record: SettledHandoff; epoch: number; host: TribunusHost }) {
    const current = await this.handoffAuthority({ record, epoch });
    const claims = await this.claims(current.state), claim = claims.byTask.get(record.pin.task.id);
    if (claim?.kind !== "owned" || claim.workspace.kind !== "ready" || claim.reservation.id !== record.pin.reservation || claim.reservation.approval.scope !== record.pin.scope) throw new Error("Exact handoff reservation ownership changed.");
    const ledger = new AssignmentLedger({ commonDir: current.origin.repository, owner: current.state.id, expectedRepository: current.origin.repositoryId, historyRequired: true, fault: this.options.assignments?.fault });
    const predecessor = await ledger.readLaunch({ reservation: claim.reservation, known: record.pin.launch });
    if (!predecessor || predecessor.state.kind !== "reported") throw new Error("Settled predecessor history missing; reported alone never proves settlement.");
    const worker = predecessor.state.worker;
    if (predecessor.state.command !== record.pin.assignment || createHash("sha256").update(JSON.stringify(worker.address)).digest("hex") !== record.pin.addressDigest ||
        !isDeepStrictEqual(predecessor.state.assignment.modelPin, record.modelPin) || !isDeepStrictEqual(predecessor.state.assignment.workflowChoice, record.workflowChoice)) throw new Error("Predecessor assignment/incarnation/pins changed.");
    const reader = this.options.resume?.worker({ owner: record.pin.owner, session: record.pin.session, generation: record.pin.generation, epoch: record.pin.epoch });
    if (!reader || !host.observeHandoff) throw new Error("Read-only native settlement/handoff observation unavailable. Restore host facilities.");
    const observation = await reader.observeResources({ launch: predecessor, cwd: claim.reservation.plan.path, signal: this.resumeSignal.signal });
    await this.handoffAuthority({ record, epoch });
    if (!this.retiredSettlement({ snapshot: current.state, launch: predecessor, observation }) || observation.retirement?.shutdown !== record.stop || this.handoffSettlementUnresolved({ snapshot: current.state, record, observation })) throw new Error("Actual predecessor/children/effects settlement is unresolved.");
    const stage = HandoffStageObservation.parse(await host.observeHandoff({ worker, request: this.handoffRequest(record) }));
    if (!this.handoffObservationMatches({ record, worker, observation: stage }) || stage.state.kind !== "settled" || !isDeepStrictEqual(stage.state.receipt, record.state.receipt)) throw new Error("Exact handoff stage/effect/path receipt is unresolved or changed.");
    const actual = await host.inspectWorker({ launch: predecessor, window: worker.address.window, cwd: claim.reservation.plan.path });
    if (!actual || !isDeepStrictEqual(actual.address, worker.address) || actual.resources.cwd !== claim.reservation.plan.path || actual.resources.principal?.model !== record.modelPin.model || actual.resources.principal.thinking !== record.modelPin.thinking || !actual.resources.principal.contextWindow || actual.resources.principal.contextWindow < 272000 || actual.resources.diagnostics.some(d => d.status !== "ready") || requiredWorkflowSkills(record.workflowChoice).some(name => !actual.resources.skills.some(skill => skill.name === name))) throw new Error("Actual predecessor selection/resources unavailable or changed. No fallback.");
    const git = this.options.resume?.repository(current.origin.repository);
    if (!git) throw new Error("Read-only Git association observation unavailable.");
    const observed = await git.observeResources({ plan: claim.reservation.plan, commonDir: current.origin.repository });
    if (observed.disposition !== "identified" || observed.dirty.kind !== "observed") throw new Error(`Same worktree association is unresolved. ${observed.reasons.join(" ")}`);
    this.checkArtifact({ record, worktree: claim.reservation.plan.path });
    const fresh = await this.handoffAuthority({ record, epoch });
    if (fresh.state.effects.some(effect => effect.intent.pin.launch === record.pin.launch && (effect.state.kind === "outstanding" || effect.state.kind === "unknown"))) throw new Error("Predecessor effect evidence changed during handoff observation.");
    return { ledger, reservation: claim.reservation, predecessor };
  }
  private handoffObservationMatches({ record, worker, observation }: { record: HandoffRecord; worker: z.infer<typeof VerifiedWorker>; observation: z.infer<typeof HandoffStageObservation> }) {
    return observation.handoff === record.id && observation.command === record.command && isDeepStrictEqual(observation.address, worker.address) &&
      isDeepStrictEqual(observation.authority, { owner: record.pin.owner, session: record.pin.session, generation: record.pin.generation, epoch: record.pin.epoch });
  }
  private async executeHandoff(id: string): Promise<OperationResult> {
    const epoch = this.epoch, host = this.options.tribuni?.host();
    let record: HandoffRecord | undefined;
    let entered = false;
    try {
      record = (this.selected ? await this.store.read(this.selected) : null)?.handoffs.find(record => record.id === id);
      if (!record) return reject("handoff-history", "Exact saved handoff missing. Do not reconstruct it.");
      const current = await this.handoffAuthority({ record, epoch });
      this.invocations++;
      entered = true;
      if (!host?.stop || !host.handoff || !host.observeHandoff) throw new Error("Addressed task stop/handoff/observation facilities unavailable. Restore host facilities; no alternate delivery.");
      const claims = await this.claims(current.state), claim = claims.byTask.get(record.pin.task.id);
      if (claim?.kind !== "owned" || claim.workspace.kind !== "ready") throw new Error("Owned handoff worktree unavailable.");
      const ledger = new AssignmentLedger({ commonDir: current.origin.repository, owner: current.state.id, expectedRepository: current.origin.repositoryId, historyRequired: true, fault: this.options.assignments?.fault });
      let predecessor = await ledger.readLaunch({ reservation: claim.reservation, known: record.pin.launch });
      if (!predecessor || !(predecessor.state.kind === "assigned" || predecessor.state.kind === "reported")) throw new Error("Known predecessor assignment/history unavailable.");
      const worker = predecessor.state.worker;
      if (record.state.kind === "held") record = await this.saveHandoff({ record, state: record.state.last, epoch });
      if (record.state.kind === "stopping") {
        await host.stop({ worker, shutdown: record.stop, command: record.pin.assignment, instruction: `Task-scoped safe-stop for ${record.pin.task.id}@${record.pin.task.revision}: finish only already-authorized safe effects, settle native children and principal, preserve all committed/index/dirty/untracked work, then park. No new implementation or delegation. A separately addressed handoff-only stage will follow actual settlement.` }, async observation => {
          const parsed = WorkerStop.parse(observation);
          if (!record || parsed.shutdown !== record.stop || parsed.command !== record.pin.assignment || !isDeepStrictEqual(parsed.address, worker.address) || !isDeepStrictEqual(parsed.authority, { owner: record.pin.owner, session: record.pin.session, generation: record.pin.generation, epoch: record.pin.epoch })) throw new Error("Task stop receipt does not join the exact predecessor authority/incarnation.");
        });
        await this.handoffAuthority({ record, epoch });
        const reader = this.options.resume?.worker({ owner: record.pin.owner, session: record.pin.session, generation: record.pin.generation, epoch: record.pin.epoch });
        if (!reader) throw new Error("Actual worker/children/effects observation unavailable; stop delivery is not settlement.");
        predecessor = await ledger.readLaunch({ reservation: claim.reservation, known: record.pin.launch });
        if (!predecessor || predecessor.state.kind !== "reported") throw new Error("Actual ordinary result/settlement is pending. Explicitly continue this same handoff after native settlement.");
        const observed = await reader.observeResources({ launch: predecessor, cwd: claim.reservation.plan.path, signal: this.resumeSignal.signal });
        // The read joins the retained task stop even when its direct delivery acknowledgement was lost.
        if (!this.retiredSettlement({ snapshot: current.state, launch: predecessor, observation: observed }) || observed.retirement?.shutdown !== record.stop || this.handoffSettlementUnresolved({ snapshot: current.state, record, observation: observed })) throw new Error("Actual safe-stop worker/children/effect settlement unresolved; delivery/parking alone is insufficient.");
        record = await this.saveHandoff({ record, state: { kind: "retired", retirementEvidence: observed.evidence }, epoch });
      }
      if (record.state.kind === "retired") {
        const retirementEvidence = record.state.retirementEvidence;
        record = await this.saveHandoff({ record, state: { kind: "handoff-dispatched", retirementEvidence }, epoch });
        const stage = HandoffStageObservation.parse(await host.handoff({ worker, request: this.handoffRequest(record) }));
        if (!this.handoffObservationMatches({ record, worker, observation: stage }) || stage.state.kind !== "settled") throw new Error(`Handoff-only stage unresolved: ${stage.state.kind}. Explicit continuation observes this exact intent, never resends it.`);
        record = await this.saveHandoff({ record, state: { kind: "handoff-settled", retirementEvidence, receipt: stage.state.receipt }, epoch });
      } else if (record.state.kind === "handoff-dispatched") {
        const stage = HandoffStageObservation.parse(await host.observeHandoff({ worker, request: this.handoffRequest(record) }));
        if (!this.handoffObservationMatches({ record, worker, observation: stage }) || stage.state.kind !== "settled") throw new Error("Known dispatched handoff remains unresolved; no intent replay.");
        record = await this.saveHandoff({ record, state: { kind: "handoff-settled", retirementEvidence: record.state.retirementEvidence, receipt: stage.state.receipt }, epoch });
      }
      const progress = record.state;
      if (progress.kind !== "handoff-settled" && progress.kind !== "successor-reserved") throw new Error("Handoff progress is unresolved.");
      const settled = SettledHandoff.parse({ ...record, state: { kind: "handoff-settled", retirementEvidence: progress.retirementEvidence, receipt: progress.receipt } });
      const validated = await this.validateHandoff({ record: settled, epoch, host });
      let successor = progress.kind === "successor-reserved"
        ? await validated.ledger.readLaunch({ reservation: validated.reservation, known: progress.launch })
        : await validated.ledger.readSuccessor({ reservation: validated.reservation, predecessor: record.pin.launch, handoff: record.id });
      if (progress.kind === "successor-reserved" && !successor) throw new Error("Known successor history missing. Never allocate replacement.");
      if (!successor) successor = await validated.ledger.beginSuccessor({ ...validated, handoff: settled, owned: () => !!this.binding && !this.stopping && this.epoch === epoch });
      if (!successor.successor || successor.successor.handoff !== record.id || successor.successor.predecessor !== record.pin.launch) throw new Error("Successor receipt/history conflicts.");
      if (record.state.kind !== "successor-reserved") record = await this.saveHandoff({ record, state: { kind: "successor-reserved", retirementEvidence: progress.retirementEvidence, receipt: progress.receipt, launch: successor.id }, epoch });
      return await this.executeLaunch({ id: current.origin.id, successor: { record, settled, launch: successor } });
    } catch (error) {
      const message = `Handoff held. Preserve exact request, resources and temporary path; no reconstruction or blind replay. ${String(error)}`;
      if (record && record.state.kind !== "held") {
        try { await this.saveHandoff({ record, state: { kind: "held", last: record.state, message }, epoch }); } catch { /* Publication may have committed; explicit continuation reads the saved request. */ }
      }
      return reject("handoff-held", message);
    } finally {
      if (entered) this.invocations--;
      if (this.stopRequested) await this.reconcileStop();
      else if (this.stopping && !this.invocations) this.revoke();
    }
  }
  private async launchViews({ snapshot, claims, fallback }: {
    snapshot: LegatusSnapshot | null;
    claims: Map<string, ClaimView>;
    fallback: ClaimView;
  }) {
    const views = new Map<string, LaunchView>();
    if (!snapshot) return views;
    for (const { id: task } of snapshot.tasks) {
      const claim = claims.get(task) ?? fallback;
      if (claim.kind !== "owned") {
        if (snapshot.launchRequests.some((request) => request.task.id === task))
          views.set(task, { kind: "unavailable", message: claim.kind === "unavailable" ? claim.message : "Known launch ownership is unavailable. Preserve its workers and resources." });
        continue;
      }
      const request = snapshot.workspaceRequests.find((r) => r.repositoryId === claim.reservation.repository);
      if (!request?.repository) {
        views.set(task, { kind: "unavailable", message: "Assignment repository witness is unavailable. Preserve launch history." });
        continue;
      }
      try {
        views.set(task, await new AssignmentLedger({
          commonDir: request.repository,
          owner: snapshot.id,
          fault: this.options.assignments?.fault,
          expectedRepository: request.repositoryId,
          historyRequired: true,
        }).launchState(claim.reservation, this.currentLaunchId({ snapshot, task })));
      } catch (error) { views.set(task, { kind: "unavailable", message: String(error) }); }
    }
    return views;
  }
  private async resumeHistory({ snapshot, epoch, noWorkInitialization = new Set<string>() }: { snapshot: LegatusSnapshot; epoch: number; noWorkInitialization?: Set<string> }) {
    const claims = await this.claims(snapshot);
    const noAdmittedResources = !claims.all.length && !snapshot.workspaceRequests.some(request => request.repositoryId) && !snapshot.launchRequests.length && !snapshot.handoffs.length && !snapshot.effects.length && !hasLegacyResearchHold(snapshot);
    // A published resume generation witnesses reconciliation of its older pending requests,
    // never of a request admitted later in that same generation.
    if (snapshot.workspaceRequests.some(request => request.repository && !request.repositoryId &&
        !(snapshot.resumeState && request.generation < snapshot.resumeState.generation) &&
        !(noAdmittedResources && noWorkInitialization.has(request.repository))))
      throw new Error("Pending/legacy repository authority has no durable no-effect witness. Preserve its exact request and history; do not infer safety from empty rows or retry.");
    if (claims.fallback.kind === "unavailable" && (snapshot.workspaceRequests.some(request => request.repository) || snapshot.launchRequests.length)) throw new Error(claims.fallback.message);
    for (const request of snapshot.workspaceRequests.filter(request => request.repositoryId)) {
      if (!request.repository) throw new Error(`Repository path missing for saved request ${request.id}.`);
      const ledger = new AssignmentLedger({ commonDir: request.repository, owner: snapshot.id, expectedRepository: request.repositoryId, historyRequired: true });
      const replay = await ledger.replay(snapshot.id, request.id, request.fingerprint);
      if (!replay) throw new Error(`Saved workspace request ${request.id} has no matching receipt/history. Do not recreate it.`);
      if (replay.receipt.reservation.repository !== request.repositoryId) throw new Error("Saved request repository identity differs from its receipt.");
    }
    for (const request of snapshot.launchRequests) {
      const claim = claims.byTask.get(request.task.id);
      if (claim?.kind !== "owned" || claim.reservation.repository !== request.repositoryId || claim.reservation.approval.scope !== request.scope)
        throw new Error(`Saved launch ${request.id} has no exact owned reservation/history.`);
      await new AssignmentLedger({ commonDir: request.repository, owner: snapshot.id, expectedRepository: request.repositoryId, historyRequired: true }).launchState(claim.reservation, request.attempt);
    }
    for (const record of snapshot.handoffs) {
      const origin = this.handoffOrigin({ snapshot, record }), claim = claims.byTask.get(record.pin.task.id);
      if (claim?.kind !== "owned" || claim.reservation.id !== record.pin.reservation) throw new Error("Known handoff reservation history unavailable.");
      const ledger = new AssignmentLedger({ commonDir: origin.repository, owner: snapshot.id, expectedRepository: origin.repositoryId, historyRequired: true });
      const predecessor = await ledger.readLaunch({ reservation: claim.reservation, known: record.pin.launch });
      const prior = predecessor?.state.kind === "held" ? predecessor.state.last : predecessor?.state;
      if (!predecessor || !prior || !("assignment" in prior) || prior.command !== record.pin.assignment || createHash("sha256").update(JSON.stringify(prior.worker.address)).digest("hex") !== record.pin.addressDigest || !isDeepStrictEqual(prior.assignment.modelPin, record.modelPin) || !isDeepStrictEqual(prior.assignment.workflowChoice, record.workflowChoice)) throw new Error("Known handoff predecessor/assignment history missing or changed.");
      const progress = record.state.kind === "held" ? record.state.last : record.state;
      const successor = await ledger.readSuccessor({ reservation: claim.reservation, predecessor: record.pin.launch, handoff: record.id });
      if (progress.kind === "successor-reserved") {
        const known = await ledger.readLaunch({ reservation: claim.reservation, known: progress.launch });
        if (!known || !successor || known.id !== successor.id) throw new Error("Known successor receipt/history missing. Preserve it; no replacement.");
      } else if (successor && progress.kind !== "handoff-settled") throw new Error("Successor allocation contradicts saved handoff progress. Preserve all history.");
    }
    const launches = new Map<string, LaunchRecord | null>();
    for (const claim of claims.all) {
      if (claim.kind !== "owned") throw new Error("Saved claim identity is unresolved.");
      const request = snapshot.workspaceRequests.find(request => request.repositoryId === claim.reservation.repository);
      if (!request?.repository) throw new Error("Saved repository witness unavailable.");
      launches.set(claim.reservation.id, await new AssignmentLedger({ commonDir: request.repository, owner: snapshot.id, expectedRepository: claim.reservation.repository, historyRequired: true }).readLaunch({ reservation: claim.reservation, known: this.currentLaunchId({ snapshot, task: claim.reservation.task }) }));
    }
    if (epoch !== this.epoch) throw new Error("Resume revoked during history observation.");
    return { ...claims, launches };
  }
  private workerObservationMatches({ snapshot, launch, observation }: { snapshot: LegatusSnapshot; launch: LaunchRecord; observation: WorkerResourceObservation }) {
    const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
    const origin = this.launchOrigin({ snapshot, launch });
    return "worker" in progress && !!origin && observation.launch === launch.id && observation.reservation === launch.reservation && observation.scope === launch.scope &&
      observation.process.kind === "alive" && observation.live.kind === "observed" && isDeepStrictEqual(observation.live.value.address, progress.worker.address) &&
      observation.live.value.command === ("assignment" in progress ? progress.command : null) &&
      isDeepStrictEqual(observation.live.value.controller, { owner: snapshot.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch });
  }
  private retiredSettlement({ snapshot, launch, observation }: { snapshot: LegatusSnapshot; launch: LaunchRecord; observation: WorkerResourceObservation }) {
    const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
    const retirement = observation.retirement;
    return this.workerObservationMatches({ snapshot, launch, observation }) && observation.evidence.length > 0 && observation.disposition === "settled" && !!retirement && retirement.state.kind === "parked" &&
      "worker" in progress && isDeepStrictEqual(retirement.address, progress.worker.address) && observation.live.kind === "observed" &&
      isDeepStrictEqual(retirement.authority, observation.live.value.controller) && isDeepStrictEqual(retirement, observation.live.value.retirement) && retirement.command === ("assignment" in progress ? progress.command : null);
  }
  private async resumeResources({ snapshot, epoch, claims }: { snapshot: LegatusSnapshot; epoch: number; claims: Awaited<ReturnType<Legion["claims"]>> }) {
    if (hasLegacyResearchHold(snapshot)) throw new Error("Unsupported legacy research activity is unresolved. Preserve it; no replacement or adoption.");
    const holds: NonNullable<LegatusSnapshot["resumeState"]>["holds"] = [];
    for (const claim of claims.all) {
      if (claim.kind !== "owned") throw new Error("Saved reservation ownership cannot be identified.");
      if (claim.workspace.kind !== "ready") throw new Error(`Retained Git operation for ${claim.reservation.task} is unresolved. Preserve its exact action; no retry.`);
      const request = snapshot.workspaceRequests.find(request => request.repositoryId === claim.reservation.repository);
      if (!request?.repository) throw new Error("Saved repository witness is missing.");
      const git = this.options.resume?.repository(request.repository);
      if (!git) throw new Error("Read-only Git resource observation unavailable. Restore resume dependencies; no attachment or new operation.");
      const observed = await git.observeResources({ plan: claim.reservation.plan, commonDir: request.repository });
      if (epoch !== this.epoch) throw new Error("Resume revoked during Git observation.");
      if (observed.disposition !== "identified" || observed.dirty.kind !== "observed") throw new Error(`Git resources are unresolved: ${observed.reasons.join(" ")}`);
      const ledger = new AssignmentLedger({ commonDir: request.repository, owner: snapshot.id, expectedRepository: claim.reservation.repository, historyRequired: true });
      const handoff = snapshot.handoffs.find(record => record.pin.task.id === claim.reservation.task);
      if (handoff) {
        const origin = this.handoffOrigin({ snapshot, record: handoff });
        const predecessor = await ledger.readLaunch({ reservation: claim.reservation, known: handoff.pin.launch });
        if (!predecessor) throw new Error("Known handoff predecessor is missing.");
        const reader = this.options.resume?.worker({ owner: snapshot.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch });
        if (!reader) throw new Error("Handoff predecessor observation unavailable.");
        const observed = await reader.observeResources({ launch: predecessor, cwd: claim.reservation.plan.path, signal: this.resumeSignal.signal });
        if (!this.workerObservationMatches({ snapshot, launch: predecessor, observation: observed })) throw new Error("Retained handoff predecessor liveness/action identity is unresolved. Preserve it; no reconstructed controller.");
        const progress = handoff.state.kind === "held" ? handoff.state.last : handoff.state;
        const retired = this.retiredSettlement({ snapshot, launch: predecessor, observation: observed }) && observed.retirement?.shutdown === handoff.stop;
        if (progress.kind === "handoff-dispatched") {
          const prior = predecessor.state.kind === "held" ? predecessor.state.last : predecessor.state;
          if (!("worker" in prior) || !reader.observeHandoff) throw new Error("Read-only unresolved handoff-stage observation unavailable. No replay on resume.");
          const stage = HandoffStageObservation.parse(await reader.observeHandoff({ worker: prior.worker, request: this.handoffRequest(handoff) }));
          if (!this.handoffObservationMatches({ record: handoff, worker: prior.worker, observation: stage })) throw new Error("Unresolved handoff observation has a different retained identity.");
          if (stage.state.kind === "unknown" || stage.state.kind === "held") throw new Error("Retained handoff stage/effect outcome is unresolved. Resume cannot repair or replay it.");
          if (stage.state.kind === "settled") this.checkArtifact({ record: SettledHandoff.parse({ ...handoff, state: { kind: "handoff-settled", retirementEvidence: progress.retirementEvidence, receipt: stage.state.receipt } }), worktree: claim.reservation.plan.path });
        }
        if ("receipt" in progress) {
          this.checkArtifact({ record: SettledHandoff.parse({ ...handoff, state: { kind: "handoff-settled", retirementEvidence: progress.retirementEvidence, receipt: progress.receipt } }), worktree: claim.reservation.plan.path });
          const prior = predecessor.state.kind === "held" ? predecessor.state.last : predecessor.state;
          if (!("worker" in prior) || !reader.observeHandoff) throw new Error("Read-only retained handoff-stage observation unavailable. No stage retransmission on resume.");
          const stage = HandoffStageObservation.parse(await reader.observeHandoff({ worker: prior.worker, request: this.handoffRequest(handoff) }));
          if (!this.handoffObservationMatches({ record: handoff, worker: prior.worker, observation: stage }) || stage.state.kind !== "settled" || !isDeepStrictEqual(stage.state.receipt, progress.receipt)) throw new Error("Exact retained handoff-stage receipt is unresolved or changed.");
        }
        holds.push({ task: claim.reservation.task, reservation: claim.reservation.id, message: `Retained handoff ${handoff.id} is observation-only after resume. Never revive either actor, replay its stage or allocate another successor.`, evidence: observed.evidence, activity: retired ? "retired-settled" : "unresolved", result: null });
        if (progress.kind === "stopping" || progress.kind === "retired" || progress.kind === "handoff-dispatched") continue;
        if (progress.kind !== "successor-reserved") {
          const allocated = await ledger.readSuccessor({ reservation: claim.reservation, predecessor: handoff.pin.launch, handoff: handoff.id });
          if (allocated) throw new Error("Unpublished successor allocation requires exact original-authority reconciliation; resume cannot dispatch it.");
          continue;
        }
      }
      const attempt = this.currentLaunchId({ snapshot, task: claim.reservation.task });
      const launch = await ledger.readLaunch({ reservation: claim.reservation, known: attempt });
      if (!launch || launch.state.kind === "prepared") continue;
      const origin = this.launchOrigin({ snapshot, launch });
      if (!origin) throw new Error(`Original launch authority/history is unavailable for ${launch.id}. Preserve it; no reconstructed controller.`);
      const reader = this.options.resume?.worker({ owner: snapshot.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch });
      if (!reader) throw new Error(`Read-only worker observation unavailable for launch ${launch.id}. Preserve it; no control retransmission.`);
      const observedWorker = await reader.observeResources({ launch, cwd: claim.reservation.plan.path, signal: this.resumeSignal.signal });
      if (epoch !== this.epoch) throw new Error("Resume revoked during worker observation.");
      if (observedWorker.launch !== launch.id || observedWorker.reservation !== claim.reservation.id || observedWorker.scope !== launch.scope)
        throw new Error("Worker observation does not join the exact saved launch/reservation/scope.");
      const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
      if (!this.workerObservationMatches({ snapshot, launch, observation: observedWorker }))
        throw new Error(`Worker liveness/action identity is unresolved. ${observedWorker.reasons.join(" ")} ${observedWorker.recommendation}`);
      holds.push({ task: claim.reservation.task, reservation: claim.reservation.id,
        message: `${observedWorker.reasons.join(" ")} ${observedWorker.recommendation} Run continuation never restores old worker authority.`, evidence: observedWorker.evidence,
        activity: this.retiredSettlement({ snapshot, launch, observation: observedWorker }) ? "retired-settled" : "unresolved",
        result: "assignment" in progress && observedWorker.report?.command === progress.command && isDeepStrictEqual(observedWorker.report.address, progress.worker.address)
          ? { outcome: observedWorker.report.outcome, evidence: observedWorker.report.evidence } : null });
    }
    if (snapshot.effects.some(effect => effect.state.kind === "outstanding" || effect.state.kind === "unknown"))
      throw new Error("Retained native effect outcome is unresolved. Reconcile the exact action evidence; process/session liveness is not outcome proof.");
    return holds;
  }
  private async executeLaunch({ id, successor }: { id: string; successor?: { record: HandoffRecord; settled: SettledHandoff; launch: LaunchRecord } }): Promise<OperationResult> {
    const epoch = this.epoch;
    const git = this.options.assignments?.repository();
    const host = this.options.tribuni?.host();
    if (!git || !host) return reject("permission-path", "Launch requires a live guarded legion_launch tool context. No worker started.");
    const owned = () => !!this.binding && !this.stopping && this.epoch === epoch;
    let entered = false;
    try {
      const snapshot = this.selected ? await this.store.read(this.selected) : null;
      const original = snapshot?.launchRequests.find((r) => r.id === id);
      const request = original && successor ? LaunchRequest.parse({ ...original, nativeDispatch: undefined, startupSelection: successorStartupSelection(successor.launch.successor ?? (() => { throw new Error("Successor receipt missing"); })()), workflowChoice: successor.record.workflowChoice }) : original;
      const authorize = async () => successor ? this.handoffAuthority({ record: successor.record, epoch }) : this.authorized(request ?? (() => { throw new Error("Launch request missing"); })(), epoch);
      if (!request) return reject("launch-request", "No durably saved host launch request exists.");
      const authority = await authorize();
      const contextHold = this.contextAssignmentHold();
      if (contextHold) return reject("context-unresolved", contextHold);
      this.workspaceAuthority(request, epoch);
      this.invocations++;
      entered = true;
      const location = await git.locate();
      await authorize();
      if (location.commonDir !== request.repository) throw new Error("Repository association changed.");
      const ledger = new AssignmentLedger({
        commonDir: location.commonDir,
        owner: authority.state.id,
        fault: this.options.assignments?.fault,
        expectedRepository: request.repositoryId,
        historyRequired: true,
      });
      const observed = await ledger.observations(authority.state.id);
      await authorize();
      const claim = observed.byTask.get(request.task.id);
      if (claim?.kind !== "owned" || claim.workspace.kind !== "ready" || claim.reservation.approval.scope !== request.scope)
        return reject("launch-claim", "Confirmed owned current claim and ready workspace required. No worker started.");
      const reservation = claim.reservation;
      this.workerHosts.set(reservation.id, host);
      const revalidate = async () => {
        await authorize();
        const current = await ledger.observations(reservation.owner);
        await authorize();
        const currentClaim = current.byTask.get(request.task.id);
        if (currentClaim?.kind !== "owned" || JSON.stringify(currentClaim.reservation) !== JSON.stringify(reservation) || currentClaim.workspace.kind !== "ready")
          throw new Error("Claim authority changed. Preserve the launch.");
        if (successor) {
          await this.validateHandoff({ record: successor.settled, epoch, host });
          const retained = await ledger.readLaunch({ reservation, known: successor.launch.id });
          if (!retained) throw new Error("Known successor history missing before dispatch.");
          const phase = retained.state.kind === "held" ? retained.state.last : retained.state;
          if ("worker" in phase) {
            const actual = await host.inspectWorker({ launch: retained, window: phase.worker.address.window, cwd: reservation.plan.path });
            if (!actual || !isDeepStrictEqual(actual.address, phase.worker.address) || actual.resources.cwd !== reservation.plan.path || actual.resources.principal?.model !== successor.record.modelPin.model || actual.resources.principal.thinking !== successor.record.modelPin.thinking || !actual.resources.principal.contextWindow || actual.resources.principal.contextWindow < 272000 || actual.resources.diagnostics.some(d => d.status !== "ready") || requiredWorkflowSkills(successor.record.workflowChoice).some(name => !actual.resources.skills.some(skill => skill.name === name))) throw new Error("Actual successor pin/resources changed or unavailable; no fallback or assignment replay.");
          }
        }
        const actual = await git.inspect(reservation.plan);
        await authorize();
        if (!actual.workspace || !actual.workspace.backlink || actual.workspace.commonDir !== ledger.commonDir || actual.workspace.branch !== reservation.plan.branch || actual.branch !== actual.workspace.commit || actual.path !== "directory")
          throw new Error("Ready workspace association changed. Preserve branch, path, and launch.");
      };
      await revalidate();
      const known = authority.state.launchRequests.find((r) => r.task.id === request.task.id && r.attempt)?.attempt ?? null;
      const retainedLaunch = successor ? await ledger.readLaunch({ reservation, known: successor.launch.id }) : await ledger.beginLaunch(reservation, owned, known);
      if (!retainedLaunch) throw new Error("Exact successor history disappeared; never recreate it.");
      let launch = retainedLaunch;
      if (!successor) await this.serialize(async () => {
        const current = await authorize();
        const saved = current.state.launchRequests.find((r) => r.id === request.id);
        if (!saved || (saved.attempt && saved.attempt !== launch.id)) throw new Error("Saved launch witness conflicts.");
        if (!saved.attempt) {
          saved.attempt = launch.id;
          const expected = current.state.revision++;
          await this.store.save(current.state, expected, owned);
        }
      });
      const save = async (state: LaunchRecord["state"], startEvidence = launch.startEvidence) => { launch = await ledger.updateLaunch(reservation, launch, state, owned, startEvidence); };
      const result = (): OperationResult => ({ kind: "launched", launch: { ...launch, state: projectLaunch(launch.state) }, message: launch.state.kind === "held" ? launch.state.message : `Tribunus launch ${launch.state.kind}. Assignment remains bounded and requires verified initialization.` });
      const hold = async (code: string, message: string) => {
        if (launch.state.kind !== "held") await save({ kind: "held", last: launch.state, code, message });
        return result();
      };
      const entryProgress = launch.state.kind === "held" ? launch.state.last : launch.state;
      const reconcileInitialization = !!successor && entryProgress.kind === "initializing";
      const reconcileAssignment = !!successor && entryProgress.kind === "assigning";
      const readAction = async () => {
        const reader = this.options.resume?.worker({ owner: successor?.record.pin.owner ?? authority.state.id, session: request.evidence.session, generation: request.generation, epoch });
        if (!reader) throw new Error("Read-only action reconciliation unavailable. Preserve the exact successor command; no replay.");
        const observed = await reader.observeResources({ launch, cwd: reservation.plan.path, signal: this.resumeSignal.signal });
        await authorize();
        const phase = launch.state.kind === "held" ? launch.state.last : launch.state;
        if (!("worker" in phase) || observed.launch !== launch.id || observed.reservation !== reservation.id || observed.scope !== launch.scope || observed.process.kind !== "alive" || observed.live.kind !== "observed" || !isDeepStrictEqual(observed.live.value.address, phase.worker.address) || !isDeepStrictEqual(observed.live.value.controller, { owner: authority.state.id, session: request.evidence.session, generation: request.generation, epoch })) throw new Error("Known successor action/incarnation is unresolved; no replay.");
        if (phase.kind === "assigning" && observed.live.value.command !== phase.command || phase.kind === "initializing" && observed.live.value.command !== null) throw new Error("Known successor application no longer matches its actual current command. Preserve it; no replay.");
        return observed.actions;
      };
      const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
      if (!("assignment" in progress)) {
        const failure = workflowFailure(request.workflowChoice ?? null);
        if (failure) return hold(failure.code, failure.message);
        if (!request.startupSelection) return hold("startup-selection-unknown", "Historical launch has no captured startup selection. Preserve the attempt; do not infer changed defaults or restart.");
      }
      if (launch.state.kind === "held") {
        if (!["startup-outcome-unknown", "initialization-outcome-unknown", "assignment-outcome-unknown"].includes(launch.state.code)) return result();
        await save(launch.state.last);
      }
      if (launch.state.kind === "prepared") {
        await revalidate();
        await save({ kind: "window-dispatched", operation: randomUUID() });
        if (!owned()) throw new Error("Authority revoked before window invocation.");
        try {
          if (!request.workflowChoice || !request.startupSelection) throw new Error("Captured startup choice unavailable.");
          if (successor) this.checkArtifact({ record: successor.settled, worktree: reservation.plan.path });
          const window = await host.createWindow({ launch, cwd: reservation.plan.path, workflowChoice: request.workflowChoice, startupSelection: request.startupSelection });
          await authorize();
          await save({ kind: "window-owned", window });
        } catch (error) { return hold("window-outcome-unknown", `Window creation outcome unknown. Preserve the dispatched attempt. No retry. ${String(error)}`); }
      }
      if (launch.state.kind === "window-dispatched") return hold("window-outcome-unknown", "Window creation has no conclusive owned identity. Preserve the attempt. No recreation or adoption.");
      if (launch.state.kind === "window-owned") {
        await revalidate();
        const window = launch.state.window;
        const dispatch = { kind: "pi-dispatched", operation: randomUUID(), window } satisfies LaunchRecord["state"];
        await save(dispatch);
        if (!owned()) throw new Error("Authority revoked before Pi invocation.");
        let startEvidence: LaunchRecord["startEvidence"];
        try {
          if (!request.startupSelection) throw new Error("Captured startup selection unavailable.");
          if (successor) this.checkArtifact({ record: successor.settled, worktree: reservation.plan.path });
          await host.startPi({ launch, window, startupSelection: request.startupSelection });
          startEvidence = { kind: "completed" };
        } catch (error) {
          startEvidence = { kind: "uncertain", message: String(error) };
        }
        await save(dispatch, startEvidence);
        await authorize();
      }
      const principalFailure = (resources: z.infer<typeof VerifiedWorker>["resources"]): string | null => {
        const principal = resources.principal;
        if (!principal?.model || principal.thinking === null || principal.contextWindow === null)
          return "Actual Tribunus model/thinking/window is unknown. Observe native principal metadata before managed assignment; no inferred defaults.";
        if (principal.contextWindow < 272000)
          return `Actual Tribunus ${principal.model} window ${principal.contextWindow}; at least 272000 tokens are required. Preserve the selected principal; no replacement.`;
        const diagnostic = resources.diagnostics.find(d => d.name === "Tribunus model");
        if (diagnostic?.status !== "ready") return diagnostic?.message ?? "Actual Tribunus native model/support/auth/thinking compatibility evidence is missing. Assignment withheld.";
        const intent = request.startupSelection;
        if (intent?.kind === "exact" && (principal.model !== intent.selection.model || principal.thinking !== intent.selection.thinking))
          return `Tribunus expected ${intent.selection.model}/${intent.selection.thinking}, observed ${principal.model}/${principal.thinking}. No substitution, relaunch or assignment.`;
        return null;
      };
      if (launch.state.kind === "pi-dispatched") {
        const worker = await host.inspectWorker({ launch, window: launch.state.window, cwd: reservation.plan.path });
        await authorize();
        if (!worker) return hold("startup-outcome-unknown", "Pi startup may have applied but exact worker identity is unavailable. Preserve window, worktree, claim, and attempt. No restart or replacement.");
        const verified = VerifiedWorker.parse(worker);
        if (verified.address.launch !== launch.id || JSON.stringify(verified.address.window) !== JSON.stringify(launch.state.window))
          return hold("worker-identity", "Worker incarnation or local Herdr identity does not match the owned launch. Assignment withheld.");
        await save({ kind: "verified", worker: verified });
        const incompatibility = principalFailure(verified.resources);
        if (incompatibility) return hold("worker-principal", incompatibility);
        if (verified.resources.cwd !== reservation.plan.path || verified.resources.diagnostics.some((d) => d.status !== "ready") || requiredWorkflowSkills(request.workflowChoice).some((name) => !verified.resources.skills.some((s) => s.name === name)))
          return hold("worker-resources", `Actual target worktree resources are missing or incompatible. No substitution or assignment. ${verified.resources.diagnostics.filter(d => d.status !== "ready").map(d => d.message).join(" ")}`);
      }
      if (launch.state.kind === "verified") {
        const incompatibility = principalFailure(launch.state.worker.resources);
        if (incompatibility) return hold("worker-principal", incompatibility);
        await authorize();
        await save({ kind: "initializing", worker: launch.state.worker, command: randomUUID() });
      }
      if (launch.state.kind === "initializing") {
        const phase = launch.state;
        this.workspaceAuthority(request, epoch);
        if (!request.workflowChoice) throw new Error("Captured workflow choice unavailable.");
        let observed: Awaited<ReturnType<TribunusHost["initialize"]>>;
        try {
          if (reconcileInitialization) {
            const action = (await readAction()).find(action => action.kind === "initialize" && action.command === phase.command);
            observed = action?.kind === "initialize" ? action.receipt : null;
          } else observed = await host.initialize({ worker: phase.worker, command: phase.command, workflowChoice: request.workflowChoice });
        }
        catch (error) { return hold("initialization-outcome-unknown", `Native initialization is unresolved or refused. Preserve the same command and worker; no alternate skill or toggle. ${String(error)}`); }
        await authorize();
        if (!observed) return hold("initialization-outcome-unknown", "Native initialization has no conclusive applied and settled evidence. Assignment withheld. Preserve the same command and worker.");
        const initialization = Initialization.parse(observed);
        const skill = phase.worker.resources.skills.find((s) => s.name === "poteto-mode");
        const profileMatches = initialization.profile === request.workflowChoice.profile;
        const controllerEvidence = request.workflowChoice.profile === "poteto-mode"
          ? initialization.skillPath === skill?.path && !!skill && initialization.nativePrompt.includes(`<skill name="poteto-mode" location="${skill.path}">`)
          : initialization.nativePrompt === mattInitializationPrompt(phase.command) && initialization.skillPath === "";
        if (!profileMatches || !controllerEvidence || initialization.command !== phase.command || JSON.stringify(initialization.address) !== JSON.stringify(phase.worker.address) || !initialization.modeEntry || !initialization.settledEntry)
          return hold("initialization-evidence", "Native prompt, newly applied pstack mode, settlement, command, or worker identity do not agree. Assignment withheld.");
        await save({ kind: "initialized", worker: phase.worker, initialization });
      }
      if (launch.state.kind === "initialized") {
        const phase = launch.state;
        await revalidate();
        const observed = await host.inspectWorker({ launch, window: phase.worker.address.window, cwd: reservation.plan.path });
        const current = await authorize();
        if (!observed || JSON.stringify(observed.address) !== JSON.stringify(phase.worker.address))
          return hold("worker-changed", "Exact initialized worker changed before assignment. Preserve the worker. No successor adoption.");
        const incompatibility = principalFailure(observed.resources);
        if (incompatibility) {
          await save({ ...phase, worker: { ...phase.worker, resources: observed.resources } });
          return hold("worker-principal", incompatibility);
        }
        if (observed.resources.cwd !== reservation.plan.path || observed.resources.diagnostics.some((d) => d.status !== "ready") || JSON.stringify(observed.resources.skills) !== JSON.stringify(phase.worker.resources.skills))
          return hold("worker-changed", "Actual target resources changed before assignment. Preserve the worker. No substitution.");
        const principal = observed.resources.principal;
        if (!principal?.model || principal.thinking === null) throw new Error("Actual principal selection unavailable.");
        const task = current.state.tasks.find((t) => t.id === request.task.id)?.history.at(-1);
        if (!task) throw new Error("Current task unavailable.");
        const workflowChoice = request.workflowChoice;
        if (!workflowChoice || workflowFailure(workflowChoice)) throw new Error("Captured explicit workflow choice unavailable. Assignment withheld.");
        const workflow = workflowChoice.profile === "poteto-mode" ? "poteto-mode" : workflowChoice.requestedWorkflow;
        const assignment = BoundedAssignment.parse({ task: request.task, scope: request.scope, goal: task.goal, acceptance: task.acceptance, workflow, workflowChoice, authority: "bounded-implementation-only", ...(launch.successor ? { handoff: launch.successor } : {}), modelPin: { model: principal.model, thinking: principal.thinking, profile: workflowChoice.profile } });
        await save({ kind: "assigning", worker: { ...phase.worker, resources: observed.resources }, initialization: phase.initialization, command: randomUUID(), assignment });
      }
      if (launch.state.kind === "assigning") {
        const phase = launch.state;
        await revalidate();
        this.workspaceAuthority(request, epoch);
        let application: Awaited<ReturnType<TribunusHost["assign"]>>;
        try {
          if (reconcileAssignment) {
            const action = (await readAction()).find(action => action.kind === "assign" && action.command === phase.command);
            application = action?.kind === "assign" ? action.receipt : null;
          } else application = await host.assign(phase);
        } catch (error) {
          if (!successor) throw error;
          return hold("assignment-outcome-unknown", `Exact successor assignment application unresolved; no replay. ${String(error)}`);
        }
        if (!application) return hold("assignment-outcome-unknown", "Assignment application is unknown. Preserve the same addressed command. Do not send another assignment.");
        await authorize();
        await save({ ...phase, kind: "assigned", application: application.application });
      }
      if (launch.state.kind === "assigned") {
        const assigned = launch.state;
        const principal = `tribunus:${assigned.worker.address.launch}`;
        const identity = JSON.stringify({ principal, address: assigned.worker.address, command: assigned.command, owner: this.selected, generation: request.generation, epoch });
        if (this.settings && !this.contextAlerts.view()[principal]) this.contextAlerts.observe(principal, { identity, model: assigned.assignment.modelPin?.model ?? null, sample: { kind: "missing", tokens: null, contextWindow: assigned.worker.resources.principal?.contextWindow ?? null, sampledAt: Date.now(), reason: "Awaiting current addressed Tribunus context observation" } }, this.settings.context);
        const dispose = host.watchContext?.({ worker: assigned.worker, command: assigned.command }, async observation => {
          if (!await this.ordinaryWatcherCurrent(launch.id)) return;
          const current = await this.ownedTaskAuthority(request, epoch);
          if (request.nativeDispatch) {
            const origin = this.appliedNativeAuthority(current.state, request.nativeDispatch, request.evidence.session, request.generation);
            if (origin.dispatch.workflow !== assigned.assignment.workflow) return;
          }
          if (!this.settings || observation.authority.owner !== current.state.id || observation.authority.session !== this.options.session || observation.authority.generation !== request.generation || observation.authority.epoch !== epoch || observation.command !== assigned.command || !isDeepStrictEqual(observation.address, assigned.worker.address)) return;
          const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
          if (!(progress.kind === "assigned" || progress.kind === "reported") || progress.command !== assigned.command || !isDeepStrictEqual(progress.worker.address, assigned.worker.address) || !isDeepStrictEqual(progress.assignment, assigned.assignment)) return;
          if (observation.sequence <= (this.contextSequences.get(identity) ?? 0)) return;
          this.contextSequences.set(identity, observation.sequence);
          const sample: ContextSample = assigned.assignment.modelPin && observation.model !== assigned.assignment.modelPin.model ? { ...observation.sample, kind: "stale", reason: "Actual assigned model changed; observation unresolved" } : observation.sample;
          const alert = this.contextAlerts.observe(principal, { identity, model: observation.model, sample }, this.settings.context);
          if (alert) this.options.onContextAlert?.(alert);
          this.options.onContextUpdate?.();
        }, (message, observation) => {
          if (this.retiredLaunches.has(assigned.worker.address.launch)) return;
          try { this.workspaceAuthority(request, epoch); } catch { return; }
          const previous = this.contextAlerts.view()[principal];
          if (!previous || previous.identity !== identity || !this.settings) return;
          if (observation && (observation.authority.owner !== this.selected || observation.authority.session !== this.options.session || observation.authority.generation !== request.generation || observation.authority.epoch !== epoch || observation.command !== assigned.command || !isDeepStrictEqual(observation.address, assigned.worker.address) || observation.sequence <= (this.contextSequences.get(identity) ?? 0))) return;
          this.contextAlerts.observe(principal, { ...previous, sample: { ...previous.sample, kind: "stale", reason: message } }, this.settings.context);
          this.options.onContextUpdate?.();
        });
        if (dispose) this.contextWatchers.push(dispose);
        host.watchEffects?.({ worker: assigned.worker, command: assigned.command }, async message => EffectReply.parse(await this.submit(message)), message => this.options.tribuni?.onUnavailable?.(message));
        host.watchReports?.({ worker: assigned.worker, command: assigned.command }, async (report) => {
          if (!await this.ordinaryWatcherCurrent(launch.id)) return;
          if (report.command !== assigned.command || JSON.stringify(report.address) !== JSON.stringify(assigned.worker.address) || launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...launch.state, kind: "reported", report: { outcome: report.outcome, assistantText: report.assistantText, evidence: report.evidence, contract: report.contract, engineering: report.engineering } }, () => true);
        }, async (message) => {
          if (!await this.ordinaryWatcherCurrent(launch.id)) return;
          if (launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { kind: "held", last: launch.state, code: "report-evidence-unavailable", message: `Worker report evidence is unavailable. Preserve the applied assignment and receipt. ${message}` }, () => true);
        }, async observation => {
          if (!await this.ordinaryWatcherCurrent(launch.id)) return;
          if (observation.command !== assigned.command || !isDeepStrictEqual(observation.address, assigned.worker.address)) return;
          const current = launch.state;
          if (current.kind !== "assigned" && current.kind !== "reported") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...current, worker: { ...current.worker, resources: { ...current.worker.resources, children: observation.children } } }, () => true);
        });
      }
      return result();
    } catch (error) {
      return { kind: "uncertain", requestKey: successor?.record.id ?? id, message: `Launch authority or effect evidence unavailable. Preserve all resources and the saved attempt. No fallback or retry. ${String(error)}` };
    } finally {
      if (entered) this.invocations--;
      if (this.stopRequested) await this.reconcileStop();
      else if (this.stopping && !this.invocations) this.revoke();
    }
  }
  private async publishPendingStop(snapshot: LegatusSnapshot | null) {
    const pending = this.pendingStop, binding = this.binding;
    if (!snapshot || snapshot.shutdown || !pending || !binding || this.creating) return snapshot;
    if (this.stopPublication) {
      await this.stopPublication;
      return this.store.read(snapshot.id);
    }
    snapshot.shutdown = { ...pending, workers: [] };
    const expected = snapshot.revision++;
    this.stopPublication = this.store.save(snapshot, expected, () => binding === this.binding && this.stopRequested && pending === this.pendingStop);
    try {
      await this.stopPublication;
      return snapshot;
    } finally {
      this.stopPublication = null;
    }
  }
  private async finishStop() {
    if (!this.stopRequested || this.invocations || this.creating) return;
    const view = await this.state();
    if (view.unavailable || !view.snapshot?.shutdown || hasUnsettledWork(view.snapshot, new Map(view.tasks.map(task => [task.id, task.launch])))) return;
    this.stopRequested = false;
    this.pendingStop = null;
    this.revoke();
  }
  private async reconcileStop(): Promise<string | null> {
    try {
      if (this.selected) await this.publishPendingStop(await this.store.read(this.selected));
      await this.requestWorkerStops();
      await this.finishStop();
      return null;
    } catch (error) {
      return String(error);
    }
  }
  async state(): Promise<LegionView> {
    try {
      const snapshot = this.selected
        ? await this.store.read(this.selected)
        : await this.store.find(this.options.session, this.options.context);
      if (snapshot && this.uncertain?.id === snapshot.id) this.uncertain = null;
      const claims = await this.claims(snapshot);
      const launches = await this.launchViews({ snapshot, claims: claims.byTask, fallback: claims.fallback });
      const unsettled = hasUnsettledWork(snapshot, launches);
      return {
        mode: this.stopping || unsettled && (!this.binding || this.stopRequested || !!snapshot?.shutdown) ? "stopping" : this.binding ? "active" : "inactive",
        context: this.contextAlerts.view(),
        ownerObservations: claims.all,
        snapshot,
        tasks:
          snapshot?.tasks.map((t) => ({
            ...t,
            claim: claims.byTask.get(t.id) ?? claims.fallback,
            launch: launches.get(t.id) ?? { kind: "not-launched" },
            tribunusModel: this.assignmentModelIntent({ launch: launches.get(t.id), handoff: snapshot?.handoffs.find(record => record.pin.task.id === t.id) }),
            ...this.taskWorkflow(snapshot, t.id, launches.get(t.id)),
            resumeHold: snapshot.resumeState?.holds.find(hold => hold.task === t.id)?.message ?? null,
            correctionHold: correctionHold({ snapshot, taskId: t.id }),
            eligibility:
              !this.binding || this.stopping
                ? "inactive"
                : correctionHold({ snapshot, taskId: t.id }) || snapshot.resumeState?.holds.some(hold => hold.task === t.id) || snapshot.decisions.some(
                      (d) =>
                        d.state.kind === "open" &&
                        d.history.at(-1)?.affected.some((a) => a.id === t.id),
                    )
                  ? "blocked"
                  : "admitted",
          })) ?? [],
        ...this.settingsView(),
        diagnostics: this.activationDiagnostics,
        unavailable: this.pendingStop && !snapshot?.shutdown ? "Shutdown publication is pending. Preserve ownership and repeat explicit off when storage is available." : null,
      };
    } catch (error) {
      return {
        mode: this.stopping ? "stopping" : this.binding ? "active" : "inactive",
        snapshot: null,
        tasks: [],
        context: this.contextAlerts.view(),
        ...this.settingsView(),
        diagnostics: this.activationDiagnostics,
        unavailable: String(error),
      };
    }
  }
  private nativeAuthority(state: LegatusSnapshot, id: string, session: string, generation: number) {
    const origin = this.appliedNativeAuthority(state, id, session, generation);
    if (origin.dispatch.workflow !== state.workflowChoice.requestedWorkflow || workflowFailure(state.workflowChoice))
      throw new Error("No current native workflow eligibility for new managed dispatch.");
    return origin;
  }
  // Pinned assignment observation requires its applied origin, not eligibility for future dispatch.
  private appliedNativeAuthority(state: LegatusSnapshot, id: string, session: string, generation: number) {
    const source = state.submissions.find(source => source.workflowDispatch && "id" in source.workflowDispatch && source.workflowDispatch.id === id);
    const continuation = state.resumeState?.continuation;
    const dispatch = continuation?.dispatch && "id" in continuation.dispatch && continuation.dispatch.id === id ? continuation.dispatch : source?.workflowDispatch;
    const origin = source ?? state.submissions.find(source => source.id === continuation?.root.id && source.revision === continuation.root.revision);
    if (!this.binding || this.stopping || !dispatch || dispatch.kind !== "applied-native" ||
        session !== this.options.session || dispatch.session !== session || generation !== this.binding.generation ||
        dispatch.generation !== generation)
      throw new Error("No applied current native workflow origin. Off, resume or uncertain delivery withholds observation and managed dispatch.");
    return { source: origin, dispatch };
  }
  async nativeWorkflow(raw: unknown): Promise<OperationResult> {
    const input = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("prepare"), source: SubmissionRef, continuation: z.literal(true).optional(), id: z.uuid(), skillPath: z.string().min(1), input: z.string().min(1), prompt: z.string().min(1), session: z.string(), generation: z.int().positive() }),
      z.object({ kind: z.literal("hold"), source: SubmissionRef, continuation: z.literal(true).optional(), message: z.string(), session: z.string(), generation: z.int().positive() }),
      z.object({ kind: z.literal("applied"), id: z.uuid(), prompt: z.string(), journal: z.string().min(1), entry: z.string().min(1), session: z.string(), generation: z.int().positive() }),
      z.object({ kind: z.literal("uncertain"), id: z.uuid(), message: z.string(), session: z.string(), generation: z.int().positive() }),
    ]).safeParse(raw);
    if (!input.success) return reject("invalid", "Invalid native dispatch observation.");
    const epoch = this.epoch;
    return this.serialize(async () => {
      const data = input.data, binding = this.binding;
      if (!binding || this.stopping || data.session !== this.options.session || data.generation !== binding.generation || epoch !== this.epoch)
        return reject("provenance", "Current host native dispatch association required.");
      const state = this.selected ? await this.store.read(this.selected) : null;
      if (!state) return reject("unavailable", "Native dispatch state unavailable.");
      const savedContinuation = state.resumeState?.continuation;
      const continuation = ("continuation" in data && data.continuation || "id" in data && savedContinuation?.dispatch && "id" in savedContinuation.dispatch && savedContinuation.dispatch.id === data.id) ? savedContinuation : null;
      const source = state.submissions.find(source => continuation
        ? source.id === continuation.root.id && source.revision === continuation.root.revision
        : "source" in data ? source.id === data.source.id && source.revision === data.source.revision
        : source.workflowDispatch && "id" in source.workflowDispatch && source.workflowDispatch.id === data.id);
      const previous = continuation?.dispatch ?? source?.workflowDispatch;
      if (!source || !previous) return reject("native-source", "No exact saved native source/root. Preserve history.");
      const publishDispatch = (dispatch: z.infer<typeof WorkflowDispatch>) => {
        if (continuation) continuation.dispatch = dispatch;
        else source.workflowDispatch = dispatch;
      };
      if (data.kind === "prepare" || data.kind === "hold") {
        if (previous.kind !== "pending-native" && previous.kind !== "held-native")
          return reject("native-replay", "Native dispatch already attempted. Reconcile its journal; never replay an uncertain delivery.");
        const failure = workflowFailure(state.workflowChoice);
        if (data.kind === "hold") publishDispatch({ kind: "held-native", message: data.message });
        else {
          if (failure) return failure;
          const invocation = source.workflowInvocation;
          const prior = [...state.submissions].reverse().find(source => source.workflowDispatch?.kind === "applied-native");
          if (continuation && state.submissions.some(source => source.workflowDispatch?.kind === "dispatching-native" || source.workflowDispatch?.kind === "uncertain-native"))
            return reject("native-replay", "Original native prompt application is unresolved. Inspect its exact saved journal; no continuation replay.");
          const root = continuation?.root ?? (invocation ? { id: source.id, revision: source.revision } : prior?.workflowDispatch && "root" in prior.workflowDispatch ? prior.workflowDispatch.root : null);
          const workflow = state.workflowChoice.requestedWorkflow;
          if (!root || workflow === "unknown") return reject("native-source", "Explicit Emperor workflow source required.");
          publishDispatch({ kind: "dispatching-native", id: data.id, session: data.session, generation: data.generation, skillPath: data.skillPath, input: data.input, prompt: data.prompt, root, workflow });
        }
      } else {
        if (previous.kind !== "dispatching-native" || previous.id !== data.id || previous.session !== data.session || previous.generation !== data.generation)
          return reject("native-replay", "Native dispatch is not awaiting an applied witness.");
        if (data.kind === "applied") {
          if (data.prompt !== previous.prompt) return reject("native-prompt", "Native prompt witness differs from dispatch intent.");
          try {
            const entries: unknown[] = readFileSync(data.journal, "utf8").trim().split("\n").map(line => JSON.parse(line));
            const session = z.object({ type: z.literal("session"), id: z.literal(data.session) }).safeParse(entries[0]);
            const witness = entries.map(entry => z.object({ type: z.literal("message"), id: z.literal(data.entry), message: z.object({ role: z.literal("user"), content: z.union([z.string(), z.array(z.object({ type: z.literal("text"), text: z.string() }))]) }) }).safeParse(entry)).find(entry => entry.success);
            if (!session.success || !witness?.success) throw new Error("Exact session/user entry is absent.");
            const content = typeof witness.data.message.content === "string" ? witness.data.message.content : witness.data.message.content.map(part => part.text).join("\n");
            if (content !== previous.prompt) throw new Error("Persisted skill prompt differs.");
          } catch (error) { return reject("native-witness", `Applied journal witness unavailable. No managed dispatch. ${String(error)}`); }
          publishDispatch({ ...previous, kind: "applied-native", journal: data.journal, entry: data.entry });
        } else publishDispatch({ ...previous, kind: "uncertain-native", message: data.message });
      }
      const expected = state.revision++;
      try {
        await this.store.save(state, expected, () => this.binding === binding && epoch === this.epoch && !this.stopping);
        const dispatch = continuation?.dispatch ?? source.workflowDispatch;
        if (!dispatch) throw new Error("Native dispatch publication missing.");
        return { kind: "native-stage", source: { id: source.id, revision: source.revision }, dispatch, ...(continuation ? { continuation: true } : {}) };
      } catch (error) {
        this.revoke();
        return { kind: "uncertain", requestKey: "id" in data ? data.id : source.id, message: `Native dispatch storage uncertain. No delivery/replay authorized. ${String(error)}` };
      }
    });
  }
  async nativeRequest(raw: unknown): Promise<CommandResult> {
    const input = z.object({ dispatch: z.uuid(), session: z.string(), generation: z.int().positive(), text: z.string(), requestKey: z.string().min(1) }).strict().safeParse(raw);
    const denied = (message: string): CommandResult => ({ ...reject("native-authority", message), disposition: "none" });
    if (!input.success) return denied("Invalid bounded native workflow request.");
    const { text, requestKey, dispatch, session, generation } = input.data;
    const intent = commandIntent(text);
    if (!["reserve", "reconcile", "workspace", "launch", "handoff", "continue-handoff"].includes(intent.kind)) return denied("Native workflow may request only existing bounded reserve, reconcile, workspace, launch or explicit handoff stages. No profile, publication or Emperor command authority.");
    try {
      const state = this.selected ? await this.store.read(this.selected) : null;
      if (!state) return denied("Native state unavailable.");
      const authority = this.nativeAuthority(state, dispatch, session, generation);
      const taskId = intent.kind === "reserve" || intent.kind === "launch" || intent.kind === "handoff" ? intent.task.id : intent.kind === "continue-handoff" ? state.handoffs.find(record => record.id === intent.id)?.pin.task.id : intent.kind === "reconcile" ? intent.task : intent.kind === "workspace" ? state.workspaceRequests.find(request => request.id === intent.id)?.intent.task : null;
      const id = typeof taskId === "string" ? taskId : taskId?.id;
      const task = state.tasks.find(task => task.id === id);
      if (!task || !state.submissions.some(source => source.id === task.scope.original && source.workflowDispatch && "root" in source.workflowDispatch && source.workflowDispatch.root.id === authority.dispatch.root.id))
        return denied("Task is not admitted from this Emperor-approved native workflow source.");
      // Derived host authority is never supplied by the model and never changes Emperor provenance.
      return await this.command({ text, requestKey, nativeDispatch: dispatch, evidence: { origin: "host-command", transport: "source-unavailable", session, generation, presented: [] } });
    } catch (error) { return denied(String(error)); }
  }
  command(raw: unknown): Promise<CommandResult> {

    const handoffExecution = z.strictObject({ handoffRequest: z.uuid() }).safeParse(raw);
    if (handoffExecution.success) {
      const id = handoffExecution.data.handoffRequest;
      let run = this.handoffRuns.get(id);
      if (!run) {
        run = this.executeHandoff(id).finally(() => { this.handoffRuns.delete(id); });
        this.handoffRuns.set(id, run);
      }
      return run.then(result => ({ ...result, disposition: "workspace" }));
    }
    const launchExecution = z.object({ launchRequest: z.string().min(1) }).strict().safeParse(raw);
    if (launchExecution.success) return this.executeLaunch({ id: launchExecution.data.launchRequest }).then((result) => ({ ...result, disposition: "workspace" }));
    const execution = z
      .object({ workspaceRequest: z.string().min(1) })
      .strict()
      .safeParse(raw);
    if (execution.success)
      return this.executeWorkspace(execution.data.workspaceRequest).then(
        (result) => ({ ...result, disposition: "workspace" }),
      );
    const parsed = Command.safeParse(raw);
    if (!parsed.success)
      return Promise.resolve({
        ...reject("invalid", "Invalid command."),
        disposition: "none",
      });
    const intent = commandIntent(parsed.data.text);
    if (parsed.data.workflowInvocation && intent.kind !== "task")
      return Promise.resolve({ ...reject("provenance", "Explicit native workflow invocation must accompany task instructions."), disposition: "none" });
    const dispositions = {
      status: "observe",
      doctor: "observe",
      on: "activate",
      off: "off",
      resume: "resume",
      task: "submit",
      correction: "submit",
      "profile-on": "submit",
      "profile-off": "activate",
      workflow: "submit",
      reserve: "workspace",
      reconcile: "workspace",
      workspace: "workspace",
      launch: "workspace",
      handoff: "workspace",
      "continue-handoff": "workspace",
      "retired-research": "none",
      invalid: "none",
    } satisfies Record<CommandIntent["kind"], CommandResult["disposition"]>;
    const disposition = dispositions[intent.kind];
    return this.applyCommand(parsed.data, intent).then((result) => ({
      ...result,
      disposition: result.kind === "rejected" ? "none" : disposition,
    }));
  }
  private applyCommand(
    input: z.infer<typeof Command>,
    intent: CommandIntent,
  ): Promise<OperationResult> {
    if (intent.kind === "retired-research")
      return Promise.resolve(reject("retired-research", "Use ordinary native pi-subagents for research. /legion research is retired; use task research <text> only to submit an intake task."));
    if (intent.kind === "invalid")
      return Promise.resolve(
        reject(
          "usage",
          "Use on, task <text>, correction <task-id>@<revision> <text>, poteto-mode=on <instructions>, poteto-mode=off, implement-spec=on <instructions>, status [id], doctor, off, resume <id>, reserve <task-id>@<revision> --parent <refs/heads/branch> [--source <GitHub issue URL>], reconcile <task-id>, workspace <request-id>, launch <task-id>@<revision>, handoff <task-id>@<revision> --purpose <JSON-string> --continue <JSON-string>, or handoff <handoff-id>. Use task to escape reserved arguments.",
        ),
      );
    if (
      (input.evidence.origin !== "emperor" &&
        input.evidence.origin !== "host-command") ||
      input.evidence.session !== this.options.session
    )
      return Promise.resolve(
        reject(
          "provenance",
          "A trusted host command is required. Host command source may be unavailable.",
        ),
      );
    if (intent.kind === "off") {
      this.stopRequested = true;
      const generation = this.binding?.generation;
      if (generation && !this.pendingStop)
        this.pendingStop = { id: randomUUID(), generation, epoch: this.epoch };
      this.revoke();
      if (!generation) return this.state().then(view => ({ kind: "observed", view }));
      return this.serialize(async () => {
        const unavailable = await this.reconcileStop();
        const view = await this.state();
        return { kind: "observed", view: unavailable ? { ...view, unavailable } : view };
      });
    }
    const epoch = this.epoch;
    if (intent.kind === "correction" && (!this.binding || this.stopping))
      return Promise.resolve(reject("inactive", "Activate or explicitly resume the current Legatus before saving a targeted correction."));
    if (intent.kind === "handoff" || intent.kind === "continue-handoff")
      return this.recordHandoff({ input, intent });
    if (intent.kind === "launch")
      return this.serialize(async () => {
        const contextHold = this.contextAssignmentHold();
        if (contextHold) return reject("context-unresolved", contextHold);
        const view = await this.state();
        const task = view.tasks.find((t) => t.id === intent.task.id);
        if (view.mode !== "active") return reject("inactive", "Activate or explicitly resume Legion before launching work.");
        if (!view.snapshot) return reject("unavailable", "Intake records unavailable.");
        try {
          if (view.snapshot.handoffs.some(record => record.pin.task.id === intent.task.id))
            return reject("handoff-retired", "This task has a retained handoff. Continue its exact handoff ID; ordinary launch cannot revive or replace it.");
          const scope = this.approval(view.snapshot, intent.task);
          if (input.nativeDispatch) this.nativeAuthority(view.snapshot, input.nativeDispatch, input.evidence.session, input.evidence.generation ?? 0);
          if (input.evidence.generation !== null && input.evidence.generation !== this.binding?.generation) return reject("provenance", "Host launch association generation is stale.");
          if (task?.claim.kind !== "owned")
            return reject("launch-claim", "A confirmed durable claim owned by this Legatus is required. No worker started.");
          if (task.claim.workspace.kind !== "ready")
            return reject("launch-workspace", "Confirmed ready workspace required. Preserve any unresolved Git operation. No worker started.");
          if (task.claim.reservation.approval.scope !== scope)
            return reject("launch-approval", "Claim approval differs from current scope. No worker started.");
          if (task.launch.kind === "unavailable") return reject("launch-history", task.launch.message);
          if (task.workflowHold) {
            const failure = workflowFailure(task.workflowChoice);
            if (failure) return failure;
          }
          const reservation = task.claim.reservation;
          const prior = view.snapshot.launchRequests.find((r) => r.id === input.requestKey);
          if (prior && JSON.stringify(prior.task) !== JSON.stringify(intent.task))
            return reject("request-conflict", "Request key has a different launch payload.");
          if (prior) await this.authorized(prior, epoch);
          if (!prior) {
            const commonDir = view.snapshot.workspaceRequests.find((r) => r.repositoryId === reservation.repository)?.repository;
            if (!commonDir || !this.binding) return reject("launch-claim", "Claim repository witness unavailable.");
            const captured = view.snapshot.launchRequests.find(r => r.task.id === intent.task.id);
            const startupSelection = captured ? captured.startupSelection : this.settings?.tribuni_model
              ? { kind: "exact", selection: this.settings.tribuni_model } : { kind: "native-defaults" };
            const request = LaunchRequest.parse({ ...(input.nativeDispatch ? { nativeDispatch: input.nativeDispatch } : {}), startupSelection, id: input.requestKey, task: intent.task, scope, evidence: input.evidence, epoch, generation: this.binding.generation, repository: commonDir, repositoryId: task.claim.reservation.repository, ...(task.workflowChoice ? { workflowChoice: task.workflowChoice } : {}) });
            view.snapshot.launchRequests.push(request);
            const expected = view.snapshot.revision++;
            await this.store.save(view.snapshot, expected, () => !!this.binding && !this.stopping && this.epoch === epoch);
          }
          return { kind: "launch-stage", requestId: input.requestKey, message: "Saved launch request requires the guarded legion_launch stage. Assignment is withheld until verified initialization." };
        } catch (error) { return reject("launch-authority", String(error)); }
      });
    if (intent.kind === "reserve" || intent.kind === "reconcile")
      return this.recordWorkspace(input, intent, epoch);
    if (intent.kind === "workspace")
      return this.serialize(async () => {
        try {
          const state = this.selected
            ? await this.store.read(this.selected)
            : null;
          const request = state?.workspaceRequests.find(
            (r) => r.id === intent.id,
          );
          if (!request)
            return reject("request", "No recorded workspace request exists.");
          await this.authorized(request, epoch);
          return {
            kind: "workspace-stage",
            requestId: request.id,
            message: "Guarded workspace stage authorized. No worker started.",
          };
        } catch (error) {
          return reject("authority", String(error));
        }
      });
    return this.serialize(async () => {
      if (intent.kind === "status") {
        const id = intent.id;
        if (!id) return { kind: "observed", view: await this.state() };
        if (!LegatusId.safeParse(id).success)
          return reject("invalid-id", "Invalid Legatus ID.");
        const snapshot = await this.store.read(id);
        if (snapshot && this.uncertain?.id === snapshot.id)
          this.uncertain = null;
        const claims = await this.claims(snapshot);
        const launches = await this.launchViews({ snapshot, claims: claims.byTask, fallback: claims.fallback });
        return {
          kind: "observed",
          view: {
            mode: id === this.selected && this.stopping || hasUnsettledWork(snapshot, launches) ? "stopping" : "inactive",
            snapshot,
            context: id === this.selected ? this.contextAlerts.view() : {},
            ownerObservations: claims.all,
            tasks:
              snapshot?.tasks.map((t) => ({
                ...t,
                eligibility: "inactive",
                claim: claims.byTask.get(t.id) ?? claims.fallback,
                launch: launches.get(t.id) ?? { kind: "not-launched" },
                tribunusModel: this.assignmentModelIntent({ launch: launches.get(t.id), handoff: snapshot?.handoffs.find(record => record.pin.task.id === t.id) }),
                ...this.taskWorkflow(snapshot, t.id, launches.get(t.id)),
                resumeHold: snapshot.resumeState?.holds.find(hold => hold.task === t.id)?.message ?? null,
                correctionHold: correctionHold({ snapshot, taskId: t.id }),
              })) ?? [],
            ...this.settingsView(),
            diagnostics: this.activationDiagnostics,
            unavailable: snapshot ? null : "Legatus records were not found.",
          },
        };
      }
      if (intent.kind === "doctor")
        return {
          kind: "observed",
          view: {
            ...(await this.state()),
            diagnostics: [...await this.options.preflight(this.settings ?? undefined), ...this.activationDiagnostics.filter(d => d.status !== "ready")],
          },
        };
      if (
        this.uncertain &&
        this.uncertain.requestKey !== input.requestKey &&
        !(intent.kind === "resume" && intent.id === this.uncertain.id)
      )
        return reject(
          "reconcile",
          `Reconcile request ${this.uncertain.requestKey} before another mutation.`,
        );
      if (this.stopping)
        return reject(
          "stopping",
          "Legion is stopping. No new workspace operations will start. Reservations retained.",
        );
      const explicitActivation = intent.kind === "on" || intent.kind === "resume" || ["task", "profile-on", "profile-off", "workflow"].includes(intent.kind) && !this.binding;
      let prospectiveSettings = this.settings;
      const settingsDiagnostics: Diagnostic[] = [];
      if (explicitActivation) {
        let checkoutPath: string;
        try { checkoutPath = checkoutIdentity(this.options.context); }
        catch (error) { return reject("ownership", `Exclusive checkout ownership is unavailable. ${String(error)}`); }
        try {
          prospectiveSettings = await (this.options.loadSettings?.() ?? loadLegionSettings({ checkoutPath }));
        } catch (error) {
          prospectiveSettings = null;
          settingsDiagnostics.push({ name: "Legion settings", status: "incompatible", message: String(error) });
        }
        if (epoch !== this.epoch) return reject("revoked", "Activation was revoked.");
      }
      const diagnostics = [...await this.options.preflight(prospectiveSettings ?? undefined), ...settingsDiagnostics];
      if (epoch !== this.epoch)
        return reject("revoked", "Activation was revoked.");
      if (explicitActivation) this.activationDiagnostics = diagnostics;
      const resume = intent.kind === "resume" ? intent.id : null;
      const isActivation = intent.kind === "on" || intent.kind === "resume" || intent.kind === "profile-off";
      const taskText = intent.kind === "task" || intent.kind === "correction" || intent.kind === "profile-on" || intent.kind === "workflow" ? intent.text : "";
      const workflowInvocation = intent.kind === "workflow"
        ? WorkflowInvocation.parse({ kind: "legion-command", command: "implement-spec=on" })
        : intent.kind === "profile-on"
          ? WorkflowInvocation.parse({ kind: "legion-command", command: "poteto-mode=on" })
          : input.workflowInvocation;
      const ready = diagnostics.every((d) => d.status === "ready");
      if (!ready && isActivation) {
        this.revoke();
        return {
          kind: "observed",
          view: { ...(await this.state()), diagnostics },
        };
      }
      if (resume && this.binding && resume !== this.selected)
        return reject(
          "ownership",
          "Turn intake off before resuming a different Legatus.",
        );
      if (resume && !LegatusId.safeParse(resume).success)
        return reject("invalid-id", "Invalid Legatus ID.");
      if (resume && !this.store.exists(resume))
        return reject("not-found", "Legatus records were not found.");
      let ownership:
        | { kind: "owned" }
        | { kind: "acquiring"; association: DatabaseSync };
      try {
        ownership = this.binding
          ? { kind: "owned" }
          : {
              kind: "acquiring",
              association: await this.store.acquireAssociation({
                context: this.options.context,
                resume,
              }),
            };
      } catch (error) {
        return reject(
          "ownership",
          `Exclusive checkout ownership is unavailable. ${String(error)}`,
        );
      }
      let adopted = false;
      let recoveryLock: DatabaseSync | null = null;
      try {
        if (epoch !== this.epoch)
          return reject("revoked", "Activation was revoked.");
        let state: LegatusSnapshot | null;
        if (resume) {
          const id = resume;
          try {
            if (ownership.kind === "acquiring")
              recoveryLock = await this.store.acquire(id);
            state = await this.store.recover(
              id,
              this.options.context,
              () => epoch === this.epoch,
            );
            if (state && this.uncertain?.id === state.id) this.uncertain = null;
          } catch (error) {
            return reject(
              "ownership",
              `Exclusive intake recovery is unavailable. ${String(error)}`,
            );
          }
        } else {
          try {
            state = this.selected
              ? await this.store.read(this.selected)
              : await this.store.find(
                  this.options.session,
                  this.options.context,
                );
          } catch (error) {
            return reject(
              "unavailable",
              `Intake records are unavailable. ${String(error)}`,
            );
          }
        }
        if (resume && !state)
          return reject("not-found", "Legatus records were not found.");
        if (intent.kind === "correction") {
          if (input.evidence.generation !== null && input.evidence.generation !== this.binding?.generation)
            return reject("provenance", "Correction host association generation is stale.");
          if (!state?.tasks.some(task => task.id === intent.target.id && task.history.at(-1)?.revision === intent.target.revision))
            return reject("stale-task", "Correction target is not current. No correction was saved.");
        }
        let resumeClaims: Awaited<ReturnType<Legion["resumeHistory"]>> | null = null;
        const noWorkInitialization = new Set<string>();
        if (resume && state) {
          for (const commonDir of new Set(
            state.workspaceRequests.flatMap((r) =>
              r.repository ? [r.repository] : [],
            ),
          )) {
            try {
              const ledgerRoot = join(commonDir, "legion", "runs", state.id);
              // reserve cannot admit its transaction/Git dispatch until initialization publication returns.
              const initializing = existsSync(join(ledgerRoot, "assignments.pending")) && !existsSync(join(ledgerRoot, "assignments.initialized"));
              await new AssignmentLedger({
                commonDir,
                owner: state.id,
                fault: this.options.assignments?.fault,
                expectedRepository: state.workspaceRequests.find(
                  (r) => r.repository === commonDir && r.repositoryId,
                )?.repositoryId ?? null,
                historyRequired: true,
              }).recoverExisting(() => epoch === this.epoch);
              if (initializing) noWorkInitialization.add(commonDir);
            } catch (error) {
              return reject(
                "assignment-recovery",
                `Assignment authority unavailable. Reservations retained. ${String(error)}`,
              );
            }
          }
        }
        if (resume && state) {
          try { resumeClaims = await this.resumeHistory({ snapshot: state, epoch, noWorkInitialization }); }
          catch (error) { return reject("assignment-recovery", `Saved assignment history is unresolved. Preserve resources. ${String(error)}`); }
        }
        if (!resume && !state) {
          try {
            for (const retained of await this.store.retained(this.options.context)) {
              if (retained.workspaceRequests.some(request => request.repository) || retained.launchRequests.length) {
                try { await this.resumeHistory({ snapshot: retained, epoch }); }
                catch (error) { return reject("resume-required", `Saved run ${retained.id} has unresolved history. Explicitly /legion resume ${retained.id}. ${String(error)}`); }
              }
              const claims = await this.claims(retained);
              const launches = await this.launchViews({ snapshot: retained, claims: claims.byTask, fallback: claims.fallback });
              if (claims.fallback.kind === "unavailable" && retained.workspaceRequests.some(request => request.repository) || retained.workspaceRequests.some(request => request.repositoryId && !claims.byTask.has(typeof request.intent.task === "string" ? request.intent.task : request.intent.task.id)) ||
                  claims.all.some(claim => claim.kind !== "owned" || claim.workspace.kind !== "ready") || hasUnsettledWork(retained, launches) ||
                  [...launches.values()].some(launch => launch.kind !== "not-launched" && launch.kind !== "prepared") && !retained.shutdown ||
                  retained.submissions.some(source => source.workflowDispatch?.kind === "dispatching-native" || source.workflowDispatch?.kind === "uncertain-native") ||
                  retained.resumeState?.continuation?.dispatch.kind === "dispatching-native" || retained.resumeState?.continuation?.dispatch.kind === "uncertain-native")
                return reject("resume-required", `Saved run ${retained.id} has unresolved managed resources/actions. ${claims.fallback.kind === "unavailable" ? claims.fallback.message : ""} Explicitly /legion resume ${retained.id}; no new run bypass.`);
            }
          } catch (error) { return reject("resume-required", `Saved checkout history cannot be classified. Preserve it and explicitly resume its run. ${String(error)}`); }
        }
        if (state && state.context !== this.options.context)
          return reject(
            "context",
            "Legatus belongs to a different working context.",
          );
        if (state && !resume && !this.binding && (state.workspaceRequests.some(request => request.repositoryId) || state.launchRequests.length || state.effects.length || hasLegacyResearchHold(state)))
          return reject("resume-required", `Retained managed resources require explicit /legion resume ${state.id}. On and new task keys cannot bypass reconciliation.`);
        if (state?.shutdown) {
          const claims = await this.claims(state);
          const launches = await this.launchViews({ snapshot: state, claims: claims.byTask, fallback: claims.fallback });
          if (hasUnsettledWork(state, launches))
            return reject("stopping", "Owned work is not known settled. Preserve the shutdown and resources; activation cannot resume a retiring actor.");
        }
        if (resume && state) {
          const roots = [state.resumeState?.continuation?.root, ...state.submissions.flatMap(source => source.workflowDispatch && "root" in source.workflowDispatch ? [source.workflowDispatch.root] : [])].filter(root => root !== undefined);
          if (roots.some(root => !state.submissions.some(source => source.id === root.id && source.revision === root.revision)))
            return reject("native-history", "Saved native continuation root/history is missing. Preserve the exact prompt/journal; no reconstructed Emperor input or replay.");
        }
        let resumeHolds: NonNullable<LegatusSnapshot["resumeState"]>["holds"] | null = null;
        if (resume && state && resumeClaims) {
          try { resumeHolds = await this.resumeResources({ snapshot: state, epoch, claims: resumeClaims }); }
          catch (error) { return reject(epoch === this.epoch ? "resume-resources" : "revoked", `Explicit continuation blocked. ${String(error)}`); }
          const current = await this.store.read(state.id);
          if (epoch !== this.epoch) return reject("revoked", "Resume was revoked before publication.");
          if (!current || current.revision !== state.revision) return reject("resume-revision", "Saved run changed during observation. Preserve evidence and explicitly reconcile again.");
          try {
            if (!isDeepStrictEqual(await this.resumeHistory({ snapshot: current, epoch, noWorkInitialization }), resumeClaims)) throw new Error("Saved assignment/launch revision changed.");
          }
          catch (error) { return reject("assignment-recovery", `History changed during resource observation. ${String(error)}`); }
        }
        const expectedRevision = state?.revision ?? null;
        const snapshot =
          state ??
          createSnapshot({ id: randomUUID(), context: this.options.context });
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
        const existing = snapshot.receipts.find(
          (r) => r.result.receipt.requestKey === input.requestKey,
        );
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            return reject(
              "request-conflict",
              "Request key has a different payload.",
            );
          this.uncertain = null;
          return existing.result;
        }
        if ((intent.kind === "profile-on" || intent.kind === "profile-off" || intent.kind === "workflow" || input.workflowInvocation) && input.evidence.generation !== null && input.evidence.generation !== this.binding?.generation)
          return reject("provenance", "Host command association generation is stale.");
        if (epoch !== this.epoch)
          return reject("revoked", "Activation was revoked.");
        if (ownership.kind === "acquiring") {
          try {
            const lock =
              recoveryLock ?? (await this.store.acquire(snapshot.id));
            if (epoch !== this.epoch) {
              if (lock !== recoveryLock) release(lock);
              return reject("revoked", "Activation was revoked.");
            }
            this.binding = {
              generation: snapshot.generation + 1,
              lock,
              association: ownership.association,
            };
            adopted = true;
            recoveryLock = null;
          } catch (error) {
            return reject(
              "ownership",
              `Exclusive ownership is unavailable. ${String(error)}`,
            );
          }
          snapshot.generation = this.binding.generation;
          snapshot.attachments.push({
            session: this.options.session,
            generation: snapshot.generation,
          });
        }
        this.selected = snapshot.id;
        if (resumeHolds && snapshot.resumeState?.generation !== snapshot.generation) {
          const priorContinuation = snapshot.resumeState?.continuation;
          const unresolved = priorContinuation && ["dispatching-native", "uncertain-native"].includes(priorContinuation.dispatch.kind);
          const rootSource = [...snapshot.submissions].reverse().find(source => source.workflowDispatch?.kind === "applied-native" && source.workflowDispatch.workflow === snapshot.workflowChoice.requestedWorkflow);
          const root = rootSource?.workflowDispatch && "root" in rootSource.workflowDispatch ? rootSource.workflowDispatch.root : null;
          snapshot.resumeState = { generation: snapshot.generation, holds: resumeHolds,
            continuation: unresolved ? priorContinuation : root ? { root, dispatch: { kind: "pending-native" } } : null };
        }
        snapshot.shutdown = null;
        if (intent.kind === "profile-on" || intent.kind === "profile-off")
          snapshot.workflowChoice.profile = intent.kind === "profile-on" ? "poteto-mode" : "matt";
        if (intent.kind === "workflow") snapshot.workflowChoice.requestedWorkflow = "implement-spec";
        else if (input.workflowInvocation) snapshot.workflowChoice.requestedWorkflow = input.workflowInvocation.workflow;
        if (!isActivation)
          snapshot.submissions.push({
            id: SubmissionId.parse(randomUUID()),
            revision: 1,
            text: taskText,
            sequence: snapshot.submissions.length + 1,
            timestamp: new Date().toISOString(),
            evidence: input.evidence,
            originIntent: { kind: intent.kind === "correction" ? "unclassified" : "new-task" },
            workflowChoice: { ...snapshot.workflowChoice },
            ...(workflowInvocation ? { workflowInvocation } : {}),
            ...(intent.kind === "workflow" || input.workflowInvocation ? { workflowDispatch: { kind: "pending-native" } } : {}),
            state: { kind: "pending", routing: intent.kind === "correction" ? { kind: "correction", target: intent.target } : { kind: "new-task" } },
          });
        const result: CommittedResult = {
          kind: isActivation ? "applied" : "saved",
          receipt: {
            legatus: snapshot.id,
            requestKey: input.requestKey,
            sequence: snapshot.receipts.length + 1,
            message: ready
              ? isActivation
                ? "Legion is active. Intake only."
                : "Saved for interpretation. Intake only."
              : "Saved, not admitted. Run /legion doctor.",
          },
        };
        if (intent.kind === "workflow" || input.workflowInvocation)
          result.receipt.message = `Saved explicit Matt workflow and instructions; native skill not dispatched. Awaiting guarded native dispatch. Profile unchanged.${ready ? "" : " Not admitted. Run /legion doctor."}`;
        if (intent.kind === "profile-on" || intent.kind === "profile-off")
          result.receipt.message += ` Future Tribunus profile: ${snapshot.workflowChoice.profile}. Existing launch choices are unchanged.`;
        const workflowHold = workflowFailure(snapshot.workflowChoice);
        if (ready && workflowHold && (!isActivation || intent.kind === "profile-off"))
          result.receipt.message += ` ${workflowHold.message}`;
        if (!isActivation)
          result.receipt.message +=
            " Command text only. Attachments were not captured.";
        snapshot.receipts.push({ fingerprint, result });
        snapshot.revision++;
        this.creating = expectedRevision === null;
        try {
          await this.store.save(
            snapshot,
            expectedRevision,
            () => this.epoch === epoch && !!this.binding,
          );
        } catch (error) {
          this.uncertain = { id: snapshot.id, requestKey: input.requestKey };
          // A first intake publication cannot have dispatched managed work. Preserve its
          // incomplete artifacts for explicit creation recovery, not retiring-worker resume.
          if (this.creating && this.stopRequested && !this.invocations) {
            this.stopRequested = false;
            this.pendingStop = null;
          }
          this.revoke();
          return {
            kind: "uncertain",
            requestKey: input.requestKey,
            message: `Commit could not be established. Reconcile status ${snapshot.id} and retry the same request key. ${String(error)}`,
          };
        } finally {
          this.creating = false;
        }
        if (!ready) this.revoke();
        else if (this.epoch === epoch) {
          if (explicitActivation) this.settings = prospectiveSettings;
          this.stopRequested = false;
          this.pendingStop = null;
        }
        return result;
      } finally {
        if (this.stopRequested) await this.reconcileStop();
        try {
          if (recoveryLock) release(recoveryLock);
        } finally {
          if (ownership.kind === "acquiring" && !adopted)
            release(ownership.association);
        }
      }
    });
  }
  private async requestWorkerStops() {
    const view = await this.state(), state = view.snapshot, binding = this.binding;
    if (!state?.shutdown || !binding) return;
    const shutdown = state.shutdown;
    let changed = false;
    const retired = new Map<string, z.infer<typeof WorkerStop>["state"]>();
    for (const task of view.tasks) {
      const hold = state.resumeState?.holds.find(hold => hold.task === task.id);
      const progress = task.launch.kind === "held" ? task.launch.last : task.launch;
      if (!hold || task.claim.kind !== "owned" || !("worker" in progress)) continue;
      const addressDigest = createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex");
      if (shutdown.workers.some(worker => worker.addressDigest === addressDigest && worker.state.kind === "parked")) continue;
      try {
        const reservation = task.claim.reservation;
        const repository = state.workspaceRequests.find(request => request.repositoryId === reservation.repository);
        if (!repository?.repository) throw new Error("Current read-only retirement observation unavailable.");
        const launch = await new AssignmentLedger({ commonDir: repository.repository, owner: state.id, expectedRepository: repository.repositoryId, historyRequired: true }).readLaunch({ reservation: task.claim.reservation, known: this.currentLaunchId({ snapshot: state, task: task.id }) });
        if (!launch) throw new Error("Retained retirement launch history unavailable.");
        const origin = this.launchOrigin({ snapshot: state, launch });
        if (!origin) throw new Error("Original retired launch authority/history unavailable.");
        const reader = this.options.resume?.worker({ owner: state.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch });
        if (!reader) throw new Error("Current read-only retirement observation unavailable.");
        const observation = await reader.observeResources({ launch, cwd: task.claim.reservation.plan.path, signal: this.resumeSignal.signal });
        if (binding !== this.binding) return;
        if (!this.retiredSettlement({ snapshot: state, launch, observation })) throw new Error(`Current retired resource settlement is unresolved. ${observation.reasons.join(" ")}`);
        retired.set(addressDigest, { kind: "parked", evidence: observation.evidence });
      } catch (error) { retired.set(addressDigest, { kind: "held", message: `Retired actor remains observation-only; off cannot establish current settlement. ${String(error)}` }); }
    }
    const targets = view.tasks.flatMap(task => {
      const progress = task.launch.kind === "held" ? task.launch.last : task.launch;
      if (!("worker" in progress)) return [];
      const addressDigest = createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex");
      const command = "assignment" in progress ? progress.command : null;
      const observationOnly = state.resumeState?.holds.some(hold => hold.task === task.id);
      const host = !observationOnly && task.claim.kind === "owned" ? this.workerHosts.get(task.claim.reservation.id) : null;
      const saved = shutdown.workers.find(worker => worker.addressDigest === addressDigest);
      const observedRetirement = retired.get(addressDigest);
      if (observedRetirement) {
        if (!saved) shutdown.workers.push({ launch: progress.worker.address.launch, addressDigest, command, state: observedRetirement });
        else if (!isDeepStrictEqual(saved.state, observedRetirement)) saved.state = observedRetirement;
        else return [];
        changed = true;
        return [];
      }
      if (saved?.state.kind === "parked") return [];
      if (!saved) {
        shutdown.workers.push({ launch: progress.worker.address.launch, addressDigest, command, state: host?.stop ? { kind: "draining" } : { kind: "held", message: "Addressed stop transport unavailable. Preserve the worker; delivery and settlement are unresolved." } });
        changed = true;
      }
      return [{ worker: progress.worker, addressDigest, command, host }];
    });
    if (changed) {
      const expected = state.revision++;
      await this.store.save(state, expected, () => binding === this.binding);
    }
    for (const target of targets) {
      const observe = async (observation: z.infer<typeof WorkerStop>) => {
        if (observation.shutdown !== shutdown.id || observation.authority.owner !== state.id || observation.authority.session !== this.options.session || observation.authority.generation !== shutdown.generation || observation.authority.epoch !== shutdown.epoch || observation.command !== target.command || !isDeepStrictEqual(observation.address, target.worker.address)) return;
        await this.serialize(async () => {
          const current = await this.store.read(state.id);
          const saved = current?.shutdown?.id === shutdown.id ? current.shutdown.workers.find(worker => worker.addressDigest === target.addressDigest) : null;
          if (!current || !saved || saved.state.kind === "parked" || isDeepStrictEqual(saved.state, observation.state)) return;
          saved.state = observation.state;
          const revision = current.revision++;
          await this.store.save(current, revision, () => binding === this.binding);
          await this.finishStop();
        });
      };
      if (!target.host?.stop) continue;
      void target.host.stop({ worker: target.worker, shutdown: shutdown.id, command: target.command }, observe).catch(async error => {
        try {
          await observe({ shutdown: shutdown.id, authority: { owner: state.id, session: this.options.session, generation: shutdown.generation, epoch: shutdown.epoch }, address: target.worker.address, command: target.command, state: { kind: "held", message: `Stop delivery unresolved. Preserve resources. ${String(error)}` } });
        } catch (publication) { this.options.tribuni?.onUnavailable?.(`Stop observation publication unresolved. Preserve shutdown ${shutdown.id} and worker resources. ${String(publication)}`); }
      });
    }
  }
  private async assignmentContinues({ snapshot, launch, pin, correction }: {
    snapshot: LegatusSnapshot; launch: LaunchView | undefined; pin: z.infer<typeof AssignmentPin>; correction: z.infer<typeof CorrectionTurn> | undefined;
  }) {
    if (launch?.kind === "assigned") return true;
    if (launch?.kind !== "reported" || !correction) return false;
    const record = snapshot.corrections.find(record => record.id === correction.id && record.digest === correction.digest);
    if (!record?.binding || !isDeepStrictEqual(record.binding.pin, pin) || !isDeepStrictEqual(record.binding.address, launch.worker.address) ||
        !isDeepStrictEqual(record.task, pin.task) || snapshot.corrections.some(next => next.previous === record.id) ||
        !(record.state.kind === "delivered" || record.state.kind === "queued" && record.state.dispatch === "sent")) return false;
    const host = this.options.tribuni?.host();
    if (!host?.observeCorrection) return false;
    const binding = this.binding, epoch = this.epoch;
    try {
      const observation = CorrectionObservation.parse(await host.observeCorrection({ request: CorrectionDelivery.parse(this.correctionRequest(record)), continuation: correction }));
      return binding === this.binding && epoch === this.epoch && !this.stopping &&
        isDeepStrictEqual(observation.request, this.correctionRequest(record)) && observation.state.kind === "delivered" &&
        (record.state.kind !== "delivered" || isDeepStrictEqual(record.state.receipt, observation.state.receipt));
    } catch { return false; }
  }
  private submitEffect(message: z.infer<typeof EffectMessage>): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const view = await this.state(), state = view.snapshot, binding = this.binding;
      if (!state || !binding || this.uncertain) return reject("effect-controller", "Current effect controller is unavailable or uncertain. Preserve the same intent.");
      if (message.kind === "centurio-owner-check") {
        const pin = message.pin, task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
        if (message.stage !== "read" && state.handoffs.some(record => record.pin.launch === pin.launch)) return reject("handoff-retired", "Predecessor handoff retirement denies child work.");
        const settlementRead = message.stage === "read" && !!state.shutdown && pin.generation === state.shutdown.generation && pin.epoch === state.shutdown.epoch;
        if ((!settlementRead && (view.mode !== "active" || epoch !== this.epoch || this.stopping)) || pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || (!settlementRead && pin.epoch !== epoch))
          return reject("centurio-controller", "The child owner is no longer the current controller. No child work admitted.");
        if ((!settlementRead && task?.eligibility !== "admitted") || !task || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || (launch?.kind !== "assigned" && launch?.kind !== "reported") || (!(message.stage === "read" && launch?.kind === "reported") && !await this.assignmentContinues({ snapshot: state, launch, pin, correction: message.correction })))
          return reject("centurio-assignment", "The child no longer has the current owned assignment.");
        try {
          if ((!settlementRead && this.approval(state, pin.task) !== pin.scope) || !isDeepStrictEqual(launch.assignment.task, pin.task) || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || launch.worker.address.launch !== pin.launch || launch.worker.address.session !== pin.workerSession || launch.worker.address.generation !== pin.workerGeneration || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
            return reject("centurio-pin", "The child task, scope, assignment, or principal incarnation changed.");
        } catch (error) { return reject("centurio-pin", String(error)); }
        return { kind: "centurio-owner-current", id: message.id, child: message.child };
      }
      if (message.kind === "effect-observation") {
        const record = state.effects.find(effect => effect.intent.id === message.id && effect.digest === message.digest);
        if (!record) return reject("effect-identity", "No matching retained admission for this observation.");
        if (record.state.kind === "completed" || record.state.kind === "refused")
          return isDeepStrictEqual(record.state, message.state) ? { kind: "effect", effect: record } : reject("effect-conflict", "Terminal observation conflicts with retained evidence.");
        if (record.state.kind === "unknown")
          return isDeepStrictEqual(record.state, message.state) ? { kind: "effect", effect: record } : reject("effect-unresolved", "An unknown effect requires explicit reconciliation. Later ordinary observations cannot establish settlement.");
        if (record.intent.origin?.kind === "centurio") return reject("effect-child-legacy", "Legacy child effect settlement requires explicit reconciliation; current native observations cannot adopt it.");
        record.state = message.state;
        const expected = state.revision++;
        try {
          await this.store.save(state, expected, () => binding === this.binding);
          if (message.state.kind !== "unknown" && this.effectInvocations.delete(message.id)) this.invocations--;
          if (this.stopRequested) await this.reconcileStop();
          else if (this.stopping && !this.invocations) this.revoke();
          return { kind: "effect", effect: record };
        } catch (error) { return reject("effect-observation-unknown", `Retain the same effect observation for reconciliation. ${String(error)}`); }
      }
      const intent = message.intent, pin = intent.pin;
      if (state.handoffs.some(record => record.pin.launch === pin.launch)) return reject("handoff-retired", "Predecessor retirement denies new ordinary effects.");
      const existing = state.effects.find(effect => effect.intent.id === intent.id || effect.intent.pin.workerSession === pin.workerSession && effect.intent.pin.workerGeneration === pin.workerGeneration && effect.intent.call.id === intent.call.id && (effect.intent.origin?.kind === "centurio" ? effect.intent.origin.session : null) === (intent.origin?.kind === "centurio" ? intent.origin.session : null));
      if (existing) return isDeepStrictEqual(existing.intent, intent) ? { kind: "effect", effect: existing } : reject("effect-conflict", "Call identity already belongs to a different retained intent. No retry.");
      if (intent.origin?.kind === "centurio") return reject("effect-child-retired", "Native child effects use assignment-level launch authority, not the retired per-call protocol. Retain legacy records without adoption.");
      if (view.mode !== "active" || epoch !== this.epoch || this.stopping) return reject("effect-revoked", "No new effect admission after controller revocation.");
      if (state.effects.some(effect => effect.intent.pin.workerSession === pin.workerSession && effect.intent.pin.workerGeneration === pin.workerGeneration && effect.state.kind === "unknown"))
        return reject("effect-unresolved", "A prior native effect outcome is unknown. Reconcile the same identity before new work.");
      const task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
      if (pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch || task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || (launch?.kind !== "assigned" && launch?.kind !== "reported") || !await this.assignmentContinues({ snapshot: state, launch, pin, correction: "correction" in intent ? intent.correction : undefined }))
        return reject("effect-authority", "Principal, task, reservation, or controller authority changed.");
      try {
        if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || launch.worker.address.launch !== pin.launch || launch.worker.address.session !== pin.workerSession || launch.worker.address.generation !== pin.workerGeneration || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
          return reject("effect-pin", "Authority no longer addresses the exact current assignment and worker incarnation.");
      } catch (error) { return reject("effect-pin", String(error)); }
      try {
        const record = EffectRecord.parse({ intent, digest: createHash("sha256").update(JSON.stringify(intent)).digest("hex"), state: { kind: "outstanding" } });
        state.effects.push(record);
        const expected = state.revision++;
        await this.store.save(state, expected, () => epoch === this.epoch && binding === this.binding && !this.stopping);
        this.effectInvocations.add(intent.id);
        this.invocations++;
        return { kind: "effect", effect: record };
      } catch (error) {
        this.uncertain = { id: state.id, requestKey: intent.id };
        this.revoke();
        return { kind: "uncertain", requestKey: intent.id, message: `Admission outcome is uncertain. Preserve and reconcile the same identity. ${String(error)}` };
      }
    });
  }
  private async currentCorrectionBinding({ state, task }: { state: LegatusSnapshot; task: z.infer<typeof TaskRef> }) {
    const claims = await this.claims(state);
    const claim = claims.byTask.get(task.id);
    if (!claim || claim.kind === "unreserved") return null;
    if (claim.kind !== "owned" || claim.workspace.kind !== "ready") throw new Error("Exact owned ready assignment history is required for correction binding.");
    const repository = state.workspaceRequests.find(request => request.repositoryId === claim.reservation.repository);
    if (!repository?.repository) throw new Error("Correction repository history unavailable.");
    const launch = await new AssignmentLedger({ commonDir: repository.repository, owner: state.id, expectedRepository: claim.reservation.repository, historyRequired: true })
      .readLaunch({ reservation: claim.reservation, known: this.currentLaunchId({ snapshot: state, task: task.id }) });
    if (!launch || launch.state.kind === "prepared") return null;
    const progress = launch.state;
    if (progress.kind !== "assigned" && progress.kind !== "reported") throw new Error("Correction requires a confirmed applied assignment; uncertain launch is not a worker.");
    const origin = this.launchOrigin({ snapshot: state, launch });
    if (!origin || progress.assignment.task.id !== task.id || launch.scope !== progress.assignment.scope ||
        origin.scope !== launch.scope || !isDeepStrictEqual(origin.task, progress.assignment.task) || origin.repositoryId !== claim.reservation.repository)
      throw new Error("Exact correction assignment origin unavailable.");
    return { address: progress.worker.address, pin: {
      owner: state.id, session: origin.evidence.session, generation: origin.generation, epoch: origin.epoch,
      task: progress.assignment.task, scope: progress.assignment.scope, reservation: launch.reservation,
      assignment: progress.command, launch: launch.id, workerSession: progress.worker.address.session,
      workerGeneration: progress.worker.address.generation, addressDigest: createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex"),
    } };
  }
  private correctionRequest(record: CorrectionRecord) {
    const { state: _state, ...request } = record;
    return request;
  }
  private reconcileCorrection({ record, observation }: { record: CorrectionRecord; observation: z.infer<typeof CorrectionObservation> }) {
    if (!isDeepStrictEqual(this.correctionRequest(record), observation.request)) throw new Error("Correction observation does not match the immutable ID, content, task, authority and worker pin.");
    const next = observation.state, previous = record.state;
    if (previous.kind === "applied" || previous.kind === "delivered") {
      if (next.kind === "not-delivered" || next.kind === "delivered" && !isDeepStrictEqual(previous.receipt, next.receipt))
        throw new Error("Conflicting confirmed correction receipt; preserve the original evidence.");
      return;
    }
    if (previous.kind === "not-delivered") {
      if (next.kind === "delivered") throw new Error("Conflicting reconciled correction outcome; preserve the original evidence.");
      return;
    }
    record.state = next.kind === "queued" ? { kind: "queued", dispatch: "sent" } : next;
  }
  private async observeResumedCorrection({ snapshot, request, epoch }: { snapshot: LegatusSnapshot; request: z.infer<typeof CorrectionDelivery>; epoch: number }) {
    const pin = request.binding.pin;
    const resume = snapshot.resumeState;
    const hold = resume && resume.generation === this.binding?.generation
      ? resume.holds.find(hold => hold.task === request.task.id && hold.reservation === pin.reservation) : null;
    if (!hold || snapshot.context !== this.options.context || pin.owner !== snapshot.id ||
        !isDeepStrictEqual(await this.currentCorrectionBinding({ state: snapshot, task: request.task }), request.binding))
      throw new Error("No exact explicitly resumed ownership/assignment for correction observation.");
    const claims = await this.claims(snapshot), claim = claims.byTask.get(request.task.id);
    if (claim?.kind !== "owned" || claim.workspace.kind !== "ready" || claim.reservation.id !== pin.reservation) throw new Error("Retained correction reservation is unresolved.");
    const repository = snapshot.workspaceRequests.find(record => record.repositoryId === claim.reservation.repository);
    if (!repository?.repository) throw new Error("Retained correction repository history is unavailable.");
    const git = this.options.resume?.repository(repository.repository);
    const observedGit = await git?.observeResources({ plan: claim.reservation.plan, commonDir: repository.repository });
    if (observedGit?.disposition !== "identified" || observedGit.dirty.kind !== "observed") throw new Error("Fresh retained checkout observation is unresolved.");
    const launch = await new AssignmentLedger({ commonDir: repository.repository, owner: snapshot.id, expectedRepository: claim.reservation.repository, historyRequired: true })
      .readLaunch({ reservation: claim.reservation, known: pin.launch });
    const reader = this.options.resume?.worker({ owner: pin.owner, session: pin.session, generation: pin.generation, epoch: pin.epoch });
    if (!launch || !reader?.observeCorrection) throw new Error("Original-authority read-only correction evidence reader is unavailable.");
    const observed = await reader.observeResources({ launch, cwd: claim.reservation.plan.path, signal: this.resumeSignal.signal });
    if (epoch !== this.epoch || this.stopping || !this.workerObservationMatches({ snapshot, launch, observation: observed }))
      throw new Error("Fresh retained worker/assignment identity is unresolved; no adoption or execution authority.");
    return reader.observeCorrection({ request });
  }
  private controlCorrection(input: z.infer<typeof CorrectionAction>): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const binding = this.binding;
      if (!binding || !this.selected || this.stopping || epoch !== this.epoch) return reject("inactive", "Explicit current Legatus authority is required for correction control.");
      if (input.evidence.session !== this.options.session || input.evidence.generation !== binding.generation || input.evidence.legatus !== this.selected)
        return reject("provenance", "Correction control requires the exact current Legatus session and generation.");
      const snapshot = await this.store.read(this.selected);
      if (!snapshot) return reject("unavailable", "Correction state is unavailable.");
      const record = snapshot.corrections.find(record => record.id === input.correction.id);
      if (!record || record.digest !== input.correction.digest) return reject("correction-conflict", "Exact saved correction ID and digest required.");
      const result = (): OperationResult => ({ kind: "correction-stage", correction: record.id, state: record.state,
        message: record.state.kind === "applied" ? "Legatus verified performed correction with evidence. This is not result acceptance or integration." : "Correction state retained. Queued is saved intent; delivered is receipt only, not verified compliance." });
      let storageFailed = false;
      const save = async () => {
        const revision = snapshot.revision++;
        try { await this.store.save(snapshot, revision, () => binding === this.binding && !this.stopping && epoch === this.epoch); }
        catch (error) { storageFailed = true; this.revoke(); throw error; }
      };
      try {
        if (input.action.kind === "verify") {
          if (record.state.kind === "applied") {
            if (record.state.verification.summary !== input.action.summary || !isDeepStrictEqual(record.state.verification.evidence, input.action.evidence))
              return reject("correction-conflict", "Performed-correction verification is already saved with different evidence. Preserve the original decision.");
            return result();
          }
          if (record.state.kind !== "delivered") return reject("correction-receipt", "Confirm the exact addressed worker receipt before verifying performed correction.");
          record.state = { kind: "applied", receipt: record.state.receipt, verification: {
            summary: input.action.summary, evidence: input.action.evidence,
            by: { session: input.evidence.session, generation: input.evidence.generation, run: input.evidence.run },
          } };
          await save();
          return result();
        }
        if (input.action.kind === "reconcile") {
          this.reconcileCorrection({ record, observation: input.action.observation });
          await save();
          return result();
        }
        if (record.state.kind === "applied" || record.state.kind === "delivered" || record.state.kind === "not-delivered") return result();
        if (!record.binding) return reject("correction-worker", "Saved intent has no addressed worker. No launch or automatic retarget is authorized.");
        const request = CorrectionDelivery.parse(this.correctionRequest(record));
        const deliver = input.action.kind === "deliver" && record.state.kind === "queued" && record.state.dispatch === "not-sent";
        const host = this.options.tribuni?.host();
        if (deliver) {
          const current = await this.currentCorrectionBinding({ state: snapshot, task: record.task });
          if (!isDeepStrictEqual(current, record.binding) || record.binding.pin.session !== this.options.session ||
              record.binding.pin.generation !== binding.generation || record.binding.pin.epoch !== epoch ||
              snapshot.resumeState?.holds.some(hold => hold.task === record.task.id) ||
              snapshot.decisions.some(decision => decision.state.kind === "open" && decision.history.at(-1)?.affected.some(task => task.id === record.task.id)) ||
              snapshot.handoffs.some(handoff => handoff.pin.launch === record.binding?.pin.launch) ||
              !snapshot.tasks.some(task => task.id === record.task.id && task.history.at(-1)?.revision === record.task.revision))
            return reject("correction-authority", "Task/current assignment or Legatus authority changed. Reconcile the original delivery; never transfer automatically.");
          if (!host?.correct) return reject("correction-transport", "Safe correction transport is unavailable. Saved intent is retained; no worker launched.");
          record.state = { kind: "queued", dispatch: "sent" };
          await save();
        } else if (!snapshot.resumeState && !host?.observeCorrection) return reject("correction-transport", "Exact correction observation transport is unavailable. Do not resend an uncertain delivery.");
        try {
          if (binding !== this.binding || this.stopping || epoch !== this.epoch) throw new Error("Correction transport authority was revoked before dispatch.");
          const raw = deliver ? await host?.correct?.({ request }) : snapshot.resumeState
            ? await this.observeResumedCorrection({ snapshot, request, epoch }) : await host?.observeCorrection?.({ request });
          const observation = CorrectionObservation.parse(raw);
          this.reconcileCorrection({ record, observation });
        } catch (error) {
          record.state = { kind: "unknown", message: String(error) };
        }
        await save();
        return result();
      } catch (error) {
        if (storageFailed) return { kind: "uncertain", requestKey: record.id, message: `Correction publication outcome is uncertain. Read status, explicitly resume and observe this exact ID before further action. ${String(error)}` };
        return reject("correction-authority", `Preserve the saved correction and reconcile its exact ID. ${String(error)}`);
      }
    });
  }
  submit(raw: unknown): Promise<OperationResult> {
    const correction = CorrectionAction.safeParse(raw);
    if (correction.success) return this.controlCorrection(correction.data);
    const effect = EffectMessage.safeParse(raw);
    if (effect.success) return this.submitEffect(effect.data);
    const input = z.union([Message, Interpretation]).safeParse(raw);
    if (!input.success)
      return Promise.resolve(reject("invalid", "Invalid submission."));
    const epoch = this.epoch;
    return this.serialize(async () => {
      const message = input.data;
      if (this.uncertain) {
        if (message.requestKey !== this.uncertain.requestKey)
          return reject(
            "reconcile",
            `Reconcile request ${this.uncertain.requestKey} first.`,
          );
        const recovered = await this.store.read(this.uncertain.id);
        const receipt = recovered?.receipts.find(
          (r) => r.result.receipt.requestKey === message.requestKey,
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(message))
          .digest("hex");
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            return reject(
              "request-conflict",
              "Request key has a different payload.",
            );
          this.uncertain = null;
          return receipt.result;
        }
        this.uncertain = null;
        return reject(
          "not-committed",
          "No committed receipt exists. Explicitly resume intake, then retry the same request.",
        );
      }
      const prior = this.selected
        ? await this.store.read(this.selected)
        : await this.store.find(this.options.session, this.options.context);
      const previousReceipt = prior?.receipts.find(
        (r) => r.result.receipt.requestKey === message.requestKey,
      );
      if (previousReceipt) {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(message))
          .digest("hex");
        return previousReceipt.fingerprint === fingerprint
          ? previousReceipt.result
          : reject("request-conflict", "Request key has a different payload.");
      }
      const binding = this.binding;
      const selected = this.selected;
      if (!binding || !selected || this.stopping || epoch !== this.epoch)
        return reject("inactive", "Legion is inactive.");
      if (
        (message.kind === "message" && message.evidence.origin !== "emperor") ||
        message.evidence.session !== this.options.session ||
        message.evidence.generation !== binding.generation ||
        (message.kind === "interpretation" &&
          message.evidence.legatus !== selected)
      )
        return reject("provenance", "Current Emperor input is required.");
      const state = await this.store.read(selected);
      if (!state) return reject("unavailable", "Records are unavailable.");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(message))
        .digest("hex");
      const existing = state.receipts.find(
        (r) => r.result.receipt.requestKey === message.requestKey,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          return reject(
            "request-conflict",
            "Request key has a different payload.",
          );
        this.uncertain = null;
        return existing.result;
      }
      if (message.kind === "message") {
        state.submissions.push({
          id: SubmissionId.parse(randomUUID()),
          revision: 1,
          text: message.text,
          sequence: state.submissions.length + 1,
          timestamp: new Date().toISOString(),
          evidence: message.evidence,
          originIntent: { kind: "unclassified" },
          ...(state.submissions.some(source => source.workflowDispatch?.kind === "applied-native" && source.workflowDispatch.workflow === state.workflowChoice.requestedWorkflow) ? { workflowDispatch: { kind: "pending-native" } } : {}),
          workflowChoice: { ...state.workflowChoice },
          state: { kind: "pending", routing: { kind: "unclassified" } },
        });
      } else {
        const proposal = message.proposal;
        let native;
        if (message.evidence.nativeDispatch) {
          try { native = this.nativeAuthority(state, message.evidence.nativeDispatch, message.evidence.session, message.evidence.generation); }
          catch (error) { return reject("native-authority", String(error)); }
        }
        if (proposal.kind === "correction") {
          const existing = state.corrections.find(record => record.id === proposal.id);
          if (existing) {
            if (!isDeepStrictEqual(existing.source, proposal.source) || !isDeepStrictEqual(existing.task, proposal.target) ||
                !isDeepStrictEqual(existing.authorization, proposal.authorization) || existing.previous !== (proposal.previous ?? null))
              return reject("correction-conflict", "Correction ID is already bound to different content, source or target. Never overwrite or rebind it.");
            return { kind: "correction-stage", correction: existing.id, state: existing.state, message: "Same immutable correction retained. Replay does not redeliver or rebind it." };
          }
        }
        const linkedCorrection = proposal.kind === "correction" && !!proposal.previous;
        const amendmentCorrection = proposal.kind === "correction" && proposal.authorization.kind === "amendment";
        const repeatedSpec = native?.dispatch.workflow === "implement-spec" && proposal.kind === "new-task" && proposal.source.id === native.dispatch.root.id;
        const source = state.submissions.find(
          (s) =>
            s.id === proposal.source.id &&
            s.revision === proposal.source.revision &&
            (s.state.kind === "pending" || (repeatedSpec || amendmentCorrection || linkedCorrection) && s.state.kind === "applied"),
        );
        if (
          !source ||
          !message.evidence.sources.some(
            (s) => s.id === source.id && s.revision === source.revision,
          ) ||
          (source.state.kind !== "pending" && !repeatedSpec && !amendmentCorrection && !linkedCorrection)
        )
          return reject(
            "stale-source",
            "Source is not pending in this interpretation run.",
          );
        const routing = source.state.kind === "pending" ? source.state.routing : { kind: "new-task" } as const;
        if (routing.kind === "new-task" && proposal.kind !== "new-task" && !amendmentCorrection && !linkedCorrection)
          return reject(
            "routing",
            "Explicit new-task intent cannot change another assignment. Attach questions to the new task.",
          );
        if (routing.kind === "correction") {
          const targets =
            proposal.kind === "technical-choice" || proposal.kind === "correction"
              ? [proposal.target]
              : proposal.kind === "propose-amendment" ||
                  (proposal.kind === "clarify" &&
                    proposal.purpose === "product")
                ? proposal.affected
                : [];
          if (
            !targets.length ||
            targets.some(
              (t) =>
                t.id !== routing.target.id ||
                t.revision !== routing.target.revision,
            )
          )
            return reject(
              "routing",
              "Saved correction routing cannot be changed by interpretation.",
            );
        }
        switch (proposal.kind) {
          case "new-task": {
            if (
              source.state.kind !== "pending" && !repeatedSpec ||
              source.state.kind === "pending" && source.state.routing.kind === "correction"
            )
              return reject(
                "routing",
                "A correction cannot become a new task.",
              );
            const id = TaskId.parse(randomUUID());
            state.tasks.push({
              id,
              technicalChoices: [],
              history: [
                {
                  revision: 1,
                  goal: proposal.goal,
                  acceptance: proposal.acceptance,
                  source: proposal.source,
                },
              ],
              scope: {
                original: source.id,
                context: state.context,
                policy: "intake-only-v1",
                amendments: [],
              },
            });
            for (const question of proposal.questions)
              state.decisions.push({
                id: DecisionId.parse(randomUUID()),
                history: [
                  {
                    revision: 1,
                    kind: "product",
                    ...question,
                    affected: [{ id, revision: 1 }],
                    original: proposal.source,
                    amendment: null,
                  },
                ],
                state: { kind: "open" },
              });
            source.state = { kind: "applied", resolution: id };
            break;
          }
          case "clarify": {
            if (
              !proposal.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject("stale-task", "Affected task revision changed.");
            const id = DecisionId.parse(randomUUID());
            state.decisions.push({
              id,
              history: [
                {
                  revision: 1,
                  kind: proposal.purpose,
                  question: proposal.question,
                  recommendation: proposal.recommendation,
                  affected: proposal.affected,
                  original: proposal.source,
                  amendment: null,
                },
              ],
              state: { kind: "open" },
            });
            source.state = {
              kind: "awaiting-clarification",
              decision: { id, revision: 1 },
            };
            break;
          }
          case "correction": {
            let instruction = source.text;
            if (proposal.authorization.kind === "technical") {
              if (routing.kind !== "correction" && !linkedCorrection) return reject("routing", "Technical correction requires explicit saved correction routing.");
            } else {
              const amendmentId = proposal.authorization.amendment;
              const amendment = state.amendments.find(amendment => amendment.id === amendmentId);
              const decision = amendment && state.decisions.find(decision => decision.id === amendment.decision.id);
              const approved = state.resolutions.some(resolution => resolution.decision.id === decision?.id &&
                resolution.decision.revision === amendment?.decision.revision && resolution.effect.kind === "approve-amendment" && resolution.effect.amendment === amendmentId);
              if (!approved || decision?.state.kind !== "resolved" || !amendment ||
                  !decision.history.some(history => history.revision === amendment.decision.revision && isDeepStrictEqual(history.original, proposal.source)) ||
                  !amendment.affected.some(target => target.id === proposal.target.id && target.revision + 1 === proposal.target.revision) ||
                  !state.tasks.some(task => task.id === proposal.target.id && task.scope.amendments.includes(amendmentId)))
                return reject("correction-approval", "Protected correction requires the exact presented approved amendment, original source and resulting task revision.");
              instruction = amendment.change;
            }
            if (!state.tasks.some(task => task.id === proposal.target.id && task.history.at(-1)?.revision === proposal.target.revision))
              return reject("stale-task", "Correction target is not current.");
            if (state.decisions.some(decision => decision.state.kind === "open" && decision.history.at(-1)?.affected.some(task => task.id === proposal.target.id)))
              return reject("decision", "Affected work awaits an Emperor decision.");
            let correctionBinding;
            try { correctionBinding = await this.currentCorrectionBinding({ state, task: proposal.target }); }
            catch (error) { return reject("correction-authority", String(error)); }
            if (proposal.previous) {
              const previous = state.corrections.find(record => record.id === proposal.previous);
              if (!previous || !isDeepStrictEqual(previous.source, proposal.source) || previous.task.id !== proposal.target.id ||
                  !isDeepStrictEqual(previous.authorization, proposal.authorization) || previous.instruction !== instruction ||
                  state.corrections.some(record => record.previous === previous.id) ||
                  !(previous.state.kind === "delivered" || previous.state.kind === "not-delivered" || previous.state.kind === "queued" && previous.state.dispatch === "not-sent") ||
                  !correctionBinding || isDeepStrictEqual(correctionBinding, previous.binding))
                return reject("correction-replacement", "Reconcile the old outcome first, then create one linked fresh request for the exact different current worker. No automatic transfer.");
              if (previous.state.kind === "queued") previous.state = { kind: "not-delivered", evidence: [`Legatus saved dispatch marker for ${previous.id} is not-sent; transport was never invoked.`] };
            } else if (state.corrections.some(record => record.source.id === proposal.source.id && record.source.revision === proposal.source.revision && record.task.id === proposal.target.id)) {
              return reject("correction-conflict", "This source already has a correction. Replay its ID, or explicitly link a reconciled replacement.");
            }
            const content = { id: proposal.id, source: proposal.source, task: proposal.target, instruction,
              authorization: proposal.authorization, previous: proposal.previous ?? null, binding: correctionBinding };
            state.corrections.push(CorrectionRecord.parse({ ...content, digest: correctionDigest(content), state: { kind: "queued", dispatch: "not-sent" } }));
            source.state = { kind: "applied", resolution: message.evidence.run };
            break;
          }
          case "technical-choice": {
            const task = state.tasks.find(
              (t) =>
                t.id === proposal.target.id &&
                t.history.at(-1)?.revision === proposal.target.revision,
            );
            if (!task)
              return reject(
                "stale-task",
                "Technical choice target is not current.",
              );
            task.technicalChoices.push({
              source: proposal.source,
              target: proposal.target,
              choice: proposal.choice,
            });
            source.state = {
              kind: "applied",
              resolution: message.evidence.run,
            };
            break;
          }
          case "conversation": {
            source.state = {
              kind: "applied",
              resolution: message.evidence.run,
            };
            break;
          }
          case "propose-amendment": {
            if (
              !proposal.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject("stale-task", "Affected task revision changed.");
            const id = DecisionId.parse(randomUUID());
            const amendment = AmendmentId.parse(randomUUID());
            state.amendments.push({
              id: amendment,
              decision: { id, revision: 1 },
              affected: proposal.affected,
              category: proposal.category,
              change: proposal.change,
            });
            state.decisions.push({
              id,
              history: [
                {
                  revision: 1,
                  kind: "protected",
                  question: proposal.question,
                  recommendation: proposal.recommendation,
                  affected: proposal.affected,
                  original: proposal.source,
                  amendment,
                },
              ],
              state: { kind: "open" },
            });
            source.state = {
              kind: "awaiting-clarification",
              decision: { id, revision: 1 },
            };
            break;
          }
          case "answer": {
            const decision = state.decisions.find(
              (d) => d.id === proposal.decision.id,
            );
            const current = decision?.history.at(-1);
            if (
              !decision ||
              decision.state.kind !== "open" ||
              !current ||
              current.revision !== proposal.decision.revision
            )
              return reject("stale-decision", "Decision revision is not open.");
            if (
              proposal.effect.kind !== "clarify" &&
              !current.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject(
                "stale-task",
                "Affected task revision changed. Ask for a freshly presented decision revision.",
              );
            if (
              source.evidence.origin !== "emperor" ||
              source.originIntent.kind !== "unclassified" ||
              !source.evidence.presented.some(
                (p) =>
                  p.decision.id === decision.id &&
                  p.decision.revision === current.revision,
              )
            )
              return reject(
                "not-presented",
                "Decision was not presented when this answer arrived.",
              );
            const effect = proposal.effect;
            const resolution = randomUUID();
            if (effect.kind === "record-clarification") {
              if (
                current.kind !== "product" ||
                !current.affected.some(
                  (t) =>
                    t.id === effect.target.id &&
                    t.revision === effect.target.revision,
                ) ||
                effect.answer !== source.text
              )
                return reject(
                  "effect",
                  "Answer effect is not permitted for this decision.",
                );
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = { kind: "applied", resolution };
              decision.state = { kind: "resolved", resolution };
            } else if (effect.kind === "resolve-routing") {
              const original = state.submissions.find(
                (s) =>
                  s.id === effect.original.id &&
                  s.revision === effect.original.revision,
              );
              if (
                current.kind !== "routing" ||
                current.original.id !== effect.original.id ||
                current.original.revision !== effect.original.revision ||
                !original ||
                original.state.kind !== "awaiting-clarification" ||
                original.state.decision.id !== decision.id
              )
                return reject(
                  "effect",
                  "Routing effect is not permitted for this decision.",
                );
              const routing = effect.routing;
              if (
                routing.kind === "correction" &&
                !state.tasks.some(
                  (t) =>
                    t.id === routing.target.id &&
                    t.history.at(-1)?.revision === routing.target.revision &&
                    current.affected.some((a) => a.id === t.id),
                )
              )
                return reject(
                  "stale-task",
                  "Correction target is not current affected work.",
                );
              original.state = { kind: "pending", routing: effect.routing };
              original.revision++;
              if (message.evidence.nativeDispatch && original.workflowDispatch)
                original.workflowDispatch = { kind: "pending-native" };
              decision.state = { kind: "resolved", resolution };
            } else if (
              effect.kind === "approve-amendment" ||
              effect.kind === "decline-amendment"
            ) {
              const amendment = state.amendments.find(
                (a) => a.id === effect.amendment,
              );
              if (
                current.kind !== "protected" ||
                current.amendment !== effect.amendment ||
                !amendment ||
                amendment.decision.id !== decision.id ||
                amendment.decision.revision !== current.revision ||
                !source.evidence.presented.some(
                  (p) =>
                    p.decision.id === decision.id &&
                    p.decision.revision === current.revision &&
                    p.amendment === amendment.id,
                )
              )
                return reject(
                  "not-presented",
                  "The exact current amendment was not presented to this answer.",
                );
              if (effect.kind === "approve-amendment") {
                for (const affected of amendment.affected) {
                  const task = state.tasks.find((t) => t.id === affected.id);
                  const latest = task?.history.at(-1);
                  if (!task || !latest || latest.revision !== affected.revision)
                    return reject("stale-task", "Amendment target changed.");
                  task.scope.amendments.push(amendment.id);
                  task.history.push({
                    ...latest,
                    revision: latest.revision + 1,
                    source: proposal.source,
                  });
                }
              }
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = { kind: "applied", resolution };
              decision.state = { kind: "resolved", resolution };
            } else {
              const revision = current.revision + 1;
              const affected: typeof current.affected = [];
              for (const previous of current.affected) {
                const task = state.tasks.find((t) => t.id === previous.id);
                const latest = task?.history.at(-1);
                if (!task || !latest)
                  return reject("stale-task", "Affected work is unavailable.");
                affected.push({ id: task.id, revision: latest.revision });
              }
              let amendment = current.amendment;
              if (current.kind === "protected") {
                const originalAmendment = state.amendments.find(
                  (a) => a.id === current.amendment,
                );
                if (!originalAmendment)
                  return reject(
                    "effect",
                    "Protected amendment is unavailable.",
                  );
                amendment = AmendmentId.parse(randomUUID());
                state.amendments.push({
                  ...originalAmendment,
                  id: amendment,
                  affected,
                  decision: { id: decision.id, revision },
                });
              }
              decision.history.push({
                ...current,
                revision,
                amendment,
                affected,
                question: effect.question,
                recommendation: effect.recommendation,
              });
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = {
                  kind: "awaiting-clarification",
                  decision: { id: decision.id, revision },
                };
            }
            state.resolutions.push({
              id: resolution,
              decision: proposal.decision,
              answerSource: proposal.source,
              effect,
            });
            source.state = { kind: "applied", resolution };
            break;
          }
          default: {
            const exhaustive: never = proposal;
            return exhaustive;
          }
        }
      }
      const result: CommittedResult = {
        kind: message.kind === "message" ? "saved" : "applied",
        receipt: {
          legatus: state.id,
          requestKey: message.requestKey,
          sequence: state.receipts.length + 1,
          message: message.kind === "message" && state.submissions.at(-1)?.workflowDispatch ? "Saved for selected native workflow continuation. Not yet dispatched." : "Saved for interpretation. Intake only.",
        },
      };
      state.receipts.push({ fingerprint, result });
      const expected = state.revision;
      state.revision++;
      try {
        await this.store.save(
          state,
          expected,
          () => this.epoch === epoch && this.binding === binding,
        );
        return result;
      } catch (error) {
        this.uncertain = { id: state.id, requestKey: message.requestKey };
        this.revoke();
        return {
          kind: "uncertain",
          requestKey: message.requestKey,
          message: `Reconcile status ${state.id} before another mutation. ${String(error)}`,
        };
      }
    });
  }
}
