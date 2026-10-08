import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Legion } from "../src/intake.js";
import type { WorkspaceRepository } from "../src/git-workspace.js";
import { LaunchId, type TribunusHost } from "../src/tribunus.js";
async function fixture(host?: TribunusHost, fault?: NonNullable<import("../src/intake.js").LegionOptions["assignments"]>["fault"]) {
  const root = await mkdtemp(join(tmpdir(), "legion-launch-"));
  const commonDir = join(root, "repo.git");
  await mkdir(commonDir);
  const checkout = join(root, "checkout");
  await mkdir(checkout);
  let branch: string | null = null;
  let workspace: Awaited<ReturnType<WorkspaceRepository["inspect"]>>["workspace"] = null;
  const git: WorkspaceRepository = {
    locate: async () => ({
      commonDir, worktrees: [checkout]
    }),
    parent: async () => "a".repeat(40),
    inspect: async () => ({
      branch, path: workspace ? "directory" : "absent", workspace, parent: "a".repeat(40)
    }),
    createBranch: async (plan) => { branch = plan.commit; return {
      kind: "succeeded"
    }; },
    createWorktree: async (plan) => {
      workspace = {
        commonDir, branch: plan.branch, commit: plan.commit, backlink: true
      };
      return {
        kind: "succeeded"
      };
    },
  };
  const options = {
    storagePath: join(root, "state"), context: checkout, session: "controller",
    preflight: async () => [],
    assignments: {
      workspaceRoot: join(root, "workspaces"), repository: () => git, fault: (point: Parameters<NonNullable<typeof fault>>[0]) => fault?.(point)
    },
    tribuni: {
      host: () => host ?? null
    },
  };
  const legion = new Legion(options);
  let seq = 0;
  const evidence = {
    origin: "host-command", transport: "source-unavailable", session: "controller", generation: null, presented: []
  };
  const command = (text: string, requestKey = `request-${++seq}`) => legion.command({
    text, requestKey, evidence
  });
  await command("task Fix the trial label");
  const initial = await legion.state();
  const source = initial.snapshot?.submissions[0];
  assert.ok(source);
  const admitted = await legion.submit({
    kind: "interpretation", requestKey: "interpret", proposal: {
      kind: "new-task", source: {
        id: source.id, revision: 1
      }, goal: "Fix the trial label", acceptance: ["The label says Ready"], questions: [],
    }, evidence: {
      session: "controller", generation: initial.snapshot?.generation, legatus: initial.snapshot?.id, run: "fixture", sources: [{
          id: source.id, revision: 1
        }]
    }
  });
  assert.equal(admitted.kind, "applied");
  const task = (await legion.state()).tasks[0];
  assert.ok(task);
  const ready = async () => {
    assert.equal((await command(`reserve ${task.id}@1 --parent refs/heads/main`, "reserve")).kind, "deferred");
    const result = await legion.command({
      workspaceRequest: "reserve"
    });
    assert.equal(result.kind, "reserved");
    if (result.kind !== "reserved")
      assert.fail("Expected confirmed reservation");
    assert.equal(result.workspace.kind, "ready");
    return result.receipt.reservation;
  };
  return {
    legion, command, task, ready, git, options, root
  };
}
function externalWorker() {
  const window = {
    endpoint: "/test/local.sock", server: "local-instance", workspace: "w-test", tab: "t-test", pane: "p-test", terminal: "term-test"
  };
  const started: string[] = [], initialized: string[] = [], assignments: string[] = [];
  const actor = {
    started, initialized, assignments,
    observe: (worker: import("zod").z.infer<typeof import("../src/tribunus.js").VerifiedWorker>) => worker,
    proof: (proof: import("zod").z.infer<typeof import("../src/tribunus.js").Initialization>) => proof,
    emit: async (_report: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerReport>) => { },
  };
  let address: import("zod").z.infer<typeof import("../src/tribunus.js").WorkerAddress>;
  const host: TribunusHost = {
    createWindow: async () => window,
    startPi: async ({ launch }) => { actor.started.push(launch.id); address = {
      launch: launch.id, window, session: "actual-pi", generation: "7c3ace99-1c9d-4e36-a316-d88f6a183c11"
    }; },
    inspectWorker: async ({ cwd }) => actor.observe({
      address, identityEvidence: "exact-session", resources: {
        cwd, skills: ["herdr", "poteto-mode", "matt-tdd", "implement", "code-review"].map((name) => ({
          name, path: `/skills/${name}/SKILL.md`
        })), diagnostics: [{
            name: "Pi", status: "ready", message: "Target Pi"
          }]
      }
    }),
    initialize: async ({ worker, command }) => { actor.initialized.push(command); return actor.proof({
      command, address: worker.address, nativePrompt: '<skill name="poteto-mode" location="/skills/poteto-mode/SKILL.md">body</skill>', skillPath: "/skills/poteto-mode/SKILL.md", modeEntry: "new-mode", settledEntry: "settlement"
    }); },
    assign: async ({ assignment }) => { actor.assignments.push(assignment.goal); return {
      application: "applied-assignment"
    }; },
    watchReports: (_input, onReport) => { actor.emit = onReport; },
  };
  return {
    actor, host
  };
}
import { fork, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { Initialization, VerifiedWorker } from "../src/tribunus.js";
const Ready = z.object({ kind: z.literal("ready"), hello: z.object({ address: VerifiedWorker.shape.address, endpoint: z.string(), journal: z.string() }) });
async function receiverFixture() {
  const profile = await mkdtemp(join(tmpdir(), "legion-receiver-public-"));
  process.env.PI_CODING_AGENT_DIR = profile;
  const authority = { owner: "938ab712-1c42-4a4e-8769-6ef383730fe9", session: "controller", generation: 1, epoch: 0 };
  const { host } = externalWorker();
  let receiver: z.infer<typeof Ready> | null = null;
  let child: ChildProcess | null = null;
  const messages: unknown[] = [];
  let scope = "", reservation = "";
  const send = async (kind: string, command: string, assignment: unknown = null): Promise<unknown> => {
    assert.ok(receiver);
    const address = receiver.hello.address, endpoint = receiver.hello.endpoint;
    return new Promise((resolve, reject) => {
      const socket = connect(endpoint); let bytes = "";
      socket.on("connect", () => socket.write(JSON.stringify({ capability: "offline-test-capability", authority, reservation, scope, address, command, kind, assignment }) + "\n"));
      socket.on("data", (chunk) => { bytes += chunk; if (bytes.includes("\n")) { socket.end(); try { const result = z.object({ kind: z.literal("ok"), value: z.unknown() }).parse(JSON.parse(bytes)); resolve(result.value); } catch (error) { reject(error); } } });
      socket.on("error", reject);
    });
  };
  host.createWindow = async ({ launch, cwd }) => {
    await mkdir(cwd, {recursive:true});
    scope = launch.scope; reservation = launch.reservation;
    const path = join(profile, "metadata.json");
    await writeFile(path, JSON.stringify({ launch: launch.id, reservation, scope, authority, cwd }));
    child = fork(join(process.cwd(), "tests/support/tribunus-receiver.mjs"), [profile, path], { execArgv: ["--import", "tsx"], silent: true });
    const principal = child;
    principal.on("message", (message) => messages.push(message));
    let errors = ""; principal.stderr?.on("data", (data) => { errors += data; });
    receiver = await new Promise((resolve, reject) => {
      principal.on("message", (message) => { const parsed = Ready.safeParse(message); if (parsed.success) resolve(parsed.data); });
      principal.once("exit", (code) => reject(new Error(`Receiver exited ${code}. ${errors}`)));
    });
    assert.ok(receiver);
    return receiver.hello.address.window;
  };
  host.startPi = async () => {};
  host.inspectWorker = async () => VerifiedWorker.parse(await send("inspect", randomUUID()));
  host.initialize = async ({ command }) => Initialization.parse(await send("initialize", command));
  host.assign = async ({ command, assignment }) => z.object({ application: z.string() }).parse(await send("assign", command, assignment));
  const watcher = new LocalTribunusHost(async () => { throw new Error("No external launch allowed"); }, authority);
  host.watchReports = (input, onReport, onUnavailable) => watcher.watchReports(input, onReport, onUnavailable);
  const f = await fixture(host);
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(predicate(), "Receiver observation must arrive");
  };
  return { ...f, messages, waitFor, send,
    settle: (command: string, reason: string, pausePublication = false) => { assert.ok(child); child.send({ kind: "settle", command, reason, error: "External provider failure", pausePublication }); },
    close: async () => { await f.command("off"); if (child) { const exited = once(child, "exit"); child.send({ kind: "shutdown" }); await exited; } },
  };
}

