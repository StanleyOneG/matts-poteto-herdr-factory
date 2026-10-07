import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion, type LegionOptions } from "../src/intake.js";
import type { WorkspaceRepository } from "../src/git-workspace.js";

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "legion-assignments-"));
  const commonDir = join(root, "repo.git");
  await mkdir(commonDir);
  await mkdir(join(root, "checkout"));
  const git: WorkspaceRepository = {
    locate: async () => ({ commonDir, worktrees: [join(root, "checkout")] }),
    parent: async () => "a".repeat(40),
    inspect: async () => ({
      branch: null,
      path: "absent",
      workspace: null,
      parent: "a".repeat(40),
    }),
    createBranch: async () => ({
      kind: "failed",
      message: "Permission denied",
      noEffect: true,
    }),
    createWorktree: async () => ({
      kind: "failed",
      message: "Permission denied",
      noEffect: true,
    }),
  };
  return { root, git };
}
async function legatus(
  root: string,
  git: WorkspaceRepository,
  session: string,
  fault?: LegionOptions["storageFault"],
) {
  const options: LegionOptions = {
    storagePath: join(root, session),
    context: join(root, "checkout"),
    session,
    preflight: async () => [],
    storageFault: (point) => fault?.(point),
    assignments: {
      workspaceRoot: join(root, "workspaces"),
      repository: () => git,
    },
  };
  const legion = new Legion(options);
  let seq = 0;
  const evidence = {
    origin: "host-command",
    transport: "source-unavailable",
    session,
    generation: null,
    presented: [],
  };
  const command = (text: string, requestKey = `${session}/${++seq}`) =>
    legion.command({ text, requestKey, evidence });
  await command("task Fix the label");
  let view = await legion.state();
  const source = view.snapshot?.submissions[0];
  assert.ok(source);
  await legion.submit({
    kind: "interpretation",
    requestKey: `${session}/interpret`,
    proposal: {
      kind: "new-task",
      source: { id: source.id, revision: 1 },
      goal: "Fix the label",
      acceptance: ["Correct label"],
      questions: [],
    },
    evidence: {
      session,
      generation: view.snapshot?.generation,
      legatus: view.snapshot?.id,
      run: "fixture",
      sources: [{ id: source.id, revision: 1 }],
    },
  });
  view = await legion.state();
  const task = view.tasks[0];
  assert.ok(task);
  return { legion, command, options, task, owner: view.snapshot?.id };
}

test("unreadable storage cannot hide stopping or release an unsettled invocation", async () => {
  const { root, git } = await repository();
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  git.locate = async () => {
    entered();
    await barrier;
    return {
      commonDir: join(root, "repo.git"),
      worktrees: [join(root, "checkout")],
    };
  };
  const a = await legatus(root, git, "session-corrupt-stopping");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "corrupt-stop",
  );
  const running = a.legion.command({ workspaceRequest: "corrupt-stop" });
  await started;
  const file = join(a.options.storagePath, `v1.${a.owner}.sqlite`);
  const original = await readFile(file);
  try {
    await writeFile(file, "corrupt test-owned snapshot\n");
    const stopped = await a.command("off");
    if (stopped.kind !== "observed")
      assert.fail("Expected lifecycle observation");
    assert.equal(stopped.view.mode, "stopping");
    assert.match(stopped.view.unavailable ?? "", /not a database/);
    assert.equal((await a.legion.state()).mode, "stopping");
    await a.command("off");
    assert.equal((await a.legion.state()).mode, "stopping");
    assert.equal((await a.command(`resume ${a.owner}`)).kind, "rejected");
  } finally {
    await writeFile(file, original);
    release();
    await running;
  }
  assert.equal((await a.legion.state()).mode, "inactive");
  const reopened = new Legion(a.options);
  assert.equal((await reopened.state()).snapshot?.id, a.owner);
});

