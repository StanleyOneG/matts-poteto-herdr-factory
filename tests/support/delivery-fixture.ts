import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { Legion, type LegionOptions } from "../../src/intake.js";
import { GitWorkspace } from "../../src/git-workspace.js";
import { mattInitializationPrompt, type TribunusHost } from "../../src/tribunus.js";

const exec = promisify(execFile);
export async function deliveryFixture() {
  const root = await mkdtemp(join(tmpdir(), "r38-"));
  const checkout = join(root, "repo"); await mkdir(checkout);
  for (const args of [["init", "-b", "task-parent"], ["config", "user.name", "Result state fixture"], ["config", "user.email", "result@example.test"]]) await exec("git", ["-C", checkout, ...args]);
  await writeFile(join(checkout, "tracked"), "original\n");
  await exec("git", ["-C", checkout, "add", "tracked"]); await exec("git", ["-C", checkout, "commit", "-m", "initial"]);
  const git = new GitWorkspace(checkout, async command => {
    try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
    catch (error) { const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: result.code, output: result.stdout + result.stderr }; }
  });
  let worker: Parameters<TribunusHost["assign"]>[0]["worker"] | null = null;
  const reports = new Map<string, Parameters<NonNullable<TribunusHost["watchReports"]>>[1]>();
  const host: TribunusHost = {
    createWindow: async ({ launch, cwd }) => {
      const window = { endpoint: "/controlled/socket", server: "fixture", workspace: "w", tab: launch.id, pane: "p", terminal: "t" };
      worker = { address: { launch: launch.id, window, session: "executor", generation: randomUUID() }, resources: { cwd, principal: { model: "openai-codex/gpt-6.1-sol", thinking: "high", contextWindow: 272000 }, skills: ["herdr", "handoff", "matt-tdd", "matt-teach", "code-review", "implement"].map(name => ({ name, path: `/skills/${name}` })), diagnostics: [{ name: "Tribunus model", status: "ready", message: "fixture principal available" }], children: [] }, identityEvidence: "authenticated-fixture" };
      return window;
    },
    startPi: async () => {}, inspectWorker: async () => worker,
    initialize: async ({ worker, command }) => ({ profile: "matt", command, address: worker.address, nativePrompt: mattInitializationPrompt(command), skillPath: "", modeEntry: "mode", settledEntry: "settled" }),
    assign: async () => ({ application: "assignment-user-entry" }),
    watchReports: ({ worker }, onReport) => { reports.set(worker.address.launch, onReport); },
  };
  let storageFault: LegionOptions["storageFault"];
  const options: LegionOptions = { storageFault: point => storageFault?.(point), storagePath: join(root, "state"), context: checkout, session: "controller", preflight: async () => [], tribuni: { host: () => host }, assignments: { workspaceRoot: join(root, "workspaces"), repository: () => git } };
  const legion = new Legion(options);
  let sequence = 0;
  const command = (text: string) => legion.command({ text, requestKey: `command-${++sequence}`, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  await legion.command({ text: "task Implement exact result", requestKey: "task", workflowInvocation: { kind: "native-skill", workflow: "implement" }, evidence: { origin: "emperor", transport: "rpc", session: "controller", generation: null, presented: [] } });
  const initial = (await legion.state()).snapshot; assert.ok(initial); const submission = initial.submissions[0]; assert.ok(submission);
  assert.equal((await legion.submit({ kind: "interpretation", requestKey: "interpret", proposal: { kind: "new-task", source: { id: submission.id, revision: 1 }, goal: "Implement exact result", acceptance: ["Exact result is verified"], questions: [] }, evidence: { session: "controller", generation: initial.generation, legatus: initial.id, run: "legatus", sources: [{ id: submission.id, revision: 1 }] } })).kind, "applied");
  const task = (await legion.state()).tasks[0]; assert.ok(task);
  await command(`reserve ${task.id}@1 --parent refs/heads/task-parent`);
  assert.equal((await legion.command({ workspaceRequest: `command-${sequence}` })).kind, "reserved");
  await command(`launch ${task.id}@1`); assert.equal((await legion.command({ launchRequest: `command-${sequence}` })).kind, "launched");
  const launch = (await legion.state()).tasks[0]?.launch; assert.ok(launch?.kind === "assigned", JSON.stringify(launch));
  const publish = reports.get(launch.worker.address.launch); assert.ok(publish); await publish({ address: launch.worker.address, command: launch.command, outcome: "reported-result", assistantText: "Completed, not accepted", evidence: ["worker-report"] });
  const control = async (action: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "result-control", action, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus-verification" } });
  };
  const interpret = async (proposal: unknown) => {
    const snapshot = (await legion.state()).snapshot; assert.ok(snapshot);
    return legion.submit({ kind: "interpretation", requestKey: `interpret-${++sequence}`, proposal, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "legatus", sources: snapshot.submissions.map(source => ({ id: source.id, revision: source.revision })) } });
  };
  return { legion, options, command, control, interpret, checkout, git, reports, task: { id: task.id, revision: 1 }, launch, root, setStorageFault: (fault: LegionOptions["storageFault"]) => { storageFault = fault; } };
}

