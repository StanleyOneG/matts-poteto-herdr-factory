import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  symlink,
  access,
  rm,
  rename,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { SnapshotSchema } from "../src/snapshot.js";
import { Reservation, WorkspaceState } from "../src/assignments.js";
import { promisify } from "node:util";
import { Legion, type LegionOptions } from "../src/intake.js";
import { GitWorkspace } from "../src/git-workspace.js";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
const WorkerResult = z.object({
  kind: z.enum(["reserved", "ownership-blocked", "interrupted"]),
  owner: z.string(),
  id: z.string(),
  branch: z.string(),
  path: z.string(),
  workspace: z
    .object({ kind: z.string(), code: z.string().optional() })
    .optional(),
  message: z.string().optional(),
});
const PendingRequest = z.object({
  id: z.string(),
  fingerprint: z.string(),
  intent: z.unknown(),
});
const UncertainWorker = z.object({
  kind: z.literal("uncertain"),
  requestKey: z.string(),
  message: z.string(),
  pending: PendingRequest,
});
type WorkerInput = {
  root: string;
  cwd: string;
  session: string;
  mode: string;
  gate?: string;
  effectGate?: string;
};
const runWorker = async (args: WorkerInput) => {
  const output = await exec(process.execPath, [
    "--import",
    "tsx",
    fileURLToPath(new URL("./workspace-worker.ts", import.meta.url)),
    JSON.stringify(args),
  ]);
  const raw = JSON.parse(output.stdout);
  const result = z.union([WorkerResult, UncertainWorker]).safeParse(raw);
  if (!result.success) assert.fail(JSON.stringify(raw));
  return result.data;
};
const worker = async (args: WorkerInput) => {
  const result = await runWorker(args);
  if (result.kind === "uncertain") assert.fail(JSON.stringify(result));
  return result;
};
const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legion-real-git-"));
  const cwd = join(root, "repo");
  await mkdir(cwd);
  const git = async (...args: string[]) =>
    (await exec("git", ["-C", cwd, ...args])).stdout.trim();
  await git("init", "-q");
  await writeFile(join(cwd, "tracked"), "base\n");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "base",
  );
  await git("checkout", "-qb", "intended");
  await writeFile(join(cwd, "tracked"), "intended parent\n");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-am",
    "parent",
    "-q",
  );
  const parent = await git("rev-parse", "HEAD");
  await git("checkout", "-qb", "current", "HEAD~1");
  await writeFile(join(cwd, "tracked"), "dirty original\n");
  await writeFile(join(cwd, "untracked"), "original sentinel\n");
  const run = async (command: string) => {
    try {
      const result = await exec("bash", ["-c", command], { cwd });
      return { kind: "finished" as const, code: 0, output: result.stdout };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "number" &&
        "stdout" in error &&
        typeof error.stdout === "string"
      )
        return {
          kind: "finished" as const,
          code: error.code,
          output: error.stdout,
        };
      return { kind: "unknown" as const, message: String(error) };
    }
  };
  return { root, cwd, git, parent, run, adapter: new GitWorkspace(cwd, run) };
}
async function admitted(
  root: string,
  cwd: string,
  adapter: GitWorkspace,
  session: string,
  projectContainer = false,
) {
  const options: LegionOptions = {
    storagePath: join(root, "intake"),
    context: cwd,
    session,
    preflight: async () => [],
    assignments: {
      ...(projectContainer ? {} : { workspaceRoot: join(root, "workspaces") }),
      repository: () => adapter,
    },
  };
  const legion = new Legion(options);
  let key = 0;
  const command = (text: string, requestKey = `${session}/${++key}`) =>
    legion.command({
      text,
      requestKey,
      evidence: {
        origin: "host-command",
        transport: "source-unavailable",
        session,
        generation: null,
        presented: [],
      },
    });
  await command("task Isolated change");
  const before = await legion.state();
  const source = before.snapshot?.submissions[0];
  assert.ok(source);
  await legion.submit({
    kind: "interpretation",
    requestKey: `${session}/interpret`,
    proposal: {
      kind: "new-task",
      source: { id: source.id, revision: 1 },
      goal: "Isolated change",
      acceptance: [],
      questions: [],
    },
    evidence: {
      session,
      generation: before.snapshot?.generation,
      legatus: before.snapshot?.id,
      run: "test",
      sources: [{ id: source.id, revision: 1 }],
    },
  });
  const task = (await legion.state()).tasks[0];
  assert.ok(task);
  return { legion, command, task, options };
}

