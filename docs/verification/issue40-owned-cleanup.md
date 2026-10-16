# #40 owned-tab cleanup and first-version worktree retention

## Current scope and acceptance status

The Emperor approved a first-version-wide scope change after the original native gates remained unverified. Automatic closure of eligible owned tabs remains required. Automatic worktree removal is deferred: Legion must retain worktrees and branches, show their retention reason and state that removal is unsupported in this version. Retention alone must not block an otherwise eligible tab. No product deletion trigger, public command, legacy setting, saved intent or retry may restore removal, and no manual destructive-command bypass replaces it.

Preserve all existing ownership, records, reports, evidence, handoff references and unknown historical outcomes. Disabling removal does not complete unknown operations or authorize replay. Unknown use still means retention. This amendment does not authorize a host observer, isolation system, privilege expansion or global-setting changes.

Spec #1 and tickets #40/#41 now carry this approved scope and revised acceptance checks. Future removal is deferred to [#42](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/42), which is not a first-version/#41 prerequisite and promises no date or unverified supported environment. Tracker #40 is already CLOSED; that is not acceptance evidence.

**The amendment is implemented and independently reviewed; acceptance is blocked.** Focused checks and typecheck/build pass. The first full suite failed: 657/658, with a task-lock census subprocess timeout. A separately authorized full-suite repeat passed 658/658 on unchanged production/test source, with the original failure preserved. The authorized native setup stopped before creating a Tribunus after a malformed reservation request and a source-authority-rejected continuation. Product tab auto-close remains unverified. A later separately authorized attempt successfully created one Tribunus but stopped because the admitted task omitted part of the approved worker instructions. That attempt is ended; its setup and worker tabs have since been closed as separately authorized developer cleanup, not product acceptance. No further trial is authorized.

The code/test candidate is `fe9fff9871efa0bbe8dbb0a0d8f2e849ef8bf982`, following implementation commit `eb487bcef0a485b6c265501c5819d39c7bc47aa3` and test-only review fixes. The passing repeat tested exact `f1c48857d9ed0a6d59f60d7f05efbea2b7802545`, which adds documentation only. Neither a failed suite nor developer-only coordinator closure is acceptance. Push needs separate approval; no final acceptance comment may precede publication of the exact checked commit and completion of the remaining gates. Do not start #41 automatically. Successful native worktree removal is excluded from this version, not relabeled as passed.

## Amendment implementation and focused evidence

Implementation starts from `9b07d45670b09281e78a81fd36f968bae48a0d59`. Acceptance queues only tab intents. Current owned-ready claims supply the displayed retained worktree path/branch; unresolved historical worktree operations suppress that assertion. Legacy worktree prepare/execute is refused before adapter invocation or state/controller/history changes, and product observation leaves all historical worktree records unchanged, including pending, proven no-effect, dispatched, unknown and confirmed tombstones. The compatibility adapter's `remove` is inert: no permission, observation, Git command or receipt write. Its read-only legacy receipt reader remains available outside product dispatch. The worktree usage observer is unchanged and disconnected from cleanup effects; no visibility expansion was attempted.

The existing public command/task/observable-state seam covers automatic preparation, eligible tab closure with preserved worktree/branch/result evidence, legacy records through controls/off/resume, passive status/doctor/help, and lost tab receipts without replay. Existing tab ownership, settlement, permission-delay and sticky-human-use checks remain. Lower-level tests now seed historical receipts explicitly instead of obtaining them through product deletion, while preserving dirty/identity/usage/artifact and receipt-integrity assertions.

Each command used its own fresh disk-backed `/workspaces/astraprojects/.tmp/i40-*` directory, with `TMPDIR`, `TMP` and `TEMP` explicitly set to that directory. Each retained directory contains `log` and the original `exit`; fixtures/caches were observed under that root. All commands below completed normally with zero cancellations. They are focused controlled checks, not native installed-composition acceptance.

