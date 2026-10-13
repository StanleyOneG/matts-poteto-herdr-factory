import { isDeepStrictEqual } from "node:util";
import { checkoutIdentity } from "./checkout-identity.js";
import { loadLegionSettings, selectTribunusModel, type LegionSettings, type TribunusModelIntent, type WorkflowChoice } from "./legion-settings.js";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { mattInitializationPrompt, requiredWorkflowSkills, LaunchRecord, VerifiedWorker, Initialization, BoundedAssignment, WorkerAddress, projectLaunch, type LaunchResult, type LaunchView, type TribunusHost } from "./tribunus.js";
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
import type {
  WorkspaceRepository,
  GitOutcome,
  WorkspaceObservation,
} from "./git-workspace.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
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
    category: z.enum(["requirements", "financial", "access", "irreversible"]),
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
    }
  >;
  settings: LegionSettings | null;
  tribuniModel: TribunusModelIntent | null;
  diagnostics: Diagnostic[];
  unavailable: string | null;
  ownerObservations?: ClaimView[];
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
  | { kind: "launch-stage"; requestId: string; message: string }
  | { kind: "launched"; launch: LaunchResult; message: string }
  | { kind: "native-stage"; source: z.infer<typeof SubmissionRef>; dispatch: z.infer<typeof WorkflowDispatch> };