test("off at authorization await boundaries never starts discovery after revocation or releases an unsettled owner", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-authorization-boundary");
  for (let cut = 0; cut <= 24; cut++) {
    if (cut) await a.command(`resume ${a.owner}`);
    const request = `boundary-${cut}`;
    await a.command(
      `reserve ${a.task.id}@1 --parent refs/heads/intended`,
      request,
    );
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false,
      offIssued = false,
      startedAfterOff = false;
    git.locate = async () => {
      entered = true;
      startedAfterOff = offIssued;
      await barrier;
      return {
        commonDir: join(root, "repo.git"),
        worktrees: [join(root, "checkout")],
      };
    };
    const running = a.legion.command({ workspaceRequest: request });
    let off!: ReturnType<typeof a.command>;
    let remaining = cut;
    const tick = () => {
      if (remaining-- > 0) queueMicrotask(tick);
      else {
        offIssued = true;
        off = a.command("off");
      }
    };
    queueMicrotask(tick);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await off;
    try {
      assert.equal(
        startedAfterOff,
        false,
        `Discovery started after off at cut ${cut}`,
      );
      if (entered) {
        assert.equal((await a.legion.state()).mode, "stopping");
        const replacement = new Legion(a.options);
        const blocked = await replacement.command({
          text: `resume ${a.owner}`,
          requestKey: `replacement-${cut}`,
          evidence: {
            origin: "host-command",
            transport: "source-unavailable",
            session: a.options.session,
            generation: null,
            presented: [],
          },
        });
        assert.equal(blocked.kind, "rejected");
        if (blocked.kind !== "rejected")
          assert.fail("Expected retained ownership");
        assert.equal(blocked.code, "ownership");
      }
    } finally {
      release();
      await running;
      await a.command("off");
    }
    assert.equal((await a.legion.state()).mode, "inactive");
  }
});

for (const phase of ["locate", "parent", "inspect"] as const) {
  test(`off drains held Git ${phase} and preserves intake ownership until settlement`, async () => {
    const { root, git } = await repository();
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pause = async () => {
      entered();
      await barrier;
    };
    if (phase === "locate") {
      const original = git.locate;
      git.locate = async () => {
        await pause();
        return original();
      };
    } else if (phase === "parent") {
      const original = git.parent;
      git.parent = async (branch) => {
        await pause();
        return original(branch);
      };
    } else {
      const original = git.inspect;
      git.inspect = async (plan) => {
        await pause();
        return original(plan);
      };
    }
    const a = await legatus(root, git, `session-read-${phase}`);
    await a.command(
      `reserve ${a.task.id}@1 --parent refs/heads/intended`,
      "read",
    );
    const running = a.legion.command({ workspaceRequest: "read" });
    await started;
    try {
      await a.command("off");
      assert.equal((await a.legion.state()).mode, "stopping");
      assert.equal((await a.command(`resume ${a.owner}`)).kind, "rejected");
      await a.command("off");
      assert.equal((await a.legion.state()).mode, "stopping");
      const contender = new Legion(a.options);
      const blocked = await contender.command({
        text: `resume ${a.owner}`,
        requestKey: "replacement",
        evidence: {
          origin: "host-command",
          transport: "source-unavailable",
          session: a.options.session,
          generation: null,
          presented: [],
        },
      });
      assert.equal(blocked.kind, "rejected");
      if (blocked.kind !== "rejected")
        assert.fail("Expected retained lease ownership");
      assert.equal(blocked.code, "ownership");
    } finally {
      release();
      await running;
    }
    const result = await running;
    const view = await a.legion.state();
    assert.equal(view.mode, "inactive");
    assert.equal(view.snapshot?.id, a.owner);
    assert.equal(result.kind, phase === "inspect" ? "reserved" : "uncertain");
    if (phase === "inspect") {
      assert.equal(view.tasks[0]?.claim.kind, "owned");
      if (result.kind !== "reserved" || result.workspace.kind !== "held")
        assert.fail("Expected retained reservation");
      assert.equal(result.workspace.code, "approval");
    }
  });
}

