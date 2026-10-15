import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { HandoffRecord } from "../src/snapshot.js";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalTabCleanupAdapter, localTabCleanupNative, type KnownHumanTabUseReader, type TabCleanupNative, type TabCleanupPermission } from "../src/tab-cleanup.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { TabCleanupIntent, cleanupEligibility, type CleanupReferences } from "../src/cleanup-domain.js";
import { resultDigest } from "../src/result-domain.js";
import { LaunchRecord } from "../src/tribunus.js";
import type { WorkerResourceObservation } from "../src/resume.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tab-"));
  const address = { launch: randomUUID(), window: { endpoint: "/native/socket", server: "server-incarnation", workspace: "w1", tab: "w1:t2", pane: "w1:p2", terminal: "terminal-2" }, session: "accepted-worker", generation: randomUUID() };
  const authority = { owner: randomUUID(), session: "legatus", generation: 1, epoch: 0 };
  const task = { id: randomUUID(), revision: 1 }, assignment = randomUUID(), reservation = randomUUID();
  const identity = { assignment: { owner: authority.owner, task, scope: "bounded", reservation, assignment, executor: { session: address.session, generation: address.generation } }, workspace: { repository: "/repo/.git", repositoryId: randomUUID(), path: "/worktree", branch: "refs/heads/task", parent: "refs/heads/parent", parentPath: "/repo" }, commit: "a".repeat(40), tree: "b".repeat(40), parent: { ref: "refs/heads/parent", commit: "c".repeat(40) }, criteria: ["accepted"], requiredChecks: ["tests"] };
  const result = { id: randomUUID(), digest: resultDigest(identity) }, integrationId = randomUUID();
  const intent = TabCleanupIntent.parse({ id: randomUUID(), result, identity, target: { kind: "tab", address }, integration: { intent: { id: integrationId, result, identity, verificationDigest: "d".repeat(64), review: { id: randomUUID(), result, verificationDigest: "d".repeat(64), reviewer: { session: "independent", run: "review" }, reference: "review.md", outcome: "approved", evidence: ["review"] }, controller: authority }, state: { kind: "confirmed", operation: integrationId, result, source: { commit: identity.commit, tree: identity.tree }, parent: { ref: identity.parent.ref, before: identity.parent.commit, after: identity.commit, tree: identity.tree }, evidence: ["integration"] } } });
  const worker = { address, resources: { cwd: "/worktree", skills: [], diagnostics: [] }, identityEvidence: "native-control" };
  const launch = LaunchRecord.parse({ id: address.launch, reservation, revision: 1, scope: "bounded", startEvidence: { kind: "completed" }, state: { kind: "reported", worker, initialization: { command: randomUUID(), address, nativePrompt: "initialize", skillPath: "", modeEntry: "mode", settledEntry: "settled" }, command: assignment, assignment: { task, scope: "bounded", goal: "result", acceptance: ["accepted"], workflow: "implement", authority: "bounded-implementation-only" }, application: "journal#assignment", report: { outcome: "reported-result", assistantText: "done", evidence: ["report"] } } });
  const references: CleanupReferences = { launches: [launch], handoffs: [], resultEvidence: [] };
  const resources: WorkerResourceObservation = { launch: address.launch, reservation, scope: "bounded", disposition: "settled", reasons: [], recommendation: "observed", evidence: ["native-worker", "journal"], process: { kind: "alive", identity: { pid: 41, boot: "boot", start: "1234" } }, live: { kind: "observed", value: { nonce: randomUUID(), address: intent.target.address, controller: authority, command: assignment, principal: "settled", busy: false, pendingMessages: false, admissionHold: null, childrenOutstanding: false, childrenHeld: false, effectsOutstanding: false, retirement: null } }, retirement: null, report: { address: intent.target.address, command: assignment, outcome: "reported-result", assistantText: "done", evidence: ["report"] }, actions: [], effects: [], children: [] };
  const pane = { workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p2", terminal_id: "terminal-2", foreground_cwd: "/worktree", agent: "pi", agent_session: { kind: "id", value: address.session }, agent_status: "idle", revision: 1 };
  const snapshot = { version: "0.9.1", protocol: 22, tabs: [{ workspace_id: "w1", tab_id: "w1:t2", pane_count: 1 }], panes: [pane] };
  let closes = 0;
  const native: TabCleanupNative = {
    identity: async () => ({ endpoint: "/native/socket", server: "server-incarnation" }),
    snapshot: async () => ({ result: { snapshot } }),
    processes: async ({ pane }) => ({ result: { process_info: { pane_id: pane, shell_pid: 40, foreground_processes: [{ pid: 41 }] } } }),
    occupants: async () => ({ shell: { pid: 40, boot: "boot", start: "1200" }, processes: [{ pid: 40, boot: "boot", start: "1200" }, { pid: 41, boot: "boot", start: "1234" }] }),
    close: async () => { closes++; snapshot.tabs = []; snapshot.panes = []; return { kind: "finished", code: 0, output: JSON.stringify({ result: { type: "ok" } }) }; },
  };
  let permission: TabCleanupPermission | undefined, knownHumanUse: KnownHumanTabUseReader | undefined;
  const adapter = () => new LocalTabCleanupAdapter({ evidenceRoot: root, native, resources: { observeResources: async () => resources }, ...(permission ? { permission } : {}), ...(knownHumanUse ? { knownHumanUse } : {}) });
  return { root, intent, references, resources, pane, snapshot, native, adapter, closes: () => closes, allow: (value: TabCleanupPermission) => { permission = value; }, humanUse: (value: KnownHumanTabUseReader) => { knownHumanUse = value; } };
}

