import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { z } from "zod";
for (const scenario of ["fresh", "task", "initialized"]) {
  test(`lock startup census ${scenario} has one public owner and rejected contender every round`, { timeout: 30000 }, () => {
    const output = execFileSync(process.execPath, ["scripts/census-lock-startup.mjs", "500", scenario], { encoding: "utf8", timeout: 25000 });
    const result = z.object({ rounds: z.number(), winners: z.tuple([z.number(), z.number()]), rejected: z.tuple([z.number(), z.number()]), zeroOwners: z.number(), dualOwners: z.number() }).parse(JSON.parse(output));
    assert.equal(result.rounds, 500);
    assert.equal(result.winners[0] + result.winners[1], 500);
    assert.equal(result.rejected[0] + result.rejected[1], 500);
    assert.equal(result.zeroOwners, 0);
    assert.equal(result.dualOwners, 0);
  });
}
