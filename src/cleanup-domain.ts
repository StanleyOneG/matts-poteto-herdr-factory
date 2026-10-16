import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { WorkspacePlan } from "./git-workspace.js";
import { IntegrationRecord, ResultIdentity, ResultRef } from "./result-domain.js";

// Shared returned native identity; snapshot re-exports these for existing consumers.
export const LaunchId = z.uuid().brand<"LaunchId">();
export const WindowIdentity = z.object({
  endpoint: z.string(), server: z.string(), workspace: z.string(), tab: z.string(), pane: z.string(), terminal: z.string(),
});
export const WorkerAddress = z.object({ launch: LaunchId, window: WindowIdentity, session: z.string(), generation: z.uuid() });
const Text = z.string().trim().min(1);
const Evidence = z.array(Text).min(1);
const IntentBinding = {
  id: z.uuid(), result: ResultRef, identity: ResultIdentity,
  integration: IntegrationRecord.refine(record => record.state.kind === "confirmed", "Cleanup requires confirmed integration."),
};
export const TabCleanupIntent = z.strictObject({ ...IntentBinding,
  target: z.strictObject({ kind: z.literal("tab"), address: WorkerAddress.strict().extend({ window: WindowIdentity.strict() }) }),
}).refine(intent => cleanupAcceptanceMatches(intent) && intent.target.address.session === intent.identity.assignment.executor.session &&
  intent.target.address.generation === intent.identity.assignment.executor.generation, "Cleanup must bind the exact accepted executor.");
export type TabCleanupIntent = z.infer<typeof TabCleanupIntent>;
export const WorktreeCleanupIntent = z.strictObject({ ...IntentBinding,
  target: z.strictObject({ kind: z.literal("worktree"), plan: WorkspacePlan.strict() }),
}).refine(intent => cleanupAcceptanceMatches(intent) && intent.target.plan.path === intent.identity.workspace.path &&
  intent.target.plan.branch === intent.identity.workspace.branch && intent.target.plan.parent === intent.identity.parent.ref,
  "Cleanup must bind the exact owned workspace and intended parent.");
export type WorktreeCleanupIntent = z.infer<typeof WorktreeCleanupIntent>;
function cleanupAcceptanceMatches(intent: { result: ResultRef; identity: ResultIdentity; integration: IntegrationRecord }): boolean {
  return isDeepStrictEqual(intent.result, intent.integration.intent.result) && isDeepStrictEqual(intent.identity, intent.integration.intent.identity);
}
export const CleanupIntent = z.union([TabCleanupIntent, WorktreeCleanupIntent]);
export type CleanupIntent = z.infer<typeof CleanupIntent>;
export function cleanupTargetDigest({ intent }: { intent: CleanupIntent }): string {
  return createHash("sha256").update(JSON.stringify({ result: intent.result, identity: intent.identity, target: intent.target })).digest("hex");
}
const OutcomeBinding = { operation: z.uuid(), result: ResultRef, targetDigest: ResultRef.shape.digest, evidence: Evidence };
function outcomeSchema<T extends "tab" | "worktree">({ resource }: { resource: T }) {
  const binding = { ...OutcomeBinding, resource: z.literal(resource) };
  return z.discriminatedUnion("kind", [
    z.strictObject({ ...binding, kind: z.literal("confirmed") }),
    z.strictObject({ ...binding, kind: z.literal("retained"), noEffect: z.literal(true), reason: Text, message: Text }),
    z.strictObject({ ...binding, kind: z.literal("failed"), noEffect: z.literal(true), message: Text }),
    z.strictObject({ ...binding, kind: z.literal("unknown"), message: Text }),
  ]);
}
export const TabCleanupOutcome = outcomeSchema({ resource: "tab" });
export type TabCleanupOutcome = z.infer<typeof TabCleanupOutcome>;
export const WorktreeCleanupOutcome = outcomeSchema({ resource: "worktree" });
export type WorktreeCleanupOutcome = z.infer<typeof WorktreeCleanupOutcome>;
export const worktreeRetentionMessage = "Automatic worktree removal is unsupported in this version. Retain the worktree, branch and evidence; this alone does not block eligible tab closure.";
export function retainedWorktree({ intent }: { intent: WorktreeCleanupIntent }): WorktreeCleanupOutcome {
  return { kind: "retained", noEffect: true, resource: "worktree", operation: intent.id, result: intent.result, targetDigest: cleanupTargetDigest({ intent }),
    reason: "automatic-worktree-removal-unsupported", message: `${worktreeRetentionMessage} Retained path: ${intent.target.plan.path}; branch: ${intent.target.plan.branch}.`, evidence: ["first-version-worktree-retention"] };
}
export const CleanupOutcome = z.union([TabCleanupOutcome, WorktreeCleanupOutcome]);
export type CleanupOutcome = z.infer<typeof CleanupOutcome>;
export function cleanupOutcomeMatches({ intent, outcome }: { intent: CleanupIntent; outcome: CleanupOutcome }): boolean {
  return outcome.resource === intent.target.kind && outcome.operation === intent.id && isDeepStrictEqual(outcome.result, intent.result) && outcome.targetDigest === cleanupTargetDigest({ intent });
}
export const CleanupController = z.strictObject({ owner: z.uuid(), session: Text, generation: z.int().positive(), epoch: z.int().nonnegative() });
export const CleanupRecord = z.strictObject({
  intent: CleanupIntent,
  // Only explicit current-authority prepare appends a pin. Acceptance evidence is not cleanup authority.
  controllers: z.array(CleanupController).default([]),
  state: z.union([z.strictObject({ kind: z.literal("pending") }), z.strictObject({ kind: z.literal("dispatched") }), CleanupOutcome]),
  history: z.array(CleanupOutcome).default([]),
}).refine(record => (record.state.kind === "pending" || record.state.kind === "dispatched" || cleanupOutcomeMatches({ intent: record.intent, outcome: record.state })) &&
  record.history.every(outcome => cleanupOutcomeMatches({ intent: record.intent, outcome })) &&
  record.controllers.every(controller => controller.owner === record.intent.identity.assignment.owner), "Cleanup outcomes and stage controllers must bind the exact owned operation and resource.");
