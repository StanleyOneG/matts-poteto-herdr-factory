import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
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

test("the known Slice 06 setup failure is not classified as delivery behavior evidence", () => {
  const result = spawnSync(process.execPath, [checker, "check", "docs/verification/t04-owned-centuriones/checks/16-delivery-mutation-declaration.json", "docs/verification/t04-owned-centuriones/checks/06-delivery-red.txt"], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /REJECTED_RED/);
  assert.match(result.stdout, /retrospective-output-check/);
});