test("native terminal-session inventory joins real shell and worker PID incarnations", async () => {
  const f = await fixture();
  const workerCode = 'console.log(process.pid); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';
  const child = spawn("bash", ["-c", `node -e '${workerCode}'; :`], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  try {
    const [data] = await once(child.stdout, "data");
    const pid = Number(String(data).trim()), shell = child.pid;
    assert.ok(shell && Number.isSafeInteger(pid));
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]; assert.ok(start);
    f.resources.process = { kind: "alive", identity: { pid, boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(), start } };
    f.native.processes = async ({ pane }) => ({ result: { process_info: { pane_id: pane, shell_pid: shell, foreground_processes: [{ pid }] } } });
    f.native.occupants = localTabCleanupNative.occupants;
    const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
    assert.equal(cleanupEligibility({ intent: f.intent, observation }).kind, "eligible", observation.evidence.join("\n"));
    assert.equal(f.closes(), 0);
  } finally {
    child.stdin.end();
    const [code, signal] = await closed;
    assert.equal(code, 0); assert.equal(signal, null);
  }
});

test("accepted exact settled executor is eligible through the native tab adapter", async () => {
  const f = await fixture();
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(cleanupEligibility({ intent: f.intent, observation }).kind, "eligible");
  assert.equal(f.closes(), 0);
});

test("a background session occupant cannot hide behind idle foreground worker metadata", async () => {
  const f = await fixture();
  f.native.occupants = async () => ({ shell: { pid: 40, boot: "boot", start: "1200" }, processes: [{ pid: 40, boot: "boot", start: "1200" }, { pid: 41, boot: "boot", start: "1234" }, { pid: 42, boot: "boot", start: "1300" }] });
  f.allow(async ({ execute }) => execute());
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.equal(outcome.kind, "retained");
  assert.equal(f.closes(), 0);
});

test("late session reuse during ordinary permission wait prevents native close", async () => {
  const f = await fixture();
  f.allow(async ({ execute }) => { f.pane.agent_session.value = "human-replacement"; return execute(); });
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.equal(outcome.kind, "retained");
  assert.equal(f.closes(), 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("known human occupant emits a machine-readable no-effect quarantine reason", async () => {
  const f = await fixture();
  f.humanUse(async ({ address }) => ({ address, evidence: ["explicit operator use of this exact native session"] }));
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().observe({ intent: f.intent, references: f.references })).occupants, "human");
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.equal(outcome.kind, "retained");
  assert.ok(outcome.kind === "retained" && outcome.reason === "known-human-use");
  assert.equal(f.closes(), 0);
});

test("lost controller receipt reconciles the exact durable native operation without a second close", async () => {
  const f = await fixture();
  const nativeClose = f.native.close;
  f.native.close = async input => {
    const dispatch = JSON.parse(await readFile(join(f.root, f.intent.id, "dispatch.json"), "utf8"));
    assert.equal(dispatch.intent.id, f.intent.id);
    assert.deepEqual(dispatch.intent.target.address, f.intent.target.address);
    return nativeClose(input);
  };
  const journal = join(f.root, "retained-journal"); await writeFile(journal, "original report and handoff evidence\n");
  f.allow(async ({ execute }) => { await execute(); throw new Error("controller acknowledgment lost"); });
  await assert.rejects(f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} }), /acknowledgment lost/);
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "confirmed");
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("must not execute"); } })).kind, "confirmed");
  assert.equal(f.closes(), 1);
  assert.equal(await readFile(journal, "utf8"), "original report and handoff evidence\n");
});

test("lost native receipt and absent tab stay unknown and cannot replay close", async () => {
  const f = await fixture(), close = f.native.close;
  f.native.close = async input => { await close(input); return { kind: "unknown", message: "native response lost" }; };
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "unknown");
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "unknown");
  assert.equal(f.closes(), 1);
});

