import { createConnection } from "node:net";
import { mkdirSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createReadToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition, type ToolDefinition, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { z } from "zod";
import { CenturioBinding, readCenturio, digest } from "./centuriones.js";
import { EffectIntent, EffectReply, EffectRecord, EffectOutcome } from "./snapshot.js";
import { EngineeringContract } from "./engineering-contract.js";
import { publish } from "./private-evidence.js";
import { verifyCenturioWorkspace } from "./centurio-workspace.js";

export default function centurioGuard(pi: ExtensionAPI) {
  if (process.env.PI_SUBAGENT_CHILD !== "1") throw new Error("The mandatory Centurio guard requires a native child runtime.");
  const bindings = z.record(z.string(), z.unknown()).parse(JSON.parse(process.env.PI_SUBAGENT_EXTENSION_BINDINGS ?? "null"));
  const binding = CenturioBinding.parse(bindings["pi-legion/1"]);
  const record = readCenturio(binding), intent = record.intent;
  let session: string | null = null, run: string | null = null, hold: string | null = null;
  let contract: EngineeringContract | null = null;
  const owners = new Map<string, string>();
  const admitted = new Map<string, { name: string; input: unknown; effect?: z.infer<typeof EffectRecord> }>();
  const attempted = new Set<string>();
  const prepare = new Map<string, (id: string, raw: unknown) => z.infer<ReturnType<typeof z.json>>>();
  const NativeCall = z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }).passthrough();
  const NativeMessage = z.object({ id: z.string(), type: z.literal("message"), message: z.object({ role: z.literal("assistant"), content: z.array(z.unknown()) }).passthrough() }).passthrough();
  function preparedEntry(entry: unknown) {
    const parsed = NativeMessage.safeParse(entry);
    if (!parsed.success) return entry;
    return { ...parsed.data, message: { ...parsed.data.message, content: parsed.data.message.content.map(part => {
      const call = NativeCall.safeParse(part);
      if (!call.success) return part;
      const nativePrepare = prepare.get(call.data.name);
      if (!nativePrepare) return part;
      try { return { ...call.data, arguments: nativePrepare(call.data.id, call.data.arguments) }; }
      catch { return part; }
    }) } };
  }
  const shellSettings = () => ({ shellPath: pi.getSettings().shellPath, shellCommandPrefix: pi.getSettings().shellCommandPrefix });
  let shell: ReturnType<typeof shellSettings> | null = null;
  const owner = (name: string) => pi.getAllTools().find(tool => tool.name === name)?.sourceInfo.path;
  const root = join(dirname(binding.path), `${intent.id}.child-effects`);
  function check(ctx: ExtensionContext, stage: "startup" | "effect") {
    const journal = ctx.sessionManager.getSessionFile();
    if (!journal || !ctx.model) throw new Error("Actual Centurio model or journal is unavailable.");
    return { kind: "centurio-check", stage, binding, capability: intent.capability, session: ctx.sessionManager.getSessionId(), journal, cwd: realpathSync(ctx.cwd), model: `${ctx.model.provider}/${ctx.model.id}` };
  }
  async function request(value: unknown, ctx: ExtensionContext) {
    return new Promise<unknown>((resolveReply, reject) => {
      const socket = createConnection(intent.endpoint);
      let buffer = "", answered = false;
      const abort = () => socket.destroy(new Error("Centurio owner check was aborted. Preserve this intent."));
      ctx.signal?.addEventListener("abort", abort, { once: true });
      socket.on("connect", () => socket.write(JSON.stringify(value) + "\n"));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        try { resolveReply(JSON.parse(buffer.slice(0, buffer.indexOf("\n")))); answered = true; socket.end(); }
        catch (error) { socket.destroy(); reject(error); }
      });
      socket.on("error", reject);
      socket.on("close", () => { ctx.signal?.removeEventListener("abort", abort); if (!answered) reject(new Error("Centurio owner response is unknown. No child work authorized.")); });
    });
  }
  async function authorize(ctx: ExtensionContext, stage: "startup" | "effect") {
    if (hold) throw new Error(hold);
    const reply = await request(check(ctx, stage), ctx);
    const checked = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("centurio-authorized"), digest: z.string(), session: z.string(), run: z.string().optional() }), z.object({ kind: z.literal("held"), message: z.string() })]).parse(reply);
    if (checked.kind !== "centurio-authorized") throw new Error(checked.message);
    if (checked.digest !== binding.digest || checked.session !== ctx.sessionManager.getSessionId() || realpathSync(ctx.cwd) !== intent.cwd || `${ctx.model?.provider}/${ctx.model?.id}` !== intent.role.model || session !== null && checked.session !== session || run !== null && checked.run !== run) throw new Error("Centurio owner response does not match this exact child identity.");
    if (intent.writable) verifyCenturioWorkspace(intent.writable.workspace, intent.writable.parentCwd);
    session = checked.session;
    if (checked.run) run = checked.run;
  }
  function verifyFileInput(name: string, input: unknown) {
    if (["write", "edit"].includes(name)) {
      const path = z.object({ path: z.string() }).parse(input).path;
        if (/^(?:@|~|file:\/\/)|[\u00a0\u2000-\u200a\u202f\u205f\u3000]/u.test(path)) throw new Error("Use an exact ordinary native path for owned file mutation; alternate path expansion cannot establish this boundary.");
        const target = resolve(intent.cwd, path), delta = relative(intent.cwd, target);
        if (!delta || delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta) || delta === ".git" || delta.startsWith(`.git${sep}`)) throw new Error("Native file mutation must stay within the owned child task files, not parent or Git metadata.");
        try { if (lstatSync(target).isSymbolicLink()) throw new Error("Native file mutation cannot target a symlink."); }
        catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
        let ancestor = target;
        for (;;) { try { if (realpathSync(ancestor) !== ancestor) throw new Error("Native file mutation cannot traverse a symlink outside its owned workspace."); break; } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; ancestor = dirname(ancestor); } }
      }
  }
  async function observe(effect: z.infer<typeof EffectRecord>, state: z.infer<typeof EffectOutcome>, ctx: ExtensionContext) {
    publish(join(root, `${effect.intent.id}.outcome.json`), { id: effect.intent.id, digest: effect.digest, state });
    const reply = EffectReply.parse(await request({ kind: "centurio-effect", check: check(ctx, "effect"), message: { kind: "effect-observation", id: effect.intent.id, digest: effect.digest, state } }, ctx));
    if (reply.kind !== "effect" || reply.effect.digest !== effect.digest || !isDeepStrictEqual(reply.effect.state, state)) throw new Error("Child effect observation is unresolved. Preserve its admission and native result.");
  }
  pi.on("session_start", async (_event, ctx) => {
    if (intent.purpose === "implementation" && (!intent.writable || !ctx.isProjectTrusted())) throw new Error("Writable native child requires its retained workspace and normal project trust.");
    await authorize(ctx, "startup");
    const names = intent.writable ? ["read", "grep", "find", "ls", "write", "edit", "bash"] : ["read", "grep", "find", "ls"];
    for (const name of names) if (owner(name) !== `builtin:${name}`) throw new Error(`Centurio requires native ${name}. A configured override must not be replaced.`);
    shell = shellSettings();
    function wrap<T extends TSchema, D, S>(native: ToolDefinition<T, D, S>): ToolDefinition<T, D, S> {
      prepare.set(native.name, (id, raw) => {
        const original = structuredClone(raw);
        const input = z.record(z.string(), z.json()).parse(native.prepareArguments ? native.prepareArguments(original) : original);
        return z.json().parse(validateToolArguments(native, { type: "toolCall", id, name: native.name, arguments: input }));
      });
      return { ...native, execute: async (id, args, signal, update, toolContext) => {
        const admission = admitted.get(id);
        admitted.delete(id);
        const input = structuredClone(args);
        const unchanged = () => session !== null && !signal?.aborted && owner(native.name) === owners.get(native.name) && admission?.name === native.name && isDeepStrictEqual(input, admission.input) && isDeepStrictEqual(args, input) && (!intent.writable || isDeepStrictEqual(shell, shellSettings()));
        try {
          if (!unchanged()) throw new Error("Final input or native tool ownership differs from its unused admission.");
          await authorize(toolContext, "effect");
          verifyFileInput(native.name, input);
          if (!unchanged() || !toolContext.model || `${toolContext.model.provider}/${toolContext.model.id}` !== intent.role.model || toolContext.sessionManager.getSessionId() !== session || realpathSync(toolContext.cwd) !== intent.cwd || admission?.effect && !isDeepStrictEqual(contract?.snapshot(toolContext), admission.effect.intent.contract)) throw new Error("Centurio input, model, session, resources or native ownership changed during final authorization.");
        } catch (error) {
          if (admission?.effect) {
            const evidence = join(root, `${admission.effect.intent.id}.native-result.json`);
            publish(evidence, { kind: "refused", reason: String(error) });
            await observe(admission.effect, { kind: "refused", reason: String(error), evidence }, toolContext);
          }
          throw error;
        }
        if (!admission?.effect) return native.execute(id, input, signal, update, toolContext);
        const effect = admission.effect, evidence = join(root, `${effect.intent.id}.native-result.json`);
        try {
          const result = await native.execute(id, input, signal, update, toolContext);
          publish(evidence, { kind: "native-result", id: effect.intent.id, call: id, result });
          const exit = native.name === "bash" ? z.object({ exit_code: z.int() }).safeParse(result.structuredContent) : null;
          await observe(effect, { kind: "completed", evidence, isError: result.isError ?? false, ...(exit?.success ? { exitCode: exit.data.exit_code } : {}) }, toolContext);
          return result;
        } catch (error) {
          hold = `Child native effect ${effect.intent.id} has an unresolved outcome. Preserve it. ${String(error)}`;
          const failure = join(root, `${effect.intent.id}.native-unknown.json`);
          publish(failure, { kind: "unknown", reason: String(error) });
          try { await observe(effect, { kind: "unknown", reason: String(error), evidence: failure }, toolContext); } catch { /* Local durable hold remains authoritative until owner reconciliation. */ }
          throw error;
        }
      } };
    }
    pi.registerTool(wrap(createReadToolDefinition(ctx.cwd, { autoResizeImages: pi.getSettings().images?.autoResize ?? true })));
    pi.registerTool(wrap(createGrepToolDefinition(ctx.cwd)));
    pi.registerTool(wrap(createFindToolDefinition(ctx.cwd)));
    pi.registerTool(wrap(createLsToolDefinition(ctx.cwd)));
    if (intent.writable) {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      pi.registerTool(wrap(createWriteToolDefinition(ctx.cwd)));
      pi.registerTool(wrap(createEditToolDefinition(ctx.cwd)));
      pi.registerTool(wrap(createBashToolDefinition(ctx.cwd, { ...(shell.shellPath ? { shellPath: shell.shellPath } : {}), ...(shell.shellCommandPrefix ? { commandPrefix: shell.shellCommandPrefix } : {}) })));
    }
    for (const name of names) {
      const source = owner(name);
      if (!source || source === `builtin:${name}`) throw new Error(`Native ${name} final-execution boundary is unavailable.`);
      owners.set(name, source);
    }
    if (intent.writable) {
      const readOwner = owners.get("read"), journal = ctx.sessionManager.getSessionFile();
      if (!readOwner || !journal) throw new Error("Native read owner/journal unavailable for child contract loading.");
      contract = new EngineeringContract(pi, ctx.cwd, journal, readOwner);
    }
    pi.events.emit("subagent:acknowledge-extension", { id: "pi-legion-centurio" });
  });
  pi.on("tool_call", async (event, ctx) => {
    if (event.parentToolCallId || !owners.has(event.toolName) || owner(event.toolName) !== owners.get(event.toolName)) return { block: true, reason: "This Centurio permits only admitted native tools, not overrides or delegation." };
    let requested: z.infer<typeof EffectIntent> | null = null;
    try {
      const input = structuredClone(event.input);
      await authorize(ctx, "effect");
      if (admitted.has(event.toolCallId) || attempted.has(event.toolCallId)) throw new Error("Native call already consumed an admission.");
      if (!["write", "edit", "bash"].includes(event.toolName)) {
        contract?.captureRead(event);
        admitted.set(event.toolCallId, { name: event.toolName, input });
        return;
      }
      attempted.add(event.toolCallId);
      const writable = intent.writable, snapshot = contract?.snapshot(ctx);
      if (!writable || writable.engineering.state.kind !== "decided" || snapshot?.verification.kind !== "verified" || !run) throw new Error("Writable child requires current approved engineering and complete actual native resource loading.");
      verifyFileInput(event.toolName, input);
      const journal = ctx.sessionManager.getSessionFile();
      if (!journal) throw new Error("Child assistant journal unavailable.");
      const persisted = new Map(readFileSync(journal, "utf8").trimEnd().split("\n").map(line => {
        const entry = z.object({ id: z.string() }).passthrough().parse(JSON.parse(line));
        return [entry.id, entry];
      }));
      // Preparation compares clones; admissions retain the original persisted raw arguments.
      const branch = ctx.sessionManager.getBranch().filter(entry => isDeepStrictEqual(preparedEntry(persisted.get(entry.id)), preparedEntry(entry)));
      const calls = branch.flatMap(entry => {
        const stored = NativeMessage.safeParse(persisted.get(entry.id));
        if (!stored.success) return [];
        return stored.data.message.content.flatMap(part => {
          const call = NativeCall.safeParse(part);
          if (!call.success || call.data.id !== event.toolCallId || call.data.name !== event.toolName || !isDeepStrictEqual(prepare.get(event.toolName)?.(call.data.id, call.data.arguments), input)) return [];
          return [{ entry: entry.id, rawInput: call.data.arguments }];
        });
      });
      const call = calls[0];
      if (calls.length !== 1 || !call || branch.some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === event.toolCallId)) throw new Error("Exact fresh actual child assistant call is unavailable.");
      const engineering = writable.engineering;
      if (engineering.state.kind !== "decided") throw new Error("Applied engineering decision unavailable.");
      requested = EffectIntent.parse({ id: randomUUID(), pin: engineering.pin, decision: { id: engineering.id, digest: engineering.digest, command: engineering.state.delivery.command }, seam: engineering.proposal.kind === "seam" ? { id: engineering.id, digest: engineering.digest } : engineering.proposal.seam, contract: snapshot,
        call: { id: event.toolCallId, name: event.toolName, input, rawInput: call.rawInput, journal: `${journal}#${call.entry}` },
        origin: { kind: "centurio", child: { id: intent.id, digest: record.digest }, intent: binding.path, run, session, journal, cwd: intent.cwd, branch: writable.workspace.plan.branch, base: writable.workspace.plan.commit } });
      publish(join(root, `${requested.id}.intent.json`), requested);
      const reply = EffectReply.parse(await request({ kind: "centurio-effect", check: check(ctx, "effect"), message: { kind: "effect-admission", intent: requested } }, ctx));
      if (reply.kind !== "effect") {
        if (reply.kind === "resource-invalidated") contract?.retireProof();
        if (reply.kind === "rejected" || reply.kind === "resource-invalidated") requested = null;
        throw new Error(JSON.stringify(reply));
      }
      if (!isDeepStrictEqual(reply.effect.intent, requested) || reply.effect.digest !== digest(requested) || reply.effect.state.kind !== "outstanding") throw new Error("Child admission response does not match its exact unused native intent.");
      publish(join(root, `${requested.id}.admission.json`), reply.effect);
      admitted.set(event.toolCallId, { name: event.toolName, input, effect: reply.effect });
    } catch (error) {
      if (requested) hold = `Owned child admission ${requested.id} is unresolved. Preserve the same identity. ${String(error)}`;
      return { block: true, reason: hold ?? String(error) };
    }
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    const admission = admitted.get(event.toolCallId);
    admitted.delete(event.toolCallId);
    if (admission?.effect) {
      const evidence = join(root, `${admission.effect.intent.id}.native-result.json`);
      publish(evidence, { kind: "tool-pipeline-end", isError: event.isError, result: event.result });
      await observe(admission.effect, { kind: event.isError ? "refused" : "unknown", reason: "Ordinary native pipeline ended this admitted call without execution.", evidence }, ctx);
    }
  });
  pi.on("session_shutdown", () => { admitted.clear(); owners.clear(); session = null; });
}
