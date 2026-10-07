# T01 lock startup correction

## Result and scope

Pi users no longer depend on schema setup or shared-to-exclusive promotion to choose a lifetime lease owner. Maintainers inherit a one-statement SQLite writer reservation. The exact runtime assertion still requires one owner. No retry, sleep, product cap, broker, second lock mechanism, or identity migration was added.

Baseline is `a7ae6985280cf0e28a467b286145e1299164ff59` on main. The parent caught a zero-owner failure after two passing reviews. The authoritative red is retained in `lock-startup-parent-red.txt` and `lock-startup-parent-rpc-red.json`. Both actors reported association ownership unavailable with `database is locked`, no successful receipt, and inactive status. No push occurred. The external handoff records the correcting SHA; the commit adding this report resolves it.

## Diagnosis before product change

The tested premise was that SQLite setup followed by `BEGIN EXCLUSIVE` always leaves one successful acquirer. A public two-process census preceded any product edit. Its first 200 rounds happened to pass. A 1,500-round baseline census caught 15 zero-owner rounds, with no dual owners. Fine monotonic-clock alignment raised the failure rate to 40/1,000. A permanent public-seam regression failed before the fix with 24 zero-owner rounds out of 500.

Each round uses fresh disposable storage and only two known test-owned actors. Outcomes and receipts are recorded per actor. The defect is not a consistently disadvantaged actor or an unseen third owner. The census script is rerunnable as `node scripts/census-lock-startup.mjs <rounds> <fresh|task|initialized> <output.json>`. The workers call only public `command` and `state`. Test loop counts and alignment are not product policy.

Disposable native SQLite probes minimized the mechanism one variable at a time. The probe is retained as `scripts/probe-lock-startup.mjs`. Native probes are diagnostic, not persistent product assertions.

| Native configuration | Zero-owner rounds / 1,500 | Dual owners |
| --- | --- | --- |
| Exact old setup batch | 84 | 0 |
| Same setup, statement-level trace | 103 | 0 |
| Remove only owner-table creation | 171 | 0 |
| Remove remaining setup, only `BEGIN EXCLUSIVE` | 366 | 0 |
| Change that single statement to `BEGIN IMMEDIATE` | 0 | 0 |

The earlier independent native pass found 108, 79, 264, and 379 zero-owner rounds for the first four configurations. Statement-level failures occurred mostly at `CREATE TABLE`, with additional failures at journal setup and `BEGIN EXCLUSIVE`. Deleting setup alone is therefore a refuted fix. Exclusive promotion still needs all readers to release. A writer reservation needs only one writer, so one actor can own the reservation while the other fails closed. Lease files contain no authoritative rows, so reader exclusion is unnecessary.

The native reader probe confirms that a reader can inspect schema while the reservation is held, a competing writer fails, release permits a new reservation, and the inode stays stable. Tested SQLite reports 3.53.1 under Node 22.23.1. The probe touches only disposable storage.

## Minimal product correction

The entire product diff is one SQL-string replacement in `SnapshotStore.acquirePath`. `BEGIN IMMEDIATE` replaces journal/schema setup plus `BEGIN EXCLUSIVE`. The same helper covers association and Legatus leases. Acquisition order, complete paired binding, reverse release, process-death release, file identity, and fail-closed errors are unchanged. The aggregate's initialization, transactions, journaling, and `synchronous=FULL` are unchanged.

The parent separately approved one precise operational-journal distinction. A first reservation on an empty lease file can leave a crash journal if killed. A deliberately mutating activation may reconcile its own association lease journal while acquiring that lease. It does not authorize metadata repair or grant a saved receipt.

The old malformed-metadata assertion compared every file after a mutation. It was too broad for operational crash journals. The adjusted assertion permits exactly the known association `.lock-journal` to disappear. All other files and bytes, including the Legatus lease journal, routes, initialization evidence, aggregate data and journals, remain exact. The actor stays inactive with no snapshot or receipt. Status and doctor before the mutation preserve every byte; subsequent observation is again byte-preserving. No general journal or lock-file exclusion was used.

