export function exerciseRace(kind: "readiness", options?: { readinessCase: string }): Promise<{ root: string; doctor: string; view: import("../../src/intake.js").LegionView; prompts: string[] }>;
export function exerciseNativeAssignment(scenario: string, options?: { childCase: string }): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;
export function exerciseChildStartup(inherited: boolean): Promise<{ root: string; initializationError: string | null; command: unknown; inheritedBootstrap: string | null }>;
export function exerciseOrdinaryLegatusResearch(legacyHold?: boolean): Promise<Array<{
  command: string; before: unknown; after: unknown; retired: string[];
  contextResult: unknown; wakeStarted: boolean;
  loader: { isError?: boolean };
  launched: { isError?: boolean; details: { requiredExtensions: string[] } };
  refused: { isError?: boolean; content: Array<{ type: string; text: string }> };
  nativeInputs: unknown[];
}>>;
