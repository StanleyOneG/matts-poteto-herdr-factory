import { randomUUID } from "node:crypto";
import { LaunchRecord, projectLaunch, type LaunchView } from "./tribunus.js";
import {
  mkdirSync,
  existsSync,
  openSync,
  writeFileSync,
  readFileSync,
  closeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { join, dirname, relative, isAbsolute, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { LegatusId, TaskId, TaskRef } from "./snapshot.js";
import { WorkspacePlan, type RepositoryLocation } from "./git-workspace.js";

const ReservationId = z.uuid().brand<"ReservationId">();
export const OperationId = z.uuid().brand<"OperationId">();
export const ApprovalPin = z.object({ task: TaskRef, scope: z.string() });
export const Reservation = z.object({
  id: ReservationId,
  repository: z.uuid().brand<"RepositoryId">(),
  shared: z.string(),
  owner: LegatusId,
  task: TaskId,
  approval: ApprovalPin,
  plan: WorkspacePlan,
});
export type Reservation = z.infer<typeof Reservation>;
const Step = z.enum(["branch", "worktree"]);
const Operation = z.object({
  id: OperationId,
  reservation: ReservationId,
  step: Step,
});
export type AssignmentOperation = z.infer<typeof Operation>;
const Outcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("succeeded") }),
  z.object({
    kind: z.literal("failed"),
    message: z.string(),
    noEffect: z.boolean(),
  }),
  z.object({ kind: z.literal("unknown"), message: z.string() }),
]);
export const WorkspaceState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("planned") }),
  z.object({ kind: z.literal("dispatched"), operation: Operation }),
  z.object({ kind: z.literal("branch-owned") }),
  z.object({ kind: z.literal("ready") }),
  z.object({
    kind: z.literal("held"),
    code: z.string(),
    message: z.string(),
    operation: Operation.nullable(),
  }),
]);
export type WorkspaceState = z.infer<typeof WorkspaceState>;
export type ClaimView =
  | { kind: "unreserved" }
  | { kind: "owned"; reservation: Reservation; workspace: WorkspaceState }
  | { kind: "foreign"; reservation: Reservation }
  | { kind: "unavailable"; message: string };
export const ReservationReceipt = z.object({
  requestKey: z.string(),
  reservation: Reservation,
});
export type ReservationReceipt = z.infer<typeof ReservationReceipt>;
const StoredReceipt = z.object({
  fingerprint: z.string(),
  receipt: ReservationReceipt,
});
const Identity = z
  .object({
    version: z.literal(1),
    repository: z.uuid(),
    commonDir: z.string(),
  })
  .strict();
export type AssignmentFaultPoint =
  | "after-initialization"
  | "before-launch-migration-commit"
  | "after-launch-migration-commit"
  | "after-launch-commit"
  | "before-reservation-commit"
  | "after-reservation-commit"
  | "after-dispatch"
  | "before-outcome-commit"
  | "after-outcome-commit";
