# T03 implementation acceptance

Issue #4 adds verified local Tribunus launch and bounded result visibility. Consumers can explicitly launch an owned task through their configured interactive-shell `pi` command. Maintainers retain one public Legion seam, durable launch identity, and preserved uncertain effects.

## Reviewed result

The [source manifest](source-manifest.json) identifies the reviewed implementation with digest `72fb8e1c6216613e8319914b6230f179f081a12ec62441f2d141332a4c59b6b5`. Parent acceptance and review documents do not change those source bytes.

- [Standards rereview](standards-review.md) passed with notes. Both original P1 findings are resolved.
- [Spec rereview](spec-review.md) passed. No remaining finding in the remediation.
- [Comment review](comment-review.md) found no removable comments or suppressions. Standards rereview also checked the remediation delta.

The initial independent reviewers started with fresh contexts on `openai-codex/gpt-6-astra`. They retained those contexts for targeted rereview. The implementation owner used `openai-codex/gpt-6.1-sol`. Neither reviewer implemented the fixes.

Review found two runtime defects. Atomic immutable publication now prevents the public watcher from reading incomplete worker evidence. Addressed failure reports now expose failed or aborted assignments instead of leaving them assigned indefinitely. The real receiver and public-state regressions failed before these fixes and passed afterward.

## Parent verification

The parent inspected the source changes, the remediation delta, and the evidence verifier. These checks passed against the reviewed source.

- `npm run typecheck`. [Output](parent-typecheck.txt).
- `npm run build`. [Output](parent-build.txt).
- `npm test`. All 102 tests passed, with no failures, skips, or cancellations. [Output](parent-tests.txt).
- `npm pack --dry-run --json`. The package includes the new runtime modules.
- `node --import tsx scripts/verify-launch-evidence.mjs /tmp/legion-t03-writer-live/remediation docs/verification/t03-local-tribunus/source-manifest.json`. [Output](parent-runtime.txt).
- `git diff --check`. Passed before staging. The staged check flags preserved raw patch context and command-output blank lines. Those evidence bytes remain unchanged.

The actual fixed-source trial records a successful start whose receipt was deliberately withheld. The same worker then completed native poteto initialization, received one bounded assignment, and reached public `reported` state. The verifier checks actual process identity, one start, journal ordering, source hashes, and unchanged earlier launch rows. Separate real alias and function trials retained the configured wrapper behavior. [Results and limits](results.md) distinguish each trial and its source identity.

## Exceptions and retained work

The original baseline failed 78 of 79 tests under SQLite contention. The parent's pre-fix run later passed 98 of 99 with a separate inherited pending-identity publication race. A controlled timing probe reproduced that second interleaving on base source. The passing final suite does not erase either failure. Neither is fixed here, and no old assertion was relaxed. [Triage](pre-fix/parent-publication-race-triage.md) preserves the distinction.

[Twelve finite TDD exceptions](tdd-exceptions.json) cover green-first characterization only. Each has a recorded isolated behavioral mutant, intended assertion failure, and restored green. The feature slices and report fixes retain their actual red-before-green evidence.

Host settings, shell startup, trust files, and model selections remained unchanged. The test owner approved session-only trust for inspected disposable folders. Legion does not answer trust prompts. Seven test-owned Pi actors remain preserved in the [actor inventory](actors.json). No automatic cleanup, worker draining, issue closure, or integration is claimed.

The parent accepts this exact result for a reviewable commit and PR. This does not authorize merging into the primary branch or closing #4 before its required integration.
