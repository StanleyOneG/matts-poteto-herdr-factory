import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
const Outcome = z.object({
  kind: z.literal("result"),
  result: z.object({ kind: z.string(), code: z.string().optional(), message: z.string().optional(), receipt: z.object({ legatus: z.string(), requestKey: z.string() }).optional() }),
  state: z.object({ mode: z.enum(["active", "inactive"]), snapshot: z.object({ id: z.string(), submissions: z.array(z.object({ text: z.string() })), receipts: z.array(z.object({ result: z.object({ receipt: z.object({ requestKey: z.string() }) }) })) }).nullable() }),
});
export async function census(rounds = 100, scenario = "fresh") {
  const root = await mkdtemp(join(tmpdir(), "legion-lock-census-"));
  const peers = [0, 1].map(() => {
    const child = fork(resolve("tests/lock-startup-worker.ts"), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    return { child, ready: once(child, "message").then(([raw]) => z.object({ kind: z.literal("ready") }).parse(raw)) };
  });
  const records = [];
  const winners = [0, 0];
  const rejected = [0, 0];
  let initializedRoot;
  let initializedId;
  try {
    await Promise.all(peers.map(p => p.ready));
    for (let round = 0; round < rounds; round++) {
      const storage = initializedRoot ?? await mkdtemp(join(root, "round-"));
      const at = (process.hrtime.bigint() + 2000000n).toString();
      const replies = peers.map((p, actor) => {
        const reply = once(p.child, "message").then(([raw]) => z.object({ kind: z.literal("result"), result: Outcome.shape.result }).parse(raw));
        p.child.send({ kind: "acquire", root: storage, context: "/census/repo", session: "census-session", text: scenario === "task" ? "  Exact census task\n" : "on", key: `round-${round}-actor-${actor}`, at });
        return reply;
      });
      const results = await Promise.all(replies);
      const observations = await Promise.all(peers.map(p => {
        const reply = once(p.child, "message").then(([raw]) => z.object({ kind: z.literal("state"), state: Outcome.shape.state }).parse(raw));
        p.child.send({ kind: "observe" });
        return reply;
      }));
      const outcomes = results.map((r, i) => ({ ...r, state: observations[i].state }));
      outcomes.forEach((outcome, actor) => {
        if (outcome.state.mode === "active") winners[actor]++;
        if (outcome.result.kind === "rejected") rejected[actor]++;
      });
      const count = outcomes.filter(o => o.state.mode === "active").length;
      records.push({ round, storage, owners: count, outcomes: outcomes.map(o => ({
        result: o.result,
        state: {
          mode: o.state.mode,
          snapshot: o.state.snapshot && {
            id: o.state.snapshot.id,
            submissions: o.state.snapshot.submissions,
            receiptCount: o.state.snapshot.receipts.length,
            lastReceipt: o.state.snapshot.receipts.at(-1),
          },
        },
      })) });
      if (count !== 1) await writeFile(join(root, `failure-${round}.json`), JSON.stringify(records.at(-1), null, 2));
      if (count === 1) {
        const win = outcomes.find(o => o.state.mode === "active");
        assert.ok(win?.state.snapshot);
        assert.equal(win.result.kind, scenario === "task" ? "saved" : "applied");
        assert.equal(win.result.receipt?.legatus, win.state.snapshot.id);
        const lose = outcomes.find(o => o.state.mode === "inactive");
        assert.equal(lose?.result.kind, "rejected");
        assert.equal(lose.result.receipt, undefined);
        if (scenario === "task") {
          assert.equal(win.state.snapshot.submissions.length, 1);
          assert.equal(win.state.snapshot.submissions[0].text, "  Exact census task\n");
          assert.equal(win.state.snapshot.receipts.length, 1);
        }
        if (scenario === "initialized") {
          if (initializedId) assert.equal(win.state.snapshot.id, initializedId);
          initializedId = win.state.snapshot.id;
          initializedRoot = storage;
        }
      }
      await Promise.all(peers.map(p => {
        const released = once(p.child, "message").then(([raw]) => z.object({ kind: z.literal("released") }).parse(raw));
        p.child.send({ kind: "release" });
        return released;
      }));
    }
  } finally {
    await Promise.all(peers.map(async p => {
      if (p.child.exitCode !== null || p.child.signalCode !== null) return;
      const exit = once(p.child, "exit"); p.child.kill("SIGKILL"); await exit;
    }));
  }
  return { root, scenario, rounds, winners, rejected, zeroOwners: records.filter(r => r.owners === 0).length, dualOwners: records.filter(r => r.owners > 1).length, records };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const result = await census(Number(process.argv[2] ?? 100), process.argv[3] ?? "fresh");
  await writeFile(process.argv[4] ?? join(result.root, "census.json"), JSON.stringify(result, null, 2) + "\n");
  const { records, ...summary } = result;
  console.log(JSON.stringify(summary));
  assert.equal(result.zeroOwners, 0, "Every simultaneous activation must leave one owner, not two rejected contenders");
  assert.equal(result.dualOwners, 0, "No simultaneous activation may leave competing owners");
}
