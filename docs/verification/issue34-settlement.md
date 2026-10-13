# #34: bounded installed-native settlement verification

**Fresh final script invocation passed, true exit 0.** This establishes the bounded native facts below, not the #41 installed journey/matrix or overall feature acceptance. Parent owns integrated checks and independent review. Verification owner changed only `scripts/verify-settlement.mjs` and this document; production source/tests were frozen after the missing-Herdr-metadata P1 fix.

## Versions, source identity, and commands

Installed Pi **1.2.0**, pi-subagents **0.78.0**, Node **v22.23.1**, read-only live Herdr **0.9.1 / protocol 22**, Linux `/proc`. Provider responses were deterministic invocation-local extension streams, not paid/network inference. Actual SDK sessions, native tools, detached child runner, journals and lifecycle artifacts were used. No alternative CLI, global edits, tracker writes, staging, commits, tabs, further child nesting or full suite.

Baseline HEAD: `0d9fb0638b21d45e437043237fb4ccb1188fda2e`, with the frozen unstaged candidate. Final passing `source.json` pins:

| File | SHA-256 |
| --- | --- |
| `scripts/verify-settlement.mjs` | `89a280201b270b1389d6f8a5da736a926f4eaa37af779fa69ac66f90032aa656` |
| `src/centuriones.ts` | `47ba47ae9d934980d50c5f8ef06e5a883bd0bb2649df2853992fec3672fe7155` |
| `src/tribunus-host.ts` | `a8203b469edfa4ef78096a304f4b618d78605a15c888a3c0802652253dfa0534` |

Those bytes still matched after the run; the final script was not changed after its pass.

| Invocation | True exit | Outcome |
| --- | ---: | --- |
| `TMPDIR=/workspaces/astraprojects/.tmp/n34-Akoi TMP=... TEMP=... SETTLEMENT_RUNTIME=/workspaces/astraprojects/.tmp/r34-iscw node --import tsx scripts/verify-settlement.mjs` | 1 | Principal setup held before initialization: SDK `tools:["write"]` filtered native subagent registration. Exact error: **“Actual target resources or incarnation are unavailable. Assignment withheld. Load the pi-subagents root tool in this context.”** Zero child launches or backend entries. Diagnostics preserved; settled cleanup completed before correction/re-execution. |
| `TMPDIR=/workspaces/astraprojects/.tmp/n34-2Mi8 TMP=... TEMP=... SETTLEMENT_RUNTIME=/workspaces/astraprojects/.tmp/r34-pRH1 node --import tsx scripts/verify-settlement.mjs` | **0** | Same-protocol setup correction includes actual `subagent` registration. Principal slice passed first, then the one authorized additional native child passed. `result.json` reports `bounded-native-settlement-passed`. |

Final `node --check scripts/verify-settlement.mjs`, `git diff --check`, and empty staged-file assertion exited **0**. No focused unit suite, build, typecheck or full suite was run in this lane. SQLite emitted its normal experimental warning, not an error. The observation bounds fail visibly and neither kill work nor constitute settlement.

## Actual principal effect, draining, and park

Retained evidence root: **`/workspaces/astraprojects/.tmp/r34-pRH1`**. Principal SDK PID **2318018**, session **`01a136ce-9a38-73de-a58a-09718f5105bb`**, generation **`1ddb254d-3ea7-4cbf-8150-a2637fc08fdd`**.

