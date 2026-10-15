# Delivery: accepted work to tracker, review platform or local report

Delivery is separate from implementation, acceptance and Git integration. Direct tasks need no ticket. A closed tracker item or completion prose never releases a dependent: it requires an **accepted result** with confirmed exact parent integration (#38). Tracker delivery failure does not revoke that acceptance. Existing changed-scope/Emperor decision holds remain effective; unrelated approved work can continue.

The Legatus reads the configured tracker and local spec documents, owns the dependency graph/frontier, and clarifies missing or inconsistent dependencies. Bounded Tribuni receive their assignment and relevant context pointers, not responsibility for the whole graph. Concurrent writers use isolated branches/worktrees. The Legatus declares the exact final specification scope; Legion does not infer scope from every run task, enumerate a tracker or schedule a frontier.

## Operator configuration

There is **no default platform, GitHub adapter, remote inference or automatic configuration**. In the owning checkout/worktree, explicitly create the optional selector `.pi/legion-delivery.json`:

```json
{ "configurationFile": ".git/legion-delivery.json" }
```

Only this checkout-local selector is read; no global selection is inherited. A session in a subdirectory resolves to its canonical owning checkout, not the primary checkout or common Git directory. The selector accepts only `configurationFile`. The selected configuration must be a real checkout-local file. Keep it operator-owned and appropriately ignored; neither tools nor model arguments select executables/configuration. Do not commit credentials. Missing/invalid selection, unsupported capability or configuration drift holds **delivery**, not unrelated direct tasks or accepted integrations. Status/doctor are passive; they do not validate configuration or reconcile effects. Configuration is loaded at explicit delivery controls/stages and rechecked before effects.

### Local-only verified branch/report

Example selected configuration for a primary checkout:

```json
{
  "version": 1,
  "revision": "operator-v1",
  "identity": { "provider": "local", "project": "my-project" },
  "localReport": { "directory": ".git/legion-reports" }
}
```

A linked worktree has a `.git` **file**. Instead select an operator-ignored real file such as `.legion/delivery.json` and a suitable checkout-local report directory. Arrange ignore policy explicitly; dirty configuration/report files can hold final cleanliness. No ignore rules or real checkout configuration are installed by Legion.

The built-in `local-report` capability writes an exclusive operation-bound JSON report through ordinary permission-controlled Bash. It contains the exact branch/commit/tree, declared scope, accepted result/integration proofs, check/review references and material-exception resolutions. It never pushes or merges. A report is confirmed only from the exact durable receipt, not file existence alone. Storage must support hard links and directory fsync; unsupported storage fails closed. Without any selected configuration, retain the verified branch and evidence and expose the delivery hold rather than silently publishing a report elsewhere.

### Remote capabilities (operator-supplied provider)

```json
{
  "version": 1,
  "revision": "operator-v1",
  "identity": { "provider": "tracker", "project": "project" },
  "tracker": {
    "provider": "tracker", "project": "project",
    "closeTask": { "executable": "/absolute/operator/provider", "args": ["close-task"] },
    "observe": { "executable": "/absolute/operator/provider", "args": ["observe-task"], "readOnly": true }
  },
  "review": {
    "provider": "review", "project": "review-project",
    "draft": { "executable": "/absolute/operator/provider", "args": ["draft"] },
    "ready": { "executable": "/absolute/operator/provider", "args": ["ready"] },
    "observe": { "executable": "/absolute/operator/provider", "args": ["observe-review"], "readOnly": true }
  }
}
```

This is a schema example, **not a working universal `gh` implementation**. The executable must be an existing absolute executable regular file. Tracker/review/localReport are independent optional capabilities; at least one effect capability is required. Review-only configuration does not require a tracker. With a tracker, composite identity must match its provider/project. Draft and ready are individually optional; missing capability never falls back. `localReport` may coexist with remote capabilities.

The effective identity includes the operator revision and canonical configuration digest. Meaningful provider/project/command/path/capability changes invalidate prepared operations. Update the operator revision when provider behavior changes; executable contents are trusted and not hashed. Restoring pinned configuration may be necessary to reconcile old operations.

## Native tools and exact stages

In the current selected native Legatus turn, call `legion_delivery({action: {...}})`. Caller/session/generation evidence is injected by the extension; model-provided evidence, configuration or commands are rejected. Tools are model-only and discoverable in help. Controls:

- `bind-tracker`: `{kind, task: {id, revision}, tracker: {provider, project, id, url?}}`. Binding is optional and immutable.
- `prepare-closure`: `{kind, task, id, previous?}`. Requires the full exact linked accepted evidence and separate external closure authority. Closure need not wait for a main merge.
- `capture-final`: `{kind, specification, tasks: [{id, revision}], requiredChecks: ["named check"]}`. The Legatus declares scope explicitly. At least one accepted integration and a clean exact owning branch are required, including accepted-integration ancestry.
- `verify-final`: `{kind, final: {id, digest}, verification: {checks, exceptions}}`. Check/exception shapes match #38.
- `review-final`: `{kind, id, result: {id, digest}, verificationDigest, reviewer: {session, run}, reference, outcome, evidence}`. Records genuine independent review of final interactions. Executor/coordinator self-review is insufficient. An unchanged standalone result reuses its exact accepted independent review without duplicate ceremony; changed results/checks/scope/tip require relevant rechecks/review.
- `prepare-publication`: `{kind, id, final: {id, digest}, publication: {kind: "draft"} | {kind: "ready", draft: "draft-operation-UUID"} | {kind: "local-report"}, previous?}`. Draft is permitted after the first accepted integration even while declared members remain incomplete. Ready/local-report require every declared member accepted plus final checks and independent interactions review (or valid unchanged standalone reuse). Ready binds the confirmed original draft reference/configuration.
- `reconcile`: `{kind, id}`. Read-only observation, never effect execution.

Preparation has **no effects**. Separately call `legion_deliver({requestId: "prepared-operation-UUID"})` from that correlated native turn. Only its exact root call may submit necessary nested ordinary `ctx.executeTool("bash", ...)` operations. Normal permission/Trust decisions remain human/platform decisions; there is no effect fallback to `pi.exec`. If a turn settles before execution, explicitly prepare the same pending operation in a current native turn; do not invent a replacement ID to bypass a hold. Current controller, pinned configuration and exact proof are checked again. Review/preparation is not permission to stage, commit, integrate, push, publish, close issues, merge main or deploy.

An unknown/dispatched closure or publication **reconciles only**. Never blind retry, repeat integration or infer success from a closed issue, matching branch or plausible PR. Only a proven-no-effect failure permits a separately explicit new UUID linked by `previous`. Confirmed effects cannot repeat.

### Stopping and restart

```text
/legion delivery observe <run-id> <operation-id>
```

This explicit read-only command remains available after off/restart under the original retained controller session/context/generation/attachment and existing ownership locks. It updates only the retained outcome, without activation, worker revival, prompt replay or renewed scope/write authority. Foreign sessions, unavailable evidence or changed configuration remain held. Status displays operation IDs/states and recovery instructions; passive status does not reconcile. Shutdown still requires all existing worker/child/effect settlement evidence. Cleanup eligibility and #40 automation are separate; delivery never deletes resources or resolves conflicts.

## Trusted provider protocol

The configured fixed executable/arguments run at the owning checkout; safely quoted JSON is supplied on stdin, never interpolated as model-authored executable input. Request schema: `DeliveryProviderRequest` in `src/delivery-adapter.ts`:

```json
{
  "protocol": "legion-delivery/v1",
  "mode": "execute",
  "operation": "operation-UUID",
  "digest": "prepared-SHA256",
  "target": { "provider": "explicit-capability-provider", "project": "explicit-project" },
  "intent": {},
  "report": "rendered linked evidence"
}
```

`intent` is the complete validated `DeliveryIntent`, not the empty illustrative object. Stdout must be exactly JSON `{ "protocol": "legion-delivery/v1", "outcome": ... }`; diagnostics belong on stderr. Outcomes bind exact `operation`, `digest` and nonempty `evidence`, with `kind: "confirmed", reference`, `kind: "failed", noEffect, message`, or `kind: "unknown", message`. Ready must confirm the original draft reference. Exit zero alone is not confirmation; nonzero/malformed/mismatched responses stay unknown.

Internally, a Node transport captures the configured executable's stdout and stderr separately before ordinary Bash can combine them. Only exact provider stdout is parsed; stderr is retained as labeled delivery evidence, including on unknown/failed outcomes, and never establishes success or no-effect. Normal provider exit codes are preserved and checked against the transport; signals and spawn failures are explicitly distinguished and remain unknown. Malformed/incomplete transport or mismatched operation, digest or exit status also remains unknown. This does not change the external provider protocol or bypass ordinary Bash permission controls.

Reconciliation sends the same exact request with `mode: "reconcile"` only to configured `observe`, through the read-only executor. The provider must retain operation-bound receipts and prove the exact effect/evidence/target; absence alone is not no-effect proof. `readOnly: true` is a trusted operator declaration, **not sandbox enforcement**. Provider code and observation remain trusted, and command/output size limits apply. No native platform/network trial, installed journey, main merge or deployment is implied by controlled fixtures.
