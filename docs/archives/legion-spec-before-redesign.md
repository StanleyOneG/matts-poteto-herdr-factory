# Historical Legion spec before redesign

This is the verbatim former body of GitHub spec #1, preserved before the approved redesign. It is historical evidence, not current requirements or acceptance. [Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) remains authoritative.

---

## Problem Statement

An Emperor can already use Matt Pocock's skills to clarify a change, write a spec, and split it into tickets. They can also use Pi, pstack, pi-subagents, and Herdr to perform coding work. What is missing is a reliable way to combine these tools into an unattended software factory without making the Emperor supervise every working session.

Today, the Emperor must start sessions, pass instructions between them, answer implementation questions, monitor context growth, coordinate branches, review results, and recover stalled or interrupted work. Long sessions accumulate tool output and unrelated history. Starting a replacement session can lose decisions, leave active writers behind, or duplicate work. Large AFK runs can also accumulate completed issues, idle windows, and already-integrated worktrees.

Legion must move that coordination into an explicitly enabled Pi extension while preserving engineering rules, user authority, ordinary machine configuration, and recoverable work. It must not equate a successful message delivery with compliance, terminal idleness with completed subagents, cumulative token spend with current context size, or a model's claim of completion with verified acceptance.

## Solution

Package Legion as a repository installable through `pi install`. The Emperor enables it explicitly with `/legion` in an ordinary interactive Pi session. That session's principal agent becomes the Legatus. The Legatus assigns work to independent interactive Pi sessions in local Herdr windows, whose principal agents are Tribuni. Each Tribunus starts with `poteto-mode` enabled and can use pi-subagents to run Centuriones.

The Emperor works through the Legatus. The Legatus answers implementation questions within the approved scope, coordinates task ownership and integration, watches context telemetry, arranges safe handoffs, and reports verified results or decisions that require the Emperor. It delegates substantial preliminary exploration rather than filling its own context with raw research and execution logs.

Legion supports two entry paths:

- Execute an existing spec and its task graph through Matt's `implement-spec` workflow, with a Tribunus acting as the implementer for each ticket.
- Accept a direct task. A task that fits one Tribunus session does not require a spec or tickets. If a material product ambiguity prevents safe execution, the Legatus obtains clarification before starting that work.

The normal outcome is a tested, independently reviewed PR or MR, not an automatic merge into the primary branch or a deployment. A project without a remote review platform receives a verified branch and report. Completed issues are closed after verified implementation and integration into the parent task branch, without waiting for a primary-branch merge. Integrated, clean, unused worktrees and accepted idle windows are cleaned up under explicit ownership and preservation checks.

The first version supports Pi only and local Herdr only. Its entire extension interface is in English. The Emperor may converse with the Legatus in another language.

## User Stories

### Installation and explicit activation

1. As an Emperor, I want to install Legion through `pi install`, so that I can use the normal Pi package workflow.
2. As an Emperor, I want Legion to remain inactive until I explicitly enable it, so that installing the package or opening Pi never starts a factory run.
3. As an Emperor, I want to enable Legion with `/legion` or `/legion on`, so that I can turn the current Pi session into a Legatus.
4. As an Emperor, I want to put task instructions after `/legion`, so that I can enable the mode and submit work in one interaction.
5. As an Emperor, I want dependency and compatibility checks before Tribuni launch, so that missing Herdr, its skill, Pi resources, or extensions produce actionable errors rather than partial execution.
6. As an Emperor, I want Legion to use my existing skills and settings without silently rewriting them, so that it respects my configured development environment.
7. As an Emperor, I want every Tribunus to start through my machine's configured `pi` command, so that shell aliases, functions, wrappers, and startup configuration retain their intended behavior.
8. As an Emperor, I want Legion to fail clearly when it cannot honor the configured launch path, so that it never silently substitutes a different executable or runner.

### Task intake and authority

9. As an Emperor, I want to provide a spec reference and have the Legatus discover its tickets and dependencies, so that I do not schedule every ticket myself.
10. As an Emperor, I want to give a small task directly to a Legatus, so that unnecessary specs and tickets do not become mandatory ceremony.
11. As an Emperor, I want the Legatus to clarify material ambiguity before AFK execution, so that substantial work does not follow an invented product requirement.
12. As an Emperor, I want the Legatus to decide technical details within the approved task, so that routine implementation questions do not interrupt me.
13. As an Emperor, I want changes to requirements, new financial commitments, expanded access, and irreversible actions outside the approved operating policy escalated to me, so that AFK execution does not expand its own authority.
14. As an Emperor, I want independent work to continue while another task awaits my decision, so that one blocked decision does not stop the whole factory.
15. As an Emperor, I want to submit independent tasks while a Legatus is busy, so that I do not need to wait for unrelated work to finish.
16. As an Emperor, I want dependent tasks queued until their prerequisites are satisfied, so that work begins from valid inputs.
17. As an Emperor, I want corrections delivered to the relevant Tribunus at a safe execution point, so that changing direction does not silently interrupt an in-flight operation.
18. As an Emperor, I want the Legatus to ask when a message could mean either a new task or a correction, so that it does not guess my intent.

