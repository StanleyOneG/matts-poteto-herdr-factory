import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legatusUiFixture } from "./support/legatus-ui.mjs";
import { composedRuntime } from "./support/composed-transport.mjs";
import extension from "../src/extension.js";

const passing = { criteria: [{ criterion: 0, outcome: "passed", evidence: ["criterion-check"] }], checks: [{ name: "focused", outcome: "passed", evidence: ["test-exit-0"] }], exceptions: [] };
async function fixture(options: { nested?: boolean; linked?: boolean } = {}) {
  const f = await legatusUiFixture({ parent: "task-parent", ...options });
  await f.runtime.command("implement-spec=on Implement the approved exact result");
  await f.startPending();
  const source = (await f.state()).snapshot?.submissions[0]; assert.ok(source);
  assert.equal((await f.call("legion_intake", { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Exact result", acceptance: ["Reviewed content reaches intended parent"], questions: [] })).isError, false);
  const task = (await f.state()).tasks[0]; assert.ok(task);
  const worker = await f.launch({ id: task.id, revision: 1 });
  writeFileSync(join(worker.ctx.cwd, "result.txt"), "reviewed content\n");
  execFileSync("git", ["-C", worker.ctx.cwd, "add", "result.txt"]);
  execFileSync("git", ["-C", worker.ctx.cwd, "-c", "user.name=Result fixture", "-c", "user.email=result@example.test", "commit", "-qm", "exact result"]);
  await worker.settle(false, "Completed bounded result; not accepted.");
  for (let i = 0; i < 200 && (await f.state()).tasks[0]?.launch.kind !== "reported"; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.state()).tasks[0]?.launch.kind, "reported");
  return { ...f, worker, task: { id: task.id, revision: 1 }, control: (action: unknown) => f.call("legion_result", { action }) };
}

test("public result controls pin actual reported Git identity and use trusted current Legatus evidence only", async () => {
  const f = await fixture();
  try {
    const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] });
    assert.equal(captured.details?.kind, "result-stage", JSON.stringify(captured));
    if (captured.details?.kind !== "result-stage") assert.fail("Expected public captured result");
    const record = captured.details.result;
    assert.equal(record.identity.commit, execFileSync("git", ["-C", f.worker.ctx.cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    assert.equal(record.identity.workspace.parentPath, f.runtime.ctx.cwd);
    assert.equal(record.identity.parent.ref, "refs/heads/task-parent");
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "verification-required");
    assert.equal((await f.call("legion_result", { action: { kind: "capture", task: f.task, requiredChecks: ["focused"] }, evidence: { session: "worker-session" } })).isError, true);
    const tool = f.tools.get("legion_result"); assert.ok(tool);
    assert.equal(tool.exposure, "model-only");
    assert.doesNotMatch(JSON.stringify(tool.parameters), /"legatus"|"generation"/);
    const session = f.runtime.ctx.sessionManager.getSessionId;
    f.runtime.ctx.sessionManager.getSessionId = () => "foreign-owner";
    assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] })).isError, true, "A different native caller cannot borrow the owning Legatus turn");
    f.runtime.ctx.sessionManager.getSessionId = session;
    await f.runtime.command("help");
    assert.match(f.runtime.notices.at(-1) ?? "", /legion_result.*legion_integrate/s);
    await f.runtime.settle();
    assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] })).isError, true, "An uncorrelated settled turn cannot control results");
  } finally { await f.close(); }
});

async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] });
  assert.ok(captured.details?.kind === "result-stage", JSON.stringify(captured));
  const result = { id: captured.details.result.id, digest: captured.details.result.digest };
  const verified = await f.control({ kind: "verify", result, verification: passing });
  assert.ok(verified.details?.kind === "result-stage", JSON.stringify(verified));
  const verificationDigest = verified.details.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
  const review = { kind: "review", id: randomUUID(), result, verificationDigest, reviewer: { session: "independent-reviewer", run: "fresh-review-run" }, reference: "code-review.md", outcome: "approved", evidence: ["review-exact-content"] };
  assert.equal((await f.control(review)).isError, false);
  assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "ready");
  return { result, review };
}