test("concurrent exact request delivery returns one immutable receipt without a duplicate effect", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-delivery");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "delivery",
  );
  const [one, two] = await Promise.all([
    a.legion.command({ workspaceRequest: "delivery" }),
    a.legion.command({ workspaceRequest: "delivery" }),
  ]);
  assert.equal(one.kind, "reserved");
  assert.equal(two.kind, "reserved");
  if (one.kind !== "reserved" || two.kind !== "reserved")
    assert.fail("Expected immutable receipts");
  assert.deepEqual(one.receipt, two.receipt);
  assert.equal((await a.legion.state()).ownerObservations?.length, 1);
  await a.command("off");
});

for (const affected of [true, false]) {
  test(`${affected ? "affected" : "unrelated"} decisions during Git preserve the branch and control only the next affected effect`, async () => {
    const { root, git } = await repository();
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let branch: string | null = null;
    let workspace: Awaited<
      ReturnType<WorkspaceRepository["inspect"]>
    >["workspace"] = null;
    git.createBranch = async (plan) => {
      entered();
      await barrier;
      branch = plan.commit;
      return { kind: "succeeded" };
    };
    git.createWorktree = async (plan) => {
      workspace = {
        commonDir: join(root, "repo.git"),
        branch: plan.branch,
        commit: plan.commit,
        backlink: true,
      };
      return { kind: "succeeded" };
    };
    git.inspect = async () => ({
      branch,
      path: workspace ? "directory" : "absent",
      workspace,
      parent: "a".repeat(40),
    });
    const a = await legatus(root, git, `session-decision-${affected}`);
    await a.command(
      `reserve ${a.task.id}@1 --parent refs/heads/intended`,
      "decision",
    );
    const running = a.legion.command({ workspaceRequest: "decision" });
    await started;
    let view = await a.legion.state();
    let source;
    if (affected) {
      await a.legion.submit({
        kind: "message",
        text: "Expand the requirements",
        requestKey: "correction",
        evidence: {
          origin: "emperor",
          transport: "rpc",
          session: a.options.session,
          generation: view.snapshot?.generation,
          presented: [],
        },
      });
      source = (await a.legion.state()).snapshot?.submissions.at(-1);
    } else {
      await a.command("task Independent ambiguity");
      source = (await a.legion.state()).snapshot?.submissions.at(-1);
    }
    assert.ok(source);
    view = await a.legion.state();
    const proposal = affected
      ? {
          kind: "propose-amendment",
          source: { id: source.id, revision: 1 },
          affected: [{ id: a.task.id, revision: 1 }],
          category: "requirements",
          change: "Expand requirements",
          question: "Approve the expansion?",
          recommendation: "Wait",
        }
      : {
          kind: "new-task",
          source: { id: source.id, revision: 1 },
          goal: "Independent ambiguity",
          acceptance: [],
          questions: [{ question: "Which label?", recommendation: "Wait" }],
        };
    assert.equal(
      (
        await a.legion.submit({
          kind: "interpretation",
          requestKey: "decision-interpret",
          proposal,
          evidence: {
            session: a.options.session,
            generation: view.snapshot?.generation,
            legatus: a.owner,
            run: "test",
            sources: [{ id: source.id, revision: 1 }],
          },
        })
      ).kind,
      "applied",
    );
    assert.equal(
      (await a.legion.state()).tasks[0]?.eligibility,
      affected ? "blocked" : "admitted",
    );
    release();
    const result = await running;
    assert.equal(result.kind, "reserved");
    if (result.kind !== "reserved") assert.fail("Expected retained claim");
    assert.equal(result.workspace.kind, affected ? "held" : "ready");
    if (affected && result.workspace.kind === "held")
      assert.equal(result.workspace.code, "approval");
    assert.equal(branch, "a".repeat(40));
    await a.command("off");
  });
}

