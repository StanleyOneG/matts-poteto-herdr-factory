import { Legion } from "../src/intake.js";
const [storagePath, context, id, phase] = process.argv.slice(2);
if (!storagePath || !context || !id)
  throw new Error("Worker arguments required.");
let armed = false;
const legion = new Legion({
  storagePath,
  context,
  session: "worker-session",
  preflight: async () => [],
  storageFault: (point) => {
    if (armed && point === phase) process.kill(process.pid, "SIGKILL");
  },
});
const evidence = {
  origin: "emperor",
  transport: "rpc",
  session: "worker-session",
  generation: null,
  presented: [],
};
const result = await legion.command({
  text: `resume ${id}`,
  requestKey: "worker-resume",
  evidence,
});
process.send?.({ result, state: await legion.state() });
process.on("message", async () => {
  armed = true;
  const view = await legion.state();
  const saved = await legion.submit({
    kind: "message",
    requestKey: "crash-message",
    text: "Crash-safe original".repeat(180000),
    evidence: { ...evidence, generation: view.snapshot?.generation },
  });
  process.send?.({ saved });
});
