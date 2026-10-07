import { once } from "node:events";
import { z } from "zod";
import { Legion } from "../src/intake.js";
const [storagePath, context, session, text, requestKey, phase] = process.argv.slice(2);
if (!storagePath || !context || !session || !text || !requestKey)
  throw new Error("Association worker arguments required.");
const go = once(process, "message").then(([raw]) => z.object({ at: z.number() }).parse(raw));
const legion = new Legion({
  storagePath, context, session,
  preflight: async () => {
    process.send?.({ kind: "ready" });
    const { at } = await go;
    while (Date.now() < at) {}
    return [];
  },
  storageFault: point => {
    if (point === phase) {
      process.send?.({ kind: "held" });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
});
const evidence = { origin: "emperor", transport: "rpc", session, generation: null, presented: [] };
const result = await legion.command({ text: phase === "before-commit" ? text.repeat(180000) : text, requestKey, evidence });
process.send?.({ kind: "result", result, state: await legion.state() });
process.on("message", async raw => {
  const message = z.object({ text: z.string(), requestKey: z.string() }).parse(raw);
  const result = await legion.command({ ...message, evidence });
  process.send?.({ kind: "result", result, state: await legion.state() });
});
