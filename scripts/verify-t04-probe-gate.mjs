import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const source = readFileSync(new URL("./verify-t04-prerequisites.mjs", import.meta.url), "utf8");
const start = source.indexOf('  pi.on("tool_call", event => {', source.indexOf('const probe ='));
const end = source.indexOf('  pi.on("tool_result"', start);
const callback = source.slice(start, end)
  .replaceAll('${nativeChild}', 'true')
  .replaceAll(/\$\{JSON.stringify\(join\(evidence, "[^"]+"\)\)\}/g, '"test-evidence"')
  .replaceAll('${JSON.stringify(cwd)}', '"/trial/repo"')
  .replaceAll('${JSON.stringify(root)}', '"/trial"');
const prepared = {
  agent: "legion-t04-probe", async: true, context: "fresh", cwd: "/trial/repo", worktree: false,
  artifacts: true, model: "configured/model", task: "Read the exact resources.", timeoutMs: 5400000,
  extensionBindings: { "pi-legion/1": { trial: "/trial" } }
};
let gate;
const publications = [];
new Function("pi", "readFileSync", "writeFileSync", "isDeepStrictEqual", "let launched = false;\n" + callback)(
  { on: (_name, handler) => { gate = handler; } },
  () => JSON.stringify(prepared),
  (...args) => publications.push(args),
  isDeepStrictEqual
);
for (const input of [
  { ...prepared, model: "foreign/model" },
  { ...prepared, task: "Do other work." },
  { ...prepared, timeoutMs: 1 },
  { ...prepared, unexpected: true },
  { ...prepared, extensionBindings: { "pi-legion/1": { trial: "/foreign" } } },
  { ...prepared, artifacts: false },
  { ...prepared, action: "list", capabilities: true }
]) {
  assert.equal(gate({ toolName: "subagent", input }).block, true, JSON.stringify(input));
}
assert.equal(publications.length, 0);
assert.equal(gate({ toolName: "subagent", input: structuredClone(prepared) }), undefined);
assert.equal(publications.length, 1);
assert.equal(gate({ toolName: "subagent", input: structuredClone(prepared) }).block, true);
process.stdout.write("Seven changed inputs refused before publication. Exact prepared input admitted once. Duplicate refused. No actors launched.\n");
