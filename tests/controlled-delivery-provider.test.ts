import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { createDeliveryAdapter, renderDeliveryReport } from "../src/delivery-adapter.js";
import { DeliveryContent, DeliveryIntent, deliveryDigest } from "../src/delivery-domain.js";
import type { GuardedCommand } from "../src/git-workspace.js";
import { acceptedResult, deliveryControl, deliveryFixture } from "./support/delivery-fixture.js";

// Approved seam: fixed executable CLI + legion-delivery/v1, observed through its read-only CLI.
const script = resolve("tests/support/controlled-delivery-provider.ts");
const loader = resolve("node_modules/tsx/dist/loader.mjs");
function cli(root: string, action: string, input?: unknown) {
  return spawnSync(process.execPath, ["--import", loader, script, action, root], {
    input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", env: process.env,
  });
}
function inspect(root: string) {
  const result = cli(root, "inspect");
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const exec = promisify(execFile);
const bash: GuardedCommand = async command => {
  try { return { kind: "finished", code: 0, output: (await exec("bash", ["-c", command])).stdout }; }
  catch (error) {
    const result = z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error);
    return { kind: "finished", code: result.code, output: result.stdout + result.stderr };
  }
};
async function fixture() {
  // Synthetic accepted evidence is ONLY for deterministic contract tests, never installed-journey proof.
  const f = await deliveryFixture();
  await acceptedResult(f);
  const root = join(f.root, "platform");
  const initialized = cli(root, "init");
  assert.equal(initialized.status, 0, initialized.stderr);
  const state = inspect(root);
  const command = { executable: process.execPath, args: ["--import", loader, script, "provider", root] };
  const configurationFile = join(f.checkout, ".git", "controlled-delivery.json");
  await writeFile(configurationFile, JSON.stringify({ version: 1, revision: "controlled-test-v1",
    identity: { provider: state.provider, project: state.project },
    tracker: { provider: state.provider, project: state.project, closeTask: command, observe: { ...command, readOnly: true } },
    review: { provider: state.provider, project: state.project, draft: command, ready: command, observe: { ...command, readOnly: true } },
  }));
  const adapter = await createDeliveryAdapter({ cwd: f.checkout, configurationFile, execute: bash, observe: bash });
  f.options.delivery = { adapter: () => adapter };
  const closure = async () => {
    assert.equal((await deliveryControl({ f, action: { kind: "bind-tracker", task: f.task,
      tracker: { provider: state.provider, project: state.project, id: "A" } } })).kind, "observed");
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-closure", task: f.task, id } })).kind, "delivery-stage");
    const intent = (await f.legion.state()).snapshot?.deliveries.find(record => record.intent.id === id)?.intent;
    assert.ok(intent);
    return intent;
  };
  const capture = async () => {
    const result = await deliveryControl({ f, action: { kind: "capture-final", specification: "controlled-spec",
      tasks: [f.task], requiredChecks: ["focused"] } });
    assert.ok(result.kind === "final-delivery-stage", JSON.stringify(result));
    return result.final;
  };
  const publication = async (final: { id: string; digest: string }, publication: unknown) => {
    const id = randomUUID();
    assert.equal((await deliveryControl({ f, action: { kind: "prepare-publication", id, final: { id: final.id, digest: final.digest }, publication } })).kind, "delivery-stage");
    const intent = (await f.legion.state()).snapshot?.deliveries.find(record => record.intent.id === id)?.intent;
    assert.ok(intent);
    return intent;
  };
  return { ...f, root, adapter, closure, capture, publication };
}

test("controlled delivery provider initializes a unique open A/B/C project and never resets it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "cpf-")), root = join(parent, "platform");
  const initialized = cli(root, "init");
  assert.equal(initialized.status, 0, initialized.stderr);
  const state = inspect(root);
  assert.equal(state.provider, "controlled-fixture");
  assert.match(state.project, /^fixture-/);
  assert.deepEqual(state.issues, [{ id: "A", state: "open" }, { id: "B", state: "open" }, { id: "C", state: "open" }]);
  assert.deepEqual(state.reviews, []);
  assert.deepEqual(state.operations, []);
  const before = await readFile(join(root, "state.json"), "utf8");
  assert.notEqual(cli(root, "init").status, 0);
  assert.equal(await readFile(join(root, "state.json"), "utf8"), before);
});

