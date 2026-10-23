import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, isAbsolute, relative } from "node:path";
import { z } from "zod";
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { requiredWorkflowSkills } from "./tribunus.js";
import type { WorkflowChoice } from "./legion-settings.js";
import type { LegionSettings } from "./legion-settings.js";
import { checkPrincipalCompatibility } from "./principal-compatibility.js";
import type { Diagnostic } from "./intake.js";
const exec = promisify(execFile);
const Package = z.object({ name: z.string(), version: z.string(), repository: z.union([z.string(), z.object({ url: z.string() })]).optional() });
async function packageLocation(path: string, name: string) {
  let dir = dirname(path);
  while (true) {
    try {
      const p = Package.parse(
        JSON.parse(await readFile(join(dir, "package.json"), "utf8")),
      );
      if (p.name === name) return { ...p, root: dir };
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
async function packageAt(path: string, name: string): Promise<string | null> {
  return (await packageLocation(path, name))?.version ?? null;
}
const forkRepository = "https://github.com/StanleyOneG/stanley-pi-pstack";
function isSuppliedFork(repository: string | undefined) {
  return repository?.replace(/^git\+/, "").replace(/^git@github.com:/, "https://github.com/").replace(/^ssh:\/\/git@github.com\//, "https://github.com/").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase() === forkRepository.toLowerCase();
}
async function loadedFork(path: string, resource: "extensions/pstack/index.ts" | "skills/poteto-mode/SKILL.md") {
  try {
    const loadedPath = await realpath(path);
    const pkg = await packageLocation(loadedPath, "@zenspc/pi-pstack");
    if (!pkg || loadedPath !== await realpath(join(pkg.root, resource)) || pkg.version !== "0.6.0" || !isSuppliedFork(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url)) return null;
    const git = async (...args: string[]) => (await exec("git", ["-C", pkg.root, ...args])).stdout.trim();
    const root = await realpath(await git("rev-parse", "--show-toplevel"));
    const origin = await git("remote", "get-url", "origin"), commit = await git("rev-parse", "HEAD");
    if (root !== await realpath(pkg.root) || !isSuppliedFork(origin) || !/^[a-f0-9]{40,64}$/.test(commit)) return null;
    await git("ls-files", "--error-unmatch", "--", relative(root, loadedPath));
    await git("diff", "--exit-code", "HEAD", "--", "extensions/pstack", "skills/poteto-mode");
    return { root, origin, commit, version: pkg.version };
  } catch { return null; }
}
type PrincipalInput = {
  principal: "Legatus" | "Tribunus";
  context: Pick<ExtensionContext, "model" | "modelRegistry">;
  thinking: ModelThinkingLevel | undefined;
  settings?: LegionSettings;
};
export function principalDiagnostics(input: PrincipalInput): Diagnostic[] {
  const { model, modelRegistry } = input.context;
  const selection = model && input.thinking !== undefined ? { model: `${model.provider}/${model.id}`, thinking: input.thinking } : undefined;
  const check = (principal: PrincipalInput["principal"], selected: typeof selection): Diagnostic => {
    try {
      const result = checkPrincipalCompatibility({ principal, selection: selected, registry: modelRegistry });
      return { name: `${principal} model`, status: result.kind === "compatible" ? "ready" : "incompatible", message: result.kind === "compatible"
        ? `${selected?.model}, thinking ${selected?.thinking}, window ${result.model.contextWindow}. Native registry/auth/availability metadata only; not provider-request proof.`
        : result.issues.map(issue => issue.message).join(" ") };
    } catch (error) {
      return { name: `${principal} model`, status: "unverified", message: `Native principal metadata lookup failed. Preserve the selection and verify Pi configuration before retrying. ${String(error)}` };
    }
  };
  const diagnostics = [check(input.principal, selection)];
  if (model && (!Number.isFinite(model.contextWindow) || model.contextWindow < 272000)) {
    diagnostics.push({ name: `${input.principal} actual window`, status: "incompatible", message: `${input.principal} actual selected ${model.provider}/${model.id} window ${model.contextWindow}; at least 272000 tokens are required. Ask the Emperor to select a compatible principal; no substitution.` });
  }
  if (model && input.thinking !== undefined && !getSupportedThinkingLevels(model).includes(input.thinking)) {
    diagnostics.push({ name: `${input.principal} actual thinking`, status: "incompatible", message: `${input.principal} actual selected ${model.provider}/${model.id} thinking ${input.thinking} is unsupported. Verify native principal metadata and ask the Emperor to correct thinking; no clamping or substitution.` });
  }
  if (input.settings?.tribuni_model) diagnostics.push(check("Tribunus", input.settings.tribuni_model));
  return diagnostics;
}
export async function preflight(pi: ExtensionAPI, principal?: PrincipalInput, workflowChoice?: WorkflowChoice): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = principal ? principalDiagnostics(principal) : [];
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
    ["1.1.0", "1.2.0", "1.3.0"].includes(VERSION) && contracts ? "ready" : "unverified",
    `Observed Pi ${VERSION}. Candidate contract target is 1.3.0; historical targets 1.2.0 and 1.1.0. Native launch verification remains required.`,
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
  const pstackCommands = commands.filter(c => c.name === "pstack" && c.source === "extension");
  const pstack = pstackCommands.length === 1 ? pstackCommands[0] : undefined;
  const fork = pstack ? await loadedFork(pstack.sourceInfo.path, "extensions/pstack/index.ts") : null;
  add("@zenspc/pi-pstack", !pstackCommands.length ? "missing" : fork ? "ready" : "unverified",
    fork ? `Loaded resource ${pstack?.sourceInfo.path}. Observed ${fork.version}, supplied fork ${fork.origin}, commit ${fork.commit}, root ${fork.root}. Source identity only; native runtime check remains required.`
      : `Load one unmodified supplied fork ${forkRepository} at version 0.6.0 in this context. Loaded ${pstack?.sourceInfo.path ?? "unknown or ambiguous source"}; manifest, tracked path, checkout origin or commit is unverified. Same npm name/version is insufficient.`);
  const subagent = tools.find(
    (t) =>
      t.name === "subagent" &&
      (t.exposure === "direct" || t.exposure === "model-only"),
  );
  const subVersion = subagent
    ? await packageAt(subagent.sourceInfo.path, "pi-subagents")
    : null;
  const subagentsCompatible = VERSION === "1.3.0" && subVersion === "0.79.1" || VERSION === "1.2.0" && subVersion === "0.78.0" || VERSION === "1.1.0" && subVersion === "0.77.0";
  add(
    "pi-subagents",
    !subagent ? "missing" : subagentsCompatible ? "ready" : "unverified",
    subagent
      ? `Registered root tool ${subagent.sourceInfo.path}. Observed on-disk package ${subVersion ?? "unknown provenance"}. Candidate composition target Pi 1.3.0 / pi-subagents 0.79.1; historical Pi 1.2.0 / 0.78.0 and Pi 1.1.0 / 0.77.0. On-disk metadata does not establish the in-memory runtime version. Native launch verification remains required. No arbitrary-version compatibility.`
      : "Load the pi-subagents root tool in this context.",
  );
  for (const name of requiredWorkflowSkills(workflowChoice)) {
    const matches = commands.filter(c => c.name === `skill:${name}` && c.source === "skill");
    const skill = matches.length === 1 ? matches[0] : undefined;
    if (!skill) {
      add(`Skill ${name}`, matches.length ? "unverified" : "missing", `Make one unambiguous ${name} discoverable through Pi native skills. Legion does not install or substitute skills.`);
      continue;
    }
    if (name === "poteto-mode") {
      const skillFork = await loadedFork(skill.sourceInfo.path, "skills/poteto-mode/SKILL.md");
      const verified = !!fork && !!skillFork && fork.root === skillFork.root && fork.commit === skillFork.commit;
      add(`Skill ${name}`, verified ? "ready" : "unverified", `Loaded skill ${skill.sourceInfo.path}. Same loaded supplied-fork extension/skill origin ${verified ? "verified" : "unverified"}.`);
    } else add(`Skill ${name}`, "ready", `Loaded native skill ${skill.sourceInfo.path}.`);
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
