import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Legion } from "../src/intake.js";
import { SnapshotSchema } from "../src/snapshot.js";
const Result = z.object({
  kind: z.literal("result"),
  result: z.object({ kind: z.string(), receipt: z.object({ legatus: z.string(), requestKey: z.string() }).optional() }),
  state: z.object({ mode: z.enum(["active", "inactive"]), snapshot: SnapshotSchema.nullable() }),
});
const evidence = (session: string) => ({ origin: "emperor", transport: "rpc", session, generation: null, presented: [] });
const command = (subject: Legion, session: string, text: string, requestKey: string) => subject.command({ text, requestKey, evidence: evidence(session) });
function worker(root: string, context: string, session: string, text: string, key: string, phase = "") {
  const child = fork(resolve("tests/association-worker.ts"), [root, context, session, text, key, phase], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const ready = once(child, "message").then(([raw]) => z.object({ kind: z.literal("ready") }).parse(raw));
  return { child, ready };
}
async function start(subjects: ReturnType<typeof worker>[]) {
  await Promise.all(subjects.map(s => s.ready));
  const results = subjects.map(s => once(s.child, "message").then(([raw]) => Result.parse(raw)));
  const at = Date.now() + 100;
  for (const s of subjects) s.child.send({ at });
  return Promise.all(results);
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
}
async function send(child: ChildProcess, text: string, requestKey: string) {
  const result = once(child, "message").then(([raw]) => Result.parse(raw));
  child.send({ text, requestKey });
  return result;
}
for (const text of ["on", "  Exact original task\n"]) {
  test(`cross-process first ${JSON.stringify(text)} has one association and no competing owner`, { timeout: 20000 }, async () => {
    for (let round = 0; round < 4; round++) {
      const root = await mkdtemp(join(tmpdir(), "legion-association-"));
      const context = "/association/repo", session = "same-session";
      const subjects = [worker(root, context, session, text, "first-a"), worker(root, context, session, text, "first-b")];
      try {
        const results = await start(subjects);
        assert.equal(results.filter(r => r.state.mode === "active").length, 1, "Exactly one cross-process owner may activate");
        const winner = results.findIndex(r => r.state.mode === "active");
        const win = results[winner];
        assert.ok(win?.state.snapshot);
        assert.equal(win.result.kind, text === "on" ? "applied" : "saved");
        assert.equal(results[1 - winner]?.result.kind, "rejected");
        assert.equal(win.state.snapshot.receipts.length, 1);
        assert.equal(win.result.receipt?.legatus, win.state.snapshot.id);
        assert.equal(win.result.receipt?.requestKey, winner === 0 ? "first-a" : "first-b");
        assert.equal(results[1 - winner]?.result.receipt, undefined);
        assert.equal(win.state.snapshot.submissions.length, text === "on" ? 0 : 1);
        if (text !== "on") assert.equal(win.state.snapshot.submissions[0]?.text, text);
        assert.equal((await readdir(root)).filter(f => f.endsWith(".initial.route")).length, 1);
        const options = { storagePath: root, context, session, preflight: async () => [] };
        const reopened = new Legion(options);
        assert.equal((await reopened.state()).snapshot?.id, win.state.snapshot.id);
        assert.equal((await command(reopened, session, "on", "competing-restart")).kind, "rejected");
        const owner = subjects[winner];
        assert.ok(owner);
        if (round === 0) {
          assert.equal((await send(owner.child, "off", "normal-off")).state.mode, "inactive");
        } else await stop(owner.child);
        assert.equal((await command(reopened, session, "on", "after-process-death")).kind, "applied");
        assert.equal((await reopened.state()).snapshot?.id, win.state.snapshot.id);
        assert.equal((await reopened.state()).snapshot?.submissions.length, text === "on" ? 0 : 1);
        await command(reopened, session, "off", "off");
      } finally { await Promise.all(subjects.map(s => stop(s.child))); }
    }
  });
}
test("cross-process activation versus resume of a different ID has one lifetime association owner", { timeout: 20000 }, async () => {
  for (let round = 0; round < 4; round++) {
    const root = await mkdtemp(join(tmpdir(), "legion-association-resume-"));
    const context = "/resume/repo";
    const original = new Legion({ storagePath: root, context, session: "original-session", preflight: async () => [] });
    assert.equal((await command(original, "original-session", "Original acknowledged history", "original")).kind, "saved");
    const id = (await original.state()).snapshot?.id;
    assert.ok(id);
    await command(original, "original-session", "off", "original-off");
    const session = "shared-target-session";
    const subjects = [worker(root, context, session, "on", "activate"), worker(root, context, session, `resume ${id}`, "resume")];
    try {
      const results = await start(subjects);
      assert.equal(results.filter(r => r.state.mode === "active").length, 1);
      const winner = results.find(r => r.state.mode === "active");
      assert.ok(winner?.state.snapshot);
      assert.equal(winner.result.kind, "applied");
      assert.equal(results.find(r => r.state.mode === "inactive")?.result.kind, "rejected");
      const reopened = new Legion({ storagePath: root, context, session, preflight: async () => [] });
      assert.equal((await reopened.state()).snapshot?.id, winner.state.snapshot.id);
      assert.equal((await command(reopened, session, "on", "cannot-overlap")).kind, "rejected");
      assert.equal((await original.state()).snapshot?.id, id);
      assert.equal((await original.state()).snapshot?.submissions[0]?.text, "Original acknowledged history");
    } finally { await Promise.all(subjects.map(s => stop(s.child))); }
  }
});
test("an interrupted initial owner releases both leases on death, with independent associations and byte-preserving status", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-association-held-"));
  const context = "/held/repo", session = "held-session";
  const subject = worker(root, context, session, "Unacknowledged task", "not-received", "before-commit");
  try {
    await subject.ready;
    const held = once(subject.child, "message").then(([raw]) => z.object({ kind: z.literal("held") }).parse(raw));
    subject.child.send({ at: Date.now() + 50 });
    await held;
    const route = (await readdir(root)).find(f => f.endsWith(".initial.route"));
    assert.ok(route);
    const id = z.object({ id: z.string() }).parse(JSON.parse(await readFile(join(root, route), "utf8"))).id;
    const options = { storagePath: root, context, session, preflight: async () => [] };
    const reopened = new Legion(options);
    const bytes = async () => new Map(await Promise.all((await readdir(root)).map(async f => [f, await readFile(join(root, f))] as const)));
    const before = await bytes();
    assert.equal((await reopened.state()).mode, "inactive");
    assert.deepEqual(await bytes(), before);
    assert.equal((await command(reopened, session, "on", "no-overlap")).kind, "rejected");
    for (const opt of [{ ...options, session: "independent-session" }, { ...options, context: "/independent/repo" }]) {
      const independent = new Legion(opt);
      assert.equal((await command(independent, opt.session, "on", "independent")).kind, "applied");
      assert.equal((await independent.state()).mode, "active");
      await command(independent, opt.session, "off", "off");
    }
    await stop(subject.child);
    assert.equal((await command(reopened, session, `resume ${id}`, "recover-after-death")).kind, "applied");
    assert.equal((await reopened.state()).snapshot?.id, id);
    assert.equal((await reopened.state()).snapshot?.submissions.length, 0);
    await command(reopened, session, "off", "off");
  } finally { await stop(subject.child); }
});
test("failed partial acquisition and uncertain writes release only their handles and never a prior owner's leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-association-failure-"));
  const context = "/failure/repo";
  const options = { storagePath: root, context, session: "owner", preflight: async () => [] };
  const owner = new Legion(options);
  assert.equal((await command(owner, "owner", "Protected original", "original")).kind, "saved");
  const id = (await owner.state()).snapshot?.id;
  assert.ok(id);
  const candidate = new Legion({ ...options, session: "candidate" });
  assert.equal((await command(candidate, "candidate", `resume ${id}`, "failed-resume")).kind, "rejected");
  assert.equal((await owner.state()).mode, "active");
  assert.equal((await command(candidate, "candidate", "on", "after-failure")).kind, "applied");
  assert.notEqual((await candidate.state()).snapshot?.id, id);
  await command(candidate, "candidate", "off", "candidate-off");
  const observer = new Legion({ ...options, session: "observer" });
  assert.equal((await command(observer, "observer", `resume ${id}`, "guard-still-held")).kind, "rejected");
  await command(owner, "owner", "off", "owner-off");
  let fail = true;
  const uncertain = new Legion({ ...options, storageFault: point => {
    if (fail && point === "before-commit") { fail = false; throw new Error("Test-owned interrupted commit"); }
  } });
  assert.equal((await command(uncertain, "owner", "Never acknowledged", "uncertain")).kind, "uncertain");
  assert.equal((await uncertain.state()).mode, "inactive");
  const recovered = new Legion(options);
  assert.equal((await command(recovered, "owner", `resume ${id}`, "after-uncertainty")).kind, "applied");
  assert.equal((await recovered.state()).snapshot?.submissions.length, 1);
  assert.equal((await recovered.state()).snapshot?.submissions[0]?.text, "Protected original");
  await command(recovered, "owner", "off", "off");
});
test("off during association-only acquisition cannot activate or leak the unadopted lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-association-revoked-"));
  const { readdirSync } = await import("node:fs");
  let revoked = false;
  let off: Promise<unknown> | null = null;
  const session = "delayed-session";
  const options = { storagePath: root, context: "/delayed/repo", session, preflight: async () => [] };
  const subject = new Legion({ ...options, preflight: async () => {
    let remaining = 100;
    const observe = () => {
      const files = readdirSync(root);
      if (files.some(f => f.startsWith("association.v1.")) && !files.some(f => f.startsWith("v1."))) {
        revoked = true;
        off = command(subject, session, "off", "revoke-partial");
      } else if (--remaining) queueMicrotask(observe);
    };
    queueMicrotask(observe);
    return [];
  } });
  const delayed = await command(subject, session, "on", "delayed");
  assert.equal(delayed.kind, "rejected");
  if (delayed.kind === "rejected") assert.equal(delayed.code, "revoked");
  await off;
  assert.equal(revoked, true, "Off must occur after association acquisition but before identity publication");
  assert.equal((await subject.state()).mode, "inactive");
  assert.equal((await readdir(root)).filter(f => f.endsWith(".initial.route")).length, 0);
  const next = new Legion(options);
  assert.equal((await command(next, session, "on", "next-owner")).kind, "applied");
  assert.equal((await next.state()).mode, "active");
  await command(next, session, "off", "off");
});
