import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, realpath, lstat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { VERSION, createAgentSession, DefaultResourceLoader, SettingsManager, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { installTribunus, LocalTribunusHost } from "../src/tribunus-host.ts";
import { BoundedAssignment, Initialization, WorkerReport, LaunchRecord } from "../src/tribunus.ts";
import { Centuriones, observeNativeChild } from "../src/centuriones.ts";
import { prepareCenturioWorkspace } from "../src/centurio-workspace.ts";

// #35 observation/locator check only, not the #34 settlement matrix or #41 TUI journey.
assert.equal(VERSION, "1.2.0");
const base = await realpath("/workspaces/astraprojects/.tmp"), temp = await realpath(process.env.TMPDIR ?? ""), root = await realpath(process.env.RESUME_RUNTIME ?? "");
assert.equal(process.argv.length, 2);
for (const path of [temp, root]) assert.ok(path.startsWith(base + sep) && path !== base);
assert.notEqual(root, temp); assert.equal(process.env.TMP, process.env.TMPDIR); assert.equal(process.env.TEMP, process.env.TMPDIR);
const subagentsEntry = fileURLToPath(import.meta.resolve("pi-subagents"));
const subagentsVersion = JSON.parse(await readFile(join(dirname(subagentsEntry), "package.json"), "utf8")).version;
assert.equal(subagentsVersion, "0.78.0");
const versions = { pi: VERSION, subagents: subagentsVersion, node: process.version };
await writeFile(join(root, "versions.json"), JSON.stringify(versions, null, 2), { mode: 0o600, flag: "wx" });
const execute = promisify(execFile), json = async path => JSON.parse(await readFile(path, "utf8"));
const save = (name, value) => writeFile(join(root, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function until(check, label) {
  const deadline = Date.now() + 30000; // Observation bound only; no killing or settlement by expiry.
  do { const value = await check(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error(`Unresolved ${label}; retain runtime, no fallback or signals.`);
}
async function identity(pid) {
  const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(), stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return { pid, boot, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
}
async function inventory(path) {
  const result = {};
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name), stat = await lstat(full);
    if (stat.isDirectory()) result[name] = await inventory(full);
    else if (stat.isFile()) result[name] = sha256(await readFile(full));
  }
  return result;
}
const prior = { ...process.env }, hostSettings = join(prior.HOME, ".pi/agent/settings.json"), hostBefore = await readFile(hostSettings);
const server = JSON.parse((await execute("herdr", ["status", "server", "--json"])).stdout);
const realPane = JSON.parse((await execute("herdr", ["pane", "get", prior.HERDR_PANE_ID])).stdout).result.pane;
const realProcesses = JSON.parse((await execute("herdr", ["pane", "process-info", "--pane", realPane.pane_id])).stdout).result.process_info;
assert.equal(server.version, "0.9.1"); assert.equal(server.protocol, 22);
await save("herdr-read-only.json", { server, pane: realPane, processes: realProcesses });
await save("source.json", { head: (await execute("git", ["rev-parse", "HEAD"])).stdout.trim(), files: await Promise.all(["scripts/verify-resume.mjs", "src/resume.ts", "src/centuriones.ts", "src/tribunus-host.ts", "src/intake.ts", "src/extension.ts", "src/git-workspace.ts", "src/assignments.ts", "src/snapshot.ts"].map(async path => ({ path, sha256: sha256(await readFile(path)) }))) });
const profile = join(root, "p"), cwd = join(root, "c"), providerPath = join(root, "provider.mjs");
for (const path of [profile, cwd, join(profile, "extensions/subagent")]) await mkdir(path, { recursive: true, mode: 0o700 });
Object.assign(process.env, { HOME: root, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_SUBAGENTS_TEMP_ROOT: join(root, "native"), PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))) });
for (const key of ["PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SESSION_FILE", "PI_SESSION_ID", "PI_ASYNC_NATIVE_RUNNER", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"]) delete process.env[key];
await writeFile(join(profile, "settings.json"), JSON.stringify({ retry: { enabled: false } }), { mode: 0o600 });
await execute("git", ["init", "-q", "-b", "main", cwd]);
await writeFile(join(cwd, "README.md"), "Native resume locator canary.\n");
await execute("git", ["-C", cwd, "add", "."]);
await execute("git", ["-C", cwd, "-c", "user.name=Resume fixture", "-c", "user.email=resume@example.invalid", "commit", "-qm", "base"]);
await writeFile(providerPath, `import { AssistantMessageEventStream } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
export default function(pi) {
 const child = process.env.PI_SUBAGENT_CHILD === "1"; let calls = 0;
 globalThis.fetch = async () => { appendFileSync(${JSON.stringify(join(root, "network-attempts"))}, "blocked\\n"); throw new Error("No network authorized"); };
 pi.registerProvider("resume-local", { baseUrl: "http://fixture.invalid", apiKey: "not-a-credential", api: "resume-local", models: ["parent", "child", "principal"].map(id => ({ id, name:id, reasoning:id === "principal", input:["text"], contextWindow:272000, maxTokens:1024, cost:{input:0,output:0,cacheRead:0,cacheWrite:0} })),
 streamSimple(model) {
  const call = ++calls; if (call > 2) throw new Error("Unexpected provider request/replay");
  appendFileSync(${JSON.stringify(join(root, "provider-requests.jsonl"))}, JSON.stringify({child,call,pid:process.pid,model:model.id}) + "\\n");
  const tool = model.id !== "principal" && call === 1;
  const content = tool ? [{type:"toolCall",id:child?"child-read":"native-launch",name:child?"read":"subagent",arguments:child?{path:"README.md"}:JSON.parse(readFileSync(${JSON.stringify(join(root, "launch.json"))},"utf8"))}] : [{type:"text",text:"Local observation canary complete."}];
  const message = {role:"assistant",provider:model.provider,model:model.id,api:model.api,timestamp:Date.now(),content,stopReason:tool?"toolUse":"stop",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const stream = new AssistantMessageEventStream(); queueMicrotask(() => {stream.push({type:"start",partial:message});stream.push({type:"done",reason:message.stopReason,message});stream.end();}); return stream;
 }});
 if (child) pi.on("agent_before_settle", async () => {appendFileSync(${JSON.stringify(join(root, "child-before-settle"))},"waiting\\n");while(!existsSync(${JSON.stringify(join(root, "release-child"))})) await delay(20);});
}
`, { mode: 0o600 });
const errors = [], originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("No network authorized"); };
async function sdk(factories, modelId, extra = {}) {
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, refreshOnCreate: false });
  (await import(providerPath)).default(modelRuntime);
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: profile, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [providerPath], extensionFactories: factories });
  await resourceLoader.reload(); assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: profile, settingsManager, modelRuntime, model: modelRuntime.getModel("resume-local", modelId), resourceLoader, ...extra });
  await session.bindExtensions({ mode: "print", onError: error => errors.push(error) }); return session;
}
async function principalCheck(nativeSubagents) {
  const bin = join(root, "b"), socket = join(root, "h.sock"); await mkdir(bin, { mode: 0o700 });
  const herdr = createServer(); await new Promise(resolve => herdr.listen(socket, resolve));
  const stat = await lstat(socket), ownerSession = "resume-observer-owner", manager = SessionManager.create(cwd, join(root, "principal-sessions"));
  const local = { endpoint: socket, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}` };
  const window = { ...local, workspace: "fixture-w", tab: "fixture-owner-t", pane: "fixture-owner-p", terminal: "fixture-owner-term" };
  const pane = { workspace_id: window.workspace, tab_id: "fixture-worker-t", pane_id: "fixture-worker-p", terminal_id: "fixture-worker-term", foreground_cwd: cwd, agent: "pi", agent_session: { kind: "id", value: manager.getSessionId() } };
  const ownerPane = { ...pane, tab_id: window.tab, pane_id: window.pane, terminal_id: window.terminal, agent_session: { kind: "id", value: ownerSession } };
  await writeFile(join(bin, "herdr"), `#!/usr/bin/env node
const a=process.argv.slice(2);
if(a.join(' ')==='--version') console.log('0.9.1');
else if(a.join(' ')==='status server --json') console.log(JSON.stringify({status:'running',running:true,version:'0.9.1',protocol:22,compatible:true,endpoint_compatible:true,restart_needed:false,socket:${JSON.stringify(socket)}}));
else if(a[0]==='pane'&&a[1]==='get'&&['fixture-worker-p','fixture-owner-p'].includes(a[2])) console.log(JSON.stringify({result:{pane:a[2]==='fixture-worker-p'?${JSON.stringify(pane)}:${JSON.stringify(ownerPane)}}}));
else if(a[0]==='pane'&&a[1]==='process-info'&&a[2]==='--pane'&&['fixture-worker-p','fixture-owner-p'].includes(a[3])) console.log(JSON.stringify({result:{process_info:{foreground_processes:[{pid:${process.pid}}]}}}));
else {console.error('Unexpected Herdr operation',a);process.exitCode=1;}
`, { mode: 0o700 });
  const launch = { id: randomUUID(), reservation: randomUUID(), revision: 1, scope: "Observe one bounded SDK assignment", state: { kind: "prepared" }, startEvidence: { kind: "completed" } };
  const authority = { owner: randomUUID(), session: ownerSession, generation: 1, epoch: 0 }, workflowChoice = { profile: "matt", requestedWorkflow: "implement-spec" };
  const launchRoot = join(profile, "legion/tribuni", launch.id), bootstrap = join(launchRoot, "bootstrap.json"), capability = "private-resume-observation-fixture";
  await mkdir(launchRoot, { recursive: true, mode: 0o700 });
  await writeFile(bootstrap, JSON.stringify({ launch, cwd, authority, workflowChoice, capability, ownerProcess: { ...await identity(process.pid), window } }), { mode: 0o600 });
  const fork = join(prior.HOME, ".pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack");
  const discovery = [{ name: "pstack", source: "extension", sourceInfo: { path: join(fork, "extensions/pstack/index.ts") } }, ...["herdr", "matt-tdd", "matt-teach", "implement-spec", "handoff", "code-review"].map(name => ({ name: `skill:${name}`, source: "skill", sourceInfo: { path: `/controlled/${name}/SKILL.md` } }))];
  const before = { PATH: process.env.PATH, HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
  Object.assign(process.env, { PATH: `${bin}:${before.PATH}`, HERDR_ENV: "1", HERDR_PANE_ID: pane.pane_id });
  let session, hello, turns = 0, release;
  const gate = new Promise(resolve => { release = resolve; }), events = [], frames = [];
  const capture = pi => {
    for (const type of ["agent_start", "agent_end", "agent_settled"]) pi.on(type, event => { if(type === "agent_start") turns++; events.push({turn:turns,...event,type}); });
    pi.on("agent_before_settle", async () => { if(turns === 2) { await save("principal-gated.json", {events}); await gate; } });
  };
  const worker = pi => installTribunus({ ...pi, getCommands: () => [...pi.getCommands(), ...discovery], getAllTools: () => pi.getAllTools().map(tool => ["subagent", "subagents_enable"].includes(tool.name) ? {...tool,sourceInfo:{path:subagentsEntry}} : tool), on: (name, handler) => pi.on(name, (event, ctx) => handler(event, {...ctx,mode:"tui",isProjectTrusted:()=>true})) }, bootstrap);
  async function control(kind, command, assignment = null) {
    const request = { capability, authority, reservation: launch.reservation, scope: launch.scope, address: hello.address, kind, command, assignment };
    return new Promise((resolve, reject) => {
      const client = createConnection(hello.endpoint); let data = "";
      client.on("connect", () => client.write(JSON.stringify(request) + "\n")); client.on("data", chunk => {data += chunk;}); client.on("error", reject);
      client.on("close", () => {try {const response=JSON.parse(data);frames.push({request,response});resolve(response);}catch(error){reject(error);}});
    });
  }
  try {
    session = await sdk([nativeSubagents, capture, worker], "principal", {sessionManager:manager,thinkingLevel:"high",tools:["subagent"]});
    hello = await json(join(launchRoot, "hello.json")); assert.deepEqual(hello.process, await identity(process.pid));
    const initialized = await control("initialize", randomUUID()); assert.equal(initialized.kind,"ok",JSON.stringify(initialized));
    const initialization = Initialization.parse(initialized.value); await session.waitForIdle();
    const command = randomUUID(), assignment = BoundedAssignment.parse({ task:{id:randomUUID(),revision:1},scope:launch.scope,goal:"Report the local observation canary, no effects",acceptance:["No additional assignment or effect"],workflowChoice,workflow:"implement-spec",authority:"bounded-implementation-only" });
    const applied = await control("assign",command,assignment); assert.equal(applied.kind,"ok",JSON.stringify(applied));
    await until(() => existsSync(join(root,"principal-gated.json")),"principal genuine pre-settle gate");
    launch.state = {kind:"assigned",worker:{address:hello.address,resources:{cwd,skills:[],diagnostics:[]},identityEvidence:join(launchRoot,"hello.json")},initialization,command,assignment,application:applied.value.application};
    LaunchRecord.parse(launch);
    const frozen = await inventory(launchRoot);
    const read = observer => observer.observeResources({launch,cwd,signal:new AbortController().signal});
    let observer = new LocalTribunusHost(async () => {throw new Error("Observation cannot execute guarded effects");},authority);
    const original = await read(observer); assert.equal(original.live.kind,"observed",JSON.stringify(original)); assert.equal(original.disposition,"hold");
    observer = new LocalTribunusHost(async () => {throw new Error("Restarted observer cannot execute controls");},{...authority,session:"fresh-observer",generation:2});
    const restarted = await read(observer); assert.equal(restarted.live.kind,"observed",JSON.stringify(restarted)); assert.deepEqual(restarted.live.value.controller,authority);
    assert.deepEqual(restarted.process,original.process); assert.deepEqual(restarted.live.value.address,hello.address); assert.equal(restarted.live.value.command,command);
    assert.notEqual(restarted.live.value.nonce,original.live.value.nonce); assert.equal(restarted.disposition,"hold");
    assert.deepEqual(await inventory(launchRoot),frozen,"Actual nonce-bound observations publish no receipts or control/rebinding changes");
    await save("principal-observed.json",{hello,launch,original,restarted,frozen,events,frames});
    release(); await session.waitForIdle();
    const report = WorkerReport.parse(await json(join(launchRoot,hello.address.generation,`${command}.report.json`)));
    const settled = await read(observer); assert.equal(settled.disposition,"settled",JSON.stringify(settled)); assert.deepEqual(settled.live.value.controller,authority); assert.deepEqual(settled.report,report);
    assert.equal(turns,2,"Exactly bootstrap and original assignment, no observer turn/revival"); assert.equal(frames.length,2,"Only original initialization and assignment controls");
    await save("principal-settled.json",{settled,events,frames}); return {session:hello.address.session,generation:hello.address.generation,process:hello.process,command,turns,controls:frames.length};
  } finally {
    release(); if(session) {await session.waitForIdle();await session.extensionRunner.emit({type:"session_shutdown",reason:"shutdown"});session.dispose();}
    if(hello) await until(() => !existsSync(hello.endpoint),"production observation socket closure");
    await new Promise(resolve => herdr.close(resolve));
    await save("principal-cleanup.json",{sdkIdleAndDisposed:!!session,controlledSocketClosed:true,generationSocketClosed:!hello||!existsSync(hello.endpoint)});
    for(const [key,value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key]=value;
  }
}
let childSession, childPrompt, nativeDetails, tracker, registration;
try {
  const {default:nativeSubagents} = await import("pi-subagents");
  const principal = await principalCheck(nativeSubagents);
  const evidence = join(root,"child-evidence"); await mkdir(evidence,{mode:0o700});
  const childId=randomUUID(), owner={launch:randomUUID(),session:randomUUID(),generation:randomUUID(),window:{endpoint:"/controlled/unused.sock",server:"controlled",workspace:"w",tab:"t",pane:"p",terminal:"term"}};
  const authority={owner:randomUUID(),session:"fixture-controller",generation:1,epoch:0}, command=randomUUID();
  const assignment=BoundedAssignment.parse({task:{id:randomUUID(),revision:1},scope:"One native isolated read",goal:"Read once",acceptance:["Read outcome retained"],workflowChoice:{profile:"matt",requestedWorkflow:"implement-spec"},workflow:"implement-spec",authority:"bounded-implementation-only"});
  const run=async command => {try{return {kind:"finished",code:0,output:(await execute("bash",["-c",command])).stdout};}catch(error){if(typeof error.code === "number") return {kind:"finished",code:error.code,output:error.stdout+error.stderr};throw error;}};
  const baseCommit=(await execute("git",["-C",cwd,"rev-parse","HEAD"])).stdout.trim();
  const reservation=await prepareCenturioWorkspace({id:childId,cwd,owner:authority.owner,scope:"One native isolated read",baseRef:"refs/heads/main",baseCommit,run,current:()=>true});
  const activity=[], toolEvents=[];
  const capture=pi => {
    pi.on("session_start",(_event,ctx) => {
      owner.session=ctx.sessionManager.getSessionId();
      const request={version:1,name:"resume-canary",definition:{description:"Native locator canary",systemPrompt:"One local read, no delegation.",tools:["read"],model:"resume-local/child",extensions:[providerPath],allowNestedSubagents:false,acceptanceRole:"read-only"}};
      pi.events.emit("pi-subagents:runtime-agent-register:v1",request); assert.ok(request.result?.ok,String(request.result?.error));registration=request.result.registration;
      tracker=new Centuriones(pi,evidence,owner,async()=>{});
      const prepared=tracker.prepare({purpose:"review",agent:"resume-canary",task:"Read README.md once and finish.",baseRef:reservation.plan.branch,baseCommit}, {command,value:assignment},authority,ctx,{parentCwd:cwd,workspace:reservation},childId);
      // The ordinary model emits exactly the launch returned by production preparation.
      return save("launch.json",prepared.launch);
    });
    pi.on("tool_call",async(event,ctx)=>{if(event.toolName === "subagent") await tracker.admit(event,ctx);});
    pi.on("tool_result",event=>{tracker.observeInput(event);});
    pi.on("tool_execution_end",(event,ctx)=>{toolEvents.push(event);tracker.observeLaunch(event,ctx);if(event.toolName === "subagent") {assert.equal(event.isError,false,JSON.stringify(event));nativeDetails=event.result.details;}});
    for(const kind of ["started","complete"]) pi.events.on(`subagent:async-${kind}`,raw=>{activity.push({kind,raw});tracker.observeActivity(kind,raw);});
    pi.on("session_shutdown",()=>{registration?.dispose();tracker?.dispose();});
  };
  childSession=await sdk([nativeSubagents,capture],"parent",{tools:["subagent"]});
  let promptError; childPrompt=childSession.prompt("Run the one prepared native local read.").catch(error=>{promptError=error;});
  await until(()=>{if(promptError)throw promptError;assert.deepEqual(errors,[]);return nativeDetails?.asyncDir&&existsSync(join(root,"child-before-settle"))&&existsSync(join(evidence,`${childId}.centurio-identity.json`));},"genuine native launch, child gate and production compact locator");
  assert.ok((await realpath(nativeDetails.asyncDir)).startsWith(root+sep));
  const path=join(evidence,`${childId}.centurio-intent.json`), input={path,owner,command};
  const original=observeNativeChild(input); assert.equal(original.state.kind,"active",JSON.stringify(original)); assert.equal(original.disposition,"hold");
  const locator=await json(join(evidence,`${childId}.centurio-runtime.json`)), exact=await json(join(evidence,`${childId}.centurio-identity.json`));
  assert.equal(locator.run,nativeDetails.runId); assert.equal(locator.directory,await realpath(nativeDetails.asyncDir));
  tracker.dispose(); // Discard only Legion's in-memory watcher; actual native parent/runner stay alive.
  const frozen=await inventory(evidence), restarted=observeNativeChild(input);
  assert.deepEqual(restarted,original); assert.deepEqual(await inventory(evidence),frozen,"Restarted native reader is read-only");
  const status=await json(join(nativeDetails.asyncDir,"status.json")); assert.equal(status.processTerminal.runnerProcessInstanceId,exact.runner);
  const events=(await readFile(join(nativeDetails.asyncDir,"events.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(events.some(e=>e.subagentSource === "child" && e.type === "agent_settled"),false);
  assert.notEqual(status.processTerminal.state,"observed");
  await save("child-observed.json",{original,restarted,locator,exact,nativeDetails,status,events,activity,toolEvents,frozen});
  await writeFile(join(root,"release-child"),"release"); await childPrompt;if(promptError)throw promptError;
  const proof=await until(async()=>{const path=join(nativeDetails.asyncDir,"process-terminal.json");if(!existsSync(path))return false;const proof=await json(path);return proof.state === "observed"&&proof;},"actual native runner close");
  const runner=proof.instances.filter(p=>p.kind === "runner"); assert.equal(runner.length,1);assert.equal(runner[0].processInstanceId,exact.runner);assert.equal(runner[0].exitCode,0);assert.equal(runner[0].signal,null);
  const settled=observeNativeChild(input);assert.equal(settled.disposition,"settled",JSON.stringify(settled));assert.equal(settled.state.kind,"process-terminal");assert.equal(settled.state.run,locator.run);assert.equal(settled.state.session,exact.child.session);
  assert.equal(toolEvents.filter(e=>e.toolName === "subagent").length,1,"No native relaunch/control/resume");assert.deepEqual(await inventory(evidence),frozen,"Native settlement consumer never publishes or repairs");
  await save("child-settled.json",{settled,proof,activity,toolEvents});
  assert.equal(networkCalls,0);assert.equal(existsSync(join(root,"network-attempts")),false);assert.deepEqual(errors,[]);assert.deepEqual(await readFile(hostSettings),hostBefore);
  const result={result:"bounded-native-resume-observation-passed",...versions,root,principal,nativeDetails,runner:runner[0],tabsCreated:0,networkCalls:0,limitations:["Herdr pane/session/Trust/discovery are controlled SDK seams, not real tabs or #41 full journey","Recreated observation readers, not an actual crashed native parent; independent tests establish actual controller exits","Native child production preparation/association used controlled assignment authority; ordinary native tool, runner, journals and lifecycle were genuine","Settlement is point-in-time evidence only; no authority rebound, cleanup or child non-resumability claim"]};
  await save("result.json",result);console.log(JSON.stringify(result,null,2));
} catch(error) {await save("failure.json",{error:String(error),stack:error.stack,nativeDetails,errors});throw error;}
finally {
  await writeFile(join(root,"release-child"),"release");if(childPrompt)await childPrompt;
  if(nativeDetails?.asyncDir)await until(async()=>{const path=join(nativeDetails.asyncDir,"process-terminal.json");return existsSync(path)&&(await json(path)).state === "observed";},"cleanup native runner actual close");
  if(childSession){await childSession.waitForIdle();await childSession.extensionRunner.emit({type:"session_shutdown",reason:"shutdown"});childSession.dispose();}
  await save("cleanup.json",{nativeRun:nativeDetails?.runId??null,nativeTerminal:nativeDetails?.asyncDir?(await json(join(nativeDetails.asyncDir,"process-terminal.json"))).state:null,sdkIdleAndDisposed:true,runtimeRetained:root,disposable:temp});
  globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);
  console.error(`Retained #35 runtime (not disposable): ${root}`);
}
