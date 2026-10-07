# T01 authorized remediation

## Result

Pi users can retry a known pre-delivery authentication failure without losing saved text. Pending questions remain durable through off and become actionable on resume without inactive duplicates. Invalid product questions with no affected task cannot consume their source input.

Maintainers receive schema-derived valid clarification shapes and an explicit adapter lifecycle. Authentication checking, known failure, forwarded delivery, prepared interpretation, and agent start have different retry rules. No new public seam or task execution was added.

This changes reviewed baseline `36fc866f236e5125e711ad5856526365909e48d9` on `main`. The commit adding this report identifies the final result. `git log -1 --format=%H -- docs/verification/remediation-results.md` resolves that identity. [The implementation manifest](remediation-implementation.sha256) binds the tested source, package, tests, scripts, and README. The external remediation handoff contains the final commit SHA.

## Authorized scope and lifecycle

The parent accepted the three reported correctness defects and authorized investigating the provider fixture. It subsequently authorized test-only `NODE_OPTIONS=--use-env-proxy` and a narrow red-first authentication race fix.

`ProposalSchema` distinguishes routing clarification from product clarification. Routing may have no affected tasks. A product clarification has a nonempty affected-task tuple. `new-task.questions` still binds questions to an allocated task. Invalid proposals reject before persistence and leave the original pending.

A matched dispatch checks authentication through supported `modelRegistry.getApiKeyAndHeaders`. Resume never retires a check in progress. A failed local check consumes the marker before forwarding, preserves the input, and permits an explicit retry. Off during checking invalidates the local attempt. Completion of that check cannot forward the revoked marker. A busy race after the asynchronous check consumes and defers the marker until a fresh settled run.

After forwarding, neither an idle flag nor an uncorrelated error releases correlation. Matching `before_agent_start` prepares the interpreter. `agent_start` establishes the started lifecycle. Non-intake tool restrictions survive off and explicit resume through settlement. A later host-only pre-start failure is not observable through a supported extension event. If forwarded delivery never starts or settles, safe session restart is required. Resume reports this uncertainty instead of overlapping prompts.

Decision publication requires the current active session, Legatus, and ownership generation. Inactive refresh does not publish. Existing displayed branch entries deduplicate the current question across resume and supply receipt-time presentation evidence for ordinary answers.

## Red and green evidence

| Slice | Actual red | Green |
| --- | --- | --- |
| Empty product targets | [Product red](remediation-product-red.txt) returned `applied` instead of `rejected`. | [Product green](remediation-product-green.txt) rejects without a decision, preserves the original, and still resolves empty-affected routing. Existing ordinary product-answer tests pass. |
| Missing authentication and explicit retry | [Dispatch baseline red](remediation-dispatch-red.txt) timed out waiting for explicit resume after isolated prerequisite restoration. | [Initial dispatch green](remediation-dispatch-green.txt) and [final runtime](remediation-runtime.txt) preserve exact input and admit it after explicit retry. The final lifecycle consumes known missing authentication before host forwarding. |
| Inactive publication in RPC | [RPC red](remediation-publication-rpc-red.txt) observed four decision entries instead of one after off, settlement, and refresh. | [Publication green](remediation-publication-green.txt) and final runtime retain one actionable presentation and resolve an ordinary resumed answer. |
| Inactive publication in TUI | [TUI red](remediation-publication-tui-red.txt) observed an unactionable question after off and settlement. | [Final terminal capture](remediation-tui.txt) contains no question in the inactive interval and shows resumed conversational resolution with admitted eligibility. |
| Held asynchronous authentication | [Authentication race red](remediation-auth-race-red.txt) observed one agent start while the check remained held. | [Authentication race green](remediation-auth-race-green.txt) holds resume without overlap, consumes off during checking, and preserves input for later resume. |
| Unrelated settlement during authentication | [Authentication settlement red](remediation-auth-settlement-red.txt) timed out because the unrelated settlement cleared a locally checking dispatch. | [Authentication settlement green](remediation-auth-settlement-green.txt) retires only a started interpreter in the matching session and preserves the held check. |
| Busy race during authentication | [Authentication busy red](remediation-auth-busy-red.txt) never reported deferral after an unrelated run started during the held check. | [Authentication busy green](remediation-auth-busy-green.txt) consumes the marker and dispatches only after unrelated settlement. |

The initial missing-auth fixture used `modelRegistry.refresh` to restore its catalog. That did not restore the selected runtime model. Its first timeout was a real pre-start failure but did not establish successful prerequisite restoration. The corrected fixture explicitly selects its controlled model and restores its dummy credential through supported `registerProvider`. A separate baseline rerun with the corrected fixture reproduces the original defect. That rerun happened after the initial fix and is not presented as preceding it.

The first green TUI attempt checked an unwrapped JSON answer literal. The terminal had wrapped that value, so the observation failed despite a resolved public decision. The retained final assertion ignores terminal whitespace for the rendered answer. RPC separately checks exact answer text.

