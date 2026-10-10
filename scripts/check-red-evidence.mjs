import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";

const Declaration = z.strictObject({ scenario: z.string().min(1), assertion: z.string().min(1) });
const [mode, declarationPath, outputPath, ...command] = process.argv.slice(2);
const declarationBytes = readFileSync(declarationPath, "utf8");
const declaration = Declaration.parse(JSON.parse(declarationBytes));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (mode === "run") {
  if (!command.length) throw new Error("Supply the test executable and arguments after the output path.");
  const intent = { declaration: declarationPath, declarationSha256: hash(declarationBytes), ...declaration, command, startedAt: new Date().toISOString() };
  writeFileSync(`${outputPath}.intent.json`, JSON.stringify(intent, null, 2) + "\n", { flag: "wx" });
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(outputPath, `${result.stdout ?? ""}${result.stderr ?? ""}`, { flag: "wx" });
  writeFileSync(`${outputPath}.result.json`, JSON.stringify({ exitCode: result.status, signal: result.signal, error: result.error ? String(result.error) : null, outputSha256: hash(readFileSync(outputPath)) }, null, 2) + "\n", { flag: "wx" });
  if (result.error || result.signal || result.status !== 1) {
    process.stdout.write(JSON.stringify({ verdict: "REJECTED_RED", reason: "The run did not finish with one ordinary test failure.", chronology: "intent-recorded-before-run", exitCode: result.status, signal: result.signal }) + "\n");
    process.exit(1);
  }
} else if (mode !== "check") throw new Error("Use run or check. check classifies retained output retrospectively.");
const output = readFileSync(outputPath, "utf8");
const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)];
const rejected = /Expected applied assignment|(?:Syntax|Reference|Type)Error|ERR_MODULE|\bsetup\b|\bcleanup\b|ERR_TEST_TIMEOUT|timed? out|timeout|hookFailed|cancelledByParent|ECONN\w+|ENOENT|EACCES|Guarded local effect|transport.*(?:unavailable|failure)|error TS\d+/i;
const failure = output.slice(output.indexOf("not ok "));
const errorText = failure.match(/  error:([\s\S]*?)\n  code:/)?.[1] ?? "";
const eligible = failures.length === 1 && failures[0][1] === declaration.scenario && output.includes(`code: 'ERR_ASSERTION'`) && errorText.includes(declaration.assertion) && /operator: '(?:strictEqual|deepStrictEqual|equal|deepEqual)'/.test(output) && /^# fail 1$/m.test(output) && /^# cancelled 0$/m.test(output) && !rejected.test(output);
process.stdout.write(JSON.stringify({ verdict: eligible ? "EXPECTED_ASSERTION_RED" : "REJECTED_RED", scenario: declaration.scenario, assertion: declaration.assertion, chronology: mode === "run" ? "intent-recorded-before-run" : "retrospective-output-check", outputSha256: hash(output), limitation: "This filter rejects known nonbehavior failures. The retained assertion, scenario, and mutation still require semantic independent review." }, null, 2) + "\n");
process.exitCode = eligible ? 0 : 1;