test("controlled delivery provider closes only the linked issue and reconciles exact immutable evidence read-only", async () => {
  const f = await fixture();
  try {
    const intent = await f.closure();
    const outcome = await f.adapter.execute({ intent, assertAuthority: async () => {} });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    const state = inspect(f.root);
    assert.deepEqual(state.issues.map((issue: { id: string; state: string }) => [issue.id, issue.state]), [["A", "closed"], ["B", "open"], ["C", "open"]]);
    assert.equal(state.issues[0].closure, intent.id);
    const receipt = state.operations[0];
    assert.equal(receipt.operation, intent.id);
    assert.equal(receipt.digest, intent.digest);
    assert.deepEqual(receipt.outcome, outcome);
    assert.equal(intent.kind, "close-task");
    if (intent.kind !== "close-task") assert.fail();
    assert.equal(receipt.linkage.result.id, intent.proof.record.id);
    assert.equal(receipt.linkage.verifications[0], intent.proof.record.verifications[0]?.digest);
    assert.equal(receipt.linkage.reviews[0].reference, "review.md");
    const before = await readFile(join(f.root, "state.json"), "utf8");
    assert.deepEqual(await f.adapter.reconcile({ intent }), outcome);
    inspect(f.root);
    assert.deepEqual(await readdir(f.root), ["state.json"], "Read-only observation leaves no lock, receipt or scratch writes");
    assert.equal(await readFile(join(f.root, "state.json"), "utf8"), before);
  } finally { await f.command("off"); }
});

test("controlled delivery provider readies the original draft object at the final reviewed tip", async () => {
  const f = await fixture();
  try {
    const initial = await f.capture();
    const draft = await f.publication(initial, { kind: "draft" });
    await f.legion.command({ deliveryRequest: draft.id });
    const drafted = inspect(f.root);
    assert.equal(drafted.reviews.length, 1);
    assert.equal(drafted.reviews[0].state, "draft");
    assert.equal(drafted.reviews[0].tip, initial.identity.commit);
    assert.deepEqual(drafted.reviews[0].scope.tasks, [f.task]);
    const reference = drafted.reviews[0].reference;
    assert.match(reference, /^test-fixture:/);
    await writeFile(join(f.checkout, "interaction.txt"), "final combined change\n");
    await exec("git", ["-C", f.checkout, "add", "interaction.txt"]);
    await exec("git", ["-C", f.checkout, "commit", "-m", "controlled final change"]);
    const final = await f.capture();
    assert.notEqual(final.identity.commit, initial.identity.commit);
    const verified = await deliveryControl({ f, action: { kind: "verify-final", final: { id: final.id, digest: final.digest },
      verification: { checks: [{ name: "focused", outcome: "passed", evidence: ["combined.log"] }], exceptions: [] } } });
    assert.ok(verified.kind === "final-delivery-stage");
    assert.equal((await deliveryControl({ f, action: { kind: "review-final", id: randomUUID(), result: { id: final.id, digest: final.digest },
      verificationDigest: verified.final.verifications.at(-1)?.digest, reviewer: { session: "independent-final", run: "test" },
      reference: "final-review.md", outcome: "approved", evidence: ["final-review.md"] } })).kind, "final-delivery-stage");
    const ready = await f.publication(final, { kind: "ready", draft: draft.id });
    const outcome = await f.adapter.execute({ intent: ready, assertAuthority: async () => {} });
    assert.equal(outcome.kind, "confirmed", JSON.stringify(outcome));
    if (outcome.kind !== "confirmed") assert.fail();
    assert.equal(outcome.reference, reference);
    const state = inspect(f.root);
    assert.equal(state.reviews.length, 1);
    assert.equal(state.reviews[0].id, drafted.reviews[0].id);
    assert.equal(state.reviews[0].draft, draft.id);
    assert.equal(state.reviews[0].ready, ready.id);
    assert.equal(state.reviews[0].state, "ready");
    assert.equal(state.reviews[0].tip, final.identity.commit);
    assert.equal(state.reviews[0].tree, final.identity.tree);
    assert.deepEqual(state.operations[0], drafted.operations[0], "Draft receipt remains immutable");
    const before = await readFile(join(f.root, "state.json"), "utf8");
    assert.deepEqual(await f.adapter.reconcile({ intent: ready }), outcome);
    assert.equal(await readFile(join(f.root, "state.json"), "utf8"), before);
  } finally { await f.command("off"); }
});