| Command after the environment assignments | Result | Retained evidence root |
| --- | --- | --- |
| `node --import tsx --test --test-name-pattern='first version retains accepted' tests/cleanup-public.test.ts` | Behavioral red, exit 1: accepted worktree still pending instead of unsupported retention | `i40-d9I0` |
| Same command | Green, 1/1, exit 0 | `i40-HdeI` |
| `node --import tsx --test --test-name-pattern='legacy pending worktree' tests/cleanup-public.test.ts` | Behavioral red, exit 1: legacy prepare still returned pending, after correcting the fixture to settle its tab stage first | `i40-CKJL` |
| `node --import tsx --test --test-name-pattern='legacy pending worktree|first version retains accepted' tests/cleanup-public.test.ts` | Green, 2/2, exit 0 | `i40-zUFl` |
| `node --import tsx --test --test-name-pattern='legacy .*worktree|first version retains accepted' tests/cleanup-public.test.ts` | Final boundary refinement green, 6/6, exit 0 | `i40-DUxp` |
| `node --import tsx --test tests/worktree-cleanup.test.ts` | 55/55, exit 0 | `i40-l1FN` |
| `node --import tsx --test tests/cleanup-state.test.ts` | 18/18, exit 0 | `i40-zQho` |
| `node --import tsx --test tests/tab-cleanup.test.ts` | 40/40, exit 0; source/test unchanged | `i40-zkeB` |
| `node --import tsx --test tests/cleanup-public.test.ts` | 24/24, exit 0 | `i40-939T` |
| `npm run typecheck` | Exit 0 | `i40-z6Wz` |
| `npm run build` | Exit 0 | `i40-1B5n` |

Intermediate diagnostics are preserved, not relabeled as behavioral reds: `i40-6jBx` failed because the test attempted cleanup control while the tab stage still owned correlation; `i40-zOCn` was 22/24 because two test expectations incorrectly said inactive rather than stopping for unresolved historical effects; `i40-7It3` records a transient typecheck failure during refinement. Earlier green typechecks are `i40-F4Sb` and `i40-EemD`, and an earlier 17/17 state run is `i40-a3oU`. The final implementation no longer creates retained removal intents: retention is derived status, and old worktree records remain inert and unchanged. The coordinator accepts retention responsibility for these review-evidence roots. Preserve them until review/continuation no longer needs them and their separate cleanup conditions are established. No old resources or evidence were deleted. Pi's already-running managed/truncated-output routing still uses `/tmp`; shell descendants were routed to disk without global configuration changes.

The initial implementation worker performed no full suite, native trial, staging, commit, push, tracker mutation or dependency/global-setting change. The subsequent coordinator-owned review, validation and native setup are recorded below. Readable stat-only terminal census is distinct from the former worktree cwd/fd census blocker and does not prove future worker settlement. Successful native worktree removal is neither claimed nor a first-version gate.

## Amendment independent review and corrections

Parallel workflow `47e49e96-460f-422f-a119-199485afce7d` reviewed exact `9b07d456...eb487bc`:

- Standards reviewer `6385b8f9-24bd-4ab3-94e8-4c012a67ad89` found three P2 test issues: positional helper arguments, a singleton tab matrix retaining unreachable worktree branches, and a tab record still named `tree`.
- Spec reviewer `635a15f1-1ca1-4803-bd80-e4c4dd4f63cd` found no implementation defect against the amended scope. Native and full-suite gates remained pending.
- Fix worker `bd7b0bd8-8b9e-4489-b211-4f02e0c53f67` changed only `tests/cleanup-state.test.ts` and `tests/cleanup-public.test.ts`, committed by the coordinator as `fe9fff9`. Focused files passed 18/18 and 24/24, and typecheck passed. Evidence roots are `s.bKPi`, `p.t9ag` and `t.havm` under the disk-backed base; the coordinator retains responsibility. A small npm metadata log outside those roots was preserved and copied into `t.havm`.
- Independent targeted re-review `07a21f50-a2cb-4b3d-8a0c-a1556ebd6627` confirmed all three findings resolved with no lost assertions or new defects. Reviewers inspected source, not independently rerun tests.

The coordinator verified that `eb487bc...fe9fff9` changes only the two test files; production source and package manifests are identical. Review of code does not waive the failed integrated suite or missing native success.

## Amendment final local validation

Validation worker `3e939fce-6ee3-4751-b883-ec37bddcb028` tested clean `main` at `fe9fff9871efa0bbe8dbb0a0d8f2e849ef8bf982`, with Node 22.23.1, npm 10.9.8, TypeScript 5.9.3 and tsx 4.23.15:

- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `npm test`: ran exactly once, 00:40:27–01:19:45 UTC on 2026-10-16; **657/658, exit 1**, zero cancelled, skipped or todo.
- `git diff --check` and staged checks passed; HEAD and clean status were unchanged.