test("one owner cannot substitute another local task for an already bound external identity", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-alias");
  const source = "https://github.com/Fixture/Project/issues/12";
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended --source ${source}`,
    "first-binding",
  );
  const first = await a.legion.command({ workspaceRequest: "first-binding" });
  assert.equal(first.kind, "reserved");
  await a.command("task Another local task");
  const view = await a.legion.state();
  const submission = view.snapshot?.submissions.at(-1);
  assert.ok(submission);
  await a.legion.submit({
    kind: "interpretation",
    requestKey: "second-task",
    proposal: {
      kind: "new-task",
      source: { id: submission.id, revision: 1 },
      goal: "Another local task",
      acceptance: [],
      questions: [],
    },
    evidence: {
      session: a.options.session,
      generation: view.snapshot?.generation,
      legatus: view.snapshot?.id,
      run: "test",
      sources: [{ id: submission.id, revision: 1 }],
    },
  });
  const second = (await a.legion.state()).tasks[1];
  assert.ok(second);
  await a.command(
    `reserve ${second.id}@1 --parent refs/heads/intended --source ${source}`,
    "substitution",
  );
  const rejected = await a.legion.command({ workspaceRequest: "substitution" });
  assert.equal(rejected.kind, "rejected");
  if (rejected.kind !== "rejected") assert.fail("Expected binding conflict");
  assert.equal(rejected.code, "binding-conflict");
  assert.match(rejected.message, /Another local task/);
  const state = await a.legion.state();
  assert.equal(state.tasks[0]?.claim.kind, "owned");
  assert.equal(state.ownerObservations?.length, 1);
  await a.command("off");
});

test("explicit resume recovers only known interrupted ledger publication without a Git effect", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-initialization");
  assert.ok(a.options.assignments);
  let fail = true;
  a.options.assignments.fault = (point) => {
    if (fail && point === "after-initialization") {
      fail = false;
      throw new Error("Interrupted initialization witness");
    }
  };
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended`;
  await a.command(text, "initialization");
  assert.equal(
    (await a.legion.command({ workspaceRequest: "initialization" })).kind,
    "uncertain",
  );
  assert.equal((await a.legion.state()).tasks[0]?.claim.kind, "unavailable");
  await a.command("off");
  const reopened = new Legion(a.options);
  const host = {
    origin: "host-command",
    transport: "source-unavailable",
    session: a.options.session,
    generation: null,
    presented: [],
  };
  assert.equal(
    (
      await reopened.command({
        text: `resume ${a.owner}`,
        requestKey: "resume-init",
        evidence: host,
      })
    ).kind,
    "applied",
  );
  assert.equal((await reopened.state()).tasks[0]?.claim.kind, "unreserved");
  await reopened.command({ text, requestKey: "fresh-init", evidence: host });
  const result = await reopened.command({ workspaceRequest: "fresh-init" });
  assert.equal(result.kind, "reserved");
  await reopened.command({ text: "off", requestKey: "off", evidence: host });
});

test("revocation at durable dispatch never starts the Git invocation", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-dispatch-race");
  assert.ok(a.options.assignments);
  a.options.assignments.fault = (point) => {
    if (point === "after-dispatch") void a.command("off");
  };
  git.createBranch = async () => {
    throw new Error("Revoked Git must not start");
  };
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "race",
  );
  const result = await a.legion.command({ workspaceRequest: "race" });
  assert.equal(result.kind, "reserved");
  if (result.kind !== "reserved" || result.workspace.kind !== "held")
    assert.fail("Expected retained hold");
  assert.equal(result.workspace.code, "approval");
  assert.equal((await a.legion.state()).mode, "inactive");
});

