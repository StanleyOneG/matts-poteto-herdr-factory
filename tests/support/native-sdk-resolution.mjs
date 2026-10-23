import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as hostSdk from "@earendil-works/pi-coding-agent";
import { loadHostPiCodingAgent } from "../../node_modules/pi-subagents/src/runs/shared/child-session.js";
import { getPiSpawnCommand } from "../../node_modules/pi-subagents/src/runs/shared/pi-spawn.js";

const scenario = process.argv[2];
const root = mkdtempSync(join(tmpdir(), "sdk-"));
const host = join(root, "app"), entry = join(host, "app.js");
const sdkRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const nearest = join(host, "node_modules", "@earendil-works", "pi-coding-agent");
const overrideKey = "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT";
const prior = process.env[overrideKey], priorEntry = process.argv[1];
mkdirSync(dirname(nearest), { recursive: true });
writeFileSync(entry, "// Embedded host entry, not a Pi CLI.\n");
process.argv[1] = entry;
delete process.env[overrideKey];
const cli = () => getPiSpawnCommand(["--version"], { env: process.env, argv1: process.argv[1] });
try {
  if (scenario === "broken-host") {
    mkdirSync(nearest);
    writeFileSync(join(nearest, "package.json"), JSON.stringify({ name: "not-the-host-sdk" }));
    await assert.rejects(loadHostPiCodingAgent(), /invalid host SDK manifest/,
      "A broken nearest host SDK must not fall back to the extension-owned SDK");
    assert.throws(cli, /invalid host SDK manifest/);
  } else if (scenario === "host") {
    symlinkSync(sdkRoot, nearest, "dir");
    assert.equal((await loadHostPiCodingAgent()).createAgentSession, hostSdk.createAgentSession,
      "Embedded hosts must import the actual owning SDK module");
    assert.deepEqual(cli(), { command: process.execPath, args: [join(realpathSync(sdkRoot), "dist", "bundle", "cli.js"), "--version"] });
  } else if (scenario === "override") {
    // An explicit valid root beats a broken nearest host dependency graph.
    mkdirSync(nearest);
    writeFileSync(join(nearest, "package.json"), "{broken");
    process.env[overrideKey] = sdkRoot;
    assert.equal((await loadHostPiCodingAgent()).createAgentSession, hostSdk.createAgentSession);
    assert.deepEqual(cli(), { command: process.execPath, args: [join(sdkRoot, "dist", "bundle", "cli.js"), "--version"] });
    process.env[overrideKey] = nearest;
    await assert.rejects(loadHostPiCodingAgent(), /invalid host SDK manifest/);
    assert.throws(cli, /invalid host SDK manifest/);
  } else if (scenario === "bin-launcher") {
    const launcher = join(root, "pi");
    symlinkSync(join(sdkRoot, "dist", "bundle", "cli.js"), launcher);
    process.argv[1] = launcher;
    process.env[overrideKey] = sdkRoot;
    assert.equal((await loadHostPiCodingAgent()).createAgentSession, hostSdk.createAgentSession);
    assert.deepEqual(cli(), { command: process.execPath, args: [join(sdkRoot, "dist", "bundle", "cli.js"), "--version"] });
    process.env[overrideKey] = join(root, "absent-override");
    await assert.rejects(loadHostPiCodingAgent(), /ENOENT/, "An extensionless launcher must honor the selected explicit SDK and fail closed");
    assert.throws(cli, /ENOENT/);
  } else if (scenario === "direct-cli") {
    process.argv[1] = join(sdkRoot, "dist", "bundle", "cli.js");
    process.env[overrideKey] = join(root, "absent-override");
    assert.equal((await loadHostPiCodingAgent()).createAgentSession, hostSdk.createAgentSession,
      "A recognized direct JS Pi entry preserves its own SDK despite an override");
    assert.deepEqual(cli(), { command: process.execPath, args: [realpathSync(process.argv[1]), "--version"] });
  } else throw new Error(`Unknown SDK resolution scenario: ${scenario}`);
} finally {
  process.argv[1] = priorEntry;
  if (prior === undefined) delete process.env[overrideKey]; else process.env[overrideKey] = prior;
  rmSync(root, { recursive: true, force: true });
}
