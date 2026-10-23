import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Approved public launch/receipt/reconciliation seam, backed by an actual fresh Pi SDK session.
async function exercise(scenario: "fresh" | "late" | "error" | "lost") {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-matt-initialization.mjs", scenario]);
  const result = z.object({ root: z.string(), pi: z.literal("1.3.0"), networkCalls: z.literal(0), bootstrapRequests: z.literal(1), scenario: z.enum(["fresh", "late", "error", "lost"]), persisted: z.literal(true), sameWorker: z.literal(true), noReplay: z.literal(true) }).parse(JSON.parse(stdout));
  assert.equal(result.scenario, scenario);
  assert.ok(result.root.startsWith(join(tmpdir(), "mi-")));
  await rm(result.root, { recursive: true, force: true });
}

test("fresh Matt worker durably initializes on the same native Pi session and reconciles the same receipt without replay", async () => {
  await exercise("fresh");
});

test("late Matt bootstrap outcome reconciles its retained intent without a second native turn", async () => {
  await exercise("late");
});

test("failed Matt bootstrap withholds initialization and never resends its uncertain native turn", async () => {
  await exercise("error");
});

test("lost Matt bootstrap response reconciles a durable applied receipt on the same worker without replay", async () => {
  await exercise("lost");
});
