# Legion T01

Legion adds explicitly enabled, durable text intake to Pi. It records scoped tasks and Emperor decisions. It does not execute tasks, create tickets, launch Tribuni, merge, deploy, rotate sessions, or manage worker shutdown.

## Install and enable intake

1. In a local checkout, run `npm ci --ignore-scripts` before `pi install /path/to/this/repository`.
2. Open Pi in the working repository.
3. Run `/legion doctor`. Resolve each missing or unverified prerequisite through your normal configuration.
4. Run `/legion on`, or submit task text with `/legion Fix the label spelling`.

Installation and startup remain inactive. Activation retains your selected model, reasoning level, tools, compaction settings, and other extensions. Interpretation uses the selected model. No provider credentials are needed for status or doctor.

The tested runtime combination is Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22. Other versions remain unverified. Loaded resources must include the Herdr skill, pstack's `poteto-mode`, the pi-subagents root tool, `matt-tdd`, `implement`, and `code-review`. Files or installed packages alone do not establish that an extension loaded. Legion does not substitute pstack's `tdd` or `teach` for Matt's renamed resources.

The inspected user installation lacks a discoverable Herdr skill. The verification fixture supplies that skill through native discovery in an isolated configuration. Its pass does not make the unchanged user installation ready. Legion never installs prerequisites or rewrites upstream resources.

## Command reference

Tab completion exposes these arguments.

| Command | Behavior |
| --- | --- |
| `/legion` or `/legion on` | Enable intake without a task. Repeated activation retains identity. |
| `/legion <text>` | Enable intake and save an explicit new task. |
| `/legion task <text>` | Submit task text that starts with a reserved argument name. |
| `/legion status [id]` | Observe records without a model turn, ownership claim, or repair. An explicit ID works without the original Pi conversation. |
| `/legion doctor` | Report read-only prerequisite observations. No model turn or repair. |
| `/legion off` | Revoke intake authority immediately and preserve records. No worker draining is implemented. |
| `/legion resume <id>` | Explicitly reopen intake under exclusive ownership. Reconcile interrupted storage if needed, then retry pending interpretation once. No factory reconciliation or execution is implemented. |

A task-bearing command with failed prerequisites saves its text when storage is available, reports "Saved, not admitted," and remains inactive. A storage failure cannot issue a successful receipt.

Pi 1.0.4 does not expose attachment metadata to slash-command handlers. Every task-bearing command receipt explicitly says it saved command text only and did not capture attachments. Do not attach images to task-bearing commands. Ordinary active input with visible images is rejected before a success receipt. Restate the needed information as text.

## Intake and decisions

While active, ordinary interactive or RPC text is saved before interpretation. An explicit task command means new work. Ordinary messages start unclassified. The model can identify clear new work, ask whether a message is a new task or correction, record an in-scope technical choice, or ask a product question. A confirmed routing choice cannot silently change another assignment.

Questions persist with their recommendation and affected work. They appear in chat without a modal dialog only while intake is active. Off preserves pending decisions without republishing unactionable questions. Explicit resume retains or presents the current question before an ordinary answer. Answer normally, such as "Use French, please." Protected changes require the exact proposed requirements, financial, access, or irreversible-action amendment to appear before your answer. Approval records only that immutable amendment. It is not execution permission. Ambiguous answers produce another question. Stale task revisions require a fresh decision revision and presentation. Only affected tasks are blocked.

Independent input remains admissible while another task is blocked or Pi is busy. Busy input stays in the durable pending set, not the normal steering or follow-up queue. Interpretation starts only in a fresh settled run. It can call only `legion_intake`, including after off until that run settles. Reads, shell commands, writes, and subagents are blocked in that interpretation run. Unrelated turns already running before activation retain their normal permissions.

A dispatched prompt is not a successful interpretation. Legion checks authentication before forwarding it. A known local authentication failure leaves the original sources pending and allows an explicit resume after authentication is restored. Resume cannot replace a check still in progress or a genuinely started run. Once Legion forwards a prompt, Pi can report a later pre-start failure outside the supported extension hooks. If that delivery never starts or settles, restart Pi before explicitly resuming the saved Legatus. Idle status alone does not prove delivery ended. There is no autonomous retry loop. Pi can defer TUI input during compaction before Legion sees it. No receipt is promised before interception. Built-in commands and user shell commands are outside ordinary text interception.

## Task entry and later factory workflows

T01 accepts direct tasks without creating a spec or tickets. A spec reference can be saved as task text, but T01 does not discover its tickets or run `implement-spec`. Spec execution belongs to a later slice.

