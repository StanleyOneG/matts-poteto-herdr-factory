import { execFile } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { privateFile, publish } from "./private-evidence.js";
import { promisify, isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { TabCleanupIntent, TabCleanupObservation, WorkerAddress, type TabCleanupAdapter, type TabCleanupOutcome, cleanupTargetDigest, cleanupEligibility } from "./cleanup-domain.js";
import type { CommandOutcome } from "./git-workspace.js";
import { LocalProcessIdentity, type ResumeResourceReader } from "./resume.js";
import { localHerdrIdentity } from "./tribunus-host.js";

const exec = promisify(execFile);
const Pane = z.object({ workspace_id: z.string(), tab_id: z.string(), pane_id: z.string(), terminal_id: z.string(),
  foreground_cwd: z.string().nullish(), agent: z.string().nullish(), agent_status: z.enum(["idle", "done", "working", "blocked", "unknown"]),
  agent_session: z.object({ kind: z.enum(["id", "path"]), value: z.string() }).nullish(),
});
const Snapshot = z.object({ result: z.object({ snapshot: z.object({ version: z.literal("0.9.1"), protocol: z.literal(22),
  tabs: z.array(z.object({ workspace_id: z.string(), tab_id: z.string(), pane_count: z.int().nonnegative() })), panes: z.array(Pane),
}) }) });
const Processes = z.object({ result: z.object({ process_info: z.object({ pane_id: z.string(), shell_pid: z.int().positive(),
  foreground_processes: z.array(z.object({ pid: z.int().positive() })),
}) }) });

const SessionOccupants = z.strictObject({ shell: LocalProcessIdentity, processes: z.array(LocalProcessIdentity) });
function processAt({ pid, boot }: { pid: number; boot: string }) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { identity: LocalProcessIdentity.parse({ pid, boot, start: fields[19] }), session: z.coerce.number().int().nonnegative().parse(fields[3]) };
}
function sessionOccupants({ shell, worker }: { shell: number; worker: z.infer<typeof LocalProcessIdentity> }) {
  if (process.platform !== "linux") throw new Error("Complete local terminal-session process inventory requires Linux /proc.");
  const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const shellProcess = processAt({ pid: shell, boot }), workerProcess = processAt({ pid: worker.pid, boot });
  if (shellProcess.session !== workerProcess.session || !isDeepStrictEqual(workerProcess.identity, worker)) throw new Error("Worker process incarnation or terminal session changed.");
  const processes = [];
  for (const name of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    try {
      const current = processAt({ pid: Number(name), boot });
      if (current.session === shellProcess.session) processes.push(current.identity);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if (!isDeepStrictEqual(processAt({ pid: shell, boot }), shellProcess) || !isDeepStrictEqual(processAt({ pid: worker.pid, boot }), workerProcess)) throw new Error("Terminal shell/worker incarnation changed during process census.");
  return { shell: shellProcess.identity, processes };
}

/** Native system boundary. Responses are parsed against the installed protocol, never model assertions. */
export interface TabCleanupNative {
  identity(): Promise<{ endpoint: string; server: string }>;
  snapshot(): Promise<unknown>;
  processes(input: { pane: string }): Promise<unknown>;
  occupants(input: { shell: number; worker: z.infer<typeof LocalProcessIdentity> }): Promise<unknown>;
  close(input: { tab: string }): Promise<CommandOutcome>;
}
export const localTabCleanupNative: TabCleanupNative = {
  identity: localHerdrIdentity,
  snapshot: async () => JSON.parse((await exec("herdr", ["api", "snapshot"])).stdout),
  processes: async ({ pane }) => JSON.parse((await exec("herdr", ["pane", "process-info", "--pane", pane])).stdout),
  occupants: async input => sessionOccupants(input),
  close: async ({ tab }) => {
    try { return { kind: "finished", code: 0, output: (await exec("herdr", ["tab", "close", tab])).stdout }; }
    catch (error) { return { kind: "unknown", message: `Native close did not return a successful receipt. ${String(error)}` }; }
  },
};

/** The host must enter execute only AFTER ordinary command-aware permission approval (including
 * nested Bash policy). A registered custom tool or a guard before ctx.executeTool is NOT sufficient.
 * No default permission implementation exists; extension integration must supply the real barrier. */
export type TabCleanupPermission = (input: { command: string; execute: () => Promise<TabCleanupOutcome> }) => Promise<TabCleanupOutcome>;

const CommandReceipt = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("finished"), code: z.int(), output: z.string() }),
  z.strictObject({ kind: z.literal("unknown"), message: z.string() }),
]);
const Dispatch = z.strictObject({ intent: TabCleanupIntent, command: z.string(), observation: TabCleanupObservation });
const Receipt = z.strictObject({ intent: TabCleanupIntent, command: z.string(), outcome: CommandReceipt });
export function nativeTabCloseCommand({ tab }: Parameters<TabCleanupNative["close"]>[0]): string {
  return `herdr tab close '${tab.replaceAll("'", "'\\''")}'`;
}
/** Positive operator/runtime evidence only. Unobserved input is not a claim that arbitrary manual
 * input was detected or excluded; Herdr 0.9.1 has no such takeover field. Never infer it from a shell. */
