import { installEngineeringController } from '../../src/engineering-controller.ts';

export function controllerFixture(legion, context, deliver, withHost = async (_host, action) => action()) {
  const handlers = new Map(), tools = new Map(), messages = [], notices = [], entries = [];
  let idle = true, pending = false, rootCall;
  const ctx = {
    cwd: context, mode: 'tui', isIdle: () => idle, hasPendingMessages: () => pending,
    sessionManager: { getSessionId: () => 'controller' },
    model: { provider: 'test', id: 'selected' },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'test' }), hasConfiguredAuth: () => true },
    executeTool: async (name, input) => {
      const refusal = await handlers.get('tool_call')({ toolName: name, input, toolCallId: `${rootCall}/1`, parentToolCallId: rootCall }, ctx);
      if (refusal?.block) throw new Error(refusal.reason);
      return deliver(input.command);
    }
  };
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerTool: tool => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ customType, data }),
    sendUserMessage: text => messages.push(text)
  };
  const stage = installEngineeringController(pi, {
    current: () => legion, context: () => ctx, busy: () => false,
    report: message => notices.push(message),
    deliver: withHost
  });
  return {
    messages, notices,
    schedule: () => stage.schedule(),
    setBusy: value => { idle = !value; },
    setPending: value => { pending = value; },
    start: async marker => {
      const input = await handlers.get('input')({ source: 'extension', text: marker }, ctx);
      if (input?.action === 'handled') return input;
      const prepared = await handlers.get('before_agent_start')({ prompt: marker, systemPrompt: '' }, ctx);
      idle = false;
      return prepared;
    },
    call: async (toolName, input, id = 'model-call') => {
      const guard = await handlers.get('tool_call')({ toolName, input, toolCallId: id }, ctx);
      if (guard?.block) return guard;
      rootCall = id;
      try { return await tools.get(toolName).execute(id, input, undefined, undefined, ctx); }
      catch (error) { return { error: String(error) }; }
    },
    settle: async () => { idle = true; await handlers.get('agent_settled')({}, ctx); },
    close: () => handlers.get('session_shutdown')?.({}, ctx)
  };
}
