import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
async function checkout(t: { after: (cleanup: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "legion-checkout-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const context = join(directory, "repo");
  execFileSync("git", ["init", "--quiet", context]);
  execFileSync("git", ["-C", context, "-c", "user.name=Legion Test", "-c", "user.email=legion@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  return { directory, context, storagePath: join(directory, "state") };
}
test("association: different sessions competing on and task in one checkout cannot both activate", { timeout: 20000 }, async t => {
  const { storagePath, context } = await checkout(t);
  const subjects = [worker(storagePath, context, "session-a", "on", "activate"), worker(storagePath, context, "session-b", "task Bounded task", "task")];
  try {
    const results = await start(subjects);
    assert.equal(results.filter(r => r.state.mode === "active").length, 1, "One checkout permits only one active Legatus across sessions");
    const winner = results.findIndex(r => r.state.mode === "active");
    const loser = 1 - winner;
    assert.equal(results[loser]?.result.kind, "rejected");
    assert.equal(results[loser]?.state.snapshot, null, "A denied session must not publish its own history");
    const owner = subjects[winner], candidate = subjects[loser];
    assert.ok(owner && candidate);
    const history = results[winner]?.state.snapshot;
    assert.ok(history);
    assert.equal((await send(owner.child, "off", "release")).state.mode, "inactive");
    const next = await send(candidate.child, "task Own new history", "retry");
    assert.equal(next.result.kind, "saved");
    assert.equal(next.state.mode, "active");
    assert.notEqual(next.state.snapshot?.id, history.id, "Different sessions retain separate routes/history");
    assert.equal(next.state.snapshot?.submissions[0]?.text, "Own new history");
    await send(candidate.child, "off", "off");
  } finally { await Promise.all(subjects.map(s => stop(s.child))); }
});
test("association: checkout root, nested cwd and symlink share exclusion but a linked worktree is independent", async t => {
  const { directory, context, storagePath } = await checkout(t);
  const nested = join(context, "nested"), alias = join(directory, "alias"), linked = join(directory, "linked");
  await mkdir(nested);
  await symlink(context, alias, "dir");
  execFileSync("git", ["-C", context, "worktree", "add", "--quiet", "-b", "independent", linked]);
  const options = { storagePath, context, session: "root-session", preflight: async () => [] };
  const owner = new Legion(options);
  const subjects = [{ subject: owner, session: options.session }];
  try {
    assert.equal((await command(owner, options.session, "on", "owner")).kind, "applied");
    for (const cwd of [nested, alias, join(alias, "nested")]) {
      const candidate = new Legion({ ...options, context: cwd, session: "other-session" });
      subjects.push({ subject: candidate, session: "other-session" });
      assert.equal((await command(candidate, "other-session", "task Must not overlap", "contend")).kind, "rejected", `Alias/nested cwd ${cwd} cannot evade checkout ownership`);
      assert.equal((await candidate.state()).mode, "inactive");
      assert.equal((await candidate.state()).snapshot, null);
    }
    const independent = new Legion({ ...options, context: linked, session: "independent-session" });
    subjects.push({ subject: independent, session: "independent-session" });
    assert.equal((await command(independent, "independent-session", "on", "independent")).kind, "applied");
    assert.equal((await independent.state()).mode, "active");
    assert.equal((await owner.state()).mode, "active");
    const original = (await owner.state()).snapshot;
    assert.ok(original);
    assert.notEqual((await independent.state()).snapshot?.id, original.id);
    await command(owner, options.session, "off", "release-root");
    const nestedSession = subjects[1];
    assert.ok(nestedSession);
    assert.equal((await command(nestedSession.subject, nestedSession.session, "on", "nested-after-off")).kind, "applied");
    assert.equal((await nestedSession.subject.state()).snapshot?.context, nested, "Exclusion canonicalization must not rewrite saved route identity");
    await command(nestedSession.subject, nestedSession.session, "off", "release-nested");
    assert.equal((await command(owner, options.session, "on", "restore-root")).kind, "applied");
    assert.equal((await owner.state()).snapshot?.id, original.id);
    assert.equal((await owner.state()).snapshot?.context, context);
  } finally {
    await Promise.all(subjects.map(({ subject, session }) => command(subject, session, "off", "cleanup")));
  }
});
test("association: malformed Git markers and unresolved cwd aliases fail visibly without activating", async t => {
  const { directory, context, storagePath } = await checkout(t);
  const malformed = join(context, "malformed"), dangling = join(directory, "dangling");
  await mkdir(malformed);
  await writeFile(join(malformed, ".git"), "not a gitdir identity\n");
  await symlink(join(directory, "absent"), dangling, "dir");
  for (const cwd of [malformed, dangling, join(context, "missing")]) {
    const subject = new Legion({ storagePath, context: cwd, session: "unresolved", preflight: async () => [] });
    const result = await command(subject, "unresolved", "task Cannot authorize work", "unresolved");
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") {
      assert.equal(result.code, "ownership");
      assert.match(result.message, /Exclusive checkout ownership is unavailable/);
    }
    assert.equal((await subject.state()).mode, "inactive");
    assert.equal((await subject.state()).snapshot, null);
  }
});
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
test("association: cross-process on versus resume in different sessions has one lifetime checkout owner", { timeout: 20000 }, async t => {
  for (let round = 0; round < 4; round++) {
    const { storagePath: root, context } = await checkout(t);
    const original = new Legion({ storagePath: root, context, session: "original-session", preflight: async () => [] });
    assert.equal((await command(original, "original-session", "Original acknowledged history", "original")).kind, "saved");
    const id = (await original.state()).snapshot?.id;
    assert.ok(id);
    await command(original, "original-session", "off", "original-off");
    const sessions = ["activation-session", "resume-session"];
    const subjects = [worker(root, context, "activation-session", "on", "activate"), worker(root, context, "resume-session", `resume ${id}`, "resume")];
    try {
      const results = await start(subjects);
      assert.equal(results.filter(r => r.state.mode === "active").length, 1);
      const winnerIndex = results.findIndex(r => r.state.mode === "active");
      const winner = results[winnerIndex];
      const session = sessions[winnerIndex];
      assert.ok(session);
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
test("an interrupted initial owner excludes other checkout sessions until death, with independent checkouts and byte-preserving status", { timeout: 20000 }, async () => {
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
    const competing = new Legion({ ...options, session: "competing-session" });
    assert.equal((await command(competing, "competing-session", "on", "contend")).kind, "rejected");
    assert.equal((await competing.state()).mode, "inactive");
    const independent = new Legion({ ...options, context: "/independent/repo" });
    assert.equal((await command(independent, session, "on", "independent")).kind, "applied");
    assert.equal((await independent.state()).mode, "active");
    await command(independent, session, "off", "off");
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
  assert.equal((await command(candidate, "candidate", "on", "after-failure")).kind, "rejected");
  assert.equal((await candidate.state()).mode, "inactive");
  const observer = new Legion({ ...options, session: "observer" });
  assert.equal((await command(observer, "observer", `resume ${id}`, "guard-still-held")).kind, "rejected");
  await command(owner, "owner", "off", "owner-off");
  assert.equal((await command(candidate, "candidate", "on", "after-owner-off")).kind, "applied");
  assert.notEqual((await candidate.state()).snapshot?.id, id);
  await command(candidate, "candidate", "off", "candidate-off");
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
