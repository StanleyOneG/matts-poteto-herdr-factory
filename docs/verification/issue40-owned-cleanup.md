# #40 owned-resource cleanup: reviewed implementation and remaining native gates

## Status

Implemented only #40 against spec #1 and the Legion engineering policy, from baseline `12905ff2450ee4fec009d1431b711e177359d1e5`. Matt controlled development; poteto remained off. Results #29–39 remain covered by the integrated suite. No #41 journey, push, tracker closure or deployment was performed.

**This is a reviewed, locally validated implementation, not full #40 acceptance.** Successful product tab auto-close and successful native worktree removal remain unverified mandatory native gates. The Emperor agreed to preserve the strict rule that unknown use retains a resource. No privileged-process exclusion, access expansion or acceptance waiver was introduced.

## Implemented behavior

Tab closure and worktree removal have separate intents, eligibility, outcomes and receipts. Exact current accepted results supply acceptance evidence, not execution permission. Cleanup pins its current controller separately; explicit reconciled resume can prepare proven never-dispatched/no-effect work, but cannot replay dispatched or unknown effects.

Tab checks bind returned native IDs, session/process incarnation, all occupants, worker/native-child/effect settlement and continuation/handoff/reviewer needs. Known human use remains retained in durable history for that exact tab/session even after the positive observation disappears. Bare shells and incomplete observations are ambiguous, not proof of human use or settlement. Predecessor tabs without their own exact accepted result remain retained.

Worktree checks bind ownership, Git registration/backlink, filesystem incarnation, exact result commit/tree, intended-parent integration, cleanliness and actual use across all retained actors. Dirty, ignored, hidden-index, changed, in-use and uncertain resources remain retained. Retained capture, verification, exception, review, integration, report and handoff references protect local artifacts, including clean tracked files and removable Git administrative data. Historical relative references retain their originating cwd; unresolved path identity retains resources. Diagnostic prose is not invented filesystem evidence.

Ordinary nested Bash sees and executes the exact native command. A fixed one-shot IPC helper gates that same command after ordinary permission handling. Fresh resource and authority checks precede release; denied or held permission cannot enter the native effect. No raw destructive-exec fallback, force cleanup, branch deletion or automatic adoption was added. Immediate rechecking is not an atomic native compare-and-close guarantee.

Native dispatch/receipt evidence survives outside removed resources. Saved exact successful receipts support applied-but-unacknowledged reconciliation; absence alone does not. Status/doctor stay passive. Confirmed tombstones preserve history without relaunching removed resources. Tab closure never removes a worktree, and worktree removal never deletes its branch.

## Final validation

Node 22.23.1, npm 10.9.8. Full suite ran **once**, normally, from 13:34:43 to 14:14:05 UTC on 2026-10-15:

- `npm test`: **654/654**, exit 0; zero failures, cancellations, skips or todo.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- Staged and unstaged `git diff --check`: exit 0.

All 17 implementation/test paths matched the reviewed manifest before/after. The full 717-path source manifest, including modes and symlink targets, was unchanged. Manifest SHA-256: `10b73e6ba86ccfd0ff312f58f6dbea1138a44852c0aad542e51f4c914c911328`. This documentation was added afterward; production and test source did not change after validation.

Validation evidence is under `/workspaces/astraprojects/.tmp/`: `v40-9b1j` contains the invocation ledger and initial manifest; `t40-w2Ux` contains the suite output and original exit; `a40-0WAC` contains the post-suite audit; `c40-9hKW`, `b40-Uop3`, `d40-y5iE`, and `i40-NfB5` contain the other command logs/exits; `f40-jKr1` contains the final comparison and retention audit.

## Independent review

Initial parallel Standards/Spec review workflow: `d3497cc9-fdc0-4d4e-b697-f31ea569f1d3`.

- Standards reviewer `a26ecc7d-6819-4bb4-af2b-b9fd3e064531`: P2 positional test helpers and P2 duplicated permission-critical tab command construction. Both were corrected.
- Spec reviewer `9e253b9a-f298-4967-a26e-f41158106003`: P1 missing retained verification evidence in preservation checks. Public regression reproduced deletion of a tracked check-only artifact. The fresh inventory and preservation checks were corrected.
- Targeted reviewer `b74f8c51-6762-4238-a55b-a1da88016d46`: Standards resolved; remaining P1 for missing explicit relative references and dangling ancestors. That branch was corrected with real-Git regressions.
- Fresh targeted reviewer `125058a9-e6b0-4694-b3b7-d18b17e9df26`: remaining P1 resolved, no new defects in its changed behavior; verdict OK.

Reviewers inspected source/patches, not independently executed tests. The coordinator checked all 17 source hashes against the reviewed manifest. Exact fix evidence is retained in `f40-IczB` and `r40-vJx0`; their handoffs enumerate diagnostic and focused-test roots. Final validation covered the combined reviewed source.

## One native check and its limits

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

Further native verification needs an approved environment with sufficient observations and a bounded real product executor check. It is not authorized by this report. Do not close #40 as fully accepted or automatically start #41. Push and issue closure still require separate Emperor permission.
