# Legion development policy

Read before implementing or resuming Legion development, or opening or closing its development/test Herdr tabs. [Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) is authoritative. The [T04 checkpoint](../verification/t04-checkpoint-before-requirements-review.md) is historical preservation evidence, not a current acceptance gate.

## Scope and authority

Use one bounded assignment with an observable outcome, owned files, non-goals, decisions, evidence pointers and verification plan. The coordinator owns scope and acceptance. Resolve material ambiguity before dispatch. Implementation details and test seams within approved requirements belong to the Legatus; changed product/acceptance requirements, waived mandatory verification, expanded access, new financial commitments and irreversible actions outside policy require the Emperor.

Use one workflow controller. Matt-controlled workflows and poteto-mode are mutually exclusive; compatible individual pstack skills may supplement Matt. Poteto is off by default and only the Emperor enables it. Preserve `matt-tdd` and `matt-teach` names. Do not infer mode opt-in, change global role assignments or make native child models/context a Legion policy.

Preserve ordinary Pi/root/child permissions, configured native limits, machine settings and unrelated work. A Trust prompt is a human decision. Retain the exact cwd/tab/pane, notify the coordinator and wait for the operator without answering the prompt or relocating the actor to avoid it. Implementation, staging, commit, integration, publication and tracker authority are separate grants.

## Cost-aware verification

Code controls launch, ownership, isolated writes, execution state and authorized effects. Skills, meaningful tests and independent review establish methodology. Do not build machine proofs of every TDD step, skill load, seam-approval transcript or model action. Legion is neither a sandbox nor a continuous provider veto.

Use the existing public command/task/state test seam where applicable. Establish required native behavior with small representative integration checks on the actual supported versions. Focus deterministic tests on changed behavior. Reuse prior evidence only where source and assumptions remain unchanged; do not replay a full live workflow or model reenactment for each slice.

Preserve command exit codes. Setup failure is not a behavioral red; signals, timeouts and incomplete receipts are not passes. Before final implementation acceptance, run the integrated suite and obtain fresh-context independent review of the exact result. Recheck the effects of fixes; an unchanged standalone result needs no duplicate review ceremony. [#27](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/27) remains the separate validation-runner/CI task.

Measure progress by accepted outcomes and cost per accepted outcome. Distinguish current context estimates from cumulative usage. Add no Legion numeric concurrency, retry, duration or spend caps. Missing required evidence means preserve affected work and expose a decision, not invent an expanding safety framework. This policy does not itself invoke an implementation skill or authorize tests, paid probes or live trials.

## Task-owned Herdr resources

Keep the Legatus in its existing workspace. Open each Tribunus or disposable trial in a new no-focus tab there; additional interactive sessions belong in that Tribunus tab. Native headless subagents need no panes. Use verified caller identity and explicit returned workspace/tab/pane IDs; preserve unrelated actors.

Use unique owned directories under `<project-parent>/worktrees-<project-name>_legion/<unique-owned-task-or-run>`, deriving project identity from the canonical primary checkout. Preserve existing contents and previously pinned locations. Do not move or adopt existing resources or copy dirty parent state into trials. Shared Git grants no control over other Legati's resources.

The developer or subagent that opens a test tab owns its cleanup. Before returning a completed trial or checkpoint, save evidence and close verified task-owned settled tabs that no continuation, human decision or reviewer still needs. A completed failed trial may close after its failure evidence is saved; this does not change product cleanup eligibility.

Immediately before closure, reconcile exact returned IDs, current sessions/processes, all pane occupants, native child settlement and outstanding effects. Use normal native facilities; terminal idle, a cancellation request or model prose alone is insufficient. Retain active, ambiguous, human-used, Trust-pending or still-needed actors. Report their exact IDs and reasons, and explicitly hand cleanup to the coordinator if unable to finish it. Record closed IDs and retained exceptions.

Tab cleanup never deletes worktrees, branches, journals, dirty files or evidence, and never accepts work. Preserve uncertain resources without numeric kill deadlines. Product worktree cleanup requires its separate ownership, integration, cleanliness and no-further-use checks in #1.