The failure is `lock startup census task has one public owner and rejected contender every round`, at `tests/lock-startup.test.ts:75–76`. Its existing `node scripts/census-lock-startup.mjs 500 task` subprocess exceeded the test's 75000ms timeout and returned `ETIMEDOUT`. The suite itself completed normally. This is a failed gate, not a pass, setup red or demonstrated environmental flake. No full-suite rerun occurred in that assignment. A subsequent bounded diagnosis ran the exact failing case once through `tsx --test --test-concurrency=1 --test-name-pattern='^lock startup census task has one public owner and rejected contender every round$' tests/lock-startup.test.ts`, with unchanged 500 rounds, 75000ms subprocess timeout, 80000ms outer timeout and safety assertions. It passed 1/1, exit 0, in 67271.822945ms. The final census contains 500 records, one owner, one saved and one rejected outcome each round, with zero zero-owner or dual-owner rounds. This standalone pass does not change the failed integrated-suite exit or establish acceptance.

Read-only original-state inspection found sequential progress beyond 430 iterations, with a final committed acquire but no shutdown in iteration 430. Directory timestamp gaps were at most 0.256s, supporting cumulative runtime exhaustion rather than a prolonged early deadlock. The precise timing cause, any #40 performance contribution and the original last IPC/release phase remain unresolved. No harmless-flake classification, baseline comparison, code fix, threshold change or additional variant was inferred. Diagnosis report `8b47f3bd-7d84-4f7b-b918-7a967a4ec0a4` and `/workspaces/astraprojects/.tmp/dxLEEgL` preserve the original readback, focused log/census and limits; the coordinator accepts retention responsibility. The focused log SHA-256 is `c5eda25f4f079f442d5a6cdfb53d236c2d72e29c14b73e7ae1e8266d7a54e712`.

Before/after manifests cover 718 tracked entries, file bytes, modes and symlink targets. They are byte-identical, SHA-256 `f4bb0add83508b6f397ed8106c026e08ab336e2b3afa7a39495f1b94ddb0fe56`. These documentation updates follow validation; production and test source remain the tested candidate.

The coordinator retains `/workspaces/astraprojects/.tmp/v40e-AcLWlp` for manifests/receipts/audit, `v40t-3ap2ov3b` and `v40b-otavbu7s` for typecheck/build, and `sq4ovaQ` for the original full-suite log and fixtures. Full log SHA-256: `21c97cffb127364ea4bac3c3a01bdf2ae39c95ff9b94281665fbe802da7c6ebb`. The incomplete `sq4ovaQ/legion-lock-census-9By6ty` has 431 round directories but no final census JSON; this is not evidence of 431 completed rounds. No observed validation-process identity survived the final audit. These evidence roots remain retained; that audit is not a universal worktree-use proof or deletion authority.

## Separately authorized comparison and full-suite repeat

The Emperor reported that the root filesystem had reached 100% usage with 583M available, then freed Docker build cache. That observation was not measured contemporaneously with the original timeout. Subsequent checks do not prove root-pressure causality.

Authorized comparison `d214818f-a667-479c-9aaa-c50ba980a630` ran one matched pair of the unchanged filtered 500-round task census: baseline `12905ff2450ee4fec009d1431b711e177359d1e5` passed in 67435.069878ms, then current `f1c4885` passed in 68449.020208ms. Both used fresh source exports and fixture roots on the workspace disk with the same installed dependencies. The 1.504% difference is descriptive, not proof of regression or equivalence. Evidence roots `b3h0HPW`, `cxpeqaI` and `eMKfKKA` remain under `/workspaces/astraprojects/.tmp` with coordinator retention responsibility.

The Emperor then separately authorized one full-suite repeat. Worker `50c698d4-8ca7-4186-af93-a5d60ec63cca`, resumed as `ee3d1ed2-0a14-4339-b7a3-7a1b82f4331e`, ran `npm test` exactly once for this authorization on clean `main` at `f1c48857d9ed0a6d59f60d7f05efbea2b7802545`:

- **658/658 passed, original exit 0**, with no failures, cancellations, skipped or todo tests.
- Start 2026-10-16 09:40:47.046621 UTC; finish 10:24:48.919527 UTC. Runner duration 2640609.280144ms; wrapper wall time 2641.872895792825s.
- The previously failing task census passed in 69252.897773ms with unchanged rounds, assertions and timeouts.
- A connection outage interrupted the worker conversation, not the suite. Recovery observed the same live wrapper/npm identities and resumed monitoring without another invocation.
- Before/after manifests were identical: 718 tracked entries, SHA-256 `3a04037a2831469a324338a0857f925bc2de6b81f2900dc235f39193ad645394`. HEAD and clean Git status were unchanged. Production/test/script/package/config source matches `fe9fff9`.

