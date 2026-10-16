import { existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { GitWorkspace, type GuardedCommand } from "./git-workspace.js";
import { WorktreeCleanupIntent, WorktreeCleanupObservation, cleanupEligibility, cleanupTargetDigest, type WorktreeCleanupAdapter, type WorktreeCleanupOutcome, type CleanupReferences, retainedWorktree } from "./cleanup-domain.js";
import { privateFile } from "./private-evidence.js";

/** Trusted native boundary, not model-supplied assertions. Must join actual process/filesystem use
 * and native worker/child/effect settlement for EVERY supplied predecessor and successor. Death,
 * tab absence and UI idle alone are insufficient. Incomplete visibility returns unknown. */
export const WorktreeUsage = z.strictObject({ usage: z.enum(["unused", "in-use", "unknown"]), evidence: z.array(z.string().min(1)).min(1) });
export type WorktreeUsageReader = (input: { intent: WorktreeCleanupIntent; references: CleanupReferences }) => Promise<unknown>;
/** Legacy caller shape only; removal is inert and never invokes this callback. */
export type WorktreeCleanupPermission = (input: { command: string; execute: () => Promise<WorktreeCleanupOutcome> }) => Promise<WorktreeCleanupOutcome>;
type Options = { commonDir: string; evidenceRoot: string; run: GuardedCommand; usage?: WorktreeUsageReader; permission?: WorktreeCleanupPermission };
const CommandReceipt = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("finished"), code: z.int(), output: z.string() }),
  z.strictObject({ kind: z.literal("unknown"), message: z.string() }),
]);
const Stamp = z.strictObject({ path: z.string(), dev: z.string(), ino: z.string(), birth: z.string() });
const Identity = z.strictObject({ common: Stamp, directory: Stamp, administrative: Stamp, gitfile: Stamp, gitfileText: z.string() });
const Dispatch = z.strictObject({ intent: WorktreeCleanupIntent, command: z.string(), observation: WorktreeCleanupObservation, identity: Identity });
const Receipt = z.strictObject({ intent: WorktreeCleanupIntent, command: z.string(), outcome: CommandReceipt });
const inside = ({ root, path }: { root: string; path: string }) => { const delta = relative(root, path); return delta === "" || delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta); };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// Reconstruct historical command bytes for read-only receipt matching only; never execute them.
const commandFor = ({ intent, commonDir }: { intent: WorktreeCleanupIntent; commonDir: string }) => ["git", "-C", commonDir, "worktree", "remove", "--", intent.target.plan.path].map(quote).join(" ");
function canonicalDestination({ path }: { path: string }): string {
  let ancestor = path;
  while (true) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = resolve(ancestor, ".."); if (parent === ancestor) throw new Error("No existing evidence ancestor."); ancestor = parent;
    }
  }
  return resolve(realpathSync(ancestor), relative(ancestor, path));
}
function stamp({ path }: { path: string }) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error("Symlink resource identity is not exact.");
  return { path: realpathSync(path), dev: stat.dev.toString(), ino: stat.ino.toString(), birth: stat.birthtimeNs.toString() };
}

