import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryFixture, acceptedResult, deliveryControl, observeFinalGit } from "./support/delivery-fixture.js";

const tracker = { provider: "fixture", project: "project-one", id: "39", url: "https://tracker.invalid/39" };
test("direct tasks remain valid and optional provider-qualified tracker identity persists", async () => {
  const f = await deliveryFixture();
  try {
    assert.equal((await f.legion.state()).tasks[0]?.tracker, undefined);
    const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
    const result = await f.legion.submit({ kind: "delivery-control", action: { kind: "bind-tracker", task: f.task, tracker }, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "delivery" } });
    assert.equal(result.kind, "observed", JSON.stringify(result));
    assert.deepEqual((await f.legion.state()).tasks[0]?.tracker, tracker);
  } finally { await f.command("off"); }
});

test("only accepted integrated results prepare durable evidence-linked tracker closure; unknown never repeats", async () => {
  const f = await deliveryFixture();
  try {
    const id = (await import("node:crypto")).randomUUID();
    await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker } });
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", task: f.task, id } })).kind, "rejected");
    await acceptedResult(f);
    let effects = 0;
    f.options.delivery = { adapter: () => ({
      configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      execute: async ({ intent, assertAuthority }) => {
        await assertAuthority(); effects++;
        assert.equal((await new (await import("../src/intake.js")).Legion(f.options).state()).snapshot?.deliveries[0]?.state.kind, "dispatched");
        assert.equal(intent.kind, "close-task");
        if (intent.kind !== "close-task") assert.fail();
        assert.equal(intent.proof.record.verifications[0]?.verification.exceptions[0]?.resolution.kind, "resolved");
        assert.equal(intent.proof.integration.state.kind, "confirmed");
        throw new Error("receipt lost after closure");
      },
      reconcile: async ({ intent }) => ({ kind: "confirmed", operation: intent.id, digest: intent.digest, evidence: ["closure-receipt"], reference: "https://tracker.invalid/39" }),
    }) };
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", task: f.task, id } })).kind, "delivery-stage");
    assert.equal(effects, 0);
    const executed = await f.legion.command({ deliveryRequest: id });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "unknown", JSON.stringify(executed));
    await f.legion.command({ deliveryRequest: id });
    assert.equal(effects, 1);
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", task: f.task, id: (await import("node:crypto")).randomUUID() } })).kind, "rejected");
    assert.equal((await deliveryControl({ f, action: { kind: "reconcile", id } })).kind, "delivery-stage");
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "confirmed");
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
  } finally { await f.command("off"); }
});

test("unchanged standalone final delivery reuses exact accepted review, in local report and remote draft-to-ready modes", async () => {
  const f = await deliveryFixture();
  try {
    const { randomUUID } = await import("node:crypto"), { execFileSync } = await import("node:child_process");
    const accepted = await acceptedResult(f);
    let effects = 0;
    f.options.delivery = { adapter: () => ({
      configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      observeFinal: observeFinalGit,
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); effects++; return { kind: "confirmed", operation: intent.id, digest: intent.digest, evidence: ["publication-receipt"], reference: intent.kind === "publish" && intent.publication.kind === "ready" ? intent.publication.reference : `fixture:${intent.id}` }; },
      reconcile: async () => { throw new Error("Unexpected reconciliation"); },
    }) };
    const captured = await deliveryControl({ f, action: { kind: "capture-final", specification: "spec:1", tasks: [f.task], requiredChecks: ["focused"] } });
    assert.ok(captured.kind === "final-delivery-stage", JSON.stringify(captured));
    assert.equal(captured.review.kind, "reused-result-review");
    if (captured.review.kind !== "reused-result-review") assert.fail();
    assert.equal(captured.review.review.id, accepted.review.id);
    const final = { id: captured.final.id, digest: captured.final.digest };
    const local = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: local, final, publication: { kind: "local-report" } } })).kind, "delivery-stage");
    assert.equal(effects, 0);
    await f.legion.command({ deliveryRequest: local });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "confirmed");
    const draft = randomUUID(), ready = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: ready, final, publication: { kind: "ready", draft } } })).kind, "rejected");
    await deliveryControl({ f, action: { kind: "prepare-publication", id: draft, final, publication: { kind: "draft" } } });
    await f.legion.command({ deliveryRequest: draft });
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: ready, final, publication: { kind: "ready", draft } } })).kind, "delivery-stage");
    await f.legion.command({ deliveryRequest: ready });
    assert.equal(effects, 3);
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
    assert.equal((await f.legion.state()).snapshot?.results[0]?.reviews.length, 1);
  } finally { await f.command("off"); }
});

