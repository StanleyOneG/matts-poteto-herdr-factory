import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createDeliveryAdapter } from "../src/delivery-adapter.js";
import { DeliveryContent, DeliveryIntent, deliveryDigest } from "../src/delivery-domain.js";
import type { GuardedCommand } from "../src/git-workspace.js";
import { acceptedResult, deliveryControl, deliveryFixture } from "./support/delivery-fixture.js";

const exec = promisify(execFile);
const bash: GuardedCommand = async command => {
  try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
  catch (error) { const value = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error); return { kind: "finished", code: value.code, output: value.stdout + value.stderr }; }
};
async function fixture(configuration: Record<string, unknown> | ((f: { checkout: string; root: string }) => Record<string, unknown>), execute: GuardedCommand = bash) {
  const f = await deliveryFixture();
  await acceptedResult(f);
  const configurationFile = join(f.checkout, ".git", "delivery.json");
  await writeFile(configurationFile, JSON.stringify(typeof configuration === "function" ? configuration(f) : configuration));
  const adapter = await createDeliveryAdapter({ cwd: f.checkout, configurationFile, execute, observe: bash });
  f.options.delivery = { adapter: () => adapter };
  const captured = await deliveryControl({ f, action: { kind: "capture-final", specification: "direct:39", tasks: [f.task], requiredChecks: ["focused"] } });
  assert.ok(captured.kind === "final-delivery-stage", JSON.stringify(captured));
  const prepare = async (publication: unknown) => {
    const id = randomUUID();
    const prepared = await deliveryControl({ f, action: { kind: "prepare-publication", id, final: { id: captured.final.id, digest: captured.final.digest }, publication } });
    assert.equal(prepared.kind, "delivery-stage", JSON.stringify(prepared));
    const intent = (await f.legion.state()).snapshot?.deliveries.find(value => value.intent.id === id)?.intent;
    assert.ok(intent);
    return intent;
  };
  return { ...f, adapter, configurationFile, prepare };
}
const local = { version: 1, revision: "operator-v1", identity: { provider: "local", project: "direct" }, localReport: { directory: ".git/reports" } };

test("local delivery writes exact durable linked evidence and reconciles a lost acknowledgement without another effect", async () => {
  let effects = 0;
  const f = await fixture(local, async command => { effects++; await bash(command); return { kind: "unknown", message: "lost acknowledgement" }; });
  try {
    const intent = await f.prepare({ kind: "local-report" });
    let authority = 0;
    assert.equal((await f.adapter.execute({ intent, assertAuthority: async () => { authority++; } })).kind, "unknown");
    const outcome = await f.adapter.reconcile({ intent });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    if (outcome.kind !== "confirmed") assert.fail();
    const report = await readFile(outcome.reference, "utf8");
    for (const proof of [intent.id, intent.digest, "criteria.md", "test.log", "review.md", "exception.md", "refs/heads/task-parent"]) assert.ok(report.includes(proof), proof);
    assert.equal(authority, 1);
    assert.equal((await f.adapter.reconcile({ intent })).kind, "confirmed");
    assert.equal(effects, 1);
    await writeFile(outcome.reference, "unrelated report on the same branch");
    assert.equal((await f.adapter.reconcile({ intent })).kind, "unknown");
  } finally { await f.command("off"); }
});

function remoteConfiguration(f: { root: string }, behavior = "normal") {
  const command = { executable: process.execPath, args: [resolveProvider(), join(f.root, "provider state's"), behavior] };
  return { version: 1, revision: "operator-v1", identity: { provider: "tracker-fixture", project: "tracker-project" },
    tracker: { provider: "tracker-fixture", project: "tracker-project", closeTask: command, observe: { ...command, readOnly: true } },
    review: { provider: "review-fixture", project: "review-project", draft: command, ready: command, observe: { ...command, readOnly: true } } };
}
const resolveProvider = () => new URL("./support/delivery-provider.mjs", import.meta.url).pathname;