All controlled bulk writes went to workspace ext4 at `/workspaces/astraprojects/.tmp/r4We2Hn`, including fixtures, logs and caches. Root had about 6.7GiB available at invocation; the workspace had about 290GiB. No build, dependency installation, Docker operation or global configuration change occurred. Existing managed Pi runtime remained in `/tmp`. None of 792 observed process identities survived the final audit; no active root socket remained. Sixty-four processes had unreadable reference fields, so this is not a universal absence or cleanup claim.

The coordinator accepts retention responsibility for `r4We2Hn`, about 273MiB. Its `result.json`, manifests, original `command.log`, routing records and qualified process audit remain available. Log SHA-256: `5af1392f6add70e58796335ac62729c2a87f24b60c6d4faab9d52309d52b177d`. Managed report: `50c698d4-8ca7-4186-af93-a5d60ec63cca/issue40-authorized-full-suite-repeat.ee3d1ed2.md` under the report base below. The original failed suite and its evidence remain unchanged. This repeat establishes a passing local integrated suite, not native product acceptance or the cause of the earlier timeout.

## Amendment native setup and remaining product gate

Read-only preflight found no Legion loadout in the current parent Pi and a primary `main` checkout, which cannot serve as the non-primary product integration parent. The Emperor separately authorized one isolated coordinator checkout/branch and one additional no-focus Legatus tab in `w1`. Native driver `087402cb-22b4-48f3-9722-5abe61f816cc` created them from reviewed `eb487bc`, with normal configured interactive `pi -e <isolated checkout>`. Actual composition observed Pi 1.2.0, pi-subagents 0.78.0, Herdr 0.9.1/protocol 22 and fork `6365cd5`; ordinary doctor reported 14 ready. This is setup evidence, not installed-journey or product cleanup acceptance.

The retained coordinator checkout is `/workspaces/astraprojects/worktrees-matts-poteto-herdr-factory_legion/issue40-coord-p40-U0YL`, branch `refs/heads/legion/issue40-coord-p40-U0YL`, still clean and registered at `eb487bc`. A task-owned dependency symlink initially appeared untracked; only that exact link was replaced, with supervisor approval, by an ignored directory of links to existing dependencies. No tracked/shared/global configuration or dependency installation changed.

Actual run `4c4af671-4d09-40dc-8908-07ecb77d196b` admitted task `d09bb7ac-a95b-4f11-8d9b-ff604212a4e9@1` from source `f72f120e-87e7-4436-8bf4-4acfe55b394d@1`. The first reservation omitted required `--parent` and was rejected with disposition `none`. Reentering `/skill:implement` to supply the complete command created source `70825827-dd9a-4c63-afd6-8f2cef7711fd@1`; product authority rejected management of the task from the prior source. Both failures are preserved. They establish failure of these attempted requests, not impossibility of a supported same-source continuation or a cleanup behavioral defect.

The coordinator ended the attempt without further reentry, re-admission or workaround. No reservation, product worker/worktree, result/check/review/integration, cleanup intent, nested cleanup permission call or product receipt was created. The single product Tribunus grant remains unspent. No new native action follows from that accounting without another decision.

Setup-only cleanup closed `w1:t26`, pane `w1:pBD`, terminal `term_65dea41cb6f6cad`. Actual off/shutdown, 33 returned tool calls with no outstanding native child/effect, exact session/process/all-occupant checks, orderly Pi exit and a fresh shell-only census preceded normal Herdr closure. Same-server absence of the exact tab/pane/terminal and Pi/shell processes was recorded. **This was developer coordinator cleanup, not `legion_clean` or product auto-close.** No task-owned tab remains.

Evidence and runtime are retained at `/workspaces/astraprojects/.tmp/p40-U0YL`; the driver's report indexes launch receipts, original/copied journal, rejected tool results, read-only run backup/final snapshot, source manifest and closure checks. Original product run state under `~/.pi/agent/legion/` and its Pi session journal remain preserved. The coordinator accepts retention responsibility for these resources, the checkout and branch. No old retained resource was trial material.

Independent evidence auditor `adebac66-5e1e-4089-9a86-666177fe1666` checked original records and found no issues with the bounded setup-block, settlement, developer-close and preservation claims. The audit explicitly does not establish product acceptance or exclude a supported continuation route. Real product tab auto-close and accepted-worker worktree/branch/evidence preservation remain unverified.

## Deferred reserve is not workspace authorization

