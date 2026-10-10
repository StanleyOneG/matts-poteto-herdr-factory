import type { TribunusHost } from "../../src/tribunus.js";
import type { Legion } from "../../src/intake.js";
export function controllerFixture(legion: Legion, context: string, deliver: (command: string) => Promise<unknown>, withHost?: (host: TribunusHost, action: () => ReturnType<Legion["command"]>) => ReturnType<Legion["command"]>): {
  messages: string[];
  notices: string[];
  schedule(): Promise<void>;
  setBusy(value: boolean): void;
  setPending(value: boolean): void;
  start(marker: string): Promise<unknown>;
  call(toolName: string, input: unknown, id?: string): Promise<unknown>;
  settle(): Promise<void>;
  close(): void;
};
