import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { z } from "zod";

test("installed Pi SDK and pi-subagents delegate a configured 8k native worker while preserving root and child denial", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-denial.mjs"]);
  const report = z.object({ root: z.string(), pi: z.literal("1.1.0"), subagents: z.literal("0.77.0"), networkCalls: z.literal(0),
    rootRefused: z.literal(true), childRefused: z.literal(true), rootCanary: z.literal(false), childCanary: z.literal(false),
    nativeResponse: z.object({ status: z.literal("completed"), ownerRunId: z.literal("fixture-owned-run"), nodeId: z.literal("native-child"), runId: z.string() }), errors: z.array(z.unknown()).length(0),
  }).parse(JSON.parse(stdout));
  assert.ok(report.root.startsWith("/tmp/legion-native-sdk-denial-"));
});