A later separately approved fresh attempt (`/workspaces/astraprojects/.tmp/p40-seuX/e`) also ended before reservation or worker launch. Its supplied `task-prompt.txt:7` incorrectly ordered deferred reserve → immediate `legion_workspace`. Journal entries 47–50 show the deferred intent receipt followed by the correctly rejected premature execution, with no intervening workspace authorization. The durable request and original authority root remained preserved; this is not evidence of a #40 cleanup regression. The read-only diagnosis is retained in managed report `ee47d7cb-6933-4505-8272-660a1d794262/issue40-workspace-stage-readonly-diagnosis.md`.

The required native sequence is `legion_request reserve ... --parent ...` → save `receipt.requestKey` from `deferred` → `legion_request workspace <saved-request-key>` → require `workspace-stage` → `legion_workspace` with its exact `requestId`. A host slash command is an alternative authorization path, not a reason to omit this native intermediate step. Deferred intent is not execution authority; stage preparation grants no additional Bash permission or worker-launch authority.

The limited follow-up changes only native instructions, tool descriptions and the deferred receipt message, with public installed-SDK offline regressions for guidance, premature/wrong-ID denial with unchanged Git resources, and explicitly authorized correlated execution. Execution/safety logic is unchanged. These are focused controlled checks, not a live Pi/Herdr trial. The earlier 658/658 full-suite result applies only to the prior unchanged-source candidate, not this guidance fix. A later separately authorized full suite on the guidance fix is recorded below; no new native trial occurred. Product tab auto-close and first-version acceptance remain unverified. Earlier failed attempts and their evidence are not superseded or retried by this change.

## Full-suite validation of the guidance fix

The Emperor authorized one full suite on exact clean `main` commit `f70921cdc6957fd09cd05dabd609260bd7999767`. Worker `e6cc063f-2de0-4f0c-82f1-e35259849cb4` ran `npm test` once on 2026-10-16, from 14:33:17.920047 to 15:18:06.185103 UTC. **661/661 passed, original exit 0**, with no failures, cancellations, skipped or todo tests. Wall time was 2688.265052023111s; the task census passed in 62858.617312ms. No build, installation, additional test run or native attempt occurred.

Before/after/final manifests matched across 718 tracked entries, including bytes, modes and symlink targets. SHA-256: `3193ed2d35c2bec9eb929186e73e46eb19b4599859b4434219c09409b927e2cc`. All 45 periodic source/Git samples matched; final HEAD and clean status were unchanged. Log SHA-256: `4aa91c4a596a22d5bb8b2d5a04c0b4de324a9630c5dc543152afefd604eed258`. The coordinator independently compared manifests and rechecked these hashes before recording this result.

Controlled fixtures, logs and caches used disk-backed `/workspaces/astraprojects/.tmp/f7xFdun`. Existing Pi runtime remained in `/tmp`; its available space changed from 1,695,404,032 to 1,691,365,376 bytes system-wide, not an attributed write count. None of 736 observed process identities survived the final audit, and no active owned-root socket remained. Sixty-one processes had unreadable reference fields, so the audit is not universal absence proof or deletion authority.

The coordinator accepts retention responsibility for `f7xFdun`, about 298MiB, including receipts, manifests, original log and routing/process evidence. The managed report is `e6cc063f-2de0-4f0c-82f1-e35259849cb4/issue40-f70921c-full-validation.md` under the report base below. This is fresh source-bound validation, not reuse of the prior 658/658 result. Both earlier outcomes remain preserved. A local-suite pass establishes neither root-pressure causality nor native product acceptance.

## Guidance-fixed native attempt and developer cleanup

A separately authorized attempt on `2a93d664a8f70c783be16cb938228c3c07e23537`, with production/test source unchanged from the passing `f70921c`, successfully followed deferred reserve, explicit workspace authorization, workspace execution and separate launch. It created one real interactive Tribunus. Report `d644b07a-c79c-4766-b33c-929b7bc909e7/issue40-guidance-fixed-native-attempt.md` and `/workspaces/astraprojects/.tmp/p40-xbuaejxo` preserve the actual source, assignment and receipts.

The driver supplied a short admission goal and acceptance criteria that omitted some of the approved operational instructions. The worker received those admitted fields faithfully. This is a driver/admitted-task gap, not an established product transport defect. The coordinator ended the attempt with ordinary `/legion off`. The sole executed worker Bash effect was read-only and completed. A subsequent proof-check attempt was denied during retirement before execution; it is not a behavioral red. No proof file, commit, capture, verification, independent result review, integration or product cleanup occurred. Two automatic native provider recoveries were recorded separately from the single driver launch and assignment.

