import { z } from "zod";
import { createHash } from "node:crypto";
import { TaskRef } from "./snapshot.js";
export const LaunchId = z.uuid().brand<"LaunchId">();
export const WindowIdentity = z.object({
  endpoint: z.string(), server: z.string(), workspace: z.string(), tab: z.string(), pane: z.string(), terminal: z.string(),
});
export const WorkerAddress = z.object({
  launch: LaunchId, window: WindowIdentity, session: z.string(), generation: z.uuid(),
});
export const ResourceEvidence = z.object({
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
export const Initialization = z.object({
  command: z.uuid(), address: WorkerAddress, nativePrompt: z.string(), skillPath: z.string(),
  modeEntry: z.string(), settledEntry: z.string(),
});
export const BoundedAssignment = z.object({
  task: TaskRef, scope: z.string(), goal: z.string(), acceptance: z.array(z.string()),
  workflow: z.literal("implement"), testContract: z.literal("Matt TDD at Legatus-approved public seams; request an explicit exception if impractical"),
  authority: z.literal("bounded-implementation-only"),
});
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
    kind: z.literal("assigning"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: BoundedAssignment
  }),
  z.object({
    kind: z.literal("assigned"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: BoundedAssignment, application: z.string()
  }),
  z.object({
    kind: z.literal("reported"), worker: VerifiedWorker, initialization: Initialization, command: z.uuid(), assignment: BoundedAssignment, application: z.string(), report: z.object({
      outcome: z.enum(["reported-result", "blocked", "failed"]), assistantText: z.string(), evidence: z.array(z.string())
    })
  }),
]);
export const LaunchRecord = z.object({
  id: LaunchId, reservation: z.uuid(), revision: z.int().nonnegative(), scope: z.string(),
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
      ...state.worker.resources, skills: state.worker.resources.skills.filter((s) => ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].includes(s.name))
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
export const WorkerReport = z.object({
  address: WorkerAddress, command: z.uuid(), outcome: z.enum(["reported-result", "blocked", "failed"]), assistantText: z.string().max(4000), evidence: z.array(z.string())
});
export type TribunusHost = {
  watchReports?(input: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
  }, onReport: (report: z.infer<typeof WorkerReport>) => Promise<void>, onUnavailable: (message: string) => Promise<void>): void;
  createWindow(input: {
    launch: LaunchRecord;
    cwd: string;
  }): Promise<z.infer<typeof WindowIdentity>>;
  startPi(input: {
    launch: LaunchRecord;
    window: z.infer<typeof WindowIdentity>;
  }): Promise<void>;
  inspectWorker(input: {
    launch: LaunchRecord;
    window: z.infer<typeof WindowIdentity>;
    cwd: string;
  }): Promise<z.infer<typeof VerifiedWorker> | null>;
  initialize(input: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
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
