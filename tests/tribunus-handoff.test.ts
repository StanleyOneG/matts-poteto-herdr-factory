import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { handoffFixture } from "./support/tribunus-handoff.mjs";

function sent({ f, index }: { f: Awaited<ReturnType<typeof handoffFixture>>; index: number }) {
  const message = f.sends[index]; assert.ok(message); return message;
}

test("addressed handoff waits for delivered safe-stop and actual principal settlement without restoring ordinary authority", async () => {
  const f = await handoffFixture();
  try {
    assert.equal((await f.stage()).kind, "held");
    const stopped = await f.control({ kind: "stop", command: f.request.stop, currentCommand: f.command, instruction: "Safely stop this task; preserve dirty work and settle your children and effects." });
    assert.equal(stopped.kind, "ok");
    assert.equal(stopped.value.state.kind, "draining");
    assert.equal(f.sends.length, 3, "The addressed stop must deliver the task-scoped native instruction first");
    assert.equal(sent({ f, index: 2 }).options.deliverAs, "steer");
    assert.equal((await f.stage()).kind, "held");
    await f.runtime.start(sent({ f, index: 2 }).prompt);
    await f.runtime.settle(false, "Safely stopped.");
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("parked")));
    const stage = await f.stage();
    assert.equal(stage.kind, "ok");
    assert.equal(stage.value.state.kind, "pending");
    assert.equal(sent({ f, index: 3 }).options.expandPromptTemplates, true);
    assert.match(sent({ f, index: 3 }).prompt, /^\/skill:handoff Transfer the dirty task/);
    assert.match(sent({ f, index: 3 }).prompt, /successor will continue: Finish the focused verification/);
    assert.equal((await f.control({ kind: "assign", command: f.request.command, assignment: f.assignment })).kind, "held");
  } finally { await f.close(); }
});

async function startHandoff(f: Awaited<ReturnType<typeof handoffFixture>>) {
  await f.control({ kind: "stop", command: f.request.stop, currentCommand: f.command, instruction: "Safely stop; preserve all dirty work." });
  await f.runtime.start(sent({ f, index: 2 }).prompt); await f.runtime.settle(false, "Stopped.");
  await f.until(() => f.runtime.statuses.some(status => status.text.includes("parked")));
  assert.equal((await f.stage()).kind, "ok");
  await f.runtime.start(sent({ f, index: 3 }).prompt);
}

test("the limited native skill stage admits only its exact temporary artifact and returns settled path-only evidence", async () => {
  const f = await handoffFixture();
  try {
    await startHandoff(f);
    const artifact = join(process.env.TMPDIR ?? "/tmp", `handoff-${f.request.id}.md`);
    const body = "Private handoff body canary: never publish in ordinary Legion evidence.";
    assert.equal((await f.runtime.call("bash", { command: "touch forbidden" })).isError, true);
    assert.equal((await f.runtime.call("write", { path: join(f.cwd, "forbidden.md"), content: body })).isError, true);
    const write = await f.runtime.call("write", { path: artifact, content: body }, "handoff-write");
    assert.equal(write.isError ?? false, false, "One confined temporary native artifact write must execute");
    assert.equal(readFileSync(artifact, "utf8"), body);
    const pending = await f.stage("observe-handoff"); assert.equal(pending.kind, "ok"); assert.equal(pending.value.state.kind, "pending");
    await f.runtime.settle(false, `Created ${artifact}`);
    const observed = await f.stage("observe-handoff");
    assert.equal(observed.kind, "ok"); assert.equal(observed.value.state.kind, "settled");
    assert.equal(observed.value.state.receipt.artifact.path, artifact);
    assert.equal(observed.value.state.receipt.artifact.tempRoot, process.env.TMPDIR);
    assert.equal(JSON.stringify(observed).includes(body), false);
    const root = join(f.actor, f.address.generation);
    for (const file of readdirSync(root)) assert.equal(readFileSync(join(root, file), "utf8").includes(body), false, `No extra durable body in ${file}`);
    assert.equal(readdirSync(root).some(file => file.includes("effect-request")), false);
    const count = f.sends.length;
    assert.deepEqual(await f.stage(), observed); assert.equal(f.sends.length, count);
    assert.equal((await f.runtime.call("write", { path: artifact, content: "late" })).isError, true);
    assert.equal((await f.control({ kind: "initialize", command: f.request.id })).kind, "held");
    const settledFiles = inventory(root);
    f.runtime.setPending(true);
    const nowPending = await f.stage("observe-handoff"); assert.equal(nowPending.kind, "ok"); assert.equal(nowPending.value.state.kind, "held");
    assert.deepEqual(inventory(root), settledFiles);
    f.runtime.setPending(false); assert.deepEqual(await f.stage("observe-handoff"), observed);
    unlinkSync(artifact);
    const missing = await f.stage("observe-handoff"); assert.equal(missing.kind, "ok"); assert.equal(missing.value.state.kind, "unknown");
    assert.equal(f.sends.length, count);
  } finally { await f.close(); }
});

