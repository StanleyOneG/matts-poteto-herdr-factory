# Legion development policy

Read this policy before implementing or resuming development of Legion itself. It governs development assignments, not the shipped managed-session workflow.

## Preserve the product contract

[Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) remains authoritative. Managed Tribuni start with poteto-mode enabled, use Matt TDD as primary and compatible pstack guidance as a supplement, and leave task-graph ownership with the Legatus. Preserve permissions, machine settings, selected models, and configured child-role models. Legion adds no numeric concurrency, retry, duration, or spend caps.

Herdr placement follows the owning Legatus: retain its existing workspace, create each Tribunus in a new no-focus tab there, and place any additional interactive Pi sessions in panes of that Tribunus's tab. Native pi-subagents children need no terminal pane. Verify caller session/process and use explicit returned workspace/tab/pane IDs. Git worktree isolation is independent of this terminal layout. Apply the same placement rule to disposable development trials; preserve unrelated occupants.

Allocate new Git/task directories under `<project-parent>/worktrees-<project-name>_legion/<task-or-run>`, using the canonical primary project checkout even when the caller is in a linked worktree. Create the container if absent, preserve existing contents, and use unique owned subdirectories. Previously pinned worktrees and running trials retain their locations; reconcile them rather than moving, deleting, or adopting them. Disposable live repositories use the same container convention and are not dirty-state copies or authority to stage the parent checkout. This directory policy is independent of Herdr layout.

Project proximity does not grant Pi trust. A normal trust prompt is a pending human decision: preserve the exact cwd/tab/pane, notify the coordinator immediately so the operator can review the folder and resolve the standard UI, and withhold affected work until human approval is actually established. Denial-fixture approval is not trust authorization. Continue only against the exact reconciled actor; preserve settings, models, permissions and Git isolation.

Managed read-only Centuriones require native tool provenance and a final execute boundary after ordinary permission hooks, with unchanged admitted arguments and current owner/model checks. Refuse incompatible configured overrides rather than replacing them. Support a compatible trusted-extension composition preserving assigned role models; known incompatible switching through supported APIs is a blocker. Startup/effect checks are not a continuous provider-request veto. Pi 1.0.4 catches errors in before_agent_start and before_provider_request; do not claim throwing there blocks requests. Preserve ordinary root and child permission denial and provider restrictions; expose an unavailable required native boundary before dependent implementation.

