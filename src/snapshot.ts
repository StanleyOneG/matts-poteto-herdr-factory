import { ResearchRecord, ResearchStage } from "./owned-children.js";
import { ContractEvidence } from "./engineering-contract.js";
import {
  mkdirSync,
  existsSync,
  readdirSync,
  openSync,
  fsyncSync,
  closeSync,
  readFileSync,
  writeSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const LegatusId = z.uuid().brand<"LegatusId">();
export const SubmissionId = z.uuid().brand<"SubmissionId">();
export const TaskId = z.uuid().brand<"TaskId">();
export const TaskRef = z.object({ id: TaskId, revision: z.int().positive() });
export const SubmissionRef = z.object({
  id: SubmissionId,
  revision: z.int().positive(),
});
export const DecisionId = z.uuid().brand<"DecisionId">();
export const Ref = z.object({ id: DecisionId, revision: z.int().positive() });
const InputContext = {
  session: z.string().brand<"SessionId">(),
  generation: z.int().positive().nullable(),
  presented: z.array(
    z.object({ decision: Ref, amendment: z.string().nullable() }),
  ),
};
export const InputEvidence = z.discriminatedUnion("origin", [
  z.object({
    ...InputContext,
    origin: z.literal("emperor"),
    transport: z.enum(["interactive", "rpc"]),
  }),
  z.object({
    ...InputContext,
    origin: z.literal("extension"),
    transport: z.literal("extension"),
  }),
  z.object({
    ...InputContext,
    origin: z.literal("host-command"),
    transport: z.literal("source-unavailable"),
  }),
]);
export const AmendmentId = z.uuid().brand<"AmendmentId">();
export const DecisionEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("record-clarification"),
    target: TaskRef,
    answer: z.string(),
  }),
  z.object({
    kind: z.literal("resolve-routing"),
    original: SubmissionRef,
    routing: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("new-task") }),
      z.object({ kind: z.literal("correction"), target: TaskRef }),
    ]),
  }),
  z.object({ kind: z.literal("approve-amendment"), amendment: AmendmentId }),
  z.object({ kind: z.literal("decline-amendment"), amendment: AmendmentId }),
  z.object({
    kind: z.literal("clarify"),
    question: z.string().min(1),
    recommendation: z.string().min(1),
  }),
]);
const Receipt = z.object({
  legatus: LegatusId,
  requestKey: z.string(),
  sequence: z.int(),
  message: z.string(),
});
export const WorkspaceRequest = z.object({
  id: z.string().min(1).brand<"WorkspaceRequestId">(),
  fingerprint: z.string(),
  intent: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("reserve"),
      task: TaskRef,
      parent: z.string(),
      source: z.string().nullable(),
    }),
    z.object({ kind: z.literal("reconcile"), task: TaskId }),
  ]),
  evidence: InputEvidence,
  generation: z.int().positive(),
  epoch: z.int().nonnegative(),
  scope: z.string(),
  repository: z.string().nullable(),
  repositoryId: z.uuid().nullable().default(null),
});
export const LaunchRequest = z.object({
  id: z.string().min(1), task: TaskRef, scope: z.string(), evidence: InputEvidence,
  generation: z.int().positive(), epoch: z.int().nonnegative(),
  repository: z.string(), repositoryId: z.uuid(), attempt: z.uuid().nullable().default(null),
});
export const EngineeringRef = z.strictObject({ id: z.uuid(), digest: z.string() });
export const EngineeringProposal = z.discriminatedUnion("kind", [z.strictObject({
  kind: z.literal("seam"),
  seam: z.string().trim().min(1),
  behaviors: z.array(z.string().trim().min(1)).min(1),
  verification: z.string().trim().min(1),
}), z.strictObject({
  kind: z.literal("exception"), seam: EngineeringRef, behavior: z.string().trim().min(1),
  omittedTest: z.string().trim().min(1), rationale: z.string().trim().min(1),
  alternative: z.strictObject({ description: z.string().trim().min(1), input: z.strictObject({ command: z.string().trim().min(1), timeout: z.number().positive().optional() }) }),
})]);
export const EngineeringDecision = z.object({
  kind: z.enum(["approve", "decline", "escalate"]), rationale: z.string().trim().min(1),
}).strict();
export const EngineeringDeliveryReceipt = z.strictObject({
  kind: z.literal("applied"), command: z.uuid(), evidence: z.string().min(1),
  continuation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({ kind: z.literal("dispatched"), evidence: z.string().min(1) }),
    z.strictObject({ kind: z.literal("applied"), evidence: z.string().min(1) }),
  ]),
});
export const EngineeringRecord = z.strictObject({
  id: z.uuid(),
  pin: z.strictObject({
    owner: LegatusId, session: z.string(), generation: z.int().positive(), epoch: z.int().nonnegative(),
    task: TaskRef.strict(), scope: z.string(), reservation: z.uuid(), assignment: z.uuid(),
    launch: z.uuid(), workerSession: z.string(), workerGeneration: z.uuid(), addressDigest: z.string(),
  }),
  proposal: EngineeringProposal,
  previous: EngineeringRef.optional(),
  digest: z.string(),
  requestEvidence: z.string().min(1),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("open") }),
    z.strictObject({
      kind: z.literal("decided"), decision: EngineeringDecision,
      by: z.strictObject({ session: z.string(), generation: z.int().positive(), run: z.string().min(1) }),
      delivery: z.union([z.strictObject({ kind: z.literal("pending"), command: z.uuid() }), EngineeringDeliveryReceipt]),
    }),
  ]),
});
export const EffectIntent = z.strictObject({
  id: z.uuid(), pin: EngineeringRecord.shape.pin,
  decision: z.strictObject({ id: z.uuid(), digest: z.string(), command: z.uuid() }),
  seam: EngineeringRef.optional(),
  call: z.strictObject({ id: z.string().min(1), name: z.enum(["bash", "write", "edit"]), rawInput: z.json().optional(), input: z.json(), journal: z.string().min(1) }),
  contract: ContractEvidence,
  origin: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("workspace-preparation"), child: z.uuid(), rootCall: z.string(), journal: z.string() }),
    z.strictObject({ kind: z.literal("centurio"), child: EngineeringRef, intent: z.string(), run: z.string(), session: z.string(), journal: z.string(), cwd: z.string(), branch: z.string(), base: z.string() }),
  ]).optional(),
});
export const EffectOutcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("refused"), evidence: z.string().min(1), reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal("completed"), evidence: z.string().min(1), isError: z.boolean(), exitCode: z.int().optional() }),
  z.strictObject({ kind: z.literal("unknown"), evidence: z.string().min(1), reason: z.string().min(1) }),
]);
export const EffectRecord = z.strictObject({
  intent: EffectIntent, digest: z.string(),
  state: z.union([z.strictObject({ kind: z.literal("outstanding") }), EffectOutcome]),
});
export const EngineeringEvidence = z.strictObject({
  decision: EngineeringRef, seam: EngineeringRef, effects: z.array(EngineeringRef),
  alternative: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("not-required") }),
    z.strictObject({ kind: z.literal("unverified"), reason: z.string().min(1) }),
    z.strictObject({ kind: z.literal("verified"), effect: EngineeringRef, evidence: z.string().min(1), exitCode: z.literal(0) }),
  ]),
});
export const EngineeringResult = EngineeringEvidence.extend({ priorExceptions: z.array(EngineeringEvidence) });
export const CenturioOwnerCheck = z.strictObject({
  kind: z.literal("centurio-owner-check"), id: z.uuid(), pin: EngineeringRecord.shape.pin,
  child: EngineeringRef, stage: z.enum(["launch", "read"]),
});
export const EffectMessage = z.discriminatedUnion("kind", [
  CenturioOwnerCheck,
  z.strictObject({ kind: z.literal("effect-admission"), intent: EffectIntent.extend({ call: EffectIntent.shape.call.required({ rawInput: true }) }) }),
  z.strictObject({ kind: z.literal("effect-observation"), id: z.uuid(), digest: z.string(), state: EffectOutcome }),
]);
export const EffectReply = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("centurio-owner-current"), id: z.uuid(), child: EngineeringRef }),
  z.strictObject({ kind: z.literal("effect"), effect: EffectRecord }),
  z.strictObject({
    kind: z.literal("resource-invalidated"), intent: z.strictObject({ id: z.uuid(), digest: z.string() }),
    resource: z.strictObject({ path: z.string(), reason: z.enum(["content-changed", "canonical-target-changed", "unavailable"]) }),
    message: z.string(),
  }),
  z.strictObject({ kind: z.literal("rejected"), code: z.string(), message: z.string() }),
  z.strictObject({ kind: z.literal("uncertain"), requestKey: z.string(), message: z.string() }),
]);
export const SnapshotSchema = z.object({
  version: z.literal(1),
  id: LegatusId,
  context: z.string(),
  revision: z.int(),
  generation: z.int(),
  attachments: z.array(z.object({ session: z.string(), generation: z.int() })),
  workspaceRequests: z.array(WorkspaceRequest).default([]),
  launchRequests: z.array(LaunchRequest).default([]),
  researchRequests: z.array(ResearchStage).default([]),
  research: z.array(ResearchRecord).default([]),
  researchHold: z.string().nullable().default(null),
  engineering: z.array(EngineeringRecord).default([]),
  effects: z.array(EffectRecord).default([]),
  submissions: z.array(
    z.object({
      id: SubmissionId,
      revision: z.int().positive(),
      text: z.string(),
      sequence: z.int(),
      timestamp: z.string(),
      evidence: InputEvidence,
      originIntent: z.object({ kind: z.enum(["new-task", "unclassified"]) }),
      state: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("pending"),
          routing: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("unclassified") }),
            z.object({ kind: z.literal("new-task") }),
            z.object({ kind: z.literal("correction"), target: TaskRef }),
          ]),
        }),
        z.object({ kind: z.literal("applied"), resolution: z.string() }),
        z.object({ kind: z.literal("awaiting-clarification"), decision: Ref }),
      ]),
    }),
  ),
  tasks: z.array(
    z.object({
      id: TaskId,
      technicalChoices: z.array(
        z.object({
          source: SubmissionRef,
          target: TaskRef,
          choice: z.string(),
        }),
      ),
      history: z.array(
        z.object({
          revision: z.int().positive(),
          goal: z.string(),
          acceptance: z.array(z.string()),
          source: SubmissionRef,
        }),
      ),
      scope: z.object({
        original: SubmissionId,
        context: z.string(),
        policy: z.literal("intake-only-v1"),
        amendments: z.array(z.string()),
      }),
    }),
  ),
  decisions: z.array(
    z.object({
      id: DecisionId,
      history: z.array(
        z.object({
          revision: z.int().positive(),
          kind: z.enum(["product", "routing", "protected"]),
          question: z.string(),
          recommendation: z.string(),
          affected: z.array(TaskRef),
          original: SubmissionRef,
          amendment: AmendmentId.nullable(),
        }),
      ),
      state: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("open") }),
        z.object({ kind: z.literal("resolved"), resolution: z.string() }),
      ]),
    }),
  ),
  amendments: z.array(
    z.object({
      id: AmendmentId,
      decision: Ref,
      affected: z.array(TaskRef).min(1),
      category: z.enum(["requirements", "financial", "access", "irreversible"]),
      change: z.string().min(1),
    }),
  ),
  resolutions: z.array(
    z.object({
      id: z.string(),
      decision: Ref,
      answerSource: SubmissionRef,
      effect: DecisionEffectSchema,
    }),
  ),
  receipts: z.array(
    z.object({
      fingerprint: z.string(),
      result: z.object({
        kind: z.enum(["saved", "applied", "deferred"]),
        receipt: Receipt,
      }),
    }),
  ),
});
export type LegatusSnapshot = z.infer<typeof SnapshotSchema>;
export type EmperorInputEvidence = z.infer<typeof InputEvidence>;
export type CommittedResult = LegatusSnapshot["receipts"][number]["result"];

