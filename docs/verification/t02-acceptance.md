# T02 implementation acceptance

Issue #3 adds durable task claims and isolated Git workspaces. Worker launch, integration, cleanup, and automatic claim release remain outside this slice.

## Reviewed result

The final source manifest is [t02-implementation.sha256](t02-implementation.sha256). Its SHA256 is `aee01e4cbda23e8e20532195526127cc4d354b8f0ef1c6523b6c84bd2ad9b255`. All 31 entries matched after the parent's final checks. Review reports and this acceptance record do not change that source identity.

- [Standards review](t02-standards-review.md) passed with notes. The earlier missing simultaneous-contention evidence is resolved. Optional extraction from `src/intake.ts` remains deferred.
- [Spec review](t02-spec-review.md) passed with notes. Both reproduced shutdown defects are fixed and independently rechecked.
- [Comment review](t02-comment-review.md) found no comments or suppressions to remove. Standards rereview also checked the added reproductions.

The independent reviewers used `openai-codex/gpt-6-astra`. The implementation owner used `openai-codex/gpt-6.1-sol`. Reviewers did not implement the changes. Their original contexts were fresh. Targeted rereviews retained those review contexts.

## Parent verification

The parent inspected the implementation diff and directly ran these checks against the final manifest.

- `sha256sum -c docs/verification/t02-implementation.sha256` passed.
- `npm run typecheck` passed.
- `npm test` passed all 79 tests, with no failures or skips. See [parent test output](t02-parent-tests.txt).
- `npm run build` passed.
- `node --import tsx scripts/verify-workspace.mjs /tmp/legion-t02-parent/final-runtime.json` passed against actual Pi. See [parent runtime output](t02-parent-runtime.txt). The disposable profile was `/tmp/legion-workspace-pi-RUnvD3`. Host settings hashes were identical before and after.
- Source and documentation whitespace checks passed. The staged full check flagged blank-line whitespace in raw test output. Those evidence bytes remain unchanged.

The [implementation report](t02-results.md) records red-green evidence, real Git process trials, package regression checks, and the permission-path investigation. The [decision trail](t02-decisions.tsv) records the design amendments, timeout recovery, review corrections, and acceptance.

## Remaining limits

SQLite contention can require explicit operator recovery. A Git operation with unknown completion retains its claim and can remain blocked indefinitely. Matching resource names or process death do not authorize adoption or retry. Separate clones do not share claims.

The exact shutdown-race reproductions use controlled scheduling through the public module with real Git. Real Pi checks validate adapter behavior separately. These trials do not prove universal model behavior, power-loss durability, or worker lifecycle safety.

The requested implementation is accepted for a reviewable commit and PR. This record does not authorize merging into the remote primary branch or closing the issue before its integration requirement is met.
