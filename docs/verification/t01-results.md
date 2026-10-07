# Legion T01 verification result

This is a historical report. [The authorized remediation report](remediation-results.md) records the subsequent fixes and successful representative provider trial.

This report records the recovery implementation before the post-comment commit stage. [The post-comment report](pre-review-results.md) records the subsequent verifier correction and final checks.

## Result under review

T01 adds durable, explicitly enabled text intake for Pi users. It preserves original input, task scope, logical Legatus identity, and conversational decisions. It stops at intake. It launches no Tribunus and executes no admitted task.

The maintainer inherits one public `command`, `submit`, and `state` contract, a versioned `LegatusSnapshot`, SQLite transactions, and a separate lifetime ownership lock. The Pi adapter supplies provenance and presentation evidence. The model supplies typed interpretation proposals, not caller evidence.

The recovery writer inspected all four implementation files, the deterministic scenarios, the multiprocess tests, and both existing runtime scripts. Source, tests, package files, and existing runtime scripts matched the timeout backup byte-for-byte. Recovery added the opt-in provider verifier and completed documentation and evidence. It did not change application behavior.

The branch is `main`. HEAD is `f211b26b7556ea1ed869571fc74d9cb6cbd84434`. Nothing is committed or staged. The implementation manifest is [recovery-implementation.sha256](recovery-implementation.sha256). Its SHA-256 is `6628c09623e0a748efc4c867409870bbef92048fa9cf5dc29e7755af0e4453c0`. It covers package files, source, tests, scripts, README, and `.gitignore`.

## Fresh checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Passed. | [recovery-typecheck.txt](recovery-typecheck.txt) |
| `npm test` | Passed. All 17 tests passed with no skips. | [recovery-tests.txt](recovery-tests.txt) |
| `npm run build` | Passed. | [recovery-build.txt](recovery-build.txt) |
| `npm run verify:pi` | Passed. Real installed Pi RPC and PTY commands exercised 14 check groups and 24 controlled-provider requests. | [recovery-runtime.txt](recovery-runtime.txt) |
| `node --check scripts/verify-provider.mjs` | Passed. | [recovery-provider-syntax.txt](recovery-provider-syntax.txt) |
| Authorized selected-provider trial | NOT VERIFIED. The selected provider returned errors before proposing intake. | [recovery-provider.txt](recovery-provider.txt) and [public provider result](recovery-provider-result.json) |

The tested combination is Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22. This does not declare support for other versions.

The fresh real-runtime evidence directory is `/tmp/legion-pi-Fm9mb6`. Its `result.json` lists each check. Its `rpc.json` contains controlled-provider records, not live authentication. Its `tui.txt` contains the actual terminal output. I inspected the result and the rendered decision, recommendation, normal-answer instruction, diagnostics, completion, and off output. The check uses actual loaded pstack and pi-subagents and a native-discovered Herdr skill fixture. Herdr interaction is read-only local status. No pane or worker launch is claimed.

## Checked issue behavior

| Issue 2 behavior | Current evidence |
| --- | --- |
| Package discovery, default-off startup, unrelated sessions, unchanged selected model | Real isolated `pi install`, command discovery, repeated activation, and RPC model observations pass. |
| Activation versus task submission and retained intent | Public-seam tests preserve exact text, original new-task intent, logical identity, and reopened inactive records. |
| Status and doctor without a model turn or repair | Real RPC observations preserve provider-request count and an empty conversation branch, even with pending durable decisions. |
| Discoverable command arguments | Real PTY Tab completion exposes doctor and resume. |
| Prerequisite failures and tested compatibility | Controlled tests cover missing, unverified, and incompatible states for all ten prerequisites. Real checks cover installed-but-unloaded extensions, missing Herdr skill, and disabled Node SQLite. Only the observed combination is supported. |
| Direct intake without tickets or spec | Deterministic and controlled-provider runtime proposals admit scoped tasks. No external execution exists in T01. Representative selected-provider admission remains blocked. |
| Material ambiguity, escalations, and routine technical choices | Deterministic public-seam tests verify affected-work blocking, immutable protected amendments, revision checks, routine choices, and declined or approved decisions. |
| Persisted decisions and ordinary answers | Actual Pi chat entries display recommendations and affected work. Controlled-provider runtime checks resolve a product decision and an exact protected access amendment through ordinary RPC text. General-language quality remains unverified. |
| Independent work while blocked or busy | Deterministic eligibility tests and held real RPC runs preserve new input without steering or follow-up. Fresh dispatch follows settlement. |
| Ambiguous new-task versus correction | Public-seam tests resolve routing atomically for original input and answer. Stale source references and changed routing are rejected. |

