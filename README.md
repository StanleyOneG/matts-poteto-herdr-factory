# Legion intake, task reservations, and local Tribuni

Legion adds explicitly enabled, durable intake, isolated Git workspaces, and bounded local interactive Pi Tribuni. It records scoped tasks, Emperor decisions, exclusive task reservations, and explicit worker launch attempts. It does not create tickets, merge, deploy, rotate sessions, accept work, or manage worker shutdown.

## Install and enable intake

1. In a local checkout, run `npm ci --ignore-scripts` before `pi install /path/to/this/repository`.
2. Open Pi in the working repository.
3. Run `/legion doctor`. Resolve each missing or unverified prerequisite through your normal configuration.
4. Run `/legion on`, or submit task text with `/legion Fix the label spelling`.

Installation and startup remain inactive. Activation retains your selected model, reasoning level, tools, compaction settings, and other extensions. Interpretation uses the selected model. No provider credentials are needed for status or doctor.

The tested runtime combination is Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22. Other versions remain unverified. Loaded resources must include the Herdr skill, pstack's `poteto-mode`, the pi-subagents root tool, `matt-tdd`, `implement`, and `code-review`. Files or installed packages alone do not establish that an extension loaded. Legion does not substitute pstack's `tdd` or `teach` for Matt's renamed resources.

The package bundles the unmodified official Herdr skill from v0.9.3 through native Pi discovery. [Its attribution](skills/herdr/ATTRIBUTION.md) records the source and hash. Package filters or a same-name user skill can change discovery, so run `/legion doctor` before activation. Legion does not install other prerequisites or change user settings.

Maintainers manually replace the bundled skill and its license and update the attribution and verification hashes when updating the extension. There are no automatic upstream checks or skill updates.

## Command reference

Tab completion exposes these arguments.

| Command                                                                                           | Behavior                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/legion` or `/legion on`                                                                         | Enable intake without a task. Repeated activation retains identity.                                                                                                                      |
| `/legion <text>`                                                                                  | Enable intake and save an explicit new task.                                                                                                                                             |
| `/legion task <text>`                                                                             | Submit task text that starts with a reserved argument name.                                                                                                                              |
| `/legion status [id]`                                                                             | Observe records without a model turn, ownership claim, or repair. An explicit ID works without the original Pi conversation.                                                             |
| `/legion doctor`                                                                                  | Report read-only prerequisite observations. No model turn or repair.                                                                                                                     |
| `/legion off`                                                                                     | Revoke dispatch authority immediately. Show stopping while a local invocation is unsettled or a managed launch remains retained. Retain claims, attempts, and work. No worker draining is implemented. |
| `/legion resume <id>`                                                                             | Explicitly reopen intake under exclusive ownership in its original working context. Recover known interrupted metadata publication. Never create or adopt Git resources.                 |
| `/legion reserve <task-id>@<revision> --parent <refs/heads/branch> [--source <GitHub issue URL>]` | Record the exact authorized workspace request. Defer guarded execution without claiming the task yet.                                                                                    |
| `/legion reconcile <task-id>`                                                                     | Record an explicit request to inspect and, only with sufficient durable evidence, continue the original plan.                                                                            |
| `/legion workspace <request-id>`                                                                  | Start a separate correlated model turn for the recorded request through the guarded workspace tool. Never launch a worker.                                                               |
| `/legion launch <task-id>@<revision>`                                                              | Explicitly launch or reconcile the one local Pi Tribunus for a verified owned ready claim. Initialize natively before bounded assignment. |

Reserved arguments accept extra separator whitespace without changing their meaning. Status and doctor remain observation-only. Direct task text remains verbatim. For `task`, one separator after the keyword is structural; further whitespace belongs to the saved payload. Pi 1.0.4 splits slash commands at an ASCII space. Use a space after `/legion`; tabs are supported in the remaining arguments.

A task-bearing command with failed prerequisites saves its text when storage is available, reports "Saved, not admitted," and remains inactive. A storage failure cannot issue a successful receipt.

Pi 1.0.4 does not expose attachment metadata to slash-command handlers. Every task-bearing command receipt explicitly says it saved command text only and did not capture attachments. Do not attach images to task-bearing commands. Ordinary active input with visible images is rejected before a success receipt. Restate the needed information as text.

## Intake and decisions

While active, ordinary interactive or RPC text is saved before interpretation. An explicit task command means new work. Ordinary messages start unclassified. The model can identify clear new work, ask whether a message is a new task or correction, record an in-scope technical choice, or ask a product question. A confirmed routing choice cannot silently change another assignment.

Questions persist with their recommendation and affected work. They appear in chat without a modal dialog only while intake is active. Off preserves pending decisions without republishing unactionable questions. Explicit resume retains or presents the current question before an ordinary answer. Answer normally, such as "Use French, please." Protected changes require the exact proposed requirements, financial, access, or irreversible-action amendment to appear before your answer. Approval records only that immutable amendment. It is not execution permission. Ambiguous answers produce another question. Stale task revisions require a fresh decision revision and presentation. Only affected tasks are blocked.

Independent input remains admissible while another task is blocked or Pi is busy. Busy input stays in the durable pending set, not the normal steering or follow-up queue. Interpretation starts only in a fresh settled run. It can call only `legion_intake`, including after off until that run settles. Reads, shell commands, writes, and subagents are blocked in that interpretation run. Unrelated turns already running before activation retain their normal permissions.

A dispatched prompt is not a successful interpretation. Legion checks authentication before forwarding it. A known local authentication failure leaves the original sources pending and allows an explicit resume after authentication is restored. Resume cannot replace a check still in progress or a genuinely started run. Once Legion forwards a prompt, Pi can report a later pre-start failure outside the supported extension hooks. If that delivery never starts or settles, restart Pi before explicitly resuming the saved Legatus. Idle status alone does not prove delivery ended. There is no autonomous retry loop. Pi can defer TUI input during compaction before Legion sees it. No receipt is promised before interception. Built-in commands and user shell commands are outside ordinary text interception.

## Reserve an approved task

1. Use `/legion status` to find the admitted task's ID and exact revision. Resolve its affected open decisions first.
2. Run `/legion reserve <task-id>@<revision> --parent refs/heads/<intended-parent>`. To contend for the same external assignment across different Legati, also supply `--source https://github.com/<owner>/<repo>/issues/<number>`.
3. Copy the returned `/legion workspace <request-id>` command. Run it after intake interpretation settles.
4. Inspect the English result and `/legion status` before working in the planned path.

