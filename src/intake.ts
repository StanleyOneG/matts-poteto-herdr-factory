import { ResearchRequest, ResearchOwner, ResearchRecord, ResearchObservation, ResearchCheck, ResearchStageEvent } from "./owned-children.js";
import { approvedSeam, currentEngineering } from "./engineering.js";
import { readCenturio } from "./centuriones.js";
import { verifyCenturioWorkspace } from "./centurio-workspace.js";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { EngineeringObservation, EngineeringRequest, LaunchRecord, VerifiedWorker, Initialization, BoundedAssignment, WorkerAddress, projectLaunch, type LaunchResult, type LaunchView, type TribunusHost } from "./tribunus.js";
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
  EngineeringProposal,
  EngineeringRecord,
  EngineeringDecision,
  EngineeringDeliveryReceipt,
  EffectMessage, EffectRecord, EffectReply,
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
  }),
});
const EngineeringDecisionInput = z.object({
  kind: z.literal("engineering-decision"), requestKey: z.uuid(),
  request: z.object({ id: z.uuid(), digest: z.string() }).strict(), decision: EngineeringDecision,
  evidence: z.object({
    kind: z.literal("legatus"), owner: LegatusId, session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative(),
    run: z.string().min(1), requests: z.array(z.object({ id: z.uuid(), digest: z.string() }).strict()).min(1),
  }).strict(),
}).strict();
const EngineeringInput = z.discriminatedUnion("kind", [EngineeringRequest, EngineeringDecisionInput]);
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
    }
  >;
  diagnostics: Diagnostic[];
  unavailable: string | null;
  ownerObservations?: ClaimView[];
  researchOwner?: z.infer<typeof ResearchOwner>;
};
export type OperationResult =
  | { kind: "research-prepared"; research: z.infer<typeof ResearchRecord> }
  | { kind: "research-current"; owner: z.infer<typeof ResearchOwner> }
  | { kind: "research-observed" }
  | { kind: "research-stage"; requestId: string; message: string }
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
  | { kind: "launched"; launch: LaunchResult; message: string };
