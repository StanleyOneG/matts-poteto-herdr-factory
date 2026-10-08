import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, appendFile, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const exec = promisify(execFile);
const [action, rootArg, cwdArg, packageArg] = process.argv.slice(2);
assert.ok(["alias", "function", "resume"].includes(action), "Use alias or function with a test-owned output directory, cwd, and Legion package directory.");
assert.equal(process.env.HERDR_ENV, "1");
const root = resolve(rootArg), cwd = resolve(cwdArg), packageRoot = resolve(packageArg);
if (action !== "resume") await mkdir(root, { recursive: false });
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
let nonce = randomUUID();
let kind = action;
let name = `t03-${kind}-${nonce.slice(0, 8)}`;
async function command(args) {
  try {
    const result = await exec("herdr", args);
    await appendFile(join(root, "operations.jsonl"), JSON.stringify({ at: new Date().toISOString(), command: ["herdr", ...args], code: 0, stdout: result.stdout, stderr: result.stderr }) + "\n");
    return result.stdout;
  } catch (error) {
    await appendFile(join(root, "operations.jsonl"), JSON.stringify({ at: new Date().toISOString(), command: ["herdr", ...args], code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr }) + "\n");
    throw error;
  }
}
const status = JSON.parse(await command(["status", "server", "--json"]));
assert.equal(status.running, true);
assert.equal(status.protocol, 22);
assert.equal(status.restart_needed, false);
let pane;
if (action === "resume") {
  const identity = JSON.parse(await readFile(join(root, "identity.json"), "utf8"));
  assert.equal(identity.cwd, cwd);
  assert.equal(identity.packageRoot, packageRoot);
  pane = identity.pane;
  kind = identity.kind;
  name = identity.name;
  if (identity.nonce) nonce = identity.nonce;
  else {
    const trace = (await readFile(join(root, "operations.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    const wait = trace.find((line) => line.command.includes("wait-output"));
    nonce = wait.command[wait.command.indexOf("--match") + 1].replace("LEGION_SHELL_READY_", "");
    assert.ok(!trace.some((line) => line.command[1] === "agent" && line.command[2] === "start"), "An already dispatched startup must not be repeated.");
  }
} else {
  const created = JSON.parse(await command(["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus"]));
  pane = created.result.root_pane;
  await writeFile(join(root, "identity.json"), JSON.stringify({ name, kind, nonce, cwd, packageRoot, pane, server: status }, null, 2));
}
const marker = join(root, "configured-invocation.txt"), body = join(root, "configured-function.txt"), ready = `LEGION_SHELL_READY_${nonce}`;
const wrapper = `print -rl -- ${quote(nonce)} "$PWD" "$@" > ${quote(marker)}; legion_trial_configured_pi "$@"`;
const fixture = `[[ -o interactive ]] && [[ "$ZSH_VERSION" != "" ]] && (( $+functions[pi] )) && functions pi > ${quote(body)} && functions -c pi legion_trial_configured_pi && ${kind === "alias" ? `unfunction pi; function legion_trial_alias_pi() { ${wrapper}; }; alias pi=legion_trial_alias_pi` : `function pi() { ${wrapper}; }`}; whence -w pi; print -r -- ${quote(ready)}`;
if (action !== "resume") await command(["pane", "run", pane.pane_id, fixture]);
await command(["pane", "wait-output", pane.pane_id, "--regex", `(?m)^${ready}$`, "--timeout", "30000"]);
const shell = await command(["pane", "read", pane.pane_id, "--source", "recent-unwrapped", "--lines", "100"]);
assert.ok(new RegExp(`^pi: ${kind}$`, "m").test(shell), "The test-owned interactive shell has the genuine requested pi definition.");
await writeFile(join(root, "shell.txt"), shell);
const beforeStart = JSON.parse(await command(["pane", "get", pane.pane_id])).result.pane;
assert.equal(beforeStart.terminal_id, pane.terminal_id);
assert.equal(beforeStart.foreground_cwd, cwd);
assert.equal(beforeStart.agent, undefined, "Only the existing shell can start Pi.");
const processInfo = JSON.parse(await command(["pane", "process-info", "--pane", pane.pane_id])).result.process_info;
assert.ok(processInfo.foreground_processes.some((process) => process.pid === processInfo.shell_pid), "The test-owned shell must be in the foreground.");
const intent = await open(join(root, "start-intent.json"), "wx", 0o600);
try { await intent.writeFile(JSON.stringify({ name, pane, cwd, argv: ["pi", "-e", packageRoot], at: new Date().toISOString() })); await intent.sync(); } finally { await intent.close(); }
const directory = await open(root, "r");
try { await directory.sync(); } finally { await directory.close(); }
await command(["agent", "start", name, "--kind", "pi", "--pane", pane.pane_id, "--", "-e", packageRoot]);
const invocation = (await readFile(marker, "utf8")).trimEnd().split("\n");
assert.deepEqual(invocation, [nonce, cwd, "-e", packageRoot]);
const configuredBody = await readFile(body);
const actual = JSON.parse(await command(["pane", "get", pane.pane_id]));
assert.equal(actual.result.pane.terminal_id, pane.terminal_id);
assert.equal(actual.result.pane.foreground_cwd, cwd);
await writeFile(join(root, "startup.txt"), await command(["pane", "read", pane.pane_id, "--source", "recent-unwrapped", "--lines", "160"]));
await writeFile(join(root, "result.json"), JSON.stringify({ verdict: "STARTED_NOT_YET_VERIFIED", configuredBodySha256: createHash("sha256").update(configuredBody).digest("hex"), invocation, actual, note: "A marker or Herdr receipt is insufficient. Inspect the exact existing startup. Project trust requires separate manual approval. Never start again to resolve uncertainty." }, null, 2));
process.stdout.write(JSON.stringify({ root, pane: pane.pane_id, terminal: pane.terminal_id, name, verdict: "STARTED_NOT_YET_VERIFIED" }) + "\n");