The first command reports "Workspace request recorded. Task NOT YET RESERVED by this request. Guarded execution required." It is a durable pending request, not a claim. The workspace stage resolves the repository and parent, commits the reservation, and prepares its branch and worktree. A successful result says "Task reserved. Workspace ready. No worker started." A foreign-owner result identifies the reservation and owning Legatus.

Reservation commands never schedule an intake interpretation turn. Ordinary active messages still enter intake. The separate workspace stage accepts only the exact correlated `legion_workspace` call. That tool receives only the pending request ID. Its live Pi tool context executes necessary Git calls through `ctx.executeTool("bash", ...)`, so installed tool hooks and bash overrides remain effective. There is no direct child-process fallback. Missing or suppressed completion evidence cannot establish readiness. A permission refusal retains any committed reservation and reports the blocker.

Use a full local branch ref for the intended parent. Legion does not infer `HEAD`, a remote default, or a detached commit. The reservation pins the resolved commit. A later parent advance or deletion does not retarget the workspace. The result distinguishes the stored parent pin from its current guarded observation. Outside a live guarded stage, current Git observation is unavailable. Status shows retained evidence, not a cleanliness guarantee.

Direct work uses its original intake TaskId. Separate direct submissions remain separate tasks. Supported external identities are canonical GitHub issue URLs. Owner and repository names are case-normalized. Unsupported formats fail closed. No remote ticket discovery or mutation occurs. A local task cannot change its shared identity, and another local task under the same Legatus cannot substitute for an existing binding.

The ledger lives at `<canonical Git common directory>/legion/assignments.sqlite`. Primary checkouts, linked worktrees, nested paths, and symlink aliases share it. Independent clones do not. New workspaces live under `<project-parent>/worktrees-<project-name>_legion/<unique-task-or-run>`, outside all worktrees. Legion derives the project from the canonical primary Git checkout, including when launched from a linked worktree. The container is created if absent and existing contents are preserved. For this repository it is `/workspaces/astraprojects/worktrees-matts-poteto-herdr-factory_legion/`. Previously reserved paths remain pinned; the new convention does not move or delete existing work. The absolute branch, path, parent, and commit remain fixed in the reservation. Preexisting branches, directories, symlinks, or registered worktrees are collisions, not adoption evidence.

