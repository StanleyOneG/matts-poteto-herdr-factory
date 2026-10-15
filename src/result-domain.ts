import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";

const Text = z.string().trim().min(1);
export const GitObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const LocalBranch = z.string().regex(/^refs\/heads\/[^\s]+$/);
const AbsolutePath = Text.refine(isAbsolute, "Use an absolute repository/worktree path.");
export const ResultRef = z.strictObject({ id: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/) });
export type ResultRef = z.infer<typeof ResultRef>;
export const ResultWorkspace = z.strictObject({
  repository: AbsolutePath, repositoryId: z.uuid(), path: AbsolutePath, branch: LocalBranch, parent: LocalBranch,
  // Legacy captures remain readable, but cannot authorize integration without a pinned owning checkout.
  parentPath: AbsolutePath.optional(),
});
export const CandidateObservation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clean"), commit: GitObjectId, tree: GitObjectId, parentCommit: GitObjectId, evidence: z.array(Text).min(1) }),
  z.strictObject({ kind: z.literal("held"), message: Text, evidence: z.array(Text) }),
]);
export const ResultIdentity = z.strictObject({
  assignment: z.strictObject({
    owner: z.uuid(), task: z.strictObject({ id: z.uuid(), revision: z.int().positive() }), scope: Text,
    reservation: z.uuid(), assignment: z.uuid(), executor: z.strictObject({ session: Text, generation: z.uuid() }),
  }),
  workspace: ResultWorkspace, commit: GitObjectId, tree: GitObjectId,
  parent: z.strictObject({ ref: LocalBranch, commit: GitObjectId }),
  criteria: z.array(z.string()), requiredChecks: z.array(Text).min(1).refine(names => new Set(names).size === names.length, "Check names must be unique."),
});
export type ResultIdentity = z.infer<typeof ResultIdentity>;
export function resultDigest(identity: ResultIdentity): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
const CheckOutcome = z.enum(["passed", "failed"]);
export const ResultVerification = z.strictObject({
  criteria: z.array(z.strictObject({ criterion: z.int().nonnegative(), outcome: CheckOutcome, evidence: z.array(Text).min(1) })),
  checks: z.array(z.strictObject({ name: Text, outcome: CheckOutcome, evidence: z.array(Text).min(1) })),
  exceptions: z.array(z.strictObject({ description: Text, resolution: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("open") }),
    z.strictObject({ kind: z.literal("resolved"), summary: Text, evidence: z.array(Text).min(1) }),
  ]) })),
}).refine(value => new Set(value.criteria.map(check => check.criterion)).size === value.criteria.length &&
  new Set(value.checks.map(check => check.name)).size === value.checks.length, "Criterion and check outcomes must be unique.");
