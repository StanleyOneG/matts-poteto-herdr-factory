import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { installTribunus } from '../../src/tribunus-host.ts';
import { createEventBus, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { registerAgent, RUNTIME_AGENT_REGISTER_EVENT, RUNTIME_AGENT_REGISTER_VERSION } from 'pi-subagents/agents';
import { syncBuiltinESMExports } from 'node:module';
const [root, metadataPath] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath));
const socketPath=join(root,'herdr.sock');
const fakeServer=createServer();
await new Promise(r=>fakeServer.listen(socketPath,r));
const { launch, reservation, scope, authority } = metadata;
const session = randomUUID();

const attemptRoot=join(root,'legion','tribuni',launch);fs.mkdirSync(attemptRoot,{recursive:true,mode:0o700});
const descriptor=join(attemptRoot,'bootstrap.json');
fs.writeFileSync(descriptor,JSON.stringify({launch:{id:launch,reservation,revision:0,scope,state:{kind:'prepared'}},cwd:metadata.cwd,capability:'offline-test-capability',authority}),{mode:0o600});
const bin=join(root,'bin');fs.mkdirSync(bin);
const pane={workspace_id:'offline-w',tab_id:'offline-t',pane_id:'offline-p',terminal_id:'offline-term',foreground_cwd:metadata.cwd};
fs.writeFileSync(join(bin,'herdr'),`#!/usr/bin/env node\nconst a=process.argv.slice(2); console.log(a[0]==='--version' ? '0.9.1' : JSON.stringify(a[0]==='status'?{status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socketPath)}}:a[1]==='get'?{result:{pane:${JSON.stringify(pane)}}}:{result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));\n`,{mode:0o700});
process.env.PATH=bin+':'+process.env.PATH; process.env.HERDR_ENV='1';process.env.HERDR_PANE_ID='offline-p';
const handlers=new Map(), tools=new Map(), entries=[]; const journal=join(root,'session.jsonl');fs.writeFileSync(journal,'');
const skill='/home/vscode/.pi/agent/npm/node_modules/@zenspc/pi-pstack/skills/poteto-mode/SKILL.md';
for (const name of ['matt-tdd', 'matt-teach']) fs.cpSync(new URL(`../../.agents/skills/${name}`, import.meta.url), join(metadata.cwd, '.agents/skills', name), { recursive: true });
const commands=[{name:'pstack',source:'extension',sourceInfo:{path:'/home/vscode/.pi/agent/npm/node_modules/@zenspc/pi-pstack/extensions/pstack/index.ts'}},...['herdr','poteto-mode','matt-tdd','matt-teach','implement','code-review'].map(name=>({name:'skill:'+name,source:'skill',sourceInfo:{path:name==='poteto-mode'?skill:['matt-tdd','matt-teach'].includes(name)?join(metadata.cwd,'.agents/skills',name,'SKILL.md'):'/offline/'+name+'/SKILL.md'}}))];
let pendingMessages=false;
const ctx={mode:'tui',cwd:metadata.cwd,isProjectTrusted:()=>true,isIdle:()=>true,hasPendingMessages:()=>pendingMessages,sessionManager:{getSessionId:()=>session,getSessionFile:()=>journal,getBranch:()=>entries,getLeafId:()=>entries.at(-1)?.id},ui:{setStatus:()=>{}}};
function append(entry){const e={id:randomUUID(),...entry};entries.push(e);fs.appendFileSync(journal,JSON.stringify(e)+'\n');return e;}
let release, stimulus;
const settlement = new Promise(r => { release = r; });
process.on('message', message => {
 if (message.kind === 'pending-input') { pendingMessages = message.pending; process.send({ kind: 'pending-input-set', id: message.id }); }
 if (message.kind === 'manual-input') void (async () => {
  await handlers.get('input')({ source: 'interactive', text: 'Operator intervention' }, ctx);
  process.send({ kind: 'manual-input-set', id: message.id });
 })();
 if (message.kind === 'settle') { stimulus = message; release(); }
 if (message.kind === 'propose') void (async () => {
  const tool = tools.get('legion_engineering');
  const event = { toolName: 'legion_engineering', toolCallId: message.id, input: message.proposal };
  const guard = await handlers.get('tool_call')(event, ctx);
  let result;
  try { result = guard?.block ? guard : tool ? await tool.execute(message.id, message.proposal, undefined, undefined, ctx) : { error: 'Engineering tool unavailable' }; }
  catch (error) { result = { error: String(error) }; }
  process.send({ kind: 'proposal-outcome', id: message.id, result });
 })();
 if (message.kind === 'attempt-write') void (async () => {
  const outcome = await handlers.get('tool_call')({ toolName: 'write', toolCallId: message.id, input: { path: message.path, content: 'unapproved' } }, ctx);
  if (!outcome?.block) fs.writeFileSync(message.path, 'unapproved');
  process.send({ kind: 'write-outcome', id: message.id, outcome: outcome ?? { block: false } });
 })();
 if (message.kind === 'shutdown') void Promise.resolve(handlers.get('session_shutdown')({},ctx)).then(() => fakeServer.close(() => process.exit(0)));
});
const open = fs.openSync;
fs.openSync = function(path, ...args) {
 const fd = open(path, ...args);
 if (stimulus?.pausePublication && /\.report\.json(?:\..*\.tmp)?$/.test(String(path))) {
  process.send({kind:'publication-open',finalExposed:fs.existsSync(join(attemptRoot,hello.address.generation,stimulus.command+'.report.json'))});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);
 }
 return fd;
};
syncBuiltinESMExports();
let hello;

