import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Legion } from "../src/intake.js";
import { GitWorkspace, type GuardedCommand } from "../src/git-workspace.js";
import { GitIntegration } from "../src/git-integration.js";
import { mattInitializationPrompt, type TribunusHost } from "../src/tribunus.js";

const exec = promisify(execFile);
// Public Legion command/task/state plus controlled native-host and ordinary-command boundaries; all Git is real.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rc-")), cwd = join(root, "repo"); await mkdir(cwd);
  const git = async (path: string, ...args: string[]) => (await exec("git", ["-C", path, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } })).stdout.trim();
  await git(cwd, "init", "-q", "-b", "task-parent");
  await writeFile(join(cwd, "content.txt"), "base\n"); await git(cwd, "add", "."); await git(cwd, "commit", "-qm", "base");
  let submitted = 0, active = 0, maxActive = 0;
  const run: GuardedCommand = async command => {
    const effect = command.includes("GIT_REFLOG_ACTION=");
    if (effect) { submitted++; active++; maxActive = Math.max(maxActive, active); }
    try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
    catch (error) { const receipt = z.object({ code: z.int(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: receipt.code, output: receipt.stdout + receipt.stderr }; }
    finally { if (effect) active--; }
  };
  let worker: Parameters<TribunusHost["assign"]>[0]["worker"] | null = null;
  const reports = new Map<string, Parameters<NonNullable<TribunusHost["watchReports"]>>[1]>();
  const host: TribunusHost = {
    createWindow: async ({ launch, cwd }) => {
      const window = { endpoint: "/controlled/socket", server: "fixture", workspace: "w", tab: launch.id, pane: launch.id, terminal: launch.id };
      worker = { address: { launch: launch.id, window, session: randomUUID(), generation: randomUUID() }, resources: { cwd, principal: { model: "openai-codex/gpt-6.1-sol", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review", "implement-spec"].map(name => ({ name, path: `/skills/${name}` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "Controlled principal available" }], children: [] }, identityEvidence: "controlled-native-host" };
      return window;
    },
    startPi: async () => {}, inspectWorker: async () => worker,
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "mode", settledEntry: "settled" }),
    assign: async () => ({ application: "assignment-user-entry" }),
    watchReports: ({ worker }, publish) => { reports.set(worker.address.launch, publish); },
  };
  const legion = new Legion({ context: cwd, storagePath: join(root, "state"), session: "owner", preflight: async () => [],
    assignments: { workspaceRoot: join(root, "workspaces"), repository: () => new GitWorkspace(cwd, run) },
    results: { repository: () => new GitIntegration({ cwd, run }) }, tribuni: { host: () => host } });
  let sequence = 0;
  const command = (text: string) => legion.command({ text, requestKey: `command-${++sequence}`, evidence: { origin: "emperor", transport: "rpc", session: "owner", generation: null, presented: [] } });
  await command("implement-spec=on Approved bounded results");
  const control = async (action: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "result-control", action, evidence: { session: "owner", generation: snapshot.generation, legatus: snapshot.id, run: "trusted-legatus-run" } });
  };
  const task = async (content: string) => {
    await command(`task ${content}`);
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    const source = snapshot.submissions.at(-1); assert.ok(source);
    const intake = await legion.submit({ kind: "interpretation", requestKey: `intake-${++sequence}`, proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: content, acceptance: ["Exact content integrates"], questions: [] }, evidence: { session: "owner", generation: snapshot.generation, legatus: snapshot.id, run: "trusted-legatus-run", sources: [{ id: source.id, revision: 1 }] } });
    assert.equal(intake.kind, "applied", JSON.stringify(intake));
    const task = (await legion.state()).tasks.at(-1); assert.ok(task);
    await command(`reserve ${task.id}@1 --parent refs/heads/task-parent`);
    assert.equal((await legion.command({ workspaceRequest: `command-${sequence}` })).kind, "reserved");
    await command(`launch ${task.id}@1`); assert.equal((await legion.command({ launchRequest: `command-${sequence}` })).kind, "launched");
    const launch = (await legion.state()).tasks.at(-1)?.launch; assert.ok(launch?.kind === "assigned", JSON.stringify(launch));
    const path = launch.worker.resources.cwd;
    await writeFile(join(path, "content.txt"), `${content}\n`); await git(path, "commit", "-qam", content);
    const publish = reports.get(launch.worker.address.launch); assert.ok(publish);
    await publish({ address: launch.worker.address, command: launch.command, outcome: "reported-result", assistantText: "Reported, not accepted", evidence: ["native-report"] });
    return { id: task.id, revision: 1, path };
  };
  const ready = async (task: { id: string; revision: number }) => {
    const captured = await control({ kind: "capture", task: { id: task.id, revision: task.revision }, requiredChecks: ["focused"] }); assert.ok(captured.kind === "result-stage", JSON.stringify(captured));
    const result = { id: captured.result.id, digest: captured.result.digest };
    const verified = await control({ kind: "verify", result, verification: { criteria: [{ criterion: 0, outcome: "passed", evidence: ["criterion"] }], checks: [{ name: "focused", outcome: "passed", evidence: ["exit-0"] }], exceptions: [] } }); assert.ok(verified.kind === "result-stage");
    const verificationDigest = verified.result.verifications.at(-1)?.digest; assert.ok(verificationDigest);
    assert.equal((await control({ kind: "review", id: randomUUID(), result, verificationDigest, reviewer: { session: "independent-reviewer", run: randomUUID() }, reference: "code-review.md", outcome: "approved", evidence: ["exact-review"] })).kind, "result-stage");
    return result;
  };
  return { legion, cwd, git, control, command, task, ready, effects: () => ({ submitted, maxActive }) };
}