export class LocalWorktreeCleanupAdapter implements WorktreeCleanupAdapter {
  private git: GitWorkspace;
  constructor(private options: Options) {
    if (resolve(options.commonDir) !== options.commonDir || resolve(options.evidenceRoot) !== options.evidenceRoot) throw new Error("Worktree cleanup requires exact absolute repository/evidence roots.");
    this.git = new GitWorkspace(options.commonDir, options.run);
  }
  async observe({ intent, references }: Parameters<WorktreeCleanupAdapter["observe"]>[0]): Promise<WorktreeCleanupObservation> {
    const observation: WorktreeCleanupObservation = { kind: "worktree", operation: intent.id, targetDigest: cleanupTargetDigest({ intent }), ownership: "unknown", needs: { continuation: "unknown", handoffReader: "unknown", reviewer: "unknown" }, integration: "unknown", cleanliness: "unknown", usage: "unknown", evidence: ["read-only-worktree-cleanup-observation"] };
    try {
      const plan = intent.target.plan;
      if (intent.identity.workspace.repository !== this.options.commonDir || realpathSync(this.options.commonDir) !== this.options.commonDir ||
          (await this.git.locate()).commonDir !== this.options.commonDir) throw new Error("Exact retained Git common-directory identity is unavailable.");
      const before = await this.git.inspect(plan);
      if (before.path !== "directory" || realpathSync(plan.path) !== plan.path || !before.workspace?.backlink || before.workspace.commonDir !== this.options.commonDir || before.workspace.branch !== plan.branch || before.branch !== before.workspace.commit || before.workspace.commit !== intent.identity.commit) {
        observation.ownership = "changed"; observation.evidence.push("Registered canonical path/backlink/branch or exact accepted source changed."); return observation;
      }
      observation.ownership = "exact";
      const identity = this.identity({ intent });
      observation.evidence.push(`exact-worktree:${JSON.stringify(identity)}`);
      this.needs({ intent, references, observation });
      if (this.removesPath({ intent, path: canonicalDestination({ path: this.options.evidenceRoot }) })) {
        observation.needs.reviewer = "needed"; observation.evidence.push("Independent cleanup receipts would be inside the target or its removable Git administrative directory; preserve them.");
      }
      const ancestry = await this.git.command({ args: ["merge-base", "--is-ancestor", intent.identity.commit, plan.parent] });
      const tree = await this.git.command({ args: ["rev-parse", "--verify", `${intent.identity.commit}^{tree}`] });
      observation.integration = ancestry.kind === "finished" && ancestry.code === 0 && tree.kind === "finished" && tree.code === 0 && tree.output.trim() === intent.identity.tree ? "integrated" : ancestry.kind === "finished" && ancestry.code === 1 ? "not-integrated" : "unknown";
      // --ignored protects evidence/build output that ordinary status (and Git remove) can omit.
      const statusArgs = ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"];
      const status = await this.git.command({ args: statusArgs, cwd: plan.path });
      observation.cleanliness = status.kind === "finished" && status.code === 0 ? status.output.length ? "dirty" : "clean" : "unknown";
      if (this.options.usage) {
        const usage = WorktreeUsage.parse(await this.options.usage({ intent, references }));
        observation.usage = usage.usage; observation.evidence.push(...usage.evidence);
        usage.evidence.forEach(text => this.preserveArtifact({ text, intent, observation }));
      } else observation.evidence.push("No complete native worktree usage reader configured; process/native settlement is unknown.");
      const finalStatus = await this.git.command({ args: statusArgs, cwd: plan.path });
      if (finalStatus.kind !== "finished" || finalStatus.code !== 0) observation.cleanliness = "unknown";
      else if (finalStatus.output.length) observation.cleanliness = "dirty";
      const indexVisibility = await this.git.command({ args: ["ls-files", "-v", "-z"], cwd: plan.path });
      if (indexVisibility.kind !== "finished" || indexVisibility.code !== 0 || indexVisibility.output.split("\0").some(entry => /^[a-zS] /.test(entry))) {
        observation.cleanliness = "unknown"; observation.evidence.push("Index assume-unchanged/skip-worktree flags or unavailable visibility can hide unpreserved content.");
      }
      if (!isDeepStrictEqual(before, await this.git.inspect(plan)) || !isDeepStrictEqual(identity, this.identity({ intent }))) { observation.ownership = "unknown"; observation.evidence.push("Git/filesystem association changed during observation."); }
    } catch (error) { observation.evidence.push(`Preserve unresolved worktree facts. ${String(error)}`); observation.ownership = "unknown"; }
    return observation;
  }
  private paths({ intent }: { intent: WorktreeCleanupIntent }) {
    const root = join(this.options.evidenceRoot, intent.id);
    return { root, dispatch: join(root, "dispatch.json"), receipt: join(root, "receipt.json") };
  }
  private binding({ intent }: { intent: WorktreeCleanupIntent }): Pick<WorktreeCleanupOutcome, "resource" | "operation" | "result" | "targetDigest"> {
    return { resource: "worktree", operation: intent.id, result: intent.result, targetDigest: cleanupTargetDigest({ intent }) };
  }
  async remove({ intent }: Parameters<WorktreeCleanupAdapter["remove"]>[0]): Promise<WorktreeCleanupOutcome> {
    // Compatibility boundary only. No permission, observation, dispatch or Git effect is entered.
    return retainedWorktree({ intent });
  }
  async reconcile({ intent }: Parameters<WorktreeCleanupAdapter["reconcile"]>[0]): Promise<WorktreeCleanupOutcome> {
    const paths = this.paths({ intent }), binding = this.binding({ intent });
    const unknown = (message: string): WorktreeCleanupOutcome => ({ ...binding, kind: "unknown", message, evidence: [paths.dispatch, paths.receipt] });
    try {
      if (!existsSync(paths.dispatch) || !existsSync(paths.receipt)) return unknown("Exact durable dispatch/receipt missing; path absence alone never confirms or permits replay.");
      const dispatch = Dispatch.parse(privateFile(paths.dispatch)), receipt = Receipt.parse(privateFile(paths.receipt));
      if (!isDeepStrictEqual(dispatch.intent, intent) || !isDeepStrictEqual(receipt.intent, intent) || dispatch.command !== commandFor({ intent, commonDir: this.options.commonDir }) || receipt.command !== dispatch.command || cleanupEligibility({ intent, observation: dispatch.observation }).kind !== "eligible") return unknown("Conflicting operation/target/command or ineligible dispatch evidence; preserve without replay.");
      if (receipt.outcome.kind !== "finished" || receipt.outcome.code !== 0) return unknown("No exact successful ordinary Git remove receipt; never replay an uncertain command.");
      if (!isDeepStrictEqual(dispatch.identity.common, stamp({ path: this.options.commonDir })) || (await this.git.locate()).commonDir !== this.options.commonDir) return unknown("Repository incarnation changed after removal.");
      // lstat (not exists) also catches a dangling symlink reused at the exact path.
      try { lstatSync(intent.target.plan.path); return unknown("Removed path is present/reused; preserve it without another remove."); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      if ((await this.git.locate()).worktrees.includes(intent.target.plan.path)) return unknown("Exact path remains registered despite the successful receipt.");
      return { ...binding, kind: "confirmed", evidence: [paths.dispatch, paths.receipt, "exact successful ordinary Git receipt with same-repository path and registration absence"] };
    } catch (error) { return unknown(`Unresolved cleanup evidence/postcondition; reconcile read-only. ${String(error)}`); }
  }
  private identity({ intent }: { intent: WorktreeCleanupIntent }) {
    const gitfile = join(intent.target.plan.path, ".git"), gitfileText = readFileSync(gitfile, "utf8");
    const administrative = stamp({ path: resolve(intent.target.plan.path, gitfileText.trim().slice("gitdir: ".length)) });
    return { common: stamp({ path: this.options.commonDir }), directory: stamp({ path: intent.target.plan.path }), administrative, gitfile: stamp({ path: gitfile }), gitfileText };
  }
  private removesPath({ intent, path }: { intent: WorktreeCleanupIntent; path: string }) {
    return [intent.target.plan.path, this.identity({ intent }).administrative.path].some(root => inside({ root, path }));
  }
  private preserveArtifact({ text, intent, observation, cwd = intent.target.plan.path }: { text: string; intent: WorktreeCleanupIntent; observation: WorktreeCleanupObservation; cwd?: string }) {
    // Journal fragments are local paths; opaque remote references remain with their native owner.
    const path = text.split("#")[0];
    if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return;
    const local = resolve(cwd, path);
    // Explicit relative paths keep filesystem meaning even when their leaf is missing; prose
    // diagnostics can contain slashes but are not implicitly paths without a ./ or ../ prefix.
    let localReference = isAbsolute(path) || path.startsWith(`.${sep}`) || path.startsWith(`..${sep}`) || path.includes(sep) && !/\s/.test(path);
    if (!localReference) {
      try { lstatSync(local); localReference = true; }
      catch (error) {
        // Long single-token diagnostics (e.g. native reflog receipts) cannot be local filenames.
        if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENAMETOOLONG" && !path.includes(sep)))) throw error;
      }
    }
    if (localReference && (this.removesPath({ intent, path: local }) || this.removesPath({ intent, path: canonicalDestination({ path: local }) }))) {
      observation.needs.reviewer = "needed"; observation.evidence.push(`Preserve referenced artifact at ${text}`);
    }
  }
  private needs({ intent, references, observation }: { intent: WorktreeCleanupIntent; references: CleanupReferences; observation: WorktreeCleanupObservation }) {
    const assignment = intent.identity.assignment;
    const accepted = references.launches.filter(launch => launch.reservation === assignment.reservation && launch.scope === assignment.scope && launch.state.kind === "reported" && launch.state.command === assignment.assignment && launch.state.worker.address.session === assignment.executor.session && launch.state.worker.address.generation === assignment.executor.generation && launch.state.report.outcome === "reported-result");
    if (accepted.length !== 1 || new Set(references.launches.map(launch => launch.id)).size !== references.launches.length || references.launches.some(launch => launch.reservation !== assignment.reservation || launch.scope !== assignment.scope || launch.startEvidence.kind !== "completed" || launch.state.kind === "held")) {
      observation.evidence.push("Complete exact accepted launch and retained reference inventory unavailable/held."); return;
    }
    observation.needs = { continuation: "clear", handoffReader: "clear", reviewer: "clear" };
    // Every retained actor must lead through the exact durable handoff chain to this accepted
    // executor. A completed handoff in a disconnected/cyclic chain is not completed continuation.
    const ancestors = new Set<string>();
    let cursor = accepted[0];
    while (cursor && !ancestors.has(cursor.id)) {
      ancestors.add(cursor.id);
      cursor = cursor.successor ? references.launches.find(launch => launch.id === cursor?.successor?.predecessor) : undefined;
    }
    if (cursor || ancestors.size !== references.launches.length || references.handoffs.length !== references.launches.length - 1) {
      observation.needs.continuation = "unknown"; observation.needs.handoffReader = "unknown";
      observation.evidence.push("Retained predecessor/successor inventory is disconnected, cyclic or incomplete.");
    }
    const artifact = (text: string) => this.preserveArtifact({ text, intent, observation });
    references.resultEvidence.forEach(({ reference, cwd }) => this.preserveArtifact({ text: reference, cwd, intent, observation }));
    artifact(intent.integration.intent.review.reference);
    intent.integration.intent.review.evidence.forEach(artifact);
    if (intent.integration.state.kind === "confirmed") intent.integration.state.evidence.forEach(artifact);
    for (const launch of references.launches) {
      const state = launch.state.kind === "held" ? launch.state.last : launch.state;
      if (!("worker" in state) || state.worker.resources.cwd !== intent.target.plan.path) { observation.needs.continuation = "unknown"; continue; }
      if ("application" in state) artifact(state.application);
      if (state.kind === "reported") {
        state.report.evidence.forEach(artifact);
        if (state.report.engineering) for (const engineering of [state.report.engineering, ...state.report.engineering.priorExceptions]) if (engineering.alternative.kind === "verified") artifact(engineering.alternative.evidence);
      }
      if ("initialization" in state) { artifact(state.initialization.modeEntry); artifact(state.initialization.settledEntry); }
      if (launch.id !== accepted[0]?.id && !references.handoffs.some(handoff => handoff.pin.launch === launch.id && handoff.state.kind === "successor-reserved")) observation.needs.continuation = "needed";
      if (launch.successor && !references.handoffs.some(handoff => handoff.id === launch.successor?.handoff && handoff.pin.launch === launch.successor.predecessor && handoff.state.kind === "successor-reserved" && handoff.state.launch === launch.id)) observation.needs.handoffReader = "unknown";
    }
    for (const handoff of references.handoffs) {
      const state = handoff.state.kind === "held" ? handoff.state.last : handoff.state;
      if ("receipt" in state) { artifact(state.receipt.artifact.path); state.receipt.effectEvidence.forEach(artifact); artifact(state.receipt.application); artifact(state.receipt.settledEntry); }
      if (handoff.pin.reservation !== assignment.reservation || !references.launches.some(launch => launch.id === handoff.pin.launch) || handoff.state.kind !== "successor-reserved" || state.kind !== "successor-reserved" || !references.launches.some(launch => launch.id === state.launch && launch.successor?.handoff === handoff.id)) {
        observation.needs.continuation = "needed"; observation.needs.handoffReader = "needed";
      }
    }
  }
}
