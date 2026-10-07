import { Legion } from "../src/intake.js";
import { GitWorkspace } from "../src/git-workspace.js";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rename } from "node:fs/promises";
import { z } from "zod";
const exec = promisify(execFile);
const args = z
  .object({
    root: z.string(),
    cwd: z.string(),
    session: z.string(),
    mode: z.enum(["reserve", "interrupt", "reconcile", "observe", "contend"]),
    gate: z.string().optional(),
    effectGate: z.string().optional(),
  })
  .parse(JSON.parse(process.argv[2] ?? ""));
const runner = async (command: string) => {
  if (args.effectGate && command.includes("'update-ref'")) {
    const view = await legion.state();
    const claim = view.tasks[0]?.claim;
    if (claim?.kind !== "owned" || claim.workspace.kind !== "dispatched")
      throw new Error("Missing held dispatch");
    await writeFile(`${args.effectGate}.pending`, JSON.stringify(claim));
    await rename(`${args.effectGate}.pending`, `${args.effectGate}.ready`);
    await exec("bash", [
      "-c",
      'read -r released < "$1"',
      "fixture",
      args.effectGate,
    ]);
  }
  if (args.mode === "interrupt" && command.includes("'update-ref'")) {
    if (!args.gate) throw new Error("Missing test-owned gate");
    const child = spawn(
      "bash",
      [
        "-c",
        `read -r released < '${args.gate}'; ${command}; printf done > '${args.gate}.done'`,
      ],
      { cwd: args.cwd, detached: true, stdio: "ignore" },
    );
    child.unref();
    const view = await legion.state();
    const claim = view.tasks[0]?.claim;
    if (claim?.kind !== "owned") throw new Error("Missing dispatched claim");
    process.stdout.write(
      JSON.stringify({
        kind: "interrupted",
        owner: claim.reservation.owner,
        id: claim.reservation.id,
        branch: claim.reservation.plan.branch,
        path: claim.reservation.plan.path,
        child: child.pid,
      }) + "\n",
      () => process.exit(0),
    );
    return new Promise<never>(() => {});
  }
  try {
    return {
      kind: "finished" as const,
      code: 0,
      output: (await exec("bash", ["-c", command], { cwd: args.cwd })).stdout,
    };
  } catch (error) {
    if (
      error instanceof Error &&
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
const git = new GitWorkspace(args.cwd, runner);
if (args.mode === "contend") {
  const parent = git.parent.bind(git);
  git.parent = async (branch) => {
    const commit = await parent(branch);
    const gate = args.gate;
    if (!gate) throw new Error("Missing contender gate");
    const view = await legion.state();
    await writeFile(
      `${gate}.pending`,
      JSON.stringify({
        pid: process.pid,
        owner: view.snapshot?.id,
        task: view.tasks[0]?.id,
        parent: commit,
      }),
    );
    await rename(`${gate}.pending`, `${gate}.ready`);
    await exec("bash", ["-c", 'read -r released < "$1"', "fixture", gate]);
    return commit;
  };
}
const legion = new Legion({
  storagePath: join(args.root, "intake"),
  context: args.cwd,
  session: args.session,
  preflight: async () => [],
  assignments: {
    workspaceRoot: join(args.root, "workspaces"),
    repository: () => git,
  },
});
const evidence = {
  origin: "host-command",
  transport: "source-unavailable",
  session: args.session,
  generation: null,
  presented: [],
};
const command = (text: string) =>
  legion.command({
    text,
    requestKey: `${args.session}/${Date.now()}/${text}`,
    evidence,
  });
let view = await legion.state();
if (args.mode === "observe") {
  const claim = view.tasks[0]?.claim;
  process.stdout.write(
    JSON.stringify({
      kind: "observed",
      mode: view.mode,
      claim,
      ownerObservations: view.ownerObservations,
      requests: view.snapshot?.workspaceRequests,
    }) + "\n",
  );
} else {
  if (view.snapshot) await command(`resume ${view.snapshot.id}`);
  else {
    await command("task Shared external work");
    view = await legion.state();
    const source = view.snapshot?.submissions[0];
    if (!source) throw new Error("Missing submission");
    await legion.submit({
      kind: "interpretation",
      requestKey: "interpret",
      proposal: {
        kind: "new-task",
        source: { id: source.id, revision: 1 },
        goal: "Shared external work",
        acceptance: [],
        questions: [],
      },
      evidence: {
        session: args.session,
        generation: view.snapshot?.generation,
        legatus: view.snapshot?.id,
        run: "fixture",
        sources: [{ id: source.id, revision: 1 }],
      },
    });
  }
  view = await legion.state();
  const task = view.tasks[0];
  if (!task) throw new Error("Missing task");
  const requestKey = `${args.session}/${Date.now()}/workspace`;
  const recorded = await legion.command({
    text:
      args.mode === "reconcile"
        ? `reconcile ${task.id}`
        : `reserve ${task.id}@1 --parent refs/heads/intended --source https://github.com/Fixture/Project/issues/9`,
    requestKey,
    evidence,
  });
  if (recorded.kind !== "deferred") throw new Error(JSON.stringify(recorded));
  const result = await legion.command({ workspaceRequest: requestKey });
  if (result.kind === "reserved")
    process.stdout.write(
      JSON.stringify({
        kind: result.kind,
        owner: result.receipt.reservation.owner,
        id: result.receipt.reservation.id,
        branch: result.receipt.reservation.plan.branch,
        path: result.receipt.reservation.plan.path,
        workspace: result.workspace,
        message: result.message,
      }) + "\n",
    );
  else if (result.kind === "ownership-blocked")
    process.stdout.write(
      JSON.stringify({
        kind: result.kind,
        owner: result.reservation.owner,
        id: result.reservation.id,
        branch: result.reservation.plan.branch,
        path: result.reservation.plan.path,
        message: result.message,
      }) + "\n",
    );
  else if (result.kind === "uncertain") {
    const current = await legion.state();
    process.stdout.write(
      JSON.stringify({
        ...result,
        pending: current.snapshot?.workspaceRequests.find(
          (r) => r.id === requestKey,
        ),
      }) + "\n",
    );
  } else process.stdout.write(JSON.stringify(result) + "\n");
  await command("off");
}
