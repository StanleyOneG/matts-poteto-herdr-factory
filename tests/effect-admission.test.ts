import { appendFileSync } from "node:fs";
import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

async function exercise(effectCase: string) {
  const result = await exerciseRace("admission", { effectCase });
  if (process.env.T04_EFFECT_AUDIT) appendFileSync(process.env.T04_EFFECT_AUDIT, JSON.stringify({ effectCase, root: result.root }) + "\n");
}

test("managed current approval and complete native proof admit one exact root write", async () => {
  await exercise("write");
});

test("managed unknown native effect holds further effects without blind retry", async () => {
  await exercise("unknown");
});

for (const effectCase of ["mutate", "deny", "mutate-deny", "throw", "mutate-throw", "resources", "disconnected", "off", "stale", "off-before", "incarnation", "selection", "decline", "settings", "ownership", "native-tools"]) {
  test(`managed effect admission preserves ${effectCase} ordering and evidence`, async () => {
    await exercise(effectCase);
  });
}

test("managed lost admission response holds fresh effects without reissuing work", async () => {
  await exercise("lost-response");
});

for (const resource of ["matt", "poteto"]) {
  for (const change of ["content", "target"]) {
    test(`managed controller-observed ${resource} ${change} invalidation survives restoration`, async () => {
      await exercise(`controller-${resource}-${change}`);
    });
  }
}

test("managed admission accepts the installed native legacy edit preparation", async () => {
  await exercise("native-legacy");
});

for (const effectCase of ["native-string", "native-object", "native-legacy-deny", "native-legacy-mutate", "native-legacy-early-mutate"]) {
  test(`managed native preparation preserves ${effectCase} behavior`, async () => {
    await exercise(effectCase);
  });
}

test("managed admission refuses an old seam after an approved task revision and scope amendment", async () => {
  await exercise("task-amendment");
});
