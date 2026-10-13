import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { EffectRecord, EngineeringEvidence, EngineeringRecord, EngineeringResult } from "./snapshot.js";

type Record = z.infer<typeof EngineeringRecord>;

export function currentEngineering(records: Record[], pin: Record["pin"]) {
  return records.filter(record => isDeepStrictEqual(record.pin, pin)).at(-1);
}

export function approvedSeam(records: Record[], request: Record) {
  const seam = records.filter(record => isDeepStrictEqual(record.pin, request.pin) && record.proposal.kind === "seam").at(-1);
  if (!seam || seam.state.kind !== "decided" || seam.state.decision.kind !== "approve" || seam.state.delivery.kind !== "applied") return null;
  if (request.proposal.kind === "seam") return request.id === seam.id ? seam : null;
  return request.proposal.seam.id === seam.id && request.proposal.seam.digest === seam.digest && seam.proposal.kind === "seam" && seam.proposal.behaviors.includes(request.proposal.behavior) ? seam : null;
}

function engineeringEvidence(decision: Record, effects: z.infer<typeof EffectRecord>[]): z.infer<typeof EngineeringEvidence> {
  const relevant = effects.filter(effect => effect.intent.decision.id === decision.id && effect.intent.decision.digest === decision.digest);
  const last = relevant.at(-1);
  const proposal = decision.proposal;
  return {
    decision: { id: decision.id, digest: decision.digest },
    seam: proposal.kind === "seam" ? { id: decision.id, digest: decision.digest } : proposal.seam,
    effects: relevant.map(effect => ({ id: effect.intent.id, digest: effect.digest })),
    alternative: proposal.kind === "seam" ? { kind: "not-required" }
      : last?.intent.call.name === "bash" && isDeepStrictEqual(last.intent.call.input, proposal.alternative.input) && last.state.kind === "completed" && !last.state.isError && last.state.exitCode === 0
        ? { kind: "verified", effect: { id: last.intent.id, digest: last.digest }, evidence: last.state.evidence, exitCode: 0 }
        : { kind: "unverified", reason: "The last admitted effect must complete the exact approved alternative command with native exit code zero. Model text and unrelated success are not verification." },
  };
}

export function engineeringResult(decision: Record, effects: z.infer<typeof EffectRecord>[], delivered: Record[]): z.infer<typeof EngineeringResult> {
  return {
    ...engineeringEvidence(decision, effects),
    priorExceptions: delivered.filter(record => record.id !== decision.id && isDeepStrictEqual(record.pin, decision.pin) && record.proposal.kind === "exception" && record.state.kind === "decided" && record.state.decision.kind === "approve")
      .map(record => engineeringEvidence(record, effects)),
  };
}
