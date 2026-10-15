import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { GitObjectId, LocalBranch, IntegrationRecord, ResultRecord, ResultRef, ResultReview, ResultVerification, resultStatus, currentReview } from "./result-domain.js";

const Text = z.string().trim().min(1);
const Task = z.strictObject({ id: z.uuid(), revision: z.int().positive() });
/** Provider identity is explicit; core never infers a tracker from a Git remote. */
export const TrackerTaskRef = z.strictObject({ provider: Text, project: Text, id: Text, url: z.url().optional() });
export type TrackerTaskRef = z.infer<typeof TrackerTaskRef>;
export const DeliveryConfiguration = z.strictObject({ provider: Text, project: Text, revision: Text });
export const AcceptedResultProof = z.strictObject({ record: ResultRecord, integration: IntegrationRecord }).refine(proof =>
  resultStatus({ record: proof.record, integrations: [proof.integration] }).kind === "accepted", "Only exact accepted result evidence is a delivery proof.");
export type AcceptedResultProof = z.infer<typeof AcceptedResultProof>;
export function deliveryDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
const Controller = z.strictObject({ owner: z.uuid(), session: Text, generation: z.int().positive(), epoch: z.int().nonnegative() });
const AbsolutePath = Text.refine(isAbsolute, "Use an absolute repository/worktree path.");
export const FinalWorkspace = z.strictObject({ repository: AbsolutePath, path: AbsolutePath, branch: LocalBranch });
export const FinalObservation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clean"), commit: GitObjectId, tree: GitObjectId, evidence: z.array(Text).min(1) }),
  z.strictObject({ kind: z.literal("held"), message: Text, evidence: z.array(Text) }),
]);
export const FinalIdentity = z.strictObject({ specification: Text, workspace: FinalWorkspace, commit: GitObjectId, tree: GitObjectId,
  tasks: z.array(Task).min(1).refine(tasks => new Set(tasks.map(task => task.id)).size === tasks.length, "Delivery scope task IDs are unique."), results: z.array(AcceptedResultProof).min(1), requiredChecks: z.array(Text).min(1).refine(names => new Set(names).size === names.length),
}).refine(identity => new Set(identity.results.map(proof => proof.record.identity.assignment.task.id)).size === identity.results.length && identity.results.every(proof =>
  identity.tasks.some(task => task.id === proof.record.identity.assignment.task.id && task.revision === proof.record.identity.assignment.task.revision) &&
  proof.record.identity.workspace.repository === identity.workspace.repository && proof.record.identity.workspace.parentPath === identity.workspace.path && proof.record.identity.parent.ref === identity.workspace.branch),
  "Final accepted proofs must belong to distinct declared tasks and the exact owning parent workspace.");