function request(intent: DeliveryIntent, mode = "execute") {
  return { protocol: "legion-delivery/v1", mode, operation: intent.id, digest: intent.digest,
    target: { provider: intent.configuration.provider, project: intent.configuration.project }, intent, report: renderDeliveryReport(intent) };
}
function changedIntent(intent: DeliveryIntent, change: Record<string, unknown>) {
  const { id: _id, digest: _digest, controller: _controller, configuration: _configuration, ...raw } = intent;
  const content = DeliveryContent.parse(raw);
  return DeliveryIntent.parse({ ...intent, ...change, id: randomUUID(),
    digest: deliveryDigest({ content: DeliveryContent.parse({ ...content, ...change }), configuration: intent.configuration }) });
}

test("controlled delivery provider refuses foreign targets, replay changes and malformed input without overwriting receipts", async () => {
  const f = await fixture();
  try {
    const intent = await f.closure(), input = request(intent);
    const unknown = cli(f.root, "provider", { ...input, mode: "reconcile" });
    assert.equal(unknown.status, 0, unknown.stderr);
    assert.equal(JSON.parse(unknown.stdout).outcome.kind, "unknown");
    assert.deepEqual(inspect(f.root).operations, []);
    const foreign = { ...input, target: { ...input.target, project: "fixture-foreign" } };
    const rejected = cli(f.root, "provider", foreign);
    assert.equal(rejected.status, 0, rejected.stderr);
    const failed = JSON.parse(rejected.stdout).outcome;
    assert.equal(failed.kind, "failed");
    assert.equal(failed.noEffect, true);
    assert.deepEqual(inspect(f.root).issues.map((issue: { state: string }) => issue.state), ["open", "open", "open"]);
    const before = await readFile(join(f.root, "state.json"), "utf8");
    assert.equal(cli(f.root, "provider", { ...foreign, mode: "reconcile" }).status, 0);
    assert.notEqual(cli(f.root, "provider", foreign).status, 0, "Exact execute is not a permissive retry");
    assert.notEqual(cli(f.root, "provider", input).status, 0, "Same operation with different target refused");
    assert.notEqual(cli(f.root, "provider", { ...foreign, report: "changed request content" }).status, 0);
    assert.notEqual(cli(f.root, "provider", { ...foreign, digest: "0".repeat(64) }).status, 0);
    assert.notEqual(cli(f.root, "provider", { ...foreign, operation: randomUUID() }).status, 0);
    assert.notEqual(cli(f.root, "provider", "not an object").status, 0);
    assert.equal(await readFile(join(f.root, "state.json"), "utf8"), before);
    assert.deepEqual(inspect(f.root).operations[0].outcome, failed);
    const next = changedIntent(intent, { previous: intent.id });
    const confirmed = cli(f.root, "provider", request(next));
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(JSON.parse(confirmed.stdout).outcome.kind, "confirmed");
    assert.deepEqual(inspect(f.root).operations[0].outcome, failed, "Later success preserves failure receipt");
  } finally { await f.command("off"); }
});