A proposed fixture for later host-only failure unregistered the provider after local validation. Actual Pi instead started and settled a provider-error turn. The attempted fixture was removed rather than treating it as pre-start evidence. No implementation change followed that rejected experiment.

The approved historical TDD exception remains unchanged in [tdd-exception.md](tdd-exception.md). `integration-prevalidation.sha256` still has SHA-256 `2aa7ac5fd07f68547480c0567caca4dcfcbc77139875f91f17d6fd37a04e6385`. No later test is relabeled as preceding the exception-protected code.

## Final checks

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | All 18 tests passed without skips. | [Tests](remediation-tests.txt) |
| `npm run typecheck` | Passed. | [Typecheck](remediation-typecheck.txt) |
| `npm run build` | Passed. | [Build](remediation-build.txt) |
| `npm run verify:pi` | All 16 real-runtime groups passed with 39 controlled-provider requests. | [Runtime output](remediation-runtime.txt), [result](remediation-runtime-result.json), [selected public RPC records](remediation-rpc-evidence.json), and [terminal capture](remediation-tui.txt) |
| `LEGION_PROVIDER_TRIAL=authorized node scripts/verify-provider.mjs` | Passed on the final lifecycle implementation. | [Provider output](remediation-provider-final.txt) and [public result](remediation-provider-result.json) |

The tested versions remain Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22.

I inspected actual `/tmp/legion-pi-BlvIqD/rpc.json` and `tui.txt`. Held-check resume produces one started and settled interpretation. Off during checking preserves pending input without a turn until explicit resume. The busy and already-settled cases each produce the unrelated run followed by one fresh interpreter. Missing authentication reports one local failure and no autonomous retries. The only final controlled `extension_error` is the intentionally injected uncorrelated host-message error during a started turn. The subsequent bash tool is blocked and the late intake proposal rejects while inactive.

## Representative provider and isolation

Pi Codex uses `globalThis.fetch` on Node. Node 22.23.1 supports `--use-env-proxy`; it does not use these proxy variables by default. [The local transport probe](remediation-transport-probe.txt) observes no configured-proxy connection without the switch and a connection with it. Initial probe drafts timed out and were corrected to observe a CONNECT request with bounded test teardown. They were not provider trials.

The parent authorized the switch only in the ephemeral test subject. The allowlist is the existing `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. No variable values appear in evidence. `NIX_SSL_CERT_FILE` is not mapped to another variable. No TLS verification setting, endpoint, provider, model, machine configuration, or fallback runner changed.

The first corrected trial passed before the additional lifecycle fix. Subsequent changed-source trials revalidated the asynchronous-check and settlement changes. The final trial passed with `openai-codex/gpt-6-astra`. Each turn ran only `legion_intake`. The public checkpoints show these eligibility transitions:

- Direct spelling task. `admitted`.
- Separate materially ambiguous greeting. `admitted`, `blocked`.
- Ordinary answer, "Use French for that greeting, please.". `admitted`, `admitted`.

The result records genuine RPC answer provenance, prior presentation, and a committed `record-clarification` resolution containing that exact answer. Selected model, thinking level, compaction, and isolated settings hash checks passed. Authentication stayed outside the refresh window and the test copy remained unchanged. The original `auth.json`, `settings.json`, `models.json`, and `models-store.json` stayed byte-identical. The test removed its agent directory, including authentication and Pi journals. The final serialized evidence check found no authentication or transport values. No model reasoning or complete provider responses were retained.

## Review and remaining risks

The writer reviewed the complete remediation diff and ran deslop. No comment, cast, suppression, or speculative module was added. No independent review is claimed for this changed result. The parent owns fresh-context review and final T01 acceptance.

- The selected provider now has representative evidence, not proof of arbitrary conversational semantics. Protected decisions retain structural checks but a model can misunderstand language.
- A forwarded host-only delivery failure with no supported lifecycle event requires session restart. Legion does not infer completion from idle state or asynchronous error text.
- The unchanged user installation still lacks a discoverable Herdr skill. Fixture readiness does not repair that installation.
- Pi 1.0.4 commands still expose neither source nor attachments. Host commands are trusted in-process calls. Protected answers require subsequent ordinary input and presentation evidence.
- SQLite SIGKILL checks apply to this local filesystem, not universal power-loss durability. T01 remains intake-only.

Model the Domain changed the lifecycle to explicit retryable and nonretryable stages. Type System Discipline made empty product targets unrepresentable after schema parsing. Boundary Discipline kept auth validation at the adapter boundary and rejected invalid proposals before persistence. Test Behavior, Not Implementation required public saved-input, eligibility, ordinary-answer, and actual terminal assertions. Prove It Works required inspecting real records and the selected-provider result. Laziness Protocol removed the unsuccessful host-failure experiment instead of adding unsupported hooks or an error-string retry mechanism.