### Ownership and execution

19. As an Emperor, I want to run multiple Legati against a repository, so that separate approved tasks can proceed concurrently.
20. As a Legatus, I want exclusive, recoverable ownership of each assigned task, so that another Legatus cannot accidentally assign the same work.
21. As a Legatus, I want each concurrent writer to use a separate worktree and branch, so that unrelated writers do not overwrite each other's changes.
22. As a Legatus, I want integration into a shared parent task branch to be serialized, so that concurrent results do not race during merge.
23. As a Legatus, I want each Tribunus to own a bounded assignment rather than the entire spec graph, so that scheduling authority is not duplicated at every level.
24. As a Tribunus, I want `poteto-mode` enabled before implementation starts, so that pstack's engineering workflow governs my work.
25. As a Tribunus, I want to use Centuriones through pi-subagents, so that implementation, exploration, and review can run in their own contexts.
26. As a Legatus, I want to delegate substantial preparatory research through pi-subagents, so that my context remains focused on intent, decisions, ownership, and acceptance.
27. As an Emperor, I want no new Legion-imposed numeric caps on concurrency, correction cycles, run duration, or total spend, so that complex work is not stopped by arbitrary factory limits.
28. As an Emperor, I want existing permissions, provider restrictions, and extension safeguards to remain effective, so that the absence of Legion caps does not become authority to bypass them.

### Testing, review, and delivery

29. As a Tribunus, I want Matt TDD to be the primary implementation testing contract, so that work proceeds through agreed test seams and behavior-first red-to-green slices.
30. As a Tribunus, I want the Legatus to approve test seams within the accepted scope, so that AFK execution can satisfy Matt's approval requirement without inventing product behavior.
31. As a Tribunus, I want to request a documented TDD exception with alternative verification when necessary, so that an impractical test is not silently skipped or replaced with a meaningless one.
32. As an Emperor, I want pstack to supplement rather than silently override the agreed Matt TDD contract, so that the two skill sets have an explicit precedence rule.
33. As a Legatus, I want each implementation result reviewed independently in a fresh context before integration, so that executor self-review is not mistaken for independent evidence.
34. As an Emperor, I want a completed spec to receive a final integration-branch code review, so that interactions between individually accepted tickets are checked.
35. As an Emperor, I want a single-task result to avoid a redundant second review of the same unchanged result, so that quality gates do not become duplicate ceremony.
36. As an Emperor, I want the final result to be a reviewable PR or MR with verification evidence, so that I retain the merge and deployment decision.
37. As an Emperor, I want a verified branch and report when the project has no remote review platform, so that Legion still produces an inspectable result.
38. As an Emperor, I want implemented issues closed after their requirements, checks, review, and parent-branch integration are confirmed, so that a large AFK backlog reflects completed work without waiting for a primary-branch merge.
39. As an Emperor, I want closure evidence recorded on each issue, so that I can determine why it was closed and find the relevant changes and checks.
40. As an Emperor, I want premature issue closure forbidden even when it would unblock more tickets, so that task-graph progress never substitutes for acceptance.

### Context and handoff

41. As a Legatus, I want current context estimates for myself and each Tribunus, so that I can plan session replacement before context grows too large.
42. As a Legatus, I want current context, cumulative usage, and telemetry freshness distinguished, so that I do not make rotation decisions from the wrong measurement.
43. As a Legatus, I want configurable warning and rotation thresholds with defaults near 120k and 135k tokens and a target upper guide of 150k, so that there is room to finish safely and prepare a handoff.
44. As an Emperor, I want thresholds reduced for models with smaller context windows, so that absolute defaults never override the model's actual capacity.
45. As a Legatus, I want unknown or stale context marked explicitly and new work in that session withheld while observation is repaired, so that missing telemetry is not interpreted as zero usage.
46. As a Tribunus, I want to receive a stop-preparation request before handoff instructions, so that I can finish in-flight work without being asked to summarize in the middle of an operation.
47. As a Legatus, I want a Tribunus to acknowledge handoff readiness only after every Centurio has finished and no new ones can start, so that replacement never leaves hidden active writers behind.
48. As a Tribunus, I want to prepare a durable handoff after confirming readiness, so that the next session receives decisions, progress, verification, and remaining work.
49. As a replacement Tribunus, I want to continue in the predecessor's worktree with preserved committed and uncommitted state, so that rotation does not discard or duplicate implementation work.
50. As a Legatus, I want to use clearing only when no prior task context needs transfer, so that `/new` is not a shortcut around necessary handoff work.
51. As an Emperor, I want the Legatus to rotate into a fresh Pi session in my existing window, so that I do not need to find a replacement conversation window.
52. As an Emperor, I want the Legatus's logical identity and task ownership preserved across Pi session generations, so that context replacement does not reset responsibility.
53. As an Emperor, I want planned Legatus rotation explained and visibly acknowledged, so that a fresh conversation is understandable rather than surprising.
54. As an Emperor, I want Legion to suppress threshold-triggered compaction only in managed sessions, so that it prefers the agreed handoff without altering other sessions' settings.
55. As an Emperor, I want existing overflow recovery and manual compaction retained, so that Legion does not remove Pi's recovery path or my explicit controls.
56. As a Legatus, I want an overflow compaction reported as a recovery event rather than successful handoff, so that subsequent decisions reflect what actually happened.