- Production `installTribunus` received its normal authenticated generation-specific Unix control frames. The fixture supplied an explicit Matt/implement-spec choice, exact owner process boot/start identity and controlled Herdr pane/session identity. Normal initialization command **`068246cd-d916-4f80-be36-5da157427417`** injected the native user prompt, actually generated a bootstrap response and settled. Its applied receipt and persisted journal mode/settled witnesses came from the production handler; no initialization/assignment receipt or principal event was fabricated.
- Normal assignment command **`70548af7-4f5b-4cac-9317-05fd8098f640`** applied one minimal `bounded-implementation-only` assignment. Its receipt points to the genuine persisted SDK user entry. The provider then issued ordinary native `write` call **`principal-write`**, path `effect.txt`. Production guard produced effect intent **`a3c270de-4f75-4f54-b4f9-2d40ce731f34`** with the exact authority/task/scope/reservation/assignment/launch/session/generation/address digest and persisted assistant tool-call provenance.
- The controlled parent effect transport checked that exact production envelope, raw/prepared input, journal origin and digest, then returned an outstanding admission record through the normal response file. Production guard remained active; the fixture did not invoke the backend directly. `principal-backend-entry.json` was written **inside the actual native write tool's pluggable filesystem operation**, after admission. The operation was then gated before the filesystem write completed. `tool_execution_start` alone was never used as execution proof.
- Addressed production safe-stop command **`959f0733-f653-4d4b-9c01-2b13f0b5dc33`** arrived while that admitted backend was executing. The production response was **draining**, with the same assignment/incarnation. There was no tool end, principal `agent_settled`, report or park. `principal-draining.json` saves this snapshot.
- Releasing only the effect gate allowed the actual write and successful native tool result/end. The production completed-effect observation matches the admitted digest and names readable outcome evidence. A fixture `agent_before_settle` gate then held the real principal: actual final assistant prose and `agent_end` existed, but **no `agent_settled`**. Repeated same-stop response remained **draining** and there was still no report/park. `principal-effect-settled-only.json` separates effect completion from principal settlement.
- Releasing only the principal gate allowed genuine native `agent_settled`. Production published the same-assignment report containing the effect outcome evidence, then **parked**, with its report as park evidence. No implementation acceptance is inferred from `reported-result`.
- After parking, a new normal assignment and initialization were each **held** with **“Retiring worker cannot restore assignment authority.”** An actual custom-triggered SDK turn emitted ordinary native **`late-write`**. Production refused it before execution (`isError:true`, no execution duration, “Worker is retiring”); no second backend entry, effect request or `late.txt` occurred. The retained park receipt was unchanged. `principal-settled.json` contains the full real event sequence, control transport, admission, effect observation, report, park and late refusals.

There were five local principal provider requests across three genuine runs (bootstrap, assignment, late-refusal custom turn), two principal tool attempts in the event history: the first executed successfully; the late one was refused. **Exactly one backend execution** occurred. Extension errors and network attempt counts were zero.

## Actual native child lifecycle fields

The child slice used a separate SDK parent session, not the assigned principal above. One native model-issued ordinary `subagent` launch registered `settlement-canary`, `async:true`, fresh context, `worktree:false`, native `read` only, and no descendant delegation. Ordinary native defaults/limits remained effective. The script starts the parent prompt promise, observes pending state, releases the child gate, then awaits the prompt and exact runner proof; it does not await print-mode headless auto-drain before gate release.

Native run **`9ed53501-b9cf-486f-811e-ed23eff7defc`**, runner PID **2318826**, process instance **`1b3da069-1f6b-4d05-9076-99c91f96806c`**. Runtime path: `r34-pRH1/native/async-subagent-runs/9ed53501-b9cf-486f-811e-ed23eff7defc`. `child-pending.json` and `child-settled.json` retain observations.

- Exactly one real native `read`, matching successful tool end and journal tool result containing `Native settlement read canary.` Two child local-provider requests and two launching-parent requests; no network attempt marker.
- At the actual child `agent_before_settle` gate, `agent_start`, completed read, final prose and `agent_end` existed, but **no child `agent_settled` and no observed runner proof**. A fixture extension gated the native boundary; it did not create lifecycle events.
- After release, actual child `agent_settled`, status **complete**, lifecycle artifact version **3**, and native public `process-terminal.json` **observed**. Exactly one runner instance matches `runnerProcessInstanceId`; actual close **exit 0 / signal null**. Status's process proof equals that file.
- Native start/complete activity joins exact run, parent session locator, cwd, async directory and agent. Child events join exact `subagentRunId`, step index 0 and agent. Native status names the child journal with fixture cwd and a distinct child session; the read outcome is in that journal and no child tool remains open.

These are the real installed fields/facilities consumed by `src/centuriones.ts` (`observeActivity`, status/journal, child settlement, process proof). **This is not a prepared production Centuriones intent/projection or assigned-principal child launch.** Process proof is point-in-time termination evidence; the native proof remains `resumeDisposition:resumable`, not a claim of permanent child non-resumability.

## Explicit boundaries and non-goals

The principal ran in an actual SDK session bound in print mode; only the production handler's context was adapted to controlled `mode:"tui"` / trust, following `tests/support/native-sdk-matt-initialization.mjs`. Herdr identity/status responses, skill/pstack discovery and parent effect admission were controlled external boundaries, using existing native SDK and composed-transport patterns. The pstack discovery path was checked by production preflight against the installed unmodified supplied fork, but pstack itself was not loaded as an executing workflow controller. The fixture owner is the same live local verification process with a controlled owner-session binding, **not a distinct real Legatus**. The native write operation used the SDK's ordinary pluggable filesystem seam, not a direct effect bypass.

