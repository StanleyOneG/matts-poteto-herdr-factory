import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Legion } from "../src/intake.js";
const evidence = {
  origin: "emperor",
  transport: "rpc",
  session: "owner",
  generation: null,
  presented: [],
};
for (const phase of ["before-commit", "after-commit"]) {
  test(
    `real process death ${phase} preserves receipts and ownership without read-only recovery`,
    { timeout: 20000 },
    async () => {
      const storagePath = join(
        await mkdtemp(join(tmpdir(), "legion-crash-")),
        "initially-absent",
      );
      const options = {
        storagePath,
        context: "/test/repo",
        session: "owner",
        preflight: async () => [],
      };
      const owner = new Legion(options);
      assert.equal((await owner.state()).mode, "inactive");
      assert.equal(
        (
          await owner.command({
            text: "Initial text",
            requestKey: "initial",
            evidence,
          })
        ).kind,
        "saved",
      );
      const id = (await owner.state()).snapshot?.id;
      assert.ok(id);
      await owner.command({ text: "off", requestKey: "off", evidence });
      const child = fork(
        resolve("tests/owner-worker.ts"),
        [storagePath, options.context, id, phase],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      let stderr = "";
      child.stderr?.on("data", (b) => {
        stderr += b;
      });
      try {
        const [ready] = await once(child, "message");
        assert.equal(ready.state.mode, "active", stderr);
        const competing = await owner.command({
          text: `resume ${id}`,
          requestKey: "competing",
          evidence,
        });
        assert.equal(competing.kind, "rejected");
        const liveRead = await owner.state();
        assert.equal(liveRead.snapshot?.submissions[0]?.text, "Initial text");
        const exit = once(child, "exit");
        child.send("crash");
        const [code, signal] = await exit;
        assert.equal(code, null);
        assert.equal(signal, "SIGKILL");
        const before = new Map(
          await Promise.all(
            (await readdir(storagePath)).map(
              async (f) => [f, await readFile(join(storagePath, f))] as const,
            ),
          ),
        );
        const observed = await new Legion(options).state();
        const after = new Map(
          await Promise.all(
            (await readdir(storagePath)).map(
              async (f) => [f, await readFile(join(storagePath, f))] as const,
            ),
          ),
        );
        assert.deepEqual(
          after,
          before,
          "Status preserves database and hot journal bytes",
        );
        assert.equal(observed.mode, "inactive");
        if (phase === "before-commit")
          assert.ok(
            observed.unavailable?.includes("readonly") ||
              observed.snapshot?.submissions.length === 1,
          );
        else
          assert.equal(
            observed.snapshot?.submissions[1]?.text,
            "Crash-safe original".repeat(180000),
          );
        const resumed = new Legion(options);
        assert.equal(
          (
            await resumed.command({
              text: `resume ${id}`,
              requestKey: "recover",
              evidence,
            })
          ).kind,
          "applied",
        );
        const reconciled = await resumed.state();
        assert.equal(
          reconciled.snapshot?.submissions.length,
          phase === "before-commit" ? 1 : 2,
        );
        assert.equal(reconciled.snapshot?.id, id);
        await resumed.command({
          text: "off",
          requestKey: "recovered-off",
          evidence,
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    },
  );
}