## Recover a workspace request

After restart, Legion is inactive. Inspect `/legion status`, explicitly resume the saved Legatus in its original context, and issue a fresh `reserve` or `reconcile` request. Pending requests remain visible, but their old generation and epoch do not authorize execution. Off revokes pending authorization immediately. Repeated off, early on, or early resume cannot bypass a local invocation that is still stopping. Unreadable intake storage reports its error without hiding the known stopping state.

An exact committed request replay returns its immutable receipt and the retained workspace view. It performs no Git effect and does not resolve the parent again. A changed payload under the same key rejects. Replay is not renewed execution authority. Use a fresh explicit reconciliation to inspect the original plan. Dirty ready workspaces and later commits are retained. Missing, moved, or mismatched ready workspaces remain held without repair or recreation.

A durable dispatch without definitive completion remains unknown even if its branch or path is absent or looks correct. The result names the operation, branch, and path and says "No retry was performed." Preserve those resources. Inspection, process death, released locks, and matching commits do not authorize adoption, deletion, takeover, or retry. T02 has no automated resolution for missing completion evidence. Such a reservation can remain blocked indefinitely.

Concurrent shared-ledger writes can report unavailable authority with `database is locked` instead of an immediate owner result. The exact pending request remains saved. Inspect the saved Legatus with `/legion status <id>`. After its local invocation settles, explicitly resume if inactive and issue a fresh `reserve` with the original task revision, parent, and source. If status shows an existing local binding, a fresh `reconcile` can inspect it. The returned diagnostic includes the exact follow-up command. Legion adds no automatic waiting or retry loop. A busy contender can resolve to the existing owner's blocker after explicit recovery.

A definitive failure can be retried through explicit reconciliation only when inspection proves that the failed step had no effect. Earlier successful operation evidence remains in the ledger. Missing, corrupt, or unsupported initialized history is unavailable authority, never an unreserved task or permission to initialize empty history. Status and doctor do not allocate claims, repair SQLite, mutate Git, or activate Legion. Explicit resume can finish a recognized interrupted initialization publication but cannot invent missing history.

## Launch a bounded local Pi Tribunus

1. Reserve an admitted task and verify that its workspace is ready.
2. After interpretation settles, run `/legion launch <task-id>@<revision>`.
3. Inspect the launch result and `/legion status`. A new worker uses your normal configured shell and Pi defaults, in a new no-focus tab in the verified owning Legatus's existing Herdr workspace. Additional interactive Pi sessions belong in panes of that Tribunus's tab; native pi-subagents children need no pane. This layout is separate from Git worktree isolation.
4. If Pi presents its standard project-trust prompt, review the exact owned folder and its resources yourself. Project proximity and fixture approval are not trust authorization. Legion preserves the cwd/tab/pane, reports the pending human decision, and never answers trust or approval prompts.
5. After that prerequisite is resolved, explicitly run the same launch command to reconcile the same attempt. Never start another worker to resolve uncertainty.

The guarded `legion_launch` root tool accepts only the saved request ID. It rechecks active authority, exact task revision and scope, durable claim ownership, and Git associations before host effects. Herdr commands use the installed guarded Bash tool without a direct child-process fallback. Each ready claim has one durable launch attempt. Unknown or applied startup retains the attempt, window, worktree, and claim. Missing completion, stale identity, missing resources, or unsupported worker evidence withholds the next stage.

The worker owns a private generation-bound endpoint and immutable command receipts. A received command alone does not prove application. Before assignment, Legion verifies actual Pi session identity, working directory, loaded prerequisites, native `/skill:poteto-mode` expansion, a fresh enabled pstack entry, and successful initialization settlement. The public view contains an expansion digest and journal references, not the full initialization prompt.

One bounded assignment names the approved task revision, immutable scope, goal, acceptance, workflow, and test contract. It authorizes implementation only. It does not authorize scheduling the spec, delegation outside that assignment, integration, acceptance, or closure. A bounded worker report becomes visible as `reported` in public status. A report is not accepted work. Stale-generation reports cannot replace current evidence. Unreadable report evidence retains the assignment as held.

