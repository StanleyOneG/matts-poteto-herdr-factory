import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const [historiesPath] = process.argv.slice(2);
if (!historiesPath) throw new Error("Supply the retained exception histories JSONL path.");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const files = new Map();
function read(path) {
  const bytes = readFileSync(path);
  files.set(path, hash(bytes));
  return bytes.toString("utf8");
}
const json = path => JSON.parse(read(path));
function reference(value) {
  const split = value.lastIndexOf("#");
  assert.ok(split > 0);
  const entry = read(value.slice(0, split)).trimEnd().split("\n").map(line => JSON.parse(line)).filter(entry => entry.id === value.slice(split + 1));
  assert.equal(entry.length, 1);
  return entry[0];
}
const histories = read(historiesPath).trimEnd().split("\n").map(line => JSON.parse(line));
let requests = 0, exceptions = 0, admissions = 0, results = 0, alternatives = 0;
const observations = [];
for (const { root, effectCase } of histories) {
  const history = json(join(root, "effect-history.json"));
  assert.equal(json(join(root, "ownership.json")).closed, true);
  const records = history.snapshot.engineering;
  const workerJournal = read(join(root, "worker.jsonl")).trimEnd().split("\n").map(line => JSON.parse(line));
  const controllerJournal = read(join(root, "controller.jsonl")).trimEnd().split("\n").map(line => JSON.parse(line));
  for (const record of records) {
    requests++;
    const { pin, proposal } = record;
    assert.equal(record.digest, hash(JSON.stringify({ pin, proposal, ...(record.previous ? { previous: record.previous } : {}) })));
    const publication = json(join(root, "agent/legion/tribuni", pin.launch, pin.workerGeneration, `${pin.assignment}.${record.id}.engineering.json`));
    assert.equal(publication.requestKey, record.id);
    assert.deepEqual(publication.proposal, proposal);
    assert.deepEqual(publication.previous, record.previous);
    const entry = reference(record.requestEvidence);
    assert.equal(entry.customType, "legion-engineering-request");
    const call = workerJournal.flatMap(entry => entry.message?.role === "assistant" ? entry.message.content : []).find(part => part.type === "toolCall" && part.id === entry.data.toolCallId);
    assert.equal(call.name, "legion_engineering");
    assert.deepEqual(call.arguments, proposal);
    if (record.previous) assert.ok(records.some(prior => prior.id === record.previous.id && prior.digest === record.previous.digest && isDeepStrictEqual(prior.pin, pin)));
    if (record.state.kind === "decided") {
      assert.notEqual(record.state.by.session, pin.workerSession);
      assert.equal(record.state.by.session, pin.session);
      const decisionResult = controllerJournal.find(entry => entry.message?.role === "toolResult" && entry.message.toolName === "legion_engineering_decide" && entry.message.details?.receipt?.requestKey === record.state.delivery.command);
      assert.equal(decisionResult.message.details.kind, "applied");
      const decisionCall = controllerJournal.flatMap(entry => entry.message?.role === "assistant" ? entry.message.content : []).find(part => part.type === "toolCall" && part.id === decisionResult.message.toolCallId);
      assert.equal(decisionCall.name, "legion_engineering_decide");
      assert.deepEqual(decisionCall.arguments, record.state.decision);
      if (record.state.delivery.kind === "applied") {
        const delivered = json(record.state.delivery.evidence);
        assert.equal(delivered.id, record.id);
        assert.deepEqual(delivered.proposal, proposal);
        assert.deepEqual(delivered.state.decision, record.state.decision);
        if (record.state.delivery.continuation.kind === "applied") {
          const continued = reference(record.state.delivery.continuation.evidence);
          assert.equal(continued.message.role, "user");
          assert.ok(continued.message.content.some(part => part.type === "text" && part.text.includes(record.id) && part.text.includes(JSON.stringify(proposal))));
        }
      }
    }
    if (proposal.kind === "exception") {
      exceptions++;
      const seam = records.find(seam => seam.id === proposal.seam.id && seam.digest === proposal.seam.digest);
      assert.equal(seam.proposal.kind, "seam");
      assert.deepEqual(seam.pin, pin);
      assert.equal(seam.state.decision.kind, "approve");
      assert.ok(seam.proposal.behaviors.includes(proposal.behavior));
      assert.ok(proposal.omittedTest.trim() && proposal.rationale.trim() && proposal.alternative.description.trim());
    }
  }
  for (const effect of history.snapshot.effects) {
    admissions++;
    assert.equal(effect.digest, hash(JSON.stringify(effect.intent)));
    const record = records.find(record => record.id === effect.intent.decision.id && record.digest === effect.intent.decision.digest);
    assert.equal(record.state.decision.kind, "approve");
    assert.deepEqual(effect.intent.pin, record.pin);
    if (record.proposal.kind === "exception") assert.deepEqual(effect.intent.seam, record.proposal.seam);
    const call = reference(effect.intent.call.journal).message.content.find(part => part.type === "toolCall" && part.id === effect.intent.call.id);
    assert.equal(call.name, effect.intent.call.name);
    assert.deepEqual(call.arguments, effect.intent.call.rawInput);
    if (effect.state.kind === "refused") assert.ok(["refused", "tool-pipeline-end"].includes(json(effect.state.evidence).kind));
    if (effect.state.kind === "unknown") assert.equal(json(effect.state.evidence).kind, "native-outcome-unknown");
    if (effect.state.kind === "completed") {
      const native = json(effect.state.evidence);
      assert.equal(native.kind, "native-result");
      assert.equal(native.result.isError ?? false, effect.state.isError);
      if (effect.intent.call.name === "bash") assert.equal(native.result.structuredContent.exit_code, effect.state.exitCode);
    }
  }
  const launch = history.tasks[0].launch;
  if (launch.kind === "reported") {
    results++;
    const report = json(join(root, "agent/legion/tribuni", launch.worker.address.launch, launch.worker.address.generation, `${launch.command}.report.json`));
    assert.deepEqual(report.engineering, launch.report.engineering);
    for (const item of [report.engineering, ...(report.engineering.priorExceptions ?? [])]) {
      const decision = records.find(record => record.id === item.decision.id && record.digest === item.decision.digest);
      assert.ok(decision);
      for (const ref of item.effects) assert.ok(history.snapshot.effects.some(effect => effect.intent.id === ref.id && effect.digest === ref.digest && effect.intent.decision.id === decision.id));
      if (item.alternative.kind === "verified") {
        alternatives++;
        assert.equal(decision.proposal.kind, "exception");
        const effect = history.snapshot.effects.find(effect => effect.intent.id === item.alternative.effect.id && effect.digest === item.alternative.effect.digest);
        assert.equal(effect.intent.decision.id, decision.id);
        assert.equal(history.snapshot.effects.filter(candidate => candidate.intent.decision.id === decision.id).at(-1).intent.id, effect.intent.id);
        assert.equal(effect.intent.call.name, "bash");
        assert.deepEqual(effect.intent.call.input, decision.proposal.alternative.input);
        assert.equal(effect.state.kind, "completed");
        assert.equal(effect.state.isError, false);
        assert.equal(effect.state.exitCode, 0);
        assert.equal(effect.state.evidence, item.alternative.evidence);
        assert.equal(json(item.alternative.evidence).result.structuredContent.exit_code, 0);
      }
    }
    for (const evidence of report.evidence) {
      if (evidence.includes("#")) assert.equal(reference(evidence).message.role, "assistant");
      else json(evidence);
    }
  }
  observations.push({ root, effectCase, requests: records.length, effects: history.snapshot.effects.length, result: launch.kind === "reported" ? launch.report.outcome : launch.kind });
}
process.stdout.write(JSON.stringify({ histories: histories.length, requests, exceptions, admissions, results, alternatives, observations, files: [...files].map(([path, sha256]) => ({ path, sha256 })) }, null, 2) + "\n");