test("explicit independent review capability publishes exact draft then readies only that receipt", async () => {
  let effects = 0;
  const f = await fixture(remoteConfiguration, async command => { effects++; return bash(command); });
  try {
    const draft = await f.prepare({ kind: "draft" });
    // Use the public state owner so ready preparation obtains the actual confirmed draft receipt.
    assert.equal((await f.legion.command({ deliveryRequest: draft.id })).kind, "delivery-stage");
    const state = (await f.legion.state()).snapshot?.deliveries.find(value => value.intent.id === draft.id)?.state;
    assert.equal(state?.kind, "confirmed", JSON.stringify(state));
    const ready = await f.prepare({ kind: "ready", draft: draft.id });
    const outcome = await f.adapter.execute({ intent: ready, assertAuthority: async () => {} });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    if (outcome.kind !== "confirmed" || state?.kind !== "confirmed") assert.fail();
    assert.equal(outcome.reference, state.reference);
    assert.equal((await f.adapter.reconcile({ intent: ready })).kind, "confirmed");
    assert.equal(effects, 2);
    assert.ok(outcome.evidence.join("\n").includes("review.md"));
  } finally { await f.command("off"); }
});

test("tracker closure receives linked acceptance, check, review, integration and resolved exception proof", async () => {
  const f = await fixture(remoteConfiguration);
  try {
    assert.equal((await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task, tracker: { provider: "tracker-fixture", project: "tracker-project", id: "39", url: "https://tracker.invalid/39" } } })).kind, "observed");
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", task: f.task, id } })).kind, "delivery-stage");
    const intent = (await f.legion.state()).snapshot?.deliveries.find(value => value.intent.id === id)?.intent;
    assert.ok(intent);
    let authority = 0;
    const outcome = await f.adapter.execute({ intent, assertAuthority: async () => { authority++; } });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    const report = outcome.evidence.join("\n");
    for (const exact of ["[independent review](<review.md>)", "criteria.md", "test.log", "exception.md", "Material exception", "legion-integrate:", "refs/heads/task-parent"]) assert.ok(report.includes(exact), exact);
    assert.equal(authority, 1);
    assert.equal((await f.adapter.reconcile({ intent })).kind, "confirmed");
  } finally { await f.command("off"); }
});

test("publication uncertainty, exact receipt mismatch and explicit no-effect failure never trigger another effect during observation", async () => {
  for (const behavior of ["lost", "mismatch", "wrong-operation", "malformed", "fail"]) {
    let effects = 0;
    const f = await fixture(f => remoteConfiguration(f, behavior), async command => { effects++; return bash(command); });
    try {
      const intent = await f.prepare({ kind: "draft" });
      const outcome = await f.adapter.execute({ intent, assertAuthority: async () => {} });
      assert.equal(outcome.kind, behavior === "fail" ? "failed" : "unknown", JSON.stringify(outcome));
      if (outcome.kind === "failed") { assert.equal(outcome.noEffect, true); assert.ok(outcome.evidence[0]?.includes("before creating")); }
      const reconciled = await f.adapter.reconcile({ intent });
      assert.equal(reconciled.kind, behavior === "lost" || behavior === "malformed" ? "confirmed" : behavior === "fail" ? "failed" : "unknown", JSON.stringify(reconciled));
      await f.adapter.reconcile({ intent });
      assert.equal(effects, 1);
    } finally { await f.command("off"); }
  }
});

test("provider diagnostics remain evidence without converting nonzero, signal, malformed or mis-correlated stdout into confirmation", async () => {
  for (const scenario of ["nonzero", "signal", "malformed", "trailing", "wrong-operation", "mismatch", "fail"]) {
    const f = await fixture(f => remoteConfiguration(f, `${scenario}-diagnostics`));
    try {
      const intent = await f.prepare({ kind: "draft" });
      const outcome = await f.adapter.execute({ intent, assertAuthority: async () => {} });
      assert.equal(outcome.kind, scenario === "fail" ? "failed" : "unknown", scenario);
      assert.ok(outcome.evidence.some(item => item.includes("Fixture execute diagnostic")), scenario);
      if (outcome.kind === "unknown" && scenario === "nonzero") assert.match(outcome.message, /"kind":"exited","code":9/);
      if (outcome.kind === "unknown" && scenario === "signal") assert.match(outcome.message, /"kind":"signaled","signal":"SIGTERM"/);
      const observed = await f.adapter.reconcile({ intent });
      assert.equal(observed.kind, scenario === "fail" ? "failed" : scenario === "malformed" ? "confirmed" : "unknown", scenario);
      assert.ok(observed.evidence.some(item => item.includes("Fixture reconcile diagnostic")), scenario);
    } finally { await f.command("off"); }
  }
});

