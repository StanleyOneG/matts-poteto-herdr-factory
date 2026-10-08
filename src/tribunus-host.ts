import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, openSync, writeFileSync, readFileSync, closeSync, fsyncSync, existsSync, lstatSync, realpathSync, watch, linkSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getAgentDir, stripFrontmatter, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { preflight } from "./preflight.js";
import { BoundedAssignment, Initialization, LaunchRecord, VerifiedWorker, WindowIdentity, WorkerAddress, WorkerReport, type TribunusHost } from "./tribunus.js";
import type { GuardedCommand } from "./git-workspace.js";
const exec = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const Authority = z.object({
  owner: z.uuid(), session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative()
});
const Descriptor = z.object({
  launch: LaunchRecord, cwd: z.string(), capability: z.string(), authority: Authority
});
const Hello = z.object({
  address: WorkerAddress, endpoint: z.string(), journal: z.string(), pid: z.int().positive()
});
const Frame = z.object({
  capability: z.string(), authority: Authority, reservation: z.uuid(), scope: z.string(), address: WorkerAddress, command: z.uuid(), kind: z.enum(["inspect", "initialize", "assign"]), assignment: BoundedAssignment.nullable()
}).strict();
const Envelope = z.discriminatedUnion("kind", [z.object({
    kind: z.literal("ok"), value: z.unknown()
  }), z.object({
    kind: z.literal("held"), message: z.string()
  })]);
