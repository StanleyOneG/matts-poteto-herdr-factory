import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  SnapshotStore,
  createSnapshot,
  type StorageFaultPoint,
  SnapshotSchema,
  LegatusId,
  SubmissionId,
  InputEvidence,
  TaskId,
  SubmissionRef,
  TaskRef,
  DecisionId,
  Ref,
  DecisionEffectSchema,
  AmendmentId,
  type LegatusSnapshot,
  type CommittedResult,
} from "./snapshot.js";

export type Diagnostic = {
  name: string;
  status: "ready" | "missing" | "incompatible" | "unverified";
  message: string;
};
const Command = z.object({
  text: z.string(),
  requestKey: z.string().min(1),
  evidence: InputEvidence,
});
const Question = z.object({
  question: z.string().min(1),
  recommendation: z.string().min(1),
});
export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new-task"),
    source: SubmissionRef,
    goal: z.string().min(1),
    acceptance: z.array(z.string()),
    questions: z.array(Question),
  }),
  z.discriminatedUnion("purpose", [
    z.object({
      kind: z.literal("clarify"),
      source: SubmissionRef,
      purpose: z.literal("routing"),
      affected: z.array(TaskRef),
      question: z.string().min(1),
      recommendation: z.string().min(1),
    }),
    z.object({
      kind: z.literal("clarify"),
      source: SubmissionRef,
      purpose: z.literal("product"),
      affected: z.tuple([TaskRef], TaskRef),
      question: z.string().min(1),
      recommendation: z.string().min(1),
    }),
  ]),
  z.object({
    kind: z.literal("propose-amendment"),
    source: SubmissionRef,
    affected: z.array(TaskRef).min(1),
    category: z.enum(["requirements", "financial", "access", "irreversible"]),
    change: z.string().min(1),
    question: z.string().min(1),
    recommendation: z.string().min(1),
  }),
  z.object({
    kind: z.literal("technical-choice"),
    source: SubmissionRef,
    target: TaskRef,
    choice: z.string().min(1),
  }),
  z.object({ kind: z.literal("conversation"), source: SubmissionRef }),
  z.object({
    kind: z.literal("answer"),
    source: SubmissionRef,
    decision: Ref,
    effect: DecisionEffectSchema,
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;
const Interpretation = z.object({
  kind: z.literal("interpretation"),
  requestKey: z.string().min(1),
  proposal: ProposalSchema,
  evidence: z.object({
    session: z.string(),
    generation: z.int().positive(),
    legatus: LegatusId,
    run: z.string().min(1),
    sources: z.array(SubmissionRef),
  }),
});
const Message = z.object({
  kind: z.literal("message"),
  text: z.string().min(1),
  requestKey: z.string().min(1),
  evidence: InputEvidence,
});
export type LegionView = {
  mode: "inactive" | "active";
  snapshot: LegatusSnapshot | null;
  tasks: Array<
    LegatusSnapshot["tasks"][number] & {
      eligibility: "admitted" | "inactive" | "blocked";
    }
  >;
  diagnostics: Diagnostic[];
  unavailable: string | null;
};
export type OperationResult =
  | CommittedResult
  | { kind: "observed"; view: LegionView }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "uncertain"; requestKey: string; message: string };
type CommandIntent =
  | { kind: "status"; id: string }
  | { kind: "doctor" | "on" | "off" }
  | { kind: "resume"; id: string }
  | { kind: "task"; text: string }
  | { kind: "invalid" };
export type CommandResult = OperationResult & {
  disposition: "observe" | "off" | "activate" | "resume" | "submit" | "none";
};
function commandIntent(text: string): CommandIntent {
  const match = /^\s*(\S+)(?:\s([\s\S]*))?$/.exec(text);
  if (!match) return { kind: "on" };
  const token = match[1];
  const payload = match[2] ?? "";
  switch (token) {
    case "status":
      return { kind: "status", id: payload.trim() };
    case "doctor":
    case "on":
    case "off":
      return payload.trim() ? { kind: "invalid" } : { kind: token };
    case "resume":
      return /^\S+$/.test(payload.trim())
        ? { kind: "resume", id: payload.trim() }
        : { kind: "invalid" };
    case "task":
      return payload.trim() ? { kind: "task", text: payload } : { kind: "invalid" };
    default:
      return { kind: "task", text };
  }
}
export type LegionOptions = {
  storagePath: string;
  context: string;
  session: string;
  preflight: () => Promise<Diagnostic[]>;
  storageFault?: (point: StorageFaultPoint) => void;
};
const reject = (code: string, message: string): OperationResult => ({
  kind: "rejected",
  code,
  message,
});
export class Legion {
  private store: SnapshotStore;
  private selected: string | null = null;
  private binding: { generation: number; lock: DatabaseSync } | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private uncertain: { id: string; requestKey: string } | null = null;
  constructor(private options: LegionOptions) {
    this.store = new SnapshotStore(options.storagePath, options.storageFault);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private revoke() {
    this.epoch++;
    const previous = this.binding;
    this.binding = null;
    if (previous) {
      previous.lock.exec("ROLLBACK");
      previous.lock.close();
    }
  }
  async state(): Promise<LegionView> {
    try {
      const snapshot = this.selected
        ? await this.store.read(this.selected)
        : await this.store.find(this.options.session, this.options.context);
      if (snapshot && this.uncertain?.id === snapshot.id) this.uncertain = null;
      return {
        mode: this.binding ? "active" : "inactive",
        snapshot,
        tasks:
          snapshot?.tasks.map((t) => ({
            ...t,
            eligibility: !this.binding
              ? "inactive"
              : snapshot.decisions.some(
                    (d) =>
                      d.state.kind === "open" &&
                      d.history.at(-1)?.affected.some((a) => a.id === t.id),
                  )
                ? "blocked"
                : "admitted",
          })) ?? [],
        diagnostics: [],
        unavailable: null,
      };
    } catch (error) {
      return {
        mode: "inactive",
        snapshot: null,
        tasks: [],
        diagnostics: [],
        unavailable: String(error),
      };
    }
  }
  command(raw: unknown): Promise<CommandResult> {
    const parsed = Command.safeParse(raw);
    if (!parsed.success)
      return Promise.resolve({ ...reject("invalid", "Invalid command."), disposition: "none" });
    const intent = commandIntent(parsed.data.text);
    const dispositions = {
      status: "observe", doctor: "observe", on: "activate", off: "off",
      resume: "resume", task: "submit", invalid: "none",
    } satisfies Record<CommandIntent["kind"], CommandResult["disposition"]>;
    const disposition = dispositions[intent.kind];
    return this.applyCommand(parsed.data, intent).then(result => ({
      ...result, disposition: result.kind === "rejected" ? "none" : disposition,
    }));
  }
  private applyCommand(
    input: z.infer<typeof Command>,
    intent: CommandIntent,
  ): Promise<OperationResult> {
    if (intent.kind === "invalid")
      return Promise.resolve(reject("usage", "Use on, task <text>, status [id], doctor, off, or resume <id>. Use task to escape reserved arguments."));
    if (
      (input.evidence.origin !== "emperor" &&
        input.evidence.origin !== "host-command") ||
      input.evidence.session !== this.options.session
    )
      return Promise.resolve(
        reject(
          "provenance",
          "A trusted host command is required. Host command source may be unavailable.",
        ),
      );
    if (intent.kind === "off") {
      this.revoke();
      return Promise.resolve({
        kind: "observed",
        view: {
          mode: "inactive",
          snapshot: null,
          tasks: [],
          diagnostics: [],
          unavailable: null,
        },
      });
    }
    const epoch = this.epoch;
    return this.serialize(async () => {
      if (intent.kind === "status") {
        const id = intent.id;
        if (!id) return { kind: "observed", view: await this.state() };
        if (!LegatusId.safeParse(id).success)
          return reject("invalid-id", "Invalid Legatus ID.");
        const snapshot = await this.store.read(id);
        if (snapshot && this.uncertain?.id === snapshot.id)
          this.uncertain = null;
        return {
          kind: "observed",
          view: {
            mode: "inactive",
            snapshot,
            tasks:
              snapshot?.tasks.map((t) => ({ ...t, eligibility: "inactive" })) ??
              [],
            diagnostics: [],
            unavailable: snapshot ? null : "Legatus records were not found.",
          },
        };
      }
      if (intent.kind === "doctor")
        return {
          kind: "observed",
          view: {
            ...(await this.state()),
            diagnostics: await this.options.preflight(),
          },
        };
      if (
        this.uncertain &&
        this.uncertain.requestKey !== input.requestKey &&
        !(intent.kind === "resume" && intent.id === this.uncertain.id)
      )
        return reject(
          "reconcile",
          `Reconcile request ${this.uncertain.requestKey} before another mutation.`,
        );
      const diagnostics = await this.options.preflight();
      if (epoch !== this.epoch)
        return reject("revoked", "Activation was revoked.");
      const resume = intent.kind === "resume" ? intent.id : null;
      const isActivation = intent.kind === "on" || intent.kind === "resume";
      const taskText = intent.kind === "task" ? intent.text : "";
      const ready = diagnostics.every((d) => d.status === "ready");
      if (!ready && isActivation) {
        this.revoke();
        return {
          kind: "observed",
          view: { ...(await this.state()), diagnostics },
        };
      }
      if (resume && this.binding && resume !== this.selected)
        return reject(
          "ownership",
          "Turn intake off before resuming a different Legatus.",
        );
      let recoveryLock: DatabaseSync | null = null;
      let state: LegatusSnapshot | null;
      if (resume) {
        const id = resume;
        if (!LegatusId.safeParse(id).success)
          return reject("invalid-id", "Invalid Legatus ID.");
        if (!this.store.exists(id))
          return reject("not-found", "Legatus records were not found.");
        try {
          if (!this.binding) recoveryLock = await this.store.acquire(id);
          state = await this.store.recover(id, this.options.context, () => epoch === this.epoch);
          if (state && this.uncertain?.id === state.id) this.uncertain = null;
        } catch (error) {
          if (recoveryLock) {
            recoveryLock.exec("ROLLBACK");
            recoveryLock.close();
          }
          return reject(
            "ownership",
            `Exclusive intake recovery is unavailable. ${String(error)}`,
          );
        }
      } else {
        try {
          state = this.selected
            ? await this.store.read(this.selected)
            : await this.store.find(this.options.session, this.options.context);
        } catch (error) {
          return reject("unavailable", `Intake records are unavailable. ${String(error)}`);
        }
      }
      if (resume && !state)
        return reject("not-found", "Legatus records were not found.");
      if (state && state.context !== this.options.context) {
        if (recoveryLock) {
          recoveryLock.exec("ROLLBACK");
          recoveryLock.close();
        }
        return reject(
          "context",
          "Legatus belongs to a different working context.",
        );
      }
      const expectedRevision = state?.revision ?? null;
      const snapshot =
        state ??
        createSnapshot({ id: randomUUID(), context: this.options.context });
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const existing = snapshot.receipts.find(
        (r) => r.result.receipt.requestKey === input.requestKey,
      );
      if (existing) {
        if (recoveryLock) {
          recoveryLock.exec("ROLLBACK");
          recoveryLock.close();
        }
        if (existing.fingerprint !== fingerprint)
          return reject(
            "request-conflict",
            "Request key has a different payload.",
          );
        this.uncertain = null;
        return existing.result;
      }
      if (!this.binding) {
        try {
          const lock = recoveryLock ?? (await this.store.acquire(snapshot.id));
          if (epoch !== this.epoch) {
            lock.exec("ROLLBACK");
            lock.close();
            return reject("revoked", "Activation was revoked.");
          }
          this.binding = { generation: snapshot.generation + 1, lock };
        } catch (error) {
          return reject(
            "ownership",
            `Exclusive ownership is unavailable. ${String(error)}`,
          );
        }
        snapshot.generation = this.binding.generation;
        snapshot.attachments.push({
          session: this.options.session,
          generation: snapshot.generation,
        });
      }
      this.selected = snapshot.id;
      if (!isActivation)
        snapshot.submissions.push({
          id: SubmissionId.parse(randomUUID()),
          revision: 1,
          text: taskText,
          sequence: snapshot.submissions.length + 1,
          timestamp: new Date().toISOString(),
          evidence: input.evidence,
          originIntent: { kind: "new-task" },
          state: { kind: "pending", routing: { kind: "new-task" } },
        });
      const result: CommittedResult = {
        kind: isActivation ? "applied" : "saved",
        receipt: {
          legatus: snapshot.id,
          requestKey: input.requestKey,
          sequence: snapshot.receipts.length + 1,
          message: ready
            ? isActivation
              ? "Legion is active. Intake only."
              : "Saved for interpretation. Intake only."
            : "Saved, not admitted. Run /legion doctor.",
        },
      };
      if (!isActivation)
        result.receipt.message +=
          " Command text only. Attachments were not captured.";
      snapshot.receipts.push({ fingerprint, result });
      snapshot.revision++;
      try {
        await this.store.save(
          snapshot,
          expectedRevision,
          () => this.epoch === epoch && !!this.binding,
        );
      } catch (error) {
        this.uncertain = { id: snapshot.id, requestKey: input.requestKey };
        this.revoke();
        return {
          kind: "uncertain",
          requestKey: input.requestKey,
          message: `Commit could not be established. Reconcile status ${snapshot.id} and retry the same request key. ${String(error)}`,
        };
      }
      if (!ready) this.revoke();
      return result;
    });
  }
  submit(raw: unknown): Promise<OperationResult> {
    const input = z.union([Message, Interpretation]).safeParse(raw);
    if (!input.success)
      return Promise.resolve(reject("invalid", "Invalid submission."));
    const epoch = this.epoch;
    return this.serialize(async () => {
      const message = input.data;
      if (this.uncertain) {
        if (message.requestKey !== this.uncertain.requestKey)
          return reject(
            "reconcile",
            `Reconcile request ${this.uncertain.requestKey} first.`,
          );
        const recovered = await this.store.read(this.uncertain.id);
        const receipt = recovered?.receipts.find(
          (r) => r.result.receipt.requestKey === message.requestKey,
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(message))
          .digest("hex");
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            return reject(
              "request-conflict",
              "Request key has a different payload.",
            );
          this.uncertain = null;
          return receipt.result;
        }
        this.uncertain = null;
        return reject(
          "not-committed",
          "No committed receipt exists. Explicitly resume intake, then retry the same request.",
        );
      }
      const prior = this.selected
        ? await this.store.read(this.selected)
        : await this.store.find(this.options.session, this.options.context);
      const previousReceipt = prior?.receipts.find(
        (r) => r.result.receipt.requestKey === message.requestKey,
      );
      if (previousReceipt) {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(message))
          .digest("hex");
        return previousReceipt.fingerprint === fingerprint
          ? previousReceipt.result
          : reject("request-conflict", "Request key has a different payload.");
      }
      const binding = this.binding;
      const selected = this.selected;
      if (!binding || !selected || epoch !== this.epoch)
        return reject("inactive", "Legion is inactive.");
      if (
        (message.kind === "message" && message.evidence.origin !== "emperor") ||
        message.evidence.session !== this.options.session ||
        message.evidence.generation !== binding.generation ||
        (message.kind === "interpretation" &&
          message.evidence.legatus !== selected)
      )
        return reject("provenance", "Current Emperor input is required.");
      const state = await this.store.read(selected);
      if (!state) return reject("unavailable", "Records are unavailable.");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(message))
        .digest("hex");
      const existing = state.receipts.find(
        (r) => r.result.receipt.requestKey === message.requestKey,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          return reject(
            "request-conflict",
            "Request key has a different payload.",
          );
        this.uncertain = null;
        return existing.result;
      }
      if (message.kind === "message") {
        state.submissions.push({
          id: SubmissionId.parse(randomUUID()),
          revision: 1,
          text: message.text,
          sequence: state.submissions.length + 1,
          timestamp: new Date().toISOString(),
          evidence: message.evidence,
          originIntent: { kind: "unclassified" },
          state: { kind: "pending", routing: { kind: "unclassified" } },
        });
      } else {
        const proposal = message.proposal;
        const source = state.submissions.find(
          (s) =>
            s.id === proposal.source.id &&
            s.revision === proposal.source.revision &&
            s.state.kind === "pending",
        );
        if (
          !source ||
          !message.evidence.sources.some(
            (s) => s.id === source.id && s.revision === source.revision,
          ) ||
          source.state.kind !== "pending"
        )
          return reject(
            "stale-source",
            "Source is not pending in this interpretation run.",
          );
        const routing = source.state.routing;
        if (routing.kind === "new-task" && proposal.kind !== "new-task")
          return reject(
            "routing",
            "Explicit new-task intent cannot change another assignment. Attach questions to the new task.",
          );
        if (routing.kind === "correction") {
          const targets =
            proposal.kind === "technical-choice"
              ? [proposal.target]
              : proposal.kind === "propose-amendment" ||
                  (proposal.kind === "clarify" &&
                    proposal.purpose === "product")
                ? proposal.affected
                : [];
          if (
            !targets.length ||
            targets.some(
              (t) =>
                t.id !== routing.target.id ||
                t.revision !== routing.target.revision,
            )
          )
            return reject(
              "routing",
              "Saved correction routing cannot be changed by interpretation.",
            );
        }
        switch (proposal.kind) {
          case "new-task": {
            if (
              source.state.kind !== "pending" ||
              source.state.routing.kind === "correction"
            )
              return reject(
                "routing",
                "A correction cannot become a new task.",
              );
            const id = TaskId.parse(randomUUID());
            state.tasks.push({
              id,
              technicalChoices: [],
              history: [
                {
                  revision: 1,
                  goal: proposal.goal,
                  acceptance: proposal.acceptance,
                  source: proposal.source,
                },
              ],
              scope: {
                original: source.id,
                context: state.context,
                policy: "intake-only-v1",
                amendments: [],
              },
            });
            for (const question of proposal.questions)
              state.decisions.push({
                id: DecisionId.parse(randomUUID()),
                history: [
                  {
                    revision: 1,
                    kind: "product",
                    ...question,
                    affected: [{ id, revision: 1 }],
                    original: proposal.source,
                    amendment: null,
                  },
                ],
                state: { kind: "open" },
              });
            source.state = { kind: "applied", resolution: id };
            break;
          }
          case "clarify": {
            if (
              !proposal.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject("stale-task", "Affected task revision changed.");
            const id = DecisionId.parse(randomUUID());
            state.decisions.push({
              id,
              history: [
                {
                  revision: 1,
                  kind: proposal.purpose,
                  question: proposal.question,
                  recommendation: proposal.recommendation,
                  affected: proposal.affected,
                  original: proposal.source,
                  amendment: null,
                },
              ],
              state: { kind: "open" },
            });
            source.state = {
              kind: "awaiting-clarification",
              decision: { id, revision: 1 },
            };
            break;
          }
          case "technical-choice": {
            const task = state.tasks.find(
              (t) =>
                t.id === proposal.target.id &&
                t.history.at(-1)?.revision === proposal.target.revision,
            );
            if (!task)
              return reject(
                "stale-task",
                "Technical choice target is not current.",
              );
            task.technicalChoices.push({
              source: proposal.source,
              target: proposal.target,
              choice: proposal.choice,
            });
            source.state = {
              kind: "applied",
              resolution: message.evidence.run,
            };
            break;
          }
          case "conversation": {
            source.state = {
              kind: "applied",
              resolution: message.evidence.run,
            };
            break;
          }
          case "propose-amendment": {
            if (
              !proposal.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject("stale-task", "Affected task revision changed.");
            const id = DecisionId.parse(randomUUID());
            const amendment = AmendmentId.parse(randomUUID());
            state.amendments.push({
              id: amendment,
              decision: { id, revision: 1 },
              affected: proposal.affected,
              category: proposal.category,
              change: proposal.change,
            });
            state.decisions.push({
              id,
              history: [
                {
                  revision: 1,
                  kind: "protected",
                  question: proposal.question,
                  recommendation: proposal.recommendation,
                  affected: proposal.affected,
                  original: proposal.source,
                  amendment,
                },
              ],
              state: { kind: "open" },
            });
            source.state = {
              kind: "awaiting-clarification",
              decision: { id, revision: 1 },
            };
            break;
          }
          case "answer": {
            const decision = state.decisions.find(
              (d) => d.id === proposal.decision.id,
            );
            const current = decision?.history.at(-1);
            if (
              !decision ||
              decision.state.kind !== "open" ||
              !current ||
              current.revision !== proposal.decision.revision
            )
              return reject("stale-decision", "Decision revision is not open.");
            if (
              proposal.effect.kind !== "clarify" &&
              !current.affected.every((ref) =>
                state.tasks.some(
                  (t) =>
                    t.id === ref.id &&
                    t.history.at(-1)?.revision === ref.revision,
                ),
              )
            )
              return reject(
                "stale-task",
                "Affected task revision changed. Ask for a freshly presented decision revision.",
              );
            if (
              source.evidence.origin !== "emperor" ||
              source.originIntent.kind !== "unclassified" ||
              !source.evidence.presented.some(
                (p) =>
                  p.decision.id === decision.id &&
                  p.decision.revision === current.revision,
              )
            )
              return reject(
                "not-presented",
                "Decision was not presented when this answer arrived.",
              );
            const effect = proposal.effect;
            const resolution = randomUUID();
            if (effect.kind === "record-clarification") {
              if (
                current.kind !== "product" ||
                !current.affected.some(
                  (t) =>
                    t.id === effect.target.id &&
                    t.revision === effect.target.revision,
                ) ||
                effect.answer !== source.text
              )
                return reject(
                  "effect",
                  "Answer effect is not permitted for this decision.",
                );
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = { kind: "applied", resolution };
              decision.state = { kind: "resolved", resolution };
            } else if (effect.kind === "resolve-routing") {
              const original = state.submissions.find(
                (s) =>
                  s.id === effect.original.id &&
                  s.revision === effect.original.revision,
              );
              if (
                current.kind !== "routing" ||
                current.original.id !== effect.original.id ||
                current.original.revision !== effect.original.revision ||
                !original ||
                original.state.kind !== "awaiting-clarification" ||
                original.state.decision.id !== decision.id
              )
                return reject(
                  "effect",
                  "Routing effect is not permitted for this decision.",
                );
              const routing = effect.routing;
              if (
                routing.kind === "correction" &&
                !state.tasks.some(
                  (t) =>
                    t.id === routing.target.id &&
                    t.history.at(-1)?.revision === routing.target.revision &&
                    current.affected.some((a) => a.id === t.id),
                )
              )
                return reject(
                  "stale-task",
                  "Correction target is not current affected work.",
                );
              original.state = { kind: "pending", routing: effect.routing };
              original.revision++;
              decision.state = { kind: "resolved", resolution };
            } else if (
              effect.kind === "approve-amendment" ||
              effect.kind === "decline-amendment"
            ) {
              const amendment = state.amendments.find(
                (a) => a.id === effect.amendment,
              );
              if (
                current.kind !== "protected" ||
                current.amendment !== effect.amendment ||
                !amendment ||
                amendment.decision.id !== decision.id ||
                amendment.decision.revision !== current.revision ||
                !source.evidence.presented.some(
                  (p) =>
                    p.decision.id === decision.id &&
                    p.decision.revision === current.revision &&
                    p.amendment === amendment.id,
                )
              )
                return reject(
                  "not-presented",
                  "The exact current amendment was not presented to this answer.",
                );
              if (effect.kind === "approve-amendment") {
                for (const affected of amendment.affected) {
                  const task = state.tasks.find((t) => t.id === affected.id);
                  const latest = task?.history.at(-1);
                  if (!task || !latest || latest.revision !== affected.revision)
                    return reject("stale-task", "Amendment target changed.");
                  task.scope.amendments.push(amendment.id);
                  task.history.push({
                    ...latest,
                    revision: latest.revision + 1,
                    source: proposal.source,
                  });
                }
              }
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = { kind: "applied", resolution };
              decision.state = { kind: "resolved", resolution };
            } else {
              const revision = current.revision + 1;
              const affected: typeof current.affected = [];
              for (const previous of current.affected) {
                const task = state.tasks.find((t) => t.id === previous.id);
                const latest = task?.history.at(-1);
                if (!task || !latest)
                  return reject("stale-task", "Affected work is unavailable.");
                affected.push({ id: task.id, revision: latest.revision });
              }
              let amendment = current.amendment;
              if (current.kind === "protected") {
                const originalAmendment = state.amendments.find(
                  (a) => a.id === current.amendment,
                );
                if (!originalAmendment)
                  return reject(
                    "effect",
                    "Protected amendment is unavailable.",
                  );
                amendment = AmendmentId.parse(randomUUID());
                state.amendments.push({
                  ...originalAmendment,
                  id: amendment,
                  affected,
                  decision: { id: decision.id, revision },
                });
              }
              decision.history.push({
                ...current,
                revision,
                amendment,
                affected,
                question: effect.question,
                recommendation: effect.recommendation,
              });
              const original = state.submissions.find(
                (s) => s.id === current.original.id,
              );
              if (original?.state.kind === "awaiting-clarification")
                original.state = {
                  kind: "awaiting-clarification",
                  decision: { id: decision.id, revision },
                };
            }
            state.resolutions.push({
              id: resolution,
              decision: proposal.decision,
              answerSource: proposal.source,
              effect,
            });
            source.state = { kind: "applied", resolution };
            break;
          }
          default: {
            const exhaustive: never = proposal;
            return exhaustive;
          }
        }
      }
      const result: CommittedResult = {
        kind: message.kind === "message" ? "saved" : "applied",
        receipt: {
          legatus: state.id,
          requestKey: message.requestKey,
          sequence: state.receipts.length + 1,
          message: "Saved for interpretation. Intake only.",
        },
      };
      state.receipts.push({ fingerprint, result });
      const expected = state.revision;
      state.revision++;
      try {
        await this.store.save(
          state,
          expected,
          () => this.epoch === epoch && this.binding === binding,
        );
        return result;
      } catch (error) {
        this.uncertain = { id: state.id, requestKey: message.requestKey };
        this.revoke();
        return {
          kind: "uncertain",
          requestKey: message.requestKey,
          message: `Reconcile status ${state.id} before another mutation. ${String(error)}`,
        };
      }
    });
  }
}
