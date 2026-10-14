import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LegionView } from "../../src/intake.js";
type Tool = Parameters<ExtensionAPI["registerTool"]>[0];
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
export function legatusUiFixture(): Promise<{
  root: string;
  runtime: ReturnType<typeof import("./composed-transport.mjs").composedRuntime> & {
    statuses: Array<{ key: string; text: string | undefined }>;
    sent: Array<{ message: { customType: string; content: string }; options?: unknown }>;
  };
  tools: Map<string, Tool>;
  commands: Map<string, Command>;
  state(): Promise<LegionView>;
  systemPrompt(): string;
  loseReceiptEvidence(id: string): void;
  startPending(): Promise<void>;
  launch(target: { id: string; revision: number }): Promise<ReturnType<typeof import("./composed-transport.mjs").composedRuntime>>;
  call(name: string, input: unknown): Promise<{ details?: import("../../src/intake.js").OperationResult; isError?: boolean; content: Array<{ type: string; text: string }> }>;
  close(): Promise<void>;
}>;