## Verification and qualification

After the correction, separate public censuses passed 2,000 fresh rounds, 1,500 task-bearing rounds, and 1,500 repeated initialized rounds. Each had one winner, one rejected contender, zero dual owners, exact task receipts, and stable identity for reused storage. Additional initialized censuses passed 1,000 and 1,800 rounds. The permanent suite includes 500 rounds for each scenario.

One full-suite attempt with the first census collector reported one initialized zero-owner outcome after the fix. That collector queried each actor's state before the other command had completed. Its failed log is preserved in `lock-startup-initialized-followup-red.txt`; per-actor results were not retained, so its cause is not established. It is not silently reclassified as a proven aggregate-reader failure. A 1,800-round diagnostic rerun with that inline collector did not reproduce it.

The final collector records both command results before public observations, matching the exact real RPC verifier and avoiding extra concurrent status traffic inside acquisition. It persists unexpected outcomes immediately. This did not weaken the one-owner assertion. An isolated copy of exact baseline product source with the final collector still failed 33/1,000 fresh rounds. The corrected product with that collector passed another 1,000 initialized rounds and the final full suite. The unclassified earlier event remains a residual qualification.

| Final check | Result |
| --- | --- |
| `npm test` | 48 tests, no skips or failures. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| Exact unchanged `npm run verify:pi` | Ten consecutive passes; each has 19 groups and 45 controlled-provider requests. |

The ten runtime logs are `lock-startup-runtime-1.txt` through `lock-startup-runtime-10.txt`. The last actual records are `/tmp/legion-pi-uIr7bK/rpc.json` and `tui.txt`. Retained public observations and terminal output are `lock-startup-rpc-evidence.json` and `lock-startup-tui.txt`. Six shared-session groups each show one owner and a same-ID inactive restart. Inactive contenders have no model turn. Native same-session on/resume boundaries, live-owner guards, exact tasks, normal shutdown, authentication/busy races, first-creation crashes, aliases, malformed metadata, and ordinary answering remain covered.

Source comparison verifies that core, adapter, model instructions, schemas, preflight, provider verifier, and the exact runtime script are unchanged. Only the lease SQL changes. No credentialed trial ran. The prior selected `openai-codex/gpt-6-astra` result remains bound to c0ecd1f, matches original parsed evidence, and has no retained test authentication directory. Current runtime exercises the unchanged interpretation contract.

Census evidence keeps per-actor outcomes and compact public state. Full earlier large census JSON remains in the reported disposable paths; committed initialized evidence retains receipt count and latest receipt rather than quadratic copies of all prior receipt arrays. A 4,000-round diagnostic exceeded its 40-second command limit as history grew; it is not counted as a pass. No debug instrumentation entered product code.

## Review and risks

Deslop and the actual diff were reviewed before commit. Historical prevalidation and the approved TDD exception are unchanged. The canonical trail is append-only. The current manifest identifies executable files, tests, package files, and README. Writer verification is not independent acceptance.

Attack the Premise required per-actor census before another lock edit. Build the Lever produced rerunnable census and native probe scripts. Fix Root Causes rejected the deletion-only exclusive hypothesis after measured failures. Laziness Protocol selected one reservation statement instead of retry machinery. Test Behavior, Not Implementation kept persistent assertions at public commands, receipts, saved text, identity, and bytes. Prove It Works required ten unchanged actual runtime runs and direct terminal inspection.

Finite stress is not a universal liveness or power-loss proof. The single unclassified initialized event under the earlier collector remains disclosed. Malformed metadata, preserved unsupported legacy layout, historical multiple candidate selection, representative provider semantics, and accepted Pi provenance/attachment/forwarded-failure and Herdr-skill limits remain. Fresh-context independent review and final T01 acceptance remain parent-owned.
