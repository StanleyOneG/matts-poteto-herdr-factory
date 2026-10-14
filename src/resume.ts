import { z } from "zod";
import { ContextAuthority, Initialization, LaunchRecord, WorkerAddress, WorkerReport, WorkerStop } from "./tribunus.js";
import { EffectMessage } from "./snapshot.js";
import type { NativeChildResourceObservation } from "./centuriones.js";

export const LocalProcessIdentity = z.strictObject({ pid: z.int().positive(), boot: z.string().min(1), start: z.string().regex(/^\d+$/) });
export const WorkerActivity = z.strictObject({
  nonce: z.uuid(), address: WorkerAddress, controller: ContextAuthority, command: z.uuid().nullable(),
  principal: z.enum(["not-started", "active", "settled"]), busy: z.boolean(), pendingMessages: z.boolean(),
  admissionHold: z.string().nullable(), childrenOutstanding: z.boolean(), childrenHeld: z.boolean(),
  effectsOutstanding: z.boolean(), retirement: WorkerStop.nullable(),
});
export type WorkerResourceObservation = {
  launch: string; reservation: string; scope: string;
  disposition: "hold" | "settled";
  reasons: string[]; recommendation: string; evidence: string[];
  process: { kind: "alive" | "absent" | "mismatch"; identity: z.infer<typeof LocalProcessIdentity> } | { kind: "unknown"; reason: string };
  live: { kind: "observed"; value: z.infer<typeof WorkerActivity> } | { kind: "unknown"; reason: string };
  retirement: z.infer<typeof WorkerStop> | null;
  report: z.infer<typeof WorkerReport> | null;
  actions: Array<{ kind: "initialize"; command: string; receipt: z.infer<typeof Initialization> } | { kind: "assign"; command: string; receipt: { application: string } }>;
  effects: Array<Extract<z.infer<typeof EffectMessage>, { kind: "effect-observation" }>>;
  children: NativeChildResourceObservation[];
};
/** Point-in-time evidence only. Even settled resources confer no admission, adoption or reuse authority. */
export interface ResumeResourceReader {
  observeResources(input: { launch: LaunchRecord; cwd: string; signal: AbortSignal }): Promise<WorkerResourceObservation>;
}