export const KnownHumanTabUse = z.strictObject({ address: WorkerAddress, evidence: z.array(z.string().min(1)).min(1) });
export type KnownHumanTabUseReader = (input: { address: z.infer<typeof WorkerAddress> }) => Promise<unknown>;
type Options = { evidenceRoot: string; resources: ResumeResourceReader; native?: TabCleanupNative; permission?: TabCleanupPermission; knownHumanUse?: KnownHumanTabUseReader };
export class LocalTabCleanupAdapter implements TabCleanupAdapter {
  private native: TabCleanupNative;
  constructor(private options: Options) {
    if (resolve(options.evidenceRoot) !== options.evidenceRoot) throw new Error("Tab cleanup evidence requires an exact absolute root.");
    this.native = options.native ?? localTabCleanupNative;
  }
  async observe({ intent, references }: Parameters<TabCleanupAdapter["observe"]>[0]): Promise<TabCleanupObservation> {
    const observation: TabCleanupObservation = { kind: "tab", operation: intent.id, targetDigest: cleanupTargetDigest({ intent }), ownership: "unknown",
      needs: { continuation: "unknown", handoffReader: "unknown", reviewer: "unknown" }, occupants: "ambiguous", activity: "unknown", worker: "unknown", children: "unknown", effects: "unknown", evidence: ["native-tab-observation"] };
    try {
      const address = intent.target.address, window = address.window;
      const launch = references.launches.find(launch => launch.id === address.launch);
      if (!launch || launch.reservation !== intent.identity.assignment.reservation || launch.scope !== intent.identity.assignment.scope || launch.startEvidence.kind !== "completed" || launch.state.kind !== "reported" ||
          !isDeepStrictEqual(launch.state.worker.address, address) || launch.state.command !== intent.identity.assignment.assignment || launch.state.report.outcome !== "reported-result" || launch.state.worker.resources.cwd !== intent.identity.workspace.path) {
        observation.evidence.push("Exact successful accepted executor launch is unavailable, held, failed or changed.");
        return observation;
      }
      // A supplies the current accepted lifecycle, already excluding pending corrections and reviews.
      // A handoff departing this executor still needs it even though acceptance was once confirmed.
      const outgoing = references.handoffs.filter(handoff => handoff.pin.launch === launch.id);
      observation.needs = outgoing.length ? { continuation: "needed", handoffReader: "needed", reviewer: "unknown" } : { continuation: "clear", handoffReader: "clear", reviewer: "clear" };
      observation.evidence.push(`accepted-executor:${launch.id}:${launch.state.command}`, `review:${intent.integration.intent.review.reference}`);
      const knownUse = this.options.knownHumanUse ? KnownHumanTabUse.nullable().parse(await this.options.knownHumanUse({ address })) : null;
      if (knownUse) {
        if (isDeepStrictEqual(knownUse.address, address)) { observation.occupants = "human"; observation.evidence.push(...knownUse.evidence); }
        else observation.evidence.push("Known human-use evidence addresses a different incarnation; observation is ambiguous.");
        return observation;
      }
      const local = await this.native.identity();
      if (local.endpoint !== window.endpoint || local.server !== window.server) { observation.ownership = "changed"; observation.evidence.push("Native endpoint/server incarnation changed."); return observation; }
      const before = Snapshot.parse(await this.native.snapshot()).result.snapshot;
      const tabs = before.tabs.filter(tab => tab.tab_id === window.tab);
      const occupants = before.panes.filter(pane => pane.tab_id === window.tab);
      const pane = occupants.find(pane => pane.pane_id === window.pane);
      if (tabs.length !== 1 || tabs[0]?.workspace_id !== window.workspace || tabs[0].pane_count !== occupants.length || !pane ||
          pane.workspace_id !== window.workspace || pane.terminal_id !== window.terminal || pane.foreground_cwd !== intent.identity.workspace.path) {
        observation.ownership = "changed"; observation.evidence.push("Returned workspace/tab/pane/terminal/cwd or complete occupant inventory changed."); return observation;
      }
      observation.evidence.push(`all-panes:${JSON.stringify(occupants)}`);
      if (occupants.length !== 1 || new Set(occupants.map(pane => pane.pane_id)).size !== occupants.length) {
        observation.occupants = occupants.some(pane => !pane.agent) ? "ambiguous" : "foreign";
        observation.evidence.push("Additional occupants have no exact accepted-executor ownership/settlement binding."); return observation;
      }
      if (pane.agent !== "pi") { observation.occupants = pane.agent ? "foreign" : "ambiguous"; observation.evidence.push("Non-worker or unrecognized occupant; preserve this tab without inferring human use."); return observation; }
      const session = pane.agent_session?.kind === "id" ? pane.agent_session.value : pane.agent_session?.kind === "path"
        ? z.object({ type: z.literal("session"), id: z.string(), cwd: z.literal(intent.identity.workspace.path) }).parse(JSON.parse(readFileSync(pane.agent_session.value, "utf8").split("\n")[0] ?? "")).id : null;
      if (session !== address.session) { observation.ownership = "changed"; observation.evidence.push("Actual native session differs from the accepted executor."); return observation; }
      const processes = Processes.parse(await this.native.processes({ pane: window.pane })).result.process_info;
      if (processes.pane_id !== window.pane) { observation.ownership = "changed"; observation.evidence.push("Native process response addresses another pane."); return observation; }
      const resources = await this.options.resources.observeResources({ launch, cwd: intent.identity.workspace.path, signal: new AbortController().signal });
      observation.evidence.push(...resources.evidence, ...resources.reasons, `all-foreground-processes:${JSON.stringify(processes)}`);
      if (resources.launch !== launch.id || resources.reservation !== launch.reservation || resources.scope !== launch.scope || resources.process.kind !== "alive" || resources.live.kind !== "observed" ||
          !isDeepStrictEqual(resources.live.value.address, address) || resources.live.value.command !== launch.state.command || !resources.report || resources.report.command !== launch.state.command ||
          !isDeepStrictEqual(resources.report.address, address) || resources.report.outcome !== "reported-result") {
        observation.evidence.push("Exact live process incarnation, authenticated worker state or successful same-assignment report is unavailable."); return observation;
      }
      if (processes.foreground_processes.length !== 1 || processes.foreground_processes[0]?.pid !== resources.process.identity.pid) {
        observation.occupants = "foreign"; observation.evidence.push("Foreground process inventory is not exclusively the exact live worker."); return observation;
      }
      const census = SessionOccupants.parse(await this.native.occupants({ shell: processes.shell_pid, worker: resources.process.identity }));
      const workerProcess = resources.process.identity;
      observation.evidence.push(`all-terminal-session-processes:${JSON.stringify(census)}`);
      if (census.shell.pid !== processes.shell_pid || census.processes.length !== 2 || census.shell.pid === workerProcess.pid ||
          !census.processes.some(process => isDeepStrictEqual(process, census.shell)) || !census.processes.some(process => isDeepStrictEqual(process, workerProcess))) {
        observation.occupants = "foreign"; observation.evidence.push("Terminal session contains extra, reused or unresolved shell/worker processes."); return observation;
      }
      const after = Snapshot.parse(await this.native.snapshot()).result.snapshot;
      if (!isDeepStrictEqual(before.tabs.filter(tab => tab.tab_id === window.tab), after.tabs.filter(tab => tab.tab_id === window.tab)) ||
          !isDeepStrictEqual(occupants, after.panes.filter(pane => pane.tab_id === window.tab)) || !isDeepStrictEqual(local, await this.native.identity())) {
        observation.evidence.push("Native identity/occupants/activity changed during settlement observation."); return observation;
      }
      const live = resources.live.value;
      observation.ownership = "exact"; observation.occupants = "owned-only";
      observation.activity = pane.agent_status === "working" || live.busy || live.pendingMessages ? "active" : pane.agent_status === "blocked" || pane.agent_status === "unknown" ? "unknown" : "idle";
      observation.worker = live.principal === "active" || live.busy || live.pendingMessages ? "active" : live.principal === "settled" && !live.admissionHold && resources.disposition === "settled" ? "settled" : "unknown";
      observation.children = live.childrenOutstanding ? "active" : live.childrenHeld || resources.children.some(child => child.disposition !== "settled") ? "unknown" : "settled";
      observation.effects = live.effectsOutstanding ? "active" : resources.effects.some(effect => effect.state.kind === "unknown") ? "unknown" : "settled";
      if (live.pendingMessages || live.admissionHold || live.retirement && live.retirement.state.kind !== "parked") observation.needs.continuation = "needed";
    } catch (error) { observation.evidence.push(`Native tab observation unresolved; preserve resources. ${String(error)}`); }
    return observation;
  }
  private paths({ intent }: { intent: TabCleanupIntent }) {
    const root = join(this.options.evidenceRoot, intent.id);
    return { root, dispatch: join(root, "dispatch.json"), receipt: join(root, "receipt.json") };
  }
  private binding({ intent }: { intent: TabCleanupIntent }): Pick<TabCleanupOutcome, "resource" | "operation" | "result" | "targetDigest"> {
    return { resource: "tab", operation: intent.id, result: intent.result, targetDigest: cleanupTargetDigest({ intent }) };
  }
  async close({ intent, references, finalGuard }: Parameters<TabCleanupAdapter["close"]>[0]): Promise<TabCleanupOutcome> {
    const paths = this.paths({ intent }), binding = this.binding({ intent });
    if (existsSync(paths.dispatch) || existsSync(paths.receipt)) return this.reconcile({ intent });
    const retained = ({ reason, message, evidence }: { reason: string; message: string; evidence: string[] }): TabCleanupOutcome => ({ ...binding, kind: "retained", noEffect: true, reason, message, evidence });
    if (!this.options.permission) return retained({ reason: "permission-unavailable", message: "No verified after-permission native tab effect callback. Preserve the tab.", evidence: ["tab-close-not-dispatched"] });
    let entered = false;
    return this.options.permission({ command: nativeTabCloseCommand({ tab: intent.target.address.window.tab }), execute: async () => {
      if (entered) throw new Error("Tab cleanup permission callback is one-shot; observe the exact operation, never replay it.");
      entered = true;
      const observation = await this.observe({ intent, references });
      if (observation.occupants === "human") return retained({ reason: "known-human-use", message: "Observed human use of this exact tab/session; preserve it without automatic release.", evidence: observation.evidence });
      const eligibility = cleanupEligibility({ intent, observation });
      if (eligibility.kind === "retained") return retained(eligibility);
      // A's finalGuard rereads current lifecycle/references, observes native facts again, and checks
      // authority after that observation. This call belongs inside the actual permission barrier.
      await finalGuard();
      if (existsSync(paths.dispatch) || existsSync(paths.receipt)) return this.reconcile({ intent });
      mkdirSync(paths.root, { recursive: true, mode: 0o700 });
      publish(paths.dispatch, Dispatch.parse({ intent, command: nativeTabCloseCommand({ tab: intent.target.address.window.tab }), observation }));
      let outcome: z.infer<typeof CommandReceipt>;
      try { outcome = CommandReceipt.parse(await this.native.close({ tab: intent.target.address.window.tab })); }
      catch (error) { outcome = { kind: "unknown", message: String(error) }; }
      // Save the exact successful command response BEFORE any postcondition or controller receipt.
      // Losing either later acknowledgment can then be reconciled read-only without repeating close.
      publish(paths.receipt, Receipt.parse({ intent, command: nativeTabCloseCommand({ tab: intent.target.address.window.tab }), outcome }));
      return this.reconcile({ intent });
    } });
  }
  async reconcile({ intent }: Parameters<TabCleanupAdapter["reconcile"]>[0]): Promise<TabCleanupOutcome> {
    const paths = this.paths({ intent }), binding = this.binding({ intent });
    const unknown = (message: string): TabCleanupOutcome => ({ ...binding, kind: "unknown", message, evidence: [paths.dispatch, paths.receipt] });
    try {
      if (!existsSync(paths.dispatch) || !existsSync(paths.receipt)) return unknown("Exact durable close dispatch/command receipt unavailable. Absence is not success or permission to replay.");
      const dispatch = Dispatch.parse(privateFile(paths.dispatch)), receipt = Receipt.parse(privateFile(paths.receipt));
      if (!isDeepStrictEqual(dispatch.intent, intent) || !isDeepStrictEqual(receipt.intent, intent) || dispatch.command !== nativeTabCloseCommand({ tab: intent.target.address.window.tab }) || receipt.command !== dispatch.command ||
          cleanupEligibility({ intent, observation: dispatch.observation }).kind !== "eligible") return unknown("Retained native close evidence identifies another operation/target or lacks exact eligibility. No replay.");
      if (receipt.outcome.kind !== "finished" || receipt.outcome.code !== 0 || !z.object({ result: z.object({ type: z.literal("ok") }) }).safeParse(JSON.parse(receipt.outcome.output)).success)
        return unknown("Native close has no exact successful command receipt. Missing tab alone cannot resolve an uncertain effect.");
      const window = intent.target.address.window, local = await this.native.identity();
      if (local.endpoint !== window.endpoint || local.server !== window.server) return unknown("Native server incarnation changed; do not reinterpret old IDs or replay the operation.");
      const snapshot = Snapshot.parse(await this.native.snapshot()).result.snapshot;
      if (snapshot.tabs.some(tab => tab.tab_id === window.tab) || snapshot.panes.some(pane => pane.tab_id === window.tab || pane.pane_id === window.pane || pane.terminal_id === window.terminal))
        return unknown("Exact successful receipt conflicts with current tab/pane/terminal presence. Preserve reused or moved IDs; never close them again.");
      return { ...binding, kind: "confirmed", evidence: [paths.dispatch, paths.receipt, "same-server exact tab/pane/terminal absence after successful bound close"] };
    } catch (error) { return unknown(`Native close evidence/postcondition unresolved. Preserve evidence and observe only. ${String(error)}`); }
  }
}