`/new`, clearing, and reopening Pi leave intake inactive. Use `/legion status <id>` to inspect preserved records, then `/legion resume <id>` to recover intake explicitly. Planned same-window handoff, context rotation, worker draining, manual takeover, issue closure, and worktree cleanup are not implemented. Do not treat intake resume as proof that those factory recovery checks ran.

## Authority and recovery limits

The public module has three operations, `command`, `submit`, and `state`. Deterministic scenarios and the real Pi adapter use these same operations. The model-facing tool accepts only a proposal. The adapter supplies immutable run, session, generation, permitted-source, and presentation evidence. Model arguments cannot supply caller evidence or replacement Emperor text.

Pi extensions are trusted in-process code with filesystem access. Legion is not a sandbox against a malicious loaded extension. Pi 1.0.4 executes registered slash commands before its input hook and exposes no command-source field. Command records therefore say `host-command` and `source-unavailable`, not authenticated Emperor provenance. Another trusted extension can invoke a slash command. Such a command cannot itself answer an Emperor decision. Decision answers require a subsequent ordinary interactive or RPC input event. Ordinary extension-origin input cannot become an Emperor submission or answer.

Presentation evidence uses already appended, displayed decision messages on the active Pi branch. A message merely queued for later display is not evidence. This establishes what the host presented, not proof that a human read it. The model can still misunderstand a conversational answer. The runtime checks provenance, revisions, permitted effects, and exact amendment identity. It cannot prove arbitrary language meaning. T01 performs no external execution.

Snapshots live under `<Pi agent directory>/legion`, not in Git or only in the Pi journal. SQLite uses rollback journaling and `synchronous=FULL`. A separate lifetime lock prevents competing owners. No PID or elapsed-time lock stealing occurs. Restart, session replacement, and fork remain inactive. Explicit resume retains the logical Legatus ID and advances its ownership generation.

A receipt follows commit. An uncertain result includes its request key and reconciliation guidance. Observe status and the receipt before resuming or retransmitting. Status never repairs a hot journal. Explicit resume can recover it under exclusive ownership. The same request key and payload reconciles a committed result through the public module. Equal text submitted with two different keys is two submissions. Pi input has no stable transport delivery ID, so blind client retransmission is not exactly-once.

## Verify the package

Install developer dependencies with `npm ci --ignore-scripts`. Run these checks.

```sh
npm test
npm run typecheck
npm run build
npm run verify:pi
```

The runtime check requires `pi`, `herdr`, Python 3 with PTY support, and an already running local Herdr server. It uses a disposable repository, isolated HOME and Pi directories, and a controlled loopback provider with no inherited credentials. It reads local Herdr status and never controls unrelated panes. Set `PI_TEST_PSTACK` and `PI_TEST_SUBAGENTS` if their installed package paths differ from the standard Pi npm directory. The check prints its evidence directory and preserves concise RPC and terminal logs there.

The controlled provider verifies runtime plumbing. The corrected authorized `openai-codex/gpt-6-astra` trial passed direct admission, material ambiguity, and an ordinary conversational answer through public records and eligibility. It used the existing configured proxy with Node's test-only `--use-env-proxy` switch. The earlier failed trial remains historical evidence. This representative sample does not prove universal language correctness. No alternative model or runner was used.

With explicit permission to use existing test authentication, run the separate trial as follows.

```sh
LEGION_PROVIDER_TRIAL=authorized node scripts/verify-provider.mjs
```

The trial requires Node's supported `--use-env-proxy` switch, that exact configured model, and an unexpired OAuth credential outside Pi's refresh window. Only the ephemeral test subject receives that switch and existing `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` values. It does not inherit unrelated environment or translate `NIX_SSL_CERT_FILE` into a different TLS setting. It copies only that provider's authentication and selected-model catalog into a private disposable directory. It preserves original files, removes test authentication and Pi journals afterward, and retains public state and sanitized errors. It never signs in, purchases access, changes the real settings, or falls back to another model. Test deadlines are not Legion factory caps.

Process-kill tests cover SQLite cache-spill writes, acknowledgments, competing ownership, and read-only preservation on this local filesystem. They do not prove power-loss durability on other filesystems.

The canonical decision trail is [t01-decisions.tsv](docs/verification/t01-decisions.tsv). [The remediation report](docs/verification/remediation-results.md) identifies the latest checked files and residual risks. [The earlier verification report](docs/verification/t01-results.md) preserves the recovery history. The adapter slice has an explicitly approved retrospective TDD sequencing exception. Earlier public-seam slices and later defect fixes retain their actual red-green evidence. Independent review belongs to the parent session.