test("changed final content needs new checks and independent review, while unrelated pending tasks do not block scoped delivery", async () => {
  const f = await deliveryFixture();
  try {
    const { randomUUID } = await import("node:crypto"), { execFileSync } = await import("node:child_process"), { writeFileSync } = await import("node:fs");
    await acceptedResult(f);
    await f.command("task Unrelated bounded work");
    const submission = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(submission);
    await f.interpret({ kind: "new-task", source: { id: submission.id, revision: 1 }, goal: "Unrelated", acceptance: ["Unrelated check"], questions: [] });
    const pending = (await f.legion.state()).tasks.find(task => task.id !== f.task.id); assert.ok(pending);
    const pendingRef = { id: pending.id, revision: 1 };
    f.options.delivery = { adapter: () => ({
      configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      observeFinal: observeFinalGit,
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); return { kind: "confirmed", operation: intent.id, digest: intent.digest, evidence: ["published"], reference: "local:report" }; },
      reconcile: async () => { throw new Error("unused"); },
    }) };
    const capture = (tasks = [f.task]) => deliveryControl({ f, action: { kind: "capture-final", specification: "spec:1", tasks, requiredChecks: ["focused"] } });
    const initial = await capture(); assert.ok(initial.kind === "final-delivery-stage");
    assert.equal(initial.review.kind, "reused-result-review");
    const incomplete = await capture([f.task, pendingRef]); assert.ok(incomplete.kind === "final-delivery-stage");
    assert.equal(incomplete.review.kind, "review-required");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final: { id: incomplete.final.id, digest: incomplete.final.digest }, publication: { kind: "local-report" } } })).kind, "rejected");
    const draft = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: draft, final: { id: incomplete.final.id, digest: incomplete.final.digest }, publication: { kind: "draft" } } })).kind, "delivery-stage");
    await f.legion.command({ deliveryRequest: draft });
    writeFileSync(`${f.checkout}/interaction.txt`, "changed combined delivery\n");
    execFileSync("git", ["-C", f.checkout, "add", "interaction.txt"]); execFileSync("git", ["-C", f.checkout, "commit", "-m", "final interaction change"]);
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final: { id: initial.final.id, digest: initial.final.digest }, publication: { kind: "local-report" } } })).kind, "rejected", "stale tip cannot publish");
    const changed = await capture(); assert.ok(changed.kind === "final-delivery-stage");
    assert.equal(changed.review.kind, "review-required");
    const final = { id: changed.final.id, digest: changed.final.digest };
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final, publication: { kind: "local-report" } } })).kind, "rejected");
    const verified = await deliveryControl({ f, action: { kind: "verify-final", final, verification: { checks: [{ name: "focused", outcome: "passed", evidence: ["interaction-check.log"] }], exceptions: [] } } }); assert.ok(verified.kind === "final-delivery-stage");
    const review = { kind: "review-final", id: randomUUID(), result: final, verificationDigest: verified.final.verifications.at(-1)?.digest, reviewer: { session: "controller", run: "interactions" }, reference: "final-review.md", outcome: "approved", evidence: ["independent-interactions-review.md"] };
    assert.equal((await deliveryControl({ f, action: review })).kind, "rejected");
    const reviewed = await deliveryControl({ f, action: { ...review, reviewer: { session: "final-reviewer", run: "interactions" } } }); assert.ok(reviewed.kind === "final-delivery-stage");
    assert.equal(reviewed.review.kind, "final-review");
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id, final, publication: { kind: "local-report" } } })).kind, "delivery-stage");
    await f.legion.command({ deliveryRequest: id });
    assert.equal((await f.legion.state()).snapshot?.deliveries.at(-1)?.state.kind, "confirmed");
    assert.equal((await f.legion.state()).tasks.find(task => task.id === pending.id)?.resultStatus.kind, "not-captured");
  } finally { await f.command("off"); }
});

