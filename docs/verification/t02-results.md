# T02 reservation verification

## Current result

Pi users retain stopping protection across authorization awaits and storage failures. An off command cannot start discovery after revocation or release an unsettled invocation's leases. Busy assignment diagnostics now identify the saved Legatus and exact fresh host command for explicit recovery.

Maintainers retain the approved public Legion seam, ledger, and guarded adapter. The review corrections change only `src/intake.ts`, the three workspace test files, and README among previously reviewed files. No orchestration extraction or ledger wait policy was added. No comments needed deletion.

The previous writer report overstated same-task concurrency evidence. Its distinct-Legatus ownership checks were sequential. Independent Standards review identified that gap, and Spec review reproduced R1 and R2. The tests below replace the unsupported concurrency claim with actual synchronized evidence.

No implementation blockers remain. Targeted independent rereview remains parent-owned. Nothing is committed or staged. Branch `main` remains at `bada335eccb76507d0b7dfcebacc7a15ded7b212`.

## Tested identity

`t02-implementation.sha256` identifies 31 tested source, test, script, package, README, and retained reproduction files. Its SHA256 is `aee01e4cbda23e8e20532195526127cc4d354b8f0ef1c6523b6c84bd2ad9b255`. All entries verified after the final checks.

`t02-reviewed-implementation.sha256` preserves the prior independently reviewed manifest with SHA256 `03180f199137cdd608ee12e13773153e9f2c5635790a42730b67fc08bc21de1d`. `t02-review-fixes-source-delta.txt` identifies the five changed reviewed files and two added reproduction scripts. All other previously reviewed source, scripts, and package files are unchanged.

## Review corrections

R1 checked authority before awaiting snapshot storage but not afterward. Another microtask could issue off, release the leases, and allow discovery to start from a stale authorization. The common synchronous authority check now runs after storage awaits and immediately before invocation protection is acquired. That check and counter acquisition have no intervening await. The audit also guards fresh parent and workspace observations after metadata awaits. Dispatched-effect completion and its evidence inspection remain allowed to settle after off. Metadata commits retain their existing ownership callbacks, and effects retain their final dispatch guard.

R2 replaced the known lifecycle with inactive whenever snapshot reading failed. The error return now reports the same local lifecycle as the readable path while retaining the storage diagnostic.

`t02-r1-red.txt` and `t02-r2-red.txt` preserve the failing public regressions. Their green counterparts preserve the corrections. `t02-r1-original-repro.txt` and `t02-r2-original-repro.txt` preserve this writer's executions of the independent real-Git reproductions. The retained corrected scripts are `t02-r1-real-repro.mjs` and `t02-r2-real-repro.mjs`. Their final output proves 70 microtask cuts, 46 held Git receipts with replacement refused, no discovery start after off, and stopping during actual disposable snapshot corruption. R2 becomes inactive only after settlement. These are public-module trials with real Git, not an exact live-Pi microtask reproduction.

`t02-busy-guidance-red.txt` and its green counterpart prove retained request identity, fingerprint, original payload, and actionable explicit recovery guidance. No automatic retry was added.

## Same-task contention

`t02-same-task-barrier.txt` proves simultaneous distinct Legati with different local TaskIds reach the same unclaimed-task barrier. Releasing both produces one durable owner, one ownership blocker, one resource plan, and the same restart outcomes.

`t02-same-task-processes-final.txt` preserves two independent-process disposable-Git schedules. Both actors reach a parent barrier before either claim or Git effect.

- Release-together permits a truthful busy or unavailable result while another writer owns the ledger. The test verifies one durable owner, at most one workspace, the loser's exact retained request, and an explicit public resume and fresh reserve. Recovery returns the same owner's blocker without changing refs or worktree registration.
- Hold-first-dispatch retains the winner's durable branch dispatch before Git executes. The other process returns an ownership blocker while that dispatch remains held. After release, the winner has one ready worktree at the intended parent. Both restart views retain the same reservation.

Both schedules preserve dirty tracked and untracked files and an unrelated existing worktree sentinel. FIFO barriers, atomic ready-file publication, and microtask checkpoints establish ordering. No timing sleep is race proof.

The parent approved both schedules and the explicit recovery policy through `contact_supervisor`. The raw `database is locked` failure remains in `t02-same-task-processes-diagnostic.txt`. The initial collector's stricter direct-blocker expectation failed. A separate readiness-marker publication defect caused an empty JSON read and one timed-out probe. `t02-same-task-processes-red.txt` preserves that probe failure. Atomic publication corrected the test defect. These failures are not counted as successful verification or hidden as product changes.

## Final verification

| Command | Result and evidence |
| --- | --- |
| `npm run typecheck` | Passed. `t02-typecheck.txt`. |
| `npm test` | 79 passed, zero failed or skipped. `t02-tests.txt`. |
| `npm run build` | Passed. `t02-build.txt`. |
| `node --import tsx --test tests/assignments.test.ts tests/workspace-git.test.ts` | 31 focused tests passed. `t02-review-fixes-focused.txt`. |
| `node --import tsx docs/verification/t02-r1-real-repro.mjs` | Passed. `t02-r1-real-green.txt`. |
| `node --import tsx docs/verification/t02-r2-real-repro.mjs` | Passed. `t02-r2-real-green.txt`. |
| `node --import tsx scripts/verify-workspace.mjs docs/verification/t02-runtime.json` | Real RPC and PTY passed. `t02-runtime.txt` and `t02-runtime.json`. |
| `npm run verify:pi` | Installed tarball, native discovery, intake RPC, and PTY passed. `t02-intake-runtime.txt`. |
| `sha256sum -c docs/verification/t02-implementation.sha256` | All 31 entries matched. |
| `git diff --check` | Passed. |

The final workspace fixture is `/tmp/legion-workspace-pi-zsbFAg`. It verifies deferred reservation, exact correlated guarded execution, real readiness and preservation, installed denial, arbitrary root-tool refusal, and stopping during discovery and creation. No factory worker tool calls occurred. The intake fixture is `/tmp/legion-pi-cgpxtb`, with 45 controlled-provider requests. Both use Pi 1.0.4 and test-owned profiles. Herdr access is read-only prerequisite observation.

The host settings hash remains `296596038ff5d0b578264865abad78583dbf1db3583b8ee7a681eb486be7384c` before and after. No settings or permissions changed. No matching workspace subprocess fixtures remain running.

The original fifteen red-green checkpoints remain under `t02-s01-*` through `t02-s15-*`. S05's missing-export startup failure is separate from `t02-s05-behavior-red.txt`, the actual held-versus-ready failure recovered verbatim. S06 is a real Pi discovery assertion. The original Git preservation, surviving-child, permission, and approval evidence remains retained.

## Self-review and limits

Self-review covered the corrected ownership boundary, lifecycle error return, recovery guidance, wire schemas, barrier publication, and actual source delta. Fix Root Causes moved revalidation to the dispatch boundary instead of hiding the symptom. Prove It Works required real overlap and explicit recovery rather than treating sequential exclusion as concurrency proof.

SQLite contention need not return owner metadata immediately. It can require explicit recovery after the writer settles. Unknown completion can still block indefinitely. Matching resources, process death, or released leases never authorize adoption, takeover, or automatic retry. Separate clones and separate direct TaskIds do not deduplicate. Metadata replacement is unsupported. Local trials do not prove universal liveness or power-loss durability. Controlled providers do not prove universal language behavior. Worker launch and Herdr executor lifecycle remain outside T02.

The canonical append-only decision trail remains `/tmp/legion-t02-parent/decisions.tsv`. Parent-owned targeted rereview and the final commit are still required.