test("competing owning-run integration requests serialize actual Git effects and hold pending or stale parents", async () => {
  const f = await fixture();
  try {
    const a = await f.task("first"), b = await f.task("second");
    const ar = await f.ready(a), br = await f.ready(b), ai = randomUUID(), bi = randomUUID();
    assert.equal((await f.control({ kind: "prepare-integration", result: ar, id: ai })).kind, "integration-stage");
    const pending = await f.control({ kind: "prepare-integration", result: br, id: bi });
    assert.ok(pending.kind === "rejected", JSON.stringify(pending));
    assert.equal(pending.code, "integration-held", "A pending intent excludes another parent integration");
    const outcomes = await Promise.all([f.legion.command({ integrationRequest: ai }), f.control({ kind: "prepare-integration", result: br, id: bi })]);
    assert.equal(outcomes[0]?.kind, "integration-stage");
    assert.ok(outcomes[1]?.kind === "rejected", JSON.stringify(outcomes[1]));
    assert.equal(outcomes[1].code, "result-authority", "Serialized second preparation observes the actual newly moved parent");
    const view = await f.legion.state();
    assert.equal(view.tasks[0]?.resultStatus.kind, "accepted");
    assert.notEqual(view.tasks[1]?.resultStatus.kind, "accepted");
    assert.equal(view.snapshot?.integrations.length, 1, "Rejected competing work creates no second effect intent");
    assert.deepEqual(f.effects(), { submitted: 1, maxActive: 1 });
    assert.equal(await readFile(join(f.cwd, "content.txt"), "utf8"), "first\n");
    assert.equal(await readFile(join(b.path, "content.txt"), "utf8"), "second\n");
    assert.equal(await f.git(b.path, "status", "--porcelain"), "");
  } finally { await f.command("off"); }
});

test("real divergent/conflicting content is held until separately resolved and freshly captured checked and reviewed", async () => {
  const f = await fixture();
  try {
    const task = await f.task("candidate"), old = await f.ready(task);
    await writeFile(join(f.cwd, "content.txt"), "parent changed\n"); await f.git(f.cwd, "commit", "-qam", "parent diverged");
    assert.equal((await f.control({ kind: "prepare-integration", result: old, id: randomUUID() })).kind, "rejected", "Old parent identity/review cannot integrate");
    const divergent = await f.ready(task), id = randomUUID();
    await f.control({ kind: "prepare-integration", result: divergent, id });
    await f.legion.command({ integrationRequest: id });
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "integration-failed");
    assert.deepEqual(f.effects(), { submitted: 0, maxActive: 0 }, "Adapter must not resolve conflicts or merge unreviewed trees");
    await assert.rejects(f.git(task.path, "merge", "refs/heads/task-parent"), "Disposable fixture proves an actual content conflict");
    await writeFile(join(task.path, "content.txt"), "separately authorized resolution\n"); await f.git(task.path, "add", "content.txt"); await f.git(task.path, "commit", "-qm", "fixture-authorized resolution");
    const captured = await f.control({ kind: "capture", task: { id: task.id, revision: 1 }, requiredChecks: ["focused"] }); assert.ok(captured.kind === "result-stage");
    assert.notEqual(captured.result.digest, divergent.digest);
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "verification-required");
    assert.equal((await f.control({ kind: "prepare-integration", result: { id: captured.result.id, digest: captured.result.digest }, id: randomUUID() })).kind, "rejected");
    const resolved = await f.ready(task), next = randomUUID();
    await f.control({ kind: "prepare-integration", result: resolved, id: next }); await f.legion.command({ integrationRequest: next });
    assert.equal((await f.legion.state()).tasks[0]?.resultStatus.kind, "accepted");
    assert.equal(await readFile(join(f.cwd, "content.txt"), "utf8"), "separately authorized resolution\n");
    assert.deepEqual(f.effects(), { submitted: 1, maxActive: 1 });
  } finally { await f.command("off"); }
});