Restart and reload remain inactive. Explicit resume retains the owner, but never grants permission to repeat an unknown start. `off` stops new dispatch and retains unresolved stages. It does not terminate, drain, or replace a worker. Worker identity and resource evidence are local observations, not authentication of a human or protection against malicious trusted extensions. Launch adds no automatic retry, contention recovery, or Legion runtime cap.

The launch ledger is additive history inside `assignments.sqlite`. Recognized pre-launch ledgers gain a version-2 schema marker and `tribuni` table without changing repository identity or existing ownership. Missing known launch history remains unavailable authority. Private worker bootstrap, capability, endpoint, intent, and receipt files live under `<Pi agent directory>/legion/tribuni/<attempt-id>`. Preserve them when an outcome is uncertain. Status does not repair them.

## Read-only Centurio boundary (bounded T04 work)

Owned exploration/review Centuriones follow configured pstack role models. Mandatory native startup checks actual model/session/cwd and current ownership. Admitted `read`, `grep`, `find`, and `ls` effects execute retained native definitions only after ordinary root/child permission hooks, with unchanged final arguments and a fresh owner check. Existing non-native overrides cause explicit compatibility refusal; Legion does not replace them silently. Unknown ownership and incompatible model or tool changes deny effects.

This supports compatible trusted extensions, not a sandbox against arbitrary in-process code or a continuous veto of provider requests. Known incompatible model switching, including supported `setModel`, blocks affected work when detected at startup or effects; no fallback model is selected. Throwing from Pi 1.0.4's `before_agent_start` or `before_provider_request` is not a request veto. Native permission policies and provider restrictions remain effective.

Disposable live fixtures also use unique owned directories in the project sibling container, never copies of the dirty parent checkout. Running historical trials remain preserved in place. A trust prompt requires immediate operator notification with exact cwd/tab/pane; affected validation remains pending until the human resolves ordinary Pi trust. Do not relocate a fixture, suppress discovery, or change Git isolation to avoid it.

The [stage evidence](docs/verification/t04-owned-centuriones/read-only-effects/results.md) records that stage's verification limits; it is not overall #5 acceptance.

## Legatus preparatory research (bounded T04 work)

After explicit `/legion on`, request `/legion research <bounded task>` (for example, `/legion research Find the public status API and recommend its test seam with file references`). The command persists the exact task and dispatches a correlated research-only principal stage. Its model-only `legion_research` tool is usable only in that stage with a bounded read-only task and configured `how explorer` or `why investigators` role (optional `modelIndex`). The tool returns one exact native async `subagent` launch input. Launch that input unchanged; arbitrary child launches cannot adopt the research intent. Preparation alone is not a launched child. Intake, workspace and engineering dispatches remain separate bounded stages.

Research reuses the same pi-subagents runtime and mandatory guard. The principal retains its selected model; children resolve the existing pstack exploration role configuration without hidden fallback. Each durable record names the logical Legatus, actual session/generation/authority epoch, intent, native run and child session. `/legion status` exposes lifecycle, a bounded finding preview, source/hash and evidence references, not raw thinking or tool logs. Native logical completion and independently observed runner termination remain distinct; failed terminal children remain failed, not accepted work.

`/legion off` prevents preparation and launch, permits already-authorized read-only research to finish, and visibly stays stopping while children are active or unresolved. Supported Pi new/resume, fork and tree transitions are cancelled while such children remain, rather than abandoning their owning runtime. Unexpected shutdown cannot be cancelled: retained records remain visibly unresolved after restart and cannot be adopted by a new generation. This slice does not implement rotation, recovery, successor startup or task-graph orchestration. Unknown/mismatched native activity remains held. Native permission denial is preserved; startup/effect checks are not universal hostile-extension protection. Overall #5 acceptance still requires the remaining integrated evidence and independent review.

## Task entry and later factory workflows

Intake accepts direct tasks without creating a spec or tickets. A spec reference can be saved as task text, but T01 does not discover its tickets or run `implement-spec`. Spec execution belongs to a later slice.

