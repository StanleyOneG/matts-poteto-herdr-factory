import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

assert.ok(process.argv[2] && process.argv[3], "Use <existing prerequisite trial root> <evidence output directory>.");
const root = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const evidence = join(root, "evidence");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const runtime = await json(join(evidence, "runtime.json"));
const launch = await json(join(evidence, "native-launch.json"));
const child = await json(join(evidence, "child-start.json"));
const status = await json(join(launch.asyncDir, "status.json"));
const processProof = await json(join(launch.asyncDir, "process-terminal.json"));
const childInput = await json(join(evidence, "child-input.json"));
const admission = await json(join(evidence, "root-admission.json"));
const journalBytes = await readFile(child.journal, "utf8");
const journal = journalBytes.trim().split("\n").map(JSON.parse);
const toolEvents = (await readFile(join(evidence, "child-tools.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(runtime.mode, "tui");
assert.equal(runtime.cwd, join(root, "repo"));
assert.equal(runtime.childMarker, null);
assert.equal(launch.runId, status.runId);
assert.equal(launch.runId, processProof.runId);
assert.equal(status.state, "complete");
assert.equal(processProof.state, "observed");
assert.ok(processProof.instances.some(instance => instance.kind === "runner" && instance.exitCode === 0 && instance.signal === null));
assert.equal(child.cwd, runtime.cwd);
assert.equal(child.childMarker, "1");
assert.equal(child.binding["pi-legion/1"].trial, root);
assert.equal(journal[0].id, child.session);
assert.equal(status.steps.length, 1);
const step = status.steps[0];
assert.equal(step.sessionFile, child.journal);
assert.equal(step.model, childInput.model);
assert.equal(step.requestedModel, childInput.model);
assert.equal(step.status, "complete");
assert.equal(launch.launchResolvedExtensions.disableAmbientExtensions, false);
assert.deepEqual(launch.launchResolvedExtensions.required, ["legion-t04-prerequisite"]);
const exactNativeInput = isDeepStrictEqual(admission.input, childInput);
const writeCall = toolEvents.find(event => event.kind === "call" && event.name === "write");
assert.ok(writeCall);
const denied = journal.find(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === writeCall.id);
assert.equal(denied?.message.isError, true);
assert.equal(denied.message.content[0].text, "T04 preparation trial has no write authority.");
await assert.rejects(access(join(root, "repo", "must-not-exist.txt")), { code: "ENOENT" });
const loads = [];
for (const event of toolEvents.filter(event => event.kind === "result" && event.toolName === "read")) {
  assert.equal(event.isError, false);
  const actual = await readFile(event.input.path, "utf8");
  const observed = event.content.filter(content => content.type === "text").map(content => content.text).join("\n");
  assert.equal(observed, actual, `The complete native read must match ${event.input.path}`);
  const entry = journal.find(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === event.toolCallId);
  assert.ok(entry);
  assert.equal(entry.message.content.filter(content => content.type === "text").map(content => content.text).join("\n"), actual);
  loads.push({ path: event.input.path, bytes: Buffer.byteLength(actual), sha256: sha256(actual), toolCall: event.toolCallId, journal: `${child.journal}#${entry.id}` });
}
assert.equal(loads.length, 4);
await mkdir(output, { recursive: true });
for (const name of ["runtime.json", "root-admission.json", "native-launch.json", "child-start.json", "child-input.json", "start-intent.json", "identity.json"]) await copyFile(join(evidence, name), join(output, name));
for (const name of ["status.json", "process-terminal.json"]) await copyFile(join(launch.asyncDir, name), join(output, name));
await copyFile(join(launch.asyncDir, "output-0.log"), join(output, "result.txt"));
for (const name of ["probe.mjs", "guard.mjs", "package-lock.json"]) await copyFile(join(root, name), join(output, name));
const summary = {
  verdict: exactNativeInput ? "PREREQUISITE_CHILD_VERIFIED_NOT_PRODUCT_ACCEPTANCE" : "NOT_VERIFIED_NATIVE_INTENT_MISMATCH",
  exactNativeInput,
  unexpectedInputKeys: Object.keys(admission.input).filter(key => !(key in childInput)),
  root, runId: launch.runId, asyncDir: launch.asyncDir,
  principal: { session: runtime.session, journal: runtime.journal, model: runtime.model },
  child: { session: child.session, journal: child.journal, journalSha256: sha256(journalBytes), index: step.processTerminal?.childIndex ?? null, model: step.model },
  fullSkillReads: loads,
  deniedWrite: { path: writeCall.input.path, toolCall: writeCall.id, journal: `${child.journal}#${denied.id}`, fileAbsent: true },
  lifecycle: { logical: status.state, runner: processProof.state, runnerInstance: processProof.runnerProcessInstanceId, childProjection: step.processTerminal },
  gaps: ["Not a managed Legion assignment or public-state child roster", "No Legatus approval exchange, exception, or implementation red/green", "No retained public-state proof while a principal settles with an active child", "No independent external permission-denial trial", "No writable-child worktree isolation or Legatus research"]
};
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
process.stdout.write(`${summary.verdict} ${join(output, "summary.json")}\n`);
assert.deepEqual(admission.input, childInput, "The native model call changed the prepared launch input. Do not waive the mismatch or retry this actor.");