for (const collision of [
  "branch",
  "empty-directory",
  "occupied-directory",
  "symlink",
  "registered-worktree",
]) {
  test(`a preexisting ${collision} is retained without adoption or a replacement resource`, async () => {
    const { root, cwd, git, adapter } = await fixture();
    const a = await admitted(root, cwd, adapter, `collision-${collision}`);
    let fail = true;
    assert.ok(a.options.assignments);
    a.options.assignments.fault = (point) => {
      if (fail && point === "after-reservation-commit") {
        fail = false;
        throw new Error("Lost claim receipt before any dispatch");
      }
    };
    await a.command(
      `reserve ${a.task.id}@1 --parent refs/heads/intended`,
      "collision",
    );
    assert.equal(
      (await a.legion.command({ workspaceRequest: "collision" })).kind,
      "uncertain",
    );
    const claim = (await a.legion.state()).tasks[0]?.claim;
    if (claim?.kind !== "owned")
      assert.fail("Expected retained planned reservation");
    const plan = claim.reservation.plan;
    if (collision === "branch")
      await git(
        "update-ref",
        plan.branch,
        await git("rev-parse", "refs/heads/current"),
        "",
      );
    else {
      await mkdir(join(root, "workspaces"), { recursive: true });
      if (collision === "registered-worktree")
        await git(
          "worktree",
          "add",
          "-qb",
          "preexisting",
          plan.path,
          "intended",
        );
      else if (collision === "symlink") await symlink(cwd, plan.path);
      else await mkdir(plan.path);
      if (
        collision === "occupied-directory" ||
        collision === "registered-worktree"
      )
        await writeFile(
          join(plan.path, "sentinel"),
          "preexisting literal work\n",
        );
    }
    const refs = await git("for-each-ref", "--format=%(refname) %(objectname)");
    await a.command(`reconcile ${a.task.id}`, "collision-inspection");
    const result = await a.legion.command({
      workspaceRequest: "collision-inspection",
    });
    assert.equal(result.kind, "reserved");
    if (result.kind !== "reserved" || result.workspace.kind !== "held")
      assert.fail("Expected collision hold");
    assert.equal(result.workspace.code, "collision");
    assert.deepEqual(result.receipt.reservation.plan, plan);
    assert.equal(
      await git("for-each-ref", "--format=%(refname) %(objectname)"),
      refs,
    );
    if (
      collision === "occupied-directory" ||
      collision === "registered-worktree"
    )
      assert.equal(
        await readFile(join(plan.path, "sentinel"), "utf8"),
        "preexisting literal work\n",
      );
    assert.equal(
      await readFile(join(cwd, "tracked"), "utf8"),
      "dirty original\n",
    );
    await a.command("off");
  });
}

test("corrupt authority observation changes no ledger bytes and never reports unreserved", async () => {
  const { root, cwd, adapter } = await fixture();
  const a = await admitted(root, cwd, adapter, "corrupt");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "original",
  );
  assert.equal(
    (await a.legion.command({ workspaceRequest: "original" })).kind,
    "reserved",
  );
  const owner = (await a.legion.state()).snapshot?.id;
  assert.ok(owner);
  const ledger = join(cwd, ".git", "legion", "runs", owner, "assignments.sqlite");
  await writeFile(ledger, "not SQLite authority\n");
  const bytes = await readFile(ledger);
  assert.equal((await a.legion.state()).tasks[0]?.claim.kind, "unavailable");
  await a.command("status");
  await a.command("doctor");
  assert.deepEqual(await readFile(ledger), bytes);
  await a.command("off");
});