Independent auditor `4443be8a-6e50-4b22-aa0b-528c36f73d7f` checked the original saved evidence and found no issues with these historical claims. It confirmed revision 15 with the exact worker parked, returned tool calls and finished effects, while explicitly requiring fresh checks before developer-only closure. This audit did not grant product acceptance.

Setup tab `w1:t28/pBH` closed after actual settlement. The Emperor separately authorized developer cleanup of retained worker tab `w1:t29/pBJ`. Ordinary Pi exit appended one stale-context observation; an overstrict helper initially retained the tab because its runtime file set had changed. The coordinator reviewed and preserved that observation, which was not new work or an unsettled effect. Fresh server, boot, exact terminal/session/process, all-occupant, tool/effect and sole-original-shell checks then preceded the first and only `herdr tab close w1:t29` at 2026-10-16 21:58:11 UTC. Its receipt exited 0; same-server checks confirmed the exact tab/pane/terminal and original Pi/shell absent, with the protected caller unchanged. **This was developer-only cleanup, not `legion_clean` or product auto-close.** No live task-owned tab remains from this attempt.

All worktrees, branches, journals, product state and evidence remain preserved. In particular, coordinator `issue40-coord-p40-xbuaejxo` and worker `8a244f9f-a005-4705-abb6-aa3d53e4cca1` remain registered under the canonical worktree container, clean at `2a93d664`, with their matching `legion/` branches. The coordinator accepts custody of `/workspaces/astraprojects/.tmp/p40-close-pgo8` and the earlier attempt resources. Audit and closure reports are under managed output directory `5bb12c6b-f795-4b0c-a600-150f46e911a0`: `audit.md`, the preserved initial `worker-tab-cleanup.md`, and final `worker-tab-cleanup.b93b8e11.md`. No cleanup receipt substitutes for the missing native acceptance chain.

## Continuation boundary for the amended scope

Independent evidence reviewer `964d0a9e-19ab-42c6-82e1-908cb93cf12b` checked the documentation before the separately authorized comparison/repeat against retained validation receipts, focused census evidence and native reports. It found no issues with evidence accuracy. This does not waive either acceptance gate or authorize publication or further trials.

The cleanup amendment's prior code/test candidate is locally committed and independently reviewed. Its separately authorized full-suite repeat passed on unchanged production/test source; the original failed result remains preserved. The later native-workflow guidance fix passed its affected installed-SDK file (4/4), composed workflow file (20/20) and no-emit typecheck. Independent Standards and Spec reviewers in workflow `8aa6316a-797a-4579-b620-c58d8653020f` found no issues with the exact six-file patch against `69d65a4`. Implementation and red/green evidence are indexed in report `36ac9018-7668-4fec-8c3e-36e82ed09705/issue40-workspace-guidance-fix.md` and `/workspaces/astraprojects/.tmp/e409kcv`. The coordinator retains that evidence and its fourteen per-command roots. Review did not rerun tests or grant acceptance. The separately authorized 661/661 full-suite pass on `f70921c` now supplies current source-bound integrated validation; prior full-suite evidence was not transferred. Native product tab success remains unverified. Further timing attribution or a supported same-source native continuation needs a separate bounded decision, not automatic retries, relaxed thresholds or another setup/trial. No push, final acceptance comment or #41 start has occurred.

Managed amendment reports live under `/home/vscode/.pi/agent/sessions/--workspaces-astraprojects-matts-poteto-herdr-factory--/subagent-artifacts/outputs/`, keyed by these run IDs:

- Implementation: `85012f8a-9e51-4f66-b408-c1e6383db543`; test-only fixes: `bd7b0bd8-8b9e-4489-b211-4f02e0c53f67`.
- Standards/Spec and targeted review outputs: `47e49e96-460f-422f-a119-199485afce7d`.
- Read-only installed preflight: `47f11b3f-720c-47ce-8d69-cfee8467f9fd`.
- Native setup/closure inventory: `087402cb-22b4-48f3-9722-5abe61f816cc`; independent native evidence audit: `adebac66-5e1e-4089-9a86-666177fe1666`.
- Single final suite: `3e939fce-6ee3-4751-b883-ec37bddcb028`; bounded timeout diagnosis: `8b47f3bd-7d84-4f7b-b918-7a967a4ec0a4`.
- Final evidence accuracy review: `964d0a9e-19ab-42c6-82e1-908cb93cf12b`.

## Historical status before the scope amendment

