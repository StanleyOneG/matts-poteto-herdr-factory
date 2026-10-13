import type { ContextUsage } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { LegionSettings } from "./legion-settings.js";

const Window = z.number().finite().positive().nullable();
export const ContextSample = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fresh"), tokens: z.number().finite().nonnegative(), contextWindow: z.number().finite().positive(), sampledAt: z.number().finite().nonnegative() }),
  z.strictObject({ kind: z.enum(["missing", "unknown", "stale"]), tokens: z.number().finite().nonnegative().nullable(), contextWindow: Window, sampledAt: z.number().finite().nonnegative(), reason: z.string() }),
]);
export type ContextSample = z.infer<typeof ContextSample>;
export type ContextObservation = { identity: string; model: string | null; sample: ContextSample };
export type ContextAlert = ContextObservation & { principal: string; level: "warning" | "escalation" };

export function sampleContext(usage: Pick<ContextUsage, "tokens" | "contextWindow"> | undefined, invalidation?: "compaction" | "stale"): ContextSample {
  const sampledAt = Date.now();
  const contextWindow = usage && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0 ? usage.contextWindow : null;
  if (invalidation) return { kind: invalidation === "stale" ? "stale" : "unknown", tokens: null, contextWindow, sampledAt, reason: invalidation };
  if (!usage || contextWindow === null) return { kind: "missing", tokens: null, contextWindow, sampledAt, reason: "Current estimate or model window unavailable" };
  if (usage.tokens === null || !Number.isFinite(usage.tokens) || usage.tokens < 0) return { kind: "unknown", tokens: null, contextWindow, sampledAt, reason: "Current token estimate unavailable" };
  return { kind: "fresh", tokens: usage.tokens, contextWindow, sampledAt };
}

// Invalidation is not a below-threshold sample. Only fresh estimates can re-arm.
export class ContextAlerts {
  private observations = new Map<string, ContextObservation>();
  private armed = new Map<string, { warning: boolean; escalation: boolean }>();
  observe(principal: string, observation: ContextObservation, thresholds: LegionSettings["context"]): ContextAlert | null {
    this.observations.set(principal, observation);
    const state = this.armed.get(observation.identity) ?? { warning: true, escalation: true };
    this.armed.set(observation.identity, state);
    if (observation.sample.kind !== "fresh") return null;
    const tokens = observation.sample.tokens;
    if (tokens < thresholds.warningTokens) state.warning = true;
    if (tokens < thresholds.escalationTokens) state.escalation = true;
    if (tokens >= thresholds.escalationTokens) {
      const emit = state.escalation;
      state.warning = false; state.escalation = false;
      return emit ? { ...observation, principal, level: "escalation" } : null;
    }
    if (tokens >= thresholds.warningTokens && state.warning) {
      state.warning = false;
      return { ...observation, principal, level: "warning" };
    }
    return null;
  }
  invalidate(reason: string) {
    for (const [principal, observation] of this.observations) this.observations.set(principal, { ...observation, sample: { ...observation.sample, kind: "stale", reason } });
  }
  view() { return Object.fromEntries(this.observations); }
}

export function contextStatus(observation: ContextObservation): string {
  const sample = observation.sample;
  return `${observation.model ?? "unknown model"}: ${sample.tokens ?? "unknown"}/${sample.contextWindow ?? "unknown"} tokens (${sample.kind}, sampled ${new Date(sample.sampledAt).toISOString()}${"reason" in sample ? `; ${sample.reason}` : ""})`;
}