test("missing initialized ledger history is unavailable and cannot become an empty ownership authority", async () => {
  const { root, cwd, adapter } = await fixture();
  const a = await admitted(root, cwd, adapter, "ledger-loss");
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended`;
  await a.command(text, "original");
  const result = await a.legion.command({ workspaceRequest: "original" });
  assert.equal(result.kind, "reserved");
  if (result.kind !== "reserved") assert.fail("Expected ready reservation");
  const plan = result.receipt.reservation.plan;
  await rm(join(cwd, ".git", "legion"), { recursive: true });
  assert.equal((await a.legion.state()).tasks[0]?.claim.kind, "unavailable");
  await a.command(text, "fresh");
  const rejected = await a.legion.command({ workspaceRequest: "fresh" });
  assert.equal(rejected.kind, "uncertain");
  assert.equal(
    (
      await exec("git", ["-C", plan.path, "symbolic-ref", "HEAD"])
    ).stdout.trim(),
    plan.branch,
  );
  assert.equal(
    await readFile(join(cwd, "tracked"), "utf8"),
    "dirty original\n",
  );
  await a.command("off");
});

for (const schedule of ["release-together", "hold-first-dispatch"] as const) {
  test(`independent user worktree processes receiving the same issue ${schedule} own distinct resources`, async () => {
    const { root, cwd, git, parent } = await fixture();
    const linked = join(root, "linked");
    await git("worktree", "add", "-qb", "linked-run", linked, "intended");
    const unrelated = join(root, "unrelated");
    await git("worktree", "add", "-qb", "unrelated", unrelated, "intended");
    await writeFile(join(unrelated, "sentinel"), "unrelated existing work\n");
    const gates = [join(root, "a.gate"), join(root, "b.gate")];
    for (const gate of gates) await exec("mkfifo", [gate]);
    const effectGate = join(root, "first-effect.gate");
    if (schedule === "hold-first-dispatch") await exec("mkfifo", [effectGate]);
    const contexts = [cwd, linked];
    const sessions = ["overlap-a", "overlap-b"];
    const running = gates.map((gate, i) => worker({
      root, cwd: contexts[i] ?? "", session: sessions[i] ?? "", mode: "contend", gate,
      ...(schedule === "hold-first-dispatch" && i === 0 ? { effectGate } : {}),
    }));
    const completed = Promise.all(running);
    const marker = async (path: string): Promise<unknown> => {
      while (true) {
        try { return JSON.parse(await readFile(path, "utf8")); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    };
    const Prepared = z.object({ pid: z.int().positive(), owner: z.uuid(), task: z.uuid(), parent: z.string() });
    const ready = await Promise.all(gates.map(async (gate) => Prepared.parse(await marker(`${gate}.ready`))));
    try {
      assert.notEqual(ready[0]?.pid, ready[1]?.pid);
      assert.notEqual(ready[0]?.owner, ready[1]?.owner);
      assert.equal(ready[0]?.parent, parent);
      assert.equal(ready[1]?.parent, parent);
    } finally {
      if (schedule === "release-together") await Promise.all(gates.map((gate) => writeFile(gate, "release\n")));
      else {
        const [first, second] = gates;
        assert.ok(first); assert.ok(second);
        await writeFile(first, "release\n");
        const held = z.object({ kind: z.literal("owned"), reservation: z.object({ owner: z.uuid(), id: z.uuid() }),
          workspace: z.object({ kind: z.literal("dispatched") }) }).parse(await marker(`${effectGate}.ready`));
        try {
          assert.equal(held.reservation.owner, ready[0]?.owner);
          await writeFile(second, "release\n");
          const independent = await running[1];
          assert.equal(independent?.kind, "reserved");
          assert.equal(independent?.workspace?.kind, "ready");
          assert.notEqual(independent?.id, held.reservation.id);
        } finally { await writeFile(effectGate, "release\n"); }
      }
    }
    const results = await completed;
    const [one, two] = results;
    assert.ok(one); assert.ok(two);
    assert.equal(one.kind, "reserved"); assert.equal(two.kind, "reserved");
    assert.equal(one.workspace?.kind, "ready"); assert.equal(two.workspace?.kind, "ready");
    assert.notEqual(one.id, two.id); assert.notEqual(one.branch, two.branch); assert.notEqual(one.path, two.path);
    for (const [i, result] of results.entries()) {
      assert.equal(result.owner, ready[i]?.owner);
      assert.equal((await exec("git", ["-C", result.path, "rev-parse", "HEAD"])).stdout.trim(), parent);
      assert.equal((await exec("git", ["-C", result.path, "symbolic-ref", "HEAD"])).stdout.trim(), result.branch);
      const observed = z.object({ mode: z.literal("inactive"), claim: z.object({ kind: z.literal("owned"),
        reservation: z.object({ id: z.uuid(), owner: z.uuid() }) }), ownerObservations: z.array(z.unknown()) }).parse(JSON.parse((await exec(process.execPath,
        ["--import", "tsx", fileURLToPath(new URL("./workspace-worker.ts", import.meta.url)),
          JSON.stringify({ root, cwd: contexts[i], session: sessions[i], mode: "observe" })])).stdout));
      assert.equal(observed.claim.reservation.id, result.id);
      assert.equal(observed.claim.reservation.owner, result.owner);
      assert.equal(observed.ownerObservations.length, 1);
      const reconciled = await worker({ root, cwd: contexts[i] ?? "", session: sessions[i] ?? "", mode: "reconcile" });
      assert.equal(reconciled.id, result.id); assert.equal(reconciled.path, result.path);
      assert.equal(reconciled.workspace?.kind, "ready");
    }
    assert.equal((await git("for-each-ref", "--format=%(refname)", "refs/heads/legion")).split("\n").length, 2);
    assert.equal((await git("worktree", "list", "--porcelain")).split("\n").filter((line) => line.startsWith("worktree ")).length, 5);
    assert.equal(await readFile(join(cwd, "tracked"), "utf8"), "dirty original\n");
    assert.equal(await readFile(join(cwd, "untracked"), "utf8"), "original sentinel\n");
    assert.equal(await readFile(join(unrelated, "sentinel"), "utf8"), "unrelated existing work\n");
  });
}

test("settled runs through linked, nested, symlink checkouts and an independent clone do not share issue ownership", async () => {
  const { root, cwd, git } = await fixture();
  const owned = await worker({
    root,
    cwd,
    session: "primary",
    mode: "reserve",
  });
  assert.equal(owned.kind, "reserved");
  assert.equal(owned.workspace?.kind, "ready");
  const linked = join(root, "linked");
  await git("worktree", "add", "-qb", "linked", linked, "refs/heads/intended");
  const nested = join(cwd, "nested");
  await mkdir(nested);
  const alias = join(root, "alias");
  await symlink(cwd, alias);
  for (const [session, context] of [
    ["linked", linked],
    ["nested", nested],
    ["symlink", alias],
  ]) {
    assert.ok(session);
    assert.ok(context);
    const independent = await worker({
      root,
      cwd: context,
      session,
      mode: "reserve",
    });
    assert.equal(independent.kind, "reserved");
    assert.notEqual(independent.owner, owned.owner);
    assert.notEqual(independent.id, owned.id);
    assert.notEqual(independent.path, owned.path);
    assert.notEqual(independent.branch, owned.branch);
    const observation = JSON.parse(
      (
        await exec(process.execPath, [
          "--import",
          "tsx",
          fileURLToPath(new URL("./workspace-worker.ts", import.meta.url)),
          JSON.stringify({ root, cwd: context, session, mode: "observe" }),
        ])
      ).stdout,
    );
    assert.equal(observation.mode, "inactive");
    assert.equal(observation.claim.kind, "owned");
    assert.equal(observation.claim.reservation.id, independent.id);
  }
  const cloneRoot = join(root, "clone-root");
  await mkdir(cloneRoot);
  const clone = join(cloneRoot, "repo");
  await exec("git", ["clone", "--no-local", "-q", cwd, clone]);
  await exec("git", ["-C", clone, "branch", "intended", "origin/intended"]);
  const separate = await worker({
    root: cloneRoot,
    cwd: clone,
    session: "clone",
    mode: "reserve",
  });
  assert.equal(separate.kind, "reserved");
  assert.equal(separate.workspace?.kind, "ready");
  assert.notEqual(separate.id, owned.id);
  assert.equal(
    await readFile(join(cwd, "tracked"), "utf8"),
    "dirty original\n",
  );
});

test("a surviving Git child blocks explicit resume before and after its delayed branch appears without losing its unknown reservation", async () => {
  const { root, cwd, git } = await fixture();
  const gate = join(root, "effect.fifo");
  await exec("mkfifo", [gate]);
  const controller = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./workspace-worker.ts", import.meta.url)), JSON.stringify({ root, cwd, session: "interrupted", mode: "interrupt", gate })], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  controller.stdout.on("data", chunk => { output += chunk; }); controller.stderr.on("data", chunk => { errors += chunk; });
  const controllerClosed = new Promise((resolve, reject) => { controller.once("error", reject); controller.once("close", (code, signal) => resolve({ code, signal })); });
  const waitFor = async (check: () => Promise<boolean> | boolean) => {
    const deadline = Date.now() + 30000; // Observation bound only; never signals or proves settlement.
    while (!await check()) { if (Date.now() >= deadline) throw new Error(`Missing fixture evidence: ${errors}`); await delay(10); }
  };
  let effect: ChildProcess | undefined, closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined, released = false;
  try {
    await waitFor(() => output.includes("\n"));
    const interrupted = WorkerResult.extend({ command: z.string() }).parse(JSON.parse(output));
    assert.equal(interrupted.kind, "interrupted");
    effect = spawn("bash", ["-c", `printf 'entered\\n' >> "$2"; read -r release < "$1"; ${interrupted.command}; rc=$?; printf '%s\\n' "$rc" > "$3"; exit "$rc"`, "owned-effect", gate, `${gate}.entries`, `${gate}.exit`], { cwd, stdio: "ignore" });
    const child = effect;
    closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    await waitFor(async () => { try { return await readFile(`${gate}.entries`, "utf8") === "entered\n"; } catch { return false; } });
    const pid = effect.pid; assert.ok(pid);
    const identity = async () => {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      assert.ok(start); assert.match(start, /^\d+$/);
      return { pid, boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(), start };
    };
    const originalIdentity = await identity();
    controller.stdin.end("effect-started\n");
    assert.deepEqual(await controllerClosed, { code: 0, signal: null });
    const Resume = z.object({ result: z.object({ kind: z.literal("rejected"), message: z.string() }), view: z.object({ mode: z.literal("inactive"), snapshot: SnapshotSchema, tasks: z.array(z.object({ claim: z.object({ kind: z.literal("owned"), reservation: Reservation, workspace: WorkspaceState }) })) }) });
    const resume = async () => Resume.parse(JSON.parse((await exec(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./workspace-worker.ts", import.meta.url)), JSON.stringify({ root, cwd, session: "interrupted", mode: "resume" })])).stdout));
    const before = await resume();
    assert.match(before.result.message, /Git operation.*unresolved/);
    assert.deepEqual(await identity(), originalIdentity);
    assert.equal(await git("for-each-ref", "--format=%(refname)", interrupted.branch), "");
    await writeFile(gate, "release\n"); released = true;
    const exit = await closed;
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(await readFile(`${gate}.exit`, "utf8"), "0\n");
    assert.equal(await git("rev-parse", interrupted.branch), await git("rev-parse", "refs/heads/intended"));
    const after = await resume();
    assert.match(after.result.message, /Git operation.*unresolved/);
    assert.deepEqual(after.view, before.view, "Matching ref and real process exit cannot repair missing action outcome or attach authority");
    assert.equal(before.view.tasks[0]?.claim.reservation.id, interrupted.id);
    assert.equal(before.view.tasks[0]?.claim.workspace.kind, "dispatched");
    assert.equal(await readFile(`${gate}.entries`, "utf8"), "entered\n", "Only the original backend executes");
    assert.equal(await readFile(join(cwd, "tracked"), "utf8"), "dirty original\n");
    assert.equal(await readFile(join(cwd, "untracked"), "utf8"), "original sentinel\n");
    await writeFile(join(root, "surviving-process.json"), JSON.stringify({ pid, originalIdentity, exit, before, after }, null, 2));
  } finally {
    if (!controller.stdin.writableEnded) controller.stdin.end(effect ? "effect-started\n" : undefined);
    if (effect && closed) { if (!released && effect.exitCode === null && effect.signalCode === null) await writeFile(gate, "release\n"); await closed; }
    await controllerClosed;
  }
});

test("different assignments use distinct actual worktrees at the intended parent without touching dirty work", async () => {
  const { root, cwd, git, parent, adapter, run } = await fixture();
  const a = await admitted(root, cwd, adapter, "a");
  const linked = join(root, "linked-writer");
  await git("worktree", "add", "-qb", "linked-writer", linked, "intended");
  const b = await admitted(root, linked, new GitWorkspace(linked, run), "b");
  const unrelated = join(root, "unrelated");
  await git(
    "worktree",
    "add",
    "-qb",
    "unrelated",
    unrelated,
    "refs/heads/intended",
  );
  await writeFile(join(unrelated, "sentinel"), "unrelated work\n");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "a-reserve",
  );
  await b.command(
    `reserve ${b.task.id}@1 --parent refs/heads/intended`,
    "b-reserve",
  );
  const [one, two] = await Promise.all([
    a.legion.command({ workspaceRequest: "a-reserve" }),
    b.legion.command({ workspaceRequest: "b-reserve" }),
  ]);
  assert.equal(one.kind, "reserved");
  assert.equal(two.kind, "reserved");
  if (one.kind !== "reserved" || two.kind !== "reserved")
    assert.fail("Expected reservations");
  assert.deepEqual(one.workspace, { kind: "ready" });
  assert.deepEqual(two.workspace, { kind: "ready" });
  const p = one.receipt.reservation.plan,
    q = two.receipt.reservation.plan;
  assert.notEqual(p.path, q.path);
  assert.notEqual(p.branch, q.branch);
  assert.equal(p.commit, parent);
  assert.equal(q.commit, parent);
  assert.equal(
    (await exec("git", ["-C", p.path, "rev-parse", "HEAD"])).stdout.trim(),
    parent,
  );
  assert.equal(
    (await exec("git", ["-C", p.path, "symbolic-ref", "HEAD"])).stdout.trim(),
    p.branch,
  );
  assert.equal(
    await realpath(
      (
        await exec("git", [
          "-C",
          p.path,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ])
      ).stdout.trim(),
    ),
    await realpath(join(cwd, ".git")),
  );
  await writeFile(join(p.path, "tracked"), "private edit\n");
  await writeFile(join(p.path, "sentinel"), "private sentinel\n");
  assert.equal(
    await readFile(join(q.path, "tracked"), "utf8"),
    "intended parent\n",
  );
  assert.equal(
    await readFile(join(cwd, "tracked"), "utf8"),
    "dirty original\n",
  );
  assert.equal(
    await readFile(join(cwd, "untracked"), "utf8"),
    "original sentinel\n",
  );
  assert.equal(
    await readFile(join(unrelated, "sentinel"), "utf8"),
    "unrelated work\n",
  );
  await a.command(`reconcile ${a.task.id}`, "dirty-reconcile");
  const dirty = await a.legion.command({ workspaceRequest: "dirty-reconcile" });
  assert.equal(dirty.kind, "reserved");
  if (dirty.kind !== "reserved")
    assert.fail("Expected dirty workspace retained");
  assert.deepEqual(dirty.workspace, { kind: "ready" });
  assert.equal(
    await readFile(join(p.path, "tracked"), "utf8"),
    "private edit\n",
  );
  await exec("git", ["-C", p.path, "add", "tracked"]);
  await exec("git", [
    "-C",
    p.path,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "later legitimate work",
  ]);
  await a.command(`reconcile ${a.task.id}`, "later-commit");
  const later = await a.legion.command({ workspaceRequest: "later-commit" });
  assert.equal(later.kind, "reserved");
  if (later.kind !== "reserved") assert.fail("Expected later commit retained");
  assert.deepEqual(later.workspace, { kind: "ready" });
  assert.equal(later.receipt.reservation.plan.commit, parent);
  const moved = join(root, "manually-moved");
  await git("worktree", "move", p.path, moved);
  await a.command(`reconcile ${a.task.id}`, "moved-worktree");
  const mismatch = await a.legion.command({
    workspaceRequest: "moved-worktree",
  });
  assert.equal(mismatch.kind, "reserved");
  if (mismatch.kind !== "reserved" || mismatch.workspace.kind !== "held")
    assert.fail("Expected mismatch hold");
  assert.equal(mismatch.workspace.code, "workspace-mismatch");
  assert.equal(
    await readFile(join(moved, "sentinel"), "utf8"),
    "private sentinel\n",
  );
  await assert.rejects(access(p.path));
  await a.command("off");
  await b.command("off");
});

test("primary and linked checkout reservations share the project sibling container", async () => {
  const { root, cwd, git, adapter, run, parent } = await fixture();
  const linked = join(root, "linked");
  await git("worktree", "add", "-qb", "linked-fixture", linked, "refs/heads/intended");
  const a = await admitted(root, cwd, adapter, "primary-container", true);
  const b = await admitted(root, linked, new GitWorkspace(linked, run), "linked-container", true);
  try {
    const paths: string[] = [];
    for (const current of [a, b]) {
      await current.command(`reserve ${current.task.id}@1 --parent refs/heads/intended`, "container-reserve");
      const result = await current.legion.command({ workspaceRequest: "container-reserve" });
      assert.equal(result.kind, "reserved");
      if (result.kind !== "reserved") assert.fail("Expected isolated ready worktree");
      assert.equal(result.workspace.kind, "ready");
      assert.equal(dirname(result.receipt.reservation.plan.path), join(root, "worktrees-repo_legion"));
      assert.equal(result.receipt.reservation.plan.commit, parent);
      paths.push(result.receipt.reservation.plan.path);
    }
    assert.notEqual(paths[0], paths[1]);
    assert.equal(await readFile(join(cwd, "tracked"), "utf8"), "dirty original\n");
    assert.equal(await readFile(join(cwd, "untracked"), "utf8"), "original sentinel\n");
  } finally {
    await a.command("off");
    await b.command("off");
  }
});


test("legacy shared history is visibly unsupported and byte-preserved with pinned resources, never new-run authority", async () => {
  const { root, cwd, git, adapter, run } = await fixture();
  const a = await admitted(root, cwd, adapter, "legacy-pinned");
  const source = "https://github.com/Fixture/Project/issues/9";
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended --source ${source}`;
  await a.command(text, "legacy-original");
  const original = await a.legion.command({ workspaceRequest: "legacy-original" });
  if (original.kind !== "reserved") assert.fail("Expected test-owned pinned workspace");
  const reservation = original.receipt.reservation;
  await a.command("off");
  const legacyRoot = join(cwd, ".git", "legion");
  const runRoot = join(legacyRoot, "runs", reservation.owner);
  for (const name of await readdir(runRoot)) await rename(join(runRoot, name), join(legacyRoot, name));
  await rm(runRoot, { recursive: true });
  // Reconstruct the old shared-ledger fixture, not an authority migration.
  const identity = { version: 1, repository: reservation.repository, commonDir: join(cwd, ".git") };
  await writeFile(join(legacyRoot, "assignments.initialized"), JSON.stringify(identity));
  const db = new DatabaseSync(join(legacyRoot, "assignments.sqlite"));
  db.prepare("UPDATE repository SET value=? WHERE singleton=1").run(JSON.stringify(identity));
  db.close();
  await writeFile(join(reservation.plan.path, "sentinel"), "pinned legacy work\n");
  const names = ["assignments.sqlite", "assignments.initialized"];
  const before = await Promise.all(names.map((name) => readFile(join(legacyRoot, name))));
  const refs = await git("for-each-ref", "--format=%(refname) %(objectname)");
  const reopened = new Legion(a.options);
  for (const command of ["status", "doctor"]) await reopened.command({ text: command });
  const view = await reopened.state();
  assert.equal(view.tasks[0]?.claim.kind, "unavailable");
  if (view.tasks[0]?.claim.kind !== "unavailable") assert.fail("Legacy history must never appear unreserved");
  assert.match(view.tasks[0].claim.message, /legacy.*unsupported/i);
  assert.equal((await a.command(`resume ${reservation.owner}`, "legacy-resume")).kind, "rejected");
  assert.equal(await git("for-each-ref", "--format=%(refname) %(objectname)"), refs);
  await assert.rejects(access(runRoot));
  const linked = join(root, "legacy-independent");
  await git("worktree", "add", "-qb", "legacy-independent", linked, "intended");
  const b = await admitted(root, linked, new GitWorkspace(linked, run), "new-run");
  try {
    await b.command(`reserve ${b.task.id}@1 --parent refs/heads/intended --source ${source}`, "new-reserve");
    const fresh = await b.legion.command({ workspaceRequest: "new-reserve" });
    if (fresh.kind !== "reserved") assert.fail("Legacy claim cannot arbitrate independent runs");
    assert.equal(fresh.workspace.kind, "ready");
    assert.notEqual(fresh.receipt.reservation.id, reservation.id);
    assert.notEqual(fresh.receipt.reservation.plan.path, reservation.plan.path);
    assert.notEqual(fresh.receipt.reservation.plan.branch, reservation.plan.branch);
    assert.equal((await b.legion.state()).ownerObservations?.length, 1);
    assert.deepEqual(await Promise.all(names.map((name) => readFile(join(legacyRoot, name)))), before);
    assert.equal(await readFile(join(reservation.plan.path, "sentinel"), "utf8"), "pinned legacy work\n");
    assert.equal((await exec("git", ["-C", reservation.plan.path, "symbolic-ref", "HEAD"])).stdout.trim(), reservation.plan.branch);
  } finally { await b.command("off"); }
});


