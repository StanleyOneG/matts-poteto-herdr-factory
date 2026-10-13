# #32 native launch check and acceptance

## Result and candidate

The corrected fresh Matt bootstrap and the shared poteto settlement path both passed representative **actual configured-shell** trials. The initial integrated suite failed **295/302**, with seven failures. The bounded test-only repair below now passes **302/302, exit 0**, with final typecheck/build also passing. Independent source, P1-fix and final test/evidence reviews are complete with no remaining blockers. Two optional Standards duplication suggestions were deferred. This is not full workflow or #41 acceptance. No new native launch, installation matrix, task implementation or native-child reenactment was run for this repair.

Native-tested HEAD `fcc4dc7ff0ae93a98784370be86996231052977b`, with the uncommitted A+B+C+P1 candidate. All **28 candidate files** (21 tracked changes, seven untracked files including both new Matt-persistence regressions) are individually hashed in `/workspaces/astraprojects/.tmp/nf-KpExXQ/candidate-before.json`. The same manifest was verified after native trials, suite and build:

- File-manifest SHA-256 `6f8a1dd572bc5ba0d6b81ebbc06be7690785a955a38273df3d8a997bd08be1c9`.
- Tracked-diff SHA-256 `bfb0141601fce0a45263906c3af3f20a48afb2e0039c1f2767dd90a4d4df147c`.
- Unrelated `AGENTS.md`/temp-storage modifications and this evidence document are excluded, not overwritten. The native validator made no source/test/package edits. The subsequent repair changes only `tests/effect-authorization.test.ts`, `tests/lock-startup.test.ts` and this document; product source, scripts and packages remain unchanged. The hashes above identify the original native-tested candidate, not the final test diff. Native source evidence is reused without relabeling its hash. At the native-validation checkpoint there were no staged files or commits. No push, tracker or global configuration changes were performed.

## Exact native composition and route

Actual Pi **1.2.0**, pi-subagents **0.78.0**, Node **v22.23.1**, Herdr CLI/server **0.9.1**, protocol **22**, existing local socket `/home/vscode/.config/herdr/herdr.sock`. Repository imports match installed Pi/subagents releases.

Native discovery identified the supplied pstack **0.6.0** extension at `/home/vscode/.pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack/extensions/pstack/index.ts` and poteto skill at that root's `skills/poteto-mode/SKILL.md`. Actual origin `https://github.com/StanleyOneG/stanley-pi-pstack`, commit **6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524**; relevant tracked extension/skill trees were unchanged. Version alone was not provenance proof.

Parent identity was freshly verified as workspace **w1**, tab **w1:t1A**, pane **w1:pA6**, terminal **term_65da8149580b486**, session **01a134b3-f385-72fb-9699-8ca614120391**, actual Pi PID **1711897**. Each trial used a new returned no-focus tab in w1 and a unique detached tracked-base worktree under `/workspaces/astraprojects/worktrees-matts-poteto-herdr-factory_legion/`. Dirty parent content was not copied; candidate extension loaded directly with `-e /workspaces/astraprojects/matts-poteto-herdr-factory`.

Real `LocalTribunusHost.startPi` invoked ordinary interactive zsh **`pi`**, preserving the existing function that calls `start-privoxy-if-needed-8120`, sets proxy environment and executes `command pi "$@"`. No absolute CLI/headless substitute, fake discovery, auth, model or journal was used. Exact override appended `--model 'openai-codex/gpt-6.1-sol' --thinking 'high'`; default appended neither flag. Actual loaded resources and worker PID/session/cwd were checked by the native receiver and a disposable observer.

Fixture boundary: direct verified coordinator-reference tab/descriptor creation; `host.createWindow` was **not** exercised from the headless child, whose process is not the principal. Actual host startup/inspection/initialization and the launched worker's identity checks were exercised. This does not prove task admission or end-to-end Legatus workflow execution.

## Fresh native results

