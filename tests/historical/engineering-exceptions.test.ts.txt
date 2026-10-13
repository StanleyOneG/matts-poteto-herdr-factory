import { appendFileSync } from "node:fs";
import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

async function exercise(effectCase: string) {
  const result = await exerciseRace("admission", { effectCase });
  if (process.env.T04_EXCEPTION_AUDIT) appendFileSync(process.env.T04_EXCEPTION_AUDIT, JSON.stringify({ effectCase, root: result.root }) + "\n");
}

test("managed successive proposals require a fresh separate decision before work resumes", async () => {
  await exercise("successive");
});

test("managed exception binds the omitted test and alternative command to the current approved behavior", async () => {
  await exercise("exception");
});

test("managed exception final result retains native alternative evidence independently of model claims", async () => {
  await exercise("exception-result");
});

test("managed exception decision presents the actual approved seam to its separate Legatus", async () => {
  await exercise("exception-context");
});

for (const outcome of ["missing", "failed", "after-write", "deny", "mutate"]) {
  test(`managed exception result refuses ${outcome} alternative verification`, async () => {
    await exercise(`exception-result-${outcome}`);
  });
}

for (const decision of ["decline", "escalate", "off", "stale"]) {
  test(`managed exception preserves ${decision} authority refusal`, async () => {
    await exercise(`exception-${decision}`);
  });
}

test("managed declined exception can be revised without reusing its declined decision", async () => {
  await exercise("exception-revise");
});

test("managed successor seam retires exception authority without dropping its final evidence", async () => {
  await exercise("exception-successor");
});

test("managed successor delivery waits for its own continuation before effects or final reporting", async () => {
  await exercise("successive-busy");
});

test("managed successor seam cannot erase an unverified earlier exception", async () => {
  await exercise("exception-successor-missing");
});