test("matching resources without a success receipt remain unknown after reopening and explicit reconciliation", async () => {
  const { root, git } = await repository();
  let branch: string | null = null;
  git.createBranch = async (plan) => {
    branch = plan.commit;
    return { kind: "succeeded" };
  };
  git.inspect = async () => ({
    branch,
    path: "absent",
    workspace: null,
    parent: "a".repeat(40),
  });
  const a = await legatus(root, git, "session-unknown");
  let fault = true;
  assert.ok(a.options.assignments);
  a.options.assignments.fault = (point) => {
    if (fault && point === "before-outcome-commit") {
      fault = false;
      throw new Error("Lost definitive receipt");
    }
  };
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "unknown",
  );
  assert.equal(
    (await a.legion.command({ workspaceRequest: "unknown" })).kind,
    "uncertain",
  );
  await a.command("off");
  const reopened = new Legion(a.options);
  const host = {
    origin: "host-command",
    transport: "source-unavailable",
    session: a.options.session,
    generation: null,
    presented: [],
  };
  await reopened.command({
    text: `resume ${a.owner}`,
    requestKey: "resume",
    evidence: host,
  });
  await reopened.command({
    text: `reconcile ${a.task.id}`,
    requestKey: "inspect",
    evidence: host,
  });
  git.createBranch = async () => {
    throw new Error("Unknown completion must never retry");
  };
  const result = await reopened.command({ workspaceRequest: "inspect" });
  assert.equal(result.kind, "reserved");
  if (result.kind !== "reserved") assert.fail("Expected retained reservation");
  assert.equal(result.workspace.kind, "held");
  if (result.workspace.kind !== "held") assert.fail("Expected unknown hold");
  assert.equal(result.workspace.code, "unknown-operation");
  assert.match(result.message, /Git operation completion is unknown/);
  assert.match(result.message, /No retry was performed/);
  assert.match(result.workspace.message, /Preserve these resources/);
  assert.ok(result.workspace.operation?.id);
  assert.equal(branch, "a".repeat(40));
  await reopened.command({ text: "off", requestKey: "off", evidence: host });
});

test("uncertain deferred publication revokes execution even when the request survived", async () => {
  const { root, git } = await repository();
  let fail = false;
  const a = await legatus(root, git, "session-publication", (point) => {
    if (fail && point === "after-commit") {
      fail = false;
      throw new Error("Lost pending receipt");
    }
  });
  fail = true;
  const recorded = await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "lost-pending",
  );
  assert.equal(recorded.kind, "uncertain");
  assert.equal((await a.legion.state()).mode, "inactive");
  const refused = await a.legion.command({ workspaceRequest: "lost-pending" });
  assert.equal(refused.kind, "rejected");
  assert.equal(
    (await a.legion.state()).snapshot?.workspaceRequests[0]?.id,
    "lost-pending",
  );
  const reopened = new Legion(a.options);
  const resumed = await reopened.command({
    text: `resume ${a.owner}`,
    requestKey: "resume",
    evidence: {
      origin: "host-command",
      transport: "source-unavailable",
      session: a.options.session,
      generation: null,
      presented: [],
    },
  });
  assert.equal(resumed.kind, "applied");
  assert.equal(
    (await reopened.command({ workspaceRequest: "lost-pending" })).kind,
    "rejected",
  );
  await reopened.command({
    text: "off",
    requestKey: "off",
    evidence: {
      origin: "host-command",
      transport: "source-unavailable",
      session: a.options.session,
      generation: null,
      presented: [],
    },
  });
});

