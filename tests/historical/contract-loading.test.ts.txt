import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("managed discovery refuses a missing Matt teaching resource in the assigned worktree", async () => {
  const result = await exerciseRace("contract", { resourceCase: "missing" });
  assert.equal(result.launch.kind, "held", "BEHAVIOR assigned worktree missing matt-teach withholds assignment");
  assert.match(result.launch.message, /matt-teach/);
  assert.ok(result.launch.message.includes(result.cwd));
});

test("managed discovery rejects conflicting and incomplete selected Matt resources without substituting pstack", async () => {
  for (const resourceCase of ["conflicting", "reference-missing"]) {
    const result = await exerciseRace("contract", { resourceCase });
    assert.equal(result.launch.kind, "held", "BEHAVIOR ambiguous conflicting or incomplete Matt resource withholds assignment");
    if (result.launch.kind !== "held") throw new Error("Expected held launch");
    assert.ok(result.launch.message.includes(result.cwd));
    assert.match(result.launch.message, /matt-tdd/);
  }
  const available = await exerciseRace("contract", { resourceCase: "alias" });
  assert.equal(available.launch.kind, "assigned");
});

test("managed contract records complete native Matt reads and poteto expansion without effect authority", async () => {
  const result = await exerciseRace("contract", { resourceCase: "available", loadCase: "complete" });
  assert.equal(result.launch.kind, "reported");
  if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(result.launch.report.contract?.kind, "loaded", "BEHAVIOR complete native contract proof is visible in the public worker report");
});

test("managed contract refuses incomplete failed truncated and changed native loads", async () => {
  for (const loadCase of ["partial", "failed", "read-error", "truncated", "changed", "changed-during-read", "gap", "changed-chunks"]) {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase });
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(result.launch.report.contract?.kind, "loading", `Native ${loadCase} does not prove complete loading`);
    assert.equal(result.launch.report.contract?.resources.find(resource => resource.name === "matt-teach")?.load.kind, "not-required");
  }
});

test("managed contract accepts complete native chunk coverage of unchanged bytes", async () => {
  const result = await exerciseRace("contract", { resourceCase: "available", loadCase: "chunks" });
  assert.equal(result.launch.kind, "reported");
  if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(result.launch.report.contract?.kind, "loaded", "BEHAVIOR complete native chunk coverage establishes loading");
  const matt = result.launch.report.contract?.resources.find(resource => resource.name === "matt-tdd");
  assert.equal(matt?.load.kind, "complete");
  if (matt?.load.kind === "complete") assert.equal(matt.load.evidence.length, 2);
});

test("managed contract proof remains observable while the principal waits for seam approval", async () => {
  const result = await exerciseRace("contract", { resourceCase: "available", loadCase: "waiting" });
  assert.equal(result.launch.kind, "assigned");
  if (result.launch.kind !== "assigned") throw new Error("Expected waiting assigned worker");
  assert.equal(result.launch.worker.resources.contract?.kind, "loaded", "BEHAVIOR waiting for seam approval preserves observable complete native load proof");
});

test("managed discovery refuses resources that cannot retain exact UTF-8 bytes", async () => {
  const result = await exerciseRace("contract", { resourceCase: "invalid-utf8" });
  assert.equal(result.launch.kind, "held", "BEHAVIOR invalid UTF-8 cannot be normalized into contract byte evidence");
  if (result.launch.kind !== "held") throw new Error("Expected held launch");
  assert.match(result.launch.message, /UTF-8/);
});