Both inspections had all selected native resource/principal/auth/availability diagnostics ready. Authenticated `hello.json` existed before the genuine native journal; no fixture created that journal. Each initialization produced exactly one real user/terminal-assistant exchange, no tools, delegation, assignments or child activity.

| Check | Default / Matt | Exact / poteto |
|---|---|---|
| Worktree suffix | `issue32-fixed-native-default-cfe7056e` | `issue32-fixed-native-exact-67103f83` |
| Tab / pane | `w1:t10` / `w1:pAG` | `w1:t21` / `w1:pAH` |
| Terminal | `term_65db8877345a290` | `term_65db89037f56f91` |
| Actual Pi PID | 1847548 | 1848417 |
| Session | `01a13562-59af-77d5-b589-61cfc0d48a46` | `01a13564-f6dd-7523-baa6-42a8ca0be30e` |
| Selection / window | astra / medium / 272000 | sol / high / 272000 |
| Initialization command | `6905db03-af9d-427e-8891-3b0bb6ad0e12` | `8258e362-56e7-46c6-81b1-78881fee9aa8` |
| Persisted user / assistant | `eefb49f8` / `031475dc` | `4dc9af8a` / `6d356acf` |
| Mode / settlement witness | `ec8335f5` / `689f16c6` | `286cfc46` / `c0e0f22f` |
| Initialization exit | 0 | 0 |

Matt received only the addressed bounded waiting prompt, no skill expansion or controller toggle. Poteto remained off; its native off observation and settlement persisted after the genuine user/assistant turn. Poteto received the unchanged native skill body and persisted a fresh latest enabled mode before settlement. Both receipts were compared with actual journal bytes/order. Replies were respectively “I’m waiting for the bounded assignment; poteto remains off, and workflow controllers remain unchanged.” and “I am waiting for the bounded assignment.” Native recorded combined cost was $0.073294, not a spend policy.

Native `handoff`, `matt-tdd`, `matt-teach`, `code-review`, `implement`, `implement-spec` resolved from each worktree's `.pi/skills/` to its `.agents/skills/`; every body matched parent and tracked base. Matt's distinct names were not replaced by fork `tdd`/`teach`. `checked-summary.json` retains exact canonical paths, SHA-256, journals, generation IDs and receipts.

No Trust/permission prompt appeared; actual native trusted state was true. No prompt was answered/bypassed or actor relocated. This is not fresh Trust or permission-matrix proof.

## Failure history, review and integrated repair map

The earlier actual native Matt trial failed `ENOENT` at the old `src/tribunus-host.ts:498`: Pi 1.2 custom-only entries did not create its fresh journal. Its original intent was never replayed. That intermediate evidence remains `/workspaces/astraprojects/.tmp/n32-fTa5ry` and the original session artifact `bdab5d3d-980b-4d7c-9149-81c32150881c/issue32-native-validation.md`. The fixed default check above is new evidence, not relabeled history.

Shared poteto persistence/idle/controller checks changed in P1, so the old positive poteto proof was **not** reused as final proof; the minimal fresh exact/poteto recheck above passed. Independent P1 re-review found no issues in `outputs/1fdd1c3e-6616-4b9b-9e06-991938dac67d/issue32-persistence-review.md` under the parent session's `subagent-artifacts/`. Initial Standards review `outputs/a96d73a0-1f9a-4431-99cf-9f1fba71d9f9/standards.md` found no documented-standard violation or blocker; two optional P2 duplication/refactoring suggestions were coordinator-deferred. Reviews were read-only, not test evidence.

| Initial validation command, run once on the frozen native-tested candidate | Actual result / stdout |
|---|---|
| `npm test` | **Exit 1**, 302 tests, 295 pass / 7 fail, zero skips/cancellations; `/workspaces/astraprojects/.tmp/s-AQnPjr/npm-test.log` |
| `npm run typecheck` | Exit 0; `/workspaces/astraprojects/.tmp/t-9gokJq/typecheck.log` |
| `npm run build` | Exit 0; `/workspaces/astraprojects/.tmp/b-c5E4Aw/build.log` |
| `npm run verify:pi` | **NOT RUN**, coordinator cancelled after read-only inspection: large legacy isolated install/RPC matrix, restricted child env loses temp routing and stale fixture prerequisites; no shim/source alteration, no #41 replay |

