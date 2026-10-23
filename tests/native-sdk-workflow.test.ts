import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { z } from "zod";

test("pi-subagents0.79.1 dynamic activation defers wait/supervisor and co-selects them with delegation without a child", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs", "activation"]);
  const result = z.object({ root: z.string(), pi: z.literal("1.3.0"), networkCalls: z.literal(0), deferred: z.literal(true), coSelected: z.literal(true), noTask: z.literal(true), errors: z.array(z.unknown()).length(0) }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  await rm(result.root, { recursive: true, force: true });
});

test("actual Pi1.3 public native input and persisted journal authorize scoped workflow while permission and custom completion remain native", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs"]);
  const result = z.object({ root: z.string(), pi: z.literal("1.3.0"), networkCalls: z.literal(0), tasks: z.literal(1), dispatch: z.literal("applied-native"), exactInstructions: z.literal(true), appliedJournal: z.literal(true), permissionDenied: z.literal(true), customCompletion: z.literal(true), errors: z.array(z.unknown()).length(0) }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  await rm(result.root, { recursive: true, force: true });
});

test("actual Pi native workflow requires explicit workspace authorization after deferred reserve and rejects a foreign stage ID", async t => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs", "workspace"]);
  const result = z.object({ root: z.string(), pi: z.literal("1.3.0"), networkCalls: z.literal(0), prematureDenied: z.literal(true), wrongIdDenied: z.literal(true), workspace: z.literal("ready"), nestedBash: z.number().positive(), errors: z.array(z.unknown()).length(0) }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  t.diagnostic(JSON.stringify(result));
  await rm(result.root, { recursive: true, force: true });
});

test("deferred reserve receipt explains the native intermediate workspace request without dropping host guidance", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs", "deferred-guidance"]);
  const result = z.object({ root: z.string() }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  await rm(result.root, { recursive: true, force: true });
});

test("native workflow instructions distinguish deferred workspace intent from explicit stage authorization and execution", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs", "guidance"]);
  const result = z.object({ root: z.string() }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  await rm(result.root, { recursive: true, force: true });
});