test("public prepare has no effect; only exact correlated integration uses the ordinary Bash permission callback and confirms parent content", async () => {
  const f = await fixture();
  try {
    assert.match(f.systemPrompt(), /legion_result/);
    const { result } = await ready(f), id = randomUUID();
    let effects = 0;
    const originalExec = f.runtime.pi.exec;
    f.runtime.pi.exec = async (...args) => {
      assert.doesNotMatch(JSON.stringify(args), /GIT_REFLOG_ACTION=/, "Mutation must never fall back to pi.exec");
      return originalExec(...args);
    };
    f.runtime.pi.on("tool_call", async event => {
      if (event.toolName !== "bash" || !JSON.stringify(event.input).includes("GIT_REFLOG_ACTION=")) return;
      effects++;
      assert.ok(event.parentToolCallId, "Normal nested execution retains the correlated root identity");
    });
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true, "No prepared correlation, even in the native Legatus turn");
    const prepared = await f.control({ kind: "prepare-integration", result, id });
    assert.equal(prepared.details?.kind, "integration-stage", JSON.stringify(prepared));
    assert.equal(effects, 0);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "integration-pending");
    assert.equal((await f.call("legion_status", { command: "status" })).isError, false, "Prepared integration preserves passive native status");
    assert.equal((await f.call("legion_status", { command: "doctor" })).isError, false);
    assert.equal(effects, 0);
    assert.equal((await f.call("legion_integrate", { requestId: randomUUID() })).isError, true);
    assert.equal((await f.call("bash", { command: "echo uncorrelated" })).isError, true);
    const integrated = await f.call("legion_integrate", { requestId: id });
    assert.equal(integrated.isError, false, JSON.stringify(integrated));
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "accepted");
    assert.equal(effects, 1);
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "show", "refs/heads/task-parent:result.txt"], { encoding: "utf8" }), "reviewed content\n");
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true, "A consumed correlation cannot authorize a second invocation");
    assert.equal(effects, 1);
    const before = (await f.state()).snapshot;
    await f.runtime.command("status");
    assert.match(f.runtime.notices.at(-1) ?? "", /result accepted/);
    await f.runtime.command("doctor");
    assert.deepEqual((await f.state()).snapshot, before);
    assert.equal(effects, 1);
  } finally { await f.close(); }
});

test("a lost ordinary Bash acknowledgment remains unknown and public read-only reconciliation accepts without a second merge", async () => {
  const f = await fixture();
  try {
    const { result } = await ready(f), id = randomUUID();
    let effects = 0;
    f.runtime.pi.on("tool_call", event => { if (event.toolName === "bash" && JSON.stringify(event.input).includes("GIT_REFLOG_ACTION=")) effects++; });
    const ordinary = f.runtime.ctx.executeTool;
    f.runtime.ctx.executeTool = async (...args) => {
      const receipt = await ordinary(...args);
      if (JSON.stringify(args).includes("GIT_REFLOG_ACTION=")) throw new Error("Receipt lost after actual Git integration");
      return receipt;
    };
    assert.equal((await f.control({ kind: "prepare-integration", result, id })).isError, false);
    const lost = await f.call("legion_integrate", { requestId: id });
    assert.equal(lost.isError, true);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "integration-unknown");
    assert.equal((await f.state()).snapshot?.integrations[0]?.state.kind, "unknown");
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "show", "HEAD:result.txt"], { encoding: "utf8" }), "reviewed content\n");
    assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).isError, true);
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal((await f.control({ kind: "reconcile-integration", id })).isError, false);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "accepted");
    assert.equal(effects, 1);
    assert.equal((await f.state()).snapshot?.integrations.length, 1);
  } finally { await f.close(); }
});

