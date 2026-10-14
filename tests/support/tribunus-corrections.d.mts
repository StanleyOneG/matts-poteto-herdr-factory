import type { z } from "zod";
import type { AssignmentPin, EffectRecord } from "../../src/snapshot.js";
import type { LocalTribunusHost } from "../../src/tribunus-host.js";
import type { handoffFixture } from "./tribunus-handoff.mjs";
type Base = Awaited<ReturnType<typeof handoffFixture>>;
export function correctionFixture(): Promise<Pick<Base, "root" | "cwd" | "actor" | "runtime" | "sends" | "address" | "authority" | "command" | "assignment" | "control" | "until" | "panePath" | "close"> & {
  profile: string;
  pin: z.infer<typeof AssignmentPin>;
  descriptor: { capability: string };
  host: LocalTribunusHost;
  admitted: z.infer<typeof EffectRecord>[];
  allowEffects(): Promise<void>;
  unknownChild(): void;
  adopt(authority: Base["authority"]): Promise<{ kind: "held"; message: string } | { kind: "ok"; value: unknown }>;
  frame(raw: unknown): Promise<{ kind: "held"; message: string } | { kind: "ok"; value: unknown }>;
}>;