function publish(path: string, value: unknown) {
  const bytes = JSON.stringify(value);
  const existing = () => {
    privateFile(path);
    if (readFileSync(path, "utf8") !== bytes)
      throw new Error("Immutable worker evidence conflicts. Preserve the existing file.");
  };
  if (existsSync(path)) {
    existing();
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    existing();
  } finally {
    unlinkSync(temporary);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
function privateFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path)
    throw new Error("Managed bootstrap/evidence must be a private owned regular file without symlinks.");
  return JSON.parse(readFileSync(path, "utf8"));
}
async function localIdentity() {
  if (process.env.HERDR_ENV !== "1")
    throw new Error("Launch requires the current local Herdr environment.");
  const status = z.object({
    running: z.literal(true), version: z.literal("0.9.1"), protocol: z.literal(22), compatible: z.literal(true), endpoint_compatible: z.literal(true), restart_needed: z.literal(false), socket: z.string()
  }).parse(JSON.parse((await exec("herdr", ["status", "server", "--json"])).stdout));
  const endpoint = realpathSync(status.socket), stat = lstatSync(endpoint);
  if (!stat.isSocket() || stat.uid !== process.getuid?.())
    throw new Error("Local Herdr socket identity is unavailable.");
  return {
    endpoint, server: `${stat.dev}:${stat.ino}:${stat.ctimeMs}`
  };
}
const Pane = z.object({
  workspace_id: z.string(), tab_id: z.string(), pane_id: z.string(), terminal_id: z.string(), foreground_cwd: z.string().optional(), agent: z.string().optional(), agent_session: z.object({
    kind: z.enum(["id", "path"]), value: z.string()
  }).optional()
});
async function paneAt(pane: string) {
  return z.object({
    result: z.object({
      pane: Pane
    })
  }).parse(JSON.parse((await exec("herdr", ["pane", "get", pane])).stdout)).result.pane;
}
export class LocalTribunusHost implements TribunusHost {
  private root = join(getAgentDir(), "legion", "tribuni");
  constructor(private run: GuardedCommand, private authority: z.infer<typeof Authority>, private notify: (message: string) => void = () => { }) { }
  private descriptor(launch: string) { return join(this.root, launch, "bootstrap.json"); }
  private async effect(command: string, launch: string) {
    const evidence = randomUUID();
    const root = join(this.root, launch);
    publish(join(root, `${evidence}.effect-intent.json`), {
      command, evidence
    });
    let result: Awaited<ReturnType<GuardedCommand>>;
    try {
      result = await this.run(command);
    }
    catch (error) {
      result = {
        kind: "unknown", message: String(error)
      };
    }
    publish(join(root, `${evidence}.effect-outcome.json`), result);
    if (result.kind !== "finished" || result.code !== 0)
      throw new Error(`Guarded local effect has no successful completion. Preserve effect evidence ${evidence} for launch ${launch}. No fallback.`);
    return JSON.parse(result.output);
  }
  async createWindow({ launch, cwd }: Parameters<TribunusHost["createWindow"]>[0]) {
    const local = await localIdentity();
    mkdirSync(join(this.root, launch.id), {
      recursive: true, mode: 0o700
    });
    const path = this.descriptor(launch.id);
    publish(path, Descriptor.parse({
      launch, cwd, capability: randomBytes(32).toString("hex"), authority: this.authority
    }));
    const created = z.object({
      result: z.object({
        root_pane: Pane
      })
    }).parse(await this.effect(`herdr workspace create --cwd ${quote(cwd)} --label ${quote(`Legion ${launch.id}`)} --env ${quote(`LEGION_TRIBUNUS_BOOTSTRAP=${path}`)} --no-focus`, launch.id)).result.root_pane;
    return WindowIdentity.parse({
      ...local, workspace: created.workspace_id, tab: created.tab_id, pane: created.pane_id, terminal: created.terminal_id
    });
  }
  async startPi({ launch, window }: Parameters<TribunusHost["startPi"]>[0]) {
    const local = await localIdentity();
    if (local.endpoint !== window.endpoint || local.server !== window.server)
      throw new Error("Local Herdr endpoint/server changed. No start.");
    const pane = await paneAt(window.pane);
    if (pane.terminal_id !== window.terminal || pane.agent)
      throw new Error("Owned terminal is not an available shell. No alternate launch path.");
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    await this.effect(`herdr agent start ${quote(`lg-${launch.id.replaceAll("-", "").slice(0, 24)}`)} --kind pi --pane ${quote(window.pane)} -- -e ${quote(packageRoot)}`, launch.id);
  }
  private async hello(launch: string) { return Hello.parse(privateFile(join(this.root, launch, "hello.json"))); }
  private async control(hello: z.infer<typeof Hello>, kind: z.infer<typeof Frame>["kind"], command: string, assignment: z.infer<typeof BoundedAssignment> | null) {
    const descriptor = Descriptor.parse(privateFile(this.descriptor(hello.address.launch)));
    const frame = {
      authority: this.authority, reservation: descriptor.launch.reservation, scope: descriptor.launch.scope, address: hello.address, command, kind, assignment
    };
    const path = join(this.root, hello.address.launch, `${command}.${this.authority.generation}.${this.authority.epoch}.request.json`);
    publish(path, frame);
    const client = fileURLToPath(new URL("./tribunus-client.mjs", import.meta.url));
    const response = Envelope.parse(await this.effect(`node ${quote(client)} ${quote(this.descriptor(hello.address.launch))} ${quote(hello.endpoint)} ${quote(path)}`, hello.address.launch));
    if (response.kind === "held")
      throw new Error(response.message);
    return response.value;
  }
  async inspectWorker({ launch, window, cwd }: Parameters<TribunusHost["inspectWorker"]>[0]) {
    if (!existsSync(join(this.root, launch.id, "hello.json")))
      return null;
    const hello = await this.hello(launch.id), pane = await paneAt(window.pane), local = await localIdentity();
    if (JSON.stringify(hello.address.window) !== JSON.stringify(window) || local.endpoint !== window.endpoint || local.server !== window.server || pane.terminal_id !== window.terminal || pane.foreground_cwd !== cwd || pane.agent !== "pi" || !pane.agent_session)
      throw new Error("Exact local Herdr terminal, cwd, and Pi session evidence disagree.");
    if (pane.agent_session.kind === "id" ? pane.agent_session.value !== hello.address.session : pane.agent_session.value !== hello.journal)
      throw new Error("Herdr does not identify the addressed Pi session. No journal guessing.");
    return VerifiedWorker.parse(await this.control(hello, "inspect", randomUUID(), null));
  }
  async initialize({ worker, command }: Parameters<TribunusHost["initialize"]>[0]) {
    const hello = await this.hello(worker.address.launch);
    if (JSON.stringify(hello.address) !== JSON.stringify(worker.address))
      throw new Error("Worker generation changed.");
    const value = await this.control(hello, "initialize", command, null);
    return value === null ? null : Initialization.parse(value);
  }
  watchReports({ worker, command }: {
    worker: z.infer<typeof VerifiedWorker>;
    command: string;
  }, onReport: (report: z.infer<typeof WorkerReport>) => Promise<void>, onUnavailable: (message: string) => Promise<void>) {
    const root = join(this.root, worker.address.launch, worker.address.generation);
    const path = join(root, `${command}.report.json`);
    let watching: ReturnType<typeof watch> | null = null;
    const collect = async () => {
      if (!existsSync(path))
        return;
      watching?.close();
      const report = WorkerReport.parse(privateFile(path));
      if (report.command !== command || JSON.stringify(report.address) !== JSON.stringify(worker.address))
        throw new Error("Worker report does not address the applied assignment.");
      await onReport(report);
    };
    const failed = (error: unknown) => {
      watching?.close();
      void onUnavailable(String(error)).catch((publication) => this.notify(`Worker report evidence/publication unavailable. Preserve the receipt and assignment. ${String(publication)}`));
    };
    watching = watch(root, () => { void collect().catch(failed); });
    watching.unref();
    void collect().catch(failed);
  }
  async assign({ worker, command, assignment }: Parameters<TribunusHost["assign"]>[0]) {
    const hello = await this.hello(worker.address.launch);
    if (JSON.stringify(hello.address) !== JSON.stringify(worker.address))
      throw new Error("Worker generation changed.");
    const value = await this.control(hello, "assign", command, assignment);
    return value === null ? null : z.object({
      application: z.string()
    }).parse(value);
  }
}
export function managedBootstrap() {
  const path = process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  delete process.env.LEGION_TRIBUNUS_BOOTSTRAP;
  return path;
}
export function installTribunus(pi: ExtensionAPI, path: string) {
  const descriptor = Descriptor.parse(privateFile(path));
  let server: Server | null = null;
  let context: ExtensionContext | null = null;
  let address: z.infer<typeof WorkerAddress> | null = null;
  let manual = false;
  let active: {
    kind: "checking";
    frame: z.infer<typeof Frame>;
  } | {
    kind: "running";
    frame: z.infer<typeof Frame>;
    prompt: string;
    expanded: string | null;
    priorMode: Set<string>;
    resolve: (value: unknown) => void;
  } | null = null;
  let initialized: z.infer<typeof Initialization> | null = null;
  let controller = descriptor.authority;
  let generationRoot = "";
  let journal = "";
  const receipt = (id: string, suffix: string) => join(generationRoot, `${id}.${suffix}.json`);
  async function resources(ctx: ExtensionContext) {
    return {
      cwd: realpathSync(ctx.cwd), skills: pi.getCommands().filter((c) => c.source === "skill").map((c) => ({
        name: c.name.replace(/^skill:/, ""), path: c.sourceInfo.path
      })), diagnostics: await preflight(pi)
    };
  }
  const incarnation = (ctx: ExtensionContext) => !!address && ctx.mode === "tui" && ctx.sessionManager.getSessionId() === address.session && !manual;
  pi.on("session_start", async (_event, ctx) => {
    server?.close();
    server = null;
    if (address) {
      manual = true;
      return;
    }
    if (ctx.mode !== "tui" || realpathSync(ctx.cwd) !== descriptor.cwd || !ctx.isProjectTrusted())
      throw new Error("Managed Tribunus requires trusted target cwd and ordinary interactive Pi. No assignment authorized.");
    context = ctx;
    const paneId = process.env.HERDR_PANE_ID;
    if (!paneId)
      throw new Error("Managed worker has no local Herdr pane identity.");
    const pane = await paneAt(paneId), local = await localIdentity();
    const processInfo = z.object({
      result: z.object({
        process_info: z.object({
          foreground_processes: z.array(z.object({
            pid: z.int()
          }))
        })
      })
    }).parse(JSON.parse((await exec("herdr", ["pane", "process-info", "--pane", paneId])).stdout));
    if (!processInfo.result.process_info.foreground_processes.some((p) => p.pid === process.pid) || pane.foreground_cwd !== ctx.cwd)
      throw new Error("This process is not the principal in the owned local terminal.");
    address = WorkerAddress.parse({
      launch: descriptor.launch.id, window: {
        ...local, workspace: pane.workspace_id, tab: pane.tab_id, pane: pane.pane_id, terminal: pane.terminal_id
      }, session: ctx.sessionManager.getSessionId(), generation: randomUUID()
    });
    journal = ctx.sessionManager.getSessionFile() ?? "";
    if (!journal)
      throw new Error("Exact worker journal locator unavailable.");
    generationRoot = join(dirname(path), address.generation);
    mkdirSync(generationRoot, {
      mode: 0o700
    });
    const endpoint = join(dirname(dirname(path)), `s-${createHash("sha256").update(JSON.stringify(address)).digest("hex").slice(0, 32)}.sock`);
    if (Buffer.byteLength(endpoint) >= 108 || existsSync(endpoint))
      throw new Error("Generation-specific Unix endpoint is unsupported or collides. No transport fallback.");
    pi.appendEntry("legion-tribunus-generation", {
      launch: address.launch, generation: address.generation
    });
    server = createServer((socket) => {
      let buffer = "";
      socket.on("data", async (chunk) => {
        let accepted: string | null = null;
        buffer += chunk;
        if (!buffer.includes("\n"))
          return;
        socket.removeAllListeners("data");
        try {
          const frame = Frame.parse(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
          const received = Buffer.from(frame.capability), expected = Buffer.from(descriptor.capability);
          if (received.length !== expected.length || !timingSafeEqual(received, expected) || !address || JSON.stringify(frame.address) !== JSON.stringify(address) || frame.reservation !== descriptor.launch.reservation || frame.scope !== descriptor.launch.scope || frame.authority.owner !== descriptor.authority.owner || frame.authority.generation < controller.generation || (frame.authority.generation === controller.generation && (frame.authority.session !== controller.session || frame.authority.epoch !== controller.epoch)) || !context || !incarnation(context))
            throw new Error("Control does not address this authorized worker incarnation.");
          if (frame.authority.generation > controller.generation) {
            publish(join(generationRoot, `${frame.authority.generation}.controller.json`), frame.authority);
            controller = frame.authority;
          }
          if (frame.kind === "inspect") {
            const value = {
              address, resources: await resources(context), identityEvidence: journal
            };
            socket.end(JSON.stringify({
              kind: "ok", value
            }) + "\n");
            return;
          }
          const fingerprint = createHash("sha256").update(JSON.stringify({
            address: frame.address, command: frame.command, kind: frame.kind, assignment: frame.assignment, reservation: frame.reservation, scope: frame.scope
          })).digest("hex");
          if (existsSync(receipt(frame.command, "intent"))) {
            const intent = z.object({
              fingerprint: z.string()
            }).parse(privateFile(receipt(frame.command, "intent")));
            if (intent.fingerprint !== fingerprint)
              throw new Error("Control ID conflicts with retained payload.");
            socket.end(JSON.stringify({
              kind: "ok", value: existsSync(receipt(frame.command, "applied")) ? privateFile(receipt(frame.command, "applied")) : null
            }) + "\n");
            return;
          }
          if (active || !context.isIdle() || context.hasPendingMessages())
            throw new Error("Worker has an unsettled operation. No queued control or alternate delivery.");
          active = {
            kind: "checking", frame
          };
          accepted = frame.command;
          const observed = await resources(context);
          if (observed.diagnostics.some((d) => d.status !== "ready") || !incarnation(context) || frame.authority.generation !== controller.generation || frame.authority.session !== controller.session || frame.authority.epoch !== controller.epoch)
            throw new Error("Actual target resources or incarnation are unavailable. Assignment withheld.");
          const currentMode = context.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "pstack-mode").at(-1);
          const modeEnabled = currentMode?.type === "custom" && z.object({
            enabled: z.literal(true)
          }).safeParse(currentMode.data).success;
          if (frame.kind === "assign" && (!initialized || !modeEnabled || !existsSync(receipt(initialized.command, "applied")) || !frame.assignment || frame.assignment.scope !== descriptor.launch.scope))
            throw new Error("Worker has no same-generation applied initialization or matching bounded assignment.");
          publish(receipt(frame.command, "intent"), {
            fingerprint, command: frame.command, address, authority: frame.authority
          });
          const prompt = frame.kind === "initialize"
            ? `/skill:poteto-mode Legion native initialization ${frame.command}. No implementation assignment is authorized yet. Do not use tools, delegate, edit files, or run commands. Reply in one sentence that you are waiting for the bounded assignment.`
            : `Legion bounded assignment ${frame.command}\n${JSON.stringify(frame.assignment)}\nYou own only this assignment. Do not schedule the spec, integrate, accept, clean up, publish, or close issues. Matt TDD is primary. Request seam approval or a documented exception from your Legatus within this scope. A result is not acceptance.`;
          const done = new Promise<unknown>((resolve) => { active = {
            kind: "running", frame, prompt, expanded: null, priorMode: new Set(context?.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "pstack-mode").map((e) => e.id)), resolve
          }; });
          if (!incarnation(context))
            throw new Error("Worker incarnation changed before injection.");
          pi.sendUserMessage(prompt, {
            expandPromptTemplates: frame.kind === "initialize"
          });
          const value = await done;
          socket.end(JSON.stringify({
            kind: "ok", value
          }) + "\n");
        }
        catch (error) {
          if (active?.kind === "checking" && active.frame.command === accepted)
            active = null;
          socket.end(JSON.stringify({
            kind: "held", message: String(error)
          }) + "\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server?.once("error", reject); server?.listen(endpoint, resolve); });
    publish(join(dirname(path), "hello.json"), {
      address, endpoint, journal, pid: process.pid
    });
    ctx.ui.setStatus("legion-intake", "Tribunus awaiting verified initialization. No assignment.");
  });
  pi.on("input", (event) => {
    if (active?.kind === "running" && event.source === "extension" && event.text === active.prompt)
      return {
        action: "continue"
      };
    manual = true;
    return {
      action: "handled"
    };
  });
  pi.on("before_agent_start", (event) => {
    if (active?.kind !== "running" || !context || !incarnation(context))
      return;
    const skill = pi.getCommands().find((c) => c.name === "skill:poteto-mode" && c.source === "skill");
    if (active.frame.kind === "initialize") {
      if (!skill)
        return;
      const body = stripFrontmatter(readFileSync(skill.sourceInfo.path, "utf8")).trim();
      const expansion = `<skill name="poteto-mode" location="${skill.sourceInfo.path}">\nReferences are relative to ${dirname(skill.sourceInfo.path)}.\n\n${body}\n</skill>\n\n${active.prompt.slice("/skill:poteto-mode ".length)}`;
      if (event.prompt !== expansion)
        return;
    }
    else if (event.prompt !== active.prompt)
      return;
    active.expanded = event.prompt;
  });
  function assignmentApplied(ctx: ExtensionContext) {
    const pending = active;
    if (pending?.kind !== "running" || pending.frame.kind !== "assign" || !pending.expanded || !address || !incarnation(ctx)) return false;
    const user = ctx.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user" && Array.isArray(entry.message.content) && entry.message.content.some((part) => part.type === "text" && part.text === pending.expanded));
    if (!user || !existsSync(journal)) return false;
    const actual = readFileSync(journal, "utf8").trimEnd().split("\n").map((line) => z.object({ id: z.string() }).parse(JSON.parse(line))).some((entry) => entry.id === user.id);
    if (!actual) return false;
    const fd = openSync(journal, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const application = { application: `${journal}#${user.id}` };
    publish(receipt(pending.frame.command, "applied"), application);
    pending.resolve(application);
    return true;
  }
  pi.on("message_end", (event, ctx) => {
    if (active?.kind !== "running" || active.frame.kind !== "assign" || event.message.role !== "user") return;
    const pending = active;
    setImmediate(() => {
      if (active !== pending) return;
      try { assignmentApplied(ctx); }
      catch { pending.resolve(null); }
    });
  });
  pi.on("tool_call", (_event, ctx) => {
    if (active?.kind !== "running" || active.frame.kind !== "assign" || !active.expanded || !initialized || !assignmentApplied(ctx))
      return {
        block: true, reason: "Managed Tribunus implementation tools require this generation's settled native initialization and bounded assignment."
      };
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const pending = active;
    if (pending?.kind !== "running" || !address)
      return;
    const branch = ctx.sessionManager.getBranch();
    const user = branch.find((e) => e.type === "message" && e.message.role === "user" && Array.isArray(e.message.content) && e.message.content.some((c) => c.type === "text" && c.text === pending.expanded));
    const assistant = branch.filter((e) => e.type === "message" && e.message.role === "assistant").at(-1);
    if (manual || !incarnation(ctx) || !pending.expanded || !user || !assistant || assistant.type !== "message" || assistant.message.role !== "assistant" || ctx.hasPendingMessages()) {
      pending.resolve(null);
      return;
    }
    if (assistant.message.stopReason !== "stop") {
      if (pending.frame.kind === "assign" && (assistant.message.stopReason === "error" || assistant.message.stopReason === "aborted")) {
        if (!assignmentApplied(ctx)) { pending.resolve(null); return; }
        publish(receipt(pending.frame.command, "report"), WorkerReport.parse({
          address, command: pending.frame.command, outcome: "failed",
          assistantText: `Assignment ${assistant.message.stopReason}. ${assistant.message.errorMessage ?? "No successful completion was observed."}`.slice(0, 4000),
          evidence: [`${journal}#${assistant.id}`]
        }));
        ctx.ui.setStatus("legion-intake", "Tribunus failed. Waiting. Not accepted.");
        active = null;
      }
      pending.resolve(null);
      return;
    }
    if (pending.frame.kind === "initialize") {
      const skill = pi.getCommands().find((c) => c.name === "skill:poteto-mode" && c.source === "skill");
      const mode = branch.find((e) => e.type === "custom" && e.customType === "pstack-mode" && !pending.priorMode.has(e.id) && z.object({
        enabled: z.literal(true)
      }).safeParse(e.data).success);
      if (!skill || !mode || (await resources(ctx)).diagnostics.some((d) => d.status !== "ready")) {
        pending.resolve(null);
        return;
      }
      pi.appendEntry("legion-tribunus-settled", { command: pending.frame.command, generation: address.generation, outcome: "initialized" });
      const settlement = ctx.sessionManager.getLeafId();
      const proof = Initialization.parse({
        command: pending.frame.command, address, nativePrompt: pending.expanded, skillPath: skill.sourceInfo.path, modeEntry: `${journal}#${mode.id}`, settledEntry: `${journal}#${settlement}`
      });
      publish(receipt(pending.frame.command, "applied"), proof);
      initialized = proof;
      ctx.ui.setStatus("legion-intake", "Tribunus initialized. Awaiting bounded assignment.");
      active = null;
      pending.resolve(proof);
    }
    else {
      if (!assignmentApplied(ctx)) { pending.resolve(null); return; }
      const application = { application: `${journal}#${user.id}` };
      const text = assistant.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, 4000);
      publish(receipt(pending.frame.command, "report"), {
        address, command: pending.frame.command, outcome: "reported-result", assistantText: text, evidence: [`${journal}#${assistant.id}`]
      });
      ctx.ui.setStatus("legion-intake", "Tribunus reported. Waiting. Not accepted.");
      active = null;
      pending.resolve(application);
    }
  });
  pi.on("session_shutdown", () => { manual = true; server?.close(); });
}