### Observation and interface

57. As a Legatus, I want user-facing answers and actionable events instead of entire Tribunus transcripts, so that observing execution does not consume my context with thinking and tool logs.
58. As an Emperor, I want the whole Legion interface in English, so that commands, states, errors, notifications, and help are consistent.
59. As an Emperor, I want to converse with the Legatus in my preferred language, so that English-only interface text does not constrain our conversation.
60. As an Emperor, I want a compact persistent Legion indicator and an on-demand searchable fleet panel, so that I can see progress without losing the normal Pi editing experience.
61. As an Emperor, I want to see task, state, context freshness, Centurio activity, handoff progress, and pending decisions for a Tribunus, so that I can inspect the work that needs attention.
62. As an Emperor, I want to navigate from a fleet entry to its verified Herdr window, so that I can inspect the intended session rather than a stale or unrelated pane.
63. As an Emperor, I want ordinary status updates kept out of the Legatus's conversation context, so that the interface can stay current without consuming model attention.
64. As an Emperor, I want decisions presented in a persistent queue and in Legatus chat with a recommendation and affected work, so that questions remain answerable when I return from AFK.
65. As an Emperor, I want notifications that do not open unsolicited modal windows or steal Herdr focus, so that the factory does not interrupt unrelated work.
66. As an Emperor, I want friendly role names by default and technical identities, evidence, and timestamps on demand, so that normal use is clear and diagnosis remains possible.
67. As an Emperor, I want command completion and a read-only diagnostic command, so that I can discover supported operations and diagnose failures without hidden repairs.
68. As an Emperor, I want Legion to coexist with pstack and pi-subagents widgets, themes, and keyboard behavior, so that installing it does not replace the normal Pi interface.

### Recovery, manual control, and cleanup

69. As an Emperor, I want `/legion off` to stop new assignments, drain work to safe states, and preserve progress before becoming inactive, so that turning the mode off does not destroy work.
70. As an Emperor, I want a visible stopping state until the shutdown conditions are met, so that an `off` indicator never hides active factory work.
71. As an Emperor, I want Tribuni to finish only their already-authorized safe stage and wait when their Legatus disappears, so that orphaned sessions do not take on new work.
72. As an Emperor, I want explicit `/legion resume` after a crash or restart, so that opening Pi alone does not resume unattended execution.
73. As a recovering Legatus, I want to reconcile persisted ownership, actual sessions, processes, branches, and accepted actions before scheduling, so that recovery does not duplicate work or repeat applied commands.
74. As an Emperor, I want normal observation of Tribunus windows to remain read-only, so that viewing a session does not alter ownership.
75. As an Emperor, I want direct intervention in a Tribunus window to transfer it to manual control and notify the Legatus, so that two authorities do not issue conflicting instructions.
76. As an Emperor, I want an explicit return from manual control with a state update, so that the Legatus does not resume from stale assumptions.
77. As an Emperor, I want accepted idle Tribunus windows closed automatically, so that long AFK runs do not accumulate unnecessary windows.
78. As an Emperor, I want windows with failures, pending decisions, manual control, or active Centuriones preserved, so that cleanup does not hide unresolved work.
79. As an Emperor, I want clean, unused worktrees removed after their results are merged into their parent task branch, so that integrated AFK work does not leave an ever-growing worktree collection.
80. As an Emperor, I want unsafe or ambiguous cleanup refused with an explanation, so that missing evidence never becomes permission to delete work.
81. As an Emperor, I want records and handoffs preserved after window or worktree cleanup, so that accepted work remains inspectable and recoverable.
82. As an Emperor, I want the Legatus to retain my selected model, a new Tribunus to use normal machine launch settings, and Centuriones to follow pstack role settings, so that Legion does not introduce hidden model assignments.
83. As an Emperor, I want handoff to preserve the predecessor's explicitly selected model and reasoning level or report unavailability, so that it does not silently substitute a different model.
84. As an Emperor, I want a README that explains setup, both task entry paths, handoff, clearing, stop, resume, and recovery, so that I can operate Legion without knowing its internals.

## Implementation Decisions

### Product and authority