test("held and lost stage outcomes remain read-only blockers and never dispatch a duplicate or stale request", async () => {
  const f = await handoffFixture();
  try {
    await startHandoff(f);
    const count = f.sends.length;
    assert.equal((await f.stage("handoff", { capability: "wrong-capability" })).kind, "held");
    assert.equal((await f.stage("handoff", { authority: { ...f.authority, generation: 2 } })).kind, "held");
    assert.equal((await f.stage("handoff", { request: { ...f.request, purpose: "Conflicting purpose" } })).kind, "held");
    const before = inventory(join(f.actor, f.address.generation));
    const pending = await f.stage("observe-handoff"); assert.equal(pending.kind, "ok"); assert.equal(pending.value.state.kind, "pending");
    assert.deepEqual(inventory(join(f.actor, f.address.generation)), before);
    await f.runtime.settle(false, "No artifact was created; never infer a path from this prose.");
    const held = await f.stage("observe-handoff"); assert.equal(held.kind, "ok"); assert.equal(held.value.state.kind, "held");
    assert.deepEqual(await f.stage(), held); assert.equal(f.sends.length, count);
    unlinkSync(join(f.actor, f.address.generation, "handoff-observation.json"));
    const lost = await f.stage("observe-handoff"); assert.equal(lost.kind, "ok"); assert.equal(lost.value.state.kind, "unknown");
    const missing = inventory(join(f.actor, f.address.generation));
    assert.deepEqual(await f.stage(), lost); assert.equal(f.sends.length, count);
    assert.deepEqual(inventory(join(f.actor, f.address.generation)), missing);
    unlinkSync(join(f.actor, f.address.generation, `${f.request.stop}.stop-instruction-dispatched.json`));
    const lostStop = await f.control({ kind: "stop", command: f.request.stop, currentCommand: f.command, instruction: "Safely stop; preserve all dirty work." });
    assert.equal(lostStop.kind, "held"); assert.equal(f.sends.length, count);
  } finally { await f.close(); }
});

function inventory(root: string) { return readdirSync(root).sort().map(file => [file, readFileSync(join(root, file), "utf8")]); }

test("successful artifact effect is not handoff settlement while native messages remain pending", async () => {
  const f = await handoffFixture();
  try {
    await startHandoff(f);
    const artifact = join(process.env.TMPDIR ?? "/tmp", `handoff-${f.request.id}.md`);
    assert.equal((await f.runtime.call("write", { path: artifact, content: "Temporary continuation" })).isError ?? false, false);
    assert.equal((await f.runtime.call("legion_centurio", {})).isError, true);
    assert.equal((await f.runtime.call("subagent", { agent: "worker", task: "Not authorized", async: true })).isError, true);
    f.runtime.setPending(true);
    await f.runtime.settle(false, `Created ${artifact}`);
    const observed = await f.stage("observe-handoff"); assert.equal(observed.kind, "ok"); assert.equal(observed.value.state.kind, "held");
    f.runtime.setPending(false);
    const count = f.sends.length; assert.deepEqual(await f.stage(), observed); assert.equal(f.sends.length, count);
  } finally { await f.close(); }
});

test("successor native assignment explicitly reads the exact temporary path first and rejects altered predecessor pins", async () => {
  const f = await handoffFixture({ successor: true });
  try {
    assert.ok(f.assignment.handoff);
    assert.ok(sent({ f, index: 1 }).prompt.startsWith(`Read the handoff file at exactly ${JSON.stringify(f.assignment.handoff.artifact.path)} before continuing any work.`));
    assert.match(sent({ f, index: 1 }).prompt, /If it is unavailable, stop and report the blocker; do not reconstruct it/);
    assert.match(sent({ f, index: 1 }).prompt, /Then continue: Finish the retained task/);
    await f.runtime.settle();
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("Waiting. Not accepted")));
    const before = f.sends.length;
    const response = await f.control({ kind: "assign", command: f.request.id, assignment: { ...f.assignment, modelPin: { model: "controlled/changed", thinking: "low", profile: "matt" } } });
    assert.equal(response.kind, "held"); assert.equal(f.sends.length, before);
  } finally { await f.close(); }
});

