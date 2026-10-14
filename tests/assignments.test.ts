import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LaunchRecord } from "../src/tribunus.js";
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
async function legatus({ root, git, session, fault, context = join(root, "checkout") }: {
  root: string;
  git: WorkspaceRepository;
  session: string;
  fault?: LegionOptions["storageFault"];
  context?: string;
}) {
  const options: LegionOptions = {
    storagePath: join(root, session),
    context,
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

for (const corruption of ["attempt", "reservation", "row"] as const) {
  test(`known launch ${corruption} mismatch stays unavailable instead of projecting another attempt`, async () => {
    const { root, git } = await repository();
    const a = await legatus({ root, git, session: "launch-history" });
    try {
      await a.command(`reserve ${a.task.id}@1 --parent refs/heads/main`, "reserve");
      const reserved = await a.legion.command({ workspaceRequest: "reserve" });
      if (reserved.kind !== "reserved") assert.fail("Expected retained reservation");
      const reservation = reserved.receipt.reservation;
      const { DatabaseSync } = await import("node:sqlite");
      const ledger = new DatabaseSync(join(root, "repo.git", "legion", "runs", reservation.owner, "assignments.sqlite"));
      const aggregate = new DatabaseSync(join(a.options.storagePath, `v1.${reservation.owner}.sqlite`));
      try {
        const launch = LaunchRecord.parse({ id: randomUUID(), reservation: corruption === "reservation" ? randomUUID() : reservation.id, revision: 0, scope: reservation.approval.scope, state: { kind: "prepared" } });
        ledger.exec("CREATE TABLE legion_schema (singleton INTEGER PRIMARY KEY, version INTEGER); INSERT INTO legion_schema VALUES(1,2); CREATE TABLE tribuni (reservation TEXT PRIMARY KEY, id TEXT UNIQUE, revision INTEGER, value TEXT);");
        ledger.prepare("INSERT INTO tribuni VALUES(?,?,?,?)").run(reservation.id, corruption === "row" ? randomUUID() : launch.id, launch.revision, JSON.stringify(launch));
        const snapshot = (await a.legion.state()).snapshot;
        assert.ok(snapshot);
        const request = snapshot.workspaceRequests[0];
        assert.ok(request);
        snapshot.launchRequests.push({ id: "known-launch", task: reservation.approval.task, scope: reservation.approval.scope, evidence: request.evidence, generation: snapshot.generation, epoch: 0, repository: join(root, "repo.git"), repositoryId: reservation.repository, attempt: corruption === "attempt" ? randomUUID() : launch.id });
        aggregate.prepare("UPDATE snapshot SET value=? WHERE singleton=1").run(JSON.stringify(snapshot));
      } finally { ledger.close(); aggregate.close(); }
      const view = await a.legion.state();
      assert.equal(view.tasks[0]?.launch.kind, "unavailable");
      if (view.tasks[0]?.launch.kind === "unavailable") {
        const message = corruption === "attempt" ? /Known launch identity changed/ : corruption === "reservation" ? /Launch reservation history changed/ : /Launch row identity changed/;
        assert.match(view.tasks[0].launch.message, message);
      }
      assert.equal((await a.command(`launch ${a.task.id}@1`, "cannot-adopt-other-attempt")).kind, "rejected");
    } finally { await a.command("off"); }
  });
}

test("explicit restart refuses missing initialized reservations even when their task bindings were also lost", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "missing-reservation" });
  await a.command(`reserve ${a.task.id}@1 --parent refs/heads/main`, "reserve");
  const reserved = await a.legion.command({ workspaceRequest: "reserve" });
  if (reserved.kind !== "reserved") assert.fail("Expected retained reservation");
  await a.command("off");
  const file = join(root, "repo.git", "legion", "runs", reserved.receipt.reservation.owner, "assignments.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  try { db.exec("DELETE FROM claims; DELETE FROM bindings;"); }
  finally { db.close(); }
  const ledgerBytes = await readFile(file);
  const aggregate = join(a.options.storagePath, `v1.${a.owner}.sqlite`);
  const aggregateBytes = await readFile(aggregate);
  const restarted = new Legion(a.options);
  for (const key of ["resume-first", "resume-again"]) {
    const result = await restarted.command({ text: `resume ${a.owner}`, requestKey: key, evidence: { origin: "host-command", transport: "source-unavailable", session: a.options.session, generation: null, presented: [] } });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") {
      assert.equal(result.code, "assignment-recovery");
      assert.match(result.message, /Known reservation ownership evidence is missing/);
    }
    assert.equal((await restarted.state()).mode, "inactive");
    assert.deepEqual(await readFile(file), ledgerBytes);
    assert.deepEqual(await readFile(aggregate), aggregateBytes);
  }
});

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
  const a = await legatus({ root, git, session: "session-corrupt-stopping" });
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
    try {
      const restored = await a.legion.state();
      assert.equal(restored.mode, "stopping", "Readable storage cannot settle the admitted invocation");
      assert.equal(restored.snapshot?.shutdown, null, "Observation cannot publish the pending off when storage returns");
      assert.ok(restored.unavailable, "Pending publication remains a visible blocker");
      const replacement = new Legion(a.options);
      const refused = await replacement.command({ text: `resume ${a.owner}`, requestKey: "restored-replacement", evidence: { origin: "host-command", transport: "source-unavailable", session: a.options.session, generation: null, presented: [] } });
      assert.equal(refused.kind, "rejected", "Restored storage does not release the in-flight owner");
    } finally {
      release();
      await running;
    }
  }
  const settled = await a.legion.state();
  assert.equal(settled.mode, "inactive");
  assert.ok(settled.snapshot?.shutdown, "Actual invocation completion publishes and finalizes the pending stop without another off");
  assert.equal(settled.snapshot.shutdown.epoch, 0);
  const reopened = new Legion(a.options);
  assert.equal((await reopened.state()).snapshot?.id, a.owner);
  assert.equal((await reopened.command({ text: `resume ${a.owner}`, requestKey: "settled-replacement", evidence: { origin: "host-command", transport: "source-unavailable", session: a.options.session, generation: null, presented: [] } })).kind, "applied", "Completion releases the exclusive locks");
  await reopened.command({ text: "off", requestKey: "settled-off", evidence: { origin: "host-command", transport: "source-unavailable", session: a.options.session, generation: null, presented: [] } });
});