Implemented only #40 against spec #1 and the Legion engineering policy, from baseline `12905ff2450ee4fec009d1431b711e177359d1e5`. Matt controlled development; poteto remained off. Results #29–39 remain covered by the integrated suite. No #41 journey, push, tracker closure or deployment was performed.

**This is a reviewed, locally validated implementation, not full #40 acceptance.** Successful product tab auto-close and successful native worktree removal remain unverified mandatory native gates. The Emperor agreed to preserve the strict rule that unknown use retains a resource. No privileged-process exclusion, access expansion or acceptance waiver was introduced.

## Historical implemented behavior before the scope amendment

Tab closure and worktree removal have separate intents, eligibility, outcomes and receipts. Exact current accepted results supply acceptance evidence, not execution permission. Cleanup pins its current controller separately; explicit reconciled resume can prepare proven never-dispatched/no-effect work, but cannot replay dispatched or unknown effects.

Tab checks bind returned native IDs, session/process incarnation, all occupants, worker/native-child/effect settlement and continuation/handoff/reviewer needs. Known human use remains retained in durable history for that exact tab/session even after the positive observation disappears. Bare shells and incomplete observations are ambiguous, not proof of human use or settlement. Predecessor tabs without their own exact accepted result remain retained.

Worktree checks bind ownership, Git registration/backlink, filesystem incarnation, exact result commit/tree, intended-parent integration, cleanliness and actual use across all retained actors. Dirty, ignored, hidden-index, changed, in-use and uncertain resources remain retained. Retained capture, verification, exception, review, integration, report and handoff references protect local artifacts, including clean tracked files and removable Git administrative data. Historical relative references retain their originating cwd; unresolved path identity retains resources. Diagnostic prose is not invented filesystem evidence.

Ordinary nested Bash sees and executes the exact native command. A fixed one-shot IPC helper gates that same command after ordinary permission handling. Fresh resource and authority checks precede release; denied or held permission cannot enter the native effect. No raw destructive-exec fallback, force cleanup, branch deletion or automatic adoption was added. Immediate rechecking is not an atomic native compare-and-close guarantee.

Native dispatch/receipt evidence survives outside removed resources. Saved exact successful receipts support applied-but-unacknowledged reconciliation; absence alone does not. Status/doctor stay passive. Confirmed tombstones preserve history without relaunching removed resources. Tab closure never removes a worktree, and worktree removal never deletes its branch.

## Historical validation of the original implementation

Node 22.23.1, npm 10.9.8. Full suite ran **once**, normally, from 13:34:43 to 14:14:05 UTC on 2026-10-15:

- `npm test`: **654/654**, exit 0; zero failures, cancellations, skips or todo.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- Staged and unstaged `git diff --check`: exit 0.

All 17 implementation/test paths matched the reviewed manifest before/after. The full 717-path source manifest, including modes and symlink targets, was unchanged. Manifest SHA-256: `10b73e6ba86ccfd0ff312f58f6dbea1138a44852c0aad542e51f4c914c911328`. This documentation was added afterward; production and test source did not change after validation.

Validation evidence is under `/workspaces/astraprojects/.tmp/`: `v40-9b1j` contains the invocation ledger and initial manifest; `t40-w2Ux` contains the suite output and original exit; `a40-0WAC` contains the post-suite audit; `c40-9hKW`, `b40-Uop3`, `d40-y5iE`, and `i40-NfB5` contain the other command logs/exits; `f40-jKr1` contains the final comparison and retention audit.

## Historical independent review

Initial parallel Standards/Spec review workflow: `d3497cc9-fdc0-4d4e-b697-f31ea569f1d3`.

- Standards reviewer `a26ecc7d-6819-4bb4-af2b-b9fd3e064531`: P2 positional test helpers and P2 duplicated permission-critical tab command construction. Both were corrected.
- Spec reviewer `9e253b9a-f298-4967-a26e-f41158106003`: P1 missing retained verification evidence in preservation checks. Public regression reproduced deletion of a tracked check-only artifact. The fresh inventory and preservation checks were corrected.
- Targeted reviewer `b74f8c51-6762-4238-a55b-a1da88016d46`: Standards resolved; remaining P1 for missing explicit relative references and dangling ancestors. That branch was corrected with real-Git regressions.
- Fresh targeted reviewer `125058a9-e6b0-4694-b3b7-d18b17e9df26`: remaining P1 resolved, no new defects in its changed behavior; verdict OK.

Reviewers inspected source/patches, not independently executed tests. The coordinator checked all 17 source hashes against the reviewed manifest. Exact fix evidence is retained in `f40-IczB` and `r40-vJx0`; their handoffs enumerate diagnostic and focused-test roots. Final validation covered the combined reviewed source.