type CommandIntent =
  | { kind: "status"; id: string }
  | { kind: "doctor" | "on" | "off" }
  | { kind: "resume"; id: string }
  | { kind: "task"; text: string }
  | { kind: "profile-on"; text: string }
  | { kind: "profile-off" }
  | { kind: "workflow"; text: string }
  | { kind: "workspace"; id: string }
  | { kind: "launch"; task: z.infer<typeof TaskRef> }
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
export type LegionOptions = {
  storagePath: string;
  context: string;
  session: string;
  preflight: (settings?: LegionSettings) => Promise<Diagnostic[]>;
  loadSettings?: () => Promise<LegionSettings>;
  storageFault?: (point: StorageFaultPoint) => void;
  tribuni?: { host: () => TribunusHost | null; onUnavailable?: (message: string) => void };
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
  private store: SnapshotStore;
  private settings: LegionSettings | null = null;
  private activationDiagnostics: Diagnostic[] = [];
  private settingsView() {
    return { settings: this.settings, tribuniModel: this.settings ? selectTribunusModel({ kind: "new", settings: this.settings }) : null };
  }
  private assignmentModelIntent(launch: LaunchView | undefined): TribunusModelIntent | null {
    const progress = launch?.kind === "held" ? launch.last : launch;
    if (progress && "assignment" in progress)
      return selectTribunusModel({ kind: "existing", ...(progress.assignment.modelPin ? { pin: progress.assignment.modelPin } : {}) });
    if (progress?.kind === "unavailable") return { kind: "existing-unknown" };
    return this.settingsView().tribuniModel;
  }
  private taskWorkflow(snapshot: LegatusSnapshot, task: string, launch: LaunchView | undefined) {
    if (launch?.kind === "unavailable")
      return { workflowChoice: null, workflowHold: "Existing assignment workflow pin is unavailable. Preserve launch history; do not reconstruct from future defaults." };
    const progress = launch?.kind === "held" ? launch.last : launch;
    if (progress && "assignment" in progress)
      return { workflowChoice: progress.assignment.workflowChoice ?? null, workflowHold: null };
    const pending = snapshot.launchRequests.find(request => request.task.id === task);
    const choice = pending ? pending.workflowChoice ?? null : snapshot.workflowChoice;
    return { workflowChoice: choice, workflowHold: workflowFailure(choice)?.message ?? null };
  }
  private selected: string | null = null;
  private binding: Binding | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private stopping = false;
  private stopRequested = false;
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
    this.epoch++;
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
    const commonDir = snapshot.workspaceRequests
      .filter((r) => r.repository)
      .at(-1)?.repository;
    if (!commonDir)
      return {
        all: Array<ClaimView>(),
        byTask: new Map<string, ClaimView>(),
        fallback,
      };
    try {
      const observed = await new AssignmentLedger({
        commonDir,
        owner: snapshot.id,
        fault: this.options.assignments?.fault,
        expectedRepository: snapshot.workspaceRequests.find(
          (r) => r.repository === commonDir && r.repositoryId,
        )?.repositoryId ?? null,
        historyRequired: true,
      }).observations(snapshot.id);
      return {
        all: observed.claims,
        byTask: observed.byTask,
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
    const resolutions = state.resolutions.filter((r) =>
      state.decisions.some(
        (d) =>
          d.id === r.decision.id &&
          d.history.at(-1)?.affected.some((t) => t.id === ref.id),
      ),
    );
    return createHash("sha256")
      .update(
        JSON.stringify({
          history: task.history.at(-1),
          scope: task.scope,
          resolutions,
        }),
      )
      .digest("hex");
  }
  private workspaceAuthority(
    request: z.infer<typeof WorkspaceRequest> | z.infer<typeof LaunchRequest>,
    epoch: number,
  ) {
    if (
      !this.binding ||
      this.stopping ||
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
    this.workspaceAuthority(request, epoch);
    const state = this.selected ? await this.store.read(this.selected) : null;
    this.workspaceAuthority(request, epoch);
    if (!state) throw new Error("Intake authority is unavailable.");
    if (request.nativeDispatch) this.nativeAuthority(state, request.nativeDispatch, request.evidence.session, request.generation);
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
      if (this.stopping && !this.invocations) this.revoke();
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
        }).launchState(claim.reservation, snapshot.launchRequests.find((r) => r.task.id === task && r.attempt)?.attempt ?? null));
      } catch (error) { views.set(task, { kind: "unavailable", message: String(error) }); }
    }
    return views;
  }
  private async executeLaunch(id: string): Promise<OperationResult> {
    const epoch = this.epoch;
    const git = this.options.assignments?.repository();
    const host = this.options.tribuni?.host();
    if (!git || !host) return reject("permission-path", "Launch requires a live guarded legion_launch tool context. No worker started.");
    const owned = () => !!this.binding && !this.stopping && this.epoch === epoch;
    let entered = false;
    try {
      const snapshot = this.selected ? await this.store.read(this.selected) : null;
      const request = snapshot?.launchRequests.find((r) => r.id === id);
      if (!request) return reject("launch-request", "No durably saved host launch request exists.");
      const authority = await this.authorized(request, epoch);
      this.workspaceAuthority(request, epoch);
      this.invocations++;
      entered = true;
      const location = await git.locate();
      await this.authorized(request, epoch);
      if (location.commonDir !== request.repository) throw new Error("Repository association changed.");
      const ledger = new AssignmentLedger({
        commonDir: location.commonDir,
        owner: authority.state.id,
        fault: this.options.assignments?.fault,
        expectedRepository: request.repositoryId,
        historyRequired: true,
      });
      const observed = await ledger.observations(authority.state.id);
      await this.authorized(request, epoch);
      const claim = observed.byTask.get(request.task.id);
      if (claim?.kind !== "owned" || claim.workspace.kind !== "ready" || claim.reservation.approval.scope !== request.scope)
        return reject("launch-claim", "Confirmed owned current claim and ready workspace required. No worker started.");
      const reservation = claim.reservation;
      const revalidate = async () => {
        await this.authorized(request, epoch);
        const current = await ledger.observations(reservation.owner);
        await this.authorized(request, epoch);
        const currentClaim = current.byTask.get(request.task.id);
        if (currentClaim?.kind !== "owned" || JSON.stringify(currentClaim.reservation) !== JSON.stringify(reservation) || currentClaim.workspace.kind !== "ready")
          throw new Error("Claim authority changed. Preserve the launch.");
        const actual = await git.inspect(reservation.plan);
        await this.authorized(request, epoch);
        if (!actual.workspace || !actual.workspace.backlink || actual.workspace.commonDir !== ledger.commonDir || actual.workspace.branch !== reservation.plan.branch || actual.branch !== actual.workspace.commit || actual.path !== "directory")
          throw new Error("Ready workspace association changed. Preserve branch, path, and launch.");
      };
      await revalidate();
      const known = authority.state.launchRequests.find((r) => r.task.id === request.task.id && r.attempt)?.attempt ?? null;
      let launch = await ledger.beginLaunch(reservation, owned, known);
      await this.serialize(async () => {
        const current = await this.authorized(request, epoch);
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
          const window = await host.createWindow({ launch, cwd: reservation.plan.path, workflowChoice: request.workflowChoice, startupSelection: request.startupSelection });
          await this.authorized(request, epoch);
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
          await host.startPi({ launch, window, startupSelection: request.startupSelection });
          startEvidence = { kind: "completed" };
        } catch (error) {
          startEvidence = { kind: "uncertain", message: String(error) };
        }
        await save(dispatch, startEvidence);
        await this.authorized(request, epoch);
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
        await this.authorized(request, epoch);
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
        await this.authorized(request, epoch);
        await save({ kind: "initializing", worker: launch.state.worker, command: randomUUID() });
      }
      if (launch.state.kind === "initializing") {
        const phase = launch.state;
        this.workspaceAuthority(request, epoch);
        if (!request.workflowChoice) throw new Error("Captured workflow choice unavailable.");
        let observed: Awaited<ReturnType<TribunusHost["initialize"]>>;
        try { observed = await host.initialize({ worker: phase.worker, command: phase.command, workflowChoice: request.workflowChoice }); }
        catch (error) { return hold("initialization-outcome-unknown", `Native initialization is unresolved or refused. Preserve the same command and worker; no alternate skill or toggle. ${String(error)}`); }
        await this.authorized(request, epoch);
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
        const current = await this.authorized(request, epoch);
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
        const assignment = BoundedAssignment.parse({ task: request.task, scope: request.scope, goal: task.goal, acceptance: task.acceptance, workflow, workflowChoice, authority: "bounded-implementation-only", modelPin: { model: principal.model, thinking: principal.thinking, profile: workflowChoice.profile } });
        await save({ kind: "assigning", worker: { ...phase.worker, resources: observed.resources }, initialization: phase.initialization, command: randomUUID(), assignment });
      }
      if (launch.state.kind === "assigning") {
        const phase = launch.state;
        await revalidate();
        this.workspaceAuthority(request, epoch);
        const application = await host.assign(phase);
        if (!application) return hold("assignment-outcome-unknown", "Assignment application is unknown. Preserve the same addressed command. Do not send another assignment.");
        await this.authorized(request, epoch);
        await save({ ...phase, kind: "assigned", application: application.application });
      }
      if (launch.state.kind === "assigned") {
        const assigned = launch.state;
        host.watchEffects?.({ worker: assigned.worker, command: assigned.command }, async message => EffectReply.parse(await this.submit(message)), message => this.options.tribuni?.onUnavailable?.(message));
        host.watchReports?.({ worker: assigned.worker, command: assigned.command }, async (report) => {
          if (report.command !== assigned.command || JSON.stringify(report.address) !== JSON.stringify(assigned.worker.address) || launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...launch.state, kind: "reported", report: { outcome: report.outcome, assistantText: report.assistantText, evidence: report.evidence, contract: report.contract, engineering: report.engineering } }, () => true);
        }, async (message) => {
          if (launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { kind: "held", last: launch.state, code: "report-evidence-unavailable", message: `Worker report evidence is unavailable. Preserve the applied assignment and receipt. ${message}` }, () => true);
        }, async observation => {
          if (observation.command !== assigned.command || !isDeepStrictEqual(observation.address, assigned.worker.address)) return;
          const current = launch.state;
          if (current.kind !== "assigned" && current.kind !== "reported") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...current, worker: { ...current.worker, resources: { ...current.worker.resources, children: observation.children } } }, () => true);
        });
      }
      return result();
    } catch (error) {
      return { kind: "uncertain", requestKey: id, message: `Launch authority or effect evidence unavailable. Preserve all resources and the saved attempt. No fallback or retry. ${String(error)}` };
    } finally {
      if (entered) this.invocations--;
      if (this.stopping && !this.invocations) this.revoke();
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
      const unresolvedLaunch = [...launches.values()].some((launch) => launch.kind !== "not-launched" && launch.kind !== "prepared");
      const unresolvedResearch = hasLegacyResearchHold(snapshot);
      return {
        mode: this.stopping || unresolvedResearch && (!this.binding || this.stopRequested) || (this.stopRequested && unresolvedLaunch || !this.binding && snapshot?.effects.some(effect => effect.state.kind === "outstanding" || effect.state.kind === "unknown")) ? "stopping" : this.binding ? "active" : "inactive",
        ownerObservations: claims.all,
        snapshot,
        tasks:
          snapshot?.tasks.map((t) => ({
            ...t,
            claim: claims.byTask.get(t.id) ?? claims.fallback,
            launch: launches.get(t.id) ?? { kind: "not-launched" },
            tribunusModel: this.assignmentModelIntent(launches.get(t.id)),
            ...this.taskWorkflow(snapshot, t.id, launches.get(t.id)),
            eligibility:
              !this.binding || this.stopping
                ? "inactive"
                : snapshot.decisions.some(
                      (d) =>
                        d.state.kind === "open" &&
                        d.history.at(-1)?.affected.some((a) => a.id === t.id),
                    )
                  ? "blocked"
                  : "admitted",
          })) ?? [],
        ...this.settingsView(),
        diagnostics: this.activationDiagnostics,
        unavailable: null,
      };
    } catch (error) {
      return {
        mode: this.stopping ? "stopping" : this.binding ? "active" : "inactive",
        snapshot: null,
        tasks: [],
        ...this.settingsView(),
        diagnostics: this.activationDiagnostics,
        unavailable: String(error),
      };
    }
  }
  private nativeAuthority(state: LegatusSnapshot, id: string, session: string, generation: number) {
    const source = state.submissions.find(source => source.workflowDispatch && "id" in source.workflowDispatch && source.workflowDispatch.id === id);
    const dispatch = source?.workflowDispatch;
    if (!this.binding || this.stopping || !dispatch || dispatch.kind !== "applied-native" ||
        session !== this.options.session || dispatch.session !== session || generation !== this.binding.generation ||
        dispatch.generation !== generation || dispatch.workflow !== state.workflowChoice.requestedWorkflow || workflowFailure(state.workflowChoice))
      throw new Error("No applied current native workflow authority. Off, conflict, resume or uncertain delivery withholds managed dispatch.");
    return { source, dispatch };
  }
  async nativeWorkflow(raw: unknown): Promise<OperationResult> {
    const input = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("prepare"), source: SubmissionRef, id: z.uuid(), skillPath: z.string().min(1), input: z.string().min(1), prompt: z.string().min(1), session: z.string(), generation: z.int().positive() }),
      z.object({ kind: z.literal("hold"), source: SubmissionRef, message: z.string(), session: z.string(), generation: z.int().positive() }),
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
      const source = state.submissions.find(source => "source" in data
        ? source.id === data.source.id && source.revision === data.source.revision
        : source.workflowDispatch && "id" in source.workflowDispatch && source.workflowDispatch.id === data.id);
      if (!source?.workflowDispatch) return reject("native-source", "No pending native source.");
      const previous = source.workflowDispatch;
      if (data.kind === "prepare" || data.kind === "hold") {
        if (previous.kind !== "pending-native" && previous.kind !== "held-native")
          return reject("native-replay", "Native dispatch already attempted. Reconcile its journal; never replay an uncertain delivery.");
        const failure = workflowFailure(state.workflowChoice);
        if (data.kind === "hold") source.workflowDispatch = { kind: "held-native", message: data.message };
        else {
          if (failure) return failure;
          const invocation = source.workflowInvocation;
          const prior = [...state.submissions].reverse().find(source => source.workflowDispatch?.kind === "applied-native");
          const root = invocation ? { id: source.id, revision: source.revision } : prior?.workflowDispatch && "root" in prior.workflowDispatch ? prior.workflowDispatch.root : null;
          const workflow = state.workflowChoice.requestedWorkflow;
          if (!root || workflow === "unknown") return reject("native-source", "Explicit Emperor workflow source required.");
          source.workflowDispatch = { kind: "dispatching-native", id: data.id, session: data.session, generation: data.generation, skillPath: data.skillPath, input: data.input, prompt: data.prompt, root, workflow };
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
          source.workflowDispatch = { ...previous, kind: "applied-native", journal: data.journal, entry: data.entry };
        } else source.workflowDispatch = { ...previous, kind: "uncertain-native", message: data.message };
      }
      const expected = state.revision++;
      try {
        await this.store.save(state, expected, () => this.binding === binding && epoch === this.epoch && !this.stopping);
        return { kind: "native-stage", source: { id: source.id, revision: source.revision }, dispatch: source.workflowDispatch };
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
    if (!["reserve", "reconcile", "workspace", "launch"].includes(intent.kind)) return denied("Native workflow may request only existing bounded reserve, reconcile, workspace or launch stages. No profile, publication or Emperor command authority.");
    try {
      const state = this.selected ? await this.store.read(this.selected) : null;
      if (!state) return denied("Native state unavailable.");
      const authority = this.nativeAuthority(state, dispatch, session, generation);
      const taskId = intent.kind === "reserve" || intent.kind === "launch" ? intent.task.id : intent.kind === "reconcile" ? intent.task : intent.kind === "workspace" ? state.workspaceRequests.find(request => request.id === intent.id)?.intent.task : null;
      const id = typeof taskId === "string" ? taskId : taskId?.id;
      const task = state.tasks.find(task => task.id === id);
      if (!task || !state.submissions.some(source => source.id === task.scope.original && source.workflowDispatch && "root" in source.workflowDispatch && source.workflowDispatch.root.id === authority.dispatch.root.id))
        return denied("Task is not admitted from this Emperor-approved native workflow source.");
      // Derived host authority is never supplied by the model and never changes Emperor provenance.
      return await this.command({ text, requestKey, nativeDispatch: dispatch, evidence: { origin: "host-command", transport: "source-unavailable", session, generation, presented: [] } });
    } catch (error) { return denied(String(error)); }
  }
  command(raw: unknown): Promise<CommandResult> {

    const launchExecution = z.object({ launchRequest: z.string().min(1) }).strict().safeParse(raw);
    if (launchExecution.success) return this.executeLaunch(launchExecution.data.launchRequest).then((result) => ({ ...result, disposition: "workspace" }));
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
      "profile-on": "submit",
      "profile-off": "activate",
      workflow: "submit",
      reserve: "workspace",
      reconcile: "workspace",
      workspace: "workspace",
      launch: "workspace",
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
          "Use on, task <text>, poteto-mode=on <instructions>, poteto-mode=off, implement-spec=on <instructions>, status [id], doctor, off, resume <id>, reserve <task-id>@<revision> --parent <refs/heads/branch> [--source <GitHub issue URL>], reconcile <task-id>, workspace <request-id>, or launch <task-id>@<revision>. Use task to escape reserved arguments.",
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
      this.revoke();
      return this.state().then((view) => ({ kind: "observed", view }));
    }
    const epoch = this.epoch;
    if (intent.kind === "launch")
      return this.serialize(async () => {
        const view = await this.state();
        const task = view.tasks.find((t) => t.id === intent.task.id);
        if (view.mode !== "active") return reject("inactive", "Activate or explicitly resume Legion before launching work.");
        if (!view.snapshot) return reject("unavailable", "Intake records unavailable.");
        try {
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
            mode: hasLegacyResearchHold(snapshot) || snapshot?.effects.some(effect => effect.state.kind === "outstanding" || effect.state.kind === "unknown") ? "stopping" : "inactive",
            snapshot,
            ownerObservations: claims.all,
            tasks:
              snapshot?.tasks.map((t) => ({
                ...t,
                eligibility: "inactive",
                claim: claims.byTask.get(t.id) ?? claims.fallback,
                launch: launches.get(t.id) ?? { kind: "not-launched" },
                tribunusModel: this.assignmentModelIntent(launches.get(t.id)),
                ...this.taskWorkflow(snapshot, t.id, launches.get(t.id)),
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
      const taskText = intent.kind === "task" || intent.kind === "profile-on" || intent.kind === "workflow" ? intent.text : "";
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
        if (resume && state) {
          for (const commonDir of new Set(
            state.workspaceRequests.flatMap((r) =>
              r.repository ? [r.repository] : [],
            ),
          )) {
            try {
              await new AssignmentLedger({
                commonDir,
                owner: state.id,
                fault: this.options.assignments?.fault,
                expectedRepository: state.workspaceRequests.find(
                  (r) => r.repository === commonDir && r.repositoryId,
                )?.repositoryId ?? null,
                historyRequired: true,
              }).recoverExisting(() => epoch === this.epoch);
            } catch (error) {
              return reject(
                "assignment-recovery",
                `Assignment authority unavailable. Reservations retained. ${String(error)}`,
              );
            }
          }
        }
        if (state && state.context !== this.options.context)
          return reject(
            "context",
            "Legatus belongs to a different working context.",
          );
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
            originIntent: { kind: "new-task" },
            workflowChoice: { ...snapshot.workflowChoice },
            ...(workflowInvocation ? { workflowInvocation } : {}),
            ...(intent.kind === "workflow" || input.workflowInvocation ? { workflowDispatch: { kind: "pending-native" } } : {}),
            state: { kind: "pending", routing: { kind: "new-task" } },
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
        try {
          await this.store.save(
            snapshot,
            expectedRevision,
            () => this.epoch === epoch && !!this.binding,
          );
        } catch (error) {
          this.uncertain = { id: snapshot.id, requestKey: input.requestKey };
          this.revoke();
          return {
            kind: "uncertain",
            requestKey: input.requestKey,
            message: `Commit could not be established. Reconcile status ${snapshot.id} and retry the same request key. ${String(error)}`,
          };
        }
        if (!ready) this.revoke();
        else {
          if (explicitActivation) this.settings = prospectiveSettings;
          this.stopRequested = false;
        }
        return result;
      } finally {
        try {
          if (recoveryLock) release(recoveryLock);
        } finally {
          if (ownership.kind === "acquiring" && !adopted)
            release(ownership.association);
        }
      }
    });
  }
  private submitEffect(message: z.infer<typeof EffectMessage>): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const view = await this.state(), state = view.snapshot, binding = this.binding;
      if (!state || !binding || this.uncertain) return reject("effect-controller", "Current effect controller is unavailable or uncertain. Preserve the same intent.");
      if (message.kind === "centurio-owner-check") {
        const pin = message.pin, task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
        if (view.mode !== "active" || epoch !== this.epoch || this.stopping || pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch)
          return reject("centurio-controller", "The child owner is no longer the current controller. No child work admitted.");
        if (task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || (launch?.kind !== "assigned" && !(message.stage === "read" && launch?.kind === "reported")))
          return reject("centurio-assignment", "The child no longer has the current owned assignment.");
        try {
          if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || launch.worker.address.launch !== pin.launch || launch.worker.address.session !== pin.workerSession || launch.worker.address.generation !== pin.workerGeneration || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
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
          if (this.stopping && !this.invocations) this.revoke();
          return { kind: "effect", effect: record };
        } catch (error) { return reject("effect-observation-unknown", `Retain the same effect observation for reconciliation. ${String(error)}`); }
      }
      const intent = message.intent, pin = intent.pin;
      const existing = state.effects.find(effect => effect.intent.id === intent.id || effect.intent.pin.workerSession === pin.workerSession && effect.intent.pin.workerGeneration === pin.workerGeneration && effect.intent.call.id === intent.call.id && (effect.intent.origin?.kind === "centurio" ? effect.intent.origin.session : null) === (intent.origin?.kind === "centurio" ? intent.origin.session : null));
      if (existing) return isDeepStrictEqual(existing.intent, intent) ? { kind: "effect", effect: existing } : reject("effect-conflict", "Call identity already belongs to a different retained intent. No retry.");
      if (intent.origin?.kind === "centurio") return reject("effect-child-retired", "Native child effects use assignment-level launch authority, not the retired per-call protocol. Retain legacy records without adoption.");
      if (view.mode !== "active" || epoch !== this.epoch || this.stopping) return reject("effect-revoked", "No new effect admission after controller revocation.");
      if (state.effects.some(effect => effect.intent.pin.workerSession === pin.workerSession && effect.intent.pin.workerGeneration === pin.workerGeneration && effect.state.kind === "unknown"))
        return reject("effect-unresolved", "A prior native effect outcome is unknown. Reconcile the same identity before new work.");
      const task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
      if (pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch || task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || launch?.kind !== "assigned")
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
  submit(raw: unknown): Promise<OperationResult> {
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
        const repeatedSpec = native?.dispatch.workflow === "implement-spec" && proposal.kind === "new-task" && proposal.source.id === native.dispatch.root.id;
        const source = state.submissions.find(
          (s) =>
            s.id === proposal.source.id &&
            s.revision === proposal.source.revision &&
            (s.state.kind === "pending" || repeatedSpec && s.state.kind === "applied"),
        );
        if (
          !source ||
          !message.evidence.sources.some(
            (s) => s.id === source.id && s.revision === source.revision,
          ) ||
          (source.state.kind !== "pending" && !repeatedSpec)
        )
          return reject(
            "stale-source",
            "Source is not pending in this interpretation run.",
          );
        const routing = source.state.kind === "pending" ? source.state.routing : { kind: "new-task" } as const;
        if (routing.kind === "new-task" && proposal.kind !== "new-task")
          return reject(
            "routing",
            "Explicit new-task intent cannot change another assignment. Attach questions to the new task.",
          );
        if (routing.kind === "correction") {
          const targets =
            proposal.kind === "technical-choice"
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
