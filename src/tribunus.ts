import { ContextSample } from "./context-alerts.js";
import { z } from "zod";
import { AssignmentModelPinSchema, ThinkingSchema, WorkflowChoiceSchema, type StartupSelection, type WorkflowChoice } from "./legion-settings.js";
import { ContractEvidence } from "./engineering-contract.js";
import { createHash } from "node:crypto";
import { TaskRef, EngineeringResult, EffectMessage, EffectReply, ParkState, HandoffRequest, HandoffStageReceipt, SuccessorLaunch, LaunchId, WindowIdentity, WorkerAddress, CorrectionRequest, CorrectionBinding, CorrectionReceipt, CorrectionTurn } from "./snapshot.js";
export { LaunchId, WindowIdentity, WorkerAddress } from "./snapshot.js";
import { CenturioView } from "./owned-children.js";
export { CenturioView } from "./owned-children.js";
export const ContextAuthority = z.strictObject({ owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() });
export const TribunusContextObservation = z.strictObject({
  authority: ContextAuthority, address: WorkerAddress, command: z.uuid(), sequence: z.int().positive(), model: z.string().nullable(), sample: ContextSample,
});
export const TribunusContextEnvelope = z.strictObject({ capability: z.string(), observation: TribunusContextObservation });
export const CenturioObservation = z.strictObject({ address: WorkerAddress, command: z.uuid(), sequence: z.int().positive(), children: z.array(CenturioView) });
export const PrincipalObservation = z.object({
  model: z.string().nullable(), thinking: ThinkingSchema.nullable(), contextWindow: z.number().nullable(),
});
export const ResourceEvidence = z.object({
  principal: PrincipalObservation.optional(),
  contract: ContractEvidence.optional(), children: z.array(CenturioView).optional(),
  cwd: z.string(), skills: z.array(z.object({
    name: z.string(), path: z.string()
  })),
  diagnostics: z.array(z.object({
    name: z.string(), status: z.enum(["ready", "missing", "incompatible", "unverified"]), message: z.string()
  })),
});
export const VerifiedWorker = z.object({
  address: WorkerAddress, resources: ResourceEvidence, identityEvidence: z.string()
});
export function requiredWorkflowSkills(choice?: WorkflowChoice): string[] {
  const common = ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review"];
  if (!choice) return [...common, "poteto-mode", "implement", "implement-spec"];
  return [...common, choice.profile === "poteto-mode" ? "poteto-mode" : choice.requestedWorkflow];
}
export function mattInitializationPrompt(command: string): string {
  return `Legion native initialization ${command}. No implementation assignment is authorized yet. Do not use tools, delegate, edit files, or run commands. Keep poteto off; do not change workflow controllers. Reply in one sentence that you are waiting for the bounded assignment.`;
}
export const Initialization = z.object({
  profile: z.enum(["matt", "poteto-mode"]).optional(),
  command: z.uuid(), address: WorkerAddress, nativePrompt: z.string(), skillPath: z.string(),
  modeEntry: z.string(), settledEntry: z.string(),
});
export const BoundedAssignment = z.object({
  workflowChoice: WorkflowChoiceSchema.optional(),
  modelPin: AssignmentModelPinSchema.optional(),
  task: TaskRef, scope: z.string(), goal: z.string(), acceptance: z.array(z.string()),
  workflow: z.enum(["implement", "implement-spec", "poteto-mode"]),
  authority: z.literal("bounded-implementation-only"),
  handoff: SuccessorLaunch.optional(),
});
// Retain historical assignment bytes without making methodology effect authority.
export const LegacyBoundedAssignment = z.object({
  workflowChoice: WorkflowChoiceSchema.optional(),
  modelPin: AssignmentModelPinSchema.optional(),
  task: TaskRef, scope: z.string(), goal: z.string(), acceptance: z.array(z.string()), workflow: z.literal("implement"),
  testContract: z.literal("Matt TDD at Legatus-approved public seams; request an explicit exception if impractical"),
  authority: z.literal("bounded-implementation-only"),
});
const PersistedAssignment = z.union([LegacyBoundedAssignment, BoundedAssignment]);
const Progress = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prepared")
  }),
  z.object({
    kind: z.literal("window-dispatched"), operation: z.uuid()
  }),
  z.object({
    kind: z.literal("window-owned"), window: WindowIdentity
  }),
  z.object({
    kind: z.literal("pi-dispatched"), operation: z.uuid(), window: WindowIdentity
  }),
  z.object({
    kind: z.literal("verified"), worker: VerifiedWorker
  }),
  z.object({
    kind: z.literal("initializing"), worker: VerifiedWorker, command: z.uuid()
  }),
  z.object({
    kind: z.literal("initialized"), worker: VerifiedWorker, initialization: Initialization
  }),
  z.object({
    kind: z.literal("assigning"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: PersistedAssignment
  }),
  z.object({
    kind: z.literal("assigned"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: PersistedAssignment, application: z.string()
  }),
  z.object({
    kind: z.literal("reported"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: PersistedAssignment, application: z.string(), report: z.object({
      engineering: EngineeringResult.optional(), contract: ContractEvidence.optional(), outcome: z.enum(["reported-result", "blocked", "failed"]), assistantText: z.string(), evidence: z.array(z.string())
    })
  }),
]);
export const LaunchRecord = z.object({
  id: LaunchId, reservation: z.uuid(), revision: z.int().nonnegative(), scope: z.string(),
  successor: SuccessorLaunch.optional(),
  startEvidence: z.discriminatedUnion("kind", [z.object({
      kind: z.literal("unobserved")
    }), z.object({
      kind: z.literal("completed")
    }), z.object({
      kind: z.literal("uncertain"), message: z.string()
    })]).default({
    kind: "unobserved"
  }),
  state: z.union([Progress, z.object({
      kind: z.literal("held"), last: Progress, code: z.string(), message: z.string()
    })]),
});
export type LaunchRecord = z.infer<typeof LaunchRecord>;
type ProgressState = z.infer<typeof Progress>;
type InitializationView = Omit<z.infer<typeof Initialization>, "nativePrompt"> & {
  nativeExpansionDigest: string;
};
type Projected<T> = T extends {
  initialization: z.infer<typeof Initialization>;
} ? Omit<T, "initialization"> & {
  initialization: InitializationView;
} : T;
function projectProgress(state: ProgressState): Projected<ProgressState> {
  const worker = "worker" in state ? {
    ...state.worker, resources: {
      ...state.worker.resources, skills: state.worker.resources.skills.filter((s) => ["herdr", "poteto-mode", "matt-tdd", "matt-teach", "tdd", "teach", "implement", "implement-spec", "handoff", "code-review"].includes(s.name))
    }
  } : null;
  if ("initialization" in state) {
    const { nativePrompt, ...receipt } = state.initialization;
    return {
      ...state, worker: worker ?? state.worker, initialization: {
        ...receipt, nativeExpansionDigest: createHash("sha256").update(nativePrompt).digest("hex")
      }
    };
  }
  return worker && "worker" in state ? {
    ...state, worker
  } : state;
}
export function projectLaunch(state: LaunchRecord["state"]) {
  return state.kind === "held" ? {
    ...state, last: projectProgress(state.last)
  } : projectProgress(state);
}
export type LaunchView = (ReturnType<typeof projectLaunch> & {
  startEvidence: LaunchRecord["startEvidence"];
}) | {
  kind: "not-launched";
} | {
  kind: "unavailable";
  message: string;
};
export type LaunchResult = Omit<LaunchRecord, "state"> & {
  state: ReturnType<typeof projectLaunch>;
};
export const ContractObservation = z.object({
  address: WorkerAddress, command: z.uuid(), sequence: z.int().positive(), contract: ContractEvidence,
});
export const WorkerReport = z.object({
  address: WorkerAddress, command: z.uuid(), engineering: EngineeringResult.optional(), contract: ContractEvidence.optional(), outcome: z.enum(["reported-result", "blocked", "failed"]), assistantText: z.string().max(4000), evidence: z.array(z.string())
});
export const WorkerStop = z.strictObject({ shutdown: z.uuid(), authority: ContextAuthority, address: WorkerAddress, command: z.uuid().nullable(), state: ParkState });
const HandoffAddress = WorkerAddress.strict().extend({ window: WindowIdentity.strict() });
/** Separate from ordinary assign/initialize controls: retirement remains irreversible. */
export const RetiredHandoffControl = z.strictObject({
  kind: z.enum(["handoff", "observe-handoff"]), capability: z.string().min(1), authority: ContextAuthority,
  reservation: z.uuid(), scope: z.string(), address: HandoffAddress, command: z.uuid(), request: HandoffRequest,
}).refine(frame => {
  const pin = frame.request.pin;
  return frame.command === frame.request.command && frame.reservation === pin.reservation && frame.scope === pin.scope &&
    frame.authority.owner === pin.owner && frame.authority.session === pin.session && frame.authority.generation === pin.generation && frame.authority.epoch === pin.epoch &&
    frame.address.launch === pin.launch && frame.address.session === pin.workerSession && frame.address.generation === pin.workerGeneration &&
    createHash("sha256").update(JSON.stringify(frame.address)).digest("hex") === pin.addressDigest;
}, "Handoff must address the exact original authority, assignment and retired incarnation.");
export const HandoffStageObservation = z.strictObject({
  authority: ContextAuthority, address: HandoffAddress, handoff: z.uuid(), command: z.uuid(),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({ kind: z.literal("settled"), receipt: HandoffStageReceipt }),
    z.strictObject({ kind: z.literal("held"), message: z.string().min(1) }),
    z.strictObject({ kind: z.literal("unknown"), message: z.string().min(1) }),
  ]),
}).refine(observation => observation.state.kind !== "settled" ||
  observation.state.receipt.handoff === observation.handoff && observation.state.receipt.command === observation.command,
"Handoff receipt must address the observed request and stage command.");
export function handoffSkillPrompt(request: z.infer<typeof HandoffRequest>): string {
  return `/skill:handoff ${request.purpose}\nThe successor will continue: ${request.continuation}\nYou are retired from ordinary work. Only create the temporary handoff artifact using the unchanged skill; report its exact absolute path. Do not resume implementation or delegate.`;
}
export function successorStartupSelection(successor: z.infer<typeof SuccessorLaunch>): Extract<StartupSelection, { kind: "exact" }> {
  return { kind: "exact", selection: { model: successor.modelPin.model, thinking: successor.modelPin.thinking } };
}
export function successorReadFirstInstruction(successor: z.infer<typeof SuccessorLaunch>): string {
  return `Read the handoff file at exactly ${JSON.stringify(successor.artifact.path)} before continuing any work. If it is unavailable, stop and report the blocker; do not reconstruct it. Then continue: ${successor.continuation}`;
}
/** Receipt is persisted native user input, never performed correction or result acceptance. */
export const CorrectionDelivery = CorrectionRequest.safeExtend({ binding: CorrectionBinding });
export const CorrectionControl = z.strictObject({
  kind: z.enum(["correct", "observe-correction"]), capability: z.string().min(1), request: CorrectionDelivery,
  continuation: CorrectionTurn.optional(),
});
export const CorrectionObservation = z.strictObject({
  request: CorrectionDelivery,
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("queued") }),
    z.strictObject({ kind: z.literal("delivered"), receipt: CorrectionReceipt }),
    z.strictObject({ kind: z.literal("not-delivered"), evidence: z.array(z.string().min(1)).min(1) }),
    z.strictObject({ kind: z.literal("unknown"), message: z.string().min(1) }),
  ]),
});
export type TribunusHost = {
  correct?(input: { request: z.infer<typeof CorrectionDelivery> }): Promise<z.infer<typeof CorrectionObservation>>;
  observeCorrection?(input: { request: z.infer<typeof CorrectionDelivery>; continuation?: z.infer<typeof CorrectionTurn> }): Promise<z.infer<typeof CorrectionObservation>>;
  stop?(input: { worker: z.infer<typeof VerifiedWorker>; shutdown: string; command: string | null; instruction?: string }, onObservation: (observation: z.infer<typeof WorkerStop>) => Promise<void>): Promise<void>;
  handoff?(input: { worker: z.infer<typeof VerifiedWorker>; request: z.infer<typeof HandoffRequest> }): Promise<z.infer<typeof HandoffStageObservation>>;
  observeHandoff?(input: { worker: z.infer<typeof VerifiedWorker>; request: z.infer<typeof HandoffRequest> }): Promise<z.infer<typeof HandoffStageObservation>>;
  watchContext?(input: { worker: z.infer<typeof VerifiedWorker>; command: string }, onObservation: (observation: z.infer<typeof TribunusContextObservation>) => Promise<void>, onUnavailable: (message: string, observation?: z.infer<typeof TribunusContextObservation>) => void): () => void;
  watchEffects?(input: { worker: z.infer<typeof VerifiedWorker>; command: string }, onMessage: (message: z.infer<typeof EffectMessage>) => Promise<z.infer<typeof EffectReply>>, onUnavailable: (message: string) => void): void;
  watchReports?(input: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
  }, onReport: (report: z.infer<typeof WorkerReport>) => Promise<void>, onUnavailable: (message: string) => Promise<void>, onChildren?: (observation: z.infer<typeof CenturioObservation>) => Promise<void>): void;
  createWindow(input: {
    launch: LaunchRecord;
    cwd: string;
    workflowChoice: WorkflowChoice;
    startupSelection: StartupSelection;
  }): Promise<z.infer<typeof WindowIdentity>>;
  startPi(input: {
    launch: LaunchRecord;
    window: z.infer<typeof WindowIdentity>;
    startupSelection: StartupSelection;
  }): Promise<void>;
  inspectWorker(input: {
    launch: LaunchRecord;
    window: z.infer<typeof WindowIdentity>;
    cwd: string;
  }): Promise<z.infer<typeof VerifiedWorker> | null>;
  initialize(input: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
    workflowChoice: WorkflowChoice;
  }): Promise<z.infer<typeof Initialization> | null>;
  assign(input: {
    worker: z.infer<typeof VerifiedWorker>;
    initialization: z.infer<typeof Initialization>;
    command: string;
    assignment: z.infer<typeof BoundedAssignment>;
  }): Promise<{
    application: string;
  } | null>;
};
