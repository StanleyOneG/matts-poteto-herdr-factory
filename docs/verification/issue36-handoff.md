# #36: bounded installed-native dirty-work handoff

**Final integrated checks and independent review passed.** See the final acceptance section below. The representative native scenario passed with true exit 0 after one preserved fixture-synchronization failure. Its bounded A+B+C evidence does not establish #41 installed journeys. Earlier checkpoint sections retain their original verification boundaries. Baseline HEAD: `240df3caebc01a10b30592cac2aaccaecff3b6e7`, with the intentional frozen A/B/C working-tree changes.

Verification changed only `scripts/verify-handoff.mjs`, this document and focused README usage. No production/tests/skills/settings, #34/#35 scripts/evidence, global configuration, roles or credentials changed. Matt controlled development; poteto stayed off. No paid probes, tracker mutations, staging/commit/push, delegation, full suite or real Herdr tabs.

## Versions and source identity

Installed **Pi 1.2.0**, **pi-subagents 0.78.0**, **Node v22.23.1**, read-only live **Herdr 0.9.1 / protocol 22**, Linux `/proc`. Invocation-local deterministic provider streams supplied responses; actual SDK sessions, built-in tools, native user entries, lifecycle and production receipts executed. No write backend was called directly or replaced. No native lifecycle, receipt, artifact result or admission was fabricated.

Passing evidence/runtime: **`/workspaces/astraprojects/.tmp/r36-TVka`**. `source.json` records the exact tested candidate; `installed-source.json` additionally hashes installed SDK session/resource-loader/tool implementations and the native subagents entry. `preserved-source.json` records untouched focused tests/fixtures and #34/#35 evidence. All A/B/C source/test hashes match their supplied reports; the native script has not changed since its pass.

| File | Passing SHA-256 |
| --- | --- |
| `scripts/verify-handoff.mjs` | `9eefc2b4fe90d0be625aef41a29e65322b67a2a318a17d5bb5687c41b2b36afd` |
| `src/intake.ts` | `b5a9d8cf605259d743ef6eff736c40f5a0d271fedf2552502d2783a8ded98f41` |
| `src/extension.ts` | `2ea0cb9cbf59394554f06a86cf42921982c4889f8429d3177ad8fdec3fbb21cf` |
| `src/resume.ts` | `4086e9539022ccfe4bd2cac4d6f51b1ad6c58f29a37980d3a20f80e44e8aae52` |
| `src/assignments.ts` | `6cb344e2d190fa2e0feaaf790f564af4a3a0ace8575c20c236e2bc2deca1806b` |
| `src/snapshot.ts` | `7a5cd340b118550d543c41f45baa9e08bcee126ac7e334684aede5dc6fedb4f8` |
| `src/tribunus.ts` | `874d9082bab16a83208a7b6f741cffef422a52f672b424c177fc362bcb4bef17` |
| `src/tribunus-host.ts` | `1c9148bcff1ed15333b52c23906e083b0a87387fa58ba9ea6a5051d9ebed8599` |
| `src/tribunus-client.mjs` | `8e7729d46ec0a1249f193cfa90f5bbc36b3d2ed79bd7a67a5458102275898ea0` |
| `.agents/skills/handoff/SKILL.md` (unchanged) | `4cbb043950dad2ffd3662ff1a5a0b51ae676004b5cae10e3787e8ee7a4ee69d3` |

## Real composed execution and identities

C's public **`Legion.command` / `submit` / `state`** seam created the task, production reservation/linked worktree, ordinary launch, immutable handoff and single successor. Production `LocalTribunusHost` handled inspect/initialize/assign/stop/handoff/observation, effect admission and reports over real generation-specific Unix sockets. C's real effect storage, assignment ledger/additive successor migration and guarded Git resource observations were used. Only window/bootstrap allocation and SDK startup were fixture adapters, not actual `herdr tab create` / configured-shell `pi` launch.

Both genuine SDK sessions lived in verifier PID **3061721**, boot **`8d277413-7e6d-4701-a5b0-b4dd6870a92e`**, start **`95424519`**; their session/generation identities were distinct:

