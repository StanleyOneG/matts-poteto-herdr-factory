export function exerciseNativeAssignment(scenario: "context-block-launch"): Promise<{ root: string; view: import("../../src/intake.js").LegionView; created: boolean; notices: string[] }>;
type ContextResult = { root: string; view: import("../../src/intake.js").LegionView; observations: Array<Record<string, import("../../src/context-alerts.js").ContextObservation>>; sent: Array<{ message: { content: string; details: import("../../src/context-alerts.js").ContextAlert }; options: { triggerTurn: boolean; deliverAs: string } }>; statuses: Array<{ key: string; text: string }> };
export function exerciseNativeAssignment(scenario: "context-legatus" | "context-worker" | "context-worker-switch" | "context-worker-shutdown" | "context-worker-disposal" | "context-invalidations" | "context-low-thresholds" | "context-owner"): Promise<ContextResult>;
export function exerciseRace(kind: "readiness", options?: { readinessCase: string }): Promise<{ root: string; doctor: string; view: import("../../src/intake.js").LegionView; prompts: string[] }>;
type ProfileLaunchOptions = { profile: "matt" | "poteto-mode"; selection?: import("../../src/legion-settings.js").PrincipalSelection; initialMode?: boolean; missingWorkerSkill?: string; disableBeforeSettle?: boolean };
type ProfileLaunchResult = { root: string; view: import("../../src/intake.js").LegionView; prompts: string[]; entries: Array<{ customType?: string }> };
export function exerciseNativeAssignment(scenario: "launch-profile", options: ProfileLaunchOptions): Promise<ProfileLaunchResult & { startupCommand: string; workerDescriptor: { workflowChoice: import("../../src/legion-settings.js").WorkflowChoice } }>;
export function exerciseNativeAssignment(scenario: "launch-profile-held", options: ProfileLaunchOptions): Promise<ProfileLaunchResult>;
export function exerciseNativeAssignment(scenario: string, options?: { childCase?: string; drain?: boolean; ownerLoss?: boolean }): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;
export function exerciseChildStartup(inherited: boolean): Promise<{ root: string; initializationError: string | null; command: unknown; inheritedBootstrap: string | null }>;
export function exerciseOrdinaryLegatusResearch(legacyHold?: boolean): Promise<Array<{
  command: string; before: unknown; after: unknown; retired: string[];
  contextResult: unknown; wakeStarted: boolean;
  loader: { isError?: boolean };
  launched: { isError?: boolean; details: { requiredExtensions: string[] } };
  refused: { isError?: boolean; content: Array<{ type: string; text: string }> };
  nativeInputs: unknown[];
}>>;

export function exerciseNativeWorkflow(scenario: string): Promise<{ root: string; prompt: string; nativeWrite: { isError?: boolean }; observations: Record<string, unknown>; notices?: string[]; view: import("../../src/intake.js").LegionView }>;