test("managed native selection accepts discarded and disabled same-name copies", async () => {
  for (const resourceCase of ["shadow", "disabled"]) {
    const result = await exerciseRace("contract", { resourceCase });
    assert.equal(result.launch.kind, "assigned", "BEHAVIOR native selected resources remain usable with discarded or disabled shadows");
    if (result.launch.kind !== "assigned") throw new Error("Expected assigned worker");
    const selected = result.launch.worker.resources.contract?.resources.find(resource => resource.name === "matt-tdd");
    assert.equal(selected?.path, `${result.cwd}/.agents/skills/matt-tdd/SKILL.md`);
    const loaded = await exerciseRace("contract", { resourceCase, loadCase: "complete" });
    assert.equal(loaded.launch.kind, "reported");
    if (loaded.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(loaded.launch.report.contract?.verification.kind, "verified");
    assert.deepEqual(loaded.launch.worker.resources.skills.filter(resource => ["matt-tdd", "matt-teach", "tdd", "teach"].includes(resource.name)).map(resource => resource.name).sort(), ["matt-tdd", "matt-teach", "tdd", "teach"]);
  }
});

test("managed native reads accept structurally equivalent reordered arguments", async () => {
  const result = await exerciseRace("contract", { resourceCase: "available", loadCase: "reordered" });
  assert.equal(result.launch.kind, "reported");
  if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(result.launch.report.contract?.kind, "loaded", "BEHAVIOR reordered native read keys preserve complete loading proof");
  assert.equal(result.launch.report.contract?.verification.kind, "verified");
});

test("managed native optional-null and omitted read arguments prove loading without mutating original evidence", async () => {
  for (const loadCase of ["optional-nulls", "complete"]) {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase });
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(result.launch.report.contract?.verification.kind, "verified", "Supported native optional normalization must retain complete resource loading");
    if (loadCase === "optional-nulls") {
      const retained = await readFile(join(result.root, "retained-journal-before.jsonl"), "utf8");
      assert.ok((await readFile(join(result.root, "worker.jsonl"), "utf8")).startsWith(retained), "Normalization cannot rewrite any retained journal bytes");
      const calls = JSON.parse(await readFile(join(result.root, "retained-read-originals.json"), "utf8"));
      assert.equal(calls.length, 3);
      for (const call of calls) assert.deepEqual(call.arguments, { path: call.arguments.path, offset: null, limit: null });
    }
  }
});

for (const changed of ["path", "range"]) test(`managed native read normalization refuses changed effective ${changed}`, async () => {
  const result = await exerciseRace("contract", { resourceCase: "available", loadCase: `optional-nulls-changed-${changed}` });
  assert.equal(result.launch.kind, "reported");
  if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(result.launch.report.contract?.verification.kind, "pending", "Only supported normalization, not changed effective inputs, can join read provenance");
  assert.equal(result.launch.report.contract?.resources.find(resource => resource.name === "matt-tdd")?.load.kind, "pending");
  const retained = await readFile(join(result.root, "retained-journal-before.jsonl"), "utf8");
  assert.ok((await readFile(join(result.root, "worker.jsonl"), "utf8")).startsWith(retained));
});

test("managed native alternate paths diagnose proof limits and allow an absolute reread", async () => {
  for (const variant of ["at", "tilde", "normalized"]) {
    const partial = await exerciseRace("contract", { resourceCase: "available", loadCase: `path-${variant}` });
    assert.equal(partial.launch.kind, "reported");
    if (partial.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(partial.launch.report.contract?.diagnostics.some(diagnostic => diagnostic.name === "Native read proof" && diagnostic.message.includes("absolute") && diagnostic.message.includes(partial.cwd)), true, "BEHAVIOR successful native alternate paths request an actionable absolute-path reread");
    assert.equal(partial.launch.report.contract?.kind, "loading");
    const complete = await exerciseRace("contract", { resourceCase: "available", loadCase: `path-${variant}-reread` });
    assert.equal(complete.launch.kind, "reported");
    if (complete.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(complete.launch.report.contract?.verification.kind, "verified");
  }
});

test("managed native truncated reads follow continuation without counting incomplete bytes", async () => {
  for (const loadCase of ["truncated-continuation", "truncated-bytes"]) {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase });
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(result.launch.report.contract?.verification.kind, "verified", "BEHAVIOR native prescribed continuation completes exact delivered-line coverage");
  }
  const incomplete = await exerciseRace("contract", { resourceCase: "available", loadCase: "incomplete-bytes" });
  assert.equal(incomplete.launch.kind, "reported");
  if (incomplete.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(incomplete.launch.report.contract?.kind, "loading");
  assert.equal(incomplete.launch.report.contract?.verification.kind, "pending");
});

test("managed observed selection changes retire earlier native proof", async () => {
  for (const loadCase of ["selection-returned", "selection-changed"]) {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase });
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(result.launch.report.contract?.verification.kind, "pending", "BEHAVIOR observed native selection changes invalidate previous read proof");
  }
  const reread = await exerciseRace("contract", { resourceCase: "available", loadCase: "selection-reread" });
  assert.equal(reread.launch.kind, "reported");
  if (reread.launch.kind !== "reported") throw new Error("Expected public worker report");
  assert.equal(reread.launch.report.contract?.verification.kind, "verified");
});

