import { test } from "node:test";
import { exerciseRace } from "./support/composed-transport.mjs";

test("composed intake yields to an engineering stage allocated across its awaited state read", async () => {
  await exerciseRace("engineering");
});

test("composed workspace command yields to engineering allocated during its awaited command", async () => {
  await exerciseRace("workspace");
});

test("composed intake retains pending input instead of injecting another dispatch", async () => {
  await exerciseRace("pending");
});

test("composed engineering input retains queued messages arriving during authentication", async () => {
  await exerciseRace("progress", { stage: "engineering", outcome: "pending" });
});

test("composed workspace input retains queued messages arriving during admission", async () => {
  await exerciseRace("progress", { stage: "workspace", outcome: "pending" });
});

test("composed consumed engineering dispatch progresses through actual queued input", async () => {
  await exerciseRace("progress", { stage: "engineering", outcome: "pending" });
});

test("composed consumed workspace dispatch progresses through actual queued input", async () => {
  await exerciseRace("progress", { stage: "workspace", outcome: "pending" });
});

test("composed unavailable engineering authentication has explicit progress recovery", async () => {
  await exerciseRace("progress", { stage: "engineering", outcome: "auth-unavailable" });
});

test("composed uncertain intake send stays held across explicit resume", async () => {
  await exerciseRace("uncertain", { stage: "intake", outcome: "send-uncertain" });
});

for (const stage of new Set<"intake" | "workspace" | "engineering">(["intake", "workspace", "engineering"])) {
  test(`composed ${stage} stale authority releases only unstarted ownership`, async () => {
    await exerciseRace("progress", { stage, outcome: "stale" });
  });
}

for (const stage of new Set<"workspace" | "engineering">(["workspace", "engineering"])) {
  test(`composed ${stage} dispatch defers input pending before admission`, async () => {
    await exerciseRace("progress", { stage, outcome: "pending-before" });
  });
  test(`composed ${stage} uncertain send cannot be retried through resume`, async () => {
    await exerciseRace("uncertain", { stage, outcome: "send-uncertain" });
  });
}

test("composed engineering authentication exception remains held until explicit recovery", async () => {
  await exerciseRace("progress", { stage: "engineering", outcome: "auth-error" });
});

test("composed superseded intake authentication cannot clear a newer dispatch", async () => {
  await exerciseRace("progress", { stage: "intake", outcome: "superseded" });
});

test("composed unavailable workspace authentication has explicit progress recovery", async () => {
  await exerciseRace("progress", { stage: "workspace", outcome: "auth-unavailable" });
});
