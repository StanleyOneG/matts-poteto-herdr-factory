import {
  mkdirSync,
  existsSync,
  readdirSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
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
export const SnapshotSchema = z.object({
  version: z.literal(1),
  id: LegatusId,
  context: z.string(),
  revision: z.int(),
  generation: z.int(),
  attachments: z.array(z.object({ session: z.string(), generation: z.int() })),
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
        kind: z.enum(["saved", "applied"]),
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
export class SnapshotStore {
  constructor(
    private root: string,
    private fault?: (point: "before-commit" | "after-commit") => void,
  ) {}
  exists(id: string) {
    return existsSync(join(this.root, `${LegatusId.parse(id)}.sqlite`));
  }
  async recover(
    id: string,
    owned: () => boolean,
  ): Promise<LegatusSnapshot | null> {
    if (!this.exists(id)) return null;
    const DB = await sqlite();
    if (!owned()) throw new Error("Ownership was revoked before recovery.");
    const db = new DB(join(this.root, `${LegatusId.parse(id)}.sqlite`));
    try {
      db.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE");
      const row = z
        .object({ value: z.string() })
        .parse(
          db.prepare("SELECT value FROM snapshot WHERE singleton=1").get(),
        );
      return SnapshotSchema.parse(JSON.parse(row.value));
    } finally {
      db.close();
    }
  }
  async read(id: string): Promise<LegatusSnapshot | null> {
    const valid = LegatusId.parse(id);
    const path = join(this.root, `${valid}.sqlite`);
    if (!existsSync(path)) return null;
    const DB = await sqlite();
    const db = new DB(path, { readOnly: true });
    try {
      db.exec("PRAGMA query_only=ON");
      const row = z
        .object({ value: z.string() })
        .parse(
          db.prepare("SELECT value FROM snapshot WHERE singleton=1").get(),
        );
      return SnapshotSchema.parse(JSON.parse(row.value));
    } finally {
      db.close();
    }
  }
  async find(
    session: string,
    context: string,
  ): Promise<LegatusSnapshot | null> {
    if (!existsSync(this.root)) return null;
    const matches: LegatusSnapshot[] = [];
    for (const file of readdirSync(this.root).filter((f) =>
      /^[0-9a-f-]+\.sqlite$/.test(f),
    )) {
      const state = await this.read(file.slice(0, -7));
      if (
        state?.context === context &&
        state.attachments.some((a) => a.session === session)
      )
        matches.push(state);
    }
    if (matches.length > 1)
      throw new Error(
        "Multiple Legati are attached. Use status <id> or resume <id>.",
      );
    return matches[0] ?? null;
  }
  async acquire(id: string): Promise<DatabaseSync> {
    LegatusId.parse(id);
    const parent = dirname(this.root);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    syncDirectory(parent);
    const DB = await sqlite();
    const db = new DB(join(this.root, `${id}.lock`));
    try {
      db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner (id INTEGER); BEGIN EXCLUSIVE",
      );
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
    const db = new DB(join(this.root, `${state.id}.sqlite`));
    try {
      db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS snapshot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)",
      );
      const row = db
        .prepare("SELECT value FROM snapshot WHERE singleton=1")
        .get();
      const revision = row
        ? SnapshotSchema.parse(
            JSON.parse(z.object({ value: z.string() }).parse(row).value),
          ).revision
        : null;
      if (revision !== expected)
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
