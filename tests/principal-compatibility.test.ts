import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createProvider, type Api, type Model } from "@earendil-works/pi-ai";
import { checkPrincipalCompatibility, type PrincipalRegistry } from "../src/principal-compatibility.js";

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "Exact/Model", name: "Principal fixture", provider: "fixture", api: "openai-responses",
    baseUrl: "https://not-used.invalid", reasoning: true, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000, maxTokens: 4096,
    ...overrides,
  };
}

function registry(selected: Model<Api>, overrides: Partial<PrincipalRegistry> = {}): PrincipalRegistry {
  const provider = createProvider({
    id: selected.provider,
    models: [selected],
    auth: { apiKey: { name: "fixture", resolve: async () => { throw new Error("Credential acquisition forbidden"); } } },
    api: {
      stream: () => { throw new Error("Model requests forbidden"); },
      streamSimple: () => { throw new Error("Model requests forbidden"); },
    },
  });
  return {
    find: (providerId, modelId) => providerId === selected.provider && modelId === selected.id ? selected : undefined,
    getProvider: (providerId) => providerId === selected.provider ? provider : undefined,
    hasConfiguredAuth: () => true,
    getAvailable: () => [selected],
    getError: () => undefined,
    ...overrides,
  };
}

for (const principal of ["Legatus", "Tribunus"] satisfies ("Legatus" | "Tribunus")[]) {
  test(`principal-compatibility requires 272000 tokens for ${principal} without replacement`, () => {
    const selected = model({ contextWindow: 271999 });
    const result = checkPrincipalCompatibility({ principal, selection: { model: "fixture/Exact/Model", thinking: "high" }, registry: registry(selected) });
    assert.equal(result.kind, "incompatible");
    if (result.kind === "incompatible") {
      assert.deepEqual(result.issues.map((issue) => issue.code), ["context"]);
      assert.match(result.issues[0]?.message ?? "", /271999.*272000/);
      assert.match(result.issues[0]?.message ?? "", new RegExp(principal));
    }
    const boundary = model();
    const accepted = checkPrincipalCompatibility({ principal, selection: { model: "fixture/Exact/Model", thinking: "high" }, registry: registry(boundary) });
    assert.equal(accepted.kind, "compatible");
    if (accepted.kind === "compatible") {
      assert.equal(accepted.model, boundary);
      assert.equal(accepted.thinking, "high");
    }
  });
}

test("principal-compatibility uses native thinking support without clamping requested reasoning", () => {
  const selected = model({ thinkingLevelMap: { high: null, max: "native-maximum", xhigh: null } });
  const nativeRegistry = registry(selected);
  const rejected = checkPrincipalCompatibility({ principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "high" }, registry: nativeRegistry });
  assert.equal(rejected.kind, "incompatible");
  if (rejected.kind === "incompatible") {
    assert.deepEqual(rejected.issues.map((issue) => issue.code), ["thinking"]);
    assert.match(rejected.issues[0]?.message ?? "", /high.*supported.*max/);
  }
  const accepted = checkPrincipalCompatibility({ principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "max" }, registry: nativeRegistry });
  assert.equal(accepted.kind, "compatible");
  if (accepted.kind === "compatible") assert.equal(accepted.thinking, "max");
});

test("principal-compatibility reports configured auth absence without attempting acquisition", () => {
  const selected = model();
  const result = checkPrincipalCompatibility({
    principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "high" },
    registry: registry(selected, { hasConfiguredAuth: () => false, getAvailable: () => [] }),
  });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["auth"]);
    assert.match(result.issues[0]?.message ?? "", /fixture.*[Cc]onfigure.*auth/);
  }
});

test("principal-compatibility distinguishes unavailable native support from configured authentication", () => {
  const selected = model();
  const result = checkPrincipalCompatibility({
    principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "high" },
    registry: registry(selected, { getAvailable: () => [] }),
  });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["availability"]);
    assert.match(result.issues[0]?.message ?? "", /configured.*native available.*snapshot/i);
  }
});

test("principal-compatibility reports an unknown principal selection without synthesizing defaults", () => {
  const result = checkPrincipalCompatibility({ principal: "Legatus", selection: undefined, registry: registry(model()) });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["selection"]);
    assert.match(result.issues[0]?.message ?? "", /Legatus.*unknown.*[Oo]bserve/);
  }
});

test("principal-compatibility never fuzzy-matches or replaces an unregistered exact identifier", () => {
  const selected = model();
  const result = checkPrincipalCompatibility({ principal: "Tribunus", selection: { model: "fixture/exact/model", thinking: "high" }, registry: registry(selected) });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["model"]);
    assert.match(result.issues[0]?.message ?? "", /fixture\/exact\/model.*not registered.*exact/i);
  }
});