## Historical native check and its limits

Exactly one newly created disposable pair was used on Herdr 0.9.1/protocol 22. Evidence: `/workspaces/astraprojects/.tmp/n40-5Kky`.

- Actual Git ownership, clean state and parent ancestry were observed. Actual candidate process census returned `usage=unknown`; the worktree adapter retained it with zero permission entries or destructive commands.
- The tab was a shell, not an interactive Pi Tribunus. It used the primary cwd so positive worktree usage would not mask the incomplete census. Product observation retained it; this does **not** establish product auto-close or tab/worktree lifecycle integration.
- Development-only cleanup closed exactly `w1:t25`, pane `w1:pB9`, terminal `term_65de0fd5c07aaa9`, after fresh server/topology/process/all-occupant checks. Native close exited 0; the same-server tab/pane/terminal and shell PID 425995 were absent afterward. No test tab remains.
- Acceptance/integration/launch/lifecycle fixture records were controlled and isolated, never published into the working Legion run. The helper, builtin Bash and native close were actual, but the Bash host transport was controlled. This is not installed interactive Pi/Trust composition proof.
- Successful native worktree removal was not attempted. Incomplete privileged/raced process observations remain unknown; no exceptions were added to make the check pass.

Two setup failures were preserved: an external TypeScript module-format failure and a plain-text pane-read parsing failure. Neither performed a cleanup effect. Corrections used the same pair, not another native trial.

Independent native evidence reviewer `49f84084-c722-4b56-8c50-1193652aaf13` found the bounded retention/development-close claims accurate, with no issues. That verdict did not waive product native gates.

## Retention and continuation

The coordinator accepts retention responsibility for all task-owned roots enumerated in the component, fix, native and final-validation handoffs. They remain needed as evidence or have incomplete process visibility; this report authorizes no deletion.

The native worktree remains clean and registered at:

`/workspaces/astraprojects/worktrees-matts-poteto-herdr-factory_legion/issue40-n40-5Kky`

Its branch `refs/heads/legion/issue40-native-n40-5Kky` remains at the baseline commit. The eight native roots are `n40-5Kky`, `n40-nQkw`, `n40-d1pS`, `n40-tv1t`, `n40-LJ3S`, `n40-sqms`, `n40-A4R8`, and `n40-bpjr`, under the same disk-backed temporary base. Disposal requires separate exact ownership, settlement, use and evidence-need checks. No old retained evidence/runtime/worktree was deletion test material.

One D public-test invocation, `d40-xOVf`, failed an assertion during fixture setup and then needed coordinator interruption. It is not a passing or normally completed invocation. The setup teardown was corrected and later focused/full suites completed normally. Its two stale socket paths remain preserved as listed in the D handoff.

Controlled commands used fresh short disk-backed TMPDIR/TMP/TEMP roots. Already-running Pi runtime routing remained unchanged and can still use `/tmp`. Incomplete privileged-process visibility is recorded, not treated as proof of settlement. No global settings or dependencies changed.

Managed reports are under `/home/vscode/.pi/agent/sessions/--workspaces-astraprojects-matts-poteto-herdr-factory--/subagent-artifacts/outputs/`, keyed by these run IDs:

- A state: `b0ac5bbb-0c5c-4044-ab6f-1157e0d374e6`; latch follow-up `e3f5f9a1-f1d6-470b-8ee1-455b13cb1a29`.
- B tabs: `ec9e847c-7696-42c8-89db-16baa1faf60c`.
- C worktrees: `61c53906-7b12-442b-987c-a831e9d39e02`.
- D integration: `4ba4ce7c-41f4-4ab9-a076-03f5c53481de`, completed through revival `af463e56-8961-4c70-9b1c-ede08070a1c6`.
- Review fixes: `831e514c-76fa-49f1-a2b4-fb8ce9ebf194`, follow-up `d25d10b7-5d8f-41ba-a2bf-88b2636b1eec`.
- Native check: `681f8e7d-adcb-4c14-b973-4f07333f2e3f`.
- Final validation/evidence-review workflow: `1307757e-a6bf-48a1-a622-4967ba94b14c`.

At this historical checkpoint, further native verification needed an approved environment with sufficient observations and a bounded real product executor check; this report itself granted no trial authority. The current scope amendment and newly granted one-tab trial are recorded above. Neither changes what the historical evidence proved. Do not treat tracker closure as acceptance or automatically start #41. Push still requires separate Emperor permission.