test("malformed transport and shell status disagreement cannot confirm a valid provider response", async () => {
  for (const fault of ["status", "trailing", "incomplete"]) {
    const f = await fixture(input => remoteConfiguration(input, "diagnostics"), async command => {
      const receipt = await bash(command);
      if (receipt.kind !== "finished") return receipt;
      return fault === "status" ? { ...receipt, code: receipt.code + 1 }
        : { ...receipt, output: fault === "trailing" ? `${receipt.output}\nunrelated output` : receipt.output.slice(0, -1) };
    });
    try {
      const intent = await f.prepare({ kind: "draft" });
      const outcome = await f.adapter.execute({ intent, assertAuthority: async () => {} });
      assert.equal(outcome.kind, "unknown", fault);
      if (outcome.kind !== "unknown") assert.fail();
      assert.match(outcome.message, fault === "status" ? /exit status/ : /transport unavailable\/malformed/);
      assert.ok(outcome.evidence.some(item => item.includes("Fixture execute diagnostic")) || outcome.message.includes("Fixture execute diagnostic"), "Diagnostics survive transport failure");
      assert.equal((await f.adapter.reconcile({ intent })).kind, "confirmed", "Only an exact subsequent read-only receipt settles uncertainty");
    } finally { await f.command("off"); }
  }
});

test("provider spawn failure remains unknown with explicit termination evidence", async () => {
  const f = await fixture(input => {
    const configuration = remoteConfiguration(input);
    // Executable exists and is executable, but its interpreter cannot be spawned.
    const executable = join(input.root, "unavailable-provider");
    writeFileSync(executable, "#!/nonexistent-legion-provider-interpreter\n", { mode: 0o700 });
    return { ...configuration, review: { ...configuration.review, draft: { executable, args: [] }, observe: { executable, args: [], readOnly: true } } };
  });
  try {
    const intent = await f.prepare({ kind: "draft" });
    for (const outcome of [await f.adapter.execute({ intent, assertAuthority: async () => {} }), await f.adapter.reconcile({ intent })]) {
      assert.equal(outcome.kind, "unknown");
      if (outcome.kind !== "unknown") assert.fail();
      assert.match(outcome.message, /"kind":"unavailable"/);
      assert.match(outcome.message, /ENOENT/);
    }
  } finally { await f.command("off"); }
});

test("canonical configuration identity pins commands and capabilities, rejects drift and missing configuration", async () => {
  let effects = 0;
  const f = await fixture(local, async command => { effects++; return bash(command); });
  try {
    const intent = await f.prepare({ kind: "local-report" });
    await writeFile(f.configurationFile, JSON.stringify({ localReport: local.localReport, identity: { project: "direct", provider: "local" }, revision: "operator-v1", version: 1 }));
    const reordered = await createDeliveryAdapter({ cwd: f.checkout, configurationFile: f.configurationFile, execute: bash, observe: bash });
    assert.deepEqual(reordered.configuration, f.adapter.configuration);
    await writeFile(f.configurationFile, JSON.stringify({ ...local, localReport: { directory: ".git/different-reports" } }));
    const outcome = await f.adapter.execute({ intent, assertAuthority: async () => assert.fail("drift must refuse before authority") });
    assert.equal(outcome.kind, "failed");
    assert.equal((await f.adapter.reconcile({ intent })).kind, "unknown");
    assert.equal(effects, 0);
    await assert.rejects(createDeliveryAdapter({ cwd: f.checkout, configurationFile: join(f.checkout, "missing.json"), execute: bash, observe: bash }));
    for (const invalid of [ {}, { ...local, extra: "not allowed" }, { ...local, tracker: { provider: "other", project: "elsewhere" } }, { ...local, review: { provider: "review", project: "p", draft: { executable: "gh", args: [] }, observe: { executable: "/bin/true", args: [], readOnly: true } } }, { ...local, review: { provider: "review", project: "p", draft: { executable: "/bin/true", args: [] }, observe: { executable: "/bin/true", args: [] } } } ]) {
      await writeFile(f.configurationFile, JSON.stringify(invalid));
      await assert.rejects(createDeliveryAdapter({ cwd: f.checkout, configurationFile: f.configurationFile, execute: bash, observe: bash }));
    }
  } finally { await f.command("off"); }
});