test("a changed declared scope invalidates old final proof even when branch content is unchanged", async () => {
  const f = await deliveryFixture();
  try {
    await acceptedResult(f);
    await f.command("task Another task in this spec");
    const source = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
    await f.interpret({ kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Second member", acceptance: ["Second criterion"], questions: [] });
    const task = (await f.legion.state()).tasks.find(task => task.id !== f.task.id); assert.ok(task);
    const { randomUUID } = await import("node:crypto"), { execFileSync } = await import("node:child_process");
    f.options.delivery = { adapter: () => ({ configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      observeFinal: observeFinalGit,
      execute: async () => { throw new Error("must not publish old scope"); }, reconcile: async () => { throw new Error("unused"); },
    }) };
    const capture = (tasks: Array<{ id: string; revision: number }>) => deliveryControl({ f, action: { kind: "capture-final", specification: "spec:1", tasks, requiredChecks: ["focused"] } });
    const old = await capture([f.task]); assert.ok(old.kind === "final-delivery-stage");
    const next = await capture([f.task, { id: task.id, revision: 1 }]); assert.ok(next.kind === "final-delivery-stage");
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final: { id: old.final.id, digest: old.final.digest }, publication: { kind: "local-report" } } })).kind, "rejected");
  } finally { await f.command("off"); }
});

test("proven no-effect failure needs a new explicitly linked attempt; unknown and failed-with-possible-effect remain held", async () => {
  const f = await deliveryFixture();
  try {
    const { randomUUID } = await import("node:crypto");
    await acceptedResult(f); await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker } });
    let effects = 0;
    f.options.delivery = { adapter: () => ({ configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); effects++; return { kind: "failed", noEffect: true, operation: intent.id, digest: intent.digest, evidence: ["ordinary-permission-denied"], message: "Denied before mutation" }; },
      reconcile: async () => { throw new Error("unused"); },
    }) };
    const id = randomUUID(); await deliveryControl({ f, action: { kind: "prepare-closure", id, task: f.task } });
    await f.legion.command({ deliveryRequest: id });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "failed");
    await f.legion.command({ deliveryRequest: id }); assert.equal(effects, 1);
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", id: randomUUID(), task: f.task } })).kind, "rejected", "new attempts must explicitly link proven no-effect predecessor");
    const retry = randomUUID();
    const prepared = await deliveryControl({ f, action: { kind: "prepare-closure", id: retry, task: f.task, previous: id } });
    assert.ok(prepared.kind === "delivery-stage", JSON.stringify(prepared));
    assert.equal(prepared.delivery.intent.previous, id);
    f.options.delivery.adapter = () => ({ configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); effects++; return { kind: "failed", noEffect: false, operation: intent.id, digest: intent.digest, evidence: ["remote-error-after-request"], message: "Cannot exclude effect" }; },
      reconcile: async () => { throw new Error("no proof"); },
    });
    await f.legion.command({ deliveryRequest: retry });
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", id: randomUUID(), task: f.task, previous: retry } })).kind, "rejected");
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted", "tracker failure never revokes prerequisite acceptance");
  } finally { await f.command("off"); }
});

test("lost preparation commit acknowledgment preserves durable operation and revokes execution instead of reporting rejection", async () => {
  const f = await deliveryFixture();
  try {
    const { randomUUID } = await import("node:crypto");
    await acceptedResult(f); await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker } });
    let effects = 0;
    f.options.delivery = { adapter: () => ({ configuration: { provider: "fixture", project: "project-one", revision: "v1" },
      execute: async () => { effects++; throw new Error("No authority after storage uncertainty"); },
      reconcile: async ({ intent }) => ({ kind: "failed", noEffect: true, operation: intent.id, digest: intent.digest, evidence: ["durable-prepared-only-no-dispatch"], message: "Not dispatched" }),
    }) };
    f.setStorageFault(point => { if (point === "after-commit") throw new Error("lost commit acknowledgment"); });
    const id = randomUUID(), prepared = await deliveryControl({ f, action: { kind: "prepare-closure", id, task: f.task } });
    assert.equal(prepared.kind, "uncertain", JSON.stringify(prepared));
    f.setStorageFault(undefined);
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "pending");
    assert.equal((await f.legion.command({ deliveryRequest: id })).kind, "rejected");
    assert.equal(effects, 0);
  } finally { f.setStorageFault(undefined); await f.command("off"); }
});