| Identity | Predecessor | Successor |
| --- | --- | --- |
| Launch | `23818448-1def-4f01-9a0c-741c3630755c` | `92a1e6ae-487e-44e7-b5f6-5da17089ca0b` |
| Native session | `01a13ab2-6771-7553-9ac0-1456761e2994` | `01a13ab2-7e3e-7553-9ac0-145898181544` |
| Generation | `f2fbcf53-4ac1-40f7-a6ed-07ceb86aba15` | `1bc07f1f-7ab0-4936-a89c-a7f130730a20` |

Handoff request **`1e7aaa6c-f7dc-43b9-9958-d7c984c76564`**. `result.json` retains exact authenticated hello/process/journal locators; `commands.json` retains public outcomes. The ordinary predecessor never received a successor assignment.

### Ordered timeline — not merely final hashes

`timeline.jsonl` contains 71 ordered actual observations with identities. Its native events were captured, not emitted by the fixture. Selected sequence numbers:

| Sequence | Actual observation |
| --- | --- |
| 12–18 | Predecessor built-in Bash `dirty-work`: production ordinary admission, successful execution **exit 0**, native result/end/settlement and completed effect observation. It made a legitimate later commit, staged and then unstaged tracked changes and an untracked sentinel. |
| 19–26 | C safe-stop dispatch; real safe-stop user turn; native `agent_settled`; production instruction/park publication. Fresh authenticated resource observation: **settled**, parked same retirement, no pending messages/admission hold/outstanding children/effects. Ordinary retirement remains latched. |
| 27–35 | Actual native-expanded unchanged handoff skill; one built-in `write` `handoff-artifact`; successful native result/end with execution duration; native final reply and `agent_settled`. Separate path-only stage/effect/settlement receipts are production-generated. |
| 31, 36–43 | The actual handoff dispatch returned pending. The fixture deliberately withheld that acknowledgement from C by throwing after real dispatch. C preserved its dispatched marker; explicit same-ID continuation used **observation**, never another stage. Exact settled stage/file and native retirement were repeatedly revalidated. |
| 44–48 | Before successor startup/write authority: predecessor stage is settled, tool set empty, dirty Git unchanged. C allocates/starts exactly the saved successor; its genuine session/generation differs. |
| 59, 62–63 | Production successor assignment begins with the explicit exact-path/read-first instruction. Its **first actual tool call** is built-in `read` of that exact path, with successful persisted tool result. |
| 65–71 | Only after the successful read, successor built-in `write` `successor-continuation` writes a new `continued` file through C's ordinary admission; actual successful end, native settlement and completed effect observation follow. |

The script asserts a single open mutating-tool interval at a time, joined to actual launch/session/call identities, and no predecessor write after successor authority. Its three writer intervals are predecessor ordinary Bash **12–14**, predecessor temporary-artifact write **30–32**, successor continuation write **65–67**. Native principal and stage settlement precede sequence 44; no overlap is inferred from timestamps or hashes alone. All production native resource observations join zero children, `childrenOutstanding:false`, `childrenHeld:false`; there are no child intents. No active-child transfer or reenactment of #34's child matrix occurred. Two ordinary effects completed; the artifact never entered ordinary effect storage.

### Exact temporary path, native discovery and first read

Actual worker **`TMPDIR=TMP=TEMP=/workspaces/astraprojects/.tmp/r36-TVka/t`**. The only product handoff document remains at exactly:

```text
/workspaces/astraprojects/.tmp/r36-TVka/t/handoff-f8026ef4-388e-41c5-b81c-2e96a44fe90e.md
```

No document body is copied into this repository/document, Legion ordinary effects or another handoff store. Native journals naturally retain their ordinary prompts/tool inputs/results. The artifact is intentionally retained at its original actual temporary path, not relocated or recreated.

Pi's real resource loader discovered the original unchanged `.agents/skills/handoff/SKILL.md` directly; no fake skill command/body or skills override was supplied. Per-session `*.discovery.json` retains native skill discovery. The production handler sent `/skill:handoff Fresh context` with **“The successor will continue: Finish the label without changing preserved work”** and explicit limited-stage authorization. Native `_expandSkillCommand` ran; B's normal equality/provenance checks joined the real persisted expanded user entry and native write. Purpose/invocation/read-first evidence is in these exact native locators (paths relative to the retained root):

