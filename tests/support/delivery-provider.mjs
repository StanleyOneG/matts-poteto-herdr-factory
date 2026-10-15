// Disposable operator-configured provider. No network or real tracker/review operations.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
const [directory, behavior = "normal"] = process.argv.slice(2);
const scenario = behavior.replace(/-diagnostics$/, "");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
assert.equal(request.protocol, "legion-delivery/v1");
assert.equal(request.operation, request.intent.id);
assert.equal(request.digest, request.intent.digest);
assert.ok(request.report.includes(request.digest));
const file = path.join(directory, `${request.operation}.json`);
let outcome;
if (behavior.includes("diagnostics")) process.stderr.write(`Fixture ${request.mode} diagnostic: provider receipt retained.\n`);
if (request.mode === "reconcile") {
  outcome = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).outcome : { kind: "unknown", operation: request.operation, digest: request.digest, evidence: ["No exact provider receipt available; absence is not no-effect proof."], message: "No receipt" };
} else {
  assert.equal(request.mode, "execute");
  fs.mkdirSync(directory, { recursive: true });
  outcome = scenario === "fail" ? { kind: "failed", operation: request.operation, digest: request.digest, evidence: ["Fixture rejected before creating a publication."], noEffect: true, message: "Explicit provider rejection" } : { kind: "confirmed", operation: scenario === "wrong-operation" ? randomUUID() : request.operation, digest: scenario === "mismatch" ? "0".repeat(64) : request.digest, evidence: [request.report], reference: scenario === "wrong-reference" ? "fixture:unrelated" : request.intent.kind === "publish" && request.intent.publication.kind === "ready" ? request.intent.publication.reference : `fixture:${request.operation}` };
  fs.writeFileSync(file, JSON.stringify({ request, outcome }), { flag: "wx" });
  if (scenario === "lost") process.exit(7);
}
process.stdout.write(scenario === "malformed" && request.mode === "execute" ? "not a JSON receipt" : JSON.stringify({ protocol: "legion-delivery/v1", outcome }));
if (scenario === "trailing") process.stdout.write("\nextra diagnostic on stdout");
if (scenario === "nonzero") process.exitCode = 9;
if (scenario === "signal") process.kill(process.pid, "SIGTERM");