test("off revokes immediately, drains the child, and retains a visible approval hold", async () => {
  const { root, git } = await repository();
  let release!: () => void;
  let started!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let branch: string | null = null;
  git.createBranch = async (plan) => {
    started();
    await barrier;
    branch = plan.commit;
    return { kind: "succeeded" };
  };
  git.inspect = async () => ({
    branch,
    path: "absent",
    workspace: null,
    parent: "a".repeat(40),
  });
  const a = await legatus(root, git, "session-stop");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "stop",
  );
  const running = a.legion.command({ workspaceRequest: "stop" });
  await entered;
  assert.equal(
    (await a.command("task Independent submission during Git")).kind,
    "saved",
  );
  assert.equal(
    (await a.legion.state()).snapshot?.submissions.at(-1)?.text,
    "Independent submission during Git",
  );
  await a.command("off");
  assert.equal((await a.legion.state()).mode, "stopping");
  assert.equal((await a.command(`resume ${a.owner}`)).kind, "rejected");
  await a.command("off");
  assert.equal((await a.legion.state()).mode, "stopping");
  release();
  const result = await running;
  assert.equal(result.kind, "reserved");
  if (result.kind !== "reserved") assert.fail("Expected retained reservation");
  assert.equal(result.workspace.kind, "held");
  const state = await a.legion.state();
  assert.equal(state.mode, "inactive");
  assert.equal(state.tasks[0]?.claim.kind, "owned");
  if (state.tasks[0]?.claim.kind !== "owned") assert.fail("Expected ownership");
  assert.equal(state.tasks[0].claim.workspace.kind, "held");
});

test("explicit reconciliation retries a proven failed branch at the original plan", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-retry");
  await a.command(
    `reserve ${a.task.id}@1 --parent refs/heads/intended`,
    "failed",
  );
  const failed = await a.legion.command({ workspaceRequest: "failed" });
  assert.equal(failed.kind, "reserved");
  if (failed.kind !== "reserved") assert.fail("Expected retained reservation");
  let branch: string | null = null;
  let workspace: Awaited<
    ReturnType<WorkspaceRepository["inspect"]>
  >["workspace"] = null;
  git.inspect = async () => ({
    branch,
    path: workspace ? "directory" : "absent",
    workspace,
    parent: "b".repeat(40),
  });
  git.parent = async () => {
    throw new Error("Moved parent must not be resolved again");
  };
  git.createBranch = async (plan) => {
    branch = plan.commit;
    return { kind: "succeeded" };
  };
  git.createWorktree = async (plan) => {
    workspace = {
      commonDir: join(root, "repo.git"),
      branch: plan.branch,
      commit: plan.commit,
      backlink: true,
    };
    return { kind: "succeeded" };
  };
  assert.equal(
    (await a.command(`reconcile ${a.task.id}`, "retry")).kind,
    "deferred",
  );
  const retried = await a.legion.command({ workspaceRequest: "retry" });
  assert.equal(retried.kind, "reserved");
  if (retried.kind !== "reserved") assert.fail("Expected reservation");
  assert.deepEqual(retried.workspace, { kind: "ready" });
  assert.deepEqual(retried.receipt.reservation, failed.receipt.reservation);
  assert.equal(retried.receipt.reservation.plan.commit, "a".repeat(40));
  assert.deepEqual(retried.parentObservation, {
    kind: "observed",
    commit: "b".repeat(40),
  });
  await a.command("off");
});