export async function acceptedResult(f: Awaited<ReturnType<typeof deliveryFixture>>) {
  const { GitIntegration } = await import("../../src/git-integration.js");
  const source = f.launch.worker.resources.cwd;
  await writeFile(join(source, `result-${f.task.id}.txt`), "accepted content\n");
  await exec("git", ["-C", source, "add", `result-${f.task.id}.txt`]);
  await exec("git", ["-C", source, "-c", "user.name=Delivery fixture", "-c", "user.email=delivery@example.test", "commit", "-m", "result"]);
  f.options.results = { repository: () => new GitIntegration({ cwd: f.checkout, run: async command => {
    try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
    catch (error) { const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: result.code, output: result.stdout + result.stderr }; }
  } }) };
  const captured = await f.control({ kind: "capture", task: f.task, requiredChecks: ["focused"] });
  assert.ok(captured.kind === "result-stage", JSON.stringify(captured));
  const result = { id: captured.result.id, digest: captured.result.digest };
  const verified = await f.control({ kind: "verify", result, verification: { criteria: [{ criterion: 0, outcome: "passed", evidence: ["criteria.md"] }], checks: [{ name: "focused", outcome: "passed", evidence: ["test.log"] }], exceptions: [{ description: "Material exception", resolution: { kind: "resolved", summary: "Checked", evidence: ["exception.md"] } }] } });
  assert.ok(verified.kind === "result-stage");
  const review = { kind: "review", result, id: randomUUID(), verificationDigest: verified.result.verifications.at(-1)?.digest, reviewer: { session: "reviewer", run: "review" }, reference: "review.md", outcome: "approved", evidence: ["review.md"] };
  assert.equal((await f.control(review)).kind, "result-stage");
  const id = randomUUID();
  assert.equal((await f.control({ kind: "prepare-integration", result, id })).kind, "integration-stage");
  const integrated = await f.legion.command({ integrationRequest: id });
  assert.ok(integrated.kind === "integration-stage", JSON.stringify(integrated));
  assert.equal(integrated.status.kind, "accepted", JSON.stringify(integrated));
  return { result, review };
}
export async function deliveryControl({ f, action }: { f: Awaited<ReturnType<typeof deliveryFixture>>; action: unknown }) {
  const snapshot = (await f.legion.state()).snapshot; assert.ok(snapshot);
  return f.legion.submit({ kind: "delivery-control", action, evidence: { session: "controller", generation: snapshot.generation, legatus: snapshot.id, run: "delivery" } });
}

/** Controlled read-only Git boundary; exercises actual fixture branches, cleanliness and accepted ancestry. */
export async function observeFinalGit(input: Parameters<NonNullable<import("../../src/delivery-domain.js").DeliveryAdapter["observeFinal"]>>[0]): Promise<import("zod").z.infer<typeof import("../../src/delivery-domain.js").FinalObservation>> {
  const { workspace, results } = input;
  const text = async (...args: string[]) => (await exec("git", ["-C", workspace.path, ...args])).stdout.trim();
  try {
    const { realpath } = await import("node:fs/promises");
    if (await realpath(await text("rev-parse", "--path-format=absolute", "--git-common-dir")) !== workspace.repository ||
        await text("symbolic-ref", "HEAD") !== workspace.branch || await text("status", "--porcelain", "--untracked-files=all")) throw new Error("Mismatched or dirty final branch");
    const commit = await text("rev-parse", "HEAD"), tree = await text("rev-parse", "HEAD^{tree}");
    for (const proof of results) {
      if (proof.integration.state.kind !== "confirmed") throw new Error("Unconfirmed integration");
      await text("merge-base", "--is-ancestor", proof.integration.state.parent.after, commit);
    }
    return { kind: "clean", commit, tree, evidence: ["read-only-exact-branch-cleanliness-and-accepted-ancestry"] };
  } catch (error) { return { kind: "held", message: String(error), evidence: ["read-only-final-observation-held"] }; }
}
