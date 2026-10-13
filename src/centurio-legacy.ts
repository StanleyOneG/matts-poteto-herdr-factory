import { z } from "zod";
import { ResearchOwner } from "./owned-children.js";
import { Reservation } from "./assignments.js";
import { EngineeringRecord } from "./snapshot.js";
import { WorkerAddress, LegacyBoundedAssignment } from "./tribunus.js";

// Historical intent parsing only; these records never confer current launch authority.
const CenturioRequest = z.strictObject({
  purpose: z.enum(["exploration", "review", "implementation"]),
  role: z.enum(["how explorer", "why investigators", "interrogate reviewers", "arena cross-judge pool", "feature, refactoring", "bug-fix", "perf-issue", "hardest tasks"]),
  modelIndex: z.int().nonnegative().default(0), task: z.string().min(1), timeoutMs: z.int().positive().optional(),
  baseRef: z.string().startsWith("refs/heads/").optional(), baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).optional(),
});
const Role = z.strictObject({ name: CenturioRequest.shape.role, index: z.int().nonnegative(), selector: z.string(), model: z.string(), configuration: z.string(), digest: z.string(), parentModel: z.string() });
const IntentFields = {
  id: z.uuid(),
  authority: z.strictObject({ owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() }),
  purpose: CenturioRequest.shape.purpose, role: Role, cwd: z.string(), task: z.string(), timeoutMs: z.int().positive().optional(),
  writable: z.strictObject({ parentCwd: z.string(), workspace: Reservation, engineering: EngineeringRecord, seam: EngineeringRecord }).optional(),
  agent: z.string(), definitionDigest: z.string(), endpoint: z.string(), capability: z.string(),
};
const WorkerCenturioIntent = z.strictObject({ ...IntentFields, owner: WorkerAddress, assignment: z.strictObject({ command: z.uuid(), value: LegacyBoundedAssignment }) });
// Keep historical intent parsing and digest order; never prepare or adopt legacy research.
export const LegacyCenturioIntent = z.union([
  WorkerCenturioIntent,
  z.strictObject({ ...IntentFields, owner: ResearchOwner, assignment: z.strictObject({ command: z.uuid(), research: z.literal("preparatory-read-only"), value: z.never().optional() }), purpose: z.literal("exploration"), writable: z.never().optional() }),
]);
