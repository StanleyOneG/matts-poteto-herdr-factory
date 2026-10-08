import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { LaunchRecord, VerifiedWorker, Initialization, BoundedAssignment, projectLaunch, type LaunchResult, type LaunchView, type TribunusHost } from "./tribunus.js";
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
};
export type OperationResult =
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
  tribuni?: { host: () => TribunusHost | null };
  assignments?: {
    workspaceRoot: string;
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
  private invocations = 0;
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
        if (verified.resources.cwd !== reservation.plan.path || verified.resources.diagnostics.some((d) => d.status !== "ready") || ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].some((name) => !verified.resources.skills.some((s) => s.name === name)))
          return hold("worker-resources", "Actual target worktree resources are missing or incompatible. Make required native Herdr, poteto-mode, and Matt workflow skills discoverable. No substitution or assignment.");
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
        host.watchReports?.({ worker: assigned.worker, command: assigned.command }, async (report) => {
          if (report.command !== assigned.command || JSON.stringify(report.address) !== JSON.stringify(assigned.worker.address) || launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { ...assigned, kind: "reported", report: { outcome: report.outcome, assistantText: report.assistantText, evidence: report.evidence } }, () => true);
        }, async (message) => {
          if (launch.state.kind !== "assigned") return;
          launch = await ledger.updateLaunch(reservation, launch, { kind: "held", last: assigned, code: "report-evidence-unavailable", message: `Worker report evidence is unavailable. Preserve the applied assignment and receipt. ${message}` }, () => true);
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
      return {
        mode: this.stopping || (this.stopRequested && unresolvedLaunch) ? "stopping" : this.binding ? "active" : "inactive",
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
          "Use on, task <text>, status [id], doctor, off, resume <id>, reserve <task-id>@<revision> --parent <refs/heads/branch> [--source <GitHub issue URL>], reconcile <task-id>, workspace <request-id>, or launch <task-id>@<revision>. Use task to escape reserved arguments.",
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
            mode: "inactive",
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
  submit(raw: unknown): Promise<OperationResult> {
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
