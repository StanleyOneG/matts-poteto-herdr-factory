# Post-comment verification

This is a historical report. [The authorized remediation report](remediation-results.md) records the subsequent fixes and successful representative provider trial.

Pi users receive the inherited T01 durable text intake. T01 still stops before task execution or a Tribunus launch. Maintainers receive the initial package, public command, submit, and state contract, tests, rerunnable runtime checks, and the actual TDD chronology.

## Review disposition

The supplied independent comment report has no findings. There are no findings to apply or reject. No comments were deleted or restored. No suppression comments, commented-out code, or `any` casts appeared in the inspected source, scripts, or tests. `skipLibCheck` is compiler configuration, not a comment suppression. It was not changed.

Deslop review retained boundary catches for UI failures, unavailable ancestor package metadata, rejected serialized operations, and rollback after uncertain commits. Removing these would change error handling rather than remove unnecessary code. Schema parsing protects external inputs and persisted data. No application refactor was justified by the supplied report.

The writer inspected all implementation files, tests, both JavaScript verifiers, the PTY script, README, and verification records. The sole executable change in this stage is in `scripts/verify-tui.py`.

## Terminal verifier correction

The old off wait searched all terminal output. It could match the earlier doctor's `Legion is inactive.` text and stop before observing the off command. The first fresh run passed but its captured output ended active. [The failing observation](pre-review-tui-off-red.txt) records the missing subsequent off receipt before the fix. This is a verifier defect, not evidence of an application defect.

The verifier now captures the terminal byte offset before sending off and waits for output after that offset. The final real terminal log contains the off receipt after the decision and ends with `Legion inactive`. [The passing comparison](pre-review-tui-off-green.txt) checks both captures. A manual inspection initially searched after the last repeated terminal redraw. That observation failed even though the new off receipt was present earlier. The final comparison searches after the first decision and also checks the final indicator.

## Final checks

All checks below ran after the PTY correction.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Passed. | [pre-review-typecheck.txt](pre-review-typecheck.txt) |
| `npm test` | Passed. All 17 tests passed with no skips. | [pre-review-tests.txt](pre-review-tests.txt) |
| `npm run build` | Passed. | [pre-review-build.txt](pre-review-build.txt) |
| `npm run verify:pi` | Passed. All 14 real-runtime groups passed with 24 controlled-provider requests. | [pre-review-runtime.txt](pre-review-runtime.txt) and [runtime result](pre-review-runtime-result.json) |
| `node --check scripts/verify-provider.mjs` | Passed. | The command returned zero with no diagnostic output. |
| `sha256sum -c docs/verification/pre-review-implementation.sha256` | Passed. All 15 implementation, package, test, script, README, and ignore files matched. | [pre-review-implementation.sha256](pre-review-implementation.sha256) |

Detailed real RPC and terminal records are `/tmp/legion-pi-k3LRd6/rpc.json` and `tui.txt`. The writer inspected the new off rendering and confirmed no `extension_error` events in the retained RPC logs. These temporary records are not part of the package.

The tested combination remains Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22. Herdr interaction remains read-only status. No launch claim is made.

## Chronology and result identity

The approved retrospective integration TDD exception remains in [tdd-exception.md](tdd-exception.md). [integration-prevalidation.sha256](integration-prevalidation.sha256) is byte-identical to the timeout backup. Its SHA-256 is `2aa7ac5fd07f68547480c0567caca4dcfcbc77139875f91f17d6fd37a04e6385`. Checking those historical hashes against final source correctly reports mismatches after the recorded subsequent fixes. This is not a final integrity failure or proof that later tests preceded that code.

The final implementation manifest's SHA-256 is `41c72072e4146431943ec18a0f2e9644298d250a5b2625a661a98a262140e064`. It supersedes the recovery manifest for current executable identity. Historical evidence remains unchanged except for a contextual link in the recovery report. [t01-decisions.tsv](t01-decisions.tsv) remains the append-only canonical trail.

The authorized commit stage stages only `.gitignore`, README, package files, TypeScript configuration, source, tests, scripts, and T01 verification evidence on the existing `main` branch. The final handoff identifies the resulting commit and complete baseline-to-HEAD diff. No push or PR is authorized. Standards and Spec review remain parent-owned and pending.

## Staged-file safety review

[The staged-file scan](pre-review-staged-review.txt) checked index contents, not only working-tree files. All staged paths belong to T01 implementation or its verification evidence. No authentication files, live SQLite records, session journals, archives, private keys, common token formats, or current configured authentication fields were staged. No credential values were printed.

The controlled loopback provider uses the dummy literal `test-owned-not-a-secret`. It is not a usable test credential. Retained provider checkpoints contain harmless test-owned public state and sanitized error prefixes, not unrelated operational records. Dependencies, generated build output, temporary RPC transcripts, and test configuration remain unstaged.

`git diff --cached --check` reports whitespace warnings in raw verification `.txt` output. Those captures retain terminal padding, carriage returns, and test-runner blank lines. Source, scripts, tests, metadata, and authored documentation pass the same check when raw `.txt` captures are excluded. The captures were not rewritten to manufacture a clean historical record.

## Limits

- Representative `openai-codex/gpt-6-astra` semantics remain NOT VERIFIED. The prior provider trial failed before any intake proposal. It was not retried without a changed prerequisite. Direct admission, material ambiguity, and a conversational answer were not reached.
- The unchanged user installation still lacks a discoverable Herdr skill. Isolated fixture readiness does not repair it.
- Pi 1.0.4 slash commands expose neither source nor attachments. Host commands are trusted in-process calls. Receipts save command text only. Protected answers require subsequent ordinary interactive or RPC input and presentation evidence.
- Provenance and revision validation cannot prove conversational meaning. No external execution is authorized by T01.
- SQLite SIGKILL checks apply to this filesystem. They do not prove power-loss durability across platforms.
- Executor self-review and the no-findings comment review do not replace the pending independent Standards and Spec reviews. The approved TDD exception must remain visible.

## Principles that changed decisions

Prove It Works changed the review from accepting a passing PTY summary to inspecting the terminal capture. Test Behavior, Not Implementation changed the off assertion to require new output caused by the command. Laziness Protocol kept application code unchanged because the comment report and deslop pass justified no application refactor.