test("managed required skill invocations reject active extension and prompt interception", async () => {
  for (const source of ["extension", "prompt"]) {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase: `intercept-${source}` });
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    const contract = result.launch.report.contract;
    assert.equal(contract?.verification.kind, "blocked", "BEHAVIOR active required invocation interception blocks selected-contract verification");
    assert.equal(contract?.kind, "unavailable");
    assert.equal(contract?.diagnostics.some(item => item.message.includes(`intercept-${source}.ts`)), true);
  }
});

test("managed native selected missing or wrong-identity winners never substitute a valid shadow", async () => {
  for (const resourceCase of ["selected-deleted", "selected-wrong-identity"]) {
    const result = await exerciseRace("contract", { resourceCase });
    assert.equal(result.launch.kind, "held");
    if (result.launch.kind !== "held") throw new Error("Expected held launch");
    assert.ok(result.launch.message.includes(`${result.cwd}/.agents/skills/matt-tdd/SKILL.md`));
  }
});

for (const resource of ["matt", "poteto"]) for (const failure of ["changed", "unavailable"]) {
  test(`managed snapshot failure retires ${resource} proof after ${failure} bytes are restored`, async () => {
    const result = await exerciseRace("contract", { resourceCase: "available", loadCase: `snapshot-${resource}-${failure}` });
    const observations = result.proofInspections;
    if (!observations) throw new Error("Expected public worker inspections");
    assert.equal(observations.before.verification.kind, "verified");
    const originalPoteto = observations.before.resources.find(item => item.name === "poteto-mode");
    assert.equal(originalPoteto?.load.kind, "complete");
    if (originalPoteto?.load.kind !== "complete") throw new Error("Expected native poteto proof");
    assert.equal(originalPoteto.load.evidence[0]?.kind, "native-expansion");
    assert.equal(observations.failed.kind, "unavailable");
    assert.equal(observations.restored.verification.kind, "pending", "BEHAVIOR observed snapshot failure prevents restored bytes from reviving retired native proof");
    assert.equal(observations.failed.verification.kind, "blocked");
    for (const snapshot of [observations.failed, observations.restored]) {
      assert.deepEqual(snapshot.resources.filter(item => item.name !== "matt-teach").map(item => item.load.kind), ["pending", "pending", "pending", "pending"]);
    }
    assert.equal(observations.afterMatt.verification.kind, "pending");
    assert.equal(observations.afterMatt.resources.find(item => item.name === "poteto-mode")?.load.kind, "pending");
    assert.equal(observations.recovered.verification.kind, "verified");
    const recoveredPoteto = observations.recovered.resources.find(item => item.name === "poteto-mode");
    if (recoveredPoteto?.load.kind !== "complete") throw new Error("Expected fresh native poteto proof");
    assert.equal(recoveredPoteto.load.evidence[0]?.kind, "read");
    assert.equal(result.launch.kind, "reported");
    if (result.launch.kind !== "reported") throw new Error("Expected public worker report");
    assert.equal(result.launch.report.contract?.verification.kind, "verified");
  });
}
