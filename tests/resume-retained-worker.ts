import { Legion } from "../src/intake.js";
import { GitWorkspace, type GuardedCommand } from "../src/git-workspace.js";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { z } from "zod";

const args = z.strictObject({ root: z.string(), cwd: z.string(), session: z.string(), mode: z.enum(["reserve", "interrupt", "resume"]), run: z.uuid().optional() }).parse(JSON.parse(process.argv[2] ?? ""));
const execute = promisify(execFile);
const commands: string[] = [];
const runner: GuardedCommand = async command => {
  commands.push(command);
  if (args.mode === "interrupt" && command.includes("'update-ref'")) {
    const view = await legion.state();
    process.stdout.write(JSON.stringify({ kind: "effect-dispatched", command, view }) + "\n");
    const input = createInterface({ input: process.stdin });
    for await (const line of input) {
      if (line !== "effect-started") throw new Error("Only the owned effect-start acknowledgement is accepted");
      input.close();
      // Genuine controller exit releases SQLite leases; the separately owned effect stays alive.
      process.exit(0);
    }
    throw new Error("Effect-start acknowledgement missing");
  }
  try { return { kind: "finished", code: 0, output: (await execute("bash", ["-c", command])).stdout }; }
  catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "number" && "stdout" in error && typeof error.stdout === "string") return { kind: "finished", code: error.code, output: error.stdout };
    return { kind: "unknown", message: String(error) };
  }
};
const git = new GitWorkspace(args.cwd, runner);
const legion = new Legion({ storagePath: join(args.root, "state"), context: args.cwd, session: args.session, preflight: async () => [],
  assignments: { workspaceRoot: join(args.root, "owned"), repository: () => git },
  resume: { repository: commonDir => new GitWorkspace(commonDir, runner), worker: authority => new LocalTribunusHost(async () => { throw new Error("Observation cannot execute control/effects"); }, authority) },
});
const evidence = { origin: "host-command", transport: "source-unavailable", session: args.session, generation: null, presented: [] };
const command = (text: string) => legion.command({ text, requestKey: randomUUID(), evidence });
const initial = await legion.state();
if (args.mode === "resume") {
  if (!args.run) throw new Error("Explicit run ID required");
  const result = await command(`resume ${args.run}`);
  process.stdout.write(JSON.stringify({ initial, result, view: await legion.state(), commands }) + "\n");
} else {
  await command("task Preserve bounded retained work");
  const view = await legion.state(), source = view.snapshot?.submissions[0];
  if (!view.snapshot || !source) throw new Error("Missing admitted source");
  const scoped = await legion.submit({ kind: "interpretation", requestKey: "scope", proposal: { kind: "new-task", source: { id: source.id, revision: 1 }, goal: "Preserve retained work", acceptance: ["No reset, adoption or duplicate effect"], questions: [] }, evidence: { session: args.session, generation: view.snapshot.generation, legatus: view.snapshot.id, run: "fixture", sources: [{ id: source.id, revision: 1 }] } });
  if (scoped.kind !== "applied") throw new Error(JSON.stringify(scoped));
  const task = (await legion.state()).tasks[0];
  if (!task) throw new Error("Missing bounded task");
  await legion.command({ text: `reserve ${task.id}@1 --parent refs/heads/main`, requestKey: "reserve", evidence });
  const result = await legion.command({ workspaceRequest: "reserve" });
  process.stdout.write(JSON.stringify({ initial, result, view: await legion.state(), commands }) + "\n");
}
// No off, shutdown erasure or snapshot copy: this controller really exits with its saved active run.
