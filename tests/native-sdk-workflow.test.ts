import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { z } from "zod";

test("actual Pi1.2 public native input and persisted journal authorize scoped workflow while permission and custom completion remain native", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-workflow.mjs"]);
  const result = z.object({ root: z.string(), pi: z.literal("1.2.0"), networkCalls: z.literal(0), tasks: z.literal(1), dispatch: z.literal("applied-native"), exactInstructions: z.literal(true), appliedJournal: z.literal(true), permissionDenied: z.literal(true), customCompletion: z.literal(true), errors: z.array(z.unknown()).length(0) }).parse(JSON.parse(stdout));
  assert.ok(result.root.startsWith(join(tmpdir(), "legion-native-sdk-workflow-")));
  await rm(result.root, { recursive: true, force: true });
});
