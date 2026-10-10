import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";

const [actorsPath] = process.argv.slice(2);
if (!actorsPath) throw new Error("Supply the retained admission actors JSONL path.");
const hash = value => createHash("sha256").update(value).digest("hex");
const files = new Map();
function read(path) {
  const bytes = readFileSync(path);
  files.set(path, hash(bytes));
  return bytes.toString("utf8");
}
function journalReference(reference) {
  const at = reference.lastIndexOf("#"), path = reference.slice(0, at), id = reference.slice(at + 1);
  assert.ok(at > 0 && id);
  const matches = read(path).trimEnd().split("\n").map(line => JSON.parse(line)).filter(entry => entry.id === id);
  assert.equal(matches.length, 1);
  return matches[0];
}
let effects = 0, nativeLoads = 0, controllerRetirements = 0, preparedCalls = 0;
const actors = read(actorsPath).trimEnd().split("\n").map(line => JSON.parse(line));
const observations = [];
for (const actor of actors) {
  const history = JSON.parse(read(join(actor.root, "effect-history.json")));
  const ownership = JSON.parse(read(join(actor.root, "ownership.json")));
  assert.equal(ownership.closed, true);
  const states = [];
  for (const effect of history.snapshot.effects) {
    effects++;
    const intent = effect.intent;
    assert.equal(effect.digest, hash(JSON.stringify(intent)));
    const call = journalReference(intent.call.journal);
    assert.equal(call.message.role, "assistant");
    const tool = call.message.content.find(part => part.type === "toolCall" && part.id === intent.call.id);
    assert.equal(tool.name, intent.call.name);
    assert.deepEqual(tool.arguments, intent.call.rawInput ?? intent.call.input);
    if (intent.call.rawInput !== undefined) {
      const definitions = { bash: createBashToolDefinition, edit: createEditToolDefinition, write: createWriteToolDefinition };
      const native = definitions[tool.name](intent.contract.cwd);
      const raw = structuredClone(intent.call.rawInput);
      const prepared = native.prepareArguments ? native.prepareArguments(raw) : raw;
      assert.deepEqual(validateToolArguments(native, { ...tool, arguments: prepared }), intent.call.input);
      preparedCalls++;
    }
    assert.equal(intent.contract.verification.kind, "verified");
    for (const resource of intent.contract.resources) {
      if (resource.load.kind === "not-required") continue;
      assert.equal(resource.load.kind, "complete");
      for (const proof of resource.load.evidence) {
        nativeLoads++;
        if (proof.kind === "native-expansion") assert.equal(journalReference(proof.entry).message.role, "user");
        else {
          const readCall = journalReference(proof.call), result = journalReference(proof.result);
          assert.equal(readCall.message.role, "assistant");
          assert.equal(result.message.role, "toolResult");
          assert.equal(result.message.toolCallId, proof.toolCallId);
          assert.equal(result.message.isError, false);
        }
      }
    }
    if (effect.state.kind !== "outstanding") {
      const outcome = JSON.parse(read(effect.state.evidence));
      if (effect.state.kind === "completed") assert.equal(outcome.kind, "native-result");
      if (effect.state.kind === "refused") assert.ok(["refused", "tool-pipeline-end"].includes(outcome.kind));
      if (effect.state.kind === "unknown") assert.equal(outcome.kind, "native-outcome-unknown");
    }
    states.push(effect.state.kind);
  }
  if (actor.effectCase === "lost-response") assert.deepEqual(states, ["outstanding"]);
  if (actor.effectCase === "unknown") assert.deepEqual(states, ["unknown"]);
  if (actor.effectCase === "off") {
    const outstanding = JSON.parse(read(join(actor.root, "outstanding-after-off.json")));
    assert.equal(outstanding.mode, "stopping");
    assert.equal(outstanding.snapshot.effects[0].state.kind, "outstanding");
    assert.deepEqual(states, ["completed"]);
  }
  if (["native-tools", "native-legacy", "native-string", "native-object"].includes(actor.effectCase)) assert.deepEqual(states, ["completed", "completed", "completed"]);
  if (actor.effectCase.startsWith("controller-")) {
    const { requested, refusal } = JSON.parse(read(join(actor.root, "controller-refusal.json")));
    assert.equal(refusal.kind, "resource-invalidated");
    assert.deepEqual(refusal.intent, { id: requested.id, digest: hash(JSON.stringify(requested)) });
    const retirementPath = join(actor.root, "agent/legion/tribuni", requested.pin.launch, requested.pin.workerGeneration, `${requested.id}.contract-retired.json`);
    const retirement = JSON.parse(read(retirementPath));
    assert.deepEqual(retirement.refusal, refusal);
    assert.deepEqual(JSON.parse(read(retirement.request)).message.intent, requested);
    assert.deepEqual(states, ["completed"]);
    const recovered = history.snapshot.effects[0].intent;
    assert.equal(recovered.call.id, "fresh-proof-recovered");
    for (const resource of requested.contract.resources.filter(resource => resource.load.kind === "complete")) {
      const fresh = recovered.contract.resources.find(candidate => candidate.name === resource.name);
      assert.equal(fresh.canonicalPath, resource.canonicalPath);
      assert.equal(fresh.digest, resource.digest);
      assert.equal(fresh.load.kind, "complete");
      const oldCalls = new Set(resource.load.evidence.filter(proof => proof.kind === "read").map(proof => proof.toolCallId));
      for (const proof of fresh.load.evidence) {
        assert.equal(proof.kind, "read");
        assert.equal(oldCalls.has(proof.toolCallId), false);
      }
    }
    controllerRetirements++;
  }
  if (actor.effectCase === "task-amendment") {
    assert.deepEqual(states, []);
    assert.equal(history.tasks[0].history.at(-1).revision, 2);
    assert.equal(history.tasks[0].scope.amendments.length, 1);
  }
  observations.push({ effectCase: actor.effectCase, root: actor.root, states });
}
process.stdout.write(JSON.stringify({ verdict: "ADMISSION_EVIDENCE_CHECK_PASS", actors: actors.length, effects, nativeLoads, controllerRetirements, preparedCalls, observations, files: [...files].map(([path, sha256]) => ({ path, sha256 })) }, null, 2) + "\n");
