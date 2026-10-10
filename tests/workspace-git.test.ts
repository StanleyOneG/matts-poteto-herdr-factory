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
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Legion, type LegionOptions } from "../src/intake.js";
import { GitWorkspace } from "../src/git-workspace.js";
import { z } from "zod";
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
  child: z.number().optional(),
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
  const ledger = join(cwd, ".git", "legion", "assignments.sqlite");
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
  test(`independent same-task processes ${schedule} preserve one owner and recover the losing blocker`, async () => {
    const { root, cwd, git, parent } = await fixture();
    const unrelated = join(root, "unrelated");
    await git("worktree", "add", "-qb", "unrelated", unrelated, "intended");
    await writeFile(join(unrelated, "sentinel"), "unrelated existing work\n");
    const gates = [
      join(root, "contender-a.gate"),
      join(root, "contender-b.gate"),
    ];
    for (const gate of gates) await exec("mkfifo", [gate]);
    const effectGate = join(root, "winner-effect.gate");
    if (schedule === "hold-first-dispatch") await exec("mkfifo", [effectGate]);
    const sessions = ["overlap-a", "overlap-b"];
    const running = gates.map((gate, i) =>
      runWorker({
        root,
        cwd,
        session: sessions[i] ?? "",
        mode: "contend",
        gate,
        ...(schedule === "hold-first-dispatch" && i === 0
          ? { effectGate }
          : {}),
      }),
    );
    const completed = Promise.all(running);
    const marker = async (path: string): Promise<unknown> => {
      while (true) {
        try {
          return JSON.parse(await readFile(path, "utf8"));
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            throw error;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    };
    const Prepared = z.object({
      pid: z.int().positive(),
      owner: z.uuid(),
      task: z.uuid(),
      parent: z.string(),
    });
    const ready = await Promise.all(
      gates.map(async (gate) => Prepared.parse(await marker(`${gate}.ready`))),
    );
    const Claim = z.object({
      kind: z.enum(["owned", "foreign"]),
      reservation: z.object({
        id: z.uuid(),
        owner: z.uuid(),
        plan: z.object({ branch: z.string(), path: z.string() }),
      }),
    });
    const observe = async (session: string) =>
      z
        .object({
          mode: z.literal("inactive"),
          claim: z.unknown(),
          ownerObservations: z.array(Claim),
          requests: z.array(PendingRequest),
        })
        .parse(
          JSON.parse(
            (
              await exec(process.execPath, [
                "--import",
                "tsx",
                fileURLToPath(
                  new URL("./workspace-worker.ts", import.meta.url),
                ),
                JSON.stringify({ root, cwd, session, mode: "observe" }),
              ])
            ).stdout,
          ),
        );
    let overlappingBlocker: Awaited<ReturnType<typeof runWorker>> | undefined;
    try {
      assert.notEqual(ready[0]?.pid, ready[1]?.pid);
      assert.notEqual(ready[0]?.owner, ready[1]?.owner);
      assert.notEqual(ready[0]?.task, ready[1]?.task);
      assert.equal(ready[0]?.parent, parent);
      assert.equal(ready[1]?.parent, parent);
      assert.equal(
        await git("for-each-ref", "--format=%(refname)", "refs/heads/legion"),
        "",
      );
    } finally {
      if (schedule === "release-together")
        await Promise.all(gates.map((gate) => writeFile(gate, "release\n")));
      else {
        const first = gates[0],
          second = gates[1];
        assert.ok(first);
        assert.ok(second);
        await writeFile(first, "release\n");
        const held = Claim.extend({
          kind: z.literal("owned"),
          workspace: z.object({
            kind: z.literal("dispatched"),
            operation: z.object({ id: z.uuid(), step: z.literal("branch") }),
          }),
        }).parse(await marker(`${effectGate}.ready`));
        try {
          assert.equal(held.reservation.owner, ready[0]?.owner);
          assert.equal(
            await git(
              "for-each-ref",
              "--format=%(refname)",
              "refs/heads/legion",
            ),
            "",
          );
          await writeFile(second, "release\n");
          overlappingBlocker = await running[1];
          assert.equal(overlappingBlocker?.kind, "ownership-blocked");
          if (overlappingBlocker?.kind !== "ownership-blocked")
            assert.fail("Expected blocker while winner dispatch remains held");
          assert.equal(overlappingBlocker.owner, held.reservation.owner);
          assert.equal(overlappingBlocker.id, held.reservation.id);
        } finally {
          await writeFile(effectGate, "release\n");
        }
      }
    }
    const results = await completed;
    const observations = await Promise.all(sessions.map(observe));
    for (const observation of observations)
      assert.equal(observation.ownerObservations.length, 1);
    const reservation = observations[0]?.ownerObservations[0]?.reservation;
    assert.ok(reservation);
    assert.deepEqual(
      observations[1]?.ownerObservations[0]?.reservation,
      reservation,
    );
    const loserIndex = ready.findIndex(
      (actor) => actor.owner !== reservation.owner,
    );
    assert.ok(loserIndex === 0 || loserIndex === 1);
    const loser = results[loserIndex];
    assert.ok(loser);
    assert.ok(loser.kind === "uncertain" || loser.kind === "ownership-blocked");
    if (loser.kind === "uncertain") {
      assert.match(
        loser.message,
        /database is locked|initialization|publication|recovery/,
      );
      assert.equal(loser.pending.id, loser.requestKey);
      assert.deepEqual(loser.pending.intent, {
        kind: "reserve",
        task: { id: ready[loserIndex]?.task, revision: 1 },
        parent: "refs/heads/intended",
        source: "https://github.com/Fixture/Project/issues/9",
      });
      assert.match(loser.message, /explicitly.*resume/);
      assert.match(loser.message, /fresh.*reserve/);
      assert.match(loser.message, /No automatic retry was performed/);
      assert.deepEqual(
        observations[loserIndex]?.requests.find(
          (r) => r.id === loser.requestKey,
        ),
        loser.pending,
      );
    } else {
      assert.equal(loser.owner, reservation.owner);
      assert.equal(loser.id, reservation.id);
    }
    const branchesBeforeRecovery = await git(
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/legion",
    );
    assert.ok(
      branchesBeforeRecovery === "" ||
        branchesBeforeRecovery === reservation.plan.branch,
    );
    const worktreesBeforeRecovery = await git(
      "worktree",
      "list",
      "--porcelain",
    );
    const registered = worktreesBeforeRecovery
      .split("\n")
      .filter((line) => line.startsWith("worktree "));
    assert.ok(registered.length === 2 || registered.length === 3);
    for (const path of registered)
      assert.ok(
        [cwd, unrelated, reservation.plan.path]
          .map((p) => `worktree ${p}`)
          .includes(path),
      );
    const loserSession = sessions[loserIndex];
    assert.ok(loserSession);
    const recovered = await worker({
      root,
      cwd,
      session: loserSession,
      mode: "reserve",
    });
    assert.equal(recovered.kind, "ownership-blocked");
    assert.equal(recovered.owner, reservation.owner);
    assert.equal(recovered.id, reservation.id);
    assert.equal(recovered.branch, reservation.plan.branch);
    assert.equal(recovered.path, reservation.plan.path);
    assert.equal(
      await git("for-each-ref", "--format=%(refname)", "refs/heads/legion"),
      branchesBeforeRecovery,
    );
    assert.equal(
      await git("worktree", "list", "--porcelain"),
      worktreesBeforeRecovery,
    );
    const finalViews = await Promise.all(sessions.map(observe));
    for (let i = 0; i < finalViews.length; i++) {
      const claim = Claim.parse(finalViews[i]?.claim);
      assert.equal(
        claim.kind,
        ready[i]?.owner === reservation.owner ? "owned" : "foreign",
      );
      assert.deepEqual(claim.reservation, reservation);
    }
    if (schedule === "hold-first-dispatch") {
      const winner = results[0];
      if (winner?.kind !== "reserved") assert.fail("Expected settled winner");
      assert.deepEqual(winner.workspace, { kind: "ready" });
      assert.equal(branchesBeforeRecovery, reservation.plan.branch);
      assert.equal(registered.length, 3);
      assert.equal(
        (
          await exec("git", ["-C", reservation.plan.path, "rev-parse", "HEAD"])
        ).stdout.trim(),
        parent,
      );
      assert.equal(
        (
          await exec("git", [
            "-C",
            reservation.plan.path,
            "symbolic-ref",
            "HEAD",
          ])
        ).stdout.trim(),
        reservation.plan.branch,
      );
    }
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
      "unrelated existing work\n",
    );
    console.log(
      JSON.stringify({
        schedule,
        root,
        ready,
        results,
        reservation,
        overlappingBlocker,
        recovered,
        branches: branchesBeforeRecovery,
        worktrees: registered,
      }),
    );
  });
}

