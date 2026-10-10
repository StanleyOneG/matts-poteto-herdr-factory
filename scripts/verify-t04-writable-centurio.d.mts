export function registerWritableCoordinator(pi: Pick<import("@earendil-works/pi-coding-agent").ExtensionAPI, "registerTool" | "getAllTools">, root: string, extension: string): void;
export function writableFixtureCommand(text: string, session: string, sequence: number): unknown;
export function writableFixtureInterpretation(initial: import("../src/intake.js").LegionView, session: string, goal: string): unknown;
export function writableFixtureDecision(open: import("zod").infer<typeof import("../src/snapshot.js").EngineeringRecord>, session: string): { kind: string; requestKey: string };
export function verifyWritablePublicEvidence(view: import("../src/intake.js").LegionView): Promise<{
  child: import("zod").infer<typeof import("../src/tribunus.js").CenturioView>;
  intent: import("zod").infer<typeof import("../src/centuriones.js").CenturioIntent>;
  effects: import("zod").infer<typeof import("../src/snapshot.js").EffectRecord>[];
  proof: unknown;
  result: unknown;
  entries: unknown[];
}>;
