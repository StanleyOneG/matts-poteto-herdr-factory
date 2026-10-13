import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { digest, readCenturio } from "../src/centuriones.js";
import { LegacyBoundedAssignment, LaunchRecord } from "../src/tribunus.js";
import { publish } from "../src/private-evidence.js";

const id = "00000000-0000-4000-8000-000000000001";
const address = { launch: id, window: { endpoint: "/legacy/herdr", server: "legacy", workspace: "w", tab: "t", pane: "p", terminal: "term" }, session: "legacy-worker", generation: id };
const assignment = { task: { id, revision: 1 }, scope: "task-local", goal: "Retained goal", acceptance: ["Retained criterion"], workflow: "implement", testContract: "Matt TDD at Legatus-approved public seams; request an explicit exception if impractical", authority: "bounded-implementation-only" };

test("historical Centurio intent retains its byte order and digest without becoming a current native intent", () => {
  const intent = {
    id, authority: { owner: id, session: "legacy-controller", generation: 1, epoch: 0 }, purpose: "review",
    role: { name: "interrogate reviewers", index: 0, selector: "inherit-parent", model: "legacy/model", configuration: "/legacy/models.json", digest: "retained-role", parentModel: "legacy/model" },
    cwd: "/legacy/worktree", task: "Historical review", agent: "legacy-agent", definitionDigest: "retained-definition", endpoint: "/legacy/child.sock", capability: "retained-capability",
    owner: address, assignment: { command: id, value: assignment },
  };
  const before = JSON.stringify(intent), hash = digest(intent), path = join(mkdtempSync(join(tmpdir(), "centurio-legacy-hash-")), "intent.json");
  publish(path, { intent, digest: hash });
  const record = readCenturio({ path, digest: hash });
  assert.equal(JSON.stringify(record.intent), before);
  assert.equal(digest(record.intent), hash);
  assert.equal("kind" in record.intent, false, "Historical parsing does not confer owned-native launch authority");
  assert.deepEqual(LegacyBoundedAssignment.parse(assignment), assignment);
});

test("historical launch assignment preserves the retired testContract field for persisted evidence", () => {
  const worker = { address, identityEvidence: "retained-identity", resources: { cwd: "/legacy/worktree", skills: [], diagnostics: [] } };
  const progress = LaunchRecord.shape.state.parse({ kind: "assigned", worker, initialization: {
    command: id, address, nativePrompt: "retained-prompt", skillPath: "/legacy/poteto-mode/SKILL.md", modeEntry: "retained-mode", settledEntry: "retained-settled",
  }, command: id, assignment, application: "retained-application" });
  assert.ok(progress.kind === "assigned");
  assert.deepEqual(progress.assignment, assignment);
  assert.equal(JSON.stringify(progress.assignment), JSON.stringify(assignment));
});
