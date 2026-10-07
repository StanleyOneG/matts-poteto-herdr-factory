import { z } from "zod";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

export const WorkspacePlan = z.object({
  branch: z.string(),
  path: z.string(),
  parent: z.string(),
  commit: z.string(),
});
export type WorkspacePlan = z.infer<typeof WorkspacePlan>;
export type RepositoryLocation = { commonDir: string; worktrees: string[] };
export type WorkspaceObservation = {
  branch: string | null;
  path: "absent" | "directory" | "occupied" | "symlink";
  workspace: null | {
    commonDir: string;
    branch: string;
    commit: string;
    backlink: boolean;
  };
  parent: string | null;
};
export type GitOutcome =
  | { kind: "succeeded" }
  | { kind: "failed"; message: string; noEffect: boolean }
  | { kind: "unknown"; message: string };
export type CommandOutcome =
  | { kind: "finished"; code: number; output: string }
  | { kind: "unknown"; message: string };
export type GuardedCommand = (command: string) => Promise<CommandOutcome>;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export class GitWorkspace implements WorkspaceRepository {
  private identity: { commonDir: string; dev: number; ino: number } | null =
    null;
  constructor(
    private cwd: string,
    private run: GuardedCommand,
  ) {}
  private check() {
    if (!this.identity) return;
    const stat = statSync(this.identity.commonDir);
    if (stat.dev !== this.identity.dev || stat.ino !== this.identity.ino)
      throw new Error(
        "Git common directory was replaced. Preserve resources and stop.",
      );
  }
  private async git(args: string[], cwd = this.cwd): Promise<CommandOutcome> {
    this.check();
    const result = await this.run(
      ["git", "-C", cwd, ...args].map(quote).join(" "),
    );
    this.check();
    return result;
  }
  private async text(args: string[], cwd = this.cwd): Promise<string> {
    const result = await this.git(args, cwd);
    if (result.kind !== "finished" || result.code !== 0)
      throw new Error(
        `Guarded Git observation unavailable. ${result.kind === "unknown" ? result.message : result.output}`,
      );
    return result.output.trim();
  }
  async locate(): Promise<RepositoryLocation> {
    const commonDir = realpathSync(
      await this.text([
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
    );
    const stat = statSync(commonDir);
    if (this.identity && this.identity.commonDir !== commonDir)
      throw new Error("Git repository identity changed.");
    this.identity ??= { commonDir, dev: stat.dev, ino: stat.ino };
    const records = (
      await this.text(["worktree", "list", "--porcelain", "-z"])
    ).split("\0");
    const worktrees = records
      .filter((record) => record.startsWith("worktree "))
      .map((record) => record.slice(9));
    return { commonDir, worktrees };
  }
  async parent(ref: string): Promise<string> {
    if (!ref.startsWith("refs/heads/"))
      throw new Error("Select an explicit full local branch ref.");
    await this.text(["check-ref-format", ref]);
    await this.text(["show-ref", "--verify", ref]);
    const commit = await this.text([
      "rev-parse",
      "--verify",
      `${ref}^{commit}`,
    ]);
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))
      throw new Error("Parent commit is unavailable or ambiguous.");
    return commit;
  }
  async inspect(plan: WorkspacePlan): Promise<WorkspaceObservation> {
    const location = await this.locate();
    const branchResult = await this.git([
      "show-ref",
      "--verify",
      "--quiet",
      plan.branch,
    ]);
    if (
      branchResult.kind !== "finished" ||
      (branchResult.code !== 0 && branchResult.code !== 1)
    )
      throw new Error("Planned branch observation unavailable.");
    const symbolic = await this.git(["symbolic-ref", "-q", plan.branch]);
    if (
      symbolic.kind !== "finished" ||
      (symbolic.code !== 0 && symbolic.code !== 1)
    )
      throw new Error("Planned ref association unavailable.");
    const branch =
      symbolic.code === 0
        ? `symbolic:${symbolic.output.trim()}`
        : branchResult.code === 0
          ? await this.text(["rev-parse", "--verify", plan.branch])
          : null;
    let path: WorkspaceObservation["path"] = "absent";
    try {
      const stat = lstatSync(plan.path);
      path = stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "directory"
          : "occupied";
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    let ancestor = plan.path;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (
      join(realpathSync(ancestor), relative(ancestor, plan.path)) !== plan.path
    )
      path = "symlink";
    const registration = (
      await this.text(["worktree", "list", "--porcelain", "-z"])
    )
      .split("\0")
      .some((record) => record === `worktree ${plan.path}`);
    let workspace: WorkspaceObservation["workspace"] = null;
    if (registration && path === "directory") {
      const gitdir = await this.text(
        ["rev-parse", "--path-format=absolute", "--git-dir"],
        plan.path,
      );
      const commonDir = realpathSync(
        await this.text(
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          plan.path,
        ),
      );
      let backlink = false;
      try {
        const gitfile = readFileSync(join(plan.path, ".git"), "utf8").trim();
        backlink =
          gitfile.startsWith("gitdir: ") &&
          realpathSync(resolve(plan.path, gitfile.slice(8))) ===
            realpathSync(gitdir) &&
          realpathSync(readFileSync(join(gitdir, "gitdir"), "utf8").trim()) ===
            realpathSync(join(plan.path, ".git"));
      } catch {}
      workspace = {
        commonDir,
        branch: await this.text(["symbolic-ref", "HEAD"], plan.path),
        commit: await this.text(["rev-parse", "HEAD"], plan.path),
        backlink,
      };
    }
    const parentResult = await this.git([
      "show-ref",
      "--verify",
      "--quiet",
      plan.parent,
    ]);
    if (
      parentResult.kind !== "finished" ||
      (parentResult.code !== 0 && parentResult.code !== 1)
    )
      throw new Error("Current parent observation unavailable.");
    const parent =
      parentResult.code === 0
        ? await this.text(["rev-parse", "--verify", plan.parent])
        : null;
    return { branch, path, workspace, parent };
  }
  private async effect(args: string[]): Promise<GitOutcome> {
    const result = await this.git(args);
    if (result.kind === "unknown") return result;
    return result.code === 0
      ? { kind: "succeeded" }
      : {
          kind: "failed",
          message: result.output || `Git exited with code ${result.code}.`,
          noEffect: true,
        };
  }
  createBranch(plan: WorkspacePlan) {
    return this.effect(["update-ref", plan.branch, plan.commit, ""]);
  }
  createWorktree(plan: WorkspacePlan) {
    return this.effect([
      "worktree",
      "add",
      "--",
      plan.path,
      plan.branch.slice("refs/heads/".length),
    ]);
  }
}
export interface WorkspaceRepository {
  locate(): Promise<RepositoryLocation>;
  parent(ref: string): Promise<string>;
  inspect(plan: WorkspacePlan): Promise<WorkspaceObservation>;
  createBranch(plan: WorkspacePlan): Promise<GitOutcome>;
  createWorktree(plan: WorkspacePlan): Promise<GitOutcome>;
}
