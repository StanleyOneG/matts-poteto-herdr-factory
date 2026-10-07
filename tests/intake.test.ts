import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion } from "../src/intake.js";
const evidence = {
  origin: "emperor",
  transport: "rpc",
  session: "session-a",
  generation: null,
  presented: [],
};
async function fixture() {
  const storagePath = await mkdtemp(join(tmpdir(), "legion-test-"));
  const options = {
    storagePath,
    context: "/disposable/repo",
    session: "session-a",
    preflight: async () => [],
  };
  const legion = new Legion(options);
  let key = 0;
  const command = (text: string) =>
    legion.command({ text, requestKey: String(++key), evidence });
  const interpret = async (proposal: unknown) => {
    const view = await legion.state();
    return legion.submit({
      kind: "interpretation",
      requestKey: String(++key),
      proposal,
      evidence: {
        session: options.session,
        generation: view.snapshot?.generation,
        legatus: view.snapshot?.id,
        run: "controlled-run",
        sources: view.snapshot?.submissions
          .filter((s) => s.state.kind === "pending")
          .map((s) => ({ id: s.id, revision: s.revision })),
      },
    });
  };
  return { legion, command, options, interpret };
}
test("activation preserves logical identity and exact task text across restart without activating", async () => {
  const { legion, command, options } = await fixture();
  await command("on");
  const first = await legion.state();
  assert.equal(first.mode, "active");
  await command("on");
  assert.equal((await legion.state()).snapshot?.id, first.snapshot?.id);
  const result = await command("task  Keep this\nexact text  ");
  assert.equal(result.kind, "saved");
  await command("off");
  const reopened = await new Legion(options).state();
  assert.equal(reopened.mode, "inactive");
  assert.equal(reopened.snapshot?.id, first.snapshot?.id);
  assert.equal(
    reopened.snapshot?.submissions[0]?.text,
    " Keep this\nexact text  ",
  );
  assert.equal(
    reopened.snapshot?.submissions[0]?.originIntent.kind,
    "new-task",
  );
});
test("direct interpretation admits a scoped task without tickets or external execution", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Fix the label");
  const original = (await legion.state()).snapshot?.submissions[0];
  assert.ok(original);
  const result = await interpret({
    kind: "new-task",
    source: { id: original.id, revision: 1 },
    goal: "Correct the label spelling",
    acceptance: ["The label spells Name"],
    questions: [],
  });
  assert.equal(result.kind, "applied");
  const view = await legion.state();
  assert.deepEqual(
    view.tasks.map((t) => ({
      goal: t.history[0]?.goal,
      scope: t.scope,
      eligibility: t.eligibility,
    })),
    [
      {
        goal: "Correct the label spelling",
        scope: {
          original: original.id,
          context: "/disposable/repo",
          policy: "intake-only-v1",
          amendments: [],
        },
        eligibility: "admitted",
      },
    ],
  );
  assert.equal(view.snapshot?.submissions[0]?.state.kind, "applied");
});
test("a product question blocks affected work and accepts an ordinary answer durably", async () => {
  const { legion, command, interpret, options } = await fixture();
  await command("Add a greeting");
  const original = (await legion.state()).snapshot?.submissions[0];
  assert.ok(original);
  assert.equal(
    (
      await interpret({
        kind: "new-task",
        source: { id: original.id, revision: 1 },
        goal: "Add greeting",
        acceptance: [],
        questions: [
          { question: "Which language?", recommendation: "Use English" },
        ],
      })
    ).kind,
    "applied",
  );
  const blocked = await legion.state();
  assert.equal(blocked.tasks[0]?.eligibility, "blocked");
  const decision = blocked.snapshot?.decisions[0];
  const task = blocked.tasks[0];
  assert.ok(decision);
  assert.ok(task);
  const generation = blocked.snapshot?.generation;
  assert.equal(
    (
      await legion.submit({
        kind: "message",
        requestKey: "answer-1",
        text: "Use French, please.",
        evidence: {
          ...evidence,
          generation,
          presented: [
            { decision: { id: decision.id, revision: 1 }, amendment: null },
          ],
        },
      })
    ).kind,
    "saved",
  );
  const answer = (await legion.state()).snapshot?.submissions[1];
  assert.ok(answer);
  const resolved = await interpret({
    kind: "answer",
    source: { id: answer.id, revision: 1 },
    decision: { id: decision.id, revision: 1 },
    effect: {
      kind: "record-clarification",
      target: { id: task.id, revision: 1 },
      answer: "Use French, please.",
    },
  });
  assert.equal(resolved.kind, "applied");
  assert.equal((await legion.state()).tasks[0]?.eligibility, "admitted");
  await command("off");
  const reopened = await new Legion(options).state();
  assert.equal(
    reopened.snapshot?.resolutions[0]?.effect.kind,
    "record-clarification",
  );
  assert.equal(reopened.snapshot?.submissions[1]?.text, "Use French, please.");
});
test("routing clarification advances original and answer atomically without changing an assignment", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Keep the existing greeting");
  let view = await legion.state();
  const first = view.snapshot?.submissions[0];
  assert.ok(first);
  await interpret({
    kind: "new-task",
    source: { id: first.id, revision: 1 },
    goal: "Keep greeting",
    acceptance: [],
    questions: [],
  });
  view = await legion.state();
  const task = view.tasks[0];
  assert.ok(task);
  await legion.submit({
    kind: "message",
    requestKey: "ambiguous",
    text: "Make it blue",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  const original = (await legion.state()).snapshot?.submissions[1];
  assert.ok(original);
  assert.equal(
    (
      await interpret({
        kind: "clarify",
        source: { id: original.id, revision: 1 },
        purpose: "routing",
        affected: [{ id: task.id, revision: 1 }],
        question: "New task or correction to the greeting?",
        recommendation: "Please name the intended task",
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  const decision = view.snapshot?.decisions[0];
  assert.ok(decision);
  await legion.submit({
    kind: "message",
    requestKey: "routing-answer",
    text: "This is a separate task.",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [
        { decision: { id: decision.id, revision: 1 }, amendment: null },
      ],
    },
  });
  const answer = (await legion.state()).snapshot?.submissions[2];
  assert.ok(answer);
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: answer.id, revision: 1 },
        decision: { id: decision.id, revision: 1 },
        effect: {
          kind: "resolve-routing",
          original: { id: original.id, revision: 1 },
          routing: { kind: "new-task" },
        },
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  assert.deepEqual(view.snapshot?.submissions[1]?.state, {
    kind: "pending",
    routing: { kind: "new-task" },
  });
  assert.equal(view.snapshot?.submissions[1]?.revision, 2);
  assert.equal(view.snapshot?.submissions[2]?.state.kind, "applied");
  assert.equal(view.tasks[0]?.history[0]?.goal, "Keep greeting");
  assert.equal(
    (
      await interpret({
        kind: "new-task",
        source: { id: original.id, revision: 1 },
        goal: "Blue",
        acceptance: [],
        questions: [],
      })
    ).kind,
    "rejected",
  );
  assert.equal(
    (
      await interpret({
        kind: "technical-choice",
        source: { id: original.id, revision: 2 },
        target: { id: task.id, revision: 1 },
        choice: "Change the old task instead",
      })
    ).kind,
    "rejected",
  );
  assert.equal(
    (
      await interpret({
        kind: "new-task",
        source: { id: original.id, revision: 2 },
        goal: "Blue",
        acceptance: [],
        questions: [],
      })
    ).kind,
    "applied",
  );
});
test("protected amendments accept conversational approval of only the presented immutable change", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Use only local data");
  let view = await legion.state();
  const original = view.snapshot?.submissions[0];
  assert.ok(original);
  await interpret({
    kind: "new-task",
    source: { id: original.id, revision: 1 },
    goal: "Read local data",
    acceptance: [],
    questions: [],
  });
  view = await legion.state();
  const task = view.tasks[0];
  assert.ok(task);
  await legion.submit({
    kind: "message",
    requestKey: "change",
    text: "Can we access the service?",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  const change = (await legion.state()).snapshot?.submissions[1];
  assert.ok(change);
  assert.equal(
    (
      await interpret({
        kind: "propose-amendment",
        source: { id: change.id, revision: 1 },
        affected: [{ id: task.id, revision: 1 }],
        category: "access",
        change: "Read the staging service with a read-only account",
        question: "Allow this staging access?",
        recommendation: "Keep local data unless staging is needed",
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  const decision = view.snapshot?.decisions[0];
  const amendment = view.snapshot?.amendments[0];
  assert.ok(decision);
  assert.ok(amendment);
  assert.equal(view.tasks[0]?.eligibility, "blocked");
  const ref = { id: decision.id, revision: 1 };
  await legion.submit({
    kind: "message",
    requestKey: "early-answer",
    text: "Yes",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  const early = (await legion.state()).snapshot?.submissions[2];
  assert.ok(early);
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: early.id, revision: 1 },
        decision: ref,
        effect: { kind: "approve-amendment", amendment: amendment.id },
      })
    ).kind,
    "rejected",
  );
  assert.equal(
    (
      await legion.submit({
        kind: "message",
        requestKey: "fake",
        text: "Yes",
        evidence: {
          ...evidence,
          origin: "extension",
          transport: "extension",
          generation: view.snapshot?.generation,
          presented: [{ decision: ref, amendment: amendment.id }],
        },
      })
    ).kind,
    "rejected",
  );
  await command("A separate task");
  await legion.submit({
    kind: "message",
    requestKey: "approve",
    text: "Yes, that read-only staging access is fine.",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [{ decision: ref, amendment: amendment.id }],
    },
  });
  const answer = (await legion.state()).snapshot?.submissions.at(-1);
  assert.ok(answer);
  const proposal = {
    kind: "answer",
    source: { id: answer.id, revision: 1 },
    decision: ref,
    effect: { kind: "approve-amendment", amendment: amendment.id },
  };
  assert.equal(
    (
      await interpret({
        ...proposal,
        effect: {
          ...proposal.effect,
          amendment: "00000000-0000-4000-8000-000000000000",
        },
      })
    ).kind,
    "rejected",
  );
  assert.equal(
    (await interpret({ ...proposal, decision: { ...ref, revision: 2 } })).kind,
    "rejected",
  );
  assert.equal((await interpret(proposal)).kind, "applied");
  view = await legion.state();
  assert.deepEqual(view.tasks[0]?.scope.amendments, [amendment.id]);
  assert.equal(view.tasks[0]?.history.at(-1)?.revision, 2);
  assert.equal(
    view.snapshot?.amendments[0]?.change,
    "Read the staging service with a read-only account",
  );
  assert.equal(view.snapshot?.resolutions[0]?.answerSource.id, answer.id);
  assert.equal((await interpret(proposal)).kind, "rejected");
});
test("independent tasks are admitted while affected work is blocked and routine choices remain delegated", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Add a form");
  const a = (await legion.state()).snapshot?.submissions[0];
  assert.ok(a);
  await interpret({
    kind: "new-task",
    source: { id: a.id, revision: 1 },
    goal: "Form",
    acceptance: [],
    questions: [{ question: "Which fields?", recommendation: "Name only" }],
  });
  await command("Fix spelling");
  const b = (await legion.state()).snapshot?.submissions[1];
  assert.ok(b);
  await interpret({
    kind: "new-task",
    source: { id: b.id, revision: 1 },
    goal: "Spelling",
    acceptance: [],
    questions: [],
  });
  let view = await legion.state();
  assert.deepEqual(
    view.tasks.map((t) => t.eligibility),
    ["blocked", "admitted"],
  );
  const task = view.tasks[1];
  assert.ok(task);
  await legion.submit({
    kind: "message",
    requestKey: "choice",
    text: "Pick the simplest spelling implementation.",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  const c = (await legion.state()).snapshot?.submissions[2];
  assert.ok(c);
  assert.equal(
    (
      await interpret({
        kind: "technical-choice",
        source: { id: c.id, revision: 1 },
        target: { id: task.id, revision: 1 },
        choice: "Change only the literal label",
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  assert.deepEqual(
    view.tasks[1]?.technicalChoices.map((c) => c.choice),
    ["Change only the literal label"],
  );
  assert.equal(view.tasks[0]?.eligibility, "blocked");
  await command("off");
});
test("off revokes delayed activation and explicit resume preserves identity with exclusive ownership", async () => {
  const { legion, command, options } = await fixture();
  await command("Original");
  const id = (await legion.state()).snapshot?.id;
  assert.ok(id);
  const competitor = new Legion({ ...options, session: "session-b" });
  const competing = await competitor.command({
    text: `resume ${id}`,
    requestKey: "compete",
    evidence: { ...evidence, session: "session-b" },
  });
  assert.equal(competing.kind, "rejected");
  await command("off");
  assert.equal(
    (
      await competitor.command({
        text: `resume ${id}`,
        requestKey: "resume",
        evidence: { ...evidence, session: "session-b" },
      })
    ).kind,
    "applied",
  );
  const active = await competitor.state();
  assert.equal(active.mode, "active");
  assert.equal(active.snapshot?.id, id);
  assert.equal(active.snapshot?.generation, 2);
  assert.equal(
    (
      await legion.submit({
        kind: "message",
        text: "Late callback",
        requestKey: "late",
        evidence: { ...evidence, generation: 1 },
      })
    ).kind,
    "rejected",
  );
  await competitor.command({
    text: "off",
    requestKey: "off-b",
    evidence: { ...evidence, session: "session-b" },
  });
  let resolve: (value: []) => void = () => {};
  const delayed = new Legion({
    ...options,
    session: "session-c",
    preflight: () =>
      new Promise<[]>((r) => {
        resolve = r;
      }),
  });
  const pending = delayed.command({
    text: "on",
    requestKey: "delayed",
    evidence: { ...evidence, session: "session-c" },
  });
  await new Promise((r) => setImmediate(r));
  await delayed.command({
    text: "off",
    requestKey: "cancel",
    evidence: { ...evidence, session: "session-c" },
  });
  resolve([]);
  assert.equal((await pending).kind, "rejected");
  assert.equal((await delayed.state()).mode, "inactive");
});
test("uncertain acknowledgment reconciles the committed receipt without duplicate intake", async () => {
  const { options } = await fixture();
  let fail = false;
  const legion = new Legion({
    ...options,
    storageFault: (point: string) => {
      if (fail && point === "after-commit") {
        fail = false;
        throw new Error("acknowledgment interrupted");
      }
    },
  });
  await legion.command({ text: "on", requestKey: "start", evidence });
  const generation = (await legion.state()).snapshot?.generation;
  const message = {
    kind: "message",
    requestKey: "stable-key",
    text: "Keep exact text",
    evidence: { ...evidence, generation },
  };
  fail = true;
  assert.equal((await legion.submit(message)).kind, "uncertain");
  assert.equal(
    (
      await legion.command({
        text: "Another mutation",
        requestKey: "different-key",
        evidence,
      })
    ).kind,
    "rejected",
  );
  const reconciled = await legion.submit(message);
  assert.equal(reconciled.kind, "saved");
  assert.equal((await legion.state()).snapshot?.submissions.length, 1);
  assert.equal(
    (await new Legion(options).state()).snapshot?.submissions[0]?.text,
    "Keep exact text",
  );
});
test("read-only status of another Legatus never redirects the active owner", async () => {
  const { legion, command, options } = await fixture();
  await command("First");
  const id = (await legion.state()).snapshot?.id;
  const other = new Legion({ ...options, session: "other-session" });
  await other.command({
    text: "Second",
    requestKey: "second",
    evidence: { ...evidence, session: "other-session" },
  });
  const otherId = (await other.state()).snapshot?.id;
  assert.ok(otherId);
  await command(`status ${otherId}`);
  await command("Third");
  assert.equal((await legion.state()).snapshot?.id, id);
  assert.deepEqual(
    (await legion.state()).snapshot?.submissions.map((s) => s.text),
    ["First", "Third"],
  );
  await command("off");
  await other.command({
    text: "off",
    requestKey: "off",
    evidence: { ...evidence, session: "other-session" },
  });
});
test("ambiguous protected answers retain immutable revisions and permit later conversational decline", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Local-only report");
  const a = (await legion.state()).snapshot?.submissions[0];
  assert.ok(a);
  await interpret({
    kind: "new-task",
    source: { id: a.id, revision: 1 },
    goal: "Local report",
    acceptance: [],
    questions: [],
  });
  let view = await legion.state();
  const task = view.tasks[0];
  assert.ok(task);
  await legion.submit({
    kind: "message",
    requestKey: "financial-change",
    text: "Maybe use a paid service?",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  const change = (await legion.state()).snapshot?.submissions[1];
  assert.ok(change);
  await interpret({
    kind: "propose-amendment",
    source: { id: change.id, revision: 1 },
    affected: [{ id: task.id, revision: 1 }],
    category: "financial",
    change: "Purchase one month of service for $10",
    question: "Approve the purchase?",
    recommendation: "Keep the free local implementation",
  });
  view = await legion.state();
  const d = view.snapshot?.decisions[0];
  const m = view.snapshot?.amendments[0];
  assert.ok(d);
  assert.ok(m);
  await legion.submit({
    kind: "message",
    requestKey: "ambiguous-finance",
    text: "Perhaps, but which plan?",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [{ decision: { id: d.id, revision: 1 }, amendment: m.id }],
    },
  });
  const uncertain = (await legion.state()).snapshot?.submissions[2];
  assert.ok(uncertain);
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: uncertain.id, revision: 1 },
        decision: { id: d.id, revision: 1 },
        effect: {
          kind: "clarify",
          question: "Approve the $10 monthly plan?",
          recommendation: "Decline if unsure",
        },
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  assert.deepEqual(
    view.snapshot?.decisions[0]?.history.map((r) => r.revision),
    [1, 2],
  );
  const current = view.snapshot?.decisions[0]?.history[1];
  const currentAmendment = view.snapshot?.amendments[1];
  assert.ok(current);
  assert.ok(currentAmendment);
  assert.equal(
    currentAmendment.change,
    "Purchase one month of service for $10",
  );
  await legion.submit({
    kind: "message",
    requestKey: "decline-finance",
    text: "No, keep it free.",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [
        { decision: { id: d.id, revision: 2 }, amendment: currentAmendment.id },
      ],
    },
  });
  const answer = (await legion.state()).snapshot?.submissions[3];
  assert.ok(answer);
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: answer.id, revision: 1 },
        decision: { id: d.id, revision: 2 },
        effect: { kind: "decline-amendment", amendment: currentAmendment.id },
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  assert.deepEqual(view.tasks[0]?.scope.amendments, []);
  assert.equal(view.tasks[0]?.eligibility, "admitted");
  await command("off");
});
test("every prerequisite failure is diagnosed read-only and task-bearing failure preserves input inactive", async () => {
  const { options } = await fixture();
  for (const status of ["missing", "unverified", "incompatible"] as const)
    for (const name of [
      "Pi",
      "Storage",
      "Herdr",
      "Skill herdr",
      "@zenspc/pi-pstack",
      "Skill poteto-mode",
      "pi-subagents",
      "Skill matt-tdd",
      "Skill implement",
      "Skill code-review",
    ]) {
      let broken = false;
      const legion = new Legion({
        ...options,
        session: `${name}:${status}`,
        preflight: async () =>
          broken ? [{ name, status, message: `${status} ${name}` }] : [],
      });
      const caller = { ...evidence, session: `${name}:${status}` };
      await legion.command({
        text: "on",
        requestKey: `activate-${name}`,
        evidence: caller,
      });
      broken = true;
      const doctor = await legion.command({
        text: "doctor",
        requestKey: `doctor-${name}`,
        evidence: caller,
      });
      assert.equal(doctor.kind, "observed");
      if (doctor.kind === "observed")
        assert.deepEqual(doctor.view.diagnostics, [
          { name, status, message: `${status} ${name}` },
        ]);
      const failed = await legion.command({
        text: "on",
        requestKey: `fail-${name}`,
        evidence: caller,
      });
      assert.equal(failed.kind, "observed");
      assert.equal((await legion.state()).mode, "inactive");
      const saved = await legion.command({
        text: "Preserve failed-preflight task",
        requestKey: `save-${name}`,
        evidence: caller,
      });
      assert.equal(saved.kind, "saved");
      if (saved.kind === "saved")
        assert.equal(
          saved.receipt.message,
          "Saved, not admitted. Run /legion doctor. Command text only. Attachments were not captured.",
        );
      assert.equal(
        (await legion.state()).snapshot?.submissions[0]?.text,
        "Preserve failed-preflight task",
      );
      assert.equal((await legion.state()).mode, "inactive");
    }
});
test("a committed request reconciles after off and restart while equal text with a new key remains distinct", async () => {
  const { legion, command, options } = await fixture();
  await command("on");
  const view = await legion.state();
  const message = {
    kind: "message",
    requestKey: "retry-key",
    text: "Same text",
    evidence: { ...evidence, generation: view.snapshot?.generation },
  };
  const saved = await legion.submit(message);
  assert.equal(saved.kind, "saved");
  assert.deepEqual(await legion.submit(message), saved);
  assert.equal(
    (await legion.submit({ ...message, requestKey: "distinct-key" })).kind,
    "saved",
  );
  assert.equal(
    (await legion.submit({ ...message, text: "Different text" })).kind,
    "rejected",
  );
  await command("off");
  const restarted = new Legion(options);
  assert.deepEqual(await restarted.submit(message), saved);
  assert.equal((await restarted.state()).mode, "inactive");
  assert.equal((await restarted.state()).snapshot?.submissions.length, 2);
});
test("stale protected decisions require a newly presented revision before resolving", async () => {
  const { legion, command, interpret } = await fixture();
  await command("Report");
  const source = (await legion.state()).snapshot?.submissions[0];
  assert.ok(source);
  await interpret({
    kind: "new-task",
    source: { id: source.id, revision: 1 },
    goal: "Report",
    acceptance: [],
    questions: [],
  });
  let view = await legion.state();
  const task = view.tasks[0];
  assert.ok(task);
  for (const n of [1, 2]) {
    await legion.submit({
      kind: "message",
      requestKey: `change-${n}`,
      text: `Change ${n}`,
      evidence: { ...evidence, generation: view.snapshot?.generation },
    });
    const s = (await legion.state()).snapshot?.submissions.at(-1);
    assert.ok(s);
    await interpret({
      kind: "propose-amendment",
      source: { id: s.id, revision: 1 },
      affected: [{ id: task.id, revision: 1 }],
      category: "requirements",
      change: `Add requirement ${n}`,
      question: `Approve requirement ${n}?`,
      recommendation: "Keep existing scope",
    });
  }
  view = await legion.state();
  const first = view.snapshot?.decisions[0];
  const second = view.snapshot?.decisions[1];
  const m1 = view.snapshot?.amendments[0];
  const m2 = view.snapshot?.amendments[1];
  assert.ok(first);
  assert.ok(second);
  assert.ok(m1);
  assert.ok(m2);
  await legion.submit({
    kind: "message",
    requestKey: "approve-first",
    text: "Approve the first change.",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [
        { decision: { id: first.id, revision: 1 }, amendment: m1.id },
      ],
    },
  });
  const a1 = (await legion.state()).snapshot?.submissions.at(-1);
  assert.ok(a1);
  await interpret({
    kind: "answer",
    source: { id: a1.id, revision: 1 },
    decision: { id: first.id, revision: 1 },
    effect: { kind: "approve-amendment", amendment: m1.id },
  });
  await legion.submit({
    kind: "message",
    requestKey: "stale-second",
    text: "Approve the second change.",
    evidence: {
      ...evidence,
      generation: view.snapshot?.generation,
      presented: [
        { decision: { id: second.id, revision: 1 }, amendment: m2.id },
      ],
    },
  });
  const a2 = (await legion.state()).snapshot?.submissions.at(-1);
  assert.ok(a2);
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: a2.id, revision: 1 },
        decision: { id: second.id, revision: 1 },
        effect: { kind: "approve-amendment", amendment: m2.id },
      })
    ).kind,
    "rejected",
  );
  assert.equal(
    (
      await interpret({
        kind: "answer",
        source: { id: a2.id, revision: 1 },
        decision: { id: second.id, revision: 1 },
        effect: {
          kind: "clarify",
          question: "Still approve requirement 2 against the revised scope?",
          recommendation: "Review the current scope before approving",
        },
      })
    ).kind,
    "applied",
  );
  view = await legion.state();
  assert.deepEqual(view.snapshot?.decisions[1]?.history[1]?.affected, [
    { id: task.id, revision: 2 },
  ]);
  assert.deepEqual(view.tasks[0]?.scope.amendments, [m1.id]);
  assert.equal(view.tasks[0]?.eligibility, "blocked");
  await command("off");
});
test("read-only status reconciles uncertainty so explicit resume can recover intake", async () => {
  const { options } = await fixture();
  let fault = false;
  const legion = new Legion({
    ...options,
    storageFault: (point) => {
      if (fault && point === "after-commit") {
        fault = false;
        throw new Error("lost receipt");
      }
    },
  });
  await legion.command({ text: "on", requestKey: "begin", evidence });
  fault = true;
  assert.equal(
    (
      await legion.command({
        text: "Saved despite lost receipt",
        requestKey: "lost",
        evidence,
      })
    ).kind,
    "uncertain",
  );
  const observed = await legion.command({
    text: "status",
    requestKey: "inspect",
    evidence,
  });
  assert.equal(observed.kind, "observed");
  if (observed.kind !== "observed") throw new Error("Expected observation");
  const id = observed.view.snapshot?.id;
  assert.ok(id);
  assert.equal(
    observed.view.snapshot?.receipts.at(-1)?.result.receipt.requestKey,
    "lost",
  );
  assert.equal(
    (
      await legion.command({
        text: `resume ${id}`,
        requestKey: "explicit-resume",
        evidence,
      })
    ).kind,
    "applied",
  );
  assert.equal((await legion.state()).snapshot?.submissions.length, 1);
  await legion.command({ text: "off", requestKey: "end", evidence });
});
test("reserved arguments require valid command syntax and task escapes retain their literal text", async () => {
  const { legion, command } = await fixture();
  assert.deepEqual(
    await Promise.all(
      [
        "resume",
        "task",
        "task   ",
        "off extra",
        "doctor extra",
        "on extra",
      ].map(async (text) => (await command(text)).kind),
    ),
    ["rejected", "rejected", "rejected", "rejected", "rejected", "rejected"],
  );
  assert.equal((await command("task resume")).kind, "saved");
  assert.deepEqual(
    (await legion.state()).snapshot?.submissions.map((s) => s.text),
    ["resume"],
  );
  await command("off");
});