The initial failure remains red evidence, not a pass:

1. `tests/effect-authorization.test.ts:35–36` returned obsolete Matt `nativePrompt: ""`. Its four cases failed fixture setup, held with `initialization-evidence`, before effect assertions. The repair imports and uses the existing `mattInitializationPrompt(command)` for the external host receipt. All effect-authority, current-incarnation, unknown-outcome and legacy-digest assertions are unchanged.
2. `tests/lock-startup.test.ts:7`: fresh/task/initialized each exceeded the old **25-second subprocess timeout** for 500 rounds (`ETIMEDOUT`). These incomplete attempts were not ownership-race proof. Controlled runs of the **unchanged script and worker** completed all 500 rounds on ext4: fresh **57.816s**, task **58.164s**, initialized **27.080s**, each exit 0. Winners were respectively `[254,246]`, `[237,263]`, `[264,236]`; rejections were the complementary counts, totaling 500 each. Every run had zero zero-owner/dual-owner rounds; all existing owner/rejection/receipt/task-text/initialized-identity checks ran. This demonstrates slower disk-backed storage, not a hang or race. The only census change is test observation timeouts **25s → 75s** for `execFileSync` and **30s → 80s** for its enclosing test, with a measurement comment. This leaves roughly 29% margin above the initial slowest measurement; no rounds, assertions, locking, concurrency or product caps changed.

All initial seven exact names, errors and stacks remain in `nf-KpExXQ/failed-tests.json`, `failed-tests.log` and the original suite log. That suite finished naturally (~477 seconds); no surviving owned consumers were found. No original failure was overwritten.

### Repair checks and integrated recheck

Repair evidence root: `/workspaces/astraprojects/.tmp/g-B6ZIXR`. Baseline file hashes, exact incremental test diff and unchanged-source checks distinguish this repair from the pre-existing candidate.

| Repair command | Actual result / evidence |
|---|---|
| `node scripts/census-lock-startup.mjs 500 fresh`, then `task`, then `initialized` | Exit 0 each, timings/counts above; full 500-record receipts and logs in `g-B6ZIXR/census-{fresh,task,initialized}/` |
| `node --import tsx --test --test-concurrency=1 tests/effect-authorization.test.ts tests/lock-startup.test.ts` | **7/7**, exit 0, 147226ms; census **58.424/58.915/27.144s**; `g-B6ZIXR/focused/focused.log`, full census records alongside |
| `npm run typecheck` before integration | Exit 0; `/workspaces/astraprojects/.tmp/t-pcmcbhlw/typecheck.log` |
| First repaired `npm test` recheck | **Exit 1, 204/302, 98 failures**, 250353ms; `/workspaces/astraprojects/.tmp/s-s4ml_33j/npm-test.log`, exact failures in `failed-tests.json`/`failed-tests.log`. Worker setup error: Python's 10-character run basename made native Unix endpoint **108 bytes**, violating the existing `<108` assertion. 94 composed-fixture and four SDK Matt setup failures; not a product defect or behavioral pass. Repaired tests themselves passed. No assertions/source changed to accommodate it. |
| `node --import tsx --test tests/native-sdk-matt-initialization.test.ts` after correcting run-directory length | **4/4**, exit 0, 7229ms; `/workspaces/astraprojects/.tmp/m-rL3fyU/setup-check.log`. Six-character `mktemp` suffix prechecks exact endpoint **106 bytes**. Real SDK with controlled provider/Herdr boundary; not a new live native launch. |
| Final necessary `npm test` recheck, prechecked short disk-backed root | **302/302, exit 0**, 555609ms, zero failures/skips/cancellations; `/workspaces/astraprojects/.tmp/s-xbf095/npm-test.log`, `npm-test.exit`. Census **58.438/59.232/27.747s**, all 500 rounds per scenario and original assertions preserved. |
| Final `npm run typecheck` | Exit 0; `/workspaces/astraprojects/.tmp/b-PHs6tB/typecheck.log`, `typecheck.exit` |
| Final `npm run build` | Exit 0; `/workspaces/astraprojects/.tmp/b-ouvkLL/build.log`, `build.exit` |

