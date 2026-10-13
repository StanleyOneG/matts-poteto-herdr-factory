import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { LocalTribunusHost } from "../src/tribunus-host.js";
import { VerifiedWorker } from "../src/tribunus.js";
import { publish } from "../src/private-evidence.js";

const execute = promisify(execFile);
async function observed(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Test callback/sentinel timeout: ${description}`);
    await delay(5);
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ct-"));
  const prior = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const authority = { owner: randomUUID(), session: "legatus", generation: 2, epoch: 3 };
  const launch = randomUUID(), generation = randomUUID(), command = randomUUID();
  const directory = join(root, "legion", "tribuni", launch);
  const worker = VerifiedWorker.parse({ address: { launch, generation, session: "tribunus", window: { endpoint: "local", server: "server", workspace: "w", tab: "t", pane: "p", terminal: "term" } }, resources: { cwd: root, skills: [], diagnostics: [] }, identityEvidence: "verified fixture" });
  const reservation = randomUUID(), capability = "private-context-capability";
  await mkdir(join(directory, generation), { recursive: true, mode: 0o700 });
  publish(join(directory, "bootstrap.json"), { launch: { id: launch, reservation, revision: 0, scope: "bounded", state: { kind: "prepared" } }, cwd: root, capability, authority });
  const source = join(root, "live-control.json"), endpoint = join(root, "live.sock");
  await writeFile(source, JSON.stringify({ authority, address: worker.address, command, reservation, scope: "bounded", capability }));
  const child = fork(fileURLToPath(new URL("./context-control-worker.ts", import.meta.url)), [source, endpoint], { execArgv: ["--import", "tsx"], env: { ...process.env, TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir() }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const lifecycle: string[] = [];
  let diagnostics = "", closed = false;
  child.stdout?.on("data", data => { diagnostics += String(data); });
  child.stderr?.on("data", data => { diagnostics += String(data); });
  child.on("message", raw => lifecycle.push(z.object({ kind: z.string() }).parse(raw).kind));
  const settled = new Promise<void>((resolve, reject) => child.once("close", (code, signal) => {
    closed = true;
    code === 0 && signal === null ? resolve() : reject(new Error(`Live fixture failed: ${code}/${signal}: ${diagnostics}`));
  }));
  await observed(() => lifecycle.includes("ready") || closed, "live control process ready");
  assert.ok(!closed, diagnostics);
  assert.ok(child.pid);
  publish(join(directory, "hello.json"), { address: worker.address, endpoint, journal: "controlled.jsonl", pid: child.pid });
  const received: number[] = [], unavailable: string[] = [];
  const host = new LocalTribunusHost(async () => { throw new Error("Context transport cannot invoke shell effects"); }, authority);
  const dispose = host.watchContext({ worker, command }, async observation => { received.push(observation.sequence); }, message => unavailable.push(message));
  const sampledAt = Date.now();
  const baseline = { capability, observation: { authority, address: worker.address, command, sequence: 1, model: "controlled/selected", sample: { kind: "fresh", tokens: 150000, contextWindow: 272000, sampledAt } } };
  let publication = 0;
  async function send(envelope: typeof baseline) {
    const source = join(root, `input-${++publication}.json`);
    await writeFile(source, JSON.stringify(envelope));
    await execute(process.execPath, ["--import", "tsx", "tests/context-event-worker.ts", source, join(directory, generation, `${command}.${publication}.context.json`)], { cwd: process.cwd(), env: { ...process.env, TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir() } });
  }
  async function end(kind: "switch" | "shutdown" | "reassign") {
    child.send(kind);
    await observed(() => lifecycle.includes(kind === "switch" ? "switched" : kind === "reassign" ? "reassigned" : "shutdown"), `worker ${kind}`);
    if (kind === "shutdown") await settled;
  }
  return { root, directory, generation, command, baseline, received, unavailable, lifecycle, send, end, dispose,
    cleanup: async () => {
      dispose();
      if (!closed && child.connected) child.send("stop");
      await settled;
      prior === undefined ? delete process.env.PI_CODING_AGENT_DIR : process.env.PI_CODING_AGENT_DIR = prior;
      await rm(root, { recursive: true, force: true });
    } };
}

test("cross-process context transport authenticates the current owner and assignment and rejects stale/replayed events", async () => {
  const f = await fixture();
  const { baseline } = f;
  try {
    await f.send(baseline);
    await observed(() => f.received.includes(1), "first authenticated sample");
    await f.send(baseline);
    const { authority, address } = baseline.observation;
    const bad = [
      { ...baseline, capability: "foreign-capability" },
      { ...baseline, observation: { ...baseline.observation, authority: { ...authority, owner: randomUUID() } } },
      { ...baseline, observation: { ...baseline.observation, authority: { ...authority, session: "old-legatus" } } },
      { ...baseline, observation: { ...baseline.observation, authority: { ...authority, generation: 1 } } },
      { ...baseline, observation: { ...baseline.observation, authority: { ...authority, epoch: 2 } } },
      { ...baseline, observation: { ...baseline.observation, address: { ...address, session: "old-worker" } } },
      { ...baseline, observation: { ...baseline.observation, address: { ...address, generation: randomUUID() } } },
      { ...baseline, observation: { ...baseline.observation, command: randomUUID() } },
    ];
    for (const envelope of bad) await f.send({ ...envelope, observation: { ...envelope.observation, sequence: 100 } });
    await f.send({ ...baseline, observation: { ...baseline.observation, sequence: 2, sample: { ...baseline.observation.sample, sampledAt: baseline.observation.sample.sampledAt - 1 } } });
    await f.send({ ...baseline, observation: { ...baseline.observation, sequence: 2, sample: { ...baseline.observation.sample, tokens: 134999, sampledAt: Date.now() } } });
    await observed(() => f.received.includes(2), "valid sentinel after rejected/replayed samples");
    assert.deepEqual(f.received, [1, 2], "Invalid events cannot advance the current assignment's cursor");
    assert.equal(f.unavailable.length, 8);
    await observed(() => f.lifecycle.includes("checked"), "live authenticated query observed in the other process");
    assert.ok(f.lifecycle.includes("checked"), "A retained hello file must not substitute for a live authenticated check");
    const malformed = join(f.root, "malformed.json");
    await writeFile(malformed, "{broken");
    await execute(process.execPath, ["--import", "tsx", "tests/context-event-worker.ts", malformed, join(f.directory, f.generation, `${f.command}.malformed.context.json`), "raw"]);
    await f.send({ ...baseline, observation: { ...baseline.observation, sequence: 3, sample: { ...baseline.observation.sample, sampledAt: Date.now() } } });
    await observed(() => f.received.includes(3), "valid sentinel after malformed sample");
    assert.deepEqual(f.received, [1, 2, 3], "A malformed event remains unresolved but cannot hide a later valid current sample");
    f.dispose();
    await f.send({ ...baseline, observation: { ...baseline.observation, sequence: 4, sample: { ...baseline.observation.sample, sampledAt: Date.now() } } });
    assert.deepEqual(f.received, [1, 2, 3]);
  } finally { await f.cleanup(); }
});

const endings: Array<"switch" | "shutdown" | "reassign"> = ["switch", "shutdown", "reassign"];
for (const ending of endings) test(`a delayed old-session event cannot be delivered after the live worker ${ending}`, async () => {
  const f = await fixture();
  try {
    await f.send(f.baseline);
    await observed(() => f.received.includes(1), "current assignment before lifecycle change");
    await f.end(ending);
    await f.send({ ...f.baseline, observation: { ...f.baseline.observation, sequence: 2, sample: { ...f.baseline.observation.sample, sampledAt: Date.now() } } });
    await observed(() => f.received.includes(2) || f.unavailable.length > 0, "old event delivered or visibly rejected");
    assert.deepEqual(f.received, [1], "Retained hello/observation bytes do not establish a current incarnation");
    assert.ok(f.unavailable.length > 0);
  } finally { await f.cleanup(); }
});
