export function exerciseRace(kind: "engineering" | "pending" | "workspace" | "census" | "progress" | "uncertain", census?: { stage: "intake" | "workspace" | "engineering"; outcome: "admitted" | "pending" | "stale" | "auth-unavailable" | "send-uncertain" | "pending-before" | "auth-error" | "superseded" }): Promise<unknown>;

export function exerciseRace(kind: "contract", options: { resourceCase: string; loadCase?: string }): Promise<{ launch: import("../../src/tribunus.js").LaunchView; root: string; cwd: string; proofInspections?: Record<"before" | "failed" | "restored" | "afterMatt" | "recovered", import("zod").infer<typeof import("../../src/engineering-contract.js").ContractEvidence>> }>;

export function exerciseRace(kind: "admission", options: { effectCase: string }): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseChildStartup(inherited: boolean): Promise<{ root: string; initializationError: string | null; command: unknown; inheritedBootstrap: string | null }>;

export function exerciseRace(kind: "child-preparation", options?: { childCase: string }): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseRace(kind: "child-intent"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;
export function exerciseRace(kind: "child-native"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;
export function exerciseRace(kind: "child-owned", options?: { childCase: string }): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseRace(kind: "child-concurrent"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseRace(kind: "child-discovery"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseRace(kind: "child-startup-order"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;

export function exerciseRace(kind: "child-early-startup"): Promise<{ root: string; view: import("../../src/intake.js").LegionView }>;
export function exerciseLegatusResearch(scenario?: string): Promise<{ root: string }>;