test("canonical report location changes invalidate the pinned configuration before any write", async () => {
  const f = await fixture(local);
  try {
    for (const name of ["report-a", "report-b"]) await mkdir(join(f.checkout, ".git", name));
    const link = join(f.checkout, ".git", "reports");
    await symlink("report-a", link);
    let effects = 0;
    const adapter = await createDeliveryAdapter({ cwd: f.checkout, configurationFile: f.configurationFile, execute: async command => { effects++; return bash(command); }, observe: bash });
    f.options.delivery = { adapter: () => adapter };
    const intent = await f.prepare({ kind: "local-report" });
    await unlink(link); await symlink("report-b", link);
    const outcome = await adapter.execute({ intent, assertAuthority: async () => {} });
    assert.equal(outcome.kind, "failed", JSON.stringify(outcome));
    assert.equal(effects, 0);
  } finally { await f.command("off"); }
});

test("final observation and publication refuse tracked, index, untracked, hidden-index, unfinished and branch drift", async () => {
  let effects = 0;
  const f = await fixture(local, async command => { effects++; return bash(command); });
  try {
    const intent = await f.prepare({ kind: "local-report" });
    if (intent.kind !== "publish") assert.fail();
    const input = { workspace: intent.final.identity.workspace, results: intent.final.identity.results };
    const observe = async () => { assert.ok(f.adapter.observeFinal); return f.adapter.observeFinal(input); };
    const git = (...args: string[]) => exec("git", ["-C", f.checkout, ...args]);
    assert.equal((await observe()).kind, "clean");
    await writeFile(join(f.checkout, "tracked"), "changed\n");
    assert.equal((await observe()).kind, "held");
    assert.equal((await f.adapter.execute({ intent, assertAuthority: async () => assert.fail("dirty final") })).kind, "failed");
    await writeFile(join(f.checkout, "tracked"), "original\n");
    const extra = join(f.checkout, "extra");
    await writeFile(extra, "untracked\n"); assert.equal((await observe()).kind, "held");
    await git("add", "extra"); assert.equal((await observe()).kind, "held");
    await git("rm", "--cached", "extra"); await unlink(extra);
    await git("update-index", "--assume-unchanged", "tracked");
    await writeFile(join(f.checkout, "tracked"), "hidden content\n");
    assert.equal((await observe()).kind, "held");
    await git("update-index", "--no-assume-unchanged", "tracked"); await writeFile(join(f.checkout, "tracked"), "original\n");
    await writeFile(join(f.checkout, ".git", "MERGE_HEAD"), intent.final.identity.commit);
    assert.equal((await observe()).kind, "held"); await unlink(join(f.checkout, ".git", "MERGE_HEAD"));
    await git("switch", "-c", "other"); assert.equal((await observe()).kind, "held"); await git("switch", "task-parent");
    assert.equal((await observe()).kind, "clean");
    assert.equal(effects, 0);
  } finally { await f.command("off"); }
});

test("final observer pins repository/worktree and accepted ancestry rather than accepting a matching clean tree", async () => {
  const f = await fixture(local);
  try {
    const intent = await f.prepare({ kind: "local-report" });
    if (intent.kind !== "publish" || !f.adapter.observeFinal) assert.fail();
    const input = { workspace: intent.final.identity.workspace, results: intent.final.identity.results };
    assert.equal((await f.adapter.observeFinal({ ...input, workspace: { ...input.workspace, repository: f.root } })).kind, "held");
    assert.equal((await f.adapter.observeFinal({ ...input, workspace: { ...input.workspace, path: f.launch.worker.resources.cwd } })).kind, "held");
    const commit = (await exec("git", ["-C", f.checkout, "commit-tree", intent.final.identity.tree, "-m", "unrelated identical tree"])).stdout.trim();
    await exec("git", ["-C", f.checkout, "update-ref", "refs/heads/task-parent", commit, intent.final.identity.commit]);
    assert.equal((await exec("git", ["-C", f.checkout, "status", "--porcelain"])).stdout, "");
    assert.equal((await f.adapter.observeFinal(input)).kind, "held");
    // An observation/report is not a primary-branch merge grant and has no blanket branch-name ban.
    await exec("git", ["-C", f.checkout, "branch", "-m", "main"]);
    assert.equal((await f.adapter.observeFinal({ workspace: { ...input.workspace, branch: "refs/heads/main" }, results: [] })).kind, "clean");
  } finally { await f.command("off"); }
});

