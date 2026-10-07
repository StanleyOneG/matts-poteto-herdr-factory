import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Legion } from "../src/intake.js";
const caller = (session: string) => ({ origin: "emperor", transport: "rpc", session, generation: null, presented: [] });
const command = (legion: Legion, session: string, text: string, requestKey: string) => legion.command({ text, requestKey, evidence: caller(session) });
async function bytes(root: string) {
  return new Map(await Promise.all((await readdir(root)).map(async file => [file, await readFile(join(root, file))] as const)));
}
test("a hot journal blocks only matching discovery and preserves unrelated contexts and independent same-context sessions", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-isolation-"));
  const options = { storagePath: root, context: "/crashed/repo", session: "owner", preflight: async () => [] };
  const owner = new Legion(options);
  await command(owner, "owner", "Original acknowledged task", "original");
  const id = (await owner.state()).snapshot?.id;
  assert.ok(id);
  await command(owner, "owner", "off", "off");
  const healthyOptions = [{ ...options, context: "/unrelated/repo", session: "other-context" }, { ...options, session: "independent-session" }];
  const healthy = [];
  for (const opt of healthyOptions) {
    const subject = new Legion(opt);
    assert.equal((await command(subject, opt.session, "Healthy original", "healthy")).kind, "saved");
    await command(subject, opt.session, "off", "healthy-off");
    healthy.push(await subject.state());
  }
  const child = fork(resolve("tests/owner-worker.ts"), [root, options.context, id, "before-commit"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  try {
    await once(child, "message");
    const exit = once(child, "exit");
    child.send("crash");
    const [, signal] = await exit;
    assert.equal(signal, "SIGKILL");
    const before = await bytes(root);
    for (const [i, opt] of healthyOptions.entries()) {
      const reopened = new Legion(opt);
      assert.deepEqual(await reopened.state(), healthy[i]);
    }
    assert.deepEqual(await bytes(root), before, "All read-only discovery bytes remain unchanged");
    for (const opt of [{ ...options, context: "/fresh/repo", session: "fresh-context" }, { ...options, session: "fresh-session" }]) {
      const unrelated = new Legion(opt);
      assert.equal((await command(unrelated, opt.session, "on", "activate")).kind, "applied");
      assert.equal((await unrelated.state()).mode, "active");
      await command(unrelated, opt.session, "off", "deactivate");
    }
    const matching = new Legion(options);
    assert.ok((await matching.state()).unavailable);
    assert.equal((await command(matching, "owner", "on", "do-not-replace")).kind, "rejected");
    assert.equal((await command(matching, "owner", `resume ${id}`, "recover")).kind, "applied");
    assert.equal((await matching.state()).snapshot?.id, id);
    assert.equal((await matching.state()).snapshot?.submissions[0]?.text, "Original acknowledged task");
    assert.equal((await matching.state()).snapshot?.submissions.length, 1);
    await command(matching, "owner", "off", "recover-off");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
for (const phase of ["before-route-publish", "after-route-publish", "after-bootstrap-commit", "before-initialized-publish", "after-initialized-publish", "before-commit", "after-commit", "after-receipt"]) {
  test(`first creation ${phase} explicitly recovers one identity without inventing unacknowledged input`, { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "legion-first-"));
    const options = { storagePath: root, context: "/first/repo", session: "first-session", preflight: async () => [] };
    const child = fork(resolve("tests/initial-owner-worker.ts"), [root, options.context, options.session, phase], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    try {
      const exit = once(child, "exit");
      if (phase === "after-receipt") {
        const [ack] = await once(child, "message");
        assert.equal(ack.result.kind, "saved");
        child.send("crash");
      }
      const [, signal] = await exit;
      assert.equal(signal, "SIGKILL");
      const files = await readdir(root);
      const id = files.join(" ").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
      assert.ok(id);
      const before = await bytes(root);
      const observed = await new Legion(options).state();
      assert.equal(observed.mode, "inactive");
      assert.deepEqual(await bytes(root), before, "First-creation status never repairs bytes");
      const recovered = new Legion(options);
      assert.equal((await command(recovered, options.session, `resume ${id}`, "recover-first")).kind, "applied");
      let view = await recovered.state();
      assert.equal(view.snapshot?.id, id);
      assert.equal(view.snapshot?.submissions.length, ["after-commit", "after-receipt"].includes(phase) ? 1 : 0);
      if (["after-commit", "after-receipt"].includes(phase)) assert.equal(view.snapshot?.submissions[0]?.text, "First original input".repeat(180000));
      assert.equal((await command(recovered, options.session, `resume ${id}`, "recover-again")).kind, "applied");
      view = await recovered.state();
      assert.equal(view.snapshot?.id, id);
      assert.equal(view.snapshot?.submissions.length, ["after-commit", "after-receipt"].includes(phase) ? 1 : 0);
      await command(recovered, options.session, "off", "off");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
}

test("incomplete metadata fails closed only for its routed identity and cannot be overwritten by recovery", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-incomplete-route-"));
  const options = { storagePath: root, context: "/incomplete/repo", session: "incomplete-session", preflight: async () => [] };
  const child = fork(resolve("tests/initial-owner-worker.ts"), [root, options.context, options.session, "route-opened"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const [, signal] = await once(child, "exit");
  assert.equal(signal, "SIGKILL");
  const id = (await readdir(root)).join(" ").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  assert.ok(id);
  const subject = new Legion(options);
  const before = await bytes(root);
  assert.ok((await subject.state()).unavailable);
  assert.deepEqual(await bytes(root), before);
  assert.equal((await command(subject, options.session, "on", "do-not-replace")).kind, "rejected");
  assert.equal((await command(subject, options.session, `resume ${id}`, "do-not-invent-metadata")).kind, "rejected");
  assert.deepEqual(await bytes(root), before);
  const independent = new Legion({ ...options, session: "independent" });
  assert.equal((await command(independent, "independent", "on", "independent-on")).kind, "applied");
  await command(independent, "independent", "off", "independent-off");
});
for (const phase of ["before-route-publish", "after-route-publish", "before-commit"]) {
  test(`alias ${phase} never grants attachment before commit and explicit resume reconciles one identity`, { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "legion-alias-"));
    const options = { storagePath: root, context: "/alias/repo", session: "initial-session", preflight: async () => [] };
    const owner = new Legion(options);
    await command(owner, options.session, "Acknowledged original", "original");
    const id = (await owner.state()).snapshot?.id;
    assert.ok(id);
    await command(owner, options.session, "off", "off");
    const child = fork(resolve("tests/initial-owner-worker.ts"), [root, options.context, "alias-session", phase, id], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const [, signal] = await once(child, "exit");
    assert.equal(signal, "SIGKILL");
    const alias = new Legion({ ...options, session: "alias-session" });
    const before = await bytes(root);
    assert.ok((await alias.state()).unavailable);
    assert.deepEqual(await bytes(root), before);
    assert.equal((await command(alias, "alias-session", "on", "no-implicit-attachment")).kind, "rejected");
    assert.equal((await command(alias, "alias-session", `resume ${id}`, "explicit-attachment")).kind, "applied");
    const view = await alias.state();
    assert.equal(view.snapshot?.id, id);
    assert.equal(view.snapshot?.submissions.length, 1);
    assert.equal(view.snapshot?.submissions[0]?.text, "Acknowledged original");
    assert.ok(view.snapshot?.attachments.some(a => a.session === "alias-session"));
    await command(alias, "alias-session", "off", "off");
    assert.equal((await new Legion(options).state()).snapshot?.id, id);
  });
}
test("initialized missing data and malformed identity never reset acknowledged history; legacy files do not poison current routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-corrupt-"));
  const options = { storagePath: root, context: "/corrupt/repo", session: "owner", preflight: async () => [] };
  const owner = new Legion(options);
  await command(owner, "owner", "Acknowledged input", "original");
  const id = (await owner.state()).snapshot?.id;
  assert.ok(id);
  await command(owner, "owner", "off", "off");
  const database = (await readdir(root)).find(f => f.endsWith(".sqlite"));
  assert.ok(database);
  await rm(join(root, database));
  const before = await bytes(root);
  assert.ok((await owner.state()).unavailable);
  assert.deepEqual(await bytes(root), before);
  assert.equal((await command(owner, "owner", `resume ${id}`, "no-reset")).kind, "rejected");
  const route = (await readdir(root)).find(f => f.endsWith(".initial.route"));
  assert.ok(route);
  await writeFile(join(root, route), "{malformed");
  assert.ok((await new Legion(options).state()).unavailable);
  assert.equal((await command(owner, "owner", `resume ${id}`, "no-metadata-takeover")).kind, "rejected");
  const legacyId = "00000000-0000-4000-8000-000000000000";
  await writeFile(join(root, `${legacyId}.sqlite`), "old development bytes");
  const unrelated = new Legion({ ...options, context: "/unrelated/current", session: "current" });
  assert.equal((await command(unrelated, "current", "on", "current-on")).kind, "applied");
  assert.equal((await readFile(join(root, `${legacyId}.sqlite`), "utf8")), "old development bytes");
  assert.equal((await command(unrelated, "current", `resume ${legacyId}`, "legacy-explicit")).kind, "rejected");
  await command(unrelated, "current", "off", "current-off");
});
test("missing initialization evidence cannot reclassify an acknowledged snapshot as first creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-missing-initialization-"));
  const options = { storagePath: root, context: "/marked/repo", session: "owner", preflight: async () => [] };
  const owner = new Legion(options);
  await command(owner, "owner", "Acknowledged history", "original");
  const id = (await owner.state()).snapshot?.id;
  assert.ok(id);
  await command(owner, "owner", "off", "off");
  const marker = (await readdir(root)).find(file => file.endsWith(".initialized"));
  assert.ok(marker);
  await rm(join(root, marker));
  assert.ok((await owner.state()).unavailable);
  assert.equal((await command(owner, "owner", `resume ${id}`, "not-first-creation")).kind, "rejected");
});
test("explicit recovery from the wrong context cannot publish or bootstrap another context's initial identity", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-wrong-context-"));
  const options = { storagePath: root, context: "/initial/context", session: "initial-session", preflight: async () => [] };
  const child = fork(resolve("tests/initial-owner-worker.ts"), [root, options.context, options.session, "before-route-publish"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  await once(child, "exit");
  const id = (await readdir(root)).join(" ").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  assert.ok(id);
  const before = await bytes(root);
  const wrong = new Legion({ ...options, context: "/wrong/context", session: "wrong-session" });
  assert.equal((await command(wrong, "wrong-session", `resume ${id}`, "wrong-context")).kind, "rejected");
  assert.deepEqual(await bytes(root), before, "Wrong-context recovery cannot alter pending routing or bootstrap data");
});
test("unknown route fields fail closed for the affected identity without blocking an independent session", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-unknown-route-"));
  const options = { storagePath: root, context: "/unknown/repo", session: "owner", preflight: async () => [] };
  const owner = new Legion(options);
  await command(owner, "owner", "Original remains", "original");
  await command(owner, "owner", "off", "off");
  const file = (await readdir(root)).find(f => f.endsWith(".initial.route"));
  assert.ok(file);
  const route = JSON.parse(await readFile(join(root, file), "utf8"));
  await writeFile(join(root, file), JSON.stringify({ ...route, unknown: true }));
  assert.ok((await new Legion(options).state()).unavailable);
  assert.equal((await command(owner, "owner", `resume ${route.id}`, "no-takeover")).kind, "rejected");
  const independent = new Legion({ ...options, session: "independent" });
  assert.equal((await command(independent, "independent", "on", "independent-on")).kind, "applied");
  await command(independent, "independent", "off", "independent-off");
});
test("multiple scoped candidate identities remain unavailable until an explicit identity is selected", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-ambiguous-routes-"));
  const options = { storagePath: root, context: "/shared/repo", session: "first", preflight: async () => [] };
  const ids = [];
  for (const session of ["first", "second"]) {
    const subject = new Legion({ ...options, session });
    await command(subject, session, `Original ${session}`, "original");
    const id = (await subject.state()).snapshot?.id;
    assert.ok(id);
    ids.push(id);
    await command(subject, session, "off", "off");
    const shared = new Legion({ ...options, session: "shared" });
    assert.equal((await command(shared, "shared", `resume ${id}`, "attach-shared")).kind, "applied");
    await command(shared, "shared", "off", "shared-off");
  }
  const ambiguous = new Legion({ ...options, session: "shared" });
  assert.ok((await ambiguous.state()).unavailable?.includes("Multiple Legati"));
  assert.equal((await command(ambiguous, "shared", "on", "no-new-identity")).kind, "rejected");
  assert.equal((await command(ambiguous, "shared", `resume ${ids[0]}`, "choose-first")).kind, "applied");
  assert.equal((await ambiguous.state()).snapshot?.id, ids[0]);
  assert.equal((await ambiguous.state()).snapshot?.submissions[0]?.text, "Original first");
  await command(ambiguous, "shared", "off", "off");
});
for (const phase of ["route-opened", "before-route-publish", "before-initialized-publish"]) {
  test(`off during ${phase} prevents publication after the lifetime lease is revoked`, async () => {
    const root = await mkdtemp(join(tmpdir(), "legion-revoked-publication-"));
    let armed = true;
    const subject = new Legion({
      storagePath: root, context: "/revoked/repo", session: "owner", preflight: async () => [],
      storageFault: point => {
        if (armed && point === phase) {
          armed = false;
          void command(subject, "owner", "off", "off-during-publication");
        }
      },
    });
    assert.equal((await command(subject, "owner", "Unacknowledged input", "original")).kind, "uncertain");
    const files = await readdir(root);
    assert.equal(files.filter(f => f.endsWith(phase !== "before-initialized-publish" ? ".initial.route" : ".initialized")).length, 0);
    const id = files.join(" ").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    assert.ok(id);
    assert.equal((await subject.state()).mode, "inactive");
    if (phase === "route-opened") {
      const pending = files.find(file => file.endsWith(".route.pending"));
      assert.ok(pending);
      assert.equal(await readFile(join(root, pending), "utf8"), "", "Revocation prevents writing identity content after the lease closes");
      assert.equal((await command(subject, "owner", `resume ${id}`, "no-unknown-metadata")).kind, "rejected");
    } else {
      assert.equal((await command(subject, "owner", `resume ${id}`, "safe-recovery")).kind, "applied");
      assert.equal((await subject.state()).snapshot?.id, id);
      assert.equal((await subject.state()).snapshot?.submissions.length, 0);
    }
    await command(subject, "owner", "off", "off");
  });
}