test("state, status and doctor leave failed shutdown publication pending until explicit off", async () => {
  const { root, git } = await repository();
  let unavailable = false;
  const a = await legatus({ root, git, session: "session-stop-publication", fault: point => {
    if (unavailable && point === "before-commit") throw new Error("Stop publication unavailable");
  } });
  const before = (await a.legion.state()).snapshot;
  assert.ok(before);
  unavailable = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const stopped = await a.command("off");
      if (stopped.kind !== "observed") assert.fail("Expected retained shutdown diagnostic");
      assert.equal(stopped.view.mode, "stopping");
      assert.match(stopped.view.unavailable ?? "", /Stop publication unavailable/);
      assert.equal((await a.command(`resume ${a.owner}`)).kind, "rejected");
    }
  } finally {
    unavailable = false;
  }
  const file = join(a.options.storagePath, `v1.${a.owner}.sqlite`);
  const durable = await readFile(file);
  const observations = await Promise.all([a.legion.state(), a.legion.state()]);
  for (const text of ["status", `status ${a.owner}`, "doctor"]) {
    const result = await a.command(text);
    if (result.kind !== "observed") assert.fail("Expected read-only observation");
    observations.push(result.view);
  }
  for (const view of observations) {
    assert.equal(view.mode, "stopping");
    assert.equal(view.snapshot?.shutdown, null, "Observation must not publish the pending stop");
    assert.equal(view.snapshot?.revision, before.revision);
  }
  assert.deepEqual(await readFile(file), durable, "State/status/doctor must preserve durable bytes");
  const stopped = await a.command("off");
  if (stopped.kind !== "observed") assert.fail("Expected explicit shutdown reconciliation");
  assert.equal(stopped.view.mode, "inactive");
  assert.ok(stopped.view.snapshot?.shutdown);
  assert.equal(stopped.view.snapshot.shutdown.generation, before.generation);
  assert.equal(stopped.view.snapshot.shutdown.epoch, 0, "Retry cannot replace the authority captured by the first off");
  assert.equal(stopped.view.snapshot.revision, before.revision + 1);
  await a.command("off");
  assert.deepEqual((await a.legion.state()).snapshot, stopped.view.snapshot);
});

