import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { z } from "zod";

test("current Pi SDK user/custom startup and pi-subagents preserve root and configured 8k child denial", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-denial.mjs"]);
  const report = z.object({ root: z.string(), pi: z.literal("1.2.0"), subagents: z.literal("0.78.0"), networkCalls: z.literal(0),
    userStartupBusy: z.literal(true), customStartupBusy: z.literal(true),
    rootRefused: z.literal(true), childRefused: z.literal(true), rootCanary: z.literal(false), childCanary: z.literal(false),
    nativeResponse: z.object({ status: z.literal("completed"), ownerRunId: z.literal("fixture-owned-run"), nodeId: z.literal("native-child"), runId: z.string() }), errors: z.array(z.unknown()).length(0),
  }).parse(JSON.parse(stdout));
  assert.ok(report.root.startsWith(join(tmpdir(), "legion-native-sdk-denial-")));
});
