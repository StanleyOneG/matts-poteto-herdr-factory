import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const checker = resolve("scripts/check-red-evidence.mjs");

test("red evidence records the declared assertion before execution and rejects nonbehavior failures", () => {
  const root = mkdtempSync(join(tmpdir(), "legion-red-evidence-"));
  const declaration = join(root, "declaration.json"), scenario = join(root, "scenario.mjs"), output = join(root, "red.txt");
  writeFileSync(declaration, JSON.stringify({ scenario: "expected behavior", assertion: "BEHAVIOR exactly one retained continuation" }));
  writeFileSync(scenario, `import {test} from "node:test"; import assert from "node:assert/strict"; import {existsSync} from "node:fs"; test("expected behavior", () => { assert.equal(existsSync(${JSON.stringify(`${output}.intent.json`)}), true, "Setup requires the declaration before execution"); assert.equal(3, 1, "BEHAVIOR exactly one retained continuation"); });`);
  const executed = spawnSync(process.execPath, [checker, "run", declaration, output, process.execPath, "--test", scenario], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(executed.status, 0, executed.stdout + executed.stderr);
  assert.match(executed.stdout, /EXPECTED_ASSERTION_RED/);
  const intent = JSON.parse(readFileSync(`${output}.intent.json`, "utf8"));
  assert.equal(intent.assertion, "BEHAVIOR exactly one retained continuation");
  assert.deepEqual(intent.command, [process.execPath, "--test", scenario]);
  const original = readFileSync(output, "utf8");
  for (const defect of ["setup failed", "cleanup failed", "Fixture timeout", "ERR_MODULE_NOT_FOUND", "SyntaxError", "TypeError", "error TS2307", "ECONNREFUSED", "transport unavailable"]) {
    const changed = join(root, `failure-${defect.replaceAll(/\W/g, "_")}.txt`);
    writeFileSync(changed, original.replace("  error: |-", `  error: |-\n    ${defect}`));
    const result = spawnSync(process.execPath, [checker, "check", declaration, changed], { encoding: "utf8" });
    assert.equal(result.status, 1, defect);
    assert.match(result.stdout, /REJECTED_RED/, defect);
  }
  const unrelated = join(root, "unrelated.txt");
  writeFileSync(unrelated, '# BEHAVIOR exactly one retained continuation\n' + original.replaceAll("BEHAVIOR exactly one retained continuation", "Different assertion"));
  assert.equal(spawnSync(process.execPath, [checker, "check", declaration, unrelated]).status, 1);
});

test("retrospective delivery evidence rejects a setup failure even when the declared assertion matches", (t) => {
  const root = mkdtempSync(join(tmpdir(), "legion-delivery-red-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const declaration = join(root, "declaration.json"), output = join(root, "red.txt");
  writeFileSync(declaration, JSON.stringify({ scenario: "delivery retains exactly one report", assertion: "BEHAVIOR exactly one retained delivery report" }));
  const setupFailure = `TAP version 13
# Subtest: delivery retains exactly one report
not ok 1 - delivery retains exactly one report
  ---
  duration_ms: 1
  failureType: 'testCodeFailure'
  error: 'setup failed: BEHAVIOR exactly one retained delivery report'
  code: 'ERR_ASSERTION'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
`;
  writeFileSync(output, setupFailure);
  const result = spawnSync(process.execPath, [checker, "check", declaration, output], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /REJECTED_RED/);
  assert.match(result.stdout, /retrospective-output-check/);
  assert.equal(result.stderr, "");

  writeFileSync(output, setupFailure.replace("setup failed: ", ""));
  const behavioral = spawnSync(process.execPath, [checker, "check", declaration, output], { encoding: "utf8" });
  assert.equal(behavioral.status, 0, behavioral.stdout + behavioral.stderr);
  assert.match(behavioral.stdout, /EXPECTED_ASSERTION_RED/);
  assert.match(behavioral.stdout, /retrospective-output-check/);
});