Development of Legion can use the Matt-led bounded workflow below without sticky poteto-mode. This does not waive real managed-Tribunus trials or change [#5 acceptance](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/5). A different managed runtime profile or removal of its poteto requirement needs explicit product approval.

## Establish one workflow owner

One coordinator owns the assignment and its acceptance. Compatible testing and design techniques may be combined. Two complete workflow controllers require an explicit composition contract first.

The contract must name who owns scope, design, delegation, testing, review, continuation, and Git publication. Matt TDD precedence alone does not settle those responsibilities. Use the configured model for each role and record the chosen model in the assignment. A hard judgment does not make every later coding task a hardest-task assignment. Do not introduce hidden model assignments or change the global role table.

If sticky poteto-mode is active in a development session and conflicts with this workflow, ask the operator for `/poteto-mode off` or a new session before incompatible continuation. Do not silently suppress its rules. `/pstack off` changes persistent global skill configuration and is not the substitute. Mode off changes session state, retains configured roles, and does not erase prior context.

## Write the current assignment

Keep one current contract with the following fields. Update it at the assigned boundary rather than passing a chain of historical briefs to the next worker.

- One observable acceptance outcome and the exact remaining umbrella acceptance criteria.
- Current scope, owned files, approved public test seam, and named non-goals.
- Required invariants, each classified as an explicit requirement, a necessary safety consequence with rationale, or optional strengthening.
- Approved decisions and rationale, evidence references, dependency blockers, and unresolved questions.
- The coordinator, executor and reviewer roles, their configured models, and verified ownership or run identities where relevant.
- Verification commands, expected evidence, and the boundary at which execution returns to the coordinator.
- Separate authority for implementation, review, staging, commit, integration, publication, and tracker operations.

Keep history by reference. Read archived evidence only to resolve a current uncertainty; the [T04 retrospective](../retrospectives/2026-10-08-t04.md) is not a default prerequisite for every assignment.

Optional strengthening needs approval before becoming a blocker. If an alleged safety consequence is disputed, preserve the required safeguard, stop affected work, and request a decision. Unknown capability or ownership is not permission to invent a broader policy or a replacement execution path.

## Prove dependencies before implementation

Before building dependent behavior, establish the smallest real native path on the supported runtime versions. Test the guarantees the outcome actually needs, such as startup identity, journal timing, configured launch behavior, permission denial, and child ownership. Controlled adapters do not prove native lifecycle ordering.

Separate required behavior from a proposed enforcement mechanism. For example, permission and model preservation do not by themselves establish a requirement for a particular continuous provider-request veto. If a required guarantee lacks native support, stop the affected scope and expose the decision before further dependent implementation. Retain deterministic regressions and final live acceptance.

## Implement and verify one outcome

Use the loop in [Matt implement](../../.agents/skills/implement/SKILL.md) and [matt-tdd](../../.agents/skills/matt-tdd/SKILL.md) within the authorized assignment. This policy does not automatically invoke the user-only implement skill or grant its commit step authority.

1. Reuse the already-approved public seam. Seek approval only for a new or changed seam, not for each slice at the same seam.
2. Establish a behavioral red, then the smallest green change. A setup failure is not red evidence. Keep refactoring in review as Matt requires.
3. Run focused tests and typechecking regularly. Run the full suite against the final integrated implementation before umbrella acceptance; partial checkpoints are not a reason to repeat it. An independently deliverable assignment may have its own explicit final suite gate. Preserve the actual command exit status and identify the tested source state. Separate setup errors, assertion failures, signals, and timeouts from passes.
4. Obtain fresh-context independent review of the completed outcome before acceptance. Identify the exact diff and evidence reviewed. Correct actual findings and recheck their blast radius, rather than replaying all unchanged history.
5. Return acceptance evidence, remaining criteria, exceptions, and blockers. Wait at the assigned boundary; a partial checkpoint is not issue acceptance or permission to schedule the next unit.

The existing `scripts/check-red-evidence.mjs` is a focused-red helper, not a general green runner. [#27](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/27) tracks a general exit-preserving validation runner and CI; neither is supplied by this policy. Review still judges whether an assertion proves the required behavior. [#26](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/26) tracks product policy composition. These follow-ups do not automatically expand #5.

Required final integration review remains. An unchanged standalone result does not need duplicate review merely to fill two workflow labels. Review approval never grants staging, commit, integration, or publication authority. Preserve unrelated dirty work and stage only explicitly authorized changes when staging is authorized.

## Close unused development tabs

Each developer or subagent that opens Herdr tabs for this task owns their cleanup. Before returning a completed trial or checkpoint, close its tabs once no continuation, human decision, or reviewer needs the live sessions. A finished failed trial may be closed after its failure evidence is saved; keeping a failure record does not require keeping its terminal open.

Immediately before closing, reconcile the returned tab/pane IDs, current session and process identity, every pane occupant, native child terminal evidence, and outstanding effects. Herdr idle alone is insufficient. Save journals, results, source pins and worktree locations first. Close only verified task-owned, settled tabs through Herdr; preserve unrelated panes and the coordinator. Keep active, ambiguous, Trust-pending or still-needed sessions and report their exact IDs and reason to the coordinator. Recheck and close them when that reason ends. If a worker cannot perform cleanup, it must explicitly hand the remaining tabs to the coordinator rather than leave them unowned.

Record closed IDs and retained exceptions in the result. Tab cleanup does not delete worktrees, branches, dirty files, journals or evidence, and does not accept the trial or close its issue. This rule concerns disposable development/test sessions; it does not relax the shipped Legion product's acceptance and cleanup contract.

## Checkpoint without destructive interruption

Before continuation, report accepted outcomes, remaining unknowns, elapsed time and cumulative usage when available. Measure progress by accepted outcomes and cost per accepted outcome, not by launch, file or test counts. Distinguish current context estimates from cumulative usage and mark stale observations unknown. Keep the next contract compact, with evidence links instead of full transcripts.

The operator may choose development-session checkpoints separately from product policy. Do not invent numeric cycle, time, or spend caps. At a checkpoint, let active effects reach a safe state and preserve evidence; do not auto-kill processes to satisfy a threshold.

Product context telemetry belongs to [#6](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/6), and managed compaction belongs to [#8](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/8). This policy and the development recovery skill do not implement either.
