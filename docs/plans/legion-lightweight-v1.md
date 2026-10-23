# Lightweight Legion v1 implementation plan

**Status: approved boundary; implementation not started by this plan.** [ADR-0002](../adr/0002-lightweight-legion-boundary.md) supersedes the wider protocols in [ADR-0001](../adr/0001-native-workflows-and-local-ownership.md). [Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) and [open #41](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/41) define the target and release gate. Documentation/planning approval is not implementation, test, install, tracker, actor or cleanup authority.

## Outcome and constraints

Keep local tasks, explicit prerequisite edges, acceptance-gated launch readiness, isolated interactive Tribuni, attempt/ownership records and observable state. Legatus defines edges and explicitly launches ready work; there is no scheduler. Legatus plus skills own TDD, checks, independent review and content acceptance. Ordinary Git integrates; ordinary tools/skills operate the tracker and PR/MR. Explicit acceptance validates exact identity and permitted transition, with a minimal intended-parent ancestry fact check.

Delete custom child registration/allocation, integration/delivery lifecycles, successor protocols and same-attempt recovery machinery. Preserve ordinary Trust/permissions, selected workflow/model rules, local exclusion, parallel-writer isolation and non-destructive cleanup safeguards. Failed-attempt exit preserves work/unknown outcomes without acceptance or a claim that the process stopped. Restart retains pointers, not actor authority.

No old user records require a compatibility migration layer. Existing runtime/test artifacts remain separately preserved and unadopted. Do not rewrite their databases, move their worktrees or replay their unknown operations. This is not a storage-backend redesign or authorization to clean state. The pre-existing dirty implementation candidate must remain untouched until a separately authorized implementation scope accounts for it.

## Source-based disposition

Paths below describe the current candidate, not promises that each whole file disappears. Mixed modules lose named responsibilities while retaining required behavior; move only the small shared identity/observation pieces needed by the kept boundary. Retire tests for replaced contracts explicitly, not by calling them passes.

| Disposition | Current file cluster and source fact | Replacement / retained responsibility |
| --- | --- | --- |
| **KEEP / simplify** | `src/checkout-identity.ts`, `src/assignments.ts`, `src/git-workspace.ts`: local ownership, reservation/branch/worktree planning; `AssignmentLedger.dispatch/complete` also journal operations and retry paths. | Keep one active local Legatus, exact task/attempt-to-workspace ownership and isolated Tribunus allocation. Remove child allocation consumers, legacy schema/migration branches and same-attempt recovery/retry paths. Record uncertain launch/allocation outcome and preserve it; a fresh isolated attempt is not replay of that operation. Keep the existing backend unless a demonstrated requirement demands otherwise. |
| **KEEP / replace mixed core** | `src/intake.ts`, `src/snapshot.ts`: tasks/revisions, decisions, launch, results, shutdown, corrections, handoff, integration/delivery and compatibility records are intertwined. `TaskRef` currently has only id/revision; no stored prerequisite relation. | Add the smallest local prerequisite relation and launch-time accepted-result check. Retain admitted inputs/decisions, task/attempt/result/session/worktree pointers and truthful state. Replace proof/integration/delivery/successor schemas with explicit result acceptance and failed-attempt disposition. Separate ended record from writer settlement. No parallel new “recovery ledger.” |
| **KEEP / simplify** | `src/extension.ts`, `src/tribunus-host.ts`, `src/tribunus.ts`, `src/tribunus-client.mjs`: native skill entry, interactive launch, worker identity, telemetry and permissions; extension prompt currently drives staged `legion_integrate`, `legion_delivery`, `legion_deliver` and `legion_handoff`. | Keep native entry, scoped interactive assignments, configured shell, returned Herdr IDs, local authority, meaningful events and read-only status. Remove removed-tool registrations, prompt instructions, correlation plumbing and child-wrapper hooks. Preserve required scoped correction/owner-loss/off behavior without reviving a recovery protocol. |
| **DELEGATE / DELETE** | `src/centuriones.ts` wraps native input and correlates owned child intent/lifecycle; `src/centurio-workspace.ts` allocates branch/worktree and journals effects; `src/centurio-legacy.ts`, `src/owned-children.ts` retain child/research schemas. Host call sites invoke this layer. | Native pi-subagents owns child launch/configuration/lifecycle. Delete Legion child preparation, registration, allowlists and allocation wrappers plus their active callers. Use native observations only where handoff/tab safety needs them; do not recreate a child registry under another name. Delegating principals use native isolation or ordinary separate worktrees for parallel writers. |
| **DELEGATE / replace** | `src/result-domain.ts`: `ResultVerification`, `ResultReview`, digest binding, `resultStatus` inferred from `IntegrationRecord`; `src/git-integration.ts`: guarded fast-forward mutation and reflog reconciliation. | Keep a small exact task/attempt/result identity and explicit authorized acceptance transition. Replace automatic integration-derived acceptance with Legatus acceptance after ordinary Git integration. Keep only read-only repository/parent/commit resolution and ancestry observation needed for that gate. Delete `IntegrationIntent/Outcome/Record`, verification/review proof state and Git mutation/reconciliation lifecycle. Evidence references may remain informative, not a proof schema. |
| **DELEGATE / DELETE** | `src/delivery-domain.ts`, `src/delivery-adapter.ts`; delivery selection in `src/legion-settings.ts`; delivery fields and stages in extension/intake/snapshot. Current `AcceptedResultProof`, final verification/review records and publication intents own tracker closure/draft/ready. | Delete custom provider/configuration adapters, final-result proof bundles, closure/publication stages and reconciliation. Ordinary skills/tools handle tracker/PR and branch/report delivery under existing grants. Keep useful tracker links as task context, not delivery authority. No replacement publication framework. |
| **DELEGATE / DELETE mixed** | Handoff request/receipt/successor records in `src/snapshot.ts`, retirement/handoff controls in `src/tribunus.ts`, host/intake continuation handlers; `src/resume.ts` couples observations to handoff/correction/effect reconciliation. | Unchanged handoff skill plus Legatus procedure: purpose, artifact path, stopped-writer verification, read-first new session, model/profile preservation. Delete successor state machine, staged replay and automatic actor-recovery orchestration. Retain only needed ordinary resource observations and saved pointers for status/safe isolation. Native compaction remains. |
| **KEEP** | `src/context-alerts.ts`, `src/principal-compatibility.ts`, non-delivery `src/legion-settings.ts`; `src/preflight.ts` and `requiredWorkflowSkills()` in `src/tribunus.ts`. | Preserve principal-only 272k minimum, 135k/150k defaults, estimates vs cumulative usage, unknown/freshness, no routine model wakes; Emperor-only profile/model choices, config precedence and selected-workflow availability. Narrow discovery checks to their actual composition/selected-workflow requirement; do not present discovery as method-adherence proof. Preserve Matt skill names and fork provenance. |
| **KEEP / simplify** | `src/tab-cleanup.ts`, `src/cleanup-permission.ts`, `src/cleanup-gate.mjs`, `src/cleanup-domain.ts`, `src/cleanup-usage.ts`, `src/worktree-cleanup.ts`. Cleanup currently embeds an `IntegrationRecord` and successor/child history. | Rebind tab eligibility to explicit accepted result and exact owned resource, not deleted integration proof. Keep immediate all-occupant/identity/activity/need checks and ordinary permission barrier. Retain unknowns. Delete unsupported worktree-removal lifecycle/compatibility scaffolding rather than build an observer to enable deletion; retain any shared observation used by tab safety. Worktrees/branches remain intact. |
| **DELETE after references removed** | `src/engineering-contract.ts`, historical contracts/research/legacy unions in snapshot/tribunus/assignments and related imports. `ContractEvidence` already says historical persistence only. | No migration reader or legacy authority layer for nonexistent old user records. Preserve real historical evidence outside the new runtime contract. Keep unrelated `src/private-evidence.ts` utilities only where the simplified runtime still uses them. |
| **REPLACE tests / docs later** | `tests/result-*`, `git-integration`, `delivery-*`, `final-storage`, `centurio-*`, `child-runtime`, `effect-*`, `handoff`, `tribunus-handoff`, `resume*`, `cleanup-*`; `tests/support/legatus-ui.mjs`, `composed-transport.mjs`; README and package checks. | Keep assertions protecting still-approved behavior and public fixtures. Replace lifecycle/proof/recovery assertions with the vertical outcomes below; remove obsolete custom delivery-provider fixtures if no retained behavior uses them. Preserve historical evidence and pre-existing untracked candidate files until their disposition is explicitly authorized. Package/runtime docs must stop advertising deleted tools. |

### Current mismatches to fix, not paper over

- `src/extension.ts`'s `nativeInstructions` says the Legatus owns the graph/frontier, but there is no persisted prerequisite model or launch gate in `TaskRef`. Prompt-only release is insufficient.
- `resultStatus()` in `src/result-domain.ts` currently reaches `accepted` from a confirmed integration record; the target instead requires an explicit Legatus decision plus a small read-only ancestry check.
- `prepareCenturioWorkspace()` journals child branch/worktree effects. The historical stalled allocation is not a reason to repair that allocator: the whole Legion child-allocation responsibility is removed.
- `src/cleanup-domain.ts` binds acceptance to `IntegrationRecord`; deleting integration must not accidentally disable tab eligibility or allow unaccepted/ended attempts to be cleaned.
- Existing preserved candidate changes include package pins, native launch/profile/environment code and tests. None is accepted or discarded by this document; compare and integrate only what the new target needs after implementation authorization.

## Vertical implementation slices

Use red → smallest green → refactor at the existing public command/task/state seam. Keep the same tests meaningful across refactors; avoid tests for proposed internal class layouts. Each slice ends with focused checks and review of its changed behavior. No slice runs the full live product matrix.

### 1. Local prerequisites and explicit acceptance

**Depends on:** requirements publication and implementation authorization; settle the graph-edit question below before exposing mutable accepted graphs.

Through `tests/support/legatus-ui.mjs` / `composed-transport.mjs` and the registered public tools, admit A and B with B depending on A. Observe B launch refused before acceptance. Perform checks/review as working method and ordinary Git integration in a disposable repository; explicitly accept A, observe B ready but not launched, then explicitly launch B. Validate current caller/task revision/attempt/result identity and allowable transition. Wrong identity, stale result, absent commit, wrong repository/parent and non-ancestor/unknown Git observations must refuse acceptance without mutation.

Replace old result proof/integration controls along this path rather than layering another result subsystem beside them. Keep a small read-only ancestry operation (for example, `git merge-base --is-ancestor <result-commit> <resolved-parent-commit>` in the identified repository), not a Git mutation adapter. Distinguish Git “not ancestor” from observation failure. A changed/squashed commit is a different result, not acceptance of the original hash. Legatus handles checks/review of the new identity.

**Gate:** public tests demonstrate refusal → explicit acceptance → readiness → explicit launch, and explicit acceptance rather than an integration receipt is the only release event. No extension Git merge or review/check proof lifecycle remains on the replaced path.

### 2. Ordinary native delegation and isolated Tribuni

**Depends on:** slice 1 identity/readiness path.

Retain interactive Tribunus shell launch, no-focus topology, profile/model pins and ordinary Trust/permissions. Replace the child-wrapper route with ordinary pi-subagents calls. Delete `centurio-workspace.ts`, `centuriones.ts` and legacy child/research records only after extracting any genuinely needed native safety observations and removing callers. Parallel native writers must demonstrably use isolated workspaces; read-only native research/review needs no custom allocation ceremony.

Start with public launch/delegation tests that show there is no Legion child preparation/registration step and no effect bypass. Preserve `tests/launch.test.ts`, `tribunus-topology`, `tribunus-launch-profile`, native workflow/permission and candidate launch-environment coverage where requirements remain. Use one bounded supported-version native check later to confirm actual argument shape, discovery and isolation; mocks alone do not establish that.

**Gate:** a Tribunus can delegate normally without child records; interactive worker identity, independent writer isolation and normal permission denial still hold. No global settings/model changes.

### 3. Failed-attempt exit and pointer-only restart

**Depends on:** slices 1–2; needed before the handoff replacement.

Add a minimal explicit unsuccessful end disposition to the attempt record, not a retained-allocation recovery subsystem. Public behavior test: record an unknown/partial launch or allocation outcome, end the attempt, observe result unaccepted and dependents blocked, and verify code/branches/worktrees/history/unknown outcomes unchanged. No retry of the old effect follows.

A new attempt may reuse the prior worktree only with definitive prior-writer stop evidence. Test active and unknown writers refusing reuse, and separate isolated new attempt allocation preserving the old work. End-record and process state must remain visibly distinct. Restart/status tests load retained task/dependency/result/session/worktree references without starting, attaching, controlling or replaying old actors. `/legion off` and owner-loss handling retain safe stop/park behavior without promising autonomous recovery.

Remove same-attempt retry, actor adoption, legacy migration and reconciliation-controller paths from mixed modules. Keep observations used by safety/status. Do not run this against the real held trial or its database.

**Gate:** ended failure ≠ accepted ≠ stopped; unknown effect remains unknown. Restart is inactive and pointer-preserving. Tests observe zero automatic actor/effect replay and no storage-backend replacement.

### 4. Handoff through the unchanged skill

**Depends on:** slices 2–3; preserves model/profile configuration from current code.

Replace custom `HandoffRequest`, staged successor launch and continuation receipts with the Legatus-directed skill journey. In a disposable dirty worktree, request the handoff with purpose/continuation, obtain its exact temporary path, establish stopped predecessor/native writers, and start a session reading that path first. Preserve dirty bytes, actual model/thinking and profile. Use native tools for writer observation; missing/ambiguous evidence blocks reuse rather than creating another proof protocol.

Test missing artifact, unknown/active writer and uncertain new launch as non-destructive visible blockers. Delete the custom successor state machine, without modifying `.agents/skills/handoff/SKILL.md` or suppressing compaction. A single representative native dirty-work journey in #41 establishes the installed skill/launch boundary.

**Gate:** no overlapping writer, no committed/uncommitted loss, no custom successor/recovery controller; ordinary launch records and the returned artifact suffice.

### 5. Ordinary delivery and retained-resource cleanup

**Depends on:** slices 1–4, because cleanup currently embeds integration and handoff proofs.

Remove `delivery-domain.ts`, `delivery-adapter.ts`, delivery settings, registrations, prompts and state branches; remove the leftover Git integration lifecycle. Legatus uses ordinary Git/tracker/PR skills/tools with separate effect authority. Tests should show those ordinary tools are not intercepted by removed Legion protocols, and unknown effects are not automatically replayed. Do not build a replacement platform fixture to qualify draft/ready; ordinary requested delivery is working method, not a new extension subsystem.

Rebind existing accepted-tab cleanup to the small accepted result identity. Keep current acceptance/ownership/settlement/all-occupant/permission checks immediately before closure. Test eligible accepted tab closure with branch/worktree retained, human/foreign/active/ambiguous/still-needed tab retention, and ended unsuccessful attempts remaining ineligible for product auto-close. Distinguish the engineering policy's completed disposable-trial cleanup from product cleanup.

**Gate:** no custom integration/delivery public tools or proof records; no worktree/branch-removal path; tab safety and ordinary permissions remain effective. No historical runtime or evidence was changed.

### 6. Supported composition, documentation and final acceptance

**Depends on:** all earlier slices; resolve command naming/help before installed checks.

Update README/help to actual supported behavior, not this plan's unimplemented target. Preserve the supplied fork source/manual replacement instructions, Matt vs poteto rules, user model choices, config precedence, context defaults, native compaction and cost policy. Record tested source/version identities rather than infer support from installed metadata. Existing candidate evidence mentions Pi 1.3.0 / pi-subagents 0.79.1 / Herdr 0.9.1 and supplied fork; this plan does not certify that composition for the simplified implementation.

Run only representative #41 journeys: isolated install/discovery/launch; direct/branching work with refusal and explicit acceptance release; ordinary native delegation; dirty-work handoff; failed-attempt exit with no replay; eligible tab cleanup retaining branches/worktrees. Reuse unchanged focused evidence. No requirement to revive the held historical actor, repeat custom draft-ready fixtures or replay an exhaustive recovery matrix.

**Final gate, still pending:** once at the end run `npm test`, `npm run typecheck`, `npm run build` and the relevant isolated package/native check from the then-current scripts (including `verify:pi` where applicable), preserving real exits. Obtain fresh-context independent review of the exact integrated candidate and recheck material fixes. Record compatibility limits and retained resources. Do not close #41, commit, publish, merge main or deploy without their separate grants.

## Validation discipline

Read [engineering policy](../agents/legion-engineering-policy.md) and the absolute repository `.agents/skills/temp-storage/SKILL.md` before authorized checks. Each run owns a unique disk-backed `/workspaces/astraprojects/.tmp` directory; set `TMPDIR`, `TMP`, `TEMP` for controlled commands and preserve any stable native runtime root. Check actual storage and output paths, retain needed evidence, and clean only separately authorized owned disposable data after consumers settle. No `/tmp` fallback for bulk fixtures.

Keep checks proportional: deterministic behavior at public seams, small native checks for actual composition/permissions, final integrated suite once at the end, fresh independent review. Setup failures, signals, timeouts and incomplete receipts are not passes. Do not add machine enforcement of TDD, a paid model reenactment, numeric product caps or #27 CI work to this scope.

## Details to settle without inventing product policy

1. **Graph changes after dispatch/acceptance:** the approved contract defines explicit edges and exact-result acceptance, but not editing/revocation semantics once dependent work exists. Before exposing such edits, resolve whether they are unsupported or require an explicit re-scope flow. Never silently invalidate/release running dependents. Graph representation, missing/self/cyclic edge validation and command naming are normal implementation details within that boundary.
2. **Continuation command spelling:** decide whether existing `/legion resume` becomes explicit pointer-only continuation or is retired with actionable guidance. Either choice must retain inactivity on restart and prohibit actor adoption/replay; retaining the old reconciler for compatibility is not an option. Likewise choose a clear failed-attempt-end public surface; naming is not a new lifecycle feature.
3. **Release ticket bookkeeping:** the coordinator must reconcile #41 dependency metadata with these replacement slices. Historical #37/#39/#40 CLOSED states are not new acceptance; creating tickets or changing links is a tracker operation outside this plan's execution authority.

No decision remains about building a recovery layer, retaining custom delivery, wrapping Centuriones or adding a migration layer: all were explicitly rejected. Exact APIs and file splits should be the smallest implementation justified by the public behavior tests, not a speculative framework.