- Expanded unchanged skill + purpose/continuation: `sessions/2026-10-14T13-55-32-850Z_01a13ab2-6771-7553-9ac0-1456761e2994.jsonl#b441a7e0`.
- Successor production assignment, exact path and explicit read-before-work/no-reconstruction instruction: `sessions/2026-10-14T13-55-38-686Z_01a13ab2-7e3e-7553-9ac0-145898181544.jsonl#0e828489`.
- Actual first successful exact-file read result: same successor journal **`#a72e47cf`**, call `successor-first-read`. The deterministic provider checked this genuine result before emitting continuation work.

C verifies real canonical regular-file availability before allocation/dispatch; B joins actual successful native write and stage settlement. One stage and two total SDK actors were observed. No missing-file reconstruction or alternative path was attempted.

### Same dirty Git and pinned selection

Same production run-owned linked worktree:

`/workspaces/astraprojects/.tmp/r36-TVka/workspaces/bdf9dea0-98d9-406d-9ef9-df07eac2ded7`

Reservation/branch identity is unchanged. The fixture repository was initialized independently, not copied from the dirty development checkout. `dirty-before.json` / `dirty-after.json` compare exact HEAD, branch, Git registration, **index-file bytes**, tracked/untracked bytes and staged/unstaged binary diffs:

- Initial parent `a9ed5862ae8792304a9ffa86960b982d627fa808`; legitimate worker commit retained **`9c22329659345376f415176726d94c25c2384494`**.
- Index SHA-256 **`e8da0a3fd7a5ecc0c52f1747debee5d2a485866dcd7616bd86c6e79768fefaae`**.
- Dirty tracked SHA-256 **`d21c7641d0d52d03192b12be55b72960c645b6f5404964d56c84a9dbead799e8`**.
- Untracked sentinel SHA-256 **`6e876785cd64f8f73f66782493f3a1a28ec16b06207fb309440250cb81f96ea9`**.

All are identical before successor authority and after continuation. Only the authorized new `continued` file was added; preserved files/index were not reset, rewritten or discarded. Unrelated development checkout/worktrees were not controlled.

Observed predecessor and successor pins are **`handoff-local/retained`, thinking `high`, profile `matt`, requested workflow `implement`**. Before handoff, fixture checkout prospective Legion config changed to `handoff-local/future` / `low`; successor SDK default metadata also used `future` / `low`. C supplied the exact predecessor selection; actual successor session/B startup checks and assignment pins still observed `retained` / `high` / `matt`. No future poteto opt-in or machine settings edit occurred.

## Commands, original exits and setup failure

| Command / paths | True result |
| --- | --- |
| `TMPDIR=d36-3KsK TMP=... TEMP=... HANDOFF_RUNTIME=r36-1VEj node --import tsx scripts/verify-handoff.mjs` | **1**. Initial fixture incorrectly treated SDK idle as completion of asynchronous extension park publication. C correctly held unresolved retirement; no handoff/successor ran. A subsequent script assertion accessed the absent stage request. `failure.json`, `timeline.jsonl`, original log/exit and cleanup remain preserved. This is fixture synchronization failure, **not a behavioral red or product defect**. |
| Same bounded scenario, fresh `d36-6cql` / `r36-TVka`, after script-only correction | **0**, `bounded-native-handoff-passed`. The fixture now waits for actual production park and stage receipts, never manufactures them or treats idle as settlement. |
| `node --check scripts/verify-handoff.mjs`; `git diff --check`; empty staged-file assertion | **0** at final verification checkpoint. |

Root abbreviations expand under `/workspaces/astraprojects/.tmp/`. `command-exit` records the child command's actual status, not printing/tee status. SQLite's experimental warning is informational. No full suite/typecheck/build or duplicate unrelated guards ran in this lane. Exact-hash C public tests (13/13) and B addressed tests (10/10) are complementary previously established deterministic evidence in `e36C-DmqP/focused-resume-final.log` and `e36B-04tm/focused-exact-final.log`; they are not relabelled native proof. No frozen-source integration defect was found.

