import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { z } from "zod";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Diagnostic } from "./intake.js";
const exec = promisify(execFile);
const Package = z.object({ name: z.string(), version: z.string() });
async function packageAt(path: string, name: string): Promise<string | null> {
  let dir = dirname(path);
  while (true) {
    try {
      const p = Package.parse(
        JSON.parse(await readFile(join(dir, "package.json"), "utf8")),
      );
      if (p.name === name) return p.version;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
export async function preflight(pi: ExtensionAPI): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const add = (name: string, status: Diagnostic["status"], message: string) =>
    diagnostics.push({ name, status, message });
  const contracts = [
    "getCommands",
    "getAllTools",
    "sendMessage",
    "sendUserMessage",
    "registerCommand",
    "registerTool",
    "on",
  ].every((k) => typeof Reflect.get(pi, k) === "function");
  add(
    "Pi",
    VERSION === "1.0.4" && contracts ? "ready" : "unverified",
    `Observed Pi ${VERSION}. T01 runtime target is 1.0.4 with input and settled hooks.`,
  );
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.close();
    add(
      "Storage",
      process.version === "v22.23.1" ? "ready" : "unverified",
      `Observed Node ${process.version}. Tested SQLite target is 22.23.1.`,
    );
  } catch (error) {
    add("Storage", "missing", `Node SQLite is unavailable. ${String(error)}`);
  }
  const commands = pi.getCommands();
  const tools = pi.getAllTools();
  for (const [name, command, version] of [
    ["@zenspc/pi-pstack", "pstack", "0.6.0"],
  ] as const) {
    const loaded = commands.find(
      (c) => c.name === command && c.source === "extension",
    );
    if (!loaded) {
      add(
        name,
        "missing",
        `Load ${name} in this Pi context. An installed but unloaded package is not sufficient.`,
      );
      continue;
    }
    const observed = await packageAt(loaded.sourceInfo.path, name);
    add(
      name,
      observed === version ? "ready" : "unverified",
      `Loaded resource ${loaded.sourceInfo.path}. Observed ${observed ?? "unknown provenance"}. Tested target ${version}.`,
    );
  }
  const subagent = tools.find(
    (t) =>
      t.name === "subagent" &&
      (t.exposure === "direct" || t.exposure === "model-only"),
  );
  const subVersion = subagent
    ? await packageAt(subagent.sourceInfo.path, "pi-subagents")
    : null;
  add(
    "pi-subagents",
    !subagent ? "missing" : subVersion === "0.76.1" ? "ready" : "unverified",
    subagent
      ? `Loaded root tool ${subagent.sourceInfo.path}. Observed ${subVersion ?? "unknown provenance"}. Tested target 0.76.1.`
      : "Load the pi-subagents root tool in this context.",
  );
  for (const name of [
    "herdr",
    "poteto-mode",
    "matt-tdd",
    "matt-teach",
    "implement",
    "code-review",
  ]) {
    const skill = commands.find(
      (c) => c.name === `skill:${name}` && c.source === "skill",
    );
    if (!skill) {
      add(
        `Skill ${name}`,
        "missing",
        `Make ${name} discoverable through Pi native skills. Legion does not install or substitute skills.`,
      );
      continue;
    }
    if (name === "poteto-mode") {
      let enabled = false;
      const pstackCommand = commands.find(
        (c) => c.name === "pstack" && c.source === "extension",
      );
      if (pstackCommand) {
        const source = await packageAt(
          skill.sourceInfo.path,
          "@zenspc/pi-pstack",
        );
        enabled = source === "0.6.0";
      }
      add(
        `Skill ${name}`,
        enabled ? "ready" : "unverified",
        `Loaded skill ${skill.sourceInfo.path}. pstack provenance ${enabled ? "verified" : "unknown"}.`,
      );
    } else
      add(
        `Skill ${name}`,
        "ready",
        `Loaded native skill ${skill.sourceInfo.path}.`,
      );
  }
  try {
    const status = z
      .object({
        status: z.string(),
        running: z.boolean(),
        version: z.string(),
        protocol: z.int(),
        compatible: z.boolean(),
        endpoint_compatible: z.boolean(),
        socket: z.string(),
        restart_needed: z.boolean(),
      })
      .parse(
        JSON.parse(
          (await exec("herdr", ["status", "server", "--json"])).stdout,
        ),
      );
    const cli = (await exec("herdr", ["--version"])).stdout.trim();
    const local = isAbsolute(status.socket);
    add(
      "Herdr",
      status.running &&
        local &&
        status.compatible &&
        status.endpoint_compatible &&
        !status.restart_needed &&
        status.protocol === 22 &&
        status.version === "0.9.1" &&
        cli.includes("0.9.1")
        ? "ready"
        : "incompatible",
      `Read-only local status ${status.status}. Server ${status.version}, CLI ${cli}, protocol ${status.protocol}, socket ${status.socket}. Tested target 0.9.1 protocol 22.`,
    );
  } catch (error) {
    add(
      "Herdr",
      "missing",
      `Local Herdr status is unavailable. ${String(error)}`,
    );
  }
  return diagnostics;
}