test("successful reservation verifies both stages and exact replay never creates another resource", async () => {
  const { root, git } = await repository();
  let branch: string | null = null;
  let workspace: Awaited<
    ReturnType<WorkspaceRepository["inspect"]>
  >["workspace"] = null;
  const ready: WorkspaceRepository = {
    ...git,
    inspect: async () => ({
      branch,
      path: workspace ? "directory" : "absent",
      workspace,
      parent: "a".repeat(40),
    }),
    createBranch: async (plan) => {
      branch = plan.commit;
      return { kind: "succeeded" };
    },
    createWorktree: async (plan) => {
      workspace = {
        commonDir: join(root, "repo.git"),
        branch: plan.branch,
        commit: plan.commit,
        backlink: true,
      };
      return { kind: "succeeded" };
    },
  };
  const a = await legatus(root, ready, "session-ready");
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended`;
  assert.equal((await a.command(text, "ready")).kind, "deferred");
  const result = await a.legion.command({ workspaceRequest: "ready" });
  assert.equal(result.kind, "reserved");
  if (result.kind !== "reserved") assert.fail("Expected reserved");
  assert.deepEqual(result.workspace, { kind: "ready" });
  assert.equal(
    result.message,
    "Task reserved. Workspace ready. No worker started.",
  );
  ready.parent = async () => {
    throw new Error("Parent was deleted");
  };
  ready.createBranch = async () => {
    throw new Error("Replay must not create");
  };
  ready.createWorktree = async () => {
    throw new Error("Replay must not create");
  };
  const replay = await a.command(text, "ready");
  assert.equal(replay.kind, "reserved");
  if (replay.kind !== "reserved") assert.fail("Expected replay");
  assert.deepEqual(replay.receipt, result.receipt);
  assert.deepEqual(replay.workspace, { kind: "ready" });
  assert.equal(
    (
      await a.command(
        `reserve ${a.task.id}@1 --parent refs/heads/other`,
        "ready",
      )
    ).kind,
    "rejected",
  );
  await a.command("off");
});

test("unavailable assignment authority retains its exact pending request and gives explicit fresh authorization guidance", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-busy-guidance");
  assert.ok(a.options.assignments);
  a.options.assignments.fault = (point) => {
    if (point === "before-reservation-commit")
      throw new Error("database is locked");
  };
  const text = `reserve ${a.task.id}@1 --parent refs/heads/intended --source https://github.com/Fixture/Project/issues/78`;
  await a.command(text, "busy-request");
  const pending = (await a.legion.state()).snapshot?.workspaceRequests[0];
  assert.ok(pending);
  const result = await a.legion.command({ workspaceRequest: "busy-request" });
  assert.equal(result.kind, "uncertain");
  if (result.kind !== "uncertain")
    assert.fail("Expected unavailable authority");
  assert.match(result.message, /database is locked/);
  assert.ok(result.message.includes(`/legion status ${a.owner}`));
  assert.ok(result.message.includes(`/legion resume ${a.owner}`));
  assert.ok(result.message.includes(`/legion ${text}`));
  assert.match(result.message, /fresh/);
  assert.match(result.message, /No automatic retry was performed/);
  const retained = (await a.legion.state()).snapshot?.workspaceRequests[0];
  assert.equal(retained?.id, pending.id);
  assert.equal(retained?.fingerprint, pending.fingerprint);
  assert.deepEqual(retained?.intent, pending.intent);
  await a.command("off");
  delete a.options.assignments.fault;
  await a.command(`resume ${a.owner}`);
  assert.equal(
    (await a.legion.command({ workspaceRequest: "busy-request" })).kind,
    "rejected",
  );
  assert.equal(
    (await a.command(text, "explicit-fresh-request")).kind,
    "deferred",
  );
  assert.equal(
    (await a.legion.command({ workspaceRequest: "explicit-fresh-request" }))
      .kind,
    "reserved",
  );
  await a.command("off");
});

