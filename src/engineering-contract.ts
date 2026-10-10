import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseFrontmatter, truncateHead, formatSize, createReadToolDefinition, type ExtensionAPI, type ExtensionContext, type ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { Diagnostic } from "./intake.js";
import { validateToolArguments } from "@earendil-works/pi-ai";

const LoadProof = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), toolCallId: z.string(), call: z.string(), result: z.string(), startLine: z.int().positive(), endLine: z.int().positive() }),
  z.object({ kind: z.literal("native-expansion"), entry: z.string() }),
]);
const Load = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-required") }),
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("complete"), evidence: z.array(LoadProof).min(1) }),
]);
const Resource = z.object({
  name: z.string(), path: z.string(), canonicalPath: z.string(), digest: z.string(), load: Load,
});
export const ContractEvidence = z.object({
  verification: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("blocked"), code: z.string(), message: z.string() }),
    z.object({ kind: z.literal("pending"), message: z.string() }),
    z.object({ kind: z.literal("verified"), scope: z.literal("current-selected-resources-and-native-loading") }),
  ]),
  compatibility: z.literal("Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review.").default("Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review."),
  kind: z.enum(["unavailable", "loading", "loaded"]), cwd: z.string(), precedence: z.literal("Matt TDD is primary; pstack supplements it. No self-authorized exceptions."),
  resources: z.array(Resource), diagnostics: z.array(z.object({ name: z.string(), status: z.enum(["ready", "missing", "incompatible", "unverified"]), message: z.string() })),
});
const names = ["matt-tdd", "matt-teach", "poteto-mode"];
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
function contentAt(path: string) {
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`Resource ${path} is not lossless UTF-8. Restore the original text bytes.`);
  return text;
}

export function discoverContract(pi: ExtensionAPI, cwd: string): z.infer<typeof ContractEvidence> {
  const registry = pi.getCommands();
  const commands = registry.filter(command => command.source === "skill");
  const resources: z.infer<typeof Resource>[] = [], diagnostics: Diagnostic[] = [];
  for (const name of names) {
    const registered = commands.filter(command => command.name === `skill:${name}`);
    const paths = registered.map(command => command.sourceInfo.path);
    try {
      const [selected] = registered;
      if (!selected || registered.length !== 1) throw new Error(`Expected one native skill:${name} command, found ${registered.length}.`);
      const interceptors = registry.filter(command => command.name === `skill:${name}` && command.source !== "skill");
      if (interceptors.length) throw new Error(`Required /skill:${name} conflicts with active invocation resources ${interceptors.map(command => `${command.source} ${command.sourceInfo.path}`).join(", ")}. Resolve the invocation conflict and reload native resources.`);
      const path = selected.sourceInfo.path;
      const canonicalPath = realpathSync(path);
      const bytes = contentAt(path);
      const { frontmatter } = parseFrontmatter(bytes);
      if (frontmatter.name !== name || typeof frontmatter.description !== "string" || !frontmatter.description.trim())
        throw new Error(`Conflicting native ${name} identity in ${path}. Keep matt-tdd and matt-teach distinct from pstack tdd and teach.`);
      const aliases = commands.filter(command => command.name !== `skill:${name}` && existsSync(command.sourceInfo.path) && realpathSync(command.sourceInfo.path) === canonicalPath);
      if (aliases.length) throw new Error(`Conflicting resource aliases ${aliases.map(command => command.name).join(", ")} at ${path}.`);
      const files: z.infer<typeof Resource>[] = [{ name, path, canonicalPath, digest: digest(bytes), load: name === "matt-teach" ? { kind: "not-required" } : { kind: "pending" } }];
      if (name === "matt-tdd") {
        for (const reference of ["tests.md", "mocking.md"]) {
          const path = join(dirname(selected.sourceInfo.path), reference);
          files.push({ name: `${name}/${reference}`, path, canonicalPath: realpathSync(path), digest: digest(contentAt(path)), load: { kind: "pending" } });
        }
      }
      resources.push(...files);
      diagnostics.push({ name: `Contract ${name}`, status: "ready", message: `Native ${name} is available at ${path} in assigned context ${cwd}.` });
    } catch (error) {
      diagnostics.push({ name: `Contract ${name}`, status: "incompatible", message: `Required ${name} is unavailable or conflicting in ${cwd}. Check ${paths.join(", ") || join(cwd, ".agents/skills", name, "SKILL.md")}. Restore distinct resources and reload native skills. ${String(error)}` });
    }
  }
  const unavailable = diagnostics.some(item => item.status !== "ready");
  return { verification: unavailable ? { kind: "blocked", code: "selected-resource-unavailable", message: diagnostics.filter(item => item.status !== "ready").map(item => item.message).join(" ") } : { kind: "pending", message: "Native selection is established. Complete the selected native contract reads. Selection is not loading or effect authority." },
    compatibility: "Matt TDD is primary. Arbitrary prose compatibility and workflow adherence require recorded decisions and independent review.",
    kind: unavailable ? "unavailable" : "loading", cwd, precedence: "Matt TDD is primary; pstack supplements it. No self-authorized exceptions.", resources, diagnostics };
}