Reproduce only with fresh checked disk-backed roots and the documented installed composition:

```sh
d=$(mktemp -d /workspaces/astraprojects/.tmp/d36-XXXX)
r=$(mktemp -d /workspaces/astraprojects/.tmp/r36-XXXX)
TMPDIR="$d" TMP="$d" TEMP="$d" HANDOFF_RUNTIME="$r" \
  node --import tsx scripts/verify-handoff.mjs >"$d/command.log" 2>&1
rc=$?
cp "$d/command.log" "$r/command.log"
printf '%s\n' "$rc" >"$r/command-exit"
cat "$d/command.log"
# Reconcile actual sessions, tools/effects and sockets; retain r, including r/t.
# Only settled owned disposable d may be removed after evidence is readable.
exit "$rc"
```

## Controlled boundaries and remaining gates

- **Not an end-to-end installed interactive journey:** root Legatus native slash/tool correlation and real `LocalTribunusHost.createWindow/startPi` configured-shell/Herdr allocation were not executed. C's entire core public orchestration did execute against real A storage/B native handlers; its deterministic public tests complement negative transitions/lost allocation/start/application outcomes. README documents public command/native-tool use, not proof of the full installed root-tool journey.
- Herdr pane/session/process responses and SDK handler `mode:"tui"` / Trust context are explicit controlled boundaries, reused from #34/#35. No Trust prompt was encountered, answered or bypassed in a live actor. The owning Legatus is a fixture binding in the verifier, not a separate real interactive Legatus; both workers are distinct real sessions **in one PID**, not distinct terminal processes.
- Actual handoff skill discovery/expansion, all relevant native turns/user entries/tool execution and production receipt joins are genuine. The supplied pstack fork provenance is checked by production preflight, but its command discovery is controlled and pstack is not an executing second workflow controller. Native subagents are actually registered; zero are launched. This check does not prove arbitrary extension safety, an OS sandbox, `/tmp` fallback, hostile concurrent filesystem races, unavailable-auth/permission matrices, restart/owner loss, automatic Legatus replacement, #38/#40 or #41.
- Preserve all #34/#35 limitations. Their unchanged evidence supplies separate settlement/restart assumptions, not this handoff result. Missing/unknown native/file/history evidence remains a blocker, not waived acceptance.
- **Parent gates remain:** fresh independent Standards/Spec review of exact assembled candidate, final integrated suite/typecheck/build, any evidenced corrections/rechecks, then separately authorized commit/publication. This report alone does not accept/close #36.

## Storage, cleanup and retention ownership

Owner: **#36 integration-verification worker**, retained for parent/reviewer continuation. `findmnt -T` / `df -hT` confirmed workspace **ext4**, about **294G available** before writes. Command scratch had explicit TMPDIR/TMP/TEMP; script then assigned the SDK's actual temporary environment to the separate retained runtime **`r36-*/t`**, so the product document never belonged to disposable scratch. Actual caches/logs/SDK profiles/sessions/receipts/worktree/artifact locations were inspected.

Both SDK sessions were awaited idle with zero open tools, normally shut down/disposed, and their exact generation sockets plus controlled Herdr socket closed. `cleanup.json` retains these facts. Original verifier processes **3060929** (failed setup) and **3061721** (pass) no longer existed at inspection. No child processes/runs were launched. **Owned real tabs opened/closed/retained: none**; `t-0`/`t-1` are controlled fixture labels, not real Herdr IDs.