const sync = (path: string) => {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
function rowValue(raw: unknown): string {
  return z.object({ value: z.string() }).parse(raw).value;
}
export function sharedIdentity(
  task: z.infer<typeof TaskId>,
  source: string | null,
): string {
  if (!source) return `direct:${task}`;
  const match =
    /^https:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/issues\/([1-9][0-9]*)\/?$/.exec(
      source,
    );
  if (!match)
    throw new Error(
      "Unsupported task reference. Use a canonical GitHub issue URL.",
    );
  return `github:github.com:${match[1]?.toLowerCase()}/${match[2]?.toLowerCase()}:${BigInt(match[3] ?? "0")}`;
}
function contains(root: string, path: string) {
  const delta = relative(root, path);
  return (
    delta === "" ||
    (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
  );
}
export function persistentRoot(
  root: string,
  location: RepositoryLocation,
): string {
  if (!isAbsolute(root)) throw new Error("Workspace root must be absolute.");
  let existing = root;
  while (!existsSync(existing)) existing = dirname(existing);
  const canonical = join(realpathSync(existing), relative(existing, root));
  if (
    canonical !== root ||
    location.worktrees.some((path) => contains(realpathSync(path), canonical))
  )
    throw new Error(
      "Workspace root must be outside all worktrees and must not resolve through a symlink.",
    );
  return canonical;
}
export class AssignmentConflict extends Error {
  constructor(
    readonly code: "binding-conflict" | "request-conflict" | "plan-conflict",
    message: string,
  ) {
    super(message);
  }
}
export class AssignmentLedger {
  readonly path: string;
  private root: string;
  constructor(
    readonly commonDir: string,
    private fault?: (point: AssignmentFaultPoint) => void,
    private expectedRepository: string | null = null,
    private historyRequired = false,
  ) {
    this.root = join(commonDir, "legion");
    this.path = join(this.root, "assignments.sqlite");
  }
  private identity(recovery: boolean) {
    const final = join(this.root, "assignments.initialized");
    const pending = join(this.root, "assignments.pending");
    const path = existsSync(final)
      ? final
      : recovery && existsSync(pending)
        ? pending
        : null;
    if (!path) {
      if (this.expectedRepository || this.historyRequired)
        throw new Error(
          "Known assignment history is missing. History cannot be reset.",
        );
      if (existsSync(this.path) || existsSync(pending))
        throw new Error(
          "Assignment initialization is unavailable. History cannot be reset.",
        );
      return null;
    }
    const identity = Identity.parse(JSON.parse(readFileSync(path, "utf8")));
    if (
      identity.commonDir !== this.commonDir ||
      (this.expectedRepository &&
        identity.repository !== this.expectedRepository)
    )
      throw new Error("Repository metadata identity changed.");
    this.expectedRepository ??= identity.repository;
    return identity;
  }
  private async open(
    write: boolean,
    owned: () => boolean = () => true,
    initialize = false,
  ): Promise<DatabaseSync | null> {
    const DB = (await import("node:sqlite")).DatabaseSync;
    if (write && !owned())
      throw new Error("Assignment publication authority revoked.");
    let identity = this.identity(write);
    if (!identity && !write) return null;
    if (!identity && !initialize)
      throw new Error(
        "Assignment history unavailable. History cannot be reset.",
      );
    if (!identity) {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      sync(this.commonDir);
      const value = Identity.parse({
        version: 1,
        repository: randomUUID(),
        commonDir: this.commonDir,
      });
      try {
        const fd = openSync(
          join(this.root, "assignments.pending"),
          "wx",
          0o600,
        );
        try {
          writeFileSync(fd, JSON.stringify(value));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        sync(this.root);
      } catch (error) {
        if (!existsSync(join(this.root, "assignments.pending"))) throw error;
      }
      identity = this.identity(true);
    }
    if (!identity) throw new Error("Assignment identity unavailable.");
    if (
      !existsSync(this.path) &&
      existsSync(join(this.root, "assignments.initialized"))
    )
      throw new Error(
        "Initialized assignment history is missing. History cannot be reset.",
      );
    const db = new DB(this.path, { readOnly: !write });
    try {
      if (!write) db.exec("PRAGMA query_only=ON");
      else db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      if (!existsSync(join(this.root, "assignments.initialized"))) {
        if (!write || !initialize)
          throw new Error("Explicit assignment recovery is required.");
        db.exec("BEGIN IMMEDIATE");
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all();
        if (!tables.length) {
          db.exec(`CREATE TABLE repository (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
            CREATE TABLE bindings (owner TEXT NOT NULL, task TEXT NOT NULL, shared TEXT NOT NULL, PRIMARY KEY(owner, task), UNIQUE(owner, shared));
            CREATE TABLE claims (shared TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, task TEXT NOT NULL, branch TEXT UNIQUE NOT NULL, path TEXT UNIQUE NOT NULL, value TEXT NOT NULL);
            CREATE INDEX claims_owner ON claims(owner, task);
            CREATE TABLE receipts (owner TEXT NOT NULL, request TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner, request));
            CREATE TABLE operations (id TEXT PRIMARY KEY, reservation TEXT NOT NULL, step TEXT NOT NULL, value TEXT NOT NULL);
            CREATE INDEX operations_reservation ON operations(reservation);
            CREATE TABLE outcomes (operation TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE holds (reservation TEXT PRIMARY KEY, value TEXT NOT NULL);`);
          db.prepare("INSERT INTO repository VALUES(1, ?)").run(
            JSON.stringify(identity),
          );
        }
        const stored = Identity.parse(
          JSON.parse(
            rowValue(
              db
                .prepare("SELECT value FROM repository WHERE singleton=1")
                .get(),
            ),
          ),
        );
        if (JSON.stringify(stored) !== JSON.stringify(identity))
          throw new Error("Assignment initialization witness mismatch.");
        if (!owned())
          throw new Error("Assignment initialization authority revoked.");
        db.exec("COMMIT");
        sync(this.root);
        this.fault?.("after-initialization");
        if (!owned())
          throw new Error("Assignment publication authority revoked.");
        if (!existsSync(join(this.root, "assignments.initialized")))
          linkSync(
            join(this.root, "assignments.pending"),
            join(this.root, "assignments.initialized"),
          );
        sync(this.root);
        if (existsSync(join(this.root, "assignments.pending")))
          unlinkSync(join(this.root, "assignments.pending"));
        sync(this.root);
      }
      const stored = Identity.parse(
        JSON.parse(
          rowValue(
            db.prepare("SELECT value FROM repository WHERE singleton=1").get(),
          ),
        ),
      );
      if (JSON.stringify(stored) !== JSON.stringify(identity))
        throw new Error("Assignment repository witness mismatch.");
      return db;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      db.close();
      throw error;
    }
  }
  private launchSchema(db: DatabaseSync, known = false): "legacy" | "current" {
    const tables = z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
    const marker = tables.some((t) => t.name === "legion_schema");
    const launches = tables.some((t) => t.name === "tribuni");
    if (!marker && !launches) {
      if (known) throw new Error("Known launch history is missing. History cannot be reset.");
      return "legacy";
    }
    if (!marker || !launches) throw new Error("Launch schema history is incomplete. Preserve assignment history.");
    const version = z.object({ version: z.literal(2) }).parse(db.prepare("SELECT version FROM legion_schema WHERE singleton=1").get());
    if (version.version !== 2) throw new Error("Unsupported launch history.");
    return "current";
  }
  async launchState(reservation: Reservation, known: string | null = null): Promise<LaunchView> {
    const db = await this.open(false);
    if (!db) throw new Error("Known assignment history unavailable.");
    try {
      if (this.launchSchema(db, known !== null) === "legacy") return { kind: "not-launched" };
      const row = db.prepare("SELECT value FROM tribuni WHERE reservation=?").get(reservation.id);
      if (known && !row) throw new Error("Known launch row is missing. History cannot be reset.");
      if (!row) return { kind: "not-launched" };
      const launch = LaunchRecord.parse(JSON.parse(rowValue(row)));
      return { ...projectLaunch(launch.state), startEvidence: launch.startEvidence };
    } finally { db.close(); }
  }
  async beginLaunch(reservation: Reservation, owned: () => boolean, known: string | null = null): Promise<LaunchRecord> {
    const db = await this.open(true, owned);
    if (!db) throw new Error("Assignment history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      if (this.launchSchema(db, known !== null) === "legacy") {
        db.exec(`CREATE TABLE legion_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
          CREATE TABLE tribuni (reservation TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL);
          INSERT INTO legion_schema VALUES(1,2);`);
        this.fault?.("before-launch-migration-commit");
        if (!owned()) throw new Error("Launch migration authority revoked.");
        db.exec("COMMIT");
        this.fault?.("after-launch-migration-commit");
        db.exec("BEGIN IMMEDIATE");
      }
      const row = db.prepare("SELECT value FROM tribuni WHERE reservation=?").get(reservation.id);
      if (row) {
        const launch = LaunchRecord.parse(JSON.parse(rowValue(row)));
        if (known && launch.id !== known) throw new Error("Known launch identity changed.");
        db.exec("ROLLBACK"); return launch;
      }
      if (known) throw new Error("Known launch row is missing. History cannot be reset.");
      const claim = db.prepare("SELECT value FROM claims WHERE id=?").get(reservation.id);
      if (!claim || rowValue(claim) !== JSON.stringify(reservation) || this.workspace(db, reservation).kind !== "ready")
        throw new Error("Confirmed owned ready reservation required for launch.");
      const launch = LaunchRecord.parse({ id: randomUUID(), reservation: reservation.id, revision: 0, scope: reservation.approval.scope, state: { kind: "prepared" } });
      db.prepare("INSERT INTO tribuni VALUES(?,?,?,?)").run(reservation.id, launch.id, launch.revision, JSON.stringify(launch));
      if (!owned()) throw new Error("Launch publication authority revoked.");
      db.exec("COMMIT");
      this.fault?.("after-launch-commit");
      return launch;
    } finally { try { db.exec("ROLLBACK"); } catch {} db.close(); }
  }
  async updateLaunch(reservation: Reservation, prior: LaunchRecord, state: LaunchRecord["state"], owned: () => boolean, startEvidence = prior.startEvidence) {
    const db = await this.open(true, owned);
    if (!db) throw new Error("Launch history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      if (this.launchSchema(db) !== "current") throw new Error("Known launch history missing.");
      const claim = db.prepare("SELECT value FROM claims WHERE id=?").get(reservation.id);
      if (!claim || rowValue(claim) !== JSON.stringify(reservation)) throw new Error("Launch reservation changed.");
      const retained = db.prepare("SELECT value FROM tribuni WHERE reservation=? AND id=? AND revision=?").get(reservation.id, prior.id, prior.revision);
      if (!retained || JSON.stringify(LaunchRecord.parse(JSON.parse(rowValue(retained)))) !== JSON.stringify(prior)) throw new Error("Launch history changed before publication.");
      const next = LaunchRecord.parse({ ...prior, revision: prior.revision + 1, state, startEvidence });
      const changed = db.prepare("UPDATE tribuni SET revision=?,value=? WHERE reservation=? AND id=? AND revision=? AND value=?").run(next.revision, JSON.stringify(next), reservation.id, prior.id, prior.revision, rowValue(retained));
      if (changed.changes !== 1) throw new Error("Launch history changed before publication.");
      if (!owned()) throw new Error("Launch authority revoked before publication.");
      db.exec("COMMIT");
      this.fault?.("after-launch-commit");
      return next;
    } finally { try { db.exec("ROLLBACK"); } catch {} db.close(); }
  }
  async recoverExisting(owned: () => boolean) {
    if (
      !existsSync(join(this.root, "assignments.pending")) ||
      existsSync(join(this.root, "assignments.initialized"))
    )
      return;
    const db = await this.open(true, owned, true);
    db?.close();
  }
  async observations(
    owner: z.infer<typeof LegatusId>,
  ): Promise<{ claims: ClaimView[]; byTask: Map<string, ClaimView> }> {
    const db = await this.open(false);
    if (!db) return { claims: [], byTask: new Map() };
    try {
      const reservations = db
        .prepare("SELECT value FROM claims")
        .all()
        .map((row) => Reservation.parse(JSON.parse(rowValue(row))));
      const byTask = new Map<string, ClaimView>();
      const claims = reservations.map((reservation) =>
        reservation.owner === owner
          ? ({
              kind: "owned",
              reservation,
              workspace: this.workspace(db, reservation),
            } satisfies ClaimView)
          : ({ kind: "foreign", reservation } satisfies ClaimView),
      );
      const bindings = z
        .array(z.object({ task: TaskId, shared: z.string() }))
        .parse(
          db
            .prepare("SELECT task,shared FROM bindings WHERE owner=?")
            .all(owner),
        );
      for (const binding of bindings) {
        const found = claims.find(
          (claim) => claim.reservation.shared === binding.shared,
        );
        byTask.set(binding.task, found ?? { kind: "unreserved" });
      }
      return { claims, byTask };
    } finally {
      db.close();
    }
  }
  private workspace(
    db: DatabaseSync,
    reservation: Reservation,
    projection = true,
  ): WorkspaceState {
    const ops = db
      .prepare(
        "SELECT value FROM operations WHERE reservation=? ORDER BY rowid",
      )
      .all(reservation.id)
      .map((row) => Operation.parse(JSON.parse(rowValue(row))));
    let state: WorkspaceState = { kind: "planned" };
    for (const operation of ops) {
      const raw = db
        .prepare("SELECT value FROM outcomes WHERE operation=?")
        .get(operation.id);
      if (!raw) return { kind: "dispatched", operation };
      const outcome = Outcome.parse(JSON.parse(rowValue(raw)));
      if (outcome.kind === "succeeded")
        state = {
          kind: operation.step === "branch" ? "branch-owned" : "ready",
        };
      else
        state = {
          kind: "held",
          code:
            outcome.kind === "unknown" || !outcome.noEffect
              ? "unknown-operation"
              : "git-failed",
          message: outcome.message,
          operation,
        };
    }
    const hold = projection
      ? db
          .prepare("SELECT value FROM holds WHERE reservation=?")
          .get(reservation.id)
      : null;
    return hold ? WorkspaceState.parse(JSON.parse(rowValue(hold))) : state;
  }
  async progress(reservation: Reservation): Promise<WorkspaceState> {
    const db = await this.open(false);
    if (!db) throw new Error("Assignment history unavailable.");
    try {
      return this.workspace(db, reservation, false);
    } finally {
      db.close();
    }
  }
  async hold(reservation: Reservation, state: WorkspaceState | null) {
    const db = await this.open(true);
    if (!db) throw new Error("Assignment history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      if (state)
        db.prepare("INSERT OR REPLACE INTO holds VALUES(?,?)").run(
          reservation.id,
          JSON.stringify(state),
        );
      else
        db.prepare("DELETE FROM holds WHERE reservation=?").run(reservation.id);
      db.exec("COMMIT");
    } finally {
      try {
        db.exec("ROLLBACK");
      } catch {}
      db.close();
    }
  }
  async replay(
    owner: z.infer<typeof LegatusId>,
    request: string,
    fingerprint: string,
  ) {
    const db = await this.open(false);
    if (!db) return null;
    try {
      const raw = db
        .prepare("SELECT value FROM receipts WHERE owner=? AND request=?")
        .get(owner, request);
      if (!raw) return null;
      const stored = StoredReceipt.parse(JSON.parse(rowValue(raw)));
      if (stored.fingerprint !== fingerprint)
        throw new AssignmentConflict(
          "request-conflict",
          "Request key has a different payload.",
        );
      return {
        receipt: stored.receipt,
        workspace: this.workspace(db, stored.receipt.reservation),
      };
    } finally {
      db.close();
    }
  }
  async reserve(input: {
    owner: z.infer<typeof LegatusId>;
    task: z.infer<typeof TaskRef>;
    scope: string;
    shared: string;
    request: string;
    fingerprint: string;
    plan: z.infer<typeof WorkspacePlan>;
    owned: () => boolean;
  }) {
    const db = await this.open(true, input.owned, true);
    if (!db) throw new Error("Assignment storage unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      const existingBinding = db
        .prepare("SELECT shared FROM bindings WHERE owner=? AND task=?")
        .get(input.owner, input.task.id);
      if (
        existingBinding &&
        z.object({ shared: z.string() }).parse(existingBinding).shared !==
          input.shared
      )
        throw new AssignmentConflict(
          "binding-conflict",
          "Local task identity is already bound to another shared task.",
        );
      const alias = db
        .prepare("SELECT task FROM bindings WHERE owner=? AND shared=?")
        .get(input.owner, input.shared);
      if (
        alias &&
        z.object({ task: TaskId }).parse(alias).task !== input.task.id
      )
        throw new AssignmentConflict(
          "binding-conflict",
          "Ownership-binding conflict. Another local task is already bound to this identity.",
        );
      db.prepare("INSERT OR IGNORE INTO bindings VALUES(?,?,?)").run(
        input.owner,
        input.task.id,
        input.shared,
      );
      const raw = db
        .prepare("SELECT value FROM claims WHERE shared=?")
        .get(input.shared);
      let reservation: Reservation;
      if (raw) reservation = Reservation.parse(JSON.parse(rowValue(raw)));
      else {
        const identity = Identity.parse(
          JSON.parse(
            rowValue(
              db
                .prepare("SELECT value FROM repository WHERE singleton=1")
                .get(),
            ),
          ),
        );
        reservation = Reservation.parse({
          id: randomUUID(),
          repository: identity.repository,
          shared: input.shared,
          owner: input.owner,
          task: input.task.id,
          approval: { task: input.task, scope: input.scope },
          plan: input.plan,
        });
        db.prepare("INSERT INTO claims VALUES(?,?,?,?,?,?,?)").run(
          input.shared,
          reservation.id,
          input.owner,
          input.task.id,
          input.plan.branch,
          input.plan.path,
          JSON.stringify(reservation),
        );
      }
      if (
        reservation.owner === input.owner &&
        (reservation.plan.parent !== input.plan.parent ||
          reservation.approval.scope !== input.scope ||
          reservation.approval.task.revision !== input.task.revision)
      )
        throw new AssignmentConflict(
          "plan-conflict",
          "Reservation plan and approval pin cannot change. Preserve the existing reservation.",
        );
      const receipt = ReservationReceipt.parse({
        requestKey: input.request,
        reservation,
      });
      db.prepare("INSERT INTO receipts VALUES(?,?,?)").run(
        input.owner,
        input.request,
        JSON.stringify({ fingerprint: input.fingerprint, receipt }),
      );
      this.fault?.("before-reservation-commit");
      if (!input.owned())
        throw new Error("Reservation authority revoked before commit.");
      db.exec("COMMIT");
      this.fault?.("after-reservation-commit");
      return { receipt, workspace: this.workspace(db, reservation) };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      db.close();
    }
  }
  async dispatch(
    reservation: Reservation,
    step: z.infer<typeof Step>,
    owned: () => boolean,
  ): Promise<AssignmentOperation | null> {
    const db = await this.open(true, owned);
    if (!db) throw new Error("Assignment storage unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      const claim = db
        .prepare("SELECT value FROM claims WHERE id=?")
        .get(reservation.id);
      if (!claim || rowValue(claim) !== JSON.stringify(reservation))
        throw new Error("Reservation authority changed before dispatch.");
      const state = this.workspace(db, reservation, false);
      const allowed =
        step === "branch"
          ? state.kind === "planned" ||
            (state.kind === "held" &&
              state.code === "git-failed" &&
              state.operation?.step === "branch")
          : state.kind === "branch-owned" ||
            (state.kind === "held" &&
              state.code === "git-failed" &&
              state.operation?.step === "worktree");
      if (!allowed) {
        db.exec("ROLLBACK");
        return null;
      }
      const operation = Operation.parse({
        id: randomUUID(),
        reservation: reservation.id,
        step,
      });
      db.prepare("DELETE FROM holds WHERE reservation=?").run(reservation.id);
      db.prepare("INSERT INTO operations VALUES(?,?,?,?)").run(
        operation.id,
        reservation.id,
        step,
        JSON.stringify(operation),
      );
      if (!owned())
        throw new Error("Dispatch authority revoked before commit.");
      db.exec("COMMIT");
      this.fault?.("after-dispatch");
      return operation;
    } finally {
      try {
        db.exec("ROLLBACK");
      } catch {}
      db.close();
    }
  }
  async complete(
    operation: AssignmentOperation,
    outcome: z.infer<typeof Outcome>,
  ) {
    const db = await this.open(true);
    if (!db) throw new Error("Assignment storage unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      const raw = db
        .prepare("SELECT value FROM operations WHERE id=?")
        .get(operation.id);
      if (!raw || rowValue(raw) !== JSON.stringify(operation))
        throw new Error("Operation identity mismatch.");
      const existing = db
        .prepare("SELECT value FROM outcomes WHERE operation=?")
        .get(operation.id);
      if (existing && rowValue(existing) !== JSON.stringify(outcome))
        throw new Error("Operation already has different terminal evidence.");
      db.prepare("INSERT OR IGNORE INTO outcomes VALUES(?,?)").run(
        operation.id,
        JSON.stringify(outcome),
      );
      this.fault?.("before-outcome-commit");
      db.exec("COMMIT");
      this.fault?.("after-outcome-commit");
    } finally {
      try {
        db.exec("ROLLBACK");
      } catch {}
      db.close();
    }
  }
}