test("controlled delivery provider rejects a ready reference or scope not belonging to the confirmed draft", async () => {
  const f = await fixture();
  try {
    const final = await f.capture(), draft = await f.publication(final, { kind: "draft" });
    await f.legion.command({ deliveryRequest: draft.id });
    const ready = await f.publication(final, { kind: "ready", draft: draft.id });
    assert.ok(ready.kind === "publish" && ready.publication.kind === "ready");
    const initial = inspect(f.root), reference = initial.reviews[0].reference;
    const wrong = changedIntent(ready, { publication: { ...ready.publication, reference: "test-fixture:unrelated" } });
    const wrongDraft = changedIntent(ready, { publication: { ...ready.publication, draft: randomUUID() } });
    const identity = { ...ready.final.identity, specification: "different-scope" };
    const wrongScope = changedIntent(ready, { final: { ...ready.final, identity, digest: deliveryDigest(identity) } });
    for (const intent of [wrong, wrongDraft, wrongScope]) {
      const result = cli(f.root, "provider", request(intent));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).outcome.kind, "failed");
      assert.deepEqual(inspect(f.root).reviews, initial.reviews);
    }
    const result = await f.adapter.execute({ intent: ready, assertAuthority: async () => {} });
    assert.equal(result.kind, "confirmed", JSON.stringify(result));
    assert.equal(inspect(f.root).reviews[0].reference, reference);
    const before = await readFile(join(f.root, "state.json"), "utf8");
    assert.notEqual(cli(f.root, "provider", request(ready)).status, 0);
    assert.equal(await readFile(join(f.root, "state.json"), "utf8"), before);
  } finally { await f.command("off"); }
});

test("controlled delivery provider refuses malformed persisted receipt bindings read-only", async () => {
  const f = await fixture();
  try {
    const intent = await f.closure();
    assert.equal((await f.adapter.execute({ intent, assertAuthority: async () => {} })).kind, "confirmed");
    const state = inspect(f.root);
    state.operations[0].outcome.operation = randomUUID();
    const malformed = JSON.stringify(state);
    await writeFile(join(f.root, "state.json"), malformed);
    assert.notEqual(cli(f.root, "inspect").status, 0);
    assert.notEqual(cli(f.root, "provider", request(intent, "reconcile")).status, 0);
    assert.equal(await readFile(join(f.root, "state.json"), "utf8"), malformed);
  } finally { await f.command("off"); }
});