- Legion is a Pi extension package, not a replacement agent application or a general multi-harness orchestrator. The first version uses local Herdr and ordinary interactive Pi sessions.
- Emperor, Legatus, Tribunus, and Centurio are domain roles. A Tribunus is the principal agent of a separate Pi session, not an ordinary nested pi-subagents child. Its Centuriones remain owned by that Tribunus's pi-subagents runtime.
- The Legatus owns intake, task scheduling, cross-ticket coordination, escalation, integration, and acceptance. A Tribunus owns its bounded implementation assignment and its Centuriones. Applying poteto-mode must not create a second owner of the whole spec graph.
- Technical decisions within the approved task may be delegated to the Legatus. Changes in requirements, new financial commitments beyond authorized execution, expansion of access, and irreversible actions outside this policy require the Emperor. Authorized issue closure and safe worktree/window cleanup follow the acceptance rules below, not an additional confirmation on every occurrence.
- Pending decisions block affected work only. Infrastructure failures, missing permissions, or ambiguous ownership are not permission to invent another execution path.
- Legion introduces no numeric caps on concurrency, correction attempts, elapsed execution time, or cumulative spend. It does not disable existing Pi, pi-subagents, provider, operating-system, or project safeguards. Context thresholds are a separate policy and remain mandatory.

### Public interface and mode lifecycle

- `/legion` and `/legion on` enable Legion in the current interactive session. Task text supplied to `/legion` enables the mode and submits that task. Existing spec execution can be requested using the project's `implement-spec` skill with its spec reference.
- `/legion off` begins graceful shutdown. It prevents new assignments, requests safe stopping, preserves state, and reports progress until no Legion-managed work remains active. It must not report inactive merely because the request was delivered.
- `/legion status` presents state without a model turn; `/legion doctor` provides read-only diagnostics; `/legion resume` explicitly recovers interrupted work after reconciliation. Command arguments have discoverable completion.
- Mode transitions and task delivery are separate from model interpretation. Installation, ordinary Pi startup, and opening an unrelated session must not activate Legion.
- A planned handoff continues already-authorized work automatically. Recovery after an unplanned process exit or machine restart requires explicit resume.
- A managed Tribunus may participate under an already-enabled Legatus without a second human activation command. This does not turn arbitrary new Pi sessions into Legati.

### Module interfaces and composition

- A deep Legion orchestration module exposes the public command, task-submission, and observable-state interface. Its implementation owns lifecycle transitions, claims, evidence references, handoff coordination, and recovery. Private helper organization is not part of the testing contract.
- Pi, Herdr, pi-subagents, Git, and the configured issue tracker are external dependencies reached through narrow adapters where needed. The orchestration module must not depend on rendered terminal text as the sole authority for lifecycle, context, or completion.
- Deterministic test adapters and real runtime adapters exercise the same primary public seam. Avoid creating a public seam for every helper or exposing internals just to make tests easy.
- Cross-process control requires explicit addressing, session identity, and acknowledgments. An in-process extension event bus is not a transport between independent Pi sessions.
- The exact cross-process transport and persistent storage encoding are implementation choices, constrained by these observable contracts and integration tests. Do not claim peer ownership merely because pi-subagents can display a Herdr pane.

### Dependency and launch contract

- Preflight requires a compatible Pi installation, local Herdr, an installed and discoverable Herdr skill, pstack, pi-subagents, and the Matt skills needed by the selected workflow. Skill availability must be checked for the actual target working context, including worktrees and replacement sessions.
- Reuse the configured skill resources. `matt-tdd` and `matt-teach` retain their distinct names from pstack's `tdd` and `teach`. Missing resources or conflicting contracts produce actionable diagnostics, not silent substitution.
- Legion supplies its own integration instructions without silently modifying upstream skills, user settings, shell startup files, or installed dependencies. Pi-native skill loading must be used; prose mentioning a `Skill` tool does not prove that tool exists.
- Launch the ordinary `pi` command through the actual configured interactive shell in the intended working directory. Honor aliases, functions, wrappers, and startup behavior. Do not replace the command with an absolute binary, a generic executable resolver, a different CLI, or a headless substitute that bypasses that behavior.
- Herdr layout follows the owning Legatus. Keep the Legatus in its existing workspace and create each Tribunus in a new tab in that same workspace. A Tribunus may create additional interactive Pi sessions in panes within its own tab when needed. Separate Legati may occupy separate workspaces; Legion does not create a new workspace for each Tribunus or trial. Resolve the owning workspace from verified caller identity, use explicit workspace/tab/pane IDs, and preserve focus. Native pi-subagents children retain their own runtime and do not require a visible Pi pane. This terminal layout is separate from Git worktree isolation. Apply the same placement policy to development trials, using disposable repositories and test-owned tabs/panes without controlling unrelated occupants.
- Session identity and initialization must be verified before work is assigned. Each Tribunus must have poteto-mode enabled before implementation begins, including after session replacement.
- The Legatus retains the model already selected by the Emperor. A new Tribunus uses the machine's normal Pi launch defaults. Centuriones follow applicable pstack role-model settings. Handoff preserves explicitly selected model and reasoning settings; unavailable models cause an explicit blocker rather than an automatic fallback.
- Managed children support a compatible, trusted extension composition that preserves the assigned role model. Known incompatible model switching, including through supported extension APIs, blocks affected work with an actionable explanation. Validate actual startup identity/model and current authority at admitted tool effects; retain normal root and child permission denial and provider restrictions. This contract does not require a continuous fail-closed veto of every provider request against arbitrary same-process extensions. Startup and tool checks must not be described as such a veto. If a required guarantee is unavailable through supported APIs, stop and escalate rather than patching dependencies, switching executors, or silently substituting models.