test("a retained stopping owner explicitly reconciles lost integration acknowledgment without reviving execution", async () => {
  const f = await fixture();
  try {
    const { result } = await ready(f), id = randomUUID();
    let effects = 0;
    f.runtime.pi.on("tool_call", event => { if (event.toolName === "bash" && JSON.stringify(event.input).includes("GIT_REFLOG_ACTION=")) effects++; });
    const ordinary = f.runtime.ctx.executeTool;
    f.runtime.ctx.executeTool = async (...args) => {
      const receipt = await ordinary(...args);
      if (JSON.stringify(args).includes("GIT_REFLOG_ACTION=")) throw new Error("Receipt lost after actual Git integration");
      return receipt;
    };
    await f.control({ kind: "prepare-integration", result, id });
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    await f.runtime.command("off");
    await f.runtime.settle();
    for (let i = 0; i < 200 && (await f.state()).snapshot?.shutdown?.workers.some((worker: { state: { kind: string } }) => worker.state.kind !== "parked"); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const stopped = await f.state(), saved = stopped.snapshot; assert.ok(saved);
    assert.ok(saved.shutdown?.workers.every((worker: { state: { kind: string } }) => worker.state.kind === "parked"), "Actual worker stop evidence must settle before integration can finish shutdown");
    assert.equal(stopped.mode, "stopping");
    assert.equal(saved.integrations[0]?.state.kind, "unknown");
    const observe = `integration observe ${saved.id} ${id}`;
    const session = f.runtime.ctx.sessionManager.getSessionId;
    f.runtime.ctx.sessionManager.getSessionId = () => "foreign-owner";
    await f.runtime.command(observe);
    assert.match(f.runtime.notices.at(-1) ?? "", /exact retained.*session|trusted host command/i);
    f.runtime.ctx.sessionManager.getSessionId = session;
    assert.deepEqual((await f.state()).snapshot, saved, "Foreign observation cannot publish an outcome");
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal((await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] })).isError, true);
    const prompts = [...f.runtime.prompts], workerPrompts = [...f.worker.prompts];
    await f.runtime.command(observe);
    const reconciled = await f.state();
    assert.equal(reconciled.tasks[0]?.resultStatus.kind, "accepted", JSON.stringify(reconciled.snapshot?.integrations[0]?.state));
    assert.equal(reconciled.mode, "inactive", "Only actually settled shutdown releases ownership");
    assert.equal(reconciled.snapshot?.generation, saved.generation);
    assert.deepEqual(reconciled.snapshot?.attachments, saved.attachments);
    assert.deepEqual(reconciled.snapshot?.shutdown, saved.shutdown);
    assert.equal(reconciled.snapshot?.integrations.length, 1);
    assert.equal(effects, 1);
    assert.deepEqual(f.runtime.prompts, prompts);
    assert.deepEqual(f.worker.prompts, workerPrompts);
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).isError, true);
  } finally { await f.close(); }
});

