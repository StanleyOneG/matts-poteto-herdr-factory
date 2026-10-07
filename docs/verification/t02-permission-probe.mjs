import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'legion-t02-permission-'));
const agent = join(root, 'agent');
const cwd = join(root, 'repo');
await mkdir(agent);
await mkdir(cwd);
const hash = value => createHash('sha256').update(value).digest('hex');
const hostSettings = join(homedir(), '.pi/agent/settings.json');
const hostBefore = hash(await readFile(hostSettings));
execFileSync('git', ['init', '-q', cwd]);
execFileSync('git', ['-C', cwd, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.test', 'commit', '--allow-empty', '-qm', 'test-owned parent']);
const parent = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD']).toString().trim();
const evidence = { root, cwd, parent, version: execFileSync('pi', ['--version']).toString().trim(), hostBefore, scenarios: [] };
let mode = 'denied';
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const data of req) raw += data;
  const body = JSON.parse(raw);
  const answer = body.messages.at(-1)?.role === 'tool'
    ? { role: 'assistant', content: 'Probe finished.' }
    : { role: 'assistant', tool_calls: [{ index: 0, id: 'probe_' + mode, type: 'function', function: { name: 'permission_probe', arguments: JSON.stringify({ mode }) } }] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason) => ({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: 'controlled', choices: [{ index: 0, delta, finish_reason }] });
  res.write('data: ' + JSON.stringify(chunk(answer, null)) + '\n\n');
  res.write('data: ' + JSON.stringify(chunk({}, answer.tool_calls ? 'tool_calls' : 'stop')) + '\n\n');
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'test-owned-not-secret', models: [{ id: 'controlled', name: 'Probe fixture', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
const extension = join(root, 'probe.js');
await writeFile(extension, `export default function (pi) {
  let denied = true;
  const hooks = [];
  pi.on('tool_call', event => {
    hooks.push({ name: event.toolName, id: event.toolCallId, input: event.input });
    if (event.toolName === 'bash' && denied) return { block: true, reason: 'TEST-OWNED bash denied' };
  });
  if (process.env.PROBE_OVERRIDE === '1') pi.registerTool({
    name: 'bash', label: 'Test-owned bash override', description: 'Test override',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    execute: async () => ({ content: [{ type: 'text', text: 'OVERRIDE ONLY. No command executed.' }], details: { override: true } })
  });
  pi.registerCommand('probe-direct', { handler: async (_, ctx) => {
    const result = await pi.exec('git', ['--version']);
    ctx.ui.notify(JSON.stringify({ stage: 'direct', hasExecuteTool: typeof ctx.executeTool, result, hooks }), 'info');
  } });
  pi.registerTool({ name: 'permission_probe', label: 'Permission probe', description: 'Test-owned probe',
    parameters: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] },
    execute: async (_, args, signal, update, ctx) => {
      denied = args.mode === 'denied';
      const result = await ctx.executeTool('bash', { command: 'git branch nested-' + args.mode + ' ${parent}' });
      const data = { stage: 'nested', mode: args.mode, result, hooks };
      ctx.ui.notify(JSON.stringify(data), 'info');
      return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    }
  });
}`);
const env = { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', TERM: 'xterm-256color' };
async function scenario(override) {
  const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-context-files', '-e', extension, '--provider', 'fixture', '--model', 'controlled', '--thinking', 'off'], { cwd, env: { ...env, PROBE_OVERRIDE: override ? '1' : '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', seq = 0;
  const records = [], waiters = new Map();
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const record = JSON.parse(line); records.push(record);
      if (record.type === 'response') { waiters.get(record.id)?.(record); waiters.delete(record.id); }
    }
  });
  const rpc = (type, fields = {}) => new Promise((resolve, reject) => {
    const id = String(++seq);
    waiters.set(id, record => record.success ? resolve(record) : reject(new Error(record.error)));
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
  });
  const settled = () => new Promise((resolve, reject) => {
    const scan = () => {
      if (records.some(record => record.type === 'agent_settled')) { clearInterval(timer); resolve(); }
      else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(stderr)); }
    };
    const timer = setInterval(scan, 10);
  });
  try {
    await rpc('get_state');
    if (!override) {
      await rpc('prompt', { message: '/probe-direct' });
      const direct = records.find(record => record.method === 'notify' && record.message?.includes('"stage":"direct"'));
      assert.ok(direct);
      const data = JSON.parse(direct.message);
      assert.equal(data.hasExecuteTool, 'undefined');
      assert.equal(data.result.code, 0);
      assert.match(data.result.stdout, /git version/);
      assert.deepEqual(data.hooks, []);
    }
    await rpc('prompt', { message: 'Run the test-owned permission probe.' });
    await settled();
    const nested = records.find(record => record.method === 'notify' && record.message?.includes('"stage":"nested"'));
    assert.ok(nested, stderr + JSON.stringify(records));
    const data = JSON.parse(nested.message);
    if (mode === 'denied') {
      assert.equal(data.result.isError, true);
      assert.match(JSON.stringify(data.result.result), /TEST-OWNED bash denied/);
    } else if (override) {
      assert.equal(data.result.isError, false);
      assert.match(JSON.stringify(data.result.result), /OVERRIDE ONLY/);
    } else assert.equal(data.result.isError, false);
    assert.ok(data.hooks.some(hook => hook.name === 'bash' && hook.id === 'probe_' + mode + '/1'));
    evidence.scenarios.push({ mode, override, records, stderr });
  } finally {
    child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
}
try {
  await scenario(false);
  mode = 'allowed'; await scenario(false);
  mode = 'override'; await scenario(true);
  const branches = execFileSync('git', ['-C', cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']).toString();
  assert.match(branches, /refs\/heads\/nested-allowed/);
  assert.doesNotMatch(branches, /nested-denied|nested-override/);
  evidence.branches = branches;
  evidence.hostAfter = hash(await readFile(hostSettings));
  assert.equal(evidence.hostAfter, hostBefore);
  evidence.scriptSha256 = hash(await readFile('/tmp/legion-t02-permission-probe.mjs'));
  evidence.extensionSha256 = hash(await readFile(extension));
  const out = process.argv[2];
  await writeFile(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, root, parent, branches, hostBefore, hostAfter: evidence.hostAfter, evidence: out }));
} finally { await new Promise(resolve => server.close(resolve)); }