Therefore this passes the approved **small installed-native settlement check**, not a real full Legatus/Tribunus/Herdr/TUI/trust journey. No actual managed tab/worktree allocation, operator Trust prompt, induced owner disappearance/session loss, restart/recovery, permission matrix or #41 installed matrix was exercised. The fixed absent-Herdr-metadata owner-unresolved classification was frozen source, not separately stimulated natively here. Existing deterministic checks own races/classification; parent owns final full-suite evidence and independent acceptance review.

The script also read the real caller's existing Herdr status, pane/session and `/proc` facilities before switching to the private fixture environment. `herdr-read-only.json` retains them. No real actor was controlled/adopted; read-only availability is not proof of loss detection.

## Reproduce the final bounded script

Requires the installed versions above, the supplied pstack fork at the existing HOME-relative path, and read-only access to the current live Herdr caller facilities. Use fresh, short disk-backed roots; `versions.json` is exclusive and no alternate mode exists.

```sh
d=$(mktemp -d /workspaces/astraprojects/.tmp/n34-XXXX)
r=$(mktemp -d /workspaces/astraprojects/.tmp/r34-XXXX)
printf 'Owner: #34 native check; scratch=%s retained-runtime=%s\n' "$d" "$r"
TMPDIR="$d" TMP="$d" TEMP="$d" SETTLEMENT_RUNTIME="$r" \
  node --import tsx scripts/verify-settlement.mjs >"$d/log" 2>&1
rc=$?
cp "$d/log" "$r/command.log"
printf '%s\n' "$rc" >"$r/command-exit"
cat "$d/log"
printf 'True exit: %s\n' "$rc"
# Verify readable saved evidence, exact runner/session/socket/effect settlement,
# then remove only owned canonical scratch d. Retain r and native runtime records.
exit "$rc"
```

Invocation-local HOME/profile/provider/runtime settings never mutate live machine settings, roles or credentials. Failed observations remain failures; missing native proof prevents a cleanup claim. No cancellation, kill, mode fallback or fabricated settlement is used.

## Cleanup and retained history

Owner: worker **`d02ea3c8-ab37-46c9-aedf-9ff2be7bcb6c`**. Before writes, `findmnt -T` / `df -hT` confirmed ext4 disk-backed workspace with **296G available**. Each invocation explicitly set TMPDIR/TMP/TEMP. Actual scratch writes were tsx caches/logs under its owned directory; SDK profiles, journals, child runtime and managed artifacts resolved under the separate retained root.

Both owned scratch directories **n34-Akoi** and **n34-2Mi8** were removed after readable retained logs, actual observed native runner proof (where launched), idle/disposed SDK sessions, completed effect and closed controlled/production sockets with zero live control clients. Final PID inspection found no matching fixture process; no task-owned tabs existed. `cleanup.json` and `principal-cleanup.json` retain settlement/closure evidence. Runtime roots **r34-iscw** (~136K, exact setup failure) and **r34-pRH1** (~760K, passing evidence/runtime) are intentionally retained for coordinator/reviewer continuation; preserve until review is complete and supported native retention permits disposal. No journals or native managed state were disposable-cleaned.

Prior owner roots **r34-qK7x** (~416K) and **r34-SExf** (~584K) were preserved untouched. The earlier report at `/home/vscode/.pi/agent/sessions/--workspaces-astraprojects-matts-poteto-herdr-factory--/subagent-artifacts/outputs/568d373c-b1ae-4e5a-8005-ced184c1ab46/issue34-native.md` records three historical overall exit1 attempts: initial print-mode gate synchronization failure, passed child slice followed by principal backend precondition failure, then principal-only refusal **“Managed tools require the applied bounded assignment.”** Those are setup failures/partial child evidence, not passes or product reds. The fresh final invocation above supplies the previously missing genuine applied assignment and actual principal effect/stop/park facts without reclassifying the old failures.

The running outer Pi session had unset TMPDIR/TMP/TEMP/PI_SUBAGENTS_TEMP_ROOT; its existing runtime remains potentially `/tmp`-routed and untouched. All controlled verification writes used the checked disk-backed destinations. Final staged-file list was empty at the native verification checkpoint.

## Final integrated acceptance

Implemented only #34 against authoritative spec #1 and the engineering policy, preserving #29–33. Matt controlled implementation; poteto remained off. No new resume, handoff, cleanup, automatic Legatus replacement, active-child transfer, kill deadlines or proof engine was added.

