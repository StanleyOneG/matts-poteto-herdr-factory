import type { z } from "zod";
import type { HandoffRequest } from "../../src/snapshot.js";
import type { BoundedAssignment, ContextAuthority, WorkerAddress, WorkerStop, HandoffStageObservation } from "../../src/tribunus.js";
type Reply = { kind: "held"; message: string } | { kind: "ok"; value: z.infer<typeof HandoffStageObservation> };
export function handoffFixture(options?: { successor?: boolean }): Promise<{
  root: string; cwd: string; actor: string; panePath: string;
  request: z.infer<typeof HandoffRequest>; command: string; assignment: z.infer<typeof BoundedAssignment>;
  authority: z.infer<typeof ContextAuthority>; address: z.infer<typeof WorkerAddress>;
  sends: Array<{ prompt: string; options: { deliverAs?: string; expandPromptTemplates?: boolean } }>;
  runtime: {
    statuses: Array<{ key: string; text: string }>;
    start(prompt: string): Promise<boolean>;
    settle(native?: boolean, text?: string, stopReason?: string): Promise<void>;
    call(name: string, input: unknown, id?: string, parentToolCallId?: string): Promise<{ isError?: boolean; content?: Array<{ text: string }> }>;
    setPending(value: boolean): void;
    external(handler: ((name: string, input: unknown) => Promise<unknown>) | null): void;
  };
  control(frame: { kind: "stop"; command: string; currentCommand: string; instruction?: string }): Promise<{ kind: "held"; message: string } | { kind: "ok"; value: z.infer<typeof WorkerStop> }>;
  control(frame: { kind: "assign" | "initialize"; command: string; assignment?: z.infer<typeof BoundedAssignment> }): Promise<{ kind: "held"; message: string } | { kind: "ok"; value: unknown }>;
  stage(kind?: "handoff" | "observe-handoff", changes?: Record<string, unknown>): Promise<Reply>;
  until(predicate: () => boolean): Promise<void>;
  denyArtifact(): void;
  close(): Promise<void>;
}>;
