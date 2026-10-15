import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDeliverySelection, loadLegionSettings, selectTribunusModel, type AssignmentModelPin } from "../src/legion-settings.js";

async function checkout(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "legion-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homePath = join(root, "home");
  const checkoutPath = join(root, "checkout");
  const globalPath = join(homePath, ".pi", "agent", "legion", "legion.json");
  const localPath = join(checkoutPath, ".pi", "legion.json");
  await mkdir(join(homePath, ".pi", "agent", "legion"), { recursive: true });
  await mkdir(join(checkoutPath, ".pi"), { recursive: true });
  return { homePath, checkoutPath, globalPath, localPath };
}

test("legion-settings consumers receive per-leaf checkout over global over built-in values", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, JSON.stringify({ context: { warningTokens: 140000 } }));
  await writeFile(paths.localPath, JSON.stringify({ context: { escalationTokens: 160000 } }));
  assert.deepEqual(await loadLegionSettings(paths), {
    context: { warningTokens: 140000, escalationTokens: 160000 },
  });
});

test("legion-settings rejects invalid effective thresholds with the responsible path and field", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.localPath, JSON.stringify({ context: { warningTokens: 0 } }));
  await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(paths.localPath), error.message);
    assert.match(error.message, /context.warningTokens.*positive safe integer/);
    return true;
  });
});

test("legion-settings requires warning strictly below escalation after per-leaf merging", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, JSON.stringify({ context: { warningTokens: 160000 } }));
  await writeFile(paths.localPath, JSON.stringify({ context: { escalationTokens: 160000 } }));
  await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(paths.globalPath), error.message);
    assert.ok(error.message.includes(paths.localPath), error.message);
    assert.match(error.message, /context.warningTokens.*below.*context.escalationTokens/);
    return true;
  });
});

test("legion-settings supplies the exact inherited provider/model and Pi thinking override", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, JSON.stringify({ tribuni_model: { model: "openai-codex/gpt-6.1-sol", thinking: "medium" } }));
  await writeFile(paths.localPath, JSON.stringify({ tribuni_model: { thinking: "high" } }));
  assert.deepEqual(await loadLegionSettings(paths), {
    context: { warningTokens: 135000, escalationTokens: 150000 },
    tribuni_model: { model: "openai-codex/gpt-6.1-sol", thinking: "high" },
  });
});

test("legion-settings rejects unsupported fields, including poteto preferences, at either layer", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, JSON.stringify({ "poteto-mode": true }));
  await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(paths.globalPath), error.message);
    assert.match(error.message, /poteto-mode.*unsupported.*[Rr]emove/);
    return true;
  });
});

test("legion-settings model consumer distinguishes native defaults from a new exact override", async (t) => {
  const paths = await checkout(t);
  assert.deepEqual(selectTribunusModel({ kind: "new", settings: await loadLegionSettings(paths) }), {
    kind: "new-native-defaults",
  });
  await writeFile(paths.localPath, JSON.stringify({ tribuni_model: { model: "openai-codex/gpt-6.1-sol", thinking: "high" } }));
  assert.deepEqual(selectTribunusModel({ kind: "new", settings: await loadLegionSettings(paths) }), {
    kind: "new-exact-override",
    selection: { model: "openai-codex/gpt-6.1-sol", thinking: "high" },
  });
});

test("legion-settings model consumer preserves an existing caller pin and profile across resumed defaults", async (t) => {
  const paths = await checkout(t);
  const pin = Object.freeze({ model: "custom/Original/Exact", thinking: "low", profile: "caller-profile", callerEvidence: "preserved" } satisfies AssignmentModelPin & { callerEvidence: string });
  const before = selectTribunusModel({ kind: "existing", pin });
  await writeFile(paths.localPath, JSON.stringify({ tribuni_model: { model: "openai-codex/gpt-6.1-sol", thinking: "high" } }));
  const settings = await loadLegionSettings(paths);
  assert.equal(selectTribunusModel({ kind: "new", settings }).kind, "new-exact-override");
  assert.deepEqual(before, { kind: "existing-pinned", pin });
  const after = selectTribunusModel({ kind: "existing", pin });
  assert.equal(after.kind, "existing-pinned");
  if (after.kind === "existing-pinned") assert.equal(after.pin, pin);
  assert.deepEqual(selectTribunusModel({ kind: "existing" }), { kind: "existing-unknown" });
});

test("legion-settings missing files retain absolute built-in thresholds and no model override", async (t) => {
  assert.deepEqual(await loadLegionSettings(await checkout(t)), {
    context: { warningTokens: 135000, escalationTokens: 150000 },
  });
});

test("legion-settings validates effective leaves rather than masked lower values", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, JSON.stringify({
    context: { warningTokens: "bad", escalationTokens: -1 },
    tribuni_model: { model: null, thinking: "unsupported" },
  }));
  await writeFile(paths.localPath, JSON.stringify({
    context: { warningTokens: 10, escalationTokens: 20 },
    tribuni_model: { model: "Custom/ Exact/Model ", thinking: "off" },
  }));
  assert.deepEqual(await loadLegionSettings(paths), {
    context: { warningTokens: 10, escalationTokens: 20 },
    tribuni_model: { model: "Custom/ Exact/Model ", thinking: "off" },
  });
});