Final `npm test` passed **345/345**, with zero failures, cancellations or skips. `npm run typecheck`, `npm run build` and `git diff --check` each exited **0**. Validation run `4dc6d299-5e6d-4129-a098-b0ef01ce0c21` checked the exact diff against baseline `0d9fb0638b21d45e437043237fb4ccb1188fda2e`, restricted to `src tests README.md`. Its SHA-256 was unchanged before and after all checks: `92bb811100cbd3542d0cc3c63493ac729a12b698c6bdc9be44afb34406722857`. No source, test or native script changed afterward. This acceptance summary was added after validation.

The native script and its two consumer hashes above still match the passing native invocation. Later intake fixes did not alter those native lifecycle assumptions, so the bounded native check was not replayed. Its stated external boundaries remain limitations; this is not #41 acceptance.

### Independent review

Fresh Standards and Spec reviews inspected the source/test candidate independently. Follow-up reviews checked each accepted correction and its affected behavior. No findings remain:

- Standards: **OK**, final recheck `9a1a69d5-982b-4bf2-b0cd-d9adaf319b0b`.
- Spec: **OK**, final recheck `50f10689-907a-449c-a70e-e6f855326444`.
- Native script and evidence, both axes: **OK**, `6d66a354-eaa1-468e-b80d-17aed4654770`.

Review caught missing Herdr metadata being treated as proven owner loss, writes from status/doctor, recovery checking the wrong aggregate, and addressed status omitting unresolved workers. Regressions now establish sticky unknown-owner holds, read-only observation, fresh-session refusal before modifying unresolved shutdown, and consistent stopping status. Actual lifecycle completion or repeated explicit off owns shutdown reconciliation. If persistence fails and no lifecycle event remains, observation exposes a blocker without repairing storage.

### Integrated failures resolved

The first full suite failed 16 tests. Diagnosis distinguished actual finalization defects from asynchronous test assertions, obsolete off-then-resume setups, missing owner evidence in the native SDK fixture, and added durable-write cost. Fixes preserve the original model/thinking/profile pins, ownership, initialization identity and no-replay assertions. Historical pre-shutdown fixtures exercise existing recovery without clearing a real actor's retirement. Native initialization fixtures now provide exact owner identity rather than bypassing the guard.

Pending shutdown identity survives failed storage publication within the current controller. Established unknown work retains ownership; positively no-work aborted initial creation can release its completed lease without acknowledging input. An activation epoch guard preserves a concurrent off after the initial commit. Empty or unchanged worker targets no longer cause redundant durable writes. All three existing lock censuses pass with their original **500 rounds and timeouts**, including zero dual-owner or zero-owner rounds. No timeout or count was relaxed. One incomplete instrumented diagnosis probe remains historical incomplete evidence, not a pass or a claimed repaired defect.

An intermediate 344/344 suite passed before the final observation/recovery fixes; the 345/345 result above supersedes it. Earlier failed native setup invocations retain their original exit codes.

### Retained evidence and ownership

The coordinator accepts retention responsibility for the task's evidence and runtime. No task-owned Herdr tabs or live test actors remain. Disposable data was removed after command settlement where it was no longer needed; native journals and managed records remain at their original locations.

Final gate logs and identity receipts are in `/workspaces/astraprojects/.tmp/eG-SqUP`. Native managed history is in `/workspaces/astraprojects/.tmp/rG-DhmD`; the retained SDK fixture is `/workspaces/astraprojects/.tmp/tG-HCB2/legion-native-sdk-denial-7zOK8f`. Preserve these and the native roots listed above until evidence is no longer needed and supported native retention permits disposal.

Earlier failure/diagnosis evidence remains in `i34e-ADfmHn` and `d34-SgjQq1` under the same temporary base. Component correction manifests and exact owned paths are recorded in `nB-pjNx/manifest` and the saved Owner A report for `nA-yaNO`, `nA-SsK9`, `nA-e4cv`, `nA-2pq3`. Intermediate successful gate evidence is in `ev-nHaBPk`, with native journals retained in `t-puZm`. These are retained for publication follow-up and failure traceability, not abandoned active work. Recheck consumers and separate disposable evidence from native runtime before later removal. No unrelated temporary data, branches, worktrees or global configuration were removed.

This checkpoint authorizes no push, issue closure or subsequent task. Those actions remain separate from the requested local commit.