### Task graphs, tracker integration, and Git

- Existing specs may be supplied through the project's configured tracker or local spec mechanism. Follow the project's Matt setup for locating tickets, relationships, and closure behavior rather than hardcoding this repository's tracker into every installed Legion project.
- A direct task can remain a single assignment without creating a spec or tickets. Material ambiguity is resolved before execution; agent-written assumptions must not masquerade as approved product requirements.
- Multiple Legati coordinate through exclusive durable claims in a shared repository identity. Session replacement does not release ownership implicitly. A recovery process must establish that a predecessor no longer owns execution before reassigning it.
- Concurrent writers use separate worktrees and branches. Create Legion worktrees under `<project-parent>/worktrees-<project-name>_legion/<task-or-run>`, creating the shared container if absent and preserving existing contents. Use the original project identity to choose the container, not the name of a child worktree. Disposable development trial repositories use uniquely owned directories under that container instead of arbitrary `/tmp` roots. This filesystem placement is independent of Herdr workspace/tab/pane placement. Directory proximity does not grant Pi project trust: if Pi requests `Trust this folder`, visibly notify the Emperor with the exact directory and pane, and wait for human approval without answering the prompt or changing trust settings. Do not move an active actor's directory to enforce this convention retroactively. Ticket work is based on the appropriate integration branch and reconciled with its current state before integration. Integration into any shared parent branch is serialized.
- Review evidence must identify the result it evaluated. Integration must not silently apply materially changed work under a stale review. Integration conflicts or changes require relevant checks and review before acceptance.
- The final deliverable is a PR/MR with evidence, or a verified branch and report where no remote review platform is configured. For a spec, follow the configured draft-to-ready workflow and final integration review. Do not merge the deliverable into the primary branch or deploy without separate authority.

### Engineering contract and issue closure

- Matt TDD is the primary feature and bug-fix contract. Agree the public test seams before tests, work in behavior-focused red-to-green slices, and place refactoring in the review stage as Matt's skill requires. The Legatus may approve seams inside the already-authorized task.
- Compatible pstack guidance remains active. Conditional pstack TDD guidance does not silently override the Matt contract. The Tribunus must ask the Legatus for any necessary exception, state why, and supply an alternative verification plan. Preserve the exception in the final evidence.
- A fresh-context independent reviewer evaluates each result before integration. Executor self-review is supplementary. A spec receives the final Matt code-review of the integrated branch; a standalone unchanged result does not need the same review duplicated merely to fill both roles.
- Close an implemented issue after the Tribunus has verified its acceptance criteria and checks and the Legatus has confirmed required independent review and integration into the parent task branch. This is intentionally earlier than merge into the primary branch.
- Record why closure is justified, relevant commits or review links, verification results, and material exceptions. A message saying work is done, an unreviewed diff, or a successful scheduling action is insufficient.
- Legion instructions explicitly forbid closing an issue prematurely to advance the task graph. Dependents are released on accepted integrated results, not on an unvalidated tracker state alone. Reconcile tracker failures without repeating integration or pretending closure succeeded.

### Context observation and economical supervision

- Track the current context estimate and model window separately from cumulative spend. Expose measurement freshness and unknown values. Do not interpret null, absent, or stale measurements as zero.
- Default warning is approximately 120k tokens, rotation preparation approximately 135k, and the target upper guide approximately 150k. Thresholds are configurable and reduced as needed for smaller model windows with reserve for safe stopping and handoff.
- These are planning thresholds, not a hard interruption or a proven quality guarantee. One tool result can cross a threshold; waiting for safe completion may exceed the target. Do not destroy work to satisfy a number.
- When measurement is unreliable, try to restore observation and withhold new work in the affected session. Already-started Centuriones may finish. Report an unresolved blocker rather than clearing the session or declaring it ready without evidence.
- The Legatus receives bounded user-facing Tribunus responses, questions, completion/failure reports, and actionable lifecycle events. Raw thinking, full transcripts, and routine tool output stay out of its normal context. Detailed evidence remains accessible by reference when needed.
- UI telemetry updates do not create conversation messages or model requests. Routine waiting and monitoring must not repeatedly consume model turns.
- Delegate substantial preparatory exploration. Keep the Legatus focused on the Emperor's intent, decisions, ownership, dependencies, and acceptance.