type CommandIntent =
  | { kind: "status"; id: string }
  | { kind: "doctor" | "on" | "off" }
  | { kind: "resume"; id: string }
  | { kind: "task"; text: string }
  | { kind: "workspace"; id: string }
  | { kind: "launch"; task: z.infer<typeof TaskRef> }
  | { kind: "research"; task: string }
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
      return payload.trim() ? { kind: "research", task: payload.trim() } : { kind: "invalid" };
    case "task":
      return payload.trim()
        ? { kind: "task", text: payload }
        : { kind: "invalid" };
    default:
      return { kind: "task", text };
  }
}
export type LegionOptions = {
  storagePath: string;
  context: string;
  session: string;
  preflight: () => Promise<Diagnostic[]>;
  storageFault?: (point: StorageFaultPoint) => void;
  research?: { prepare: (request: z.infer<typeof ResearchRequest>, owner: z.infer<typeof ResearchOwner>) => Promise<unknown> };
  tribuni?: { host: () => TribunusHost | null; onEngineering?: (unavailable?: string) => void };
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
  private selected: string | null = null;
  private binding: Binding | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private stopping = false;
  private stopRequested = false;
  private researchPending = false;
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
    if (this.researchPending) { this.stopping = true; return; }
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
      const observed = await new AssignmentLedger(
        commonDir,
        this.options.assignments?.fault,
        snapshot.workspaceRequests.find(
          (r) => r.repository === commonDir && r.repositoryId,
        )?.repositoryId ?? null,
        true,
      ).observations(snapshot.id);
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
            const replay = await new AssignmentLedger(
              prior.repository,
              this.options.assignments.fault,
              state.workspaceRequests.find(
                (r) => r.repository === prior.repository && r.repositoryId,
              )?.repositoryId ?? null,
            ).replay(state.id, prior.id, fingerprint);
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
      const ledger = new AssignmentLedger(
        location.commonDir,
        dependencies.fault,
        knownRepository,
        locatedAuthority.state.workspaceRequests.some(
          (r) => r.repository === location.commonDir,
        ),
      );
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
  private async launchViews(snapshot: LegatusSnapshot | null, claims: Map<string, ClaimView>) {
    const views = new Map<string, LaunchView>();
    if (!snapshot) return views;
    for (const [task, claim] of claims) {
      if (claim.kind !== "owned") continue;
      const request = snapshot.workspaceRequests.find((r) => r.repositoryId === claim.reservation.repository);
      if (!request?.repository) continue;
      try {
        views.set(task, await new AssignmentLedger(request.repository, this.options.assignments?.fault, request.repositoryId, true).launchState(claim.reservation, snapshot.launchRequests.find((r) => r.task.id === task && r.attempt)?.attempt ?? null));
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
      const ledger = new AssignmentLedger(location.commonDir, this.options.assignments?.fault, request.repositoryId, true);
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
      if (launch.state.kind === "held") {
        if (!["startup-outcome-unknown", "initialization-outcome-unknown", "assignment-outcome-unknown"].includes(launch.state.code)) return result();
        await save(launch.state.last);
      }
      if (launch.state.kind === "prepared") {
        await revalidate();
        await save({ kind: "window-dispatched", operation: randomUUID() });
        if (!owned()) throw new Error("Authority revoked before window invocation.");
        try {
          const window = await host.createWindow({ launch, cwd: reservation.plan.path });
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
          await host.startPi({ launch, window });
          startEvidence = { kind: "completed" };
        } catch (error) {
          startEvidence = { kind: "uncertain", message: String(error) };
        }
        await save(dispatch, startEvidence);
        await this.authorized(request, epoch);
      }
      if (launch.state.kind === "pi-dispatched") {
        const worker = await host.inspectWorker({ launch, window: launch.state.window, cwd: reservation.plan.path });
        await this.authorized(request, epoch);
        if (!worker) return hold("startup-outcome-unknown", "Pi startup may have applied but exact worker identity is unavailable. Preserve window, worktree, claim, and attempt. No restart or replacement.");
        const verified = VerifiedWorker.parse(worker);
        if (verified.address.launch !== launch.id || JSON.stringify(verified.address.window) !== JSON.stringify(launch.state.window))
          return hold("worker-identity", "Worker incarnation or local Herdr identity does not match the owned launch. Assignment withheld.");
        if (verified.resources.cwd !== reservation.plan.path || verified.resources.diagnostics.some((d) => d.status !== "ready") || ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "implement", "code-review"].some((name) => !verified.resources.skills.some((s) => s.name === name)))
          return hold("worker-resources", `Actual target worktree resources are missing or incompatible. No substitution or assignment. ${verified.resources.diagnostics.filter(d => d.status !== "ready").map(d => d.message).join(" ")}`);
        await save({ kind: "verified", worker: verified });
      }
      if (launch.state.kind === "verified") {
        await this.authorized(request, epoch);
        await save({ kind: "initializing", worker: launch.state.worker, command: randomUUID() });
      }
      if (launch.state.kind === "initializing") {
        const phase = launch.state;
        this.workspaceAuthority(request, epoch);
        const observed = await host.initialize({ worker: phase.worker, command: phase.command });
        await this.authorized(request, epoch);
        if (!observed) return hold("initialization-outcome-unknown", "Native initialization has no conclusive applied and settled evidence. Assignment withheld. Preserve the same command and worker.");
        const initialization = Initialization.parse(observed);
        const skill = phase.worker.resources.skills.find((s) => s.name === "poteto-mode");
        if (initialization.command !== phase.command || JSON.stringify(initialization.address) !== JSON.stringify(phase.worker.address) || initialization.skillPath !== skill?.path || !initialization.nativePrompt.includes(`<skill name="poteto-mode" location="${skill.path}">`) || !initialization.modeEntry || !initialization.settledEntry)
          return hold("initialization-evidence", "Native prompt, newly applied pstack mode, settlement, command, or worker identity do not agree. Assignment withheld.");
        await save({ kind: "initialized", worker: phase.worker, initialization });
      }
      if (launch.state.kind === "initialized") {
        const phase = launch.state;
        await revalidate();
        const observed = await host.inspectWorker({ launch, window: phase.worker.address.window, cwd: reservation.plan.path });
        const current = await this.authorized(request, epoch);
        if (!observed || JSON.stringify(observed.address) !== JSON.stringify(phase.worker.address) || observed.resources.cwd !== reservation.plan.path || observed.resources.diagnostics.some((d) => d.status !== "ready") || JSON.stringify(observed.resources.skills) !== JSON.stringify(phase.worker.resources.skills))
          return hold("worker-changed", "Exact initialized worker or target resources changed before assignment. Preserve the worker. No successor adoption.");
        const task = current.state.tasks.find((t) => t.id === request.task.id)?.history.at(-1);
        if (!task) throw new Error("Current task unavailable.");
        const assignment = BoundedAssignment.parse({ task: request.task, scope: request.scope, goal: task.goal, acceptance: task.acceptance, workflow: "implement", testContract: "Matt TDD at Legatus-approved public seams; request an explicit exception if impractical", authority: "bounded-implementation-only" });
        await save({ kind: "assigning", worker: phase.worker, initialization: phase.initialization, command: randomUUID(), assignment });
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
        host.watchEffects?.({ worker: assigned.worker, command: assigned.command }, async message => EffectReply.parse(await this.submit(message)), message => this.options.tribuni?.onEngineering?.(message));
        host.watchEngineering?.({ worker: assigned.worker, command: assigned.command }, async (request) => {
          const result = await this.submit(request);
          this.options.tribuni?.onEngineering?.();
          if (result.kind !== "applied") throw new Error(JSON.stringify(result));
        }, async (message) => { this.options.tribuni?.onEngineering?.(message); });
        host.watchReports?.({ worker: assigned.worker, command: assigned.command }, async (report) => {
          if (report.command !== assigned.command || JSON.stringify(report.address) !== JSON.stringify(assigned.worker.address) || launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...launch.state, kind: "reported", report: { outcome: report.outcome, assistantText: report.assistantText, evidence: report.evidence, contract: report.contract, engineering: report.engineering } }, () => true);
        }, async (message) => {
          if (launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { kind: "held", last: launch.state, code: "report-evidence-unavailable", message: `Worker report evidence is unavailable. Preserve the applied assignment and receipt. ${message}` }, () => true);
        }, async (observation) => {
          if (observation.command !== assigned.command || JSON.stringify(observation.address) !== JSON.stringify(assigned.worker.address) || launch.state.kind !== "assigned") return;
          const current = launch.state;
          launch = await ledger.updateLaunch(reservation, launch, { ...current, worker: { ...current.worker, resources: { ...current.worker.resources, contract: observation.contract } } }, () => true);
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
      const launches = await this.launchViews(snapshot, claims.byTask);
      const unresolvedLaunch = [...launches.values()].some((launch) => launch.kind !== "not-launched" && launch.kind !== "prepared");
      const unresolvedResearch = !!snapshot?.researchHold || !!snapshot?.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind));
      return {
        mode: this.stopping || unresolvedResearch && (!this.binding || this.stopRequested) || (this.stopRequested && unresolvedLaunch || !this.binding && snapshot?.effects.some(effect => effect.state.kind === "outstanding" || effect.state.kind === "unknown")) ? "stopping" : this.binding ? "active" : "inactive",
        ...(snapshot && this.binding ? { researchOwner: ResearchOwner.parse({ role: "legatus", owner: snapshot.id, session: this.options.session, generation: this.binding.generation, epoch: this.epoch }) } : {}),
        ownerObservations: claims.all,
        snapshot,
        tasks:
          snapshot?.tasks.map((t) => ({
            ...t,
            claim: claims.byTask.get(t.id) ?? claims.fallback,
            launch: launches.get(t.id) ?? { kind: "not-launched" },
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
        diagnostics: [],
        unavailable: null,
      };
    } catch (error) {
      return {
        mode: this.stopping ? "stopping" : this.binding ? "active" : "inactive",
        snapshot: null,
        tasks: [],
        diagnostics: [],
        unavailable: String(error),
      };
    }
  }
  command(raw: unknown): Promise<CommandResult> {
    const delivery = z.object({ engineeringDelivery: z.uuid() }).strict().safeParse(raw);
    if (delivery.success) return this.deliverEngineering(delivery.data.engineeringDelivery).then(result => ({ ...result, disposition: "workspace" }));
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
    const dispositions = {
      status: "observe",
      doctor: "observe",
      on: "activate",
      off: "off",
      resume: "resume",
      task: "submit",
      reserve: "workspace",
      reconcile: "workspace",
      workspace: "workspace",
      launch: "workspace",
      research: "workspace",
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
    if (intent.kind === "invalid")
      return Promise.resolve(
        reject(
          "usage",
          "Use on, task <text>, research <bounded task>, status [id], doctor, off, resume <id>, reserve <task-id>@<revision> --parent <refs/heads/branch> [--source <GitHub issue URL>], reconcile <task-id>, workspace <request-id>, or launch <task-id>@<revision>. Use task to escape reserved arguments.",
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
    if (intent.kind === "research") return this.serialize(async () => {
      const view = await this.state(), state = view.snapshot;
      if (!state || !view.researchOwner || view.mode !== "active" || this.stopRequested || epoch !== this.epoch) return reject("research-inactive", "Activate Legion before requesting preparatory research.");
      if (input.evidence.generation !== null && input.evidence.generation !== view.researchOwner.generation) return reject("research-owner", "Research command generation is stale.");
      if (state.researchHold || state.researchRequests.some(stage => stage.state.kind !== "settled")) return reject("research-stage", "An earlier research stage is unsettled. Inspect status; no duplicate dispatch.");
      const expected = state.revision++;
      state.researchRequests.push({ id: z.uuid().parse(input.requestKey), task: intent.task, owner: view.researchOwner, state: { kind: "requested" } });
      try { await this.store.save(state, expected, () => epoch === this.epoch && !!this.binding && !this.stopping); }
      catch (error) { return { kind: "uncertain", requestKey: input.requestKey, message: `Research stage persistence uncertain. Preserve the same request. ${String(error)}` }; }
      return { kind: "research-stage", requestId: input.requestKey, message: "Bounded preparatory research request saved. Correlated model-origin preparation and native launch are still required." };
    });
    if (intent.kind === "launch")
      return this.serialize(async () => {
        const view = await this.state();
        const task = view.tasks.find((t) => t.id === intent.task.id);
        if (view.mode !== "active") return reject("inactive", "Activate or explicitly resume Legion before launching work.");
        if (!view.snapshot) return reject("unavailable", "Intake records unavailable.");
        try {
          const scope = this.approval(view.snapshot, intent.task);
          if (input.evidence.generation !== null && input.evidence.generation !== this.binding?.generation) return reject("provenance", "Host launch association generation is stale.");
          if (task?.claim.kind !== "owned")
            return reject("launch-claim", "A confirmed durable claim owned by this Legatus is required. No worker started.");
          if (task.claim.workspace.kind !== "ready")
            return reject("launch-workspace", "Confirmed ready workspace required. Preserve any unresolved Git operation. No worker started.");
          if (task.claim.reservation.approval.scope !== scope)
            return reject("launch-approval", "Claim approval differs from current scope. No worker started.");
          if (task.launch.kind === "unavailable") return reject("launch-history", task.launch.message);
          const reservation = task.claim.reservation;
          const prior = view.snapshot.launchRequests.find((r) => r.id === input.requestKey);
          if (prior && JSON.stringify(prior.task) !== JSON.stringify(intent.task))
            return reject("request-conflict", "Request key has a different launch payload.");
          if (prior) await this.authorized(prior, epoch);
          if (!prior) {
            const commonDir = view.snapshot.workspaceRequests.find((r) => r.repositoryId === reservation.repository)?.repository;
            if (!commonDir || !this.binding) return reject("launch-claim", "Claim repository witness unavailable.");
            const request = LaunchRequest.parse({ id: input.requestKey, task: intent.task, scope, evidence: input.evidence, epoch, generation: this.binding.generation, repository: commonDir, repositoryId: task.claim.reservation.repository });
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
        const launches = await this.launchViews(snapshot, claims.byTask);
        return {
          kind: "observed",
          view: {
            mode: snapshot?.researchHold || snapshot?.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind)) ? "stopping" : "inactive",
            snapshot,
            ownerObservations: claims.all,
            tasks:
              snapshot?.tasks.map((t) => ({
                ...t,
                eligibility: "inactive",
                claim: claims.byTask.get(t.id) ?? claims.fallback,
                launch: launches.get(t.id) ?? { kind: "not-launched" },
              })) ?? [],
            diagnostics: [],
            unavailable: snapshot ? null : "Legatus records were not found.",
          },
        };
      }
      if (intent.kind === "doctor")
        return {
          kind: "observed",
          view: {
            ...(await this.state()),
            diagnostics: await this.options.preflight(),
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
      const diagnostics = await this.options.preflight();
      if (epoch !== this.epoch)
        return reject("revoked", "Activation was revoked.");
      const resume = intent.kind === "resume" ? intent.id : null;
      const isActivation = intent.kind === "on" || intent.kind === "resume";
      const taskText = intent.kind === "task" ? intent.text : "";
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
                session: this.options.session,
                resume,
              }),
            };
      } catch (error) {
        return reject(
          "ownership",
          `Exclusive association ownership is unavailable. ${String(error)}`,
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
              await new AssignmentLedger(
                commonDir,
                this.options.assignments?.fault,
                state.workspaceRequests.find(
                  (r) => r.repository === commonDir && r.repositoryId,
                )?.repositoryId ?? null,
              ).recoverExisting(() => epoch === this.epoch);
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
        if (!isActivation)
          snapshot.submissions.push({
            id: SubmissionId.parse(randomUUID()),
            revision: 1,
            text: taskText,
            sequence: snapshot.submissions.length + 1,
            timestamp: new Date().toISOString(),
            evidence: input.evidence,
            originIntent: { kind: "new-task" },
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
        else this.stopRequested = false;
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
          if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
            return reject("centurio-pin", "The child task, scope, assignment, or principal incarnation changed.");
        } catch (error) { return reject("centurio-pin", String(error)); }
        return { kind: "centurio-owner-current", id: message.id, child: message.child };
      }
      if (message.kind === "effect-observation") {
        const record = state.effects.find(effect => effect.intent.id === message.id && effect.digest === message.digest);
        if (!record) return reject("effect-identity", "No matching retained admission for this observation.");
        if (record.state.kind === "completed" || record.state.kind === "refused")
          return isDeepStrictEqual(record.state, message.state) ? { kind: "effect", effect: record } : reject("effect-conflict", "Terminal observation conflicts with retained evidence.");
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
      if (view.mode !== "active" || epoch !== this.epoch || this.stopping) return reject("effect-revoked", "No new effect admission after controller revocation.");
      if (state.effects.some(effect => effect.intent.pin.workerSession === pin.workerSession && effect.intent.pin.workerGeneration === pin.workerGeneration && effect.state.kind === "unknown"))
        return reject("effect-unresolved", "A prior native effect outcome is unknown. Reconcile the same identity before new work.");
      const decision = state.engineering.find(record => record.id === intent.decision.id && record.digest === intent.decision.digest);
      if (!decision || currentEngineering(state.engineering, pin)?.id !== decision.id || !isDeepStrictEqual(decision.pin, pin) || decision.state.kind !== "decided" || decision.state.decision.kind !== "approve" || decision.state.delivery.kind !== "applied" || decision.state.delivery.command !== intent.decision.command)
        return reject("effect-decision", "Exact same-assignment applied seam approval is required.");
      const seam = approvedSeam(state.engineering, decision);
      if (!seam || decision.proposal.kind === "exception" && !isDeepStrictEqual(intent.seam, { id: seam.id, digest: seam.digest }))
        return reject("effect-exception", "The exception must retain its exact current approved seam and behavior.");
      if (decision.proposal.kind === "exception" && intent.call.name === "bash" && isDeepStrictEqual(intent.call.input, decision.proposal.alternative.input) && state.effects.some(effect => isDeepStrictEqual(effect.intent.pin, pin) && effect.state.kind === "outstanding"))
        return reject("effect-verification-order", "Complete earlier admitted effects before running alternative verification.");
      const task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
      if (pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch || task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || launch?.kind !== "assigned")
        return reject("effect-authority", "Principal, task, reservation, or controller authority changed.");
      try {
        if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
          return reject("effect-pin", "Approval no longer addresses the exact current assignment.");
        let effectCwd = task.claim.reservation.plan.path;
        if (intent.origin?.kind === "centurio") {
          const origin = intent.origin;
          const child = readCenturio({ path: origin.intent, digest: origin.child.digest }).intent;
          const observed = launch.worker.resources.children?.find(value => value.id === origin.child.id);
          if (child.id !== origin.child.id || child.purpose !== "implementation" || !child.writable || !isDeepStrictEqual(child.owner, launch.worker.address) || child.assignment.command !== pin.assignment || child.assignment.value.scope !== pin.scope || child.writable.parentCwd !== effectCwd || child.cwd !== origin.cwd || child.writable.workspace.plan.branch !== origin.branch || child.writable.workspace.plan.commit !== origin.base || !observed?.evidence.includes(origin.intent) || ["unknown", "mismatch", "prepared", "process-terminal"].includes(observed.state.kind)) return reject("effect-child", "Child identity/workspace does not join this current owned assignment.");
          if (child.writable.seam.id !== seam.id || child.writable.seam.digest !== seam.digest || !isDeepStrictEqual(child.writable.seam.proposal, seam.proposal)) return reject("effect-child-seam", "Child context does not retain the exact current approved public seam.");
          verifyCenturioWorkspace(child.writable.workspace, child.writable.parentCwd);
          const header = z.object({ type: z.literal("session"), id: z.string(), cwd: z.string() }).parse(JSON.parse(readFileSync(origin.journal, "utf8").split("\n")[0] ?? "null"));
          if (header.id !== origin.session || realpathSync(header.cwd) !== origin.cwd || !intent.call.journal.startsWith(`${origin.journal}#`)) return reject("effect-child-journal", "Actual child session journal does not join its effect.");
          effectCwd = child.cwd;
        }
        if (intent.contract.verification.kind !== "verified" || intent.contract.cwd !== effectCwd)
          return reject("effect-contract", "Current selected resources and complete native loading are required.");
        for (const resource of intent.contract.resources) {
          let reason: "content-changed" | "canonical-target-changed" | "unavailable" | null = null;
          try {
            if (realpathSync(resource.path) !== resource.canonicalPath) reason = "canonical-target-changed";
            else if (createHash("sha256").update(readFileSync(resource.path)).digest("hex") !== resource.digest) reason = "content-changed";
          } catch { reason = "unavailable"; }
          if (reason) return {
            kind: "resource-invalidated", intent: { id: intent.id, digest: createHash("sha256").update(JSON.stringify(intent)).digest("hex") },
            resource: { path: resource.path, reason }, message: "The controller observed invalid selected resource proof. Retire it and load the current contract again.",
          };
        }
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
  private observeEngineering(observation: z.infer<typeof EngineeringObservation>): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const view = await this.state(), binding = this.binding;
      const state = view.snapshot, evidence = observation.evidence;
      const record = state?.engineering.find(record => record.id === observation.request.id && record.digest === observation.request.digest);
      if (!state || !binding || view.mode !== "active" || epoch !== this.epoch) return reject("inactive", "Engineering observation retained at the worker. Resume the controller to reconcile it.");
      if (!record || record.state.kind !== "decided" || record.state.delivery.command !== observation.delivery.command) return reject("engineering-request", "Observation does not address a committed decision.");
      const pin = record.pin;
      if (evidence.owner !== pin.owner || evidence.session !== pin.session || evidence.generation !== pin.generation || evidence.epoch !== pin.epoch || evidence.assignment !== pin.assignment || evidence.reservation !== pin.reservation || evidence.scope !== pin.scope || JSON.stringify(evidence.task) !== JSON.stringify(pin.task) || createHash("sha256").update(JSON.stringify(evidence.address)).digest("hex") !== pin.addressDigest)
        return reject("engineering-pin", "Observation does not address the pinned worker proposal.");
      const result: CommittedResult = { kind: "applied", receipt: { legatus: state.id, requestKey: observation.delivery.command, sequence: state.receipts.length, message: "Retained worker delivery and continuation evidence. No effect admitted." } };
      const rank = { pending: 0, dispatched: 1, applied: 2 };
      if (record.state.delivery.kind === "applied") {
        const prior = record.state.delivery;
        if (rank[observation.delivery.continuation.kind] < rank[prior.continuation.kind]) return result;
        if (rank[observation.delivery.continuation.kind] === rank[prior.continuation.kind])
          return JSON.stringify(prior) === JSON.stringify(observation.delivery) ? result : reject("engineering-delivery", "Conflicting worker delivery evidence. Preserve both records.");
      }
      record.state.delivery = observation.delivery;
      const expected = state.revision++;
      try {
        await this.store.save(state, expected, () => epoch === this.epoch && binding === this.binding && !this.stopping);
        return result;
      } catch (error) { return reject("engineering-observation-unknown", `Worker evidence publication is unresolved. Preserve it for reconciliation. ${String(error)}`); }
    });
  }
  private deliverEngineering(id: string): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const view = await this.state();
      const state = view.snapshot, binding = this.binding;
      const record = state?.engineering.find(record => record.id === id);
      const host = this.options.tribuni?.host();
      if (!state || !binding || view.mode !== "active" || epoch !== this.epoch)
        return reject("inactive", "Engineering delivery requires current controller authority.");
      if (!record || record.state.kind !== "decided" || currentEngineering(state.engineering, record.pin)?.id !== record.id) return reject("engineering-request", "No current decided engineering request.");
      const pin = record.pin, task = view.tasks.find(task => task.id === pin.task.id), launch = task?.launch;
      if (pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch || task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || (launch?.kind !== "assigned" && launch?.kind !== "reported"))
        return reject("engineering-pin", "The decision no longer addresses the current owned assignment and controller.");
      try {
        if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
          return reject("engineering-pin", "The task, scope, or worker changed before delivery.");
        if (!host?.deliverEngineering) return reject("engineering-transport", "The addressed engineering transport is unavailable. Decision retained.");
        const receipt = EngineeringDeliveryReceipt.parse(await host.deliverEngineering({ worker: launch.worker, record }));
        if (receipt.command !== record.state.delivery.command) return reject("engineering-delivery", "Delivery receipt does not match the retained decision command.");
        if (epoch !== this.epoch || binding !== this.binding || this.stopping) return reject("revoked", "Delivery authority changed. Preserve the worker receipt for reconciliation.");
        record.state.delivery = receipt;
        const expected = state.revision++;
        await this.store.save(state, expected, () => epoch === this.epoch && binding === this.binding && !this.stopping);
        return { kind: "applied", receipt: { legatus: state.id, requestKey: receipt.command, sequence: state.receipts.length,
          message: "Worker retained the engineering decision. Continuation is separately observed. No effect admitted." } };
      } catch (error) {
        return reject("engineering-delivery-unknown", `Engineering delivery is unresolved. Preserve the same command and decision. ${String(error)}`);
      }
    });
  }
  private submitEngineering(message: z.infer<typeof EngineeringInput>): Promise<OperationResult> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      const view = await this.state();
      const state = view.snapshot;
      if (!state || view.unavailable) return reject("unavailable", "Engineering authority records are unavailable.");
      const fingerprint = createHash("sha256").update(JSON.stringify(message)).digest("hex");
      const retained = state.receipts.find(r => r.result.receipt.requestKey === message.requestKey);
      if (retained) return retained.fingerprint === fingerprint ? retained.result : reject("request-conflict", "Request key has a different payload.");
      if (this.uncertain) return reject("reconcile", `Reconcile request ${this.uncertain.requestKey} before engineering work.`);
      const binding = this.binding;
      const evidence = message.evidence;
      if (!binding || view.mode !== "active" || epoch !== this.epoch) return reject("inactive", "Legion is inactive. No engineering authority granted.");
      if (message.kind === "engineering-decision" && state.engineering.some(r => r.id === message.request.id && r.digest === message.request.digest && r.pin.workerSession === evidence.session))
        return reject("engineering-self-approval", "A worker cannot approve its own engineering proposal.");
      if (evidence.owner !== state.id || evidence.session !== this.options.session || evidence.generation !== binding.generation || evidence.epoch !== epoch)
        return reject("engineering-owner", "Engineering request does not address the current Legatus generation and epoch.");
      const request = message.kind === "engineering-decision" ? state.engineering.find(r => r.id === message.request.id && r.digest === message.request.digest) : null;
      if (message.kind === "engineering-decision" && (!request || request.state.kind !== "open" || !message.evidence.requests.some(r => r.id === request.id && r.digest === request.digest)))
        return reject("engineering-request", "The exact open engineering proposal is required in this Legatus decision turn.");
      const pin = message.kind === "engineering-request" ? {
        owner: state.id, session: message.evidence.session, generation: message.evidence.generation, epoch: message.evidence.epoch,
        task: message.evidence.task, scope: message.evidence.scope, reservation: message.evidence.reservation, assignment: message.evidence.assignment,
        launch: message.evidence.address.launch, workerSession: message.evidence.address.session, workerGeneration: message.evidence.address.generation,
        addressDigest: createHash("sha256").update(JSON.stringify(message.evidence.address)).digest("hex"),
      } : request?.pin;
      if (!pin || pin.owner !== state.id || pin.session !== this.options.session || pin.generation !== binding.generation || pin.epoch !== epoch)
        return reject("engineering-pin", "The engineering proposal belongs to a prior controller authority.");
      const task = view.tasks.find(t => t.id === pin.task.id);
      const launch = task?.launch;
      if (task?.eligibility !== "admitted" || task.claim.kind !== "owned" || task.claim.reservation.id !== pin.reservation || task.claim.workspace.kind !== "ready" || launch?.kind !== "assigned")
        return reject("engineering-assignment", "Engineering requires the current owned ready assignment.");
      try {
        if (this.approval(state, pin.task) !== pin.scope || launch.assignment.scope !== pin.scope || launch.command !== pin.assignment || createHash("sha256").update(JSON.stringify(launch.worker.address)).digest("hex") !== pin.addressDigest)
          return reject("engineering-pin", "Task scope, assignment, or worker incarnation changed. No engineering authority granted.");
      } catch (error) { return reject("engineering-pin", String(error)); }
      const latest = currentEngineering(state.engineering, pin);
      if (message.kind === "engineering-decision" && latest?.id !== request?.id)
        return reject("engineering-superseded", "A newer proposal retired this decision authority.");
      if (message.kind === "engineering-request") {
        if (latest ? latest.state.kind !== "decided" || latest.state.delivery.kind !== "applied" || !isDeepStrictEqual(message.previous, { id: latest.id, digest: latest.digest }) : message.previous !== undefined)
          return reject("engineering-predecessor", "A successive request must name the exact latest delivered proposal. Preserve pending work.");
        if (state.effects.some(effect => isDeepStrictEqual(effect.intent.pin, pin) && (effect.state.kind === "outstanding" || effect.state.kind === "unknown")))
          return reject("engineering-effects", "Resolve admitted effects before proposing another engineering contract.");
        if (message.proposal.kind === "exception") {
          const proposal = message.proposal;
          const seam = state.engineering.find(record => record.id === proposal.seam.id && record.digest === proposal.seam.digest && isDeepStrictEqual(record.pin, pin));
          if (!seam || !approvedSeam(state.engineering, { ...seam, proposal }))
            return reject("engineering-exception", "An exception requires one behavior of the exact current approved and delivered seam in this assignment.");
        }
        state.engineering.push(EngineeringRecord.parse({
          id: message.requestKey, pin, proposal: message.proposal, ...(message.previous ? { previous: message.previous } : {}),
          digest: createHash("sha256").update(JSON.stringify({ pin, proposal: message.proposal, ...(message.previous ? { previous: message.previous } : {}) })).digest("hex"),
          requestEvidence: message.evidence.journal, state: { kind: "open" },
        }));
      } else {
        if (!request || message.evidence.session === pin.workerSession) return reject("engineering-self-approval", "A worker cannot approve its own engineering proposal.");
        request.state = {
          kind: "decided", decision: message.decision,
          by: { session: message.evidence.session, generation: message.evidence.generation, run: message.evidence.run },
          delivery: { kind: "pending", command: message.requestKey },
        };
      }
      const result: CommittedResult = { kind: "applied", receipt: {
        legatus: state.id, requestKey: message.requestKey, sequence: state.receipts.length + 1,
        message: message.kind === "engineering-request" ? "Saved engineering proposal. Tests and implementation remain unauthorized." : "Saved Legatus engineering decision and pending worker delivery. No new effect admitted.",
      } };
      state.receipts.push({ fingerprint, result });
      const expected = state.revision++;
      try {
        await this.store.save(state, expected, () => this.epoch === epoch && this.binding === binding && !this.stopping);
        return result;
      } catch (error) {
        this.uncertain = { id: state.id, requestKey: message.requestKey };
        this.revoke();
        return { kind: "uncertain", requestKey: message.requestKey, message: `Engineering publication is uncertain. Reconcile the same request before another effect. ${String(error)}` };
      }
    });
  }
  private submitResearch(message: z.infer<typeof ResearchRequest> | z.infer<typeof ResearchObservation> | z.infer<typeof ResearchCheck> | z.infer<typeof ResearchStageEvent> | { kind: "research-hold"; owner: z.infer<typeof ResearchOwner>; reason: string }): Promise<OperationResult> {
    return this.serialize(async () => {
      const state = this.selected ? await this.store.read(this.selected) : null;
      const binding = this.binding;
      const owner = message.owner;
      if (!state || !binding || owner.owner !== state.id || owner.session !== this.options.session || owner.generation !== binding.generation || owner.epoch !== this.epoch)
        return reject("research-owner", "Research requires the exact current Legatus session, generation and authority epoch. Retained children cannot be adopted.");
      const expected = state.revision++;
      const current = () => this.binding === binding && this.epoch === owner.epoch;
      try {
        if (message.kind === "research-dispatch" || message.kind === "research-settled") {
          const stage = state.researchRequests.find(stage => stage.id === message.id && isDeepStrictEqual(stage.owner, owner));
          if (!stage || message.kind === "research-dispatch" && (stage.state.kind !== "requested" || this.stopping || this.stopRequested) || message.kind === "research-settled" && (stage.state.kind === "requested" || stage.state.marker !== message.marker)) return reject("research-stage", "Research stage marker is absent, stale or already dispatched.");
          stage.state = message.kind === "research-dispatch" ? { kind: "dispatched", marker: message.marker } : { kind: "settled", marker: message.marker };
          await this.store.save(state, expected, current);
          return { kind: "research-observed" };
        }
        if (message.kind === "research") {
          const stage = state.researchRequests.find(stage => stage.id === message.requestKey && isDeepStrictEqual(stage.owner, owner) && stage.task === message.task && stage.state.kind === "dispatched");
          if (!stage || stage.state.kind !== "dispatched") return reject("research-stage", "Model preparation must match the exact saved dispatched research task and owner.");
          if (this.stopping || this.stopRequested || state.researchHold || state.research.some(record => !isDeepStrictEqual(record.owner, owner) && !["prepared", "process-terminal"].includes(record.child.state.kind) || ["unknown", "mismatch", "launch-unresolved", "corroboration-pending"].includes(record.child.state.kind)))
            return reject("research-held", "Research is stopping or retained child ownership/lifecycle is unresolved. No new preparation.");
          if (!this.options.research) return reject("research-runtime", "Owned native research runtime is unavailable.");
          if (state.research.some(record => record.id === message.requestKey)) return reject("research-duplicate", "This research request already exists. Inspect its retained intent; do not relaunch.");
          const record = ResearchRecord.parse(await this.options.research.prepare(message, owner));
          if (!current() || this.stopping || record.id !== message.requestKey || !isDeepStrictEqual(record.owner, owner) || record.task !== message.task || record.child.id !== record.id || record.child.purpose !== "exploration" || record.child.state.kind !== "prepared")
            return reject("research-preparation", "Research preparation changed authority or returned a contradictory intent. Preserve its evidence.");
          state.research.push(record);
          stage.state = { kind: "prepared", marker: stage.state.marker };
          await this.store.save(state, expected, current);
          return { kind: "research-prepared", research: record };
        }
        if (message.kind === "research-hold") {
          state.researchHold ??= message.reason;
        } else if (message.kind === "research-owner-check") {
          const record = state.research.find(record => record.id === message.id);
          if (!record || record.intent.digest !== message.digest || !isDeepStrictEqual(record.owner, owner) || state.researchHold)
            return reject("research-intent", "No exact unheld durable owned research intent.");
          if (message.stage === "read") {
            if (["prepared", "process-terminal", "unknown", "mismatch"].includes(record.child.state.kind)) return reject("research-state", "This research child is not authorized for further work.");
            return { kind: "research-current", owner };
          }
          if (this.stopping || this.stopRequested || record.child.state.kind !== "prepared" || !state.researchRequests.some(stage => stage.id === record.id && stage.state.kind === "prepared")) return reject("research-launch", "No fresh research launch after stopping or admission.");
          record.child.state = { kind: "launch-unresolved" };
        } else {
          if (!state.research.some(record => record.id === message.command)) return reject("research-command", "Observation does not address an owned research command.");
          for (const child of message.children) {
            const record = state.research.find(record => record.id === child.id);
            if (!record || !isDeepStrictEqual(record.owner, owner) || record.child.model !== child.model || child.purpose !== "exploration") return reject("research-observation", "Observation contains an unowned or contradictory child.");
            if (message.sequence <= record.sequence) continue;
            // An earlier prepared projection must never reopen a launched intent.
            if (child.state.kind !== "prepared" || record.child.state.kind === "prepared") {
              if (!["unknown", "mismatch", "process-terminal"].includes(record.child.state.kind)) record.child = child;
            }
            record.sequence = message.sequence;
          }
        }
        this.researchPending = !!state.researchHold || state.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind));
        await this.store.save(state, expected, current);
        if (this.stopping && !this.researchPending && !this.invocations) this.revoke();
        return message.kind === "research-owner-check" ? { kind: "research-current", owner } : { kind: "research-observed" };
      } catch (error) {
        this.researchPending = true;
        this.stopping = true;
        return { kind: "uncertain", requestKey: "requestKey" in message ? message.requestKey : "research", message: `Research persistence/effect outcome is unresolved. Preserve owned evidence; no replacement. ${String(error)}` };
      }
    });
  }
  submit(raw: unknown): Promise<OperationResult> {
    const research = z.union([ResearchRequest, ResearchObservation, ResearchCheck, ResearchStageEvent, z.strictObject({ kind: z.literal("research-hold"), owner: ResearchOwner, reason: z.string().min(1) })]).safeParse(raw);
    if (research.success) return this.submitResearch(research.data);
    const effect = EffectMessage.safeParse(raw);
    if (effect.success) return this.submitEffect(effect.data);
    const observation = EngineeringObservation.safeParse(raw);
    if (observation.success) return this.observeEngineering(observation.data);
    const engineering = EngineeringInput.safeParse(raw);
    if (engineering.success) return this.submitEngineering(engineering.data);
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
          state: { kind: "pending", routing: { kind: "unclassified" } },
        });
      } else {
        const proposal = message.proposal;
        const source = state.submissions.find(
          (s) =>
            s.id === proposal.source.id &&
            s.revision === proposal.source.revision &&
            s.state.kind === "pending",
        );
        if (
          !source ||
          !message.evidence.sources.some(
            (s) => s.id === source.id && s.revision === source.revision,
          ) ||
          source.state.kind !== "pending"
        )
          return reject(
            "stale-source",
            "Source is not pending in this interpretation run.",
          );
        const routing = source.state.routing;
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
              source.state.kind !== "pending" ||
              source.state.routing.kind === "correction"
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
          message: "Saved for interpretation. Intake only.",
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