test("authority denial and missing remote capability refuse effects; absent evidence remains unknown", async () => {
  let effects = 0;
  const f = await fixture(local, async command => { effects++; return bash(command); });
  try {
    await exec("git", ["-C", f.checkout, "remote", "add", "origin", "https://github.invalid/not/a-provider.git"]);
    const localIntent = await f.prepare({ kind: "local-report" });
    const denied = await f.adapter.execute({ intent: localIntent, assertAuthority: async () => { throw new Error("ordinary host permission/authority refused"); } });
    assert.equal(denied.kind, "failed");
    if (denied.kind !== "failed") assert.fail();
    assert.equal(denied.noEffect, true);
    assert.equal((await f.adapter.reconcile({ intent: localIntent })).kind, "unknown");
    const { id: _id, digest: _digest, controller, configuration, ...content } = localIntent;
    const draft = DeliveryContent.parse({ ...content, publication: { kind: "draft" } });
    const remote = DeliveryIntent.parse({ ...draft, id: randomUUID(), controller, configuration, digest: deliveryDigest({ content: draft, configuration }) });
    const unconfigured = await f.adapter.execute({ intent: remote, assertAuthority: async () => assert.fail("unconfigured capability") });
    assert.equal(unconfigured.kind, "failed");
    assert.equal((await f.adapter.reconcile({ intent: remote })).kind, "unknown");
    assert.equal(effects, 0);
  } finally { await f.command("off"); }
});

test("ready receipts must identify the exact original draft and command/capability edits change configuration revision", async () => {
  const f = await fixture(f => {
    const config = remoteConfiguration(f);
    return { ...config, review: { ...config.review, ready: { ...config.review.ready, args: [...config.review.ready.args.slice(0, -1), "wrong-reference"] } } };
  });
  try {
    const draft = await f.prepare({ kind: "draft" });
    await f.legion.command({ deliveryRequest: draft.id });
    const ready = await f.prepare({ kind: "ready", draft: draft.id });
    assert.equal((await f.adapter.execute({ intent: ready, assertAuthority: async () => {} })).kind, "unknown");
    assert.equal((await f.adapter.reconcile({ intent: ready })).kind, "unknown");
    const original = f.adapter.configuration.revision;
    const config = remoteConfiguration(f);
    await writeFile(f.configurationFile, JSON.stringify(config));
    const changedCommand = await createDeliveryAdapter({ cwd: f.checkout, configurationFile: f.configurationFile, execute: bash, observe: bash });
    assert.notEqual(changedCommand.configuration.revision, original);
    await writeFile(f.configurationFile, JSON.stringify({ ...config, review: { ...config.review, ready: undefined } }));
    const changedCapability = await createDeliveryAdapter({ cwd: f.checkout, configurationFile: f.configurationFile, execute: bash, observe: bash });
    assert.notEqual(changedCapability.configuration.revision, changedCommand.configuration.revision);
    assert.equal((await f.adapter.reconcile({ intent: ready })).kind, "unknown");
  } finally { await f.command("off"); }
});

test("review-only direct delivery requires no tracker and uses the separately explicit review project", async () => {
  const f = await fixture(f => {
    const config = remoteConfiguration(f);
    return { version: 1, revision: config.revision, identity: { provider: "review-fixture", project: "review-project" }, review: config.review };
  });
  try {
    const intent = await f.prepare({ kind: "draft" });
    const outcome = await f.adapter.execute({ intent, assertAuthority: async () => {} });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    const receipt = JSON.parse(await readFile(join(f.root, "provider state's", `${intent.id}.json`), "utf8"));
    assert.deepEqual(receipt.request.target, { provider: "review-fixture", project: "review-project" });
    assert.equal((await f.legion.state()).tasks[0]?.tracker, undefined);
  } finally { await f.command("off"); }
});

test("linked owning worktrees use their exact Git backlink, not another checkout in the repository", async () => {
  const f = await fixture(local);
  try {
    const cwd = f.launch.worker.resources.cwd;
    await writeFile(join(f.checkout, ".git", "info", "exclude"), ".legion/\n");
    await mkdir(join(cwd, ".legion"));
    const configurationFile = join(cwd, ".legion", "delivery.json");
    await writeFile(configurationFile, JSON.stringify({ ...local, localReport: { directory: join(f.root, "linked-reports") } }));
    const adapter = await createDeliveryAdapter({ cwd, configurationFile, execute: bash, observe: bash });
    assert.ok(adapter.observeFinal);
    const branch = (await exec("git", ["-C", cwd, "symbolic-ref", "HEAD"])).stdout.trim();
    const repository = (await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    assert.equal((await adapter.observeFinal({ workspace: { path: cwd, repository, branch }, results: [] })).kind, "clean");
    assert.equal((await adapter.observeFinal({ workspace: { path: f.checkout, repository, branch }, results: [] })).kind, "held");
  } finally { await f.command("off"); }
});
