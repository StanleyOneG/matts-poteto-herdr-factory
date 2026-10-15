import { accessSync, constants, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { DeliveryIntent, DeliveryOutcome, FinalObservation, FinalWorkspace, AcceptedResultProof, deliveryDigest, type DeliveryAdapter } from "./delivery-domain.js";
import { GitObjectId } from "./result-domain.js";
import { GitWorkspace, type GuardedCommand } from "./git-workspace.js";

const Text = z.string().min(1).refine(value => !value.includes("\0"), "NUL is not a command/path character.");
const Name = Text.refine(value => value.trim() === value && value.trim().length > 0, "Use a nonblank canonical identity.");
const Executable = z.strictObject({ executable: Text.refine(isAbsolute, "Use a fixed absolute executable."), args: z.array(z.string().refine(value => !value.includes("\0"))) });
const ReadOnlyExecutable = Executable.extend({ readOnly: z.literal(true) });
export const DeliveryAdapterConfiguration = z.strictObject({
  version: z.literal(1), revision: Name,
  identity: z.strictObject({ provider: Name, project: Name }),
  tracker: z.strictObject({ provider: Name, project: Name, closeTask: Executable, observe: ReadOnlyExecutable }).optional(),
  review: z.strictObject({ provider: Name, project: Name, draft: Executable.optional(), ready: Executable.optional(), observe: ReadOnlyExecutable }).optional(),
  localReport: z.strictObject({ directory: Text }).optional(),
}).refine(value => !value.tracker || value.identity.provider === value.tracker.provider && value.identity.project === value.tracker.project, "The composite identity must identify the explicitly configured tracker for closure.")
  .refine(value => Boolean(value.tracker || value.localReport || value.review?.draft || value.review?.ready), "Configure at least one delivery capability.");
/** JSON stdin/stdout protocol. Operator-declared observe executables are trusted to be read-only;
 * no environment or filesystem sandbox is claimed. Stdout must contain only this JSON response. */
export const DeliveryProviderRequest = z.strictObject({
  protocol: z.literal("legion-delivery/v1"), mode: z.enum(["execute", "reconcile"]),
  operation: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/),
  target: z.strictObject({ provider: Name, project: Name }), intent: DeliveryIntent, report: Text,
}).refine(value => value.operation === value.intent.id && value.digest === value.intent.digest, "Provider request identifies the exact prepared operation.");
export const DeliveryProviderResponse = z.strictObject({ protocol: z.literal("legion-delivery/v1"), outcome: DeliveryOutcome });
const ProviderTransport = z.strictObject({
  protocol: z.literal("legion-delivery-transport/v1"), operation: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/),
  termination: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("exited"), code: z.int().nonnegative() }),
    z.strictObject({ kind: z.literal("signaled"), signal: Text }),
    z.strictObject({ kind: z.literal("unavailable"), message: Text }),
  ]),
  stdout: z.string(), stderr: z.string(),
});
// Ordinary Bash may merge streams. Capture the fixed provider's streams before that boundary;
// normal exits retain their code, while signal/spawn failures have explicit transport evidence.
const providerTransportScript = `
const { spawn } = require("node:child_process");
const { command, cwd, operation, digest } = JSON.parse(process.argv[1]);
const child = spawn(command.executable, command.args, { cwd, shell: false, stdio: ["inherit", "pipe", "pipe"] });
const stdout = [], stderr = [];
let failure;
child.stdout.on("data", chunk => stdout.push(chunk));
child.stderr.on("data", chunk => stderr.push(chunk));
child.on("error", error => { failure = String(error); });
child.on("close", (code, signal) => {
  const termination = failure ? { kind: "unavailable", message: failure }
    : signal ? { kind: "signaled", signal }
    : code !== null ? { kind: "exited", code }
    : { kind: "unavailable", message: "Provider closed without an exit or signal." };
  process.exitCode = termination.kind === "exited" ? termination.code : 1;
  process.stdout.write(JSON.stringify({ protocol: "legion-delivery-transport/v1", operation, digest, termination,
    stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
});
`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
};
function inside({ root, path }: { root: string; path: string }) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function canonicalDestination(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  try { if (lstatSync(path).isSymbolicLink()) throw new Error("Report destination contains a dangling symlink."); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  return join(canonicalDestination(dirname(path)), basename(path));
}
function canonicalExecutable<T extends z.infer<typeof Executable>>(command: T) {
  const executable = realpathSync(command.executable);
  if (!statSync(executable).isFile()) throw new Error("Configured executable must be a regular file.");
  accessSync(executable, constants.X_OK);
  return { ...command, executable };
}
/** The file is operator-owned checkout-local configuration, never model/tool input. No remote inference. */
export async function loadDeliveryConfiguration(input: { cwd: string; configurationFile: string }) {
  const cwd = realpathSync(input.cwd), file = realpathSync(resolve(cwd, input.configurationFile));
  if (!inside({ root: cwd, path: file })) throw new Error("Delivery configuration must be a real checkout-local file.");
  const configuration = DeliveryAdapterConfiguration.parse(JSON.parse(await readFile(file, "utf8")));
  const effective = { ...configuration,
    localReport: configuration.localReport && { directory: canonicalDestination(resolve(cwd, configuration.localReport.directory)) },
    tracker: configuration.tracker && { ...configuration.tracker, closeTask: canonicalExecutable(configuration.tracker.closeTask), observe: canonicalExecutable(configuration.tracker.observe) },
    review: configuration.review && { ...configuration.review, draft: configuration.review.draft && canonicalExecutable(configuration.review.draft), ready: configuration.review.ready && canonicalExecutable(configuration.review.ready), observe: canonicalExecutable(configuration.review.observe) },
  };
  return { cwd, file, effective, identity: { ...configuration.identity, revision: `${configuration.revision}:sha256:${deliveryDigest(canonical(effective))}` } };
}

/** Complete exact proof is rendered, not a summary that can omit checks, reviews or material exceptions. */
export function renderDeliveryReport(intent: DeliveryIntent): string {
  const proofs = intent.kind === "close-task" ? [intent.proof] : intent.final.identity.results;
  const links: string[] = [];
  const link = ({ label, reference }: { label: string; reference: string }) => {
    // Evidence may also be prose. Link explicit URLs and file-like references only, never active schemes.
    if (/^https?:\/\//.test(reference) || !/^[a-z][a-z0-9+.-]*:/i.test(reference) && /^[^\s<>]+\.[^\s<>]+$/.test(reference))
      links.push(`- [${label}](<${encodeURI(reference).replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`);
  };
  for (const proof of proofs) {
    for (const review of proof.record.reviews) link({ label: "independent review", reference: review.reference });
    for (const { verification } of proof.record.verifications) {
      for (const check of verification.criteria) for (const evidence of check.evidence) link({ label: "criterion evidence", reference: evidence });
      for (const check of verification.checks) for (const evidence of check.evidence) link({ label: "check evidence", reference: evidence });
      for (const exception of verification.exceptions) if (exception.resolution.kind === "resolved") for (const evidence of exception.resolution.evidence) link({ label: "material exception resolution", reference: evidence });
    }
    for (const evidence of proof.integration.state.kind === "confirmed" ? proof.integration.state.evidence : []) link({ label: "integration evidence", reference: evidence });
  }
  if (intent.kind === "publish") {
    for (const review of intent.final.reviews) link({ label: "final independent review", reference: review.reference });
    for (const { verification } of intent.final.verifications) {
      for (const check of verification.checks) for (const evidence of check.evidence) link({ label: "final check evidence", reference: evidence });
      for (const exception of verification.exceptions) if (exception.resolution.kind === "resolved") for (const evidence of exception.resolution.evidence) link({ label: "final material exception resolution", reference: evidence });
    }
  } else if (intent.tracker.url) link({ label: "tracker task", reference: intent.tracker.url });
  return [`# Legion ${intent.kind === "close-task" ? "accepted task" : intent.publication.kind} delivery`,
    `Operation: ${intent.id}`, `Digest: ${intent.digest}`, ...links,
    "Exact prepared evidence (criteria, checks, independent reviews, integrations, material exceptions and Git identities):",
    "```json", JSON.stringify(intent, null, 2), "```", ""].join("\n");
}
const reportEnvelope = (intent: DeliveryIntent) => ({ protocol: "legion-delivery-report/v1", operation: intent.id, digest: intent.digest, intent, report: renderDeliveryReport(intent) });
const binding = (intent: DeliveryIntent) => ({ operation: intent.id, digest: intent.digest });
const unknown = ({ intent, error }: { intent: DeliveryIntent; error: unknown }): DeliveryOutcome => ({ ...binding(intent), kind: "unknown", message: String(error), evidence: ["No exact operation-bound acknowledgement. Preserve the operation; reconcile read-only, never blindly retry."] });

/** execute is ordinary permission-controlled Bash; observe is a separately supplied read-only host path.
 * Neither this class nor an operator-declared read-only provider is a sandbox. */
export async function createDeliveryAdapter(input: { cwd: string; configurationFile: string; execute: GuardedCommand; observe: GuardedCommand }): Promise<DeliveryAdapter> {
  const loaded = await loadDeliveryConfiguration(input);
  const git = new GitWorkspace(loaded.cwd, input.observe);
  const location = await git.locate();
  const text = async ({ args, cwd = loaded.cwd }: { args: string[]; cwd?: string }) => {
    const result = await git.command({ args: ["--no-replace-objects", "--no-optional-locks", ...args], cwd });
    if (result.kind !== "finished" || result.code !== 0) throw new Error(`Git observation unavailable: ${result.kind === "unknown" ? result.message : result.output}`);
    return result.output.trim();
  };
  if (await text({ args: ["rev-parse", "--show-toplevel"] }) !== loaded.cwd) throw new Error("Configure the exact owning checkout root.");
  const unchanged = async () => {
    const current = await loadDeliveryConfiguration(input);
    if (current.file !== loaded.file || JSON.stringify(current.identity) !== JSON.stringify(loaded.identity)) throw new Error("Effective delivery configuration changed; prepare with the new configuration.");
    if ((await git.locate()).commonDir !== location.commonDir) throw new Error("Repository identity changed.");
  };
  const observeFinal: NonNullable<DeliveryAdapter["observeFinal"]> = async raw => {
    try {
      const { workspace, results } = z.strictObject({ workspace: FinalWorkspace, results: z.array(AcceptedResultProof) }).parse(raw);
      await unchanged();
      const inspect = async () => {
        if (workspace.path !== loaded.cwd || realpathSync(workspace.path) !== workspace.path || workspace.repository !== location.commonDir || realpathSync(workspace.repository) !== workspace.repository)
          throw new Error("Final workspace differs from the exact owning checkout/repository.");
        const plan = { path: workspace.path, branch: workspace.branch, parent: workspace.branch, commit: "" };
        const association = await git.inspect(plan);
        if (association.path !== "directory" || !association.workspace || association.workspace.commonDir !== workspace.repository || association.workspace.branch !== workspace.branch || association.branch !== association.workspace.commit ||
            (!association.workspace.backlink && realpathSync(await text({ args: ["rev-parse", "--path-format=absolute", "--git-dir"] })) !== workspace.repository)) throw new Error("Owning branch/worktree association changed.");
        if (await text({ args: ["rev-parse", "--show-toplevel"] }) !== workspace.path || await text({ args: ["symbolic-ref", "HEAD"] }) !== workspace.branch) throw new Error("Owning checkout branch changed.");
        if (await text({ args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"] })) throw new Error("Owning checkout is dirty (tracked/index/untracked).");
        if ((await text({ args: ["ls-files", "-v", "-z"] })).split("\0").some(entry => /^[a-zS] /.test(entry))) throw new Error("Index flags obscure final cleanliness.");
        for (const state of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) if (existsSync(await text({ args: ["rev-parse", "--path-format=absolute", "--git-path", state] }))) throw new Error(`Unfinished Git operation: ${state}`);
        const commit = GitObjectId.parse(await text({ args: ["rev-parse", "--verify", "HEAD"] }));
        const tree = GitObjectId.parse(await text({ args: ["rev-parse", "--verify", `${commit}^{tree}`] }));
        if (association.branch !== commit || await git.parent(workspace.branch) !== commit) throw new Error("Branch changed during observation.");
        for (const proof of results) {
          if (proof.integration.state.kind !== "confirmed" || proof.record.identity.workspace.repository !== workspace.repository || proof.record.identity.workspace.parentPath !== workspace.path || proof.record.identity.parent.ref !== workspace.branch) throw new Error("Accepted integration belongs to another owning branch/workspace.");
          await text({ args: ["merge-base", "--is-ancestor", proof.integration.state.parent.after, commit] });
        }
        return { commit, tree };
      };
      const first = await inspect(), second = await inspect();
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Final Git identity changed during observation.");
      await unchanged();
      return FinalObservation.parse({ kind: "clean", ...first, evidence: [`Read-only exact owning repository=${workspace.repository}; worktree=${workspace.path}; branch=${workspace.branch}; commit=${first.commit}; tree=${first.tree}; clean tracked/index/untracked; accepted integrations are ancestors.`] });
    } catch (error) { return { kind: "held", message: String(error), evidence: ["Read-only final observation held; no Git mutation performed."] }; }
  };
  const validate = async (intent: DeliveryIntent) => {
    await unchanged();
    if (JSON.stringify(intent.configuration) !== JSON.stringify(loaded.identity)) throw new Error("Prepared operation configuration differs from the effective configuration.");
  };
  const localPath = (intent: DeliveryIntent) => {
    if (intent.kind !== "publish" || intent.publication.kind !== "local-report" || !loaded.effective.localReport) throw new Error("Requested delivery capability is not explicitly configured.");
    return join(loaded.effective.localReport.directory, `${intent.id}.json`);
  };
  const provider = ({ intent, mode }: { intent: DeliveryIntent; mode: "execute" | "reconcile" }) => {
    if (intent.kind === "close-task") {
      const tracker = loaded.effective.tracker;
      if (!tracker || intent.tracker.provider !== tracker.provider || intent.tracker.project !== tracker.project) throw new Error("Exact tracker/provider/project capability is not configured.");
      return { target: { provider: tracker.provider, project: tracker.project }, command: mode === "execute" ? tracker.closeTask : tracker.observe };
    }
    const review = loaded.effective.review;
    if (!review || intent.publication.kind === "local-report") throw new Error("Remote review capability is not configured.");
    const effect = intent.publication.kind === "draft" ? review.draft : review.ready;
    if (!effect) throw new Error("Requested remote publication capability is not configured.");
    const command = mode === "reconcile" ? review.observe : effect;
    return { target: { provider: review.provider, project: review.project }, command };
  };
  const providerCommand = ({ intent, mode }: { intent: DeliveryIntent; mode: "execute" | "reconcile" }) => {
    const { target, command } = provider({ intent, mode });
    const request = DeliveryProviderRequest.parse({ protocol: "legion-delivery/v1", mode, operation: intent.id, digest: intent.digest, target, intent, report: renderDeliveryReport(intent) });
    const transport = { command, cwd: loaded.cwd, ...binding(intent) };
    return `set -o pipefail; cd ${quote(loaded.cwd)} && printf '%s' ${quote(JSON.stringify(request))} | ${[process.execPath, "-e", providerTransportScript, JSON.stringify(transport)].map(quote).join(" ")}`;
  };
  const providerOutcome = ({ intent, receipt }: { intent: DeliveryIntent; receipt: Awaited<ReturnType<GuardedCommand>> }): DeliveryOutcome => {
    if (receipt.kind !== "finished") return unknown({ intent, error: receipt.message });
    let transport: z.infer<typeof ProviderTransport>;
    try { transport = ProviderTransport.parse(JSON.parse(receipt.output)); }
    catch (error) { return unknown({ intent, error: `Provider transport unavailable/malformed; shell exited ${receipt.code}: ${receipt.output}; ${String(error)}` }); }
    const diagnostics = transport.stderr ? [`Provider stderr diagnostics:\n${transport.stderr}`] : [];
    const retainDiagnostics = (outcome: DeliveryOutcome): DeliveryOutcome => ({ ...outcome, evidence: [...outcome.evidence, ...diagnostics] });
    try {
      const expectedCode = transport.termination.kind === "exited" ? transport.termination.code : 1;
      if (transport.operation !== intent.id || transport.digest !== intent.digest || receipt.code !== expectedCode)
        throw new Error(`Provider transport does not match the exact operation/digest/exit status; shell exited ${receipt.code}; termination=${JSON.stringify(transport.termination)}.`);
      if (transport.termination.kind !== "exited" || transport.termination.code !== 0)
        throw new Error(`Provider termination=${JSON.stringify(transport.termination)}; stdout=${transport.stdout}`);
      const { outcome } = DeliveryProviderResponse.parse(JSON.parse(transport.stdout));
      if (outcome.operation !== intent.id || outcome.digest !== intent.digest || outcome.kind === "confirmed" && intent.kind === "publish" && intent.publication.kind === "ready" && outcome.reference !== intent.publication.reference)
        throw new Error("Provider receipt does not match the exact operation/digest/draft reference.");
      return retainDiagnostics(outcome);
    } catch (error) { return retainDiagnostics(unknown({ intent, error })); }
  };
  const reconcile: DeliveryAdapter["reconcile"] = async ({ intent: raw }) => {
    const intent = DeliveryIntent.parse(raw);
    try {
      await validate(intent);
      if (intent.kind !== "publish" || intent.publication.kind !== "local-report") return providerOutcome({ intent, receipt: await input.observe(providerCommand({ intent, mode: "reconcile" })) });
      const path = localPath(intent);
      const content = await readFile(path, "utf8");
      if (content !== JSON.stringify(reportEnvelope(intent))) throw new Error("Local report does not match the exact operation, digest and prepared evidence.");
      return { ...binding(intent), kind: "confirmed", reference: path, evidence: [`Durable exact operation-bound report: ${path}; sha256=${deliveryDigest(content)}`] };
    } catch (error) { return unknown({ intent, error }); }
  };
  return {
    configuration: { ...loaded.identity }, observeFinal, reconcile,
    execute: async ({ intent: raw, assertAuthority }) => {
      const intent = DeliveryIntent.parse(raw);
      let submitted = false;
      try {
        await validate(intent);
        const isLocal = intent.kind === "publish" && intent.publication.kind === "local-report";
        if (isLocal && existsSync(localPath(intent))) return reconcile({ intent });
        if (intent.kind === "publish") {
          const observation = await observeFinal({ workspace: intent.final.identity.workspace, results: intent.final.identity.results });
          if (observation.kind !== "clean" || observation.commit !== intent.final.identity.commit || observation.tree !== intent.final.identity.tree) throw new Error("Final Git identity/cleanliness changed since preparation.");
        }
        if (!isLocal) {
          const command = providerCommand({ intent, mode: "execute" });
          await assertAuthority();
          submitted = true;
          return providerOutcome({ intent, receipt: await input.execute(command) });
        }
        const path = localPath(intent);
        // Publish an exclusive final receipt only after content fsync. Interrupted pending files are
        // retained, never mistaken for confirmation or retried by reconciliation. All writes use guarded Bash.
        const script = "const fs=require('node:fs');const path=require('node:path');const file=process.argv[1];const pending=file+'.pending';const content=fs.readFileSync(0);fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(pending,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.linkSync(pending,file);fs.unlinkSync(pending);for(let parent=path.dirname(file);;parent=path.dirname(parent)){const dir=fs.openSync(parent,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}if(parent===path.dirname(parent))break}";
        const command = `set -o pipefail; printf '%s' ${quote(JSON.stringify(reportEnvelope(intent)))} | ${[process.execPath, "-e", script, path].map(quote).join(" ")}`;
        await assertAuthority();
        submitted = true;
        const receipt = await input.execute(command);
        if (receipt.kind !== "finished" || receipt.code !== 0) return unknown({ intent, error: receipt.kind === "unknown" ? receipt.message : `Guarded report write exited ${receipt.code}: ${receipt.output}` });
        return reconcile({ intent });
      } catch (error) {
        if (submitted) return unknown({ intent, error });
        return { ...binding(intent), kind: "failed", noEffect: true, message: String(error), evidence: ["Preconditions/configuration/authority refused before any effect submission."] };
      }
    },
  };
}