`/new`, clearing, and reopening Pi leave intake inactive. Use `/legion status <id>` to inspect preserved records, then `/legion resume <id>` to recover intake explicitly. Planned same-window handoff, context rotation, worker draining, manual takeover, issue closure, and worktree cleanup are not implemented. Do not treat intake resume as proof that those factory recovery checks ran.

## Authority and recovery limits

The public module has three operations, `command`, `submit`, and `state`. Deterministic scenarios and the real Pi adapter use these same operations. The intake tool accepts only a proposal. The workspace and launch tools accept only a correlated pending request ID. The adapter supplies immutable run, session, generation, permitted-source, and presentation evidence. Model arguments cannot supply caller evidence or replacement Emperor text.

Pi extensions are trusted in-process code with filesystem access. Legion is not a sandbox against a malicious loaded extension. Pi 1.0.4 executes registered slash commands before its input hook and exposes no command-source field. Command records therefore say `host-command` and `source-unavailable`, not authenticated Emperor provenance. Another trusted extension can invoke a slash command. Such a command cannot itself answer an Emperor decision. Decision answers require a subsequent ordinary interactive or RPC input event. Ordinary extension-origin input cannot become an Emperor submission or answer.

Presentation evidence uses already appended, displayed decision messages on the active Pi branch. A message merely queued for later display is not evidence. This establishes what the host presented, not proof that a human read it. The model can still misunderstand a conversational answer. The runtime checks provenance, revisions, permitted effects, and exact amendment identity. It cannot prove arbitrary language meaning. Intake interpretation performs no external execution. Only a separately authorized workspace stage can prepare Git resources. Only an explicit guarded launch stage can create a local worker and deliver a bounded assignment.

Snapshots live under `<Pi agent directory>/legion`, not in Git or only in the Pi journal. The current storage layout uses `v1.` filenames, one SQLite snapshot and lifetime lock per Legatus, immutable context/session routing records, and initialization evidence. Discovery selects the relevant routing filenames before opening a snapshot. A damaged Legatus does not block unrelated contexts or independent sessions. A matching damaged record remains unavailable until explicit recovery. An alias route is only a candidate; it does not grant an attachment or active authority.

Creation publishes its identity before committing an empty bootstrap snapshot and durable initialization evidence. Task records and receipts follow that initialization. Explicit recovery can finish a recognized interrupted creation without replacing its Legatus ID. It never invents task text that did not commit. Inspect status before resubmitting an unacknowledged input. Malformed or incomplete identity metadata fails closed and requires operator investigation. An initialized snapshot with missing or corrupt data cannot be reset as a new creation.

The earlier unpublished development layout is not automatically upgraded. Its files remain untouched and explicit access reports unsupported layout. Do not treat current-format discovery as migration of old records.

SQLite uses rollback journaling and `synchronous=FULL`. An active binding holds two lifetime leases. The context/session association lease is acquired before discovery, selection, or allocation. The per-Legatus lease protects the aggregate. Concurrent actors with the same context/session cannot activate different Legati, including through explicit resume. Off retains both leases until a locally started Git invocation and its outcome handling settle. Revocation then releases the Legatus lease before the association lease. Process death releases intake leases through SQLite's kernel-backed locking. It does not release a task reservation or prove a dispatched Git child ended. Independent contexts and different sessions remain separate. A rejected intake-association contender has no saved activation receipt. Assignment contention instead retains its durable binding and ownership result. Read-only commands acquire neither lease.

The association lease file is scoped to the context/session hashes and contains no mutable identity registry. Existing immutable routing and initialized aggregate data remain authoritative. Historical multiple candidate routes still require explicit identity selection.

Lease acquisition uses one `BEGIN IMMEDIATE` SQLite writer reservation. Lease files contain no authoritative owner table. Readers do not gain ownership. Competing writers fail closed without a retry loop. SQLite setup and shared-to-exclusive promotion are not part of lease startup. The aggregate still uses rollback journaling and `synchronous=FULL` for durable records.

A mutating activation attempt may reconcile its association lease's own crash journal. If matching identity metadata is malformed, routes, initialization evidence, aggregate files and journals, and receipts remain untouched. Status and doctor preserve every file and byte, including operational journals.

The lifetime leases prevent competing owners. No PID or elapsed-time lock stealing occurs. Restart, session replacement, and fork remain inactive. Explicit resume retains the logical Legatus ID and advances its ownership generation.