Each command's actual exit was captured without a short tool deadline or pipeline masking. No exploratory full-suite repeats: the first recheck exposed a routing setup failure, then an affected SDK check verified corrected endpoint length before the necessary final integrated gate. Legacy `verify:pi` remains **NOT RUN** at the parent direction. The final independent review inspected the exact two-file repair, preservation records, passing suite/compiler/build logs and native summary. It found no issues and returned `Merge verdict: OK`. Its report is `outputs/06453160-005a-4019-8bec-946df4206663/issue32-final-gate-review.md` under the parent session's `subagent-artifacts/`. Unchanged native product-source evidence above is reused, not rerun or relabeled.

## Cleanup and retained evidence

Both new native actors were reconciled immediately before closure: exact IDs/session/PID/cwd, all occupants, native idle/no pending messages, zero tools/children/outstanding managed effects. Supported observer `ctx.shutdown()` was observed, actual Pi process/group exited, and the sole foreground occupant returned to its recorded zsh. **Closed `w1:t10` and `w1:t21`; no retained actor/Trust exception.** Exact was initially human-viewed and retained; only after coordinator-relayed explicit human release was it shut down/closed. For this task's owned disposable tabs only, the operator released viewing/focus as a cleanup blocker; genuinely active/input/manual/Trust/ambiguous actors still require preservation. This grants no product-policy change or unrelated-tab authority. A first default cleanup assertion saw delayed Herdr detection after actual PID exit (harness exit 1); read-only same-pane reconciliation settled it before closure, with no shutdown or bootstrap replay.

Evidence owner: resumed validation worker **bdab5d3d-980b-4d7c-9149-81c32150881c**. Disk-backed ext4 scratch roots retained for review/repair:

- `/workspaces/astraprojects/.tmp/nf-KpExXQ` (~4 MiB): manifest/diff, harness, native resource/journal/receipt assertions, closed-tab receipts, failure map.
- `/workspaces/astraprojects/.tmp/s-AQnPjr` (~106 MiB): failed suite log and controlled native-test records.
- `/workspaces/astraprojects/.tmp/t-9gokJq`, `/workspaces/astraprojects/.tmp/b-c5E4Aw` (~3.3 MiB each): compiler/build logs and caches.

Each controlled invocation explicitly routed TMPDIR/TMP/TEMP and npm cache into its own root; actual paths were inspected. Existing native Pi/subagents runtime routing remained ordinary/unset and may use `/tmp`; no restart/migration. Cleanup condition: review/repair no longer needs these owned paths, required evidence saved separately, and consumers proven settled. Never delete worktrees, branches, real journals or native runtime roots as disposable scratch cleanup.

Repair worker owns `g-B6ZIXR`, `s-s4ml_33j`, `t-pcmcbhlw`, `m-rL3fyU`, `s-xbf095`, `b-PHs6tB` and `b-ouvkLL`. All controlled writes used explicit TMPDIR/TMP/TEMP and command caches on the checked ext4 mount. Unchanged Pi runtime temp variables remain unset and may route its own output through `/tmp`; no restart/migration/global edit occurred. Controlled census disposable roots `c-dz1c8zwe`, `c-xf7r4nth`, `c-uu1yxybh` and focused root `f-UNzCvB` were removed only after logs and full census records were saved readably under `g-B6ZIXR`, children/commands exited and no remaining environment/fd/cwd consumers were found. Remaining repair roots retain logs/fixtures/receipts for independent review under the same cleanup condition; disposable npm caches were removed after settlement. No pre-existing evidence, runtime state, worktree, branch or journal was deleted.
