import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { GuardedCommand, CommandOutcome } from "./git-workspace.js";

const Binding = z.strictObject({ nonce: z.uuid(), operation: z.string().min(1), controller: z.string().min(1), command: z.string().min(1) });
const ShellReceipt = z.object({ output: z.string(), exit_code: z.int(), truncated: z.literal(false) });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export class CleanupPermissionNotEntered extends Error {}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** One ordinary Bash call contains and executes the real exact effect. The fixed helper merely
 * waits for the adapter's post-permission checks; it cannot execute commands or grant authority.
 * The effect boundary releases that same shell and waits for its receipt, never raw-execs it. */
export async function cleanupPermission<T>({ ctx, operation, controller, command, execute, installEffect }: {
  ctx: ExtensionToolContext; operation: string; controller: string; command: string;
  execute: () => Promise<T>; installEffect: (effect: GuardedCommand) => () => void;
}): Promise<T> {
  if (process.platform !== "linux") throw new CleanupPermissionNotEntered("Cleanup gate requires local Linux abstract sockets.");
  const endpoint = `legion-cleanup-${randomUUID()}`;
  const binding = Binding.parse({ nonce: randomUUID(), operation, controller, command });
  const frame = JSON.stringify(binding), receipt = deferred<CommandOutcome>();
  const sockets = new Set<Socket>();
  const state: { entered: Promise<{ kind: "value"; value: T } | { kind: "error"; error: unknown }> | null } = { entered: null };
  let active = true, released = false;
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > frame.length + 1) { socket.end("hold\n"); return; }
      if (!buffer.includes("\n")) return;
      if (!active || state.entered || buffer !== `${frame}\n` || !Binding.safeParse(JSON.parse(buffer)).success) { socket.end("hold\n"); return; }
      // Reserve before entering asynchronous trusted code; duplicate clients can never release twice.
      state.entered = (async () => {
        const restore = installEffect(async actual => {
          if (!active || released || actual !== command) throw new Error("Cleanup gate effect is stale, repeated or command-mismatched.");
          released = true;
          socket.end("go\n");
          return receipt.promise;
        });
        try { return { kind: "value", value: await execute() }; }
        catch (error) { return { kind: "error", error }; }
        finally { restore(); if (!released) socket.end("hold\n"); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(`\0${endpoint}`, resolve); });
  const shellCommand = `${[process.execPath, fileURLToPath(new URL("./cleanup-gate.mjs", import.meta.url)), endpoint, frame].map(quote).join(" ")} && ${command}`;
  try {
    try {
      const result = await ctx.executeTool("bash", { command: shellCommand });
      const parsed = ShellReceipt.safeParse(result.result.structuredContent);
      receipt.resolve(parsed.success ? { kind: "finished", code: parsed.data.exit_code, output: parsed.data.output } : { kind: "unknown", message: "Exact ordinary Bash cleanup receipt unavailable; preserve without replay." });
    } catch (error) { receipt.resolve({ kind: "unknown", message: String(error) }); }
    finally { active = false; for (const socket of sockets) if (!released) socket.end("hold\n"); }
    const settled = state.entered ? await state.entered : null;
    if (!settled) throw new CleanupPermissionNotEntered("Ordinary Bash denied, held or failed before the one-shot cleanup gate; no native cleanup dispatched.");
    if (settled.kind === "error") throw settled.error;
    return settled.value;
  } finally {
    active = false;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
