import { existsSync, readFileSync, realpathSync } from "node:fs";
import { z } from "zod";
import { GitWorkspace, type GuardedCommand } from "./git-workspace.js";
import { CandidateObservation, GitObjectId, ResultWorkspace, IntegrationIntent, type IntegrationOutcome, type ResultRepository } from "./result-domain.js";

const quote = ({ value }: { value: string }) => `'${value.replaceAll("'", "'\\''")}'`;
const command = ({ cwd, args }: { cwd: string; args: string[] }) => ["git", "--no-replace-objects", "--no-optional-locks", "-C", cwd, ...args].map(value => quote({ value })).join(" ");
const marker = ({ intent }: { intent: IntegrationIntent }) => `legion-integrate:${intent.id}:${intent.result.digest}`;

/** Fast-forward only, through ordinary guarded Bash. Owning Legion serializes calls; this is not a cross-run lock. */
export class GitIntegration implements ResultRepository {
  private git: GitWorkspace;
  constructor(private options: { cwd: string; run: GuardedCommand }) {
    this.git = new GitWorkspace(options.cwd, options.run);
  }
  private async text({ args, cwd = this.options.cwd }: { args: string[]; cwd?: string }): Promise<string> {
    const result = await this.git.command({ args: ["--no-replace-objects", "--no-optional-locks", ...args], cwd });
    if (result.kind !== "finished" || result.code !== 0)
      throw new Error(`Git observation unavailable: ${result.kind === "unknown" ? result.message : result.output}`);
    return result.output.trim();
  }
  private async inspect({ workspace }: { workspace: z.infer<typeof ResultWorkspace> }) {
    if (realpathSync(workspace.repository) !== workspace.repository || (await this.git.locate()).commonDir !== workspace.repository)
      throw new Error("Actual repository differs from the pinned common directory.");
    const plan = { path: workspace.path, branch: workspace.branch, parent: workspace.parent, commit: "" };
    const observation = await this.git.observeResources({ plan, commonDir: workspace.repository });
    if (observation.disposition !== "identified" || observation.dirty.kind !== "observed" || observation.dirty.value || !observation.association?.workspace)
      throw new Error(`Source branch/worktree must be exactly associated and clean, including index and untracked files. ${observation.reasons.join(" ")}`);
    await this.settled({ cwd: workspace.path });
    await this.visibleIndex({ cwd: workspace.path });
    if (await this.text({ args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], cwd: workspace.path }))
      throw new Error("Source must also be clean without Git replacement objects.");
    const commit = GitObjectId.parse(observation.association.workspace.commit);
    const tree = GitObjectId.parse(await this.text({ args: ["rev-parse", "--verify", `${commit}^{tree}`] }));
    const parentCommit = GitObjectId.parse(await this.git.parent(workspace.parent));
    if (observation.association.branch !== commit || observation.association.parent !== parentCommit)
      throw new Error("Source or parent changed during observation.");
    const parentSymbolic = await this.git.command({ args: ["symbolic-ref", "-q", workspace.parent] });
    if (parentSymbolic.kind !== "finished" || parentSymbolic.code !== 1)
      throw new Error("Intended parent must be a direct local branch, not a symbolic ref.");
    return { commit, tree, parentCommit };
  }
  async observe({ workspace: raw }: Parameters<ResultRepository["observe"]>[0]): Promise<z.infer<typeof CandidateObservation>> {
    try {
      const workspace = ResultWorkspace.parse(raw);
      const first = await this.inspect({ workspace }), second = await this.inspect({ workspace });
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Git state changed during capture.");
      return { kind: "clean", ...first, evidence: [`repository=${workspace.repository}; worktree=${workspace.path}; branch=${workspace.branch}; commit=${first.commit}; tree=${first.tree}; parent=${workspace.parent}@${first.parentCommit}; tracked/index/untracked clean`] };
    } catch (error) { return { kind: "held", message: String(error), evidence: ["Read-only candidate observation refused; no content staged or committed."] }; }
  }
  private async parentCheckout({ intent }: { intent: IntegrationIntent }) {
    const { workspace, parent } = intent.identity;
    if (parent.ref !== workspace.parent || parent.ref === workspace.branch) throw new Error("Parent must match its pin and differ from the source branch.");
    if (!workspace.parentPath || workspace.parentPath !== realpathSync(this.options.cwd) || realpathSync(workspace.parentPath) !== workspace.parentPath || workspace.parentPath === workspace.path)
      throw new Error("Integration requires the pinned owning parent checkout, without adoption or relocation.");
    if (["refs/heads/main", "refs/heads/master"].includes(parent.ref)) throw new Error("Primary/main branch integration requires separate authority.");
    const defaults = await this.text({ args: ["for-each-ref", "--format=%(symref)", "refs/remotes/"] });
    if (defaults.split("\n").some(ref => ref && parent.ref === `refs/heads/${ref.split("/").slice(3).join("/")}`))
      throw new Error("Configured primary branch integration requires separate authority.");
    const cwd = workspace.parentPath;
    if (await this.text({ args: ["rev-parse", "--show-toplevel"], cwd }) !== cwd ||
        realpathSync(await this.text({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd })) !== workspace.repository ||
        await this.text({ args: ["symbolic-ref", "HEAD"], cwd }) !== parent.ref)
      throw new Error("Owning checkout is not on the pinned intended parent branch. Preserve unrelated checkouts.");
    await this.visibleIndex({ cwd });
    if (await this.text({ args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], cwd }))
      throw new Error("Parent checkout must be clean, including index and untracked files. Preserve dirty work.");
    await this.settled({ cwd });
  }
  private async visibleIndex({ cwd }: { cwd: string }) {
    const entries = await this.text({ args: ["ls-files", "-v", "-z"], cwd });
    if (entries.split("\0").some(entry => /^[a-zS] /.test(entry)))
      throw new Error("Assume-unchanged/skip-worktree index flags obscure cleanliness. Preserve work without refreshing or rewriting the index.");
  }
  private async settled({ cwd }: { cwd: string }) {
    for (const state of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
      const path = await this.text({ args: ["rev-parse", "--path-format=absolute", "--git-path", state], cwd });
      // Git status can be clean during an unfinished operation; it is still not an integration grant.
      if (existsSync(path)) throw new Error(`Checkout has unfinished Git state: ${state}.`);
    }
  }
  private async ancestry({ intent }: { intent: IntegrationIntent }) {
    const result = await this.git.command({ args: ["--no-replace-objects", "merge-base", "--is-ancestor", intent.identity.parent.commit, intent.identity.commit] });
    if (result.kind !== "finished" || result.code !== 0) throw new Error("Divergent/conflicting parent is held. Resolve separately, then capture/check/review a new clean committed candidate.");
  }
  private async reflog({ intent }: { intent: IntegrationIntent }) {
    const path = await this.text({ args: ["rev-parse", "--path-format=absolute", "--git-path", `logs/${intent.identity.parent.ref}`] });
    try { return readFileSync(path, "utf8").split("\n").filter(line => line.includes(`\t${marker({ intent })}:`)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
  private binding({ intent }: { intent: IntegrationIntent }) { return { operation: intent.id, result: intent.result }; }
  private confirmed({ intent, evidence }: { intent: IntegrationIntent; evidence: string[] }): IntegrationOutcome {
    return { ...this.binding({ intent }), kind: "confirmed", source: { commit: intent.identity.commit, tree: intent.identity.tree },
      parent: { ref: intent.identity.parent.ref, before: intent.identity.parent.commit, after: intent.identity.commit, tree: intent.identity.tree }, evidence };
  }
  async reconcile({ intent: raw }: Parameters<ResultRepository["reconcile"]>[0]): Promise<IntegrationOutcome> {
    const intent = IntegrationIntent.parse(raw);
    try {
      await this.parentCheckout({ intent });
      const state = await this.inspect({ workspace: intent.identity.workspace });
      if (state.commit !== intent.identity.commit || state.tree !== intent.identity.tree || state.parentCommit !== intent.identity.commit)
        throw new Error("Exact source and resulting parent commit/tree are not established.");
      await this.ancestry({ intent });
      const lines = await this.reflog({ intent });
      if (intent.identity.parent.commit !== intent.identity.commit && (lines.length !== 1 || !lines[0]?.startsWith(`${intent.identity.parent.commit} ${intent.identity.commit} `)))
        throw new Error("Operation-bound exact parent reflog transition is missing or ambiguous.");
      const again = await this.inspect({ workspace: intent.identity.workspace });
      await this.parentCheckout({ intent });
      if (JSON.stringify(state) !== JSON.stringify(again)) throw new Error("Git changed during reconciliation.");
      return this.confirmed({ intent, evidence: [`Read-only exact source/parent/tree/ancestry and clean owning checkout confirmed; ${marker({ intent })}`, ...lines] });
    } catch (error) {
      // Ref equality or missing reflog alone cannot prove an unknown command never ran (or has settled).
      return { ...this.binding({ intent }), kind: "unknown", message: String(error), evidence: ["Read-only reconciliation; no effect, retry, reset or conflict resolution performed. Absence is not proof of no effect."] };
    }
  }
  private effectCommand({ intent }: { intent: IntegrationIntent }) {
    const { workspace, parent, commit, tree } = intent.identity;
    const equal = ({ cwd, args, expected }: { cwd: string; args: string[]; expected: string }) => `_legion_observed=$(${command({ cwd, args })})\ntest "$_legion_observed" = ${quote({ value: expected })}`;
    const clean = ({ cwd }: { cwd: string }) => [equal({ cwd, args: ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"], expected: "" }),
      `${command({ cwd, args: ["ls-files", "-v", "-z"] })} | while IFS= read -r -d '' entry; do case "$entry" in [a-zS]' '*) exit 1;; esac; done`].join("\n");
    return ["set -euo pipefail",
      equal({ cwd: workspace.path, args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], expected: workspace.repository }),
      equal({ cwd: workspace.path, args: ["rev-parse", "--show-toplevel"], expected: workspace.path }),
      equal({ cwd: this.options.cwd, args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], expected: workspace.repository }),
      equal({ cwd: this.options.cwd, args: ["rev-parse", "--show-toplevel"], expected: workspace.parentPath ?? "" }),
      equal({ cwd: workspace.path, args: ["symbolic-ref", "HEAD"], expected: workspace.branch }),
      equal({ cwd: workspace.path, args: ["rev-parse", "HEAD"], expected: commit }), equal({ cwd: workspace.path, args: ["rev-parse", "HEAD^{tree}"], expected: tree }), clean({ cwd: workspace.path }),
      equal({ cwd: this.options.cwd, args: ["symbolic-ref", "HEAD"], expected: parent.ref }), equal({ cwd: this.options.cwd, args: ["rev-parse", "HEAD"], expected: parent.commit }), clean({ cwd: this.options.cwd }),
      command({ cwd: this.options.cwd, args: ["merge-base", "--is-ancestor", parent.commit, commit] }),
      `GIT_REFLOG_ACTION=${quote({ value: marker({ intent }) })} ${command({ cwd: this.options.cwd, args: ["-c", "core.logAllRefUpdates=true", "-c", "merge.autostash=false", "merge", "--ff-only", "--no-squash", "--no-commit", "--no-autostash", "--no-edit", "--no-stat", "--no-overwrite-ignore", commit] })}`].join("\n");
  }
  async integrate({ intent: raw, assertAuthority }: Parameters<ResultRepository["integrate"]>[0]): Promise<IntegrationOutcome> {
    const intent = IntegrationIntent.parse(raw);
    let submitted = false, historyObserved = false;
    try {
      if ((await this.git.locate()).commonDir !== intent.identity.workspace.repository) throw new Error("Actual repository differs from the operation pin.");
      if ((await this.reflog({ intent })).length) return this.reconcile({ intent });
      historyObserved = true;
      await this.parentCheckout({ intent });
      const state = await this.inspect({ workspace: intent.identity.workspace });
      if (state.commit !== intent.identity.commit || state.tree !== intent.identity.tree || state.parentCommit !== intent.identity.parent.commit)
        throw new Error("Source or intended parent moved since review; capture/check/review the new identity.");
      await this.ancestry({ intent });
      if (state.commit === state.parentCommit) return this.reconcile({ intent });
      await this.git.locate();
      const effect = this.effectCommand({ intent });
      await assertAuthority();
      // No observation/await between fresh core authority and the ordinary permission-controlled effect.
      submitted = true;
      const receipt = await this.options.run(effect);
      await this.git.locate();
      const observed = await this.reconcile({ intent });
      if (receipt.kind === "unknown") return { ...this.binding({ intent }), kind: "unknown", message: receipt.message, evidence: ["Guarded Git acknowledgment lost; reconcile original operation read-only before any retry."] };
      if (receipt.code !== 0) return { ...this.binding({ intent }), kind: "unknown", message: `Guarded Git exited ${receipt.code}: ${receipt.output}`, evidence: observed.evidence };
      return observed;
    } catch (error) {
      if (submitted || !historyObserved) return { ...this.binding({ intent }), kind: "unknown", message: String(error), evidence: ["Effect/history could not be established. Preserve the original operation for read-only reconciliation."] };
      return { ...this.binding({ intent }), kind: "failed", noEffect: true, message: String(error), evidence: ["Integration preconditions/authority refused before guarded effect submission."] };
    }
  }
}