export type CleanupRecord = z.infer<typeof CleanupRecord>;

const Needs = z.strictObject({ continuation: z.enum(["clear", "needed", "unknown"]), handoffReader: z.enum(["clear", "needed", "unknown"]), reviewer: z.enum(["clear", "needed", "unknown"]) });
const ObservationBinding = { operation: z.uuid(), targetDigest: ResultRef.shape.digest, ownership: z.enum(["exact", "changed", "unknown"]), needs: Needs, evidence: Evidence };
/** exact ownership includes returned IDs, every occupant, session/journal, process incarnation and cwd.
 * Settlement uses native worker/child/effect observations, never idle UI or a report alone. */
export const TabCleanupObservation = z.strictObject({ ...ObservationBinding, kind: z.literal("tab"),
  occupants: z.enum(["owned-only", "human", "foreign", "ambiguous"]), activity: z.enum(["idle", "active", "unknown"]),
  worker: z.enum(["settled", "active", "unknown"]), children: z.enum(["settled", "active", "unknown"]), effects: z.enum(["settled", "active", "unknown"]),
});
export type TabCleanupObservation = z.infer<typeof TabCleanupObservation>;
/** exact ownership includes common-dir, registered path/backlink and branch; integrated means the
 * exact accepted source is still included in the intended parent. Usage includes ALL retained actors. */
