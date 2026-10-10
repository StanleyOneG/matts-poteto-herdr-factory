import { z } from "zod";
export const CenturioView = z.strictObject({
  id: z.uuid(), purpose: z.enum(["exploration", "review", "implementation"]), model: z.string(),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("prepared") }),
    z.strictObject({ kind: z.literal("launch-unresolved") }),
    z.strictObject({ kind: z.literal("corroboration-pending"), reason: z.string() }),
    z.strictObject({ kind: z.literal("mismatch"), reason: z.string() }),
    z.strictObject({ kind: z.literal("unknown"), reason: z.string() }),
    z.strictObject({ kind: z.literal("active"), run: z.string(), index: z.int().nonnegative(), session: z.string() }),
    z.strictObject({ kind: z.literal("logical-terminal"), run: z.string(), index: z.int().nonnegative(), session: z.string(), outcome: z.string() }),
    z.strictObject({ kind: z.literal("process-terminal"), run: z.string(), index: z.int().nonnegative(), session: z.string(), outcome: z.string(), proof: z.string() }),
  ]),
  result: z.strictObject({ evidence: z.string(), source: z.string(), sha256: z.string(), preview: z.string().max(4000) }).nullable(),
  evidence: z.array(z.string()),
});

export const ResearchOwner = z.strictObject({ role: z.literal("legatus"), owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() });
export const ResearchRequest = z.strictObject({ kind: z.literal("research"), requestKey: z.uuid(), task: z.string().trim().min(1), role: z.enum(["how explorer", "why investigators"]), modelIndex: z.int().nonnegative().default(0), owner: ResearchOwner });
export const ResearchStage = z.strictObject({
  id: z.uuid(), owner: ResearchOwner, task: z.string().min(1),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("requested") }),
    z.strictObject({ kind: z.literal("dispatched"), marker: z.string() }),
    z.strictObject({ kind: z.literal("prepared"), marker: z.string() }),
    z.strictObject({ kind: z.literal("settled"), marker: z.string() }),
  ]),
});
const StageEventFields = { owner: ResearchOwner, id: z.uuid(), marker: z.string() };
export const ResearchStageEvent = z.discriminatedUnion("kind", [
  z.strictObject({ ...StageEventFields, kind: z.literal("research-dispatch") }),
  z.strictObject({ ...StageEventFields, kind: z.literal("research-settled") }),
]);
export const ResearchRecord = z.strictObject({ id: z.uuid(), owner: ResearchOwner, task: z.string(), intent: z.strictObject({ path: z.string(), digest: z.string() }), child: CenturioView, sequence: z.int().nonnegative(), launch: z.json() });
export const ResearchObservation = z.strictObject({ kind: z.literal("research-observation"), owner: ResearchOwner, command: z.uuid(), sequence: z.int().positive(), children: z.array(CenturioView) });
export const ResearchCheck = z.strictObject({ kind: z.literal("research-owner-check"), owner: ResearchOwner, id: z.uuid(), digest: z.string(), stage: z.enum(["launch", "read"]) });