export const FinalVerification = z.strictObject({ checks: ResultVerification.shape.checks, exceptions: ResultVerification.shape.exceptions }).refine(value => new Set(value.checks.map(check => check.name)).size === value.checks.length, "Final check outcomes are unique.");
export const FinalRecord = z.strictObject({ id: z.uuid(), digest: ResultRef.shape.digest, identity: FinalIdentity, evidence: z.array(Text).min(1),
  verifications: z.array(z.strictObject({ digest: ResultRef.shape.digest, verification: FinalVerification })).default([]), reviews: z.array(ResultReview).default([]),
}).refine(record => record.digest === deliveryDigest(record.identity) && record.verifications.every(value => value.digest === deliveryDigest({ final: { id: record.id, digest: record.digest }, verification: value.verification })) && record.reviews.every(review => review.result.id === record.id && review.result.digest === record.digest && record.verifications.some(value => value.digest === review.verificationDigest) && record.identity.results.every(proof => proof.record.identity.assignment.executor.session !== review.reviewer.session)), "Final checks/review bind exact result set and branch tip/tree.");
export type FinalRecord = z.infer<typeof FinalRecord>;
export const FinalReviewStatus = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("review-required") }),
  z.strictObject({ kind: z.literal("reused-result-review"), result: ResultRef, review: ResultReview }),
  z.strictObject({ kind: z.literal("final-review"), review: ResultReview }),
]);
export type FinalReviewStatus = z.infer<typeof FinalReviewStatus>;
export function finalReviewStatus(record: FinalRecord): FinalReviewStatus {
  const { identity } = record, proof = identity.results[0];
  const source = proof?.record, review = source && currentReview(source);
  if (record.verifications.length === 0 && record.reviews.length === 0 && identity.tasks.length === 1 && identity.results.length === 1 && source && review?.outcome === "approved" &&
      identity.commit === source.identity.commit && identity.tree === source.identity.tree &&
      identity.workspace.repository === source.identity.workspace.repository && identity.workspace.path === source.identity.workspace.parentPath && identity.workspace.branch === source.identity.parent.ref &&
      identity.requiredChecks.length === source.identity.requiredChecks.length && identity.requiredChecks.every(name => source.identity.requiredChecks.includes(name)))
    return { kind: "reused-result-review", result: { id: source.id, digest: source.digest }, review };
  const verification = record.verifications.at(-1), finalReview = [...record.reviews].reverse().find(review => review.verificationDigest === verification?.digest);
  if (identity.tasks.length !== identity.results.length || !verification || verification.verification.checks.length !== identity.requiredChecks.length ||
      !identity.requiredChecks.every(name => verification.verification.checks.some(check => check.name === name && check.outcome === "passed")) ||
      verification.verification.exceptions.some(exception => exception.resolution.kind !== "resolved") || finalReview?.outcome !== "approved") return { kind: "review-required" };
  return { kind: "final-review", review: finalReview };
}
export const Publication = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("draft") }),
  z.strictObject({ kind: z.literal("ready"), draft: z.uuid() }),
  z.strictObject({ kind: z.literal("local-report") }),
]);
const PreparedPublication = z.discriminatedUnion("kind", [
  Publication.options[0], Publication.options[1].extend({ reference: Text }), Publication.options[2],
]);
const PreviousAttempt = { previous: z.uuid().optional() };
const Closure = z.strictObject({ ...PreviousAttempt, kind: z.literal("close-task"), task: Task, tracker: TrackerTaskRef, proof: AcceptedResultProof });
const Publish = z.strictObject({ ...PreviousAttempt, kind: z.literal("publish"), final: FinalRecord, review: FinalReviewStatus, publication: PreparedPublication });
export const DeliveryContent = z.discriminatedUnion("kind", [Closure, Publish]);
const CommonIntent = { id: z.uuid(), digest: ResultRef.shape.digest, configuration: DeliveryConfiguration, controller: Controller };
export const DeliveryIntent = z.discriminatedUnion("kind", [Closure.extend(CommonIntent), Publish.extend(CommonIntent)]).refine(intent => {
  const { id: _id, digest, controller: _controller, configuration, ...raw } = intent;
  if (digest !== deliveryDigest({ content: DeliveryContent.parse(raw), configuration })) return false;
  if (intent.kind === "close-task") return intent.controller.owner === intent.proof.record.identity.assignment.owner &&
    intent.task.id === intent.proof.record.identity.assignment.task.id && intent.task.revision === intent.proof.record.identity.assignment.task.revision &&
    intent.configuration.provider === intent.tracker.provider && intent.configuration.project === intent.tracker.project;
  return JSON.stringify(intent.review) === JSON.stringify(finalReviewStatus(intent.final)) &&
    (intent.publication.kind === "draft" || intent.review.kind !== "review-required");
}, "Intent digest binds exact evidence, target and configuration.");
export type DeliveryIntent = z.infer<typeof DeliveryIntent>;
const OutcomeBinding = { operation: z.uuid(), digest: ResultRef.shape.digest, evidence: z.array(Text).min(1) };
export const DeliveryOutcome = z.discriminatedUnion("kind", [
  z.strictObject({ ...OutcomeBinding, kind: z.literal("confirmed"), reference: Text }),
  z.strictObject({ ...OutcomeBinding, kind: z.literal("failed"), noEffect: z.boolean(), message: Text }),
  z.strictObject({ ...OutcomeBinding, kind: z.literal("unknown"), message: Text }),
]);
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;
export function deliveryOutcomeMatches(input: { intent: DeliveryIntent; outcome: DeliveryOutcome }): boolean {
  return input.intent.id === input.outcome.operation && input.intent.digest === input.outcome.digest &&
    (input.outcome.kind !== "confirmed" || input.intent.kind !== "publish" || input.intent.publication.kind !== "ready" || input.outcome.reference === input.intent.publication.reference);
}
export const DeliveryRecord = z.strictObject({ intent: DeliveryIntent, state: z.union([
  z.strictObject({ kind: z.literal("pending") }), z.strictObject({ kind: z.literal("dispatched") }), DeliveryOutcome,
]) }).refine(record => record.state.kind === "pending" || record.state.kind === "dispatched" || deliveryOutcomeMatches({ intent: record.intent, outcome: record.state }), "Outcome must identify the exact delivery operation.");
export type DeliveryRecord = z.infer<typeof DeliveryRecord>;
export function unresolvedDelivery(record: DeliveryRecord): boolean {
  return record.state.kind === "pending" || record.state.kind === "dispatched" || record.state.kind === "unknown" || record.state.kind === "failed" && !record.state.noEffect;
}
export const DeliveryExecution = z.strictObject({ deliveryRequest: z.uuid() });
export const DeliveryObservation = z.strictObject({ run: z.uuid(), operation: z.uuid(), session: Text });
export const DeliveryAction = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("bind-tracker"), task: Task, tracker: TrackerTaskRef }),
    z.strictObject({ kind: z.literal("prepare-closure"), task: Task, id: z.uuid(), ...PreviousAttempt }),
    z.strictObject({ kind: z.literal("reconcile"), id: z.uuid() }),
    z.strictObject({ kind: z.literal("capture-final"), specification: Text, tasks: FinalIdentity.shape.tasks, requiredChecks: FinalIdentity.shape.requiredChecks }),
    z.strictObject({ kind: z.literal("verify-final"), final: ResultRef, verification: FinalVerification }),
    ResultReview.extend({ kind: z.literal("review-final") }),
    z.strictObject({ kind: z.literal("prepare-publication"), ...PreviousAttempt, id: z.uuid(), final: ResultRef, publication: Publication }),
]);
export const DeliveryControl = z.strictObject({
  kind: z.literal("delivery-control"), action: DeliveryAction,
  evidence: z.strictObject({ session: Text, generation: z.int().positive(), legatus: z.uuid(), run: Text }),
});
/** Inject only explicitly configured project-local adapters. No model-authored shell commands.
 * execute must use the ordinary host permission boundary and call assertAuthority immediately before
 * every effect. reconcile is strictly read-only and must prove operation-bound effects, not just current state. */
export interface DeliveryAdapter {
  configuration: z.infer<typeof DeliveryConfiguration>;
  /** Read-only clean exact owning branch observation. Reject mismatched repository/ref/path, dirty state,
   * or any accepted integration whose confirmed parent.after commit is no longer an ancestor of the final tip. */
  observeFinal?(input: { workspace: z.infer<typeof FinalWorkspace>; results: AcceptedResultProof[] }): Promise<z.infer<typeof FinalObservation>>;
  execute(input: { intent: DeliveryIntent; assertAuthority: () => Promise<void> }): Promise<DeliveryOutcome>;
  reconcile(input: { intent: DeliveryIntent }): Promise<DeliveryOutcome>;
}
