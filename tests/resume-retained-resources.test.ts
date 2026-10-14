import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { SnapshotSchema } from "../src/snapshot.js";
import { Reservation, WorkspaceState } from "../src/assignments.js";

const View = z.object({ mode: z.enum(["inactive", "active", "stopping"]), snapshot: SnapshotSchema.nullable(), tasks: z.array(z.object({ claim: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owned"), reservation: Reservation, workspace: WorkspaceState }),
  z.object({ kind: z.literal("unreserved") }), z.object({ kind: z.literal("foreign"), reservation: Reservation }), z.object({ kind: z.literal("unavailable"), message: z.string() }),
]) })) });
const ControllerResult = z.object({ initial: View, result: z.object({ kind: z.string(), code: z.string().optional(), message: z.string().optional() }), view: View, commands: z.array(z.string()) });
const PendingEffect = z.object({ kind: z.literal("effect-dispatched"), command: z.string(), view: View });

const execute = promisify(execFile);
const workerPath = fileURLToPath(new URL("./resume-retained-worker.ts", import.meta.url));
async function fixture() {
  const root = await mkdtemp(join(process.env.RESUME_TEST_EVIDENCE ?? tmpdir(), "retained-")), cwd = join(root, "repo");
  const git = async (path: string, ...args: string[]) => (await execute("git", ["-C", path, ...args])).stdout.trim();
  await execute("git", ["init", "-q", "-b", "main", cwd]);
  await git(cwd, "config", "user.name", "Resume fixture"); await git(cwd, "config", "user.email", "resume@example.invalid");
  await writeFile(join(cwd, "tracked"), "base\n"); await git(cwd, "add", "."); await git(cwd, "commit", "-qm", "base");
  const unrelated = join(root, "unrelated"); await git(cwd, "worktree", "add", "-qb", "unrelated", unrelated);
  await writeFile(join(unrelated, "tracked"), "unrelated dirty\n"); await writeFile(join(unrelated, "sentinel"), "unrelated retain\n");
  return { root, cwd, git, unrelated };
}
function launch(args: { root: string; cwd: string; session: string; mode: string; run?: string }) {
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, JSON.stringify({ root: args.root, cwd: args.cwd, session: args.session, mode: args.mode, ...(args.run ? { run: args.run } : {}) })], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  return { child, closed, output: () => stdout, errors: () => stderr };
}
async function run(args: Parameters<typeof launch>[0]) {
  const process = launch(args), exit = await process.closed;
  assert.deepEqual(exit, { code: 0, signal: null }, process.errors());
  const result = ControllerResult.parse(JSON.parse(process.output()));
  await writeFile(join(args.root, `${args.session}.json`), JSON.stringify({ ...result, exit }, null, 2));
  return result;
}
async function identity(pid: number) {
  const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return { pid, boot, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
}
async function waitFor(check: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 30000; // Test observation bound; never signals or establishes settlement.
  while (!(await check())) { if (Date.now() >= deadline) throw new Error(`Missing ${label}; preserve owned resource`); await delay(10); }
}
async function bytes(path: string, git: Awaited<ReturnType<typeof fixture>>["git"]) {
  const index = await git(path, "rev-parse", "--path-format=absolute", "--git-path", "index");
  return { index: (await readFile(index)).toString("base64"), tracked: await readFile(join(path, "tracked"), "utf8"), sentinel: await readFile(join(path, "sentinel"), "utf8"), head: await git(path, "rev-parse", "HEAD"), branch: await git(path, "symbolic-ref", "HEAD"), registration: await readFile(join(path, ".git"), "utf8") };
}

test("explicit fresh resume after actual controller exit preserves tracked/untracked/index/later commit and unrelated worktree", async () => {
  const f = await fixture(), seeded = await run({ ...f, session: "old", mode: "reserve" });
  assert.equal(seeded.result.kind, "reserved");
  const snapshot = seeded.view.snapshot, claim = seeded.view.tasks[0]?.claim;
  assert.ok(snapshot && claim?.kind === "owned");
  const path = claim.reservation.plan.path;
  await writeFile(join(path, "tracked"), "later legitimate commit\n"); await f.git(path, "commit", "-qam", "later legitimate work");
  const later = await f.git(path, "rev-parse", "HEAD"); assert.notEqual(later, claim.reservation.plan.commit);
  await writeFile(join(path, "tracked"), "staged edit\n"); await f.git(path, "add", "tracked");
  await writeFile(join(path, "tracked"), "unstaged edit after staging\n"); await writeFile(join(path, "sentinel"), "owned untracked retain\n");
  const before = await bytes(path, f.git), unrelatedBefore = await bytes(f.unrelated, f.git);
  for (const session of ["fresh", "fresh-again"]) {
    const resumed = await run({ ...f, session, mode: "resume", run: snapshot.id });
    assert.equal(resumed.initial.snapshot, null, "Ordinary fresh startup stays inactive"); assert.equal(resumed.initial.mode, "inactive");
    assert.equal(resumed.result.kind, "applied", resumed.result.message); assert.equal(resumed.view.mode, "active");
    assert.deepEqual(resumed.view.snapshot?.tasks, snapshot.tasks); assert.deepEqual(resumed.view.snapshot?.submissions, snapshot.submissions);
    assert.deepEqual(resumed.view.tasks[0]?.claim, claim, "Original reservation and parent pin, no adoption/reset");
    assert.ok(resumed.commands.some(command => command.includes("--no-optional-locks") && command.includes("status")), "Production Git resource reader ran");
    assert.ok(resumed.commands.every(command => !/update-ref|worktree.*add|reset|checkout|clean/.test(command)), "Resume performs no Git mutation");
    assert.deepEqual(await bytes(path, f.git), before); assert.deepEqual(await bytes(f.unrelated, f.git), unrelatedBefore);
  }
  await writeFile(join(f.root, "preservation.json"), JSON.stringify({ before, unrelatedBefore, pinnedParent: claim.reservation.plan.commit, later }, null, 2));
  console.log(`Retained #35 dirty-work evidence: ${f.root}`);
});

test("surviving exact gated Git process after controller exit blocks explicit resume before and after real effect exit without duplicate execution", async () => {
  const f = await fixture(), gate = join(f.root, "effect.fifo"); await execute("mkfifo", [gate]);
  const controller = launch({ ...f, session: "old", mode: "interrupt" });
  let effect: ChildProcess | undefined, closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined, released = false;
  try {
    await waitFor(() => controller.output().includes("\n"), "durable effect dispatch");
    const pending = PendingEffect.parse(JSON.parse(controller.output()));
    assert.equal(pending.kind, "effect-dispatched");
    const snapshot = pending.view.snapshot, claim = pending.view.tasks[0]?.claim;
    assert.ok(snapshot && claim?.kind === "owned"); assert.equal(claim.workspace.kind, "dispatched");
    effect = spawn("bash", ["-c", `printf 'entered\\n' >> "$2"; read -r release < "$1"; ${pending.command}; rc=$?; printf '%s\\n' "$rc" > "$3"; exit "$rc"`, "owned-effect", gate, join(f.root, "entries"), join(f.root, "git-exit")], { stdio: "ignore" });
    const ownedEffect = effect;
    closed = new Promise((resolve, reject) => { ownedEffect.once("error", reject); ownedEffect.once("close", (code, signal) => resolve({ code, signal })); });
    const pid = effect.pid; assert.ok(pid);
    await waitFor(async () => { try { return (await readFile(join(f.root, "entries"), "utf8")) === "entered\n"; } catch { return false; } }, "actual gated effect entry");
    const originalIdentity = await identity(pid);
    controller.child.stdin.end("effect-started\n"); assert.deepEqual(await controller.closed, { code: 0, signal: null });
    const unrelatedBefore = await bytes(f.unrelated, f.git);
    const before = await run({ ...f, session: "fresh-live", mode: "resume", run: snapshot.id });
    assert.equal(before.result.kind, "rejected"); assert.match(before.result.message ?? "", /Git operation.*unresolved/);
    assert.equal(before.view.snapshot, null); assert.deepEqual(await identity(pid), originalIdentity, "Same boot/PID/start remains genuinely alive through restart");
    assert.equal(await f.git(f.cwd, "for-each-ref", "--format=%(refname)", claim.reservation.plan.branch), "");
    await writeFile(gate, "release\n"); released = true;
    const exit = await closed; assert.deepEqual(exit, { code: 0, signal: null }); assert.equal((await readFile(join(f.root, "git-exit"), "utf8")).trim(), "0");
    assert.equal(await f.git(f.cwd, "rev-parse", claim.reservation.plan.branch), claim.reservation.plan.commit);
    const after = await run({ ...f, session: "fresh-settled", mode: "resume", run: snapshot.id });
    assert.equal(after.result.kind, "rejected"); assert.match(after.result.message ?? "", /Git operation.*unresolved/);
    assert.equal(after.view.snapshot, null, "Process exit and matching branch cannot infer the missing exact outcome");
    for (const observation of [before, after]) assert.ok(observation.commands.every(command => !command.includes("update-ref") && !command.includes("worktree") && !command.includes("reset")));
    assert.equal(await readFile(join(f.root, "entries"), "utf8"), "entered\n", "Exactly one effect entry, no replay");
    assert.deepEqual(await bytes(f.unrelated, f.git), unrelatedBefore);
    await writeFile(join(f.root, "surviving-process.json"), JSON.stringify({ originalIdentity, controllerExit: { code: 0, signal: null }, effectExit: exit, pending, retainedOutcome: "unknown-operation", entries: 1 }, null, 2));
  } finally {
    // Release only the fixture's own gate. Actual close, never release/signal, is settlement.
    if (effect && closed) { if (!released) await writeFile(gate, "release\n"); await closed; }
  }
  console.log(`Retained #35 surviving-process evidence: ${f.root}`);
});