const ReadInput = z.object({ path: z.string(), offset: z.int().positive().optional(), limit: z.int().positive().optional() }).strict();
type ReadCapture = { input: z.infer<typeof ReadInput>; path: string; digest: string };
const NativeReadCall = z.object({ type: z.literal("toolCall"), id: z.string(), name: z.literal("read"), arguments: z.record(z.string(), z.unknown()) }).passthrough();
const NativeAssistantEntry = z.object({ id: z.string(), type: z.literal("message"), message: z.object({ role: z.literal("assistant"), content: z.array(z.unknown()) }).passthrough() }).passthrough();

export class EngineeringContract {
  private reads = new Map<string, ReadCapture>();
  private pathIssues = new Map<string, string>();
  private expansion: { path: string; digest: string; prompt: string } | null = null;
  private selection: string | null = null;
  private potetoSelection: string | null = null;
  constructor(private pi: ExtensionAPI, private cwd: string, private journal: string, private nativeReadOwner = "builtin:read") {}

  retireProof() {
    this.reads.clear();
    this.pathIssues.clear();
    this.expansion = null;
    this.selection = null;
    this.potetoSelection = null;
  }

  private currentSelection() {
    const contract = discoverContract(this.pi, this.cwd);
    const identity = contract.resources.map(resource => [resource.name, resource.canonicalPath, resource.digest]);
    const selection = JSON.stringify([contract.kind, identity]);
    const poteto = JSON.stringify(identity.find(([name]) => name === "poteto-mode") ?? null);
    if (selection !== this.selection) {
      this.reads.clear();
      this.pathIssues.clear();
      if (poteto !== this.potetoSelection) this.expansion = null;
      this.selection = selection;
      this.potetoSelection = poteto;
    }
    return contract;
  }

  private readInput(id: string, raw: unknown) {
    const native = createReadToolDefinition(this.cwd);
    const original = structuredClone(raw);
    const args = z.record(z.string(), z.json()).parse(native.prepareArguments ? native.prepareArguments(original) : original);
    return ReadInput.parse(validateToolArguments(native, { type: "toolCall", id, name: "read", arguments: args }));
  }

  private preparedReadEntry(entry: unknown) {
    const parsed = NativeAssistantEntry.safeParse(entry);
    if (!parsed.success) return entry;
    return { ...parsed.data, message: { ...parsed.data.message, content: parsed.data.message.content.map(part => {
      const call = NativeReadCall.safeParse(part);
      if (!call.success) return part;
      try { return { ...call.data, arguments: this.readInput(call.data.id, call.data.arguments) }; }
      catch { return part; }
    }) } };
  }

  captureRead(event: ToolCallEvent) {
    if (event.toolName !== "read" || event.parentToolCallId || !this.pi.getAllTools().some(tool => tool.name === "read" && tool.sourceInfo.path === this.nativeReadOwner)) return;
    const contract = this.currentSelection();
    if (this.reads.has(event.toolCallId)) return;
    let input: z.infer<typeof ReadInput>;
    try { input = this.readInput(event.toolCallId, event.input); }
    catch { return; }
    try {
      if (/^(?:@|~|file:\/\/)|[\u00a0\u2000-\u200a\u202f\u205f\u3000]/u.test(input.path)) throw new Error("Native path expansion is not exposed by the supported public proof API");
      const path = realpathSync(resolve(this.cwd, input.path));
      const resource = contract.resources.find(resource => resource.canonicalPath === path);
      if (resource) this.reads.set(event.toolCallId, { input, path, digest: resource.digest });
    } catch (error) {
      this.pathIssues.set(event.toolCallId, `Read ${input.path} needs an absolute-path reread for contract proof. ${String(error)}`);
    }
  }

  captureExpansion(path: string, bytes: string, prompt: string) {
    this.currentSelection();
    this.expansion = { path: realpathSync(path), digest: digest(bytes), prompt };
  }