test("off with no worker publishes only its required shutdown record", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "session-empty-stop" });
  const before = (await a.legion.state()).snapshot;
  assert.ok(before);
  const stopped = await a.command("off");
  if (stopped.kind !== "observed") assert.fail("Expected shutdown observation");
  assert.equal(stopped.view.mode, "inactive");
  assert.ok(stopped.view.snapshot?.shutdown);
  assert.deepEqual(stopped.view.snapshot.shutdown.workers, []);
  assert.equal(stopped.view.snapshot.revision, before.revision + 1, "No empty worker-list publication after the required stop persistence");
  await a.command("off");
  assert.deepEqual((await a.legion.state()).snapshot, stopped.view.snapshot);
});

test("off at authorization await boundaries never starts discovery after revocation or releases an unsettled owner", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "session-authorization-boundary" });
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
    const a = await legatus({ root, git, session: `session-read-${phase}` });
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
  const a = await legatus({ root, git, session: "session-delivery" });
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
    const a = await legatus({ root, git, session: `session-decision-${affected}` });
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
  const a = await legatus({ root, git, session: "session-alias" });
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
  const a = await legatus({ root, git, session: "session-initialization" });
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
  const a = await legatus({ root, git, session: "session-dispatch-race" });
  assert.ok(a.options.assignments);
  let off: ReturnType<typeof a.command> | undefined;
  a.options.assignments.fault = (point) => {
    if (point === "after-dispatch") off = a.command("off");
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
  assert.ok(off, "Durable dispatch requested revocation");
  await off;
  assert.equal((await a.legion.state()).mode, "inactive");
});

test("explicit resume preserves an unknown Git action with incomplete association without authorizing retry", async () => {
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
  const a = await legatus({ root, git, session: "session-unknown" });
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
  const saved = (await reopened.state()).snapshot;
  const refused = await reopened.command({ text: `resume ${a.owner}`, requestKey: "resume", evidence: host });
  assert.equal(refused.kind, "rejected");
  if (refused.kind !== "rejected") assert.fail("Expected explicit retained-resource blocker");
  assert.equal(refused.code, "resume-resources");
  assert.match(refused.message, /Git operation.*unresolved/);
  assert.match(refused.message, /Preserve.*no retry/);
  git.createBranch = async () => { throw new Error("Unknown completion must never retry"); };
  assert.equal((await reopened.command({ text: `reconcile ${a.task.id}`, requestKey: "inspect", evidence: host })).kind, "rejected");
  assert.equal((await reopened.command({ workspaceRequest: "inspect" })).kind, "rejected");
  const retained = await reopened.state(), claim = retained.tasks[0]?.claim;
  if (claim?.kind !== "owned" || claim.workspace.kind !== "dispatched") assert.fail("Exact unknown dispatched action must remain visible");
  assert.ok(claim.workspace.operation.id);
  assert.deepEqual(retained.snapshot, saved, "Refusal cannot attach, record another action, or rewrite the unknown request");
  assert.equal(branch, "a".repeat(40));
  await reopened.command({ text: "off", requestKey: "off", evidence: host });
});