### Stop, handoff, and clearing protocol

- Request stopping before requesting the handoff artifact. Delivery acknowledgment is not readiness acknowledgment.
- Stop assigning new work and prevent new Centurio launches for the retiring Tribunus. In-flight work must reach a safe state. Every Centurio must have finished before the Tribunus can acknowledge readiness; waiting, detaching, or merely requesting cancellation is not completion.
- Verify both the Tribunus session's settled state and its child lifecycle evidence. Herdr's idle indicator alone does not prove Centuriones are finished. If completion cannot be established, remain blocked rather than starting a competing successor.
- After readiness, invoke the agreed handoff behavior to write and verify a durable artifact. Carry the assignment, relevant decisions and rationale, branch and commit state, uncommitted changes, verification and review status, blockers, evidence references, and next action.
- Only start the successor after the handoff is available and ownership can be transferred without overlap. A successor Tribunus continues in the same worktree and receives an explicit reference to the handoff. Reinitialize poteto-mode and required resources.
- Do not force-reset or discard work to simplify a handoff. Failed artifact creation or successor startup leaves the existing work preserved and the transition recoverable.
- Clearing without handoff is allowed only when no prior task context is needed and the same no-active-work conditions are met. Verify the resulting session identity. A stalled command response is not proof that `/new` failed; inspect actual state before retrying.
- A Legatus rotates its Pi session within the Emperor's existing window. Persist the stable Legatus identity, task ownership, decisions, pending questions, and references outside the replaceable conversation. Its own preparatory subagents must not be stranded or forgotten during replacement. Managed Tribuni remain discoverable and their events must survive the transition.
- Show a concise English notification for planned session replacement. A new Pi session generation is not a new logical Legatus.

### Compaction policy

- Do not implement Legion activation by writing the global compaction preference. The installed interactive ExtensionAPI does not expose a supported reversible per-session setter, and the SDK/RPC setter persists a global setting.
- While Legion manages a session, use its local compaction hook to cancel threshold-triggered compaction in favor of the stop-and-handoff protocol. Do not apply this policy to unrelated sessions.
- Preserve overflow-triggered recovery when enabled by the user's existing settings. Preserve explicit manual compaction. Report overflow compaction as an exceptional recovery event and reassess context; it does not satisfy the handoff protocol.
- On leaving managed mode, remove the local policy rather than restoring a global boolean that Legion never owned. Detect an already-running compaction and reconcile its outcome instead of assuming it was prevented.
- Centuriones retain their pi-subagents-managed lifecycle. This spec does not promise the same per-session compaction policy or context guard for every Centurio.

### Durable recovery and manual control

- Store operational state and handoffs in persistent local storage that survives process and machine restart, not solely in temporary files or the retiring session's context. Do not automatically commit these records to the user's repository.
- Distinguish stable Legatus/task identities, Pi session generations, Herdr pane identities, and child run identities. Correlate commands and results so duplicate or delayed events cannot transfer ownership twice or reapply a completed action.
- Recover against actual state. A timeout or error receipt may follow a successfully applied command. Reconcile session creation, tracker updates, merges, and cleanup before retrying.
- When a Legatus disappears, Tribuni finish their already-authorized safe stage and wait. Continuous autonomous orchestration while the Legatus process is absent is not required in this version.
- After an unexpected shutdown, explicit resume reconciles persisted state with existing panes, Pi sessions, child runs, and Git state. It must not assume every old process died or launch replacements before ownership is resolved.
- Viewing a Tribunus is not intervention. Direct user input transfers it to manual control, suspends Legatus-issued work for it, and notifies the Legatus. Explicit return to managed control includes an updated state report and ownership check.

### Window and worktree cleanup

- Automatically close only verified Legion-owned Tribunus windows whose result has been accepted by the Legatus, whose required review is complete, and which have no active Centuriones or other pending work. Preserve failures, unresolved decisions, and manual-control windows.
- Remove a worktree once its accepted result is proven merged into the parent task branch, it has no uncommitted or otherwise unpreserved work, and no process, handoff, or pending continuation still needs it. A merge into the primary branch is not required.
- Apply this rule at each task level: a Centurio's work can be integrated into its Tribunus's task branch, and a Tribunus's work into the Legatus's integration branch. Cleanup must respect the owning runtime's controls and must not bypass its permissions.
- Immediately recheck ownership, activity, merge evidence, and filesystem state before removal. Dirty, unmerged, in-use, or ambiguous worktrees are retained with a visible reason. Never use force cleanup to make evidence pass.
- Deleting a window does not imply deleting its worktree. Deleting a worktree does not authorize deleting its branch. Preserve accepted results, handoff records, closure evidence, and inspectable history after cleanup.

### Interface and documentation