test("principal-compatibility rejects missing native provider registration separately from auth", () => {
  const selected = model();
  const result = checkPrincipalCompatibility({
    principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "high" },
    registry: registry(selected, { getProvider: () => undefined }),
  });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["provider"]);
    assert.match(result.issues[0]?.message ?? "", /fixture.*provider.*[Rr]egister/);
  }
});

test("principal-compatibility exposes native registry errors instead of trusting a partial snapshot", () => {
  const result = checkPrincipalCompatibility({
    principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "high" },
    registry: registry(model(), { getError: () => "/configured/models.json: invalid model config" }),
  });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") {
    assert.deepEqual(result.issues.map((issue) => issue.code), ["registry"]);
    assert.match(result.issues[0]?.message ?? "", /models.json.*invalid model config.*[Cc]orrect/);
  }
});

test("principal-compatibility accepts a real Pi 1.1.0 registry snapshot without auth resolution or requests", async () => {
  const { ModelRegistry, ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { InMemoryCredentialStore } = await import("@earendil-works/pi-ai");
  // VERSION can refer to the parent Pi executable through inherited PI_PACKAGE_DIR.
  const metadata = z.object({ version: z.string() }).parse(JSON.parse(await readFile(
    new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")), "utf8",
  )));
  assert.equal(metadata.version, "1.1.0");
  const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  const selected = model({ thinkingLevelMap: { max: "native-max" } });
  const nativeProvider = createProvider({
    id: "fixture", models: [selected],
    auth: { apiKey: {
      name: "metadata-only fixture",
      check: async () => ({ type: "api_key", source: "fixture metadata" }),
      resolve: async () => { throw new Error("Credential acquisition forbidden"); },
    } },
    api: {
      stream: () => { throw new Error("Model requests forbidden"); },
      streamSimple: () => { throw new Error("Model requests forbidden"); },
    },
  });
  runtime.registerNativeProvider(nativeProvider);
  await runtime.refresh({ allowNetwork: false });
  const nativeRegistry = new ModelRegistry(runtime);
  assert.equal(nativeRegistry.getError(), undefined);
  assert.ok(nativeRegistry.hasConfiguredAuth(selected));
  assert.ok(nativeRegistry.getAvailable().some((available) => available.provider === "fixture" && available.id === "Exact/Model"));
  const before = JSON.stringify(nativeRegistry.find("fixture", "Exact/Model"));
  const result = checkPrincipalCompatibility({ principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "max" }, registry: nativeRegistry });
  assert.equal(result.kind, "compatible");
  if (result.kind === "compatible") assert.equal(result.thinking, "max");
  assert.equal(JSON.stringify(nativeRegistry.find("fixture", "Exact/Model")), before);
  assert.deepEqual(await credentials.list(), []);
});

test("principal-compatibility does not treat an unknown context window as passing the principal minimum", () => {
  const selected = model({ contextWindow: Number.NaN });
  const result = checkPrincipalCompatibility({ principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "high" }, registry: registry(selected) });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") assert.deepEqual(result.issues.map((issue) => issue.code), ["context"]);
});

test("principal-compatibility requires the whole exact provider/model identifier, including its separator", () => {
  const selected = model({ provider: "fixtur", id: "fixture" });
  const result = checkPrincipalCompatibility({ principal: "Legatus", selection: { model: "fixture", thinking: "high" }, registry: registry(selected) });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") assert.deepEqual(result.issues.map((issue) => issue.code), ["model"]);
});

test("principal-compatibility supports only off for a native non-reasoning principal model", () => {
  const selected = model({ reasoning: false });
  const nativeRegistry = registry(selected);
  const rejected = checkPrincipalCompatibility({ principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "minimal" }, registry: nativeRegistry });
  assert.equal(rejected.kind, "incompatible");
  if (rejected.kind === "incompatible") assert.deepEqual(rejected.issues.map((issue) => issue.code), ["thinking"]);
  const accepted = checkPrincipalCompatibility({ principal: "Legatus", selection: { model: "fixture/Exact/Model", thinking: "off" }, registry: nativeRegistry });
  assert.equal(accepted.kind, "compatible");
});

test("principal-compatibility available support must match provider as well as model id", () => {
  const selected = model({ contextWindow: 400000 });
  const result = checkPrincipalCompatibility({
    principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "high" },
    registry: registry(selected, { getAvailable: () => [model({ provider: "other" })] }),
  });
  assert.equal(result.kind, "incompatible");
  if (result.kind === "incompatible") assert.deepEqual(result.issues.map((issue) => issue.code), ["availability"]);
  assert.equal(checkPrincipalCompatibility({ principal: "Tribunus", selection: { model: "fixture/Exact/Model", thinking: "high" }, registry: registry(selected) }).kind, "compatible");
});