const pi={events:createEventBus(),on:(name,fn)=>handlers.set(name,fn),getCommands:()=>commands,getSettings:()=>({}),getAllTools:()=>[...['read','bash','write','edit'].map(name=>({name,sourceInfo:{path:tools.has(name)?'controlled-legion-extension':`builtin:${name}`}})),{name:'subagent',exposure:'model-only',sourceInfo:{path:'/home/vscode/.pi/agent/npm/node_modules/pi-subagents/index.js'}}],registerCommand:()=>{},registerTool:(tool)=>tools.set(tool.name,tool),sendMessage:()=>{},appendEntry:(customType,data)=>append({type:'custom',customType,data}),sendUserMessage:(prompt)=>{
 queueMicrotask(async()=>{
  await handlers.get('input')({source:'extension',text:prompt},ctx);
  const init=prompt.startsWith('/skill:');
  const continuing=prompt.startsWith('Legion engineering continuation ');
  const expanded=init?`<skill name="poteto-mode" location="${skill}">\nReferences are relative to ${dirname(skill)}.\n\n${stripFrontmatter(fs.readFileSync(skill,'utf8')).trim()}\n</skill>\n\n${prompt.slice('/skill:poteto-mode '.length)}`:prompt;
  await handlers.get('before_agent_start')({prompt:expanded},ctx);
  const user=append({type:'message',message:{role:'user',content:[{type:'text',text:expanded}]}});
  await handlers.get('message_end')({message:user.message},ctx);
  await new Promise(r=>setImmediate(r));
  if(!init && !continuing) await settlement;
  if(init)pi.appendEntry('pstack-mode',{enabled:true});
  append({type:'message',message:{role:'assistant',content:init?[{type:'text',text:'Waiting.'}]:[],stopReason:init?'stop':stimulus.reason,errorMessage:init?undefined:stimulus.error}});
  await handlers.get('agent_settled')({},ctx);
  if(continuing) process.send({kind:'continuation',prompt});
  else if(!init){ await handlers.get('agent_settled')({},ctx); process.send({kind:'settled'}); }
 });
}};
// Supply the offline pi-subagents owner at its public registration boundary.
pi.events.on(RUNTIME_AGENT_REGISTER_EVENT, request => {
 try {
  assert.equal(request.version, RUNTIME_AGENT_REGISTER_VERSION);
  request.result = { ok: true, registration: registerAgent({ pi, name: request.name, definition: request.definition }) };
 } catch (error) { request.result = { ok: false, error }; }
});
installTribunus(pi,descriptor);
await handlers.get('session_start')({},ctx);
hello=JSON.parse(fs.readFileSync(join(attemptRoot,'hello.json')));
process.send({kind:'ready',hello,descriptor});