test("explicit restart observation preserves retained controller identity and refuses unavailable evidence and write revival", async () => {
  if (process.env.ISSUE38_RESTART_CHILD === "1") {
    const f = await fixture();
    try {
      const { result } = await ready(f), id = randomUUID();
      const ordinary = f.runtime.ctx.executeTool;
      f.runtime.ctx.executeTool = async (...args) => {
        const receipt = await ordinary(...args);
        if (JSON.stringify(args).includes("GIT_REFLOG_ACTION=")) throw new Error("Lost applied integration receipt before restart");
        return receipt;
      };
      await f.control({ kind: "prepare-integration", result, id });
      assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
      await f.runtime.command("off");
      await f.runtime.settle();
      for (let i = 0; i < 200 && (await f.state()).snapshot?.shutdown?.workers.some((worker: { state: { kind: string } }) => worker.state.kind !== "parked"); i++) await new Promise(resolve => setTimeout(resolve, 5));
      const saved = (await f.state()).snapshot; assert.ok(saved?.shutdown);
      assert.ok(saved.shutdown.workers.every((worker: { state: { kind: string } }) => worker.state.kind === "parked"));
      const evidence = process.env.ISSUE38_RESTART_EVIDENCE; assert.ok(evidence);
      writeFileSync(evidence, JSON.stringify({ root: f.root, saved, id, result }));
    } finally { await f.close(); }
    return;
  }
  const evidence = join(mkdtempSync(join(tmpdir(), "restart-")), "saved.json");
  const setup = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-name-pattern=explicit restart observation", "tests/result-public.test.ts"], {
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, ISSUE38_RESTART_CHILD: "1", ISSUE38_RESTART_EVIDENCE: evidence },
    encoding: "utf8",
  });
  writeFileSync(`${evidence}.setup.log`, `${setup.stdout ?? ""}\n${setup.stderr ?? ""}`);
  writeFileSync(`${evidence}.setup-exit.json`, JSON.stringify({ status: setup.status, signal: setup.signal, error: setup.error?.message }));
  assert.equal(setup.status, 0, `${setup.error?.message ?? ""}\n${setup.stdout}\n${setup.stderr}`);
  // The setup process has actually exited: SQLite ownership is released, not bypassed.
  const { root, saved, id, result } = JSON.parse(readFileSync(evidence, "utf8"));
  const keys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_CHILD", "LEGION_TRIBUNUS_BOOTSTRAP"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = join(root, "a");
  delete process.env.PI_SUBAGENT_CHILD;
  delete process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  const runtime = composedRuntime(saved.context, "root-legatus", join(root, "recovery.jsonl"));
  runtime.pi.exec = async (command, args) => {
    assert.doesNotMatch(JSON.stringify(args), /GIT_REFLOG_ACTION=|merge.*--ff-only/, "Recovery exposes observation only");
    const receipt = spawnSync(command, args, { encoding: "utf8" });
    if (receipt.status === null) throw receipt.error ?? new Error(`Read-only command unsettled: ${receipt.signal}`);
    return { code: receipt.status, stdout: receipt.stdout, stderr: receipt.stderr, killed: false };
  };
  extension(runtime.pi);
  const state = async () => {
    await runtime.command("status --details");
    const text = runtime.notices.at(-1) ?? "";
    assert.ok(text.includes("State\n"), text);
    return JSON.parse(text.slice(text.indexOf("State\n") + "State\n".length));
  };
  const observe = `integration observe ${saved.id} ${id}`;
  try {
    await runtime.emit("session_start");
    assert.deepEqual((await state()).snapshot, saved, "Restart and status must not reconcile automatically");
    await runtime.command(`resume ${saved.id}`);
    assert.match(runtime.notices.at(-1) ?? "", /not known settled/);
    assert.deepEqual((await state()).snapshot, saved, "Resume cannot bypass unsettled shutdown");
    const foreign = composedRuntime(saved.context, "foreign-owner", join(root, "foreign-recovery.jsonl"));
    foreign.pi.exec = async () => { throw new Error("Foreign observation must refuse before Git access"); };
    extension(foreign.pi);
    try {
      await foreign.emit("session_start");
      await foreign.command(observe);
      assert.match(foreign.notices.at(-1) ?? "", /exact retained owner\/session\/context\/controller/i);
      assert.deepEqual((await state()).snapshot, saved, "Supplied IDs do not attach a foreign native session");
    } finally { await foreign.emit("session_shutdown"); }
    const session = runtime.ctx.sessionManager.getSessionId;
    runtime.ctx.sessionManager.getSessionId = () => "foreign-owner";
    await runtime.command(observe);
    assert.match(runtime.notices.at(-1) ?? "", /trusted host command/);
    runtime.ctx.sessionManager.getSessionId = session;
    writeFileSync(join(saved.context, "unrelated.txt"), "Preserve dirty owning checkout\n");
    await runtime.command(observe);
    let view = await state();
    assert.equal(view.mode, "stopping");
    assert.equal(view.snapshot.integrations[0].state.kind, "unknown", "Dirty or missing evidence is never a no-effect/retry grant");
    assert.equal(readFileSync(join(saved.context, "unrelated.txt"), "utf8"), "Preserve dirty owning checkout\n");
    // Fixture owner removes only its own obstruction; production never repairs it.
    unlinkSync(join(saved.context, "unrelated.txt"));
    await runtime.command(observe);
    view = await state();
    assert.equal(view.tasks[0].resultStatus.kind, "accepted", JSON.stringify(view.snapshot.integrations[0].state));
    assert.equal(view.mode, "inactive");
    assert.equal(view.snapshot.generation, saved.generation);
    assert.deepEqual(view.snapshot.attachments, saved.attachments);
    assert.deepEqual(view.snapshot.shutdown, saved.shutdown);
    assert.deepEqual(view.snapshot.resumeState, saved.resumeState);
    assert.deepEqual(runtime.prompts, [], "Explicit recovery sends no native continuation or worker turn");
    assert.equal((await runtime.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal((await runtime.call("legion_result", { action: { kind: "prepare-integration", result, id: randomUUID() } })).isError, true);
    await runtime.command(observe);
    assert.equal((await state()).snapshot.revision, view.snapshot.revision, "Repeated settled observation is effect-free and releases transient locks");
  } finally {
    await runtime.emit("session_shutdown");
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("ordinary permission denial preserves the parent and never becomes accepted or authorizes retry", async () => {
  const f = await fixture();
  try {
    const { result } = await ready(f), id = randomUUID();
    const before = execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", "HEAD"], { encoding: "utf8" });
    let prompts = 0;
    f.runtime.pi.on("tool_call", event => {
      if (event.toolName === "bash" && JSON.stringify(event.input).includes("GIT_REFLOG_ACTION=")) {
        prompts++;
        return { block: true, reason: "Ordinary operator permission denied" };
      }
    });
    await f.control({ kind: "prepare-integration", result, id });
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal(execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", "HEAD"], { encoding: "utf8" }), before);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "integration-unknown", "A denied/absent completion receipt is not a proven effect outcome");
    assert.equal((await f.control({ kind: "reconcile-integration", id })).isError, true);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "integration-unknown");
    assert.equal((await f.call("legion_integrate", { requestId: id })).isError, true);
    assert.equal(prompts, 1);
  } finally { await f.close(); }
});

test("public verification retains exceptions and rejects self/stale review; unchanged content reuses independent review", async () => {
  const f = await fixture();
  try {
    const { result, review } = await ready(f);
    assert.equal((await f.control({ ...review, id: randomUUID(), reviewer: { session: "worker-session", run: "self" } })).isError, true);
    assert.equal((await f.control({ ...review, id: randomUUID(), reviewer: { session: "root-legatus", run: "coordinator" } })).isError, true);
    await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] });
    await f.control({ kind: "verify", result, verification: passing });
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "ready");
    assert.equal((await f.state()).snapshot?.results[0]?.reviews.length, 1);
    await f.control({ kind: "verify", result, verification: { ...passing, exceptions: [{ description: "Material gap", resolution: { kind: "open" } }] } });
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "verification-required");
    assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).isError, true);
    await f.control({ kind: "verify", result, verification: { ...passing, exceptions: [{ description: "Material gap", resolution: { kind: "resolved", summary: "Relevant check", evidence: ["new-check"] } }] } });
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "review-required");
    assert.equal((await f.control({ ...review, id: randomUUID() })).isError, true, "Old verification digest is stale");
    writeFileSync(join(f.worker.ctx.cwd, "result.txt"), "material new content\n");
    execFileSync("git", ["-C", f.worker.ctx.cwd, "commit", "-qam", "material result", "--author=Fixture <fixture@example.test>"], { env: { ...process.env, GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
    const recaptured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] });
    assert.ok(recaptured.details?.kind === "result-stage", JSON.stringify(recaptured));
    assert.notEqual(recaptured.details.result.digest, result.digest);
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "verification-required");
    assert.equal((await f.control({ ...review, id: randomUUID() })).isError, true);
  } finally { await f.close(); }
});

