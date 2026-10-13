import { z } from "zod";

// Historical persistence only; native skills are not machine authorization proof.
const LoadProof = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), toolCallId: z.string(), call: z.string(), result: z.string(), startLine: z.int().positive(), endLine: z.int().positive() }),
  z.object({ kind: z.literal("native-expansion"), entry: z.string() }),
]);
const Load = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-required") }),
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("complete"), evidence: z.array(LoadProof).min(1) }),
]);
const Resource = z.object({
  name: z.string(), path: z.string(), canonicalPath: z.string(), digest: z.string(), load: Load,
});
export const ContractEvidence = z.object({
  verification: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("blocked"), code: z.string(), message: z.string() }),
    z.object({ kind: z.literal("pending"), message: z.string() }),
    z.object({ kind: z.literal("verified"), scope: z.literal("current-selected-resources-and-native-loading") }),
  ]),
  compatibility: z.literal("Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review.").default("Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review."),
  kind: z.enum(["unavailable", "loading", "loaded"]), cwd: z.string(), precedence: z.literal("Matt TDD is primary; pstack supplements it. No self-authorized exceptions."),
  resources: z.array(Resource), diagnostics: z.array(z.object({ name: z.string(), status: z.enum(["ready", "missing", "incompatible", "unverified"]), message: z.string() })),
});