test("unknown temporary artifact native outcome remains held without guessing a path or retrying the effect", async () => {
  const f = await handoffFixture();
  try {
    await startHandoff(f);
    f.runtime.external(async () => ({ content: [{ type: "text", text: "Controlled backend claims success without creating the file" }] }));
    const artifact = join(process.env.TMPDIR ?? "/tmp", `handoff-${f.request.id}.md`);
    await f.runtime.call("write", { path: artifact, content: "No actual artifact outcome" });
    const held = await f.stage("observe-handoff"); assert.equal(held.kind, "ok"); assert.equal(held.value.state.kind, "held");
    assert.equal((await f.runtime.call("write", { path: artifact, content: "Blind retry" })).isError, true);
    const count = f.sends.length; assert.deepEqual(await f.stage(), held); assert.equal(f.sends.length, count);
  } finally { await f.close(); }
});

test("owner-unresolved retirement cannot enable the limited turn even when owner communication returns", async () => {
  const f = await handoffFixture();
  try {
    await f.control({ kind: "stop", command: f.request.stop, currentCommand: f.command, instruction: "Safely stop; preserve all dirty work." });
    await f.runtime.start(sent({ f, index: 2 }).prompt); await f.runtime.settle();
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("parked")));
    const panes = JSON.parse(readFileSync(f.panePath, "utf8")); const saved = panes.owner.agent_session;
    delete panes.owner.agent_session; writeFileSync(f.panePath, JSON.stringify(panes));
    const count = f.sends.length; assert.equal((await f.stage()).kind, "held");
    panes.owner.agent_session = saved; writeFileSync(f.panePath, JSON.stringify(panes));
    assert.equal((await f.stage()).kind, "held"); assert.equal(f.sends.length, count);
    assert.equal((await f.control({ kind: "assign", command: f.request.id, assignment: f.assignment })).kind, "held");
  } finally { await f.close(); }
});

test("temporary artifact admission preserves ordinary native permission refusal without retry or artifact creation", async () => {
  const f = await handoffFixture();
  try {
    await startHandoff(f); f.denyArtifact();
    const artifact = join(process.env.TMPDIR ?? "/tmp", `handoff-${f.request.id}.md`);
    assert.equal((await f.runtime.call("write", { path: artifact, content: "Native permission should deny this" })).isError, true);
    assert.equal(existsSync(artifact), false);
    const observed = await f.stage("observe-handoff"); assert.equal(observed.kind, "ok"); assert.equal(observed.value.state.kind, "held");
    assert.equal((await f.runtime.call("write", { path: artifact, content: "Retry must remain denied" })).isError, true);
    assert.equal(existsSync(artifact), false);
  } finally { await f.close(); }
});

test("concurrent duplicate addressed handoffs dispatch one limited turn and reconcile one pending stage", async () => {
  const f = await handoffFixture();
  try {
    await f.control({ kind: "stop", command: f.request.stop, currentCommand: f.command, instruction: "Safely stop; preserve all dirty work." });
    await f.runtime.start(sent({ f, index: 2 }).prompt); await f.runtime.settle();
    await f.until(() => f.runtime.statuses.some(status => status.text.includes("parked")));
    const [first, second] = await Promise.all([f.stage(), f.stage()]);
    assert.equal(first.kind, "ok"); assert.deepEqual(second, first);
    assert.equal(f.sends.length, 4);
  } finally { await f.close(); }
});

test("addressed client fails visibly when a control connection closes without a complete receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "hc-"));
  const descriptor = join(root, "bootstrap.json"), request = join(root, "request.json"), endpoint = join(root, "control.sock");
  writeFileSync(descriptor, JSON.stringify({ capability: "controlled-capability" }), { mode: 0o600 });
  writeFileSync(request, JSON.stringify({ kind: "observe-handoff" }), { mode: 0o600 });
  const server = createServer(socket => socket.once("data", () => socket.end('{"kind":"ok"')));
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  try {
    const child = spawn(process.execPath, [new URL("../src/tribunus-client.mjs", import.meta.url).pathname, descriptor, endpoint, request]);
    let stderr = "", stdout = "";
    child.stderr.on("data", chunk => { stderr += chunk; }); child.stdout.on("data", chunk => { stdout += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 1); assert.equal(stdout, ""); assert.match(stderr, /without a complete receipt/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
