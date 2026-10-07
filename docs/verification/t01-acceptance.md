# T01 acceptance

## Result

Issue [#2](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/2) is implemented through accepted intake. Pi users can explicitly activate Legion, inspect read-only diagnostics, save scoped tasks, and answer durable decisions in ordinary conversation. T01 does not execute tasks or launch Tribuni.

The tested and independently reviewed implementation is `4f44565252f87cbab9782a1e1d7af601d3d4f9c1`. The baseline is `f211b26b7556ea1ed869571fc74d9cb6cbd84434`. The commit adding this report changes verification documents only. It does not change the reviewed implementation. [The implementation manifest](lock-startup-implementation.sha256) still matches all 22 entries.

The parent inspected the source changes, checked the manifest, and reran verification after both final reviews. The initial parent runtime check at `a7ae698` caught a zero-owner lock-startup race despite earlier passing reviews. That failure was reproduced and fixed before this acceptance. [The causal report](lock-startup-results.md) preserves the failed hypotheses and measured results.

## Standards

Independent reviewer `openai-codex/gpt-6-astra` returned **OK with notes** at the tested implementation. It found no current P0, P1, or P2 defect and no actionable Fowler-baseline smell. [The complete Standards report](acceptance-standards.md) records its independent baseline reproduction, stress checks, and actual RPC/TUI inspection.

## Spec

Independent reviewer `openai-codex/gpt-6.1-sol` returned **OK with notes** at the same implementation. It rechecked all ten T01 acceptance criteria and found no current P0, P1, or P2 defect. [The complete Spec report](acceptance-spec.md) records its independent runtime and concurrency checks.

Each reviewer started in a fresh context and made no source changes. These are separate Standards and Spec verdicts, not a cross-family model review. Comment review found no remaining comments or suppression findings. No comments were deleted or restored, and no constraint encoding remains open.

## Parent verification

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | 48 tests passed. No failures or skips. | [Test output](acceptance-tests.txt) |
| `npm run typecheck` | Passed. | [Typecheck output](acceptance-typecheck.txt) |
| `npm run build` | Passed. | [Build output](acceptance-build.txt) |
| `npm run verify:pi` | 19 actual isolated RPC/TUI groups passed with 45 controlled-provider requests. | [Runtime output](acceptance-runtime.txt) |
| `sha256sum -c docs/verification/lock-startup-implementation.sha256` | All 22 entries matched. | [Manifest](lock-startup-implementation.sha256) |

The parent's actual runtime records are `/tmp/legion-pi-8Xt0F9/rpc.json` and `tui.txt`. Committed writer and reviewer evidence preserves the main behavioral checks if temporary records expire.

The selected-provider trial used `openai-codex/gpt-6-astra` and passed direct admission, material ambiguity, and a normal conversational answer. [Its public records](remediation-provider-result.json) show only `legion_intake` tool use, unchanged original settings/authentication, and removal of test credential copies. That trial evaluated `c0ecd1f`. Both final reviewers checked its continued relevance because later fixes did not change interpreter instructions, proposal/effect schemas, or submission semantics. Current real-runtime checks cover the changed commands and storage. The trial is representative evidence, not proof of arbitrary-language understanding.

## Design and execution choices

A single transactional snapshot retains original input, task revisions, decisions, and receipts. It avoids a general event-replay framework. Scoped immutable routes isolate discovery failures. Paired context/session and Legatus leases prevent competing owners. A single `BEGIN IMMEDIATE` reserves writer ownership without the schema and exclusive-promotion race.

One writer owned the checkout at a time. Competing designs and read-only reviews used separate artifacts. Grounding and design approval preceded implementation. Matt tests use the approved public command, submission, and observable-state seam. The canonical [decision trail](t01-decisions.tsv) records the actual chronology.

Model the Domain chose explicit lifecycle and ownership states. Separate Before Serializing Shared State kept unrelated identities independent and limited serialization to shared associations. Type System Discipline rejected unanswerable product-question shapes. Build the Lever produced rerunnable runtime and concurrency checks. Prove It Works required actual installed Pi behavior. Attack the Premise required measuring each lock actor rather than adding retries. Laziness Protocol reduced the final lock correction to one SQL statement.

## Attention

Reviewed by `openai-codex/gpt-6-astra` and `openai-codex/gpt-6.1-sol`.

- The inspected user configuration lacks a discoverable Herdr skill. The isolated fixture supplies one without changing user settings. Run `/legion doctor` before activation and configure missing resources explicitly.
- The adapter slice has an approved [retrospective TDD sequencing exception](tdd-exception.md). A corrected dispatch baseline was rerun after its first fix. Neither is presented as pristine red-first chronology.
- One earlier initialized-lock stress event remains unexplained because its actor records were not retained. The final collector preserves failures. Subsequent independent baseline comparisons and thousands of current-source trials passed. Finite stress does not establish universal liveness.
- Pi 1.0.4 exposes neither command caller provenance nor command attachments. Receipts say text only. Protected decision answers require subsequent ordinary input with presentation evidence.
- A forwarded host failure without a supported lifecycle event requires safe Pi restart. Malformed metadata requires investigation. Old unpublished storage has no automatic upgrade path.
- SIGKILL checks establish behavior on the tested local filesystem, not universal power-loss durability. Temporary evidence paths can expire.

No product decisions remain open within T01. Merge and deployment remain the user's decisions. The local branch retains the implementation commits. Publication uses a separate PR branch, not a push to primary. The Origin CLI is unavailable, so publication uses the repository's documented `gh` CLI.