- All Legion-owned interface text is English, including states, labels, diagnostics, notifications, command help, and accessibility-relevant descriptions. Agent conversation may follow the Emperor's language.
- Use a compact keyed status/widget and an on-demand searchable fleet panel. Do not replace Pi's standard editor or footer, reuse another extension's widget keys, or take shortcuts that conflict with existing keybindings.
- Show mode, friendly role identity, session generation, context estimate/freshness, counts of active/waiting/manual work, and pending decisions compactly. Show detailed identities, task references, child state, handoff status, timestamps, and evidence only when requested.
- A panel selection may focus the exact verified local Herdr pane. Never steal focus or open a modal panel merely because a background event occurred.
- Routine progress changes the panel only. Task completion and planned Legatus replacement produce brief notifications. Decisions requiring the Emperor persist in a queue and appear in Legatus chat with a recommendation and the affected work. Answers use the normal conversation rather than forcing a modal interaction.
- README usage instructions cover prerequisites, installation, activation, single-task and spec execution, model behavior, the two TDD skill families, authority, issue closure, cleanup, manual takeover, graceful off, explicit resume, and diagnostics.
- Explain planned Legatus replacement clearly with an example: what remains, what is reset, what notification appears, and how the Emperor continues in the same window. Explain unknown context and overflow recovery without claiming guaranteed adherence to 150k.

## Testing Decisions

### Agreed seam

The Emperor approved one primary test seam: Legion's public command, task-submission, and observable-state interface, including externally visible actions and preserved work. Test what the Emperor, Legatus, Tribunus, and external dependencies can observe. Do not test private methods, helper arrangement, model reasoning text, or implementation-coupled internal messages.

Exercise this seam in two modes:

1. Deterministic behavioral scenarios using controlled adapters for external dependencies. Drive user actions and externally reported events, then verify state, accepted/rejected actions, evidence, and durable outcomes.
2. Integration trials using real Pi and local Herdr, disposable repositories, and test-owned sessions/windows. Verify the actual shell launch, lifecycle signals, settings isolation, and user-visible behavior that an in-memory adapter cannot prove.

### Required behavior coverage

- Installation/discovery and default-off operation; explicit activation; task-bearing activation; no launch from status or diagnostic operations; missing/incompatible dependencies and missing Herdr skill.
- Launch through a real shell alias and shell function, including configured wrappers; correct working context and skill discovery; initialization before task delivery; refusal to silently fall back to another binary or runtime.
- Direct tasks without tickets and spec task graphs; multiple Legati competing for the same task; exclusive claims; independent and blocked work; serialized integration; scope and approval escalations.
- Required Matt TDD seam approval, explicit exceptions, independent fresh-context review, final spec integration review, and failure to accept stale or unsupported evidence. Deterministic tests validate recorded protocol evidence; representative runtime exercises also verify that the intended skills are actually loaded and followed.
- Issue closure only after the accepted criteria, checks, review, and integration; closure before primary-branch merge; refusal to close solely to unblock dependencies; recoverable tracker failure without repeated integration.
- Context estimates versus cumulative usage; fresh, null, missing, and stale measurements; default and reduced model-relative thresholds; a large tool result crossing a threshold; no destructive hard cutoff.
- Safe stop requested while an assistant is responding, a tool is running, and multiple Centuriones are active. No readiness acknowledgment while any Centurio remains active; no new child launch after retirement begins; delayed completion does not become permission to rotate.
- Artifact-write failure, successor-start failure, duplicate acknowledgments, late old-generation messages, and process interruption at each handoff stage. Never create two active owners or lose uncommitted work.
- Tribunus replacement in the same worktree and Legatus replacement in the same window; preserved logical identity, model choice, decisions, ownership, pending questions, and evidence references.
- Clearing when no transfer is required; actual session identity change; a command that succeeds despite a stalled/error receipt; reconciliation before retry.
- Threshold-compaction cancellation in managed sessions, unaffected unrelated sessions, untouched global settings, retained overflow and manual behavior, and behavior when compaction has already begun. Verify the current Pi event contract rather than assuming documentation alone proves the integration.
- Legatus disappearance, peer waiting, explicit post-crash resume, surviving processes, stale claims, and recovery without duplicate task launch or mutation.
- Read-only observation versus manual takeover; no competing Legatus input during manual control; explicit return with refreshed state.
- Accepted idle window cleanup and refusal for wrong ownership, failures, pending questions, or active children.
- Worktree cleanup after merge into the parent task branch; retention of dirty, unmerged, in-use, unpreserved, or ambiguously owned work; a state change between eligibility check and removal; no branch deletion as a cleanup side effect.
- Assistant-only observation without thinking/tool-log ingestion; bounded event delivery; telemetry updates that do not add conversation messages or invoke the model; important questions and errors not silently filtered out.
- English-only Legion text, command completion, fleet filtering, narrow terminal widths, resizing, active themes, keyboard focus, coexistence with other widgets, and correct pane navigation. No unsolicited focus changes or modal dialogs.
- Graceful off visibly progresses through stopping, preserves active work, and removes local policy only when safe. Ordinary subsequent sessions remain inactive.
- Package install and resource discovery in an isolated Pi configuration, plus the README's documented first-run and recovery flows.

