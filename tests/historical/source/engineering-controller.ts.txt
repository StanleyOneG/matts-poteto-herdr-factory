import { approvedSeam } from "./engineering.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Legion, LegionView } from "./intake.js";
import { EngineeringDecision, type EngineeringRecord } from "./snapshot.js";
import { LocalTribunusHost } from "./tribunus-host.js";
import type { TribunusHost } from "./tribunus.js";

type Controller = {
  current: () => Legion | null;
  context: () => ExtensionContext | null;
  busy: () => boolean;
  report: (message: string) => void;
  deliver: (host: TribunusHost, action: () => ReturnType<Legion["command"]>) => ReturnType<Legion["command"]>;
};
const DeliveryArguments = z.object({ requestId: z.uuid() }).strict();
const ShellReceipt = z.object({ output: z.string(), exit_code: z.int(), truncated: z.literal(false) });
type Stage = {
  purpose: "decision" | "delivery";
  task: LegionView["tasks"][number]["history"][number];
  marker: string;
  run: string;
  request: z.infer<typeof EngineeringRecord>;
  seam: z.infer<typeof EngineeringRecord> | null;
  phase: { kind: "dispatch" | "prepared" | "settled" | "held" } | { kind: "running"; call: string };
};
export function installEngineeringController(pi: ExtensionAPI, controller: Controller) {
  let stage: Stage | null = null;
  let closed = false;
  const attempted = new Map<string, "attempted" | "deferred" | "held">();
  async function current(pending: Stage, ctx: ExtensionContext) {
    const legion = controller.current();
    const view = await legion?.state();
    const pin = pending.request.pin;
    return legion === controller.current() && !closed && stage === pending && view?.mode === "active" && view.snapshot?.id === pin.owner && view.snapshot.generation === pin.generation && ctx.sessionManager.getSessionId() === pin.session && view.snapshot.engineering.some(record => record.id === pending.request.id && record.digest === pending.request.digest && record.state.kind === (pending.purpose === "decision" ? "open" : "decided"));
  }
  async function schedule() {
    const legion = controller.current(), ctx = controller.context();
    if (!legion || !ctx || closed || stage || controller.busy() || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    const view = await legion.state();
    if (legion !== controller.current() || stage || closed || controller.busy() || !ctx.isIdle() || ctx.hasPendingMessages() || view.mode !== "active" || !view.snapshot) return;
    const request = view.snapshot.engineering.find(record => (record.state.kind === "open" || record.state.delivery.kind === "pending") && record.pin.session === ctx.sessionManager.getSessionId() && record.pin.generation === view.snapshot?.generation && (attempted.get(`${record.id}/${record.state.kind}`) ?? "deferred") === "deferred");
    if (!request) return;
    const task = view.tasks.find(task => task.id === request.pin.task.id)?.history.at(-1);
    if (!task) { controller.report("Engineering proposal task is unavailable. Proposal retained."); return; }
    const pending: Stage = { purpose: request.state.kind === "open" ? "decision" : "delivery", task, marker: `Legion engineering dispatch ${randomUUID()}`, run: randomUUID(), request, seam: approvedSeam(view.snapshot.engineering, request), phase: { kind: "dispatch" } };
    stage = pending;
    attempted.set(`${request.id}/${request.state.kind}`, "attempted");
    try { pi.sendUserMessage(pending.marker); }
    catch (error) {
      if (stage === pending) pending.phase = { kind: "held" };
      controller.report(`Engineering dispatch outcome is unresolved. Proposal retained. Do not retry automatically. Inspect the session journal and status before restarting. ${String(error)}`);
    }
  }
  function retire(pending: Stage, disposition: "deferred" | "held", reason: string) {
    if (stage !== pending || pending.phase.kind !== "dispatch") return;
    try {
      pi.appendEntry("legion-engineering-dispatch-retired", { marker: pending.marker, request: pending.request.id, purpose: pending.purpose, disposition, reason });
    } catch (error) {
      pending.phase = { kind: "held" };
      controller.report(`Engineering dispatch held. Deferral evidence could not be retained. Inspect the session journal before restarting. ${String(error)}`);
      return;
    }
    attempted.set(`${pending.request.id}/${pending.request.state.kind}`, disposition);
    stage = null;
    controller.report(`${reason} Proposal ${pending.request.id} retained. ${disposition === "deferred" ? "Scheduling can continue after queued input settles." : "Restore authority or authentication, then explicitly /legion resume the saved Legatus."}`);
  }
  pi.on("input", async (event, ctx) => {
    if (event.source !== "extension" || !event.text.startsWith("Legion engineering dispatch ")) return;
    const pending = stage;
    if (!pending || pending.phase.kind !== "dispatch" || event.text !== pending.marker) return { action: "handled" };
    if (event.streamingBehavior || !ctx.isIdle() || ctx.hasPendingMessages() || controller.busy()) {
      retire(pending, "deferred", "Engineering dispatch deferred before start.");
      return { action: "handled" };
    }
    try {
      if (!await current(pending, ctx)) {
        retire(pending, "held", "Engineering authority changed before start.");
        return { action: "handled" };
      }
      const model = ctx.model;
      const auth = model ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : null;
      if (stage !== pending || pending.phase.kind !== "dispatch") return { action: "handled" };
      if (!model || !auth?.ok || (!auth.apiKey && !ctx.modelRegistry.hasConfiguredAuth(model))) {
        retire(pending, "held", "Engineering authentication is unavailable before start.");
        return { action: "handled" };
      }
      if (!await current(pending, ctx)) {
        retire(pending, "held", "Engineering authority changed before start.");
        return { action: "handled" };
      }
    } catch (error) {
      retire(pending, "held", `Engineering admission lookup unavailable. ${String(error)}`);
      return { action: "handled" };
    }
    if (stage !== pending || pending.phase.kind !== "dispatch") return { action: "handled" };
    if (controller.busy() || !ctx.isIdle() || ctx.hasPendingMessages()) {
      retire(pending, "deferred", "Engineering dispatch deferred before start.");
      return { action: "handled" };
    }
    pending.phase = { kind: "prepared" };
    return { action: "continue" };
  });
  pi.on("before_agent_start", (event) => {
    if (stage?.phase.kind !== "prepared" || event.prompt !== stage.marker) return;
    if (stage.purpose === "delivery") return {
      systemPrompt: `${event.systemPrompt}\n\nUse only legion_engineering_deliver with requestId ${JSON.stringify(stage.request.id)}, once. This delivers an already committed decision under its retained command. Do not reinterpret it, execute other tools, or retry an uncertain result. No mutation is authorized.`,
      message: { customType: "legion-engineering-delivery", display: false, content: `Retained engineering decision ${stage.request.id}`, details: undefined }
    };
    return {
      systemPrompt: `${event.systemPrompt}\n\nYou are the Legatus deciding one worker engineering proposal within its existing bounded task. Use only legion_engineering_decide, once. For a seam, approve only an in-scope meaningful public behavior test. For an exception, assess the exact current approved seam, named behavior, omitted test, rationale, and concrete alternative native bash plan. Approve only a necessary omission with meaningful alternative verification of that same behavior. Never grant blanket TDD skipping or expanded product scope. Decline inadequate verification or escalate product ambiguity. Do not execute work, interpret intake, supply identity, or grant mutation. An approval does not replace current effect admission or actual skill loading.`,
      message: { customType: "legion-engineering-decision", display: false,
        content: JSON.stringify({ request: stage.request.id, proposal: stage.request.proposal, approvedSeam: stage.seam, task: stage.task, taskRef: stage.request.pin.task, scope: stage.request.pin.scope }), details: undefined }
    };
  });
  pi.on("tool_call", event => {
    if (!stage) {
      if (["legion_engineering_decide", "legion_engineering_deliver"].includes(event.toolName)) return { block: true, reason: "No correlated Legatus engineering decision turn is active." };
      return;
    }
    const delivery = DeliveryArguments.safeParse(event.input);
    const admitted = stage.purpose === "decision"
      ? event.toolName === "legion_engineering_decide" && EngineeringDecision.safeParse(event.input).success
      : event.toolName === "legion_engineering_deliver" && delivery.success && delivery.data.requestId === stage.request.id;
    if (stage.phase.kind === "prepared" && !event.parentToolCallId && admitted) {
      stage.phase = { kind: "running", call: event.toolCallId };
      return;
    }
    if (stage.purpose === "delivery" && stage.phase.kind === "running" && event.toolName === "bash" && event.parentToolCallId === stage.phase.call) return;
    return { block: true, reason: "Engineering decision stage permits only its one correlated decision tool with no supplied identity or request." };
  });
  pi.registerTool({
    name: "legion_engineering_decide", label: "Legion engineering decision", exposure: "model-only",
    description: "Decide the exact worker proposal presented by the current Legatus engineering turn. Supply only the decision and rationale.",
    parameters: Type.Unsafe<z.infer<typeof EngineeringDecision>>(z.toJSONSchema(EngineeringDecision)),
    execute: async (toolCallId, raw, _signal, _update, ctx) => {
      const pending = stage, legion = controller.current();
      if (!pending || pending.purpose !== "decision" || pending.phase.kind !== "running" || pending.phase.call !== toolCallId || !legion || !await current(pending, ctx)) throw new Error("No current correlated engineering decision authority.");
      try {
        const request = pending.request, pin = request.pin;
        const result = await legion.submit({ kind: "engineering-decision", requestKey: pending.run,
          request: { id: request.id, digest: request.digest }, decision: EngineeringDecision.parse(raw),
          evidence: { kind: "legatus", owner: pin.owner, session: ctx.sessionManager.getSessionId(), generation: pin.generation, epoch: pin.epoch,
            run: pending.run, requests: [{ id: request.id, digest: request.digest }] }
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.kind === "rejected" || result.kind === "uncertain" };
      } finally { pending.phase = { kind: "settled" }; }
    }
  });
  pi.registerTool({
    name: "legion_engineering_deliver", label: "Legion engineering delivery", exposure: "model-only",
    description: "Deliver the exact retained decision during its correlated host stage. Never supply a decision or identity.",
    parameters: Type.Unsafe<z.infer<typeof DeliveryArguments>>(z.toJSONSchema(DeliveryArguments)),
    execute: async (toolCallId, raw, _signal, _update, ctx) => {
      const pending = stage, legion = controller.current();
      const args = DeliveryArguments.parse(raw);
      if (!pending || pending.purpose !== "delivery" || pending.phase.kind !== "running" || pending.phase.call !== toolCallId || pending.request.id !== args.requestId || !legion || !await current(pending, ctx)) throw new Error("No current correlated engineering delivery authority.");
      try {
        const pin = pending.request.pin;
        const host = new LocalTribunusHost(async command => {
          if (!await current(pending, ctx)) throw new Error("Engineering delivery authority changed before its guarded effect.");
          const result = await ctx.executeTool("bash", { command });
          const parsed = ShellReceipt.safeParse(result.result.structuredContent);
          return parsed.success ? { kind: "finished", code: parsed.data.exit_code, output: parsed.data.output }
            : { kind: "unknown", message: "Guarded engineering transport completion is unavailable." };
        }, { owner: pin.owner, session: pin.session, generation: pin.generation, epoch: pin.epoch }, controller.report);
        const result = await controller.deliver(host, () => legion.command({ engineeringDelivery: args.requestId }));
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.kind === "rejected" || result.kind === "uncertain" };
      } finally { pending.phase = { kind: "settled" }; }
    }
  });
  pi.on("agent_settled", () => {
    if (stage && stage.phase.kind !== "dispatch" && stage.phase.kind !== "held") stage = null;
    setTimeout(() => { void schedule().catch(error => controller.report(String(error))); }, 0);
  });
  pi.on("session_start", () => { closed = false; stage = null; attempted.clear(); });
  pi.on("session_shutdown", () => { closed = true; stage = null; });
  return {
    schedule,
    busy: () => stage !== null,
    resume: () => {
      for (const [request, disposition] of attempted) {
        if (disposition !== "held") continue;
        pi.appendEntry("legion-engineering-dispatch-resumed", { request });
        attempted.set(request, "deferred");
      }
    },
  };
}