test("simultaneous distinct Legati elect one same-task owner and retain the losing blocker after restart", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "contender-a");
  const b = await legatus(root, git, "contender-b");
  assert.notEqual(a.owner, b.owner);
  assert.notEqual(a.task.id, b.task.id);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const both = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let arrivals = 0;
  git.parent = async () => {
    if (++arrivals === 2) entered();
    await gate;
    return "a".repeat(40);
  };
  const branches = new Map<string, string>();
  const workspaces = new Map<
    string,
    NonNullable<
      Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"]
    >
  >();
  git.createBranch = async (plan) => {
    branches.set(plan.branch, plan.commit);
    return { kind: "succeeded" };
  };
  git.createWorktree = async (plan) => {
    workspaces.set(plan.path, {
      commonDir: join(root, "repo.git"),
      branch: plan.branch,
      commit: plan.commit,
      backlink: true,
    });
    return { kind: "succeeded" };
  };
  git.inspect = async (plan) => ({
    branch: branches.get(plan.branch) ?? null,
    path: workspaces.has(plan.path) ? "directory" : "absent",
    workspace: workspaces.get(plan.path) ?? null,
    parent: "a".repeat(40),
  });
  for (const [actor, key] of [
    [a, "claim-a"],
    [b, "claim-b"],
  ] as const)
    await actor.command(
      `reserve ${actor.task.id}@1 --parent refs/heads/intended --source https://github.com/Fixture/Project/issues/77`,
      key,
    );
  const running = Promise.all([
    a.legion.command({ workspaceRequest: "claim-a" }),
    b.legion.command({ workspaceRequest: "claim-b" }),
  ]);
  await both;
  release();
  const results = await running;
  assert.deepEqual(results.map((r) => r.kind).sort(), [
    "ownership-blocked",
    "reserved",
  ]);
  const winner = results.find((r) => r.kind === "reserved");
  const loser = results.find((r) => r.kind === "ownership-blocked");
  if (winner?.kind !== "reserved" || loser?.kind !== "ownership-blocked")
    assert.fail("Expected one owner and one blocker");
  assert.deepEqual(winner.workspace, { kind: "ready" });
  assert.deepEqual(loser.reservation, winner.receipt.reservation);
  assert.equal(branches.size, 1);
  assert.equal(workspaces.size, 1);
  for (const actor of [a, b]) {
    await actor.command("off");
    const restarted = await new Legion(actor.options).state();
    assert.equal(restarted.mode, "inactive");
    assert.equal(restarted.ownerObservations?.length, 1);
    const claim = restarted.tasks[0]?.claim;
    if (actor.owner === winner.receipt.reservation.owner) {
      assert.equal(claim?.kind, "owned");
      if (claim?.kind !== "owned") assert.fail("Expected retained winner");
      assert.deepEqual(claim.workspace, { kind: "ready" });
      assert.deepEqual(claim.reservation, winner.receipt.reservation);
    } else {
      assert.equal(claim?.kind, "foreign");
      if (claim?.kind !== "foreign")
        assert.fail("Expected retained loser blocker");
      assert.deepEqual(claim.reservation, winner.receipt.reservation);
    }
  }
});

test("two Legati retain one external reservation and its ownership blocker after reopening", async () => {
  const { root, git } = await repository();
  const a = await legatus(root, git, "session-a");
  const b = await legatus(root, git, "session-b");
  assert.notEqual(a.task.id, b.task.id);
  const source = "https://github.com/Example/Project/issues/7";
  const reserve = (task: typeof a.task) =>
    `reserve ${task.id}@1 --parent refs/heads/parent --source ${source}`;
  const deferredA = await a.command(reserve(a.task), "reserve-a");
  assert.equal(deferredA.kind, "deferred");
  const owned = await a.legion.command({ workspaceRequest: "reserve-a" });
  assert.equal(owned.kind, "reserved");
  const deferredB = await b.command(reserve(b.task), "reserve-b");
  assert.equal(deferredB.kind, "deferred");
  const rejected = await b.legion.command({ workspaceRequest: "reserve-b" });
  assert.equal(rejected.kind, "ownership-blocked");
  if (owned.kind !== "reserved" || rejected.kind !== "ownership-blocked")
    assert.fail("Expected reservation and blocker");
  assert.equal(rejected.reservation.id, owned.receipt.reservation.id);
  assert.equal(rejected.reservation.owner, a.owner);
  assert.equal(owned.workspace.kind, "held");
  await a.command("off");
  await b.command("off");
  const reopened = await new Legion(b.options).state();
  assert.equal(reopened.mode, "inactive");
  assert.equal(reopened.tasks[0]?.claim.kind, "foreign");
  if (reopened.tasks[0]?.claim.kind !== "foreign")
    assert.fail("Expected retained foreign owner");
  assert.equal(
    reopened.tasks[0].claim.reservation.id,
    owned.receipt.reservation.id,
  );
  assert.equal(reopened.tasks[0].claim.reservation.owner, a.owner);
});
