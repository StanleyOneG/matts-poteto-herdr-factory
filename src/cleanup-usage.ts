import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { relative, isAbsolute, sep, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorktreeUsageReader } from "./worktree-cleanup.js";
import { TabCleanupIntent, type CleanupRecord, type TabCleanupAdapter, type WorktreeCleanupIntent } from "./cleanup-domain.js";
import type { ResumeResourceReader } from "./resume.js";

const inside = ({ root, path }: { root: string; path: string }) => {
  const delta = relative(root, path.replace(/ \(deleted\)$/, ""));
  return delta === "" || delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
};
function processStamp({ pid }: { pid: string }) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}
function localUsage({ intent }: { intent: WorktreeCleanupIntent }) {
  const evidence: string[] = [], held: string[] = [];
  let used = false;
  if (process.platform !== "linux") return { usage: "unknown" as const, evidence: ["Complete actual worktree use requires Linux /proc."] };
  const roots = [intent.target.plan.path];
  try {
    const gitfile = readFileSync(join(intent.target.plan.path, ".git"), "utf8");
    const administrative = /^gitdir: (.+)\n?$/.exec(gitfile)?.[1];
    if (!administrative) throw new Error("Exact removable Git administrative directory is unavailable.");
    roots.push(realpathSync(resolve(intent.target.plan.path, administrative)));
  } catch (error) { held.push(`Removable Git administrative usage visibility incomplete: ${String(error)}`); }
  const inspect = ({ pid, path }: { pid: string; path: string }) => {
    if (roots.some(root => inside({ root, path }))) { used = true; evidence.push(`Actual process ${pid} uses target: ${path}`); }
  };
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    try {
      const before = processStamp({ pid });
      // cwd/root, executable, mapped files and all descriptors are independent native uses.
      for (const name of ["cwd", "root", "exe"]) inspect({ pid, path: readlinkSync(`/proc/${pid}/${name}`) });
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try { inspect({ pid, path: readlinkSync(`/proc/${pid}/fd/${fd}`) }); }
        catch (error) { held.push(`Process ${pid} descriptor ${fd} changed/unreadable: ${String(error)}`); }
      }
      for (const line of readFileSync(`/proc/${pid}/maps`, "utf8").split("\n")) {
        const path = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\/.*)$/.exec(line)?.[1];
        if (path) inspect({ pid, path });
      }
      if (!before || processStamp({ pid }) !== before) held.push(`Process ${pid} incarnation changed during usage inspection.`);
    } catch (error) { held.push(`Process ${pid} cwd/fd/filesystem visibility incomplete: ${String(error)}`); }
  }
  evidence.push(...held);
  if (!evidence.length) evidence.push("Fresh complete /proc filesystem-use census found no target references.");
  return { usage: used ? "in-use" as const : held.length ? "unknown" as const : "unused" as const, evidence };
}

/** Native usage is composed with exact retained lifecycle evidence for EVERY actor. Confirmed
 * close receipts can settle closed workers; death/absence and acceptance alone never do. */
export function worktreeUsage({ resources, tabs, records }: {
  resources: ResumeResourceReader; tabs: TabCleanupAdapter; records: () => CleanupRecord[];
}): WorktreeUsageReader {
  return async ({ intent, references }) => {
    const local = localUsage({ intent }), evidence = [...local.evidence];
    let unknown = local.usage === "unknown", active = local.usage === "in-use";
    for (const launch of references.launches) {
      const progress = launch.state.kind === "held" ? launch.state.last : launch.state;
      const closed = records().find(record => record.intent.target.kind === "tab" && "worker" in progress &&
        isDeepStrictEqual(record.intent.target.address, progress.worker.address) && record.state.kind === "confirmed");
      if (closed?.intent.target.kind === "tab") {
        const result = await tabs.reconcile({ intent: TabCleanupIntent.parse(closed.intent) });
        evidence.push(...result.evidence);
        if (result.kind === "confirmed") { evidence.push(`Exact confirmed settled native close for retained launch ${launch.id}.`); continue; }
      }
      const observed = await resources.observeResources({ launch, cwd: intent.target.plan.path, signal: new AbortController().signal });
      evidence.push(...observed.evidence, ...observed.reasons);
      if (observed.launch !== launch.id || observed.reservation !== launch.reservation || observed.scope !== launch.scope || observed.disposition !== "settled") {
        unknown = true; evidence.push(`Retained launch ${launch.id} lacks complete exact native principal/child/effect settlement; death or absence cannot settle it.`);
      }
      if (observed.live.kind === "observed" && (observed.live.value.busy || observed.live.value.childrenOutstanding || observed.live.value.effectsOutstanding)) active = true;
    }
    if (!references.launches.length) { unknown = true; evidence.push("No complete retained actor inventory."); }
    return { usage: active ? "in-use" : unknown ? "unknown" : "unused", evidence };
  };
}