test("uncertain deferred publication revokes execution even when the request survived", async () => {
  const { root, git } = await repository();
  let fail = false;
  const a = await legatus({ root, git, session: "session-publication", fault: (point) => {
    if (fail && point === "after-commit") {
      fail = false;
      throw new Error("Lost pending receipt");
    }
  } });
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
  const a = await legatus({ root, git, session: "session-stop" });
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
  const a = await legatus({ root, git, session: "session-retry" });
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
  const a = await legatus({ root, git: ready, session: "session-ready" });
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

test("unavailable assignment authority retains its exact pending request; absent durable rollback evidence blocks fresh authorization", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "session-busy-guidance" });
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
  // A rollback occurred in this fixture, but no durable no-effect witness survives it.
  // Empty ledger rows cannot distinguish rollback from missing committed history after restart.
  const saved = (await a.legion.state()).snapshot;
  const refused = await a.command(`resume ${a.owner}`);
  assert.equal(refused.kind, "rejected");
  if (refused.kind !== "rejected") assert.fail("Expected preserved rollback uncertainty");
  assert.match(refused.message, /no durable no-effect witness/);
  assert.equal((await a.legion.command({ workspaceRequest: "busy-request" })).kind, "rejected");
  assert.equal((await a.command(text, "explicit-fresh-request")).kind, "rejected");
  assert.equal((await a.legion.command({ workspaceRequest: "explicit-fresh-request" })).kind, "rejected");
  assert.deepEqual((await a.legion.state()).snapshot, saved, "No new request, input loss, or blind Git retry");
  await a.command("off");
});

test("independent Legati reserve the same issue in distinct run-owned workspaces after restart", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "contender-a" });
  const linked = join(root, "linked");
  await mkdir(linked);
  const b = await legatus({ root, git, session: "contender-b", context: linked });
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
  assert.deepEqual(results.map((r) => r.kind), ["reserved", "reserved"]);
  const [one, two] = results;
  if (one?.kind !== "reserved" || two?.kind !== "reserved")
    assert.fail("Expected independent run ownership");
  assert.deepEqual(one.workspace, { kind: "ready" });
  assert.deepEqual(two.workspace, { kind: "ready" });
  assert.notEqual(one.receipt.reservation.id, two.receipt.reservation.id);
  assert.notEqual(one.receipt.reservation.repository, two.receipt.reservation.repository);
  assert.notEqual(one.receipt.reservation.plan.branch, two.receipt.reservation.plan.branch);
  assert.notEqual(one.receipt.reservation.plan.path, two.receipt.reservation.plan.path);
  assert.equal(branches.size, 2);
  assert.equal(workspaces.size, 2);
  for (const [actor, result] of [[a, one], [b, two]] as const) {
    await actor.command("off");
    const restarted = await new Legion(actor.options).state();
    assert.equal(restarted.mode, "inactive");
    assert.equal(restarted.ownerObservations?.length, 1);
    const claim = restarted.tasks[0]?.claim;
    if (claim?.kind !== "owned") assert.fail("Expected only this run's reservation");
    assert.deepEqual(claim.workspace, { kind: "ready" });
    assert.deepEqual(claim.reservation, result.receipt.reservation);
    assert.equal(claim.reservation.owner, actor.owner);
  }
});

test("a later run in the same checkout cannot inherit the previous run's issue ownership", async () => {
  const { root, git } = await repository();
  const a = await legatus({ root, git, session: "session-a" });
  const source = "https://github.com/Example/Project/issues/7";
  const reserve = (task: typeof a.task) =>
    `reserve ${task.id}@1 --parent refs/heads/parent --source ${source}`;
  await a.command(reserve(a.task), "reserve-a");
  const one = await a.legion.command({ workspaceRequest: "reserve-a" });
  if (one.kind !== "reserved") assert.fail("Expected first run's reservation");
  await a.command("off");
  const b = await legatus({ root, git, session: "session-b" });
  await b.command(reserve(b.task), "reserve-b");
  const two = await b.legion.command({ workspaceRequest: "reserve-b" });
  if (two.kind !== "reserved") assert.fail("Expected separate run's reservation");
  assert.notEqual(two.receipt.reservation.id, one.receipt.reservation.id);
  assert.equal(two.receipt.reservation.owner, b.owner);
  assert.equal(one.receipt.reservation.owner, a.owner);
  await b.command("off");
  for (const [actor, receipt] of [[a, one.receipt], [b, two.receipt]] as const) {
    const reopened = await new Legion(actor.options).state();
    assert.equal(reopened.mode, "inactive");
    const claim = reopened.tasks[0]?.claim;
    if (claim?.kind !== "owned") assert.fail("Expected this run's preserved ownership");
    assert.deepEqual(claim.reservation, receipt.reservation);
    assert.equal(reopened.ownerObservations?.length, 1);
  }
});