test("public result review never clears an Emperor decision or changed-scope assignment hold", async () => {
  const f = await fixture();
  try {
    const { result } = await ready(f);
    await f.runtime.settle();
    await f.runtime.command(`correction ${f.task.id}@1 Change acceptance`);
    await f.startPending();
    const original = (await f.state()).snapshot?.submissions.at(-1); assert.ok(original);
    const source = { id: original.id, revision: 1 };
    assert.equal((await f.call("legion_intake", { kind: "propose-amendment", source, affected: [f.task], category: "acceptance", change: "Require revised acceptance", question: "Approve revised acceptance?", recommendation: "Ask Emperor" })).isError, false);
    let view = await f.state();
    assert.equal(view.tasks[0]?.resultStatus.kind, "held");
    const decision = view.snapshot?.decisions[0], amendment = view.snapshot?.amendments[0]; assert.ok(decision && amendment);
    await f.runtime.settle();
    await f.runtime.emit("input", { source: "interactive", text: "Approve the exact amended acceptance." });
    await f.startPending();
    const answer = (await f.state()).snapshot?.submissions.at(-1); assert.ok(answer);
    assert.equal((await f.call("legion_intake", { kind: "answer", source: { id: answer.id, revision: 1 }, decision: { id: decision.id, revision: 1 }, effect: { kind: "approve-amendment", amendment: amendment.id } })).isError, false);
    assert.equal((await f.call("legion_intake", { kind: "correction", id: randomUUID(), source, target: { id: f.task.id, revision: 2 }, authorization: { kind: "amendment", amendment: amendment.id } })).isError, false);
    view = await f.state();
    assert.match(view.tasks[0]?.correctionHold ?? "", /assignment.*authority/i);
    assert.equal(view.tasks[0]?.resultStatus.kind, "held");
    assert.equal(view.tasks[0]?.eligibility, "blocked");
    assert.equal((await f.control({ kind: "capture", task: { id: f.task.id, revision: 2 }, requiredChecks: ["focused"] })).isError, true);
    assert.equal((await f.control({ kind: "verify", result, verification: passing })).isError, true);
    assert.equal((await f.control({ kind: "prepare-integration", result, id: randomUUID() })).isError, true);
    assert.equal((await f.state()).snapshot?.integrations.length, 0);
  } finally { await f.close(); }
});