test("absence without an operation receipt never confirms cleanup", async () => {
  const f = await fixture(); f.snapshot.tabs = []; f.snapshot.panes = [];
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal(f.closes(), 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("reused tab IDs and conflicting exact-operation receipts never authorize another close", async () => {
  const f = await fixture(); f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "confirmed");
  f.snapshot.tabs.push({ workspace_id: "w1", tab_id: "w1:t2", pane_count: 1 }); f.snapshot.panes.push({ ...f.pane, terminal_id: "replacement-terminal" });
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "unknown");
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "unknown");
  const changed = TabCleanupIntent.parse({ ...f.intent, target: { ...f.intent.target, address: { ...f.intent.target.address, window: { ...f.intent.target.address.window, terminal: "changed-target" } } } });
  assert.equal((await f.adapter().reconcile({ intent: changed })).kind, "unknown");
  assert.equal(f.closes(), 1);
});

test("missing permission barrier and revoked final authority preserve tabs without dispatch evidence", async () => {
  const f = await fixture();
  const unavailable = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.ok(unavailable.kind === "retained" && unavailable.reason === "permission-unavailable");
  f.allow(async ({ execute }) => execute());
  await assert.rejects(f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => { throw new Error("authority revoked after permission"); } }), /authority revoked/);
  assert.equal(f.closes(), 0); assert.deepEqual(await readdir(f.root), []);
});

const retentionCases: Array<{ name: string; change: (f: Awaited<ReturnType<typeof fixture>>) => void }> = [
  { name: "terminal ID changed", change: f => { f.pane.terminal_id = "reused"; } },
  { name: "workspace changed", change: f => { f.pane.workspace_id = "foreign"; } },
  { name: "pane ID changed", change: f => { f.pane.pane_id = "w1:foreign"; } },
  { name: "tab ID changed", change: f => { f.pane.tab_id = "w1:foreign"; } },
  { name: "cwd changed", change: f => { f.pane.foreground_cwd = "/human-work"; } },
  { name: "server incarnation changed", change: f => { f.native.identity = async () => ({ endpoint: "/native/socket", server: "replacement" }); } },
  { name: "foreign agent", change: f => { f.pane.agent = "codex"; } },
  { name: "unrecognized shell without inventing human use", change: f => { f.native.snapshot = async () => ({ result: { snapshot: { ...f.snapshot, panes: [{ ...f.pane, agent: null, agent_session: null }] } } }); } },
  { name: "extra pane", change: f => { f.snapshot.panes.push({ ...f.pane, pane_id: "w1:p3", terminal_id: "terminal-3" }); const tab = f.snapshot.tabs[0]; assert.ok(tab); tab.pane_count = 2; } },
  { name: "incomplete all-pane inventory", change: f => { const tab = f.snapshot.tabs[0]; assert.ok(tab); tab.pane_count = 2; } },
  { name: "active principal despite idle terminal", change: f => { if (f.resources.live.kind === "observed") f.resources.live.value.principal = "active"; } },
  { name: "pending worker message", change: f => { if (f.resources.live.kind === "observed") f.resources.live.value.pendingMessages = true; } },
  { name: "child still outstanding", change: f => { if (f.resources.live.kind === "observed") f.resources.live.value.childrenOutstanding = true; } },
  { name: "child settlement unknown", change: f => { if (f.resources.live.kind === "observed") f.resources.live.value.childrenHeld = true; } },
  { name: "effect still outstanding", change: f => { if (f.resources.live.kind === "observed") f.resources.live.value.effectsOutstanding = true; } },
  { name: "worker activity unknown", change: f => { f.resources.live = { kind: "unknown", reason: "no authenticated native response" }; } },
  { name: "worker process reused", change: f => { f.resources.process = { kind: "mismatch", identity: { pid: 41, boot: "boot", start: "9999" } }; } },
  { name: "PID incarnation changed during census", change: f => { f.native.occupants = async () => ({ shell: { pid: 40, boot: "boot", start: "1200" }, processes: [{ pid: 40, boot: "boot", start: "1200" }, { pid: 41, boot: "boot", start: "9999" }] }); } },
  { name: "native reader holds missing settlement", change: f => { f.resources.disposition = "hold"; f.resources.reasons = ["settlement evidence missing"]; } },
  { name: "native question or permission UI", change: f => { f.pane.agent_status = "blocked"; } },
  { name: "native activity unknown", change: f => { f.pane.agent_status = "unknown"; } },
  { name: "failed worker report", change: f => { if (f.resources.report) f.resources.report.outcome = "failed"; } },
  { name: "blocked retained assignment", change: f => { const launch = f.references.launches[0]; if (launch?.state.kind === "reported") launch.state.report.outcome = "blocked"; } },
  { name: "transport observation failure", change: f => { f.native.snapshot = async () => { throw new Error("native observation unavailable"); }; } },
];
for (const entry of retentionCases) test(`native tab cleanup retains ${entry.name}`, async () => {
  const f = await fixture(); entry.change(f);
  f.allow(async ({ execute }) => execute());
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.equal(outcome.kind, "retained"); assert.equal(f.closes(), 0); assert.deepEqual(await readdir(f.root), []);
});

