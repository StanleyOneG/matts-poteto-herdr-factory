import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Legion } from "../src/intake.js";

const View = z.object({ mode: z.enum(["active", "inactive", "stopping"]), unavailable: z.string().nullable(), snapshot: z.object({ id: z.string() }).nullable() });
const Release = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("released") }),
  z.object({ kind: z.literal("unsettled"), result: z.object({ kind: z.literal("observed"), view: View }) }),
]);

test("lock startup worker retains unsettled off ownership until explicit inactive release", async () => {
  const root = await mkdtemp(join(tmpdir(), "legion-lock-release-"));
  const child = fork(resolve("tests/lock-startup-worker.ts"), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const request = async (input: object) => {
    const reply = once(child, "message");
    child.send(input);
    const [raw] = await reply;
    return raw;
  };
  let reader: DatabaseSync | undefined;
  const session = "census-session", context = "/census/repo";
  const acquire = { kind: "acquire", root, context, session, text: "on", key: "release-owner", at: process.hrtime.bigint().toString() };
  try {
    const [ready] = await once(child, "message");
    z.object({ kind: z.literal("ready") }).parse(ready);
    const acquired = z.object({ kind: z.literal("result"), result: z.object({ kind: z.literal("applied") }) }).parse(await request(acquire));
    assert.equal(acquired.result.kind, "applied");
    const active = z.object({ kind: z.literal("state"), state: View }).parse(await request({ kind: "observe" }));
    assert.equal(active.state.mode, "active");
    assert.ok(active.state.snapshot);
    // A real external reader prevents the shutdown writer's COMMIT, not the public off request.
    reader = new DatabaseSync(join(root, `v1.${active.state.snapshot.id}.sqlite`));
    reader.exec("BEGIN; SELECT name FROM sqlite_master");
    const stopped = Release.parse(await request({ kind: "release" }));
    assert.equal(stopped.kind, "unsettled", "An off response is not proof of released ownership");
    if (stopped.kind !== "unsettled") assert.fail("Expected unsettled shutdown evidence");
    assert.equal(stopped.result.view.mode, "stopping");
    assert.match(stopped.result.view.unavailable ?? "", /database is locked/);
    const retained = z.object({ kind: z.literal("state"), state: View }).parse(await request({ kind: "observe" }));
    assert.equal(retained.state.mode, "stopping");
    assert.equal(retained.state.snapshot?.id, active.state.snapshot.id);
    const refused = Release.parse(await request({ ...acquire, key: "premature-replacement" }));
    assert.equal(refused.kind, "unsettled", "Acquire must not discard the unsettled fixture owner");
    const replacement = new Legion({ storagePath: root, context, session, preflight: async () => [] });
    const evidence = { origin: "emperor", transport: "rpc", session, generation: null, presented: [] };
    const rejected = await replacement.command({ text: "on", requestKey: "blocked-replacement", evidence });
    assert.equal(rejected.kind, "rejected", "Unsettled off must retain exclusive ownership");
    reader.close(); reader = undefined;
    assert.equal(Release.parse(await request({ kind: "release" })).kind, "released");
    const acquiredAfterRelease = await replacement.command({ text: "on", requestKey: "settled-replacement", evidence });
    try {
      assert.equal(acquiredAfterRelease.kind, "applied", "Explicit inactive off releases ownership");
    } finally {
      const off = await replacement.command({ text: "off", requestKey: "replacement-off", evidence });
      if (off.kind !== "observed") assert.fail("Expected public off state");
      assert.equal(off.view.mode, "inactive");
      assert.equal(off.view.unavailable, null);
    }
  } finally {
    reader?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
    }
  }
});
for (const scenario of ["fresh", "task", "initialized"]) {
  // Keep all 500 public-ownership rounds on policy-required disk-backed temporary storage.
  test(`lock startup census ${scenario} has one public owner and rejected contender every round`, { timeout: 80000 }, () => {
    const output = execFileSync(process.execPath, ["scripts/census-lock-startup.mjs", "500", scenario], { encoding: "utf8", timeout: 75000 });
    const result = z.object({ rounds: z.number(), winners: z.tuple([z.number(), z.number()]), rejected: z.tuple([z.number(), z.number()]), zeroOwners: z.number(), dualOwners: z.number() }).parse(JSON.parse(output));
    assert.equal(result.rounds, 500);
    assert.equal(result.winners[0] + result.winners[1], 500);
    assert.equal(result.rejected[0] + result.rejected[1], 500);
    assert.equal(result.zeroOwners, 0);
    assert.equal(result.dualOwners, 0);
  });
}