A receipt follows commit. An uncertain result includes its request key and reconciliation guidance. Observe status and the receipt before resuming or retransmitting. Status never repairs a hot journal. Explicit resume can recover it under exclusive ownership. The same request key and payload reconciles a committed result through the public module. Equal text submitted with two different keys is two submissions. Pi input has no stable transport delivery ID, so blind client retransmission is not exactly-once.

## Verify the package

Install developer dependencies with `npm ci --ignore-scripts`. Run these checks.

```sh
npm test
npm run typecheck
npm run build
npm run verify:pi
node --import tsx scripts/verify-workspace.mjs /tmp/legion-workspace-evidence.json
```

The runtime check requires npm, `pi`, `herdr`, Python 3 with PTY support, and an already running local Herdr server. It packs and installs the npm tarball in a disposable directory, checks the bundled skill and license hashes, and verifies package-native skill discovery. npm can fetch package dependencies during this test. The check uses a disposable repository, isolated HOME and Pi directories, and a controlled loopback provider with no inherited credentials. It reads local Herdr status and never controls unrelated panes. Set `PI_TEST_PSTACK` and `PI_TEST_SUBAGENTS` if their installed package paths differ from the standard Pi npm directory. The check prints its evidence directory and preserves concise RPC and terminal logs there.

The controlled provider verifies runtime plumbing. The corrected authorized `openai-codex/gpt-6-astra` trial passed direct admission, material ambiguity, and an ordinary conversational answer through public records and eligibility. It used the existing configured proxy with Node's test-only `--use-env-proxy` switch. The earlier failed trial remains historical evidence. This representative sample does not prove universal language correctness. No alternative model or runner was used.

With explicit permission to use existing test authentication, run the separate trial as follows.

```sh
LEGION_PROVIDER_TRIAL=authorized node scripts/verify-provider.mjs
```

The trial requires Node's supported `--use-env-proxy` switch, that exact configured model, and an unexpired OAuth credential outside Pi's refresh window. Only the ephemeral test subject receives that switch and existing `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` values. It does not inherit unrelated environment or translate `NIX_SSL_CERT_FILE` into a different TLS setting. It copies only that provider's authentication and selected-model catalog into a private disposable directory. It preserves original files, removes test authentication and Pi journals afterward, and retains public state and sanitized errors. It never signs in, purchases access, changes the real settings, or falls back to another model. Test deadlines are not Legion factory caps.

Process-kill tests cover SQLite cache-spill writes, acknowledgments, competing ownership, and read-only preservation on this local filesystem. They do not prove power-loss durability on other filesystems.

The canonical decision trail is [t01-decisions.tsv](docs/verification/t01-decisions.tsv). [The lock startup report](docs/verification/lock-startup-results.md) identifies the latest checked files, causal probes, and residual risks. [The preceding association report](docs/verification/association-results.md) preserves its result identity. [The preceding final corrections report](docs/verification/final-fixes-results.md) preserves its result identity. [The preceding remediation report](docs/verification/remediation-results.md) preserves its result identity and representative-provider evidence. [The earlier verification report](docs/verification/t01-results.md) preserves the recovery history. The adapter slice has an explicitly approved retrospective TDD sequencing exception. Earlier public-seam slices and later defect fixes retain their actual red-green evidence. Independent review belongs to the parent session.

The T02 workspace check uses installed pstack and pi-subagents packages, native skills, an isolated Pi profile, a loopback controlled provider, and the real nested tool path. It verifies command discovery, default-off, explicit resume, deferred reservation, ready workspaces, installed hook denial, root-tool refusal, and stopping. It does not test worker launch or Herdr executor lifecycle. [The T02 verification report](docs/verification/t02-results.md) identifies the tested source files, commands, red-green evidence, and remaining limits.

The T03 local Tribunus check uses the normal configured shell, actual interactive Pi, native initialization, one bounded assignment, and public reporting. Its one applied-start/lost-receipt trial preserves the successful original before making completion unavailable to the consumer. [The T03 verification report](docs/verification/t03-local-tribunus/results.md) includes repeatable observation commands, exact source identities, the twelve finite TDD exceptions, the baseline contention caveat, and retained test-owned actors. It does not authorize another launch or acceptance.