test("native path session references join the exact retained session and cwd", async () => {
  const f = await fixture(), journal = join(f.root, "session.jsonl");
  await writeFile(journal, JSON.stringify({ type: "session", id: f.intent.target.address.session, cwd: "/worktree" }) + "\n");
  f.pane.agent_session = { kind: "path", value: journal };
  assert.equal(cleanupEligibility({ intent: f.intent, observation: await f.adapter().observe({ intent: f.intent, references: f.references }) }).kind, "eligible");
  await writeFile(journal, JSON.stringify({ type: "session", id: "replacement-session", cwd: "/worktree" }) + "\n");
  f.allow(async ({ execute }) => execute());
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(f.closes(), 0);
});

test("activity arriving after eligibility during permission blocks the native effect", async () => {
  const f = await fixture();
  assert.equal(cleanupEligibility({ intent: f.intent, observation: await f.adapter().observe({ intent: f.intent, references: f.references }) }).kind, "eligible");
  f.allow(async ({ execute }) => { if (f.resources.live.kind === "observed") f.resources.live.value.effectsOutstanding = true; return execute(); });
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(f.closes(), 0);
});

test("nonzero or malformed native close responses remain uncertain despite absence", async () => {
  for (const outcome of [{ kind: "finished", code: 1, output: "native failed after dispatch" }, { kind: "finished", code: 0, output: "not-json" }, { kind: "finished", code: 0, output: '{"result":{"type":"unrelated"}}' }] satisfies Array<Awaited<ReturnType<TabCleanupNative["close"]>>>) {
    const f = await fixture(), close = f.native.close;
    f.native.close = async input => { await close(input); return outcome; };
    f.allow(async ({ execute }) => execute());
    assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "unknown");
    assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "unknown");
    assert.equal(f.closes(), 1);
  }
});

test("retained outgoing handoff need prevents accepted executor closure", async () => {
  const f = await fixture(), address = f.intent.target.address, pin = f.intent.identity.assignment;
  f.references.handoffs.push(HandoffRecord.parse({ id: randomUUID(), pin: { ...f.intent.integration.intent.controller, task: pin.task, scope: pin.scope, reservation: pin.reservation, assignment: pin.assignment, launch: address.launch, workerSession: address.session, workerGeneration: address.generation, addressDigest: createHash("sha256").update(JSON.stringify(address)).digest("hex") }, stop: randomUUID(), command: randomUUID(), purpose: "handoff", continuation: "continued task", modelPin: { model: "openai-codex/gpt-6.1-sol", thinking: "high", profile: "matt" }, workflowChoice: { profile: "matt", requestedWorkflow: "implement" }, state: { kind: "stopping" } }));
  f.allow(async ({ execute }) => execute());
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(observation.needs.continuation, "needed"); assert.equal(observation.needs.handoffReader, "needed");
  assert.equal((await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} })).kind, "retained");
  assert.equal(f.closes(), 0);
});

test("unrecognized shell metadata is ambiguous and never invents a human-use latch", async () => {
  const f = await fixture();
  f.native.snapshot = async () => ({ result: { snapshot: { ...f.snapshot, panes: [{ ...f.pane, agent: null, agent_session: null }] } } });
  const observation = await f.adapter().observe({ intent: f.intent, references: f.references });
  assert.equal(observation.occupants, "ambiguous");
  f.allow(async ({ execute }) => execute());
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => {} });
  assert.ok(outcome.kind === "retained" && outcome.reason !== "known-human-use");
  assert.equal(f.closes(), 0);
});

test("ordinary permission encloses final authority and exact native recheck before close", async () => {
  const f = await fixture();
  let approved = false, guarded = false;
  f.allow(async ({ command, execute }) => {
    assert.equal(command, "herdr tab close 'w1:t2'");
    approved = true;
    return execute();
  });
  const outcome = await f.adapter().close({ intent: f.intent, references: f.references, finalGuard: async () => { assert.equal(approved, true); guarded = true; } });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(guarded, true);
  assert.equal(f.closes(), 1);
  assert.equal((await f.adapter().reconcile({ intent: f.intent })).kind, "confirmed");
  assert.equal(f.closes(), 1);
});