export type ResultVerification = z.infer<typeof ResultVerification>;
export function verificationDigest(input: { result: ResultRef; verification: ResultVerification }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export const ResultReview = z.strictObject({
  id: z.uuid(), result: ResultRef, verificationDigest: ResultRef.shape.digest,
  reviewer: z.strictObject({ session: Text, run: Text }), reference: Text,
  outcome: z.enum(["approved", "changes-requested"]), evidence: z.array(Text).min(1),
});
export const ResultRecord = z.strictObject({
  id: ResultRef.shape.id, digest: ResultRef.shape.digest, identity: ResultIdentity, captureEvidence: z.array(Text).min(1),
  verifications: z.array(z.strictObject({ digest: ResultRef.shape.digest, verification: ResultVerification })).default([]),
  reviews: z.array(ResultReview).default([]),
}).refine(record => record.digest === resultDigest(record.identity) && record.identity.parent.ref === record.identity.workspace.parent &&
  record.verifications.every(value => value.digest === verificationDigest({ result: { id: record.id, digest: record.digest }, verification: value.verification })) &&
  record.reviews.every(review => review.result.id === record.id && review.result.digest === record.digest && review.reviewer.session !== record.identity.assignment.executor.session && record.verifications.some(value => value.digest === review.verificationDigest)),
  "Result, verification and independent review must bind the immutable exact identity.");
export type ResultRecord = z.infer<typeof ResultRecord>;
export type ResultStatus = { kind: "not-captured" } | { kind: "held"; result: ResultRef; message: string } |
  { kind: "verification-required" | "review-required" | "ready" | "integration-pending" | "integrating" | "integration-failed" | "integration-unknown" | "accepted"; result: ResultRef };
export function verificationPassed(record: ResultRecord): boolean {
  const verification = record.verifications.at(-1)?.verification;
  return !!verification && verification.criteria.length === record.identity.criteria.length &&
    record.identity.criteria.every((_criterion, index) => verification.criteria.some(check => check.criterion === index && check.outcome === "passed")) &&
    verification.checks.length === record.identity.requiredChecks.length &&
    record.identity.requiredChecks.every(name => verification.checks.some(check => check.name === name && check.outcome === "passed")) &&
    verification.exceptions.every(exception => exception.resolution.kind === "resolved");
}
export function currentReview(record: ResultRecord): z.infer<typeof ResultReview> | undefined {
  return [...record.reviews].reverse().find(review => review.verificationDigest === record.verifications.at(-1)?.digest);
}
export function resultStatus({ record, integrations }: { record: ResultRecord | undefined; integrations: IntegrationRecord[] }): ResultStatus {
  if (!record) return { kind: "not-captured" };
  const result = { id: record.id, digest: record.digest };
  if (!verificationPassed(record)) return { kind: "verification-required", result };
  const review = currentReview(record);
  if (review?.outcome !== "approved") return { kind: "review-required", result };
  const operation = [...integrations].reverse().find(operation => operation.intent.result.id === record.id && operation.intent.result.digest === record.digest &&
    operation.intent.verificationDigest === record.verifications.at(-1)?.digest && operation.intent.review.id === review.id);
  if (!operation) return { kind: "ready", result };
  switch (operation.state.kind) {
    case "pending": return { kind: "integration-pending", result };
    case "dispatched": return { kind: "integrating", result };
    case "failed": return { kind: "integration-failed", result };
    case "unknown": return { kind: "integration-unknown", result };
    case "confirmed": return { kind: "accepted", result };
    default: { const exhaustive: never = operation.state; return exhaustive; }
  }
}

export const IntegrationIntent = z.strictObject({
  id: z.uuid(), result: ResultRef, identity: ResultIdentity,
  verificationDigest: ResultRef.shape.digest, review: ResultReview,
  controller: z.strictObject({ owner: z.uuid(), session: Text, generation: z.int().positive(), epoch: z.int().nonnegative() }),
}).refine(intent => intent.result.digest === resultDigest(intent.identity) && intent.review.result.id === intent.result.id &&
  intent.review.result.digest === intent.result.digest && intent.review.verificationDigest === intent.verificationDigest && intent.review.outcome === "approved" &&
  intent.controller.owner === intent.identity.assignment.owner, "Integration intent must bind the exact reviewed result and owning run.");
export type IntegrationIntent = z.infer<typeof IntegrationIntent>;
const OutcomeBinding = { operation: z.uuid(), result: ResultRef, evidence: z.array(Text).min(1) };
export const IntegrationOutcome = z.discriminatedUnion("kind", [
  z.strictObject({ ...OutcomeBinding, kind: z.literal("confirmed"), source: z.strictObject({ commit: GitObjectId, tree: GitObjectId }),
    parent: z.strictObject({ ref: LocalBranch, before: GitObjectId, after: GitObjectId, tree: GitObjectId }) }),
  z.strictObject({ ...OutcomeBinding, kind: z.literal("failed"), noEffect: z.boolean(), message: Text }),
  z.strictObject({ ...OutcomeBinding, kind: z.literal("unknown"), message: Text }),
]);
export type IntegrationOutcome = z.infer<typeof IntegrationOutcome>;
export function integrationOutcomeMatches(input: { intent: IntegrationIntent; outcome: IntegrationOutcome }): boolean {
  const { intent, outcome } = input;
  if (outcome.operation !== intent.id || outcome.result.id !== intent.result.id || outcome.result.digest !== intent.result.digest) return false;
  return outcome.kind !== "confirmed" || outcome.source.commit === intent.identity.commit && outcome.source.tree === intent.identity.tree &&
    outcome.parent.ref === intent.identity.parent.ref && outcome.parent.before === intent.identity.parent.commit && outcome.parent.tree === intent.identity.tree;
}
export const IntegrationRecord = z.strictObject({
  intent: IntegrationIntent,
  state: z.union([z.strictObject({ kind: z.literal("pending") }), z.strictObject({ kind: z.literal("dispatched") }), IntegrationOutcome]),
}).refine(record => record.state.kind === "pending" || record.state.kind === "dispatched" || integrationOutcomeMatches({ intent: record.intent, outcome: record.state }),
  "Confirmed integration must observe the exact intended parent, source commit and reviewed tree; mismatches remain unaccepted.");
export type IntegrationRecord = z.infer<typeof IntegrationRecord>;
export function unresolvedIntegration(record: IntegrationRecord): boolean {
  return record.state.kind === "pending" || record.state.kind === "dispatched" || record.state.kind === "unknown" || record.state.kind === "failed" && !record.state.noEffect;
}

/** All observation/reconciliation is read-only. Guarded effects require a fresh stage plus ordinary host permissions. */
export interface ResultRepository {
  observe(input: { workspace: z.infer<typeof ResultWorkspace> }): Promise<z.infer<typeof CandidateObservation>>;
  /** Check source/parent/cleanliness again; invoke assertAuthority immediately before every guarded Git effect.
   * Confirm only after observing exact parent ref/commit/tree and source ancestry. Never stage/commit, resolve conflicts or replay an unknown intent.
   * A merge changing the reviewed tree is material and cannot return confirmed. */
  integrate(input: { intent: IntegrationIntent; assertAuthority: () => Promise<void> }): Promise<IntegrationOutcome>;
  /** Inspect the saved operation only; no mutation or retry. Ambiguity stays unknown. */
  reconcile(input: { intent: IntegrationIntent }): Promise<IntegrationOutcome>;
}
