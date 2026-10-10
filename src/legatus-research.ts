import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { Type } from "typebox";
import { z } from "zod";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Centuriones, CenturioRequest, type CenturioIntent } from "./centuriones.js";
import { ResearchOwner, ResearchRecord, ResearchRequest, ResearchObservation, ResearchStage } from "./owned-children.js";
import type { Legion, LegionView } from "./intake.js";
import { publish } from "./private-evidence.js";

/** Composition of the same native owned-child runtime, not a research executor. */
export function installLegatusResearch(pi: ExtensionAPI, host: {
  current: () => Legion | null; context: () => ExtensionContext | null; busy: () => boolean;
  changed: () => Promise<void>; report: (message: string) => void;
}) {
  let runtime: Centuriones | null = null, owner: z.infer<typeof ResearchOwner> | null = null, server: Server | null = null;
  let root: string | null = null;
  let stage: { request: z.infer<typeof ResearchStage>; marker: string; phase: "dispatch" | "prepared" | "running" } | null = null;
  const pending: { kind: "started" | "complete"; raw: unknown }[] = [];
  async function checkOwner(intent: z.infer<typeof CenturioIntent>, stage: "launch" | "read", ctx: ExtensionContext) {
    if (!("role" in intent.owner) || !owner || !isDeepStrictEqual(owner, intent.owner) || ctx.sessionManager.getSessionId() !== owner.session || `${ctx.model?.provider}/${ctx.model?.id}` !== intent.role.parentModel)
      throw new Error("Research principal identity or selected model changed.");
    const result = await host.current()?.submit({ kind: "research-owner-check", owner, id: intent.id, digest: createHash("sha256").update(JSON.stringify(intent)).digest("hex"), stage });
    if (result?.kind !== "research-current") throw new Error(JSON.stringify(result));
  }
  function dispose() { runtime?.dispose(); runtime = null; server?.close(); server = null; owner = null; root = null; pending.length = 0; }
  async function hold(raw: unknown) {
    if (!owner || !root) return;
    const path = join(root, `${randomUUID()}.research-unresolved.json`);
    publish(path, { owner, evidence: raw });
    const result = await host.current()?.submit({ kind: "research-hold", owner, reason: `Structured native research activity is unowned or contradictory. Preserve ${path}; no replacement.` });
    if (result?.kind !== "research-observed") host.report(`Research hold persistence unresolved. Preserve ${path}.`);
    await host.changed();
  }
  function activity(kind: "started" | "complete", raw: unknown, allowPending = true) {
    if (!runtime) return;
    const result = runtime.observeActivity(kind, raw);
    if (result === "pending" && allowPending) pending.push({ kind, raw });
    else if (result !== "owned") void hold({ kind, raw }).catch(error => host.report(String(error)));
  }
  pi.events.on("subagent:async-started", raw => activity("started", raw));
  pi.events.on("subagent:async-complete", raw => activity("complete", raw));
  pi.on("tool_call", async (event, ctx) => {
    if (stage && (event.parentToolCallId || stage.phase !== "running" || !["legion_research", "subagent", "subagents_enable"].includes(event.toolName))) return { block: true, reason: "Research stage permits only its exact preparation and unchanged native child launch, not root exploration or execution." };
    if (event.toolName === "legion_research" && (!stage || event.parentToolCallId || host.busy())) return { block: true, reason: "Research preparation requires its correlated saved public command stage." };
    if (!["subagent", "subagents_enable"].includes(event.toolName)) return;
    if (!runtime) {
      const bindings = z.object({ extensionBindings: z.record(z.string(), z.unknown()) }).safeParse(event.input);
      if (event.toolName === "subagent" && bindings.success && "pi-legion/1" in bindings.data.extensionBindings) return { block: true, reason: "No current research runtime admits this managed intent. Retained intents cannot replay." };
      return stage ? { block: true, reason: "Prepare the exact durable research intent before native child tools." } : undefined;
    }
    if (!stage || stage.phase !== "running") return { block: true, reason: "No correlated research launch stage is active." };
    try { if (host.busy()) throw new Error("Another bounded dispatch is active."); await runtime.admit(event, ctx); }
    catch (error) { return { block: true, reason: String(error) }; }
  });
  pi.on("tool_result", event => { runtime?.observeInput(event); });
  pi.on("tool_execution_end", (event, ctx) => {
    runtime?.observeLaunch(event, ctx);
    if (event.toolName === "subagent") for (const item of pending.splice(0)) activity(item.kind, item.raw, false);
  });
  // Native prose notifications never prove lifecycle or wake the principal for routine logs.
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" && event.text.startsWith("Legion research dispatch ")) {
      const captured = stage;
      if (!captured || captured.phase !== "dispatch" || event.text !== captured.marker) return { action: "handled" };
      const view = await host.current()?.state();
      const saved = view?.snapshot?.researchRequests.find(request => request.id === captured.request.id);
      if (stage !== captured || view?.mode !== "active" || !isDeepStrictEqual(view.researchOwner, captured.request.owner) || saved?.state.kind !== "dispatched" || saved.state.marker !== captured.marker || ctx.sessionManager.getSessionId() !== captured.request.owner.session || host.busy() || !ctx.isIdle() || ctx.hasPendingMessages()) {
        host.report("Research dispatch is held before start. Request and marker remain saved; inspect status, do not replay.");
        return { action: "handled" };
      }
      captured.phase = "prepared";
      return { action: "continue" };
    }
    if (runtime && event.source === "extension" && event.text === "Subagent updates above.") return { action: "handled" };
  });
  pi.on("before_agent_start", event => {
    if (!stage || stage.phase !== "prepared" || event.prompt !== stage.marker) return;
    return { systemPrompt: `${event.systemPrompt}\n\nYou are the current Legatus. This is one bounded preparatory research stage, not intake or implementation. Use legion_research exactly once with task ${JSON.stringify(stage.request.task)} and an applicable configured exploration role. Then use only the returned unchanged native subagent input (native loader/capability discovery if required). Do not read/explore in this principal, run commands, mutate, delegate anything else, approve engineering, assume graph ownership, retry a refusal, or claim child completion from launch. Report only dispatch and wait; findings/lifecycle are retained independently.` };
  });
  pi.on("agent_start", () => { if (stage?.phase === "prepared") stage.phase = "running"; });
  pi.on("agent_settled", async () => {
    const captured = stage;
    if (!captured || captured.phase !== "running") return;
    const result = await host.current()?.submit({ kind: "research-settled", owner: captured.request.owner, id: captured.request.id, marker: captured.marker });
    if (result?.kind !== "research-observed") host.report("Research principal stage settlement is retained locally but its durable acknowledgment is unresolved. Inspect status. This proves no child completion.");
    if (stage === captured) stage = null;
    await host.changed();
  });
  pi.on("context", event => {
    if (!runtime) return;
    return { messages: event.messages.map(message => message.role === "custom" && message.customType === "subagent-notify"
      ? { role: message.role, customType: message.customType, content: "Research notice is informational only. Inspect /legion status for exact owned child state and bounded findings.", display: message.display, timestamp: message.timestamp } : message) };
  });
  async function retainOwner() {
    const view = await host.current()?.state();
    if (view?.unavailable || view?.snapshot?.researchHold || view?.snapshot?.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind))) {
      host.report("Session transition refused: owned research children are active or unresolved. Inspect /legion status; retain this owner until exact native process termination is proven.");
      return { cancel: true };
    }
  }
  pi.on("session_before_switch", retainOwner);
  pi.on("session_before_fork", retainOwner);
  pi.on("session_before_tree", retainOwner);
  pi.on("session_shutdown", () => { dispose(); stage = null; });
  pi.registerTool({
    name: "legion_research", label: "Prepare Legatus research", exposure: "model-only",
    description: "Delegate substantial bounded preparatory read-only research as the current Legatus. Returns an exact native async subagent input; launch that unchanged. No implementation, graph ownership, approval or acceptance. Return concise findings and source references, never full logs.",
    parameters: Type.Object({ task: Type.String({ minLength: 1 }), role: Type.Union([Type.Literal("how explorer"), Type.Literal("why investigators")]), modelIndex: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    execute: async (id, raw, _signal, _update, ctx) => {
      const current = host.current(), view = await current?.state();
      if (!current || !stage || stage.phase !== "running" || !view?.researchOwner || view.mode !== "active" || host.busy() || ctx.sessionManager.getSessionId() !== view.researchOwner.session || !isDeepStrictEqual(stage.request.owner, view.researchOwner)) throw new Error("No current active Legatus research authority.");
      const request = ResearchRequest.parse({ ...z.object({ task: z.string(), role: ResearchRequest.shape.role, modelIndex: z.int().nonnegative().optional() }).strict().parse(raw), kind: "research", requestKey: stage.request.id, owner: view.researchOwner });
      const result = await current.submit(request);
      await host.changed();
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.kind !== "research-prepared" };
    },
  });
  return {
    retire: (view: LegionView) => {
      // Retire only after durable off/drain settlement, never from principal prose or
      // a terminal notification. Disposal removes the native registrations/watchers.
      if (view.mode !== "inactive" || view.unavailable || view.snapshot?.researchHold || view.snapshot?.research.some(record => !["prepared", "process-terminal"].includes(record.child.state.kind)) || runtime?.outstanding || runtime && !view.snapshot) return;
      dispose();
      stage = null;
    },
    busy: () => !!stage,
    dispatch: async (requestId: string, ctx: ExtensionContext) => {
      const current = host.current(), view = await current?.state();
      const request = view?.snapshot?.researchRequests.find(request => request.id === requestId);
      if (!current || !request || stage || host.busy() || !ctx.isIdle() || ctx.hasPendingMessages() || view?.mode !== "active" || !isDeepStrictEqual(view.researchOwner, request.owner)) throw new Error("Research dispatch requires the current idle owner and an unconsumed saved request. Inspect status.");
      const marker = `Legion research dispatch ${randomUUID()}`;
      const result = await current.submit({ kind: "research-dispatch", owner: request.owner, id: request.id, marker });
      if (result.kind !== "research-observed") throw new Error(JSON.stringify(result));
      stage = { request, marker, phase: "dispatch" };
      try { pi.sendUserMessage(marker); }
      catch (error) { host.report(`Research prompt delivery is unresolved. Preserve request ${request.id} and marker ${marker}; do not retry. ${String(error)}`); }
    },
    prepare: async (request: z.infer<typeof ResearchRequest>, binding: z.infer<typeof ResearchOwner>) => {
      const ctx = host.context();
      if (!ctx || ctx.sessionManager.getSessionId() !== binding.session || host.busy()) throw new Error("Current principal is unavailable or busy.");
      if (owner && !isDeepStrictEqual(owner, binding)) {
        if (runtime?.outstanding) throw new Error("Previous research owner has unresolved native children. No adoption.");
        dispose();
      }
      if (!runtime) {
        owner = binding;
        const storage = join(getAgentDir(), "legion");
        root = join(storage, `research-${binding.owner}-${binding.generation}-${binding.epoch}`);
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const endpoint = join(storage, `r-${createHash("sha256").update(JSON.stringify(binding)).digest("hex").slice(0, 32)}.sock`);
        if (Buffer.byteLength(endpoint) >= 108) throw new Error("Research Unix endpoint is unsupported. No transport fallback.");
        const capability = randomUUID();
        runtime = new Centuriones(pi, root, binding, endpoint, capability, checkOwner, (_command, observation) => {
          const parsed = ResearchObservation.safeParse(observation);
          if (parsed.success) void host.current()?.submit(parsed.data).then(async result => {
            if (result.kind !== "research-observed") host.report(`Research projection unresolved. ${JSON.stringify(result)}`);
            await host.changed();
          }).catch(error => host.report(String(error)));
        });
        server = createServer(socket => {
          let buffer = "";
          socket.on("error", () => {});
          socket.on("data", chunk => {
            buffer += chunk;
            if (!buffer.includes("\n")) return;
            socket.pause();
            void (async () => {
              try {
                const ctx = host.context();
                if (!ctx || !runtime || ctx.sessionManager.getSessionId() !== binding.session) throw new Error("Owning Legatus is unavailable.");
                const raw: unknown = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
                socket.end(JSON.stringify(await runtime.checkChild(raw, ctx)) + "\n");
              } catch (error) { socket.end(JSON.stringify({ kind: "held", message: String(error) }) + "\n"); }
            })();
          });
        });
        await new Promise<void>((resolve, reject) => { server?.once("error", reject); server?.listen(endpoint, resolve); });
        server.unref();
      }
      const prepared = runtime.prepare(CenturioRequest.parse({ purpose: "exploration", role: request.role, modelIndex: request.modelIndex, task: `${request.task}\n\nReturn bounded findings and precise file/line or source references, not full logs. Do not mutate, execute commands, delegate or claim acceptance.` }), { command: request.requestKey, research: "preparatory-read-only" }, { owner: binding.owner, session: binding.session, generation: binding.generation, epoch: binding.epoch }, ctx, undefined, request.requestKey);
      return ResearchRecord.parse({ id: request.requestKey, owner: binding, task: request.task, intent: { path: prepared.evidence, digest: prepared.launch.extensionBindings["pi-legion/1"].digest }, sequence: 0,
        child: { id: prepared.intent, purpose: "exploration", model: prepared.launch.model, state: { kind: "prepared" }, result: null, evidence: [prepared.evidence] }, launch: prepared.launch });
    },
  };
}
