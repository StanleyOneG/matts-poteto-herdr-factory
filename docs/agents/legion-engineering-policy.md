# Legion development policy

Read before implementing or resuming Legion development, or opening or closing its development/test Herdr tabs. [Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) is authoritative; [ADR-0002](../adr/0002-lightweight-legion-boundary.md) records the approved lightweight boundary, not completed implementation. Use the [implementation plan](../plans/legion-lightweight-v1.md) for its replacement sequence. The [T04 checkpoint](../verification/t04-checkpoint-before-requirements-review.md) is historical preservation evidence, not a current acceptance gate.

## Scope and authority

Use one bounded assignment with an observable outcome, owned files, non-goals, decisions, evidence pointers and verification plan. The coordinator owns scope and acceptance. Resolve material ambiguity before dispatch. Implementation details and test seams within approved requirements belong to the Legatus; changed product/acceptance requirements, waived mandatory verification, expanded access, new financial commitments and irreversible actions outside policy require the Emperor.

Use one workflow controller. Matt-controlled workflows and poteto-mode are mutually exclusive; compatible individual pstack skills may supplement Matt. Poteto is off by default and only the Emperor enables it. Preserve `matt-tdd` and `matt-teach` names. Do not infer mode opt-in, change global role assignments or make native child models/context a Legion policy.

Preserve ordinary Pi/root/child permissions, configured native limits, machine settings and unrelated work. A Trust prompt is a human decision. Retain the exact cwd/tab/pane, notify the coordinator and wait for the operator without answering the prompt or relocating the actor to avoid it. Implementation, staging, commit, integration, publication and tracker authority are separate grants.

## Cost-aware verification

The extension owns local tasks, explicit prerequisite edges, acceptance-gated launch readiness, isolated interactive Tribuni, attempt/ownership records and observable state. The Legatus defines edges and explicitly launches ready work; readiness is not a scheduler. Legatus plus skills own TDD, checks, independent review and content acceptance. Do not build machine proofs of every TDD step, skill load, seam-approval transcript or model action. Legion is neither a sandbox nor a continuous provider veto.

Review/test the exact result, integrate using ordinary Git, then explicitly accept as Legatus. Extension validation covers exact task/attempt/result identity, caller authority, permissible acceptance transitions and the minimal Git ancestry fact in the intended parent, not a custom check/review proof protocol. Use ordinary tools/skills for tracker and PR/MR work under separately granted authority. Remove custom integration/delivery lifecycle machinery; checks, independent review and parent integration remain required working method.

Delegate Centuriones through ordinary pi-subagents; add no Legion child wrapper, registration or custom child-workspace allocation. Keep parallel writers isolated using native facilities and ordinary tools. Preserve configured native permissions, models and limits.

Use the existing public command/task/state test seam where applicable. Establish required native behavior with small representative integration checks on the actual supported versions. Focus deterministic tests on changed behavior. Reuse prior evidence only where source and assumptions remain unchanged; do not replay a full live workflow or model reenactment for each slice.

Preserve command exit codes. Setup failure is not a behavioral red; signals, timeouts and incomplete receipts are not passes. Before final implementation acceptance, run the integrated suite and obtain fresh-context independent review of the exact result. Recheck the effects of fixes; an unchanged standalone result needs no duplicate review ceremony. [#27](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/27) remains the separate validation-runner/CI task.

Measure progress by accepted outcomes and cost per accepted outcome. Distinguish current context estimates from cumulative usage. Add no Legion numeric concurrency, retry, duration or spend caps. Missing required evidence means preserve affected work and expose a decision, not invent an expanding safety framework. This policy does not itself invoke an implementation skill or authorize tests, paid probes or live trials.

## Handoff and failed attempts

Direct the predecessor to the unchanged handoff skill with a short purpose and continuation goal. Obtain its exact temporary artifact path; verify the predecessor and native children no longer write before starting the new session with that path and a read-first instruction. Preserve dirty work, actual model/thinking and workflow profile. Use disk-backed temporary storage under the [temporary-storage skill](../../.agents/skills/temp-storage/SKILL.md). Keep native compaction enabled; build no custom successor state machine.

End a failed attempt without acceptance when continuation is unsupported. Preserve code, branches, worktrees, history and unknown outcomes. Ending the record is not stopping the process, releasing dependencies or granting cleanup. Reuse its worktree only after the prior writer definitively stopped; otherwise use a separate isolated worktree. Do not replay unknown effects or guarantee same-attempt recovery after arbitrary partial failure.

On restart retain task/dependency/result/session/worktree pointers without automatic actor reattachment, adoption or replay. Saved pointers are not live authority. No old user records require a compatibility migration layer; separately preserve existing test artifacts/runtime without moving, adopting or deleting them.

## Task-owned Herdr resources

Keep the Legatus in its existing workspace. Open each Tribunus or disposable trial in a new no-focus tab there; additional interactive sessions belong in that Tribunus tab. Native headless subagents need no panes. Use verified caller identity and explicit returned workspace/tab/pane IDs; preserve unrelated actors.

Use unique owned directories under `<project-parent>/worktrees-<project-name>_legion/<unique-owned-task-or-run>`, deriving project identity from the canonical primary checkout. Preserve existing contents and previously pinned locations. Do not move or adopt existing resources or copy dirty parent state into trials. Shared Git grants no control over other Legati's resources.

The developer or subagent that opens a test tab owns its cleanup. Before returning a completed trial or checkpoint, save evidence and close verified task-owned settled tabs that no continuation, human decision or reviewer still needs. A completed failed trial may close after its failure evidence is saved; this does not change product cleanup eligibility.

Immediately before closure, reconcile exact returned IDs, current sessions/processes, all pane occupants, native child settlement and outstanding effects. Use normal native facilities; terminal idle, a cancellation request or model prose alone is insufficient. Retain active, ambiguous, human-used, Trust-pending or still-needed actors. Report their exact IDs and reasons, and explicitly hand cleanup to the coordinator if unable to finish it. Record closed IDs and retained exceptions.

Product auto-close still requires an accepted, reviewed, settled owned tab; ending a failed attempt does not make it eligible. The completed disposable-trial rule above is a development cleanup rule, not product acceptance.

Tab cleanup never deletes worktrees, branches, journals, dirty files or evidence, and never accepts work. Preserve uncertain resources without numeric kill deadlines. The first version retains worktrees and branches and explains that automatic worktree removal is unsupported. Retention alone does not block an otherwise eligible tab. Product commands, legacy settings/intents and retries cannot re-enable removal or replace it with a manual destructive-command bypass. Preserve historical records and unknown outcomes without completing or replaying them. Future automatic worktree removal is deferred to #42 and does not block the first version or #41; it requires a separately approved contract and verification, not an expanded observer within #40.