Settled owned disposable scratch **`d36-3KsK`** and **`d36-6cql`** was removed only after exact canonical/no-symlink ownership, readable retained logs/original exits and native session/socket/effect reconciliation. `scratch-cleanup` records this. Retain **`r36-1VEj`** (~784K setup diagnostics/Git/runtime) and **`r36-TVka`** (~1.2M passing Git/ledgers/native journals/evidence/**exact temporary artifact**). No runtime/Git/resource data was disposable-cleaned, and prior A/B/C/#34/#35 roots were untouched. Retention ends only when parent/reviewer continuation no longer needs the evidence and separate applicable Git/native/runtime rules permit disposal; this document transfers information, not deletion authority.

Already-running outer Pi TMPDIR/TMP/TEMP were unset; its own tool-output/runtime may still use `/tmp` (observed inspection truncation logs). That session was neither migrated nor globally reconfigured. Controlled verification writes stayed on the checked disk-backed roots. The index was empty at the native verification checkpoint.

## Final integrated acceptance

Implemented only #36 against authoritative spec #1 and the engineering policy, preserving #29–35. The Emperor approved the separate handoff-only stage after safe-stop settlement while ordinary retirement remains irreversible. Matt controlled development; poteto remained off. The handoff skill is unchanged. No automatic Legatus replacement, active-child transfer, #38 integration or #40 cleanup was added.

The final full suite ran once and passed **406/406**, with zero failures, cancellations or skips. `npm run typecheck`, `npm run build` and `git diff --check` each exited **0**. Validation run `870c227e-4933-4cb7-9b4a-2b58aefa444b` captured 680 tracked and nonignored untracked paths before and after all checks. The manifests were byte-identical, SHA-256 `9dc606bc8e74e94433ff01799e62b48805f597612d7246dca5b116a82051c8e7`. This acceptance summary was added afterward; no implementation, test or native script changed after validation.

### Independent review and native source qualification

Fresh independent reviews inspected the complete candidate, including all six new files and the native evidence:

- Standards review `62c1a7e9-c7b3-4ce5-837c-a948ee3a1e66` found two P2 items: positional helper arguments and a duplicated settlement predicate.
- Spec review `f670b7d5-5109-4f40-8f12-049300ad4703` found no issues, retaining the documented verification boundaries.
- Correction re-review `2f2d8152-75ae-4689-8b8c-100a07031361` confirmed both Standards findings resolved and no behavior, authority or receipt regression in the fix. No findings remain.

The correction changed only `src/intake.ts`: named object arguments for the new handoff helpers and one shared settlement predicate. Operand order, checks and error messages were preserved. Focused public tests passed 13/13 after the correction, followed by the full suite above. Final intake SHA-256 is `3dbf974001768fac8822e8d71e43f33df92c7dd6d37ce5adc70aa4e56841319c`.

The native invocation predates this refactor. Its source table remains the historical tested bytes, not an exact-final-source native claim. Independent comparison confirmed unchanged behavior; the native script and all other native consumers remain unchanged, so the representative scenario was not repeated. The bounded SDK/controlled Herdr/TUI limitations above remain in force. Neither the full suite nor review upgrades that evidence to #41 installed journeys.

### Retained evidence and ownership

The coordinator accepts retention responsibility for all A/B/C, native, refactor and final-validation evidence reported by this task. No task-owned real Herdr tabs remain. The full suite returned normally; its post-run readable-process census found no surviving fixture consumer. Inaccessible/racing process entries were recorded, not treated as proof of universal settlement.

Final gate logs, actual exits and manifests are in `/workspaces/astraprojects/.tmp/e36-j8C9`. Retain its `resume/` Git fixtures, separate native runtime `n36-NaWY`, and suite fixtures/journals `t36-B3p4`, all under the same temporary base. Typecheck/build/check scratch `c36-iBHf`, `b36-yKkD`, `d36-QT7g` and `a36-44UM` is retained for the final evidence audit. Refactor evidence is in `e36R-VrYg`, with focused fixtures in `d36R-Y3CS`. Do not blanket-delete suite fixtures or native journals as disposable scratch.

Earlier component evidence remains in `e36A-BJcW`, `e36B-04tm` and `e36C-DmqP`, together with the exact fixture roots listed in their retained worker reports. The native roots `r36-1VEj` and `r36-TVka`, including the original temporary handoff artifact, remain at their original locations. Preserve these until review/continuation no longer needs them; separate Git/resource and supported native-retention rules still govern disposal. Prior #34/#35 resources were untouched.

This result authorizes the requested local commit only. No push, issue closure or subsequent task was performed.