test("multiple accepted results require final checks and an independent interactions review of the exact combined set and tip", async () => {
  const f = await deliveryFixture();
  try {
    const { randomUUID } = await import("node:crypto");
    await acceptedResult(f);
    await f.command("task Second related task");
    const source = (await f.legion.state()).snapshot?.submissions.at(-1); assert.ok(source);
    await f.interpret({ kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Related task", acceptance: ["Exact result is verified"], questions: [] });
    const second = (await f.legion.state()).tasks.find(task => task.id !== f.task.id); assert.ok(second);
    const task = { id: second.id, revision: 1 };
    const reserve = await f.command(`reserve ${task.id}@1 --parent refs/heads/task-parent`); assert.ok(reserve.kind === "deferred", JSON.stringify(reserve));
    assert.equal((await f.legion.command({ workspaceRequest: reserve.receipt.requestKey })).kind, "reserved");
    const stage = await f.command(`launch ${task.id}@1`); assert.ok(stage.kind === "launch-stage", JSON.stringify(stage));
    assert.equal((await f.legion.command({ launchRequest: stage.requestId })).kind, "launched");
    const launch = (await f.legion.state()).tasks.find(candidate => candidate.id === task.id)?.launch; assert.ok(launch?.kind === "assigned");
    const report = f.reports.get(launch.worker.address.launch); assert.ok(report);
    await report({ address: launch.worker.address, command: launch.command, outcome: "reported-result", assistantText: "Related result", evidence: ["report"] });
    await acceptedResult({ ...f, task, launch });
    f.options.delivery = { adapter: () => ({ configuration: { provider: "fixture", project: "project-one", revision: "v1" }, observeFinal: observeFinalGit,
      execute: async ({ intent, assertAuthority }) => { await assertAuthority(); return { kind: "confirmed", operation: intent.id, digest: intent.digest, reference: "local:combined-report", evidence: ["report-receipt"] }; },
      reconcile: async () => { throw new Error("unused"); },
    }) };
    const captured = await deliveryControl({ f, action: { kind: "capture-final", specification: "spec:1", tasks: [task, f.task], requiredChecks: ["combined interactions"] } }); assert.ok(captured.kind === "final-delivery-stage", JSON.stringify(captured));
    assert.equal(captured.final.identity.results.length, 2);
    assert.equal(captured.review.kind, "review-required", "per-task reviews are not a final interactions review");
    const final = { id: captured.final.id, digest: captured.final.digest };
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id: randomUUID(), final, publication: { kind: "local-report" } } })).kind, "rejected");
    const verified = await deliveryControl({ f, action: { kind: "verify-final", final, verification: { checks: [{ name: "combined interactions", outcome: "passed", evidence: ["combined-check.log"] }], exceptions: [] } } }); assert.ok(verified.kind === "final-delivery-stage");
    const review = await deliveryControl({ f, action: { kind: "review-final", id: randomUUID(), result: final, verificationDigest: verified.final.verifications.at(-1)?.digest, reviewer: { session: "interactions-reviewer", run: "fresh" }, reference: "interactions-review.md", outcome: "approved", evidence: ["exact-combined-set-and-tip-review"] } }); assert.ok(review.kind === "final-delivery-stage");
    assert.equal(review.review.kind, "final-review");
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id, final, publication: { kind: "local-report" } } })).kind, "delivery-stage");
    await f.legion.command({ deliveryRequest: id });
    assert.equal((await f.legion.state()).snapshot?.deliveries[0]?.state.kind, "confirmed");
  } finally { await f.command("off"); }
});