### Test quality and safety

- A useful test would fail for a violated user-visible contract and survive a refactor behind the seam. Expected results come from approved behavior, not by recomputing the implementation's answer.
- Prefer behavior through public interfaces. Do not replace difficult integration facts with mocks that merely return the desired acknowledgment.
- Use disposable repositories, test-owned windows, isolated settings for package tests, and a disposable tracker fixture or controlled tracker adapter. Do not close real working issues, change the user's global compaction setting, or control unrelated sessions during tests.
- Exercise configured low thresholds for repeatable rotation trials rather than requiring every test to consume 150k tokens. Separately verify that the same policy uses real runtime telemetry.
- Runtime model tests are evidence of representative behavior, not proof that prompts alone enforce lifecycle constraints. Ownership, scheduling, acknowledgment, and cleanup checks must remain observable independently of model claims.
- The repository currently has skills, dictionary material, and agent documentation but no Legion implementation or automated test suite to extend. There is no existing in-repository test pattern to claim as prior art. The completed local Herdr probe provides integration evidence and a repeatable scenario, not an existing regression suite.

## Out of Scope

- Claude Code or other agent harnesses as Legati or Tribuni.
- Remote Herdr machines in the first version.
- Automatic merge into the primary branch, deployment, or release without separate authority.
- Mandatory spec/ticket creation for every small task.
- Legion-imposed numeric caps on concurrency, correction cycles, elapsed work time, or total spend.
- Hidden model selection, automatic provider/model fallback, or bypassing the configured machine `pi` command.
- Replacing upstream Matt skills, pstack, pi-subagents, or the normal Pi editor/footer.
- Global compaction-setting changes, unsupported internal monkey-patching, or replacement of the interactive Pi application with an SDK host solely to obtain a per-session setter.
- Transferring active Centuriones to a replacement Tribunus, forcing a handoff while children remain active, or claiming terminal idle proves the whole execution tree is finished.
- A guaranteed hard 150k token ceiling or a guarantee that a particular context size preserves model quality.
- Continuous autonomous orchestration while the Legatus process is absent; this version preserves work and resumes explicitly.
- Automatic branch deletion, destructive worktree cleanup without preservation evidence, or automatic publication of local operational records to Git.
- A universal context/compaction policy for every Centurio; their lifecycle remains governed by pi-subagents.
- Separate mobile/web dashboards, remote notifications, or a replacement issue-tracking system.

## Further Notes

### Confirmed investigation evidence

- A real local Herdr window ran Pi through the user's interactive shell function named `pi`, preserving its configured wrapper behavior. Herdr reported version 0.9.1 and Pi reported version 1.0.4 during that probe.
- `/skill:poteto-mode` enabled the mode. Two harmless turns showed approximately 9.4k and 9.5k context. Persisted assistant usage records were per request, not cumulative session spend.
- Selecting completed assistant text records from the actual session journal returned the user-facing answers without loading thinking or tool logs into the supervising conversation. This proves the local sample, not every message/error shape or a production event-delivery protocol.
- `/new` changed the session identity and reset the displayed context. Herdr returned `agent_prompt_stalled` even though the command took effect. Reconciliation is therefore required before retries.
- The test-owned window was closed and the repository remained unchanged. No remote-machine behavior was tested.
- Installed Pi declarations and implementation show that the SDK/RPC auto-compaction setter persists a global preference. The local compaction event exposes manual, threshold, and overflow reasons and supports cancellation. This establishes an available integration point, not proof of the full Legion compaction protocol.
- Installed Pi UI APIs support keyed status/widgets, custom on-demand panels, command argument completion, and UI updates without conversation messages. Installed pi-subagents uses its own widget keys. These facts support the proposed interface but do not constitute a completed UX trial.
- The built-in pi-subagents project-pane opener assembles a resolved executable invocation and does not guarantee use of the user's shell alias/function. Its availability is not evidence that it satisfies Legion's launch contract.

### Required implementation evidence

The first live probe did not validate a complete handoff with active Centuriones, durable recovery after process loss, manual-control arbitration, safe automatic worktree cleanup, or the local compaction hook under threshold and overflow conditions. These are mandatory implementation and acceptance tests, not optional follow-up work.

Installed versions supplied the investigation evidence, not a promise of compatibility with every Pi, Herdr, or extension release. The package must declare and test the compatibility it supports and diagnose incompatible installations before starting work.

The Emperor confirmed the design after grilling and subsequently approved the primary public test seam and its deterministic and real-runtime test modes. This spec records those decisions. Publishing it does not start implementation or authorize broader product scope. Ticket decomposition is a separate next step.