test("process observers through linked, nested, and symlink checkouts contend while an independent clone does not", async () => {
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
    const blocked = await worker({
      root,
      cwd: context,
      session,
      mode: "reserve",
    });
    assert.equal(blocked.kind, "ownership-blocked");
    assert.equal(blocked.owner, owned.owner);
    assert.equal(blocked.id, owned.id);
    assert.equal(blocked.path, owned.path);
    assert.equal(blocked.branch, owned.branch);
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
    assert.equal(observation.claim.kind, "foreign");
    assert.equal(observation.claim.reservation.id, owned.id);
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

test("a surviving Git child keeps its unknown reservation before and after its delayed branch appears", async () => {
  const { root, cwd, git } = await fixture();
  const gate = join(root, "effect.fifo");
  await exec("mkfifo", [gate]);
  const interrupted = await worker({
    root,
    cwd,
    session: "interrupted",
    mode: "interrupt",
    gate,
  });
  assert.equal(interrupted.kind, "interrupted");
  assert.ok(interrupted.child);
  process.kill(interrupted.child, 0);
  const absent = await worker({
    root,
    cwd,
    session: "interrupted",
    mode: "reconcile",
  });
  assert.equal(absent.kind, "reserved");
  assert.equal(absent.id, interrupted.id);
  assert.equal(absent.workspace?.code, "unknown-operation");
  const before = await git(
    "for-each-ref",
    "--format=%(refname)",
    interrupted.branch,
  );
  assert.equal(before, "");
  await writeFile(gate, "release\n");
  while (true) {
    try {
      await access(`${gate}.done`);
      break;
    } catch {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  assert.equal(
    await git("rev-parse", interrupted.branch),
    await git("rev-parse", "refs/heads/intended"),
  );
  const matching = await worker({
    root,
    cwd,
    session: "interrupted",
    mode: "reconcile",
  });
  assert.equal(matching.kind, "reserved");
  assert.equal(matching.id, interrupted.id);
  assert.equal(matching.workspace?.code, "unknown-operation");
  assert.match(matching.message ?? "", /No retry was performed/);
  assert.equal(
    await readFile(join(cwd, "untracked"), "utf8"),
    "original sentinel\n",
  );
});

test("different assignments use distinct actual worktrees at the intended parent without touching dirty work", async () => {
  const { root, cwd, git, parent, adapter } = await fixture();
  const a = await admitted(root, cwd, adapter, "a");
  const b = await admitted(root, cwd, adapter, "b");
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