test("a nested native cwd pins only its independent owning worktree and preserves primary checkout and run context", async () => {
  const f = await fixture({ nested: true, linked: true });
  try {
    const { result } = await ready(f), id = randomUUID();
    const view = await f.state(), owning = execFileSync("git", ["-C", f.runtime.ctx.cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    assert.notEqual(owning, f.runtime.ctx.cwd);
    const primary = join(f.root, "repo"), primaryBefore = execFileSync("git", ["-C", primary, "rev-parse", "HEAD"], { encoding: "utf8" });
    assert.notEqual(owning, primary);
    assert.equal(view.snapshot?.context, f.runtime.ctx.cwd, "Run routing retains the original nested session context");
    assert.equal(view.snapshot?.results[0]?.identity.workspace.parentPath, owning);
    await f.control({ kind: "prepare-integration", result, id });
    const integrated = await f.call("legion_integrate", { requestId: id });
    assert.equal(integrated.isError, false, JSON.stringify(integrated));
    assert.equal((await f.state()).tasks[0]?.resultStatus.kind, "accepted");
    assert.equal(execFileSync("git", ["-C", owning, "show", "HEAD:result.txt"], { encoding: "utf8" }), "reviewed content\n");
    assert.equal(execFileSync("git", ["-C", primary, "rev-parse", "HEAD"], { encoding: "utf8" }), primaryBefore);
    assert.equal(execFileSync("git", ["-C", primary, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally { await f.close(); }
});