The runtime checks also cover stale dispatch markers, a real busy race inside the extension input hook, visible-image rejection, slash-command-plus-image receipts, command-source limits, ordinary extension-origin input, late proposals after off, non-intake tool blocking after off, stalled-input resume, and fork isolation. Process-kill tests exercise exclusive ownership and large SQLite cache-spill writes before and after commit. Read-only status preserves database and hot-journal bytes. Explicit resume recovers under ownership.

## Representative-provider blocker

The authorized trial used only existing `openai-codex/gpt-6-astra` authentication in a disposable Pi test subject. It copied only Codex OAuth and the selected model's catalog into a mode-0700 test directory. It retained the configured thinking level and used no custom provider, model fallback, new login, or external implementation runner.

The first fixture selected only `legion_intake` at CLI startup and failed prerequisite readiness before any model work. The next fixture used normal loaded tools with Legion's interpretation guard. Prerequisites passed. The first harmless spelling task then settled without a tool call. A diagnostic repetition captured four assistant messages with `stopReason` equal to `error` and an HTML body beginning with `<html>`. Those are Pi's automatic provider attempts, not Legion intake retries. The observed error does not establish an HTTP status or a network root cause.

The direct input remains saved and pending. No task was admitted and no tool ran. The material-ambiguity and ordinary-answer checks were not reached. Testing stopped without a provider switch or an attempt to repair authentication. This is a provider failure, not evidence that the model understood or misunderstood the task.

The public result is copied into the repository. It contains harmless input, public state, prerequisite diagnostics, and sanitized error prefixes. It contains no model reasoning or complete provider responses. The test removed its agent directory, including authentication copies and Pi journals. All four original authentication and configuration files remained byte-identical. [recovery-auth.txt](recovery-auth.txt) records the final process and copy reconciliation. Empty runtime fixture auth files and unrelated grounding fixtures were left intact.

## TDD chronology and review

Nine early public-seam slices have recorded red-green evidence. The already-written integration slice has a narrow, explicitly approved retrospective sequencing exception. [tdd-exception.md](tdd-exception.md) and [integration-prevalidation.sha256](integration-prevalidation.sha256) preserve that fact. Later tests are not presented as preceding the integration code.

Later defect evidence includes routing authority, stale decisions, observation-only presentation, busy-race dispatch, command provenance, command attachment receipts, reserved syntax, and explicit stalled resume. The original `dispatch-race-red.txt` was a verifier TypeError. The actual product assertion failure is `dispatch-race-red-actual.txt`. The canonical [decision trail](t01-decisions.tsv) distinguishes those results.

This is the recovery writer's self-review, not independent acceptance. The parent owns comment review, Standards and Spec review, and the commit stage. No child committed, pushed, opened a PR, or changed a tracker issue during recovery.

## Residual risks

- Representative interpretation with the selected real provider remains NOT VERIFIED. Direct admission, material ambiguity, and a conversational answer must succeed before that evidence gap closes.
- The unchanged user installation still lacks a discoverable Herdr skill. The isolated fixture does not repair that installation.
- Pi 1.0.4 commands expose neither caller source nor attachments. Host commands are trusted in-process calls, not authenticated Emperor input. Every task-bearing command receipt limits its save to command text. Protected answers require subsequent ordinary interactive or RPC input with presentation evidence.
- Structural provenance and revision checks cannot prove semantic agreement. A model can misinterpret an answer. T01 records intake and authorizes no external execution.
- SQLite crash tests establish behavior on this local filesystem, not power-loss durability on every platform. Retained snapshot history grows with use.
- T01 does not implement spec execution, launch-path wrappers, cross-Legatus task claims, handoff, context policy, worker shutdown, manual takeover, tracker closure, or worktree cleanup. Intake resume is not factory reconciliation.
- Independent fresh-context review is still pending. The approved TDD exception must remain visible to those reviewers.
