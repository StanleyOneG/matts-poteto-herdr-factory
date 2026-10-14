import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
import { join, dirname, basename, relative, isAbsolute, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { LegatusId, TaskId, TaskRef, SettledHandoff, SuccessorLaunch } from "./snapshot.js";
import { WorkspacePlan, type RepositoryLocation } from "./git-workspace.js";

const ReservationId = z.uuid().brand<"ReservationId">();
export const OperationId = z.uuid().brand<"OperationId">();
export const ApprovalPin = z.object({ task: TaskRef, scope: z.string() });
export const Reservation = z.object({
  id: ReservationId,
  repository: z.uuid().brand<"RepositoryId">(),
  // Historical field name for a task-source key; uniqueness is run-local.
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
    version: z.literal(2),
    owner: LegatusId,
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
  root: string | undefined,
  location: RepositoryLocation,
): string {
  if (root === undefined) {
    const primary = location.worktrees[0];
    if (!primary) throw new Error("Primary project directory is unavailable. No workspace path allocated.");
    const project = realpathSync(primary);
    root = join(dirname(project), `worktrees-${basename(project)}_legion`);
  }
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
/** The run ID, not the Git common directory or issue URL, owns this namespace. */
export class AssignmentLedger {
  readonly path: string;
  private root: string;
  readonly commonDir: string;
  readonly owner: z.infer<typeof LegatusId>;
  private fault: ((point: AssignmentFaultPoint) => void) | undefined;
  private expectedRepository: string | null;
  private historyRequired: boolean;
  constructor({
    commonDir,
    owner,
    fault,
    expectedRepository = null,
    historyRequired = false,
  }: {
    commonDir: string;
    owner: z.infer<typeof LegatusId>;
    fault?: ((point: AssignmentFaultPoint) => void) | undefined;
    expectedRepository?: string | null;
    historyRequired?: boolean;
  }) {
    this.commonDir = commonDir;
    this.owner = owner;
    this.fault = fault;
    this.expectedRepository = expectedRepository;
    this.historyRequired = historyRequired;
    this.root = join(commonDir, "legion", "runs", LegatusId.parse(owner));
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
      if (this.expectedRepository || this.historyRequired) {
        const legacy = join(this.commonDir, "legion");
        if (
          ["assignments.sqlite", "assignments.initialized", "assignments.pending"].some(
            (name) => existsSync(join(legacy, name)),
          )
        )
          throw new Error(
            "Legacy shared assignment history is unsupported for run ownership. Preserve its records and pinned resources; an Emperor decision is required. No migration or adoption performed.",
          );
        throw new Error(
          "Known assignment history is missing. History cannot be reset.",
        );
      }
      if (existsSync(this.path) || existsSync(pending))
        throw new Error(
          "Assignment initialization is unavailable. History cannot be reset.",
        );
      return null;
    }
    const identity = Identity.parse(JSON.parse(readFileSync(path, "utf8")));
    if (
      identity.commonDir !== this.commonDir ||
      identity.owner !== this.owner ||
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
      sync(dirname(this.root));
      sync(dirname(dirname(this.root)));
      sync(this.commonDir);
      const value = Identity.parse({
        version: 2,
        owner: this.owner,
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
  private launchSchema(db: DatabaseSync, known = false): "legacy" | "current" | "successors" {
    const tables = z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
    const marker = tables.some((t) => t.name === "legion_schema");
    const launches = tables.some((t) => t.name === "tribuni");
    const successors = tables.some(t => t.name === "tribuni_successors");
    if (!marker && !launches) {
      if (successors) throw new Error("Successor history has lost its original launch schema. Preserve assignment history.");
      if (known) throw new Error("Known launch history is missing. History cannot be reset.");
      return "legacy";
    }
    if (!marker || !launches) throw new Error("Launch schema history is incomplete. Preserve assignment history.");
    const version = z.object({ version: z.union([z.literal(2), z.literal(3)]) }).parse(db.prepare("SELECT version FROM legion_schema WHERE singleton=1").get());
    if (successors !== (version.version === 3)) throw new Error("Successor schema history is incomplete. Preserve assignment history.");
    return version.version === 3 ? "successors" : "current";
  }
  private retainedLaunch({ row, reservation, known }: { row: unknown; reservation: Reservation; known: string | null }): LaunchRecord {
    const stored = LaunchRecord.pick({ id: true, reservation: true, revision: true }).extend({ value: z.string() }).parse(row);
    const launch = LaunchRecord.parse(JSON.parse(stored.value));
    if (launch.id !== stored.id || launch.revision !== stored.revision)
      throw new Error("Launch row identity changed. Preserve assignment history.");
    if (known && launch.id !== known) throw new Error("Known launch identity changed.");
    if (launch.reservation !== stored.reservation || launch.reservation !== reservation.id || launch.scope !== reservation.approval.scope)
      throw new Error("Launch reservation history changed. Preserve assignment history and pinned resources.");
    return launch;
  }
  async launchState(reservation: Reservation, known: string | null = null): Promise<LaunchView> {
    const launch = await this.readLaunch({ reservation, known });
    return launch ? { ...projectLaunch(launch.state), startEvidence: launch.startEvidence } : { kind: "not-launched" };
  }
  /** Read exact retained history without creating or migrating a launch. */
  async readLaunch({ reservation, known = null }: { reservation: Reservation; known?: string | null }): Promise<LaunchRecord | null> {
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(false);
    if (!db) throw new Error("Known assignment history unavailable.");
    try {
      this.confirmReservation({ db, reservation });
      const schema = this.launchSchema(db, known !== null);
      if (schema === "legacy") return null;
      if (known && schema === "successors") {
        const successor = db.prepare("SELECT * FROM tribuni_successors WHERE reservation=? AND id=?").get(reservation.id, known);
        if (successor) return this.retainedSuccessor({ db, row: successor, reservation, known });
      }
      const row = db.prepare("SELECT reservation,id,revision,value FROM tribuni WHERE reservation=?").get(reservation.id);
      if (known && !row) throw new Error("Known launch row is missing. History cannot be reset.");
      return row ? this.retainedLaunch({ row, reservation, known }) : null;
    } finally { db.close(); }
  }
  private successorMetadata(handoff: SettledHandoff): z.infer<typeof SuccessorLaunch> {
    return SuccessorLaunch.parse({ handoff: handoff.id, predecessor: handoff.pin.launch, assignment: handoff.pin.assignment,
      artifact: handoff.state.receipt.artifact, modelPin: handoff.modelPin, workflowChoice: handoff.workflowChoice, continuation: handoff.continuation });
  }
  private confirmHandoffPredecessor({ reservation, predecessor, handoff }: { reservation: Reservation; predecessor: LaunchRecord; handoff: SettledHandoff }) {
    const progress = predecessor.state;
    if (progress.kind !== "reported" || predecessor.startEvidence.kind !== "completed")
      throw new Error("A reported predecessor with confirmed startup is required; unknown or held history blocks handoff.");
    const pin = handoff.pin;
    if (pin.owner !== reservation.owner || pin.reservation !== reservation.id || pin.scope !== reservation.approval.scope || pin.task.id !== reservation.task ||
      !isDeepStrictEqual(pin.task, progress.assignment.task) || pin.launch !== predecessor.id || pin.assignment !== progress.command ||
      progress.worker.address.launch !== predecessor.id || pin.workerSession !== progress.worker.address.session || pin.workerGeneration !== progress.worker.address.generation ||
      pin.addressDigest !== createHash("sha256").update(JSON.stringify(progress.worker.address)).digest("hex") ||
      !isDeepStrictEqual(handoff.modelPin, progress.assignment.modelPin) || !isDeepStrictEqual(handoff.workflowChoice, progress.assignment.workflowChoice))
      throw new Error("Handoff must retain the exact predecessor assignment, address, selected model/thinking and workflow profile.");
  }
  private retainedSuccessor({ db, row, reservation, known = null }: { db: DatabaseSync; row: unknown; reservation: Reservation; known?: string | null }): LaunchRecord {
    const stored = z.object({ predecessor: z.uuid(), handoff: z.uuid(), receipt: z.string() }).parse(row);
    const receipt = SettledHandoff.parse(JSON.parse(stored.receipt));
    const launch = this.retainedLaunch({ row, reservation, known });
    if (stored.predecessor !== receipt.pin.launch || stored.handoff !== receipt.id || receipt.pin.reservation !== reservation.id || receipt.pin.owner !== reservation.owner ||
      !isDeepStrictEqual(launch.successor, this.successorMetadata(receipt)))
      throw new Error("Successor receipt or predecessor identity changed. Preserve launch history.");
    const parents = db.prepare(`SELECT reservation,id,revision,value FROM tribuni WHERE id=?
      UNION ALL SELECT reservation,id,revision,value FROM tribuni_successors WHERE id=?`).all(stored.predecessor, stored.predecessor);
    if (parents.length !== 1) throw new Error("Exact predecessor history is missing or ambiguous. Preserve successor history.");
    const predecessor = this.retainedLaunch({ row: parents[0], reservation, known: stored.predecessor });
    this.confirmHandoffPredecessor({ reservation, predecessor, handoff: receipt });
    return launch;
  }
  /** Reconcile the one attempt without migration, admission or allocation. */
  async readSuccessor({ reservation, predecessor, handoff }: { reservation: Reservation; predecessor: string; handoff: string }): Promise<LaunchRecord | null> {
    const db = await this.open(false);
    if (!db) throw new Error("Known assignment history unavailable.");
    try {
      this.confirmReservation({ db, reservation });
      if (this.launchSchema(db, true) !== "successors") return null;
      const row = db.prepare("SELECT * FROM tribuni_successors WHERE predecessor=?").get(predecessor);
      if (!row) return null;
      const launch = this.retainedSuccessor({ db, row, reservation });
      if (launch.successor?.handoff !== handoff) throw new Error("Predecessor already has a different successor reservation. No retry.");
      return launch;
    } finally { db.close(); }
  }
  /** Allocates an attempt, never launches it. A committed attempt is never replaced, even after failure. */
  async beginSuccessor({ reservation, predecessor, handoff: input, owned }: {
    reservation: Reservation; predecessor: LaunchRecord; handoff: SettledHandoff; owned: () => boolean;
  }): Promise<LaunchRecord> {
    const handoff = SettledHandoff.parse(input);
    const db = await this.open(true, owned);
    if (!db) throw new Error("Known assignment history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      this.confirmReservation({ db, reservation });
      const schema = this.launchSchema(db, true);
      if (schema === "legacy") throw new Error("Known predecessor launch history is missing.");
      if (schema === "current") {
        // Add history; never rebuild tribuni or rewrite its original value/address/receipts.
        db.exec(`CREATE TABLE tribuni_successors (
          reservation TEXT NOT NULL, id TEXT PRIMARY KEY, predecessor TEXT UNIQUE NOT NULL,
          handoff TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, receipt TEXT NOT NULL);
          CREATE INDEX tribuni_successors_reservation ON tribuni_successors(reservation);
          UPDATE legion_schema SET version=3 WHERE singleton=1;`);
        this.fault?.("before-launch-migration-commit");
      }
      const existing = db.prepare("SELECT * FROM tribuni_successors WHERE predecessor=?").get(predecessor.id);
      if (existing) {
        const launch = this.retainedSuccessor({ db, row: existing, reservation });
        const receipt = z.object({ receipt: z.string() }).parse(existing).receipt;
        if (!isDeepStrictEqual(SettledHandoff.parse(JSON.parse(receipt)), handoff))
          throw new Error("Predecessor already has an immutable successor receipt. Reconcile that attempt; no retry.");
        db.exec("ROLLBACK");
        return launch;
      }
      const table = predecessor.successor ? "tribuni_successors" : "tribuni";
      const row = db.prepare(`SELECT * FROM ${table} WHERE reservation=? AND id=?`).get(reservation.id, predecessor.id);
      const retained = row ? predecessor.successor
        ? this.retainedSuccessor({ db, row, reservation, known: predecessor.id })
        : this.retainedLaunch({ row, reservation, known: predecessor.id }) : null;
      if (!retained || !isDeepStrictEqual(retained, predecessor)) throw new Error("Exact predecessor history required before successor reservation.");
      this.confirmHandoffPredecessor({ reservation, predecessor: retained, handoff });
      if (this.workspace(db, reservation).kind !== "ready" || contains(reservation.plan.path, handoff.state.receipt.artifact.path))
        throw new Error("Successor requires its unchanged ready worktree and a temporary artifact outside that worktree.");
      const successor = this.successorMetadata(handoff);
      const launch = LaunchRecord.parse({ id: randomUUID(), reservation: reservation.id, revision: 0, scope: reservation.approval.scope,
        successor, state: { kind: "prepared" } });
      db.prepare("INSERT INTO tribuni_successors VALUES(?,?,?,?,?,?,?)").run(reservation.id, launch.id, predecessor.id, handoff.id, launch.revision, JSON.stringify(launch), JSON.stringify(handoff));
      if (!owned()) throw new Error("Successor reservation authority revoked.");
      db.exec("COMMIT");
      if (schema === "current") this.fault?.("after-launch-migration-commit");
      this.fault?.("after-launch-commit");
      return launch;
    } finally { try { db.exec("ROLLBACK"); } catch {} db.close(); }
  }
  async beginLaunch(reservation: Reservation, owned: () => boolean, known: string | null = null): Promise<LaunchRecord> {
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
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
      const row = db.prepare("SELECT reservation,id,revision,value FROM tribuni WHERE reservation=?").get(reservation.id);
      if (row) {
        this.confirmReservation({ db, reservation });
        const launch = this.retainedLaunch({ row, reservation, known });
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
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(true, owned);
    if (!db) throw new Error("Launch history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      const schema = this.launchSchema(db, true);
      if (schema === "legacy") throw new Error("Known launch history missing.");
      this.confirmReservation({ db, reservation });
      if (schema === "successors" && db.prepare("SELECT id FROM tribuni_successors WHERE predecessor=?").get(prior.id))
        throw new Error("Retired predecessor launch is immutable after successor reservation.");
      if (prior.successor && schema !== "successors") throw new Error("Known successor history is missing.");
      const table = prior.successor ? "tribuni_successors" : "tribuni";
      const retained = db.prepare(`SELECT * FROM ${table} WHERE reservation=? AND id=? AND revision=?`).get(reservation.id, prior.id, prior.revision);
      const current = retained ? prior.successor ? this.retainedSuccessor({ db, row: retained, reservation, known: prior.id }) : this.retainedLaunch({ row: retained, reservation, known: prior.id }) : null;
      if (!retained || !isDeepStrictEqual(current, prior)) throw new Error("Launch history changed before publication.");
      const next = LaunchRecord.parse({ ...prior, revision: prior.revision + 1, state, startEvidence });
      if (next.successor) {
        const progress = next.state.kind === "held" ? next.state.last : next.state;
        if ("assignment" in progress && (!isDeepStrictEqual(progress.assignment.modelPin, next.successor.modelPin) ||
          !isDeepStrictEqual(progress.assignment.workflowChoice, next.successor.workflowChoice) ||
          !("handoff" in progress.assignment) || !isDeepStrictEqual(progress.assignment.handoff, next.successor)))
          throw new Error("Successor assignment must retain its exact predecessor pins and read-first handoff.");
      }
      const changed = db.prepare(`UPDATE ${table} SET revision=?,value=? WHERE reservation=? AND id=? AND revision=? AND value=?`).run(next.revision, JSON.stringify(next), reservation.id, prior.id, prior.revision, rowValue(retained));
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
    ) {
      const db = await this.open(false);
      db?.close();
    } else {
      const db = await this.open(true, owned, true);
      db?.close();
    }
    await this.observations(this.owner);
  }
  async observations(
    owner: z.infer<typeof LegatusId>,
  ): Promise<{ claims: ClaimView[]; byTask: Map<string, ClaimView> }> {
    if (owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(false);
    if (!db) return { claims: [], byTask: new Map() };
    try {
      const reservations = db
        .prepare("SELECT value FROM claims")
        .all()
        .map((row) => Reservation.parse(JSON.parse(rowValue(row))));
      const byTask = new Map<string, ClaimView>();
      const claims = reservations.map((reservation) => {
        if (reservation.owner !== this.owner)
          throw new Error("Reservation belongs to another run. Preserve assignment history.");
        return {
          kind: "owned",
          reservation,
          workspace: this.workspace(db, reservation),
        } satisfies ClaimView;
      });
      const bindings = z
        .array(z.object({ task: TaskId, shared: z.string() }))
        .parse(
          db
            .prepare("SELECT task,shared FROM bindings WHERE owner=?")
            .all(owner),
        );
      for (const binding of bindings) {
        const found = claims.find(
          (claim) =>
            claim.reservation.shared === binding.shared &&
            claim.reservation.task === binding.task,
        );
        if (!found) throw new Error("Known reservation ownership evidence is missing. Preserve assignment history and pinned resources.");
        byTask.set(binding.task, found);
      }
      if (
        claims.some((claim) => !bindings.some((binding) =>
          binding.task === claim.reservation.task && binding.shared === claim.reservation.shared,
        ))
      )
        throw new Error("Known task binding is missing. Preserve assignment history and pinned resources.");
      for (const row of db.prepare("SELECT value FROM receipts").all()) {
        const stored = StoredReceipt.parse(JSON.parse(rowValue(row)));
        this.confirmReservation({ db, reservation: stored.receipt.reservation });
      }
      return { claims, byTask };
    } finally {
      db.close();
    }
  }
  private confirmReservation({ db, reservation }: { db: DatabaseSync; reservation: Reservation }) {
    const claim = db.prepare("SELECT value FROM claims WHERE id=?").get(reservation.id);
    if (reservation.owner !== this.owner || !claim || rowValue(claim) !== JSON.stringify(reservation))
      throw new Error("Known reservation ownership evidence is missing or changed. Preserve assignment history and pinned resources.");
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
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(false);
    if (!db) throw new Error("Assignment history unavailable.");
    try {
      this.confirmReservation({ db, reservation });
      return this.workspace(db, reservation, false);
    } finally {
      db.close();
    }
  }
  async hold(reservation: Reservation, state: WorkspaceState | null) {
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(true);
    if (!db) throw new Error("Assignment history unavailable.");
    try {
      db.exec("BEGIN IMMEDIATE");
      this.confirmReservation({ db, reservation });
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
    if (owner !== this.owner) throw new Error("Assignment run identity changed.");
    const db = await this.open(false);
    if (!db) return null;
    try {
      const raw = db
        .prepare("SELECT value FROM receipts WHERE owner=? AND request=?")
        .get(owner, request);
      if (!raw) return null;
      const stored = StoredReceipt.parse(JSON.parse(rowValue(raw)));
      this.confirmReservation({ db, reservation: stored.receipt.reservation });
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
    if (input.owner !== this.owner) throw new Error("Assignment run identity changed.");
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
          "Local task identity is already bound to another task source.",
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
      if (raw) {
        reservation = Reservation.parse(JSON.parse(rowValue(raw)));
        if (!existingBinding || reservation.owner !== input.owner || reservation.task !== input.task.id)
          throw new Error("Known task binding is missing or changed. Preserve assignment history and pinned resources.");
      } else {
        if (existingBinding)
          throw new Error("Known reservation ownership evidence is missing. Preserve assignment history and pinned resources.");
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
    if (reservation.owner !== this.owner) throw new Error("Assignment run identity changed.");
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
