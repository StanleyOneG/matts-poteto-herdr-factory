import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AssignmentLedger, persistentRoot, sharedIdentity, type Reservation } from "./assignments.js";
import { GitWorkspace, type GuardedCommand } from "./git-workspace.js";
import { LegatusId, TaskRef } from "./snapshot.js";

export function verifyCenturioWorkspace(reservation: Reservation, parentCwd: string) {
  const plan = reservation.plan;
  if (realpathSync(plan.path) !== plan.path) throw new Error("Retained child workspace path changed.");
  const gitfile = readFileSync(join(plan.path, ".git"), "utf8").trim();
  if (!gitfile.startsWith("gitdir: ")) throw new Error("Retained child is no longer a linked Git worktree.");
  const gitdir = realpathSync(resolve(plan.path, gitfile.slice(8)));
  const parentGit = join(parentCwd, ".git");
  const parentDir = statSync(parentGit).isDirectory() ? realpathSync(parentGit) : realpathSync(resolve(parentCwd, readFileSync(parentGit, "utf8").trim().slice(8)));
  const parentCommon = statSync(parentGit).isDirectory() ? parentDir : realpathSync(resolve(parentDir, readFileSync(join(parentDir, "commondir"), "utf8").trim()));
  if (readFileSync(join(gitdir, "HEAD"), "utf8").trim() !== `ref: ${plan.branch}` || realpathSync(readFileSync(join(gitdir, "gitdir"), "utf8").trim()) !== realpathSync(join(plan.path, ".git")) || realpathSync(resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim())) !== parentCommon) throw new Error("Retained child branch or Git backlink changed.");
}

export class CenturioAllocationHeld extends Error {
  constructor(readonly reservation: Reservation, message: string) { super(message); }
}

/** Allocation uses the existing durable ledger; an unresolved operation is never replayed here. */
export async function prepareCenturioWorkspace(input: {
  id: string; cwd: string; owner: string; scope: string; baseRef: string; baseCommit: string;
  run: GuardedCommand; current: () => boolean;
}): Promise<Reservation> {
  const git = new GitWorkspace(input.cwd, input.run);
  const location = await git.locate();
  const parentBranch = await input.run(`git -C '${input.cwd.replaceAll("'", "'\\''")}' symbolic-ref HEAD`);
  if (parentBranch.kind !== "finished" || parentBranch.code !== 0 || parentBranch.output.trim() !== input.baseRef) throw new Error("Child base must be the exact current parent task branch. Committed parent changes cannot be silently omitted.");
  const commit = await git.parent(input.baseRef);
  if (commit !== input.baseCommit) throw new Error("Child base ref changed. Supply the exact current committed task base.");
  const clean = await input.run(`git -C '${input.cwd.replaceAll("'", "'\\''")}' status --porcelain=v1 --untracked-files=all`);
  if (clean.kind !== "finished" || clean.code !== 0 || clean.output.trim()) throw new Error("Writable child preparation requires an explicitly committed clean task base. Dirty parent work is not copied or silently omitted.");
  const task = TaskRef.parse({ id: input.id, revision: 1 });
  const ledger = new AssignmentLedger(location.commonDir);
  const plan = { branch: `refs/heads/legion/centurio-${input.id}`, path: `${persistentRoot(undefined, location)}/centurio-${input.id}`, parent: input.baseRef, commit };
  const { receipt } = await ledger.reserve({ owner: LegatusId.parse(input.owner), task, scope: input.scope,
    shared: sharedIdentity(task.id, null), request: input.id, fingerprint: JSON.stringify({ parentCwd: input.cwd, plan, scope: input.scope }), plan, owned: input.current });
  const reservation = receipt.reservation;
  try {
  for (const step of ["branch", "worktree"] as const) {
    const operation = await ledger.dispatch(reservation, step, input.current);
    if (!operation) throw new CenturioAllocationHeld(reservation, "Child allocation already dispatched or held. Preserve its claim; do not retry.");
    let outcome;
    try { outcome = await (step === "branch" ? git.createBranch(plan) : git.createWorktree(plan)); }
    catch (error) { outcome = { kind: "unknown" as const, message: String(error) }; }
    await ledger.complete(operation, outcome);
    if (outcome.kind !== "succeeded") throw new CenturioAllocationHeld(reservation, `Child allocation ${operation.id} is retained: ${JSON.stringify(outcome)}. No duplicate allocation or cleanup.`);
  }
  const observed = await git.inspect(plan);
  if (!observed.workspace?.backlink || observed.workspace.commonDir !== location.commonDir || observed.workspace.branch !== plan.branch || observed.workspace.commit !== plan.commit || observed.parent !== commit)
    throw new CenturioAllocationHeld(reservation, "Allocated child workspace does not join its exact branch, committed base and parent. Preserve the claim.");
  return reservation;
  } catch (error) {
    if (error instanceof CenturioAllocationHeld) throw error;
    throw new CenturioAllocationHeld(reservation, `Child allocation outcome is unresolved. Preserve this claim. ${String(error)}`);
  }
}
