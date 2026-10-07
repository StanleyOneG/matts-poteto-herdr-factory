import { z } from "zod";
import { Legion } from "../src/intake.js";
const Input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("acquire"), root: z.string(), context: z.string(), session: z.string(), text: z.string(), key: z.string(), at: z.string() }),
  z.object({ kind: z.literal("release") }),
  z.object({ kind: z.literal("observe") }),
]);
let subject: Legion | null = null;
let session = "";
const evidence = () => ({ origin: "emperor", transport: "rpc", session, generation: null, presented: [] });
process.on("message", async raw => {
  const input = Input.parse(raw);
  if (input.kind === "observe") {
    process.send?.({ kind: "state", state: await subject?.state() });
    return;
  }
  if (input.kind === "release") {
    if (subject) await subject.command({ text: "off", requestKey: "off", evidence: evidence() });
    subject = null;
    process.send?.({ kind: "released" });
    return;
  }
  session = input.session;
  subject = new Legion({ storagePath: input.root, context: input.context, session, preflight: async () => {
    const at = BigInt(input.at);
    while (process.hrtime.bigint() < at) {}
    return [];
  } });
  const result = await subject.command({ text: input.text, requestKey: input.key, evidence: evidence() });
  process.send?.({ kind: "result", result });
});
process.send?.({ kind: "ready" });
