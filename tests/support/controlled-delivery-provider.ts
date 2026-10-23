// Operator-only disposable test platform. No network, actor control or independent acceptance authority.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DeliveryProviderRequest } from "../../src/delivery-adapter.js";
import { DeliveryOutcome, FinalIdentity } from "../../src/delivery-domain.js";
import { z } from "zod";

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const Ref = z.strictObject({ id: z.uuid(), digest: Digest });
const Linkage = z.strictObject({
  result: Ref, verifications: z.array(z.string()),
  reviews: z.array(z.strictObject({ id: z.uuid(), reference: z.string(), verificationDigest: z.string() })),
  integration: z.uuid(),
});
const Scope = z.strictObject({ specification: FinalIdentity.shape.specification,
  workspace: FinalIdentity.shape.workspace, tasks: FinalIdentity.shape.tasks });
const FinalLinkage = z.strictObject({ final: Ref, scope: Scope, tip: z.string(), tree: z.string(),
  results: z.array(Linkage), verifications: z.array(z.string()), reviews: Linkage.shape.reviews });
const Review = z.strictObject({ id: z.uuid(), project: z.string(), reference: z.string(), draft: z.uuid(),
  scope: Scope, tip: z.string(), tree: z.string(), final: Ref });
const State = z.strictObject({
  version: z.literal(1), provider: z.literal("controlled-fixture"), project: z.string().startsWith("fixture-"),
  issues: z.array(z.union([
    z.strictObject({ id: z.enum(["A", "B", "C"]), state: z.literal("open") }),
    z.strictObject({ id: z.enum(["A", "B", "C"]), state: z.literal("closed"), closure: z.uuid() }),
  ])),
  reviews: z.array(z.union([Review.extend({ state: z.literal("draft") }), Review.extend({ state: z.literal("ready"), ready: z.uuid() })])),
  operations: z.array(z.strictObject({ operation: z.uuid(), digest: Digest, requestHash: Digest,
    linkage: z.union([Linkage, FinalLinkage]), outcome: DeliveryOutcome })),
}).refine(state => new Set(state.issues.map(issue => issue.id)).size === 3 && state.issues.length === 3 &&
  new Set(state.operations.map(receipt => receipt.operation)).size === state.operations.length &&
  new Set(state.reviews.map(review => review.id)).size === state.reviews.length &&
  state.operations.every(receipt => receipt.outcome.operation === receipt.operation && receipt.outcome.digest === receipt.digest) &&
  state.issues.every(issue => issue.state === "open" || state.operations.some(receipt => receipt.operation === issue.closure &&
    "result" in receipt.linkage && receipt.outcome.kind === "confirmed" && receipt.outcome.reference === `test-fixture:${state.project}/issues/${issue.id}`)) &&
  state.reviews.every(review => review.project === state.project && state.operations.some(receipt => receipt.operation === review.draft &&
    "final" in receipt.linkage && receipt.outcome.kind === "confirmed" && receipt.outcome.reference === review.reference) &&
    (review.state === "draft" || state.operations.some(receipt => receipt.operation === review.ready &&
      "final" in receipt.linkage && receipt.outcome.kind === "confirmed" && receipt.outcome.reference === review.reference))), "Malformed fixture object/receipt bindings.");