test("completed worker bytes publish atomically and remain publicly reported under writer preemption", async () => {
  const f = await receiverFixture();
  try {
    await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
    const assigned = (await f.legion.state()).tasks[0]?.launch;
    if (assigned?.kind !== "assigned") assert.fail("Expected applied assignment");
    f.settle(assigned.command, "stop", true);
    await f.waitFor(() => f.messages.some((message) => z.object({ kind: z.literal("publication-open") }).safeParse(message).success));
    await new Promise((r) => setTimeout(r, 500));
    const state = (await f.legion.state()).tasks[0]?.launch;
    assert.equal(state?.kind, "reported");
    if (state?.kind !== "reported") assert.fail("Expected complete public result");
    assert.equal(state.report.outcome, "reported-result");
    await f.command(`launch ${f.task.id}@1`, "duplicate"); await f.legion.command({ launchRequest: "duplicate" });
    assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "reported");
  } finally { await f.close(); }
});

for (const reason of ["error", "aborted"]) {
  test(`${reason} settlement publishes one addressed failed report after application without repeating assignment`, async () => {
    const f = await receiverFixture();
    try {
      await f.ready(); await f.command(`launch ${f.task.id}@1`, "launch"); await f.legion.command({ launchRequest: "launch" });
      const assigned = (await f.legion.state()).tasks[0]?.launch;
      if (assigned?.kind !== "assigned") assert.fail("Expected application before result");
      const application = assigned.application;
      f.settle(assigned.command, reason);
      await f.waitFor(() => f.messages.some((message) => z.object({kind:z.literal("settled")}).safeParse(message).success));
      await new Promise(r => setTimeout(r,100));
      const state = (await f.legion.state()).tasks[0]?.launch;
      assert.equal(state?.kind, "reported");
      if (state?.kind !== "reported") assert.fail("Expected explicit failure result");
      assert.equal(state.report.outcome, "failed");
      assert.match(state.report.assistantText, reason === "error" ? /error/ : /aborted/);
      assert.ok(state.report.evidence.length > 0);
      assert.equal(state.application, application);
      assert.equal(state.command, assigned.command);
      const duplicate = await f.send("assign", assigned.command, assigned.assignment);
      assert.deepEqual(duplicate, {application});
      await f.command(`launch ${f.task.id}@1`, "duplicate"); await f.legion.command({launchRequest:"duplicate"});
      assert.equal((await f.legion.state()).tasks[0]?.launch.kind, "reported");
    } finally { await f.close(); }
  });
}