test("missing reservation ownership evidence blocks fresh effects and receipt replay without replacing pinned resources", async () => {
  const { root, cwd, git, adapter } = await fixture();
  const a = await admitted(root, cwd, adapter, "reservation-row-loss");
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended`;
  await a.command(text, "original");
  const original = await a.legion.command({ workspaceRequest: "original" });
  if (original.kind !== "reserved") assert.fail("Expected pinned owned workspace");
  const plan = original.receipt.reservation.plan;
  const ledger = join(cwd, ".git", "legion", "runs", original.receipt.reservation.owner, "assignments.sqlite");
  const db = new DatabaseSync(ledger);
  db.prepare("DELETE FROM claims WHERE id=?").run(original.receipt.reservation.id);
  db.close();
  const before = await readFile(ledger);
  const refs = await git("for-each-ref", "--format=%(refname) %(objectname)");
  const worktrees = await git("worktree", "list", "--porcelain");
  try {
    for (const command of ["status", "doctor"]) await a.command(command);
    assert.equal((await a.legion.state()).tasks[0]?.claim.kind, "unavailable");
    assert.equal((await a.command(text, "original")).kind, "rejected");
    await a.command(text, "fresh-after-loss");
    assert.equal((await a.legion.command({ workspaceRequest: "fresh-after-loss" })).kind, "uncertain");
    assert.deepEqual(await readFile(ledger), before);
    assert.equal(await git("for-each-ref", "--format=%(refname) %(objectname)"), refs);
    assert.equal(await git("worktree", "list", "--porcelain"), worktrees);
    assert.equal((await exec("git", ["-C", plan.path, "symbolic-ref", "HEAD"])).stdout.trim(), plan.branch);
  } finally { await a.command("off"); }
});