function resultLinkage(proof: z.infer<typeof FinalIdentity>["results"][number]) {
  return { result: { id: proof.record.id, digest: proof.record.digest },
    verifications: proof.record.verifications.map(value => value.digest),
    reviews: proof.record.reviews.map(({ id, reference, verificationDigest }) => ({ id, reference, verificationDigest })),
    integration: proof.integration.intent.id };
}
function finalLinkage(intent: z.infer<typeof DeliveryProviderRequest>["intent"] & { kind: "publish" }) {
  const record = intent.final;
  const { specification, workspace, tasks } = record.identity;
  return { final: { id: record.id, digest: record.digest }, scope: Scope.parse({ specification, workspace, tasks }),
    tip: record.identity.commit, tree: record.identity.tree, results: record.identity.results.map(resultLinkage),
    verifications: record.verifications.map(value => value.digest),
    reviews: record.reviews.map(({ id, reference, verificationDigest }) => ({ id, reference, verificationDigest })) };
}
function provider(root: string) {
  const request = DeliveryProviderRequest.parse(JSON.parse(readFileSync(0, "utf8")));
  const { mode, ...identity } = request;
  const requestHash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const load = () => State.parse(JSON.parse(readFileSync(join(root, "state.json"), "utf8")));
  let state = load();
  const prior = state.operations.find(receipt => receipt.operation === request.operation);
  if (prior && prior.requestHash !== requestHash) throw new Error("Operation content changed.");
  const binding = { operation: request.operation, digest: request.digest };
  if (mode === "reconcile") {
    const outcome = prior?.outcome ?? { ...binding, kind: "unknown", evidence: ["No exact fixture receipt; absence does not prove no effect."], message: "No receipt" };
    process.stdout.write(JSON.stringify({ protocol: request.protocol, outcome }));
    return;
  }
  // Exclusive writer lock; interrupted locks/pending writes are retained, never automatically recovered.
  const lock = openSync(join(root, "writer.lock"), "wx", 0o600);
  try {
    state = load();
    if (state.operations.some(receipt => receipt.operation === request.operation)) throw new Error("Execute never repeats an operation; reconcile instead.");
    const { intent } = request;
    // Native adapter owns authority/acceptance. These summaries retain only supplied IDs and references.
    const linkage = intent.kind === "close-task" ? resultLinkage(intent.proof) : finalLinkage(intent);
    const correctProject = request.target.provider === state.provider && request.target.project === state.project &&
      intent.configuration.provider === state.provider && intent.configuration.project === state.project;
    let reference: string | undefined;
    if (correctProject && intent.kind === "close-task" && intent.tracker.provider === state.provider && intent.tracker.project === state.project) {
      const issue = state.issues.find(issue => issue.id === intent.tracker.id && issue.state === "open");
      if (issue) {
        reference = `test-fixture:${state.project}/issues/${issue.id}`;
        state.issues = state.issues.map(value => value.id === issue.id ? { id: value.id, state: "closed", closure: request.operation } : value);
      }
    } else if (correctProject && intent.kind === "publish") {
      const supplied = finalLinkage(intent);
      if (intent.publication.kind === "draft") {
        const id = randomUUID();
        reference = `test-fixture:${state.project}/reviews/${id}`;
        state.reviews.push({ id, project: state.project, reference, draft: request.operation, state: "draft",
          scope: supplied.scope, tip: supplied.tip, tree: supplied.tree, final: supplied.final });
      } else if (intent.publication.kind === "ready") {
        const publication = intent.publication;
        const draftReceipt = state.operations.find(receipt => receipt.operation === publication.draft);
        const review = state.reviews.find(review => review.draft === publication.draft && review.reference === publication.reference && review.state === "draft");
        if (review && draftReceipt?.outcome.kind === "confirmed" && draftReceipt.outcome.reference === review.reference &&
            JSON.stringify(review.scope) === JSON.stringify(supplied.scope)) {
          reference = review.reference;
          state.reviews = state.reviews.map(value => value.id === review.id
            ? { ...review, state: "ready", ready: request.operation, tip: supplied.tip, tree: supplied.tree, final: supplied.final } : value);
        }
      }
    }
    const outcome: z.infer<typeof DeliveryOutcome> = reference
      ? { ...binding, kind: "confirmed", reference, evidence: [`Local test fixture receipt ${request.operation}; not hosted-platform acceptance.`] }
      : { ...binding, kind: "failed", noEffect: true, message: "Fixture target, issue or original draft scope/reference refused", evidence: ["Rejected before changing any issue/review object."] };
    state.operations.push({ ...binding, requestHash, linkage, outcome });
    save(root, State.parse(state));
    process.stdout.write(JSON.stringify({ protocol: request.protocol, outcome }));
  } finally { closeSync(lock); unlinkSync(join(root, "writer.lock")); }
}
function syncDirectory(root: string) {
  const fd = openSync(root, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function save(root: string, state: z.infer<typeof State>) {
  const pending = join(root, "state.pending");
  const fd = openSync(pending, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(state, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(pending, join(root, "state.json"));
  syncDirectory(root);
}
try {
  const [action, root, ...extra] = process.argv.slice(2);
  if (!root || !isAbsolute(root) || extra.length) throw new Error("Usage: init|inspect|provider ABSOLUTE_NEW_ROOT");
  if (action === "init") {
    if (join(realpathSync(dirname(root)), basename(root)) !== root) throw new Error("Use a canonical new root.");
    mkdirSync(root, { mode: 0o700 }); // Exclusive ownership: never adopt or reset an existing directory.
    const state = State.parse({ version: 1, provider: "controlled-fixture", project: `fixture-${randomUUID()}`,
      issues: ["A", "B", "C"].map(id => ({ id, state: "open" })), reviews: [], operations: [] });
    save(root, state);
    process.stdout.write(JSON.stringify(state));
  } else {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root || !existsSync(join(root, "state.json")) || !lstatSync(join(root, "state.json")).isFile()) throw new Error("Use the canonical initialized fixture root.");
    const state = State.parse(JSON.parse(readFileSync(join(root, "state.json"), "utf8")));
    if (action === "provider") provider(root);
    else if (action === "inspect") process.stdout.write(JSON.stringify(state));
    else throw new Error("Unsupported fixture command.");
  }
} catch {
  process.stderr.write("Controlled fixture refused command or state; no success claimed. Preserve root for inspection.\n");
  process.exitCode = 2;
}