export const WorktreeCleanupObservation = z.strictObject({ ...ObservationBinding, kind: z.literal("worktree"),
  integration: z.enum(["integrated", "not-integrated", "unknown"]), cleanliness: z.enum(["clean", "dirty", "unknown"]), usage: z.enum(["unused", "in-use", "unknown"]),
});
export type WorktreeCleanupObservation = z.infer<typeof WorktreeCleanupObservation>;
export type CleanupObservation = TabCleanupObservation | WorktreeCleanupObservation;
export type CleanupEligibility = { kind: "eligible"; evidence: string[] } | { kind: "retained"; reason: string; message: string; evidence: string[] };
export function cleanupEligibility({ intent, observation }: { intent: CleanupIntent; observation: CleanupObservation }): CleanupEligibility {
  const hold = ({ reason, message }: { reason: string; message: string }): CleanupEligibility => ({ kind: "retained", reason, message, evidence: observation.evidence });
  if (observation.kind !== intent.target.kind || observation.operation !== intent.id || observation.targetDigest !== cleanupTargetDigest({ intent })) return hold({ reason: "identity-mismatch", message: "Observation does not identify this exact cleanup target/operation." });
  if (observation.kind === "tab" && observation.occupants === "human") return hold({ reason: "known-human-use", message: "Observed human use of this exact tab/session; preserve it without automatic release." });
  if (observation.ownership !== "exact") return hold({ reason: "ownership", message: `Exact owned resource identity is ${observation.ownership}.` });
  for (const [need, fact] of Object.entries(observation.needs)) if (fact !== "clear") return hold({ reason: need, message: `${need} need is ${fact}; preserve the resource.` });
  if (observation.kind === "tab") {
    if (observation.occupants !== "owned-only") return hold({ reason: "occupants", message: `Retain ${observation.occupants} occupants.` });
    if (observation.activity !== "idle") return hold({ reason: "activity", message: `Actual native activity is ${observation.activity}.` });
    for (const field of ["worker", "children", "effects"] satisfies Array<"worker" | "children" | "effects">) if (observation[field] !== "settled") return hold({ reason: field, message: `Native ${field} settlement is ${observation[field]}.` });
  } else {
    if (observation.integration !== "integrated") return hold({ reason: "integration", message: `Intended parent integration is ${observation.integration}.` });
    if (observation.cleanliness !== "clean") return hold({ reason: "cleanliness", message: `Tracked/index/untracked state is ${observation.cleanliness}.` });
    if (observation.usage !== "unused") return hold({ reason: "usage", message: `Actual worktree usage is ${observation.usage}.` });
  }
  return { kind: "eligible", evidence: observation.evidence };
}

/** Fresh durable reference inventory, including handoff predecessors (never assumed unused).
 * Native adapters join this history with live usage/reader observations. Missing facts retain. */
export type CleanupReferences = {
  launches: import("./tribunus.js").LaunchRecord[];
  handoffs: import("./snapshot.js").HandoffRecord[];
  /** Capture, verification, review and integration evidence across retained result history for
   * this reservation or worktree, not just the currently accepted result. */
  resultEvidence: Array<{ reference: string; cwd: string }>;
};
/** Call finalGuard INSIDE the ordinary permission-controlled effect callback, AFTER any permission
 * wait and immediately before mutation. It rechecks BOTH current authority and fresh resource facts.
 * Recheck native identity/activity immediately before the effect; no native atomic compare-and-close is required.
 * Propagate finalGuard rejection without performing an effect. No adapter may bypass ordinary
 * permission, infer absence as a receipt or retry an uncertain action. */
export interface TabCleanupAdapter {
  observe(input: { intent: TabCleanupIntent; references: CleanupReferences }): Promise<TabCleanupObservation>;
  close(input: { intent: TabCleanupIntent; references: CleanupReferences; finalGuard: () => Promise<void> }): Promise<TabCleanupOutcome>;
  /** Read-only exact-operation postcondition/receipt inspection. Reused IDs remain retained/unknown. */
  reconcile(input: { intent: TabCleanupIntent }): Promise<TabCleanupOutcome>;
}
export interface WorktreeCleanupAdapter {
  observe(input: { intent: WorktreeCleanupIntent; references: CleanupReferences }): Promise<WorktreeCleanupObservation>;
  /** Legacy compatibility only: returns unsupported/no effect without observing, dispatching or changing receipts. */
  remove(input: { intent: WorktreeCleanupIntent; references: CleanupReferences; finalGuard: () => Promise<void> }): Promise<WorktreeCleanupOutcome>;
  /** Read-only; an absent path without conclusive matching operation evidence is unknown, not success. */
  reconcile(input: { intent: WorktreeCleanupIntent }): Promise<WorktreeCleanupOutcome>;
}
export const CleanupControl = z.strictObject({
  kind: z.literal("cleanup-control"), action: z.strictObject({ kind: z.enum(["prepare", "reconcile"]), id: z.uuid() }),
  evidence: z.strictObject({ session: Text, generation: z.int().positive(), legatus: z.uuid(), run: Text }),
});
export function unresolvedCleanup({ record }: { record: CleanupRecord }): boolean {
  return record.state.kind === "dispatched" || record.state.kind === "unknown";
}