async function sqlite() {
  return (await import("node:sqlite")).DatabaseSync;
}
function syncDirectory(path: string) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export type StorageFaultPoint =
  | "before-commit"
  | "after-commit"
  | "route-opened"
  | "before-route-publish"
  | "after-route-publish"
  | "after-bootstrap-commit"
  | "before-initialized-publish"
  | "after-initialized-publish";
export function createSnapshot(input: {
  id: string;
  context: string;
}): LegatusSnapshot {
  return SnapshotSchema.parse({
    version: 1,
    ...input,
    revision: 0,
    generation: 0,
    attachments: [],
    submissions: [],
    tasks: [],
    decisions: [],
    amendments: [],
    resolutions: [],
    receipts: [],
  });
}
const Initialized = z
  .object({
    version: z.literal(1),
    kind: z.literal("initialized"),
    id: LegatusId,
    context: z.string(),
  })
  .strict();
const Route = z
  .object({
    version: z.literal(1),
    id: LegatusId,
    context: z.string(),
    session: z.string(),
    kind: z.enum(["initial", "alias"]),
  })
  .strict();
type Route = z.infer<typeof Route>;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class SnapshotStore {
  constructor(
    private root: string,
    private fault?: (point: StorageFaultPoint) => void,
  ) {}
  private path(id: string, suffix: string) {
    return join(this.root, `v1.${LegatusId.parse(id)}.${suffix}`);
  }
  private prefix(context: string, session: string) {
    return `v1.${digest(context)}.${digest(session)}.`;
  }
  private routeName(route: Route) {
    return `${this.prefix(route.context, route.session)}${route.id}.${route.kind}.route`;
  }
  private route(file: string): Route {
    const route = Route.parse(
      JSON.parse(readFileSync(join(this.root, file), "utf8")),
    );
    if (this.routeName(route) !== file.replace(/\.pending$/, ""))
      throw new Error("Routing content does not match its identity filename.");
    return route;
  }
  private files() {
    return existsSync(this.root) ? readdirSync(this.root) : [];
  }
  private identity(id: string, recovery = false): Route {
    const names = this.files();
    const suffix = `.${LegatusId.parse(id)}.initial.route`;
    let files = names.filter((file) => file.endsWith(suffix));
    if (!files.length && recovery)
      files = names.filter((file) => file.endsWith(`${suffix}.pending`));
    if (!files.length && existsSync(join(this.root, `${id}.sqlite`)))
      throw new Error(
        "Unsupported development storage layout. Existing files are preserved; no automatic upgrade is supported.",
      );
    if (files.length !== 1)
      throw new Error(
        `Creation identity unavailable for ${id}. Explicit recovery is required.`,
      );
    const file = files[0];
    if (!file) throw new Error("Creation identity missing.");
    const route = this.route(file);
    if (route.id !== id || route.kind !== "initial")
      throw new Error("Invalid creation identity.");
    return route;
  }
  private publishFile(
    file: string,
    content: string,
    route: boolean,
    owned: () => boolean,
  ) {
    if (!owned())
      throw new Error("Ownership was revoked before identity publication.");
    const final = join(this.root, file);
    const pending = `${final}.pending`;
    for (const path of [final, pending])
      if (existsSync(path) && readFileSync(path, "utf8") !== content)
        throw new Error(
          "Immutable identity publication changed or is incomplete.",
        );
    if (!existsSync(final) && !existsSync(pending)) {
      const fd = openSync(pending, "wx", 0o600);
      try {
        syncDirectory(this.root);
        if (route) this.fault?.("route-opened");
        if (!owned())
          throw new Error("Ownership was revoked before writing identity.");
        writeSync(fd, content);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      syncDirectory(this.root);
    }
    if (!existsSync(final)) {
      this.fault?.(
        route ? "before-route-publish" : "before-initialized-publish",
      );
      if (!owned())
        throw new Error("Ownership was revoked before publishing identity.");
      linkSync(pending, final);
      syncDirectory(this.root);
      this.fault?.(route ? "after-route-publish" : "after-initialized-publish");
    }
    if (existsSync(pending)) {
      if (!owned())
        throw new Error(
          "Ownership was revoked before reconciling publication.",
        );
      unlinkSync(pending);
      syncDirectory(this.root);
    }
  }
  private publish(route: Route, owned: () => boolean) {
    this.publishFile(this.routeName(route), JSON.stringify(route), true, owned);
  }
  private initialized(identity: Route) {
    const path = this.path(identity.id, "initialized");
    if (!existsSync(path)) return false;
    const marker = Initialized.parse(JSON.parse(readFileSync(path, "utf8")));
    if (marker.id !== identity.id || marker.context !== identity.context)
      throw new Error("Initialization identity mismatch.");
    return true;
  }
  private async bootstrap(
    identity: Route,
    owned: () => boolean,
  ): Promise<LegatusSnapshot> {
    if (!owned())
      throw new Error("Ownership was revoked before initialization.");
    const DB = await sqlite();
    if (!owned())
      throw new Error(
        "Ownership was revoked before opening initialization storage.",
      );
    const db = new DB(this.path(identity.id, "sqlite"));
    let state: LegatusSnapshot;
    try {
      db.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE");
      const tables = z
        .array(z.object({ name: z.string() }))
        .parse(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
        );
      if (tables.length === 0 && !this.initialized(identity)) {
        state = createSnapshot({ id: identity.id, context: identity.context });
        db.exec(
          "BEGIN IMMEDIATE; CREATE TABLE snapshot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)",
        );
        db.prepare("INSERT INTO snapshot VALUES(1, ?)").run(
          JSON.stringify(state),
        );
        if (!owned())
          throw new Error("Ownership was revoked before bootstrap commit.");
        db.exec("COMMIT");
        syncDirectory(this.root);
        this.fault?.("after-bootstrap-commit");
      } else {
        if (tables.length !== 1 || tables[0]?.name !== "snapshot")
          throw new Error(
            "Initialized snapshot table is missing or corrupt. History cannot be reset.",
          );
        const row = z
          .object({ value: z.string() })
          .parse(
            db.prepare("SELECT value FROM snapshot WHERE singleton=1").get(),
          );
        state = SnapshotSchema.parse(JSON.parse(row.value));
        if (state.id !== identity.id || state.context !== identity.context)
          throw new Error("Snapshot identity does not match routing.");
        if (
          !this.initialized(identity) &&
          JSON.stringify(state) !==
            JSON.stringify(
              createSnapshot({ id: identity.id, context: identity.context }),
            )
        )
          throw new Error(
            "Unmarked snapshot is not a recognized initial bootstrap. History cannot be reset.",
          );
      }
    } finally {
      db.close();
    }
    if (!owned())
      throw new Error(
        "Ownership was revoked before initialization publication.",
      );
    const marker = Initialized.parse({
      version: 1,
      kind: "initialized",
      id: identity.id,
      context: identity.context,
    });
    this.publishFile(
      `v1.${identity.id}.initialized`,
      JSON.stringify(marker),
      false,
      owned,
    );
    return state;
  }
  exists(id: string) {
    const valid = LegatusId.parse(id);
    return (
      existsSync(this.path(valid, "sqlite")) ||
      this.files().some(
        (file) => file.includes(`.${valid}.`) && file.includes(".route"),
      ) ||
      existsSync(join(this.root, `${valid}.sqlite`))
    );
  }
  async recover(
    id: string,
    context: string,
    owned: () => boolean,
  ): Promise<LegatusSnapshot | null> {
    if (!this.exists(id)) return null;
    if (!owned()) throw new Error("Ownership was revoked before recovery.");
    const identity = this.identity(id, true);
    if (identity.context !== context)
      throw new Error("Recovery context does not match creation identity.");
    this.publish(identity, owned);
    return this.bootstrap(identity, owned);
  }
  async read(id: string): Promise<LegatusSnapshot | null> {
    if (!this.exists(id)) return null;
    const identity = this.identity(id);
    if (!this.initialized(identity))
      throw new Error(
        `Initial creation is incomplete. Explicitly resume ${id}.`,
      );
    const path = this.path(id, "sqlite");
    if (!existsSync(path))
      throw new Error(
        `Snapshot unavailable for ${id}. Explicit recovery is required.`,
      );
    const DB = await sqlite();
    const db = new DB(path, { readOnly: true });
    try {
      db.exec("PRAGMA query_only=ON");
      const row = z
        .object({ value: z.string() })
        .parse(
          db.prepare("SELECT value FROM snapshot WHERE singleton=1").get(),
        );
      const state = SnapshotSchema.parse(JSON.parse(row.value));
      if (state.id !== id || state.context !== identity.context)
        throw new Error("Snapshot identity does not match routing.");
      return state;
    } finally {
      db.close();
    }
  }
  async find(
    session: string,
    context: string,
  ): Promise<LegatusSnapshot | null> {
    const files = this.files().filter((file) =>
      file.startsWith(this.prefix(context, session)),
    );
    const ids = new Set<string>();
    for (const file of files) {
      if (file.endsWith(".pending"))
        throw new Error(
          `Routing publication unavailable. Explicit recovery is required. ${file}`,
        );
      const route = this.route(file);
      if (route.context !== context || route.session !== session)
        throw new Error("Routing identity mismatch.");
      ids.add(route.id);
    }
    if (ids.size > 1)
      throw new Error(
        "Multiple Legati are attached. Use status <id> or resume <id>.",
      );
    const id = ids.values().next().value;
    if (!id) return null;
    const state = await this.read(id);
    if (!state || !state.attachments.some((a) => a.session === session))
      throw new Error(`Attachment is not committed. Explicitly resume ${id}.`);
    return state;
  }
  async acquireAssociation(input: {
    context: string;
    session: string;
    resume: string | null;
  }): Promise<DatabaseSync> {
    if (
      input.resume &&
      this.identity(input.resume, true).context !== input.context
    )
      throw new Error("Recovery context does not match creation identity.");
    return this.acquirePath(
      join(
        this.root,
        `association.v1.${digest(input.context)}.${digest(input.session)}.lock`,
      ),
    );
  }
  async acquire(id: string): Promise<DatabaseSync> {
    return this.acquirePath(this.path(id, "lock"));
  }
  private async acquirePath(path: string): Promise<DatabaseSync> {
    const parent = dirname(this.root);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    syncDirectory(parent);
    const DB = await sqlite();
    const db = new DB(path);
    try {
      db.exec("BEGIN IMMEDIATE");
      syncDirectory(this.root);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  async save(
    state: LegatusSnapshot,
    expected: number | null,
    owned: () => boolean,
  ) {
    const DB = await sqlite();
    if (!owned()) throw new Error("Ownership was revoked.");
    const session = state.attachments.at(-1)?.session;
    if (!session) throw new Error("No session attachment to publish.");
    if (expected === null)
      this.publish(
        Route.parse({
          version: 1,
          id: state.id,
          context: state.context,
          session,
          kind: "initial",
        }),
        owned,
      );
    const identity = this.identity(state.id);
    if (identity.context !== state.context)
      throw new Error("Creation context mismatch.");
    if (!this.initialized(identity)) await this.bootstrap(identity, owned);
    if (!owned())
      throw new Error("Ownership was revoked before attachment publication.");
    if (session !== identity.session)
      this.publish(Route.parse({ ...identity, session, kind: "alias" }), owned);
    const db = new DB(this.path(state.id, "sqlite"));
    try {
      db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE",
      );
      const row = db
        .prepare("SELECT value FROM snapshot WHERE singleton=1")
        .get();
      const revision = row
        ? SnapshotSchema.parse(
            JSON.parse(z.object({ value: z.string() }).parse(row).value),
          ).revision
        : null;
      if (revision !== (expected ?? 0))
        throw new Error("Aggregate revision changed. Reopen state.");
      db.prepare("INSERT OR REPLACE INTO snapshot VALUES(1, ?)").run(
        JSON.stringify(state),
      );
      this.fault?.("before-commit");
      if (!owned()) throw new Error("Ownership was revoked before commit.");
      db.exec("COMMIT");
      this.fault?.("after-commit");
      syncDirectory(this.root);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      db.close();
    }
  }
}
