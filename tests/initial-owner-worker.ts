import { Legion } from "../src/intake.js";
const [storagePath, context, session, phase, resume] = process.argv.slice(2);
if (!storagePath || !context || !session || !phase) throw new Error("Worker arguments required.");
const legion = new Legion({
  storagePath, context, session, preflight: async () => [],
  storageFault: point => { if (point === phase) process.kill(process.pid, "SIGKILL"); },
});
const result = await legion.command({
  text: resume ? `resume ${resume}` : "First original input".repeat(180000), requestKey: "first-input",
  evidence: { origin: "emperor", transport: "rpc", session, generation: null, presented: [] },
});
process.send?.({ result, state: await legion.state() });
process.on("message", () => process.kill(process.pid, "SIGKILL"));