for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "135000", null, false]) {
  test(`legion-settings rejects effective non-positive-safe-integer threshold ${JSON.stringify(invalid)}`, async (t) => {
    const paths = await checkout(t);
    await writeFile(paths.globalPath, JSON.stringify({ context: { escalationTokens: invalid } }));
    await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(paths.globalPath), error.message);
      assert.match(error.message, /context.escalationTokens.*positive safe integer/);
      return true;
    });
  });
}

for (const [value, field] of [
  [{ context: { obsolete: true } }, "context.obsolete"],
  [{ tribuni_model: { provider: "openai" } }, "tribuni_model.provider"],
] satisfies [unknown, string][]) {
  test(`legion-settings rejects unsupported nested field ${field}`, async (t) => {
    const paths = await checkout(t);
    await writeFile(paths.localPath, JSON.stringify(value));
    await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(paths.localPath), error.message);
      assert.ok(error.message.includes(field), error.message);
      assert.match(error.message, /unsupported configuration/);
      return true;
    });
  });
}

for (const [value, field] of [
  [null, "root"], [[], "root"], [42, "root"],
  [{ context: null }, "context"], [{ context: [] }, "context"],
  [{ tribuni_model: null }, "tribuni_model"], [{ tribuni_model: "model" }, "tribuni_model"],
] satisfies [unknown, string][]) {
  test(`legion-settings rejects non-object ${field} ${JSON.stringify(value)} even when overridden`, async (t) => {
    const paths = await checkout(t);
    await writeFile(paths.globalPath, JSON.stringify(value));
    await writeFile(paths.localPath, JSON.stringify({
      context: { warningTokens: 10, escalationTokens: 20 },
      tribuni_model: { model: "custom/exact", thinking: "high" },
    }));
    await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`${paths.globalPath}: ${field}:`), error.message);
      assert.match(error.message, /expected a JSON object/);
      return true;
    });
  });
}

test("legion-settings malformed lower JSON fails instead of using higher settings or defaults", async (t) => {
  const paths = await checkout(t);
  await writeFile(paths.globalPath, "{broken");
  await writeFile(paths.localPath, "{}");
  await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(paths.globalPath), error.message);
    assert.match(error.message, /invalid JSON.*Correct the JSON syntax/);
    return true;
  });
});

test("legion-settings non-missing read errors fail with corrective path diagnostics", async (t) => {
  const paths = await checkout(t);
  await mkdir(paths.localPath);
  await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(paths.localPath), error.message);
    assert.match(error.message, /cannot read configuration.*Check file/);
    return true;
  });
});

for (const [value, field] of [
  [{}, "model"],
  [{ model: "custom/model" }, "thinking"],
  [{ model: "model", thinking: "high" }, "model"],
  [{ model: "/model", thinking: "high" }, "model"],
  [{ model: "custom/", thinking: "high" }, "model"],
  [{ model: "", thinking: "high" }, "model"],
  [{ model: "custom/model", thinking: "HIGH" }, "thinking"],
  [{ model: "custom/model", thinking: null }, "thinking"],
] satisfies [unknown, string][]) {
  test(`legion-settings rejects incomplete or invalid override ${JSON.stringify(value)}`, async (t) => {
    const paths = await checkout(t);
    await writeFile(paths.localPath, JSON.stringify({ tribuni_model: value }));
    await assert.rejects(loadLegionSettings(paths), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(paths.localPath), error.message);
      assert.ok(error.message.includes(`tribuni_model.${field}`), error.message);
      return true;
    });
  });
}

test("delivery selection is explicit checkout-only data and invalid selection does not poison task settings", async t => {
  const paths = await checkout(t);
  const selector = join(paths.checkoutPath, ".pi", "legion-delivery.json");
  await writeFile(join(paths.homePath, ".pi", "agent", "legion", "legion-delivery.json"), JSON.stringify({ configurationFile: "global-provider.json" }));
  assert.equal(loadDeliverySelection({ checkoutPath: paths.checkoutPath }), null, "No global or platform default");
  await writeFile(selector, JSON.stringify({ configurationFile: ".git/provider.json" }));
  assert.equal(loadDeliverySelection({ checkoutPath: paths.checkoutPath }), ".git/provider.json");
  for (const value of ["not json", "null", JSON.stringify({ configurationFile: "" }), JSON.stringify({ configurationFile: ".git/provider.json", executable: "/model/command" })]) {
    await writeFile(selector, value);
    assert.throws(() => loadDeliverySelection({ checkoutPath: paths.checkoutPath }), /invalid delivery selection/);
    assert.equal((await loadLegionSettings(paths)).tribuni_model, undefined, "Only delivery is held");
  }
});