  snapshot(ctx: ExtensionContext): z.infer<typeof ContractEvidence> {
    const contract = this.currentSelection();
    if (!this.pi.getAllTools().some(tool => tool.name === "read" && tool.sourceInfo.path === this.nativeReadOwner)) return contract;
    const persisted = new Map<string, unknown>();
    try {
      for (const line of readFileSync(this.journal, "utf8").trimEnd().split("\n")) {
        const raw: unknown = JSON.parse(line);
        const entry = z.object({ id: z.string() }).parse(raw);
        persisted.set(entry.id, raw);
      }
    } catch { return contract; }
    const branch = ctx.sessionManager.getBranch().filter(entry => JSON.stringify(this.preparedReadEntry(persisted.get(entry.id))) === JSON.stringify(this.preparedReadEntry(entry)));
    for (const resource of contract.resources) {
      if (resource.load.kind === "not-required") continue;
      const expansion = this.expansion;
      if (resource.name === "poteto-mode" && expansion?.path === resource.canonicalPath && expansion.digest === resource.digest) {
        const entry = branch.find(entry => entry.type === "message" && entry.message.role === "user" && Array.isArray(entry.message.content) && entry.message.content.some(part => part.type === "text" && part.text === expansion.prompt));
        if (entry) resource.load = { kind: "complete", evidence: [{ kind: "native-expansion", entry: `${this.journal}#${entry.id}` }] };
      }
      let bytes: string;
      try {
        bytes = contentAt(resource.path);
        if (digest(bytes) !== resource.digest) throw new Error("Resource changed during evidence inspection");
      } catch (error) {
        this.retireProof();
        for (const selected of contract.resources) {
          if (selected.load.kind !== "not-required") selected.load = { kind: "pending" };
        }
        const message = `Cannot verify current bytes at ${resource.path}. Reload and read the complete current contract. ${String(error)}`;
        contract.kind = "unavailable";
        contract.verification = { kind: "blocked", code: "selected-resource-unavailable", message };
        contract.diagnostics.push({ name: `Contract ${resource.name}`, status: "unverified", message });
        return contract;
      }
      const lines = bytes.split("\n");
      const coverage: Extract<z.infer<typeof LoadProof>, { kind: "read" }>[] = [];
      for (const [toolCallId, capture] of this.reads) {
        if (capture.path !== resource.canonicalPath || capture.digest !== resource.digest) continue;
        const startLine = capture.input.offset ?? 1;
        let endLine = Math.min(lines.length, startLine - 1 + (capture.input.limit ?? lines.length));
        if (startLine > endLine) continue;
        const selected = lines.slice(startLine - 1, endLine).join("\n");
        const truncation = truncateHead(selected);
        if (truncation.firstLineExceedsLimit || truncation.lastLinePartial) continue;
        let expected = selected;
        if (truncation.truncated) {
          endLine = startLine + truncation.outputLines - 1;
          expected = `${truncation.content}\n\n[Showing lines ${startLine}-${endLine} of ${lines.length}${truncation.truncatedBy === "bytes" ? ` (${formatSize(truncation.maxBytes)} limit)` : ""}. Use offset=${endLine + 1} to continue.]`;
        } else if (endLine < lines.length) expected = `${selected}\n\n[${lines.length - endLine} more lines in file. Use offset=${endLine + 1} to continue.]`;
        const calls = branch.flatMap(entry => entry.type === "message" && entry.message.role === "assistant" ? entry.message.content.filter(part => {
          if (part.type !== "toolCall" || part.id !== toolCallId || part.name !== "read") return false;
          try { return isDeepStrictEqual(this.readInput(part.id, part.arguments), capture.input); }
          catch { return false; }
        }).map(() => entry) : []);
        const [call] = calls;
        const results = branch.filter(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === toolCallId);
        const [result] = results;
        if (!call || calls.length !== 1 || results.length !== 1 || result?.type !== "message" || result.message.role !== "toolResult" || result.message.toolName !== "read" || result.message.isError) continue;
        if (result.message.content.length !== 1 || result.message.content[0]?.type !== "text" || result.message.content[0].text !== expected) continue;
        const details = z.object({ truncation: z.unknown().optional() }).optional().safeParse(result.message.details);
        if (!details.success || (truncation.truncated || details.data?.truncation !== undefined) && !isDeepStrictEqual(details.data?.truncation, truncation)) continue;
        coverage.push({ kind: "read", toolCallId, call: `${this.journal}#${call.id}`, result: `${this.journal}#${result.id}`, startLine, endLine });
      }
      let covered = 0;
      for (const proof of coverage.sort((a, b) => a.startLine - b.startLine)) {
        if (proof.startLine > covered + 1) break;
        covered = Math.max(covered, proof.endLine);
      }
      if (covered === lines.length) resource.load = { kind: "complete", evidence: coverage };
    }
    if (contract.kind !== "unavailable" && contract.resources.every(resource => resource.load.kind === "not-required" || resource.load.kind === "complete")) {
      contract.kind = "loaded";
      contract.verification = { kind: "verified", scope: "current-selected-resources-and-native-loading" };
    }
    if (contract.kind !== "loaded" && this.pathIssues.size) contract.diagnostics.push({ name: "Native read proof", status: "unverified", message: `${[...this.pathIssues.values()].join(" ")} Reread pending selected resources with these exact absolute paths: ${contract.resources.filter(resource => resource.load.kind === "pending").map(resource => resource.path).join(", ")}.` });
    return contract;
  }
}