// Follow-up approved seam: run the documented operator commands, never a live owning checkout.
test("controlled delivery provider documented selector transition preserves existing routing and refuses drift", async () => {
  const documentation = await readFile(resolve("tests/support/controlled-delivery-provider.md"), "utf8");
  const prepareBlock = documentation.split("```bash\n").find(block => block.includes("// BEGIN documented selector transition\n"))?.split("\n```")[0];
  assert.ok(prepareBlock, "Existing-selector setup needs an executable documented guarded transition");
  const parent = await mkdtemp(join(tmpdir(), "cpft-")), owning = join(parent, "repo"), evidence = join(parent, "selector-transition");
  await mkdir(join(owning, ".legion"), { recursive: true });
  await mkdir(join(owning, ".pi"));
  await exec("git", ["init", "--initial-branch=fixture", owning]);
  const selector = join(owning, ".pi", "legion-delivery.json"), oldConfig = join(owning, ".legion", "delivery.json");
  const originalSelector = '{ "configurationFile": ".legion/delivery.json" }\n';
  const originalConfig = JSON.stringify({ version: 1, revision: "retained-local-v1", identity: { provider: "local", project: "retained" }, localReport: { directory: ".legion/reports" } }) + "\n";
  const originalIgnore = "delivery.json\nreports/\n";
  await writeFile(selector, originalSelector);
  await writeFile(oldConfig, originalConfig);
  await writeFile(join(owning, ".pi", ".gitignore"), "*\n");
  await writeFile(join(owning, ".legion", ".gitignore"), originalIgnore);
  const platform = join(parent, "platform");
  const initialized = cli(platform, "init");
  assert.equal(initialized.status, 0, initialized.stderr);
  const commands: Array<{ action: string; status: number | null; signal: string | null; stdout: string; stderr: string }> = [];
  const run = (action: string, ...extra: string[]) => {
    const result = spawnSync(process.execPath, [join(parent, "selector-transition.mjs"), action, owning, evidence, ...extra],
      { encoding: "utf8", env: process.env });
    commands.push({ action, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
    return result;
  };
  const prepared = spawnSync("bash", ["-euo", "pipefail", "-c", prepareBlock], { encoding: "utf8", env: { ...process.env,
    OWNER: parent, OWNING: owning, ROOT: platform, NODE: process.execPath, LOADER: loader, FIXTURE: script } });
  commands.push({ action: "prepare-documented-bash", status: prepared.status, signal: prepared.signal, stdout: prepared.stdout, stderr: prepared.stderr });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(await readFile(selector, "utf8"), originalSelector, "Preparation does not change selection");
  assert.equal(await readFile(join(evidence, "selector.original"), "utf8"), originalSelector);
  assert.equal(await readFile(join(evidence, "configuration.original"), "utf8"), originalConfig);
  assert.equal(await readFile(join(evidence, "ignore.original"), "utf8"), originalIgnore);
  const manifest = z.object({ oldIdentity: z.object({ provider: z.string(), project: z.string() }), oldRevision: z.string(),
    sha256: z.record(z.string(), z.string()) }).parse(JSON.parse(await readFile(join(evidence, "manifest.json"), "utf8")));
  assert.deepEqual(manifest.oldIdentity, { provider: "local", project: "retained" });
  assert.equal(manifest.oldRevision, "retained-local-v1");
  assert.equal(manifest.sha256["selector.original"], createHash("sha256").update(originalSelector).digest("hex"));
  assert.equal(manifest.sha256["configuration.original"], createHash("sha256").update(originalConfig).digest("hex"));
  assert.equal(await readFile(join(owning, ".legion", ".gitignore"), "utf8"), originalIgnore + "/controlled-delivery.json\n");
  await exec("git", ["-C", owning, "check-ignore", "-q", ".legion/controlled-delivery.json"]);
  const selectedFixture = '{"configurationFile":".legion/controlled-delivery.json"}\n';
  const newConfig = await readFile(join(owning, ".legion", "controlled-delivery.json"), "utf8");
  assert.equal(JSON.parse(newConfig).tracker.project, JSON.parse(initialized.stdout).project);
  const switched = run("switch");
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(await readFile(selector, "utf8"), selectedFixture);
  const restored = run("restore");
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(await readFile(selector, "utf8"), originalSelector);
  assert.equal(await readFile(oldConfig, "utf8"), originalConfig);
  assert.equal(await readFile(join(owning, ".legion", "controlled-delivery.json"), "utf8"), newConfig);
  assert.notEqual(run("prepare", platform, process.execPath, loader, script).status, 0, "No reset of preserved evidence/configuration");
  // Byte drift must refuse in either direction; operator corrections below affect disposable inputs only.
  for (const action of ["switch", "restore"]) {
    if (action === "restore") assert.equal(run("switch").status, 0);
    const expectedSelector = action === "switch" ? originalSelector : selectedFixture;
    for (const file of [selector, oldConfig, join(owning, ".legion", "controlled-delivery.json")]) {
      const expected = await readFile(file, "utf8");
      await writeFile(file, expected + " \n");
      const result = run(action);
      assert.notEqual(result.status, 0, `${action} must refuse drift in ${file}`);
      assert.equal(await readFile(file, "utf8"), expected + " \n");
      if (file !== selector) assert.equal(await readFile(selector, "utf8"), expectedSelector);
      await writeFile(file, expected);
    }
    assert.equal(await readFile(selector, "utf8"), expectedSelector);
  }
  assert.equal(run("restore").status, 0);
  assert.equal(await readFile(selector, "utf8"), originalSelector);
  assert.deepEqual(await readdir(join(owning, ".pi")), [".gitignore", "legion-delivery.json"]);
  await writeFile(join(parent, "commands.json"), JSON.stringify(commands, null, 2) + "\n");
});
