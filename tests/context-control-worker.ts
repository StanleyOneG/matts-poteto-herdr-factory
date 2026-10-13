import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ContextAuthority, WorkerAddress } from "../src/tribunus.js";

const [source, endpoint] = process.argv.slice(2);
if (!source || !endpoint) throw new Error("Owned live-control fixture paths required");
const owner = z.strictObject({ capability: z.string(), authority: ContextAuthority, address: WorkerAddress, command: z.uuid(), reservation: z.uuid(), scope: z.string() }).parse(JSON.parse(readFileSync(source, "utf8")));
const Check = z.strictObject({ capability: z.string(), authority: ContextAuthority, address: WorkerAddress, command: z.uuid(), reservation: z.uuid(), scope: z.string(), kind: z.literal("context-current"), assignment: z.null(), nonce: z.uuid() });
let current = true;
let assignment = owner.command;
const server = createServer(socket => {
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk;
    if (!buffer.includes("\n")) return;
    socket.removeAllListeners("data");
    const parsed = Check.safeParse(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
    if (!parsed.success || !current || parsed.data.capability !== owner.capability || !isDeepStrictEqual(parsed.data.authority, owner.authority) || !isDeepStrictEqual(parsed.data.address, owner.address) || parsed.data.command !== assignment || parsed.data.reservation !== owner.reservation || parsed.data.scope !== owner.scope) {
      socket.end(JSON.stringify({ kind: "held", message: "No current authenticated incarnation/assignment." }) + "\n");
    } else {
      socket.end(JSON.stringify({ kind: "ok", value: { nonce: parsed.data.nonce, authority: owner.authority, address: owner.address, command: assignment } }) + "\n");
    }
    process.send?.({ kind: "checked", current });
  });
});
server.listen(endpoint, () => process.send?.({ kind: "ready" }));
process.on("message", raw => {
  const action = z.enum(["switch", "shutdown", "reassign", "stop"]).parse(raw);
  if (action === "reassign") {
    assignment = "5690dcd1-b32e-46c1-9a6a-1883b9661472";
    process.send?.({ kind: "reassigned" });
    return;
  }
  current = false;
  if (action === "switch") process.send?.({ kind: "switched" });
  else server.close(() => {
    process.send?.({ kind: "shutdown" }, () => process.disconnect());
  });
});
