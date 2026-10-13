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

// Persisted legacy research evidence only. No current research authority or controller.
export const ResearchOwner = z.strictObject({ role: z.literal("legatus"), owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative() });
export const ResearchStage = z.strictObject({
  id: z.uuid(), owner: ResearchOwner, task: z.string().min(1),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("requested") }),
    z.strictObject({ kind: z.literal("dispatched"), marker: z.string() }),
    z.strictObject({ kind: z.literal("prepared"), marker: z.string() }),
    z.strictObject({ kind: z.literal("settled"), marker: z.string() }),
  ]),
});
export const ResearchRecord = z.strictObject({ id: z.uuid(), owner: ResearchOwner, task: z.string(), intent: z.strictObject({ path: z.string(), digest: z.string() }), child: CenturioView, sequence: z.int().nonnegative(), launch: z.json() });
