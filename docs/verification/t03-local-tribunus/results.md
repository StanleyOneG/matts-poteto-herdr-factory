# T03 targeted report remediation

The two accepted report defects are fixed and ready for targeted independent rereview. Parent acceptance and publication remain pending. No commit, push, integration, cleanup, or issue closure occurred.

## Defects and fixes

Worker evidence publication previously created the final pathname before writing JSON. The real watcher could parse empty bytes and permanently hold an eventual valid result. `src/tribunus-host.ts` now writes and fsyncs a unique private staging file, links completed bytes into the immutable final path without replacing existing evidence, checks collisions and conflicts, removes staging, and fsyncs the directory. Malformed final evidence remains held. There is no reader retry. AssignmentLedger identity publication is unchanged.

Failed or aborted assignment settlement previously resolved an already-resolved application promise. No result reached the controller, and the operation stayed active. The receiver now publishes an addressed `failed` outcome with bounded error or abort text and its actual assistant journal reference. It clears the completed active operation. Application remains distinct from result. Duplicate settlement and duplicate command delivery do not repeat assignment. Failed initialization still resolves without successful initialization evidence. Manual-input and generation checks remain required.

The organizing structures remain immutable completed evidence and the existing addressed application/result lifecycle. No new dispatcher, production fault toggle, retry policy, or Legion runtime cap was added.

## Red before green

`tests/tribunus-reports.test.ts` drives the public Legion command, submit, and state operations through the actual receiver and report watcher. Its external receiver fixture uses a disposable SDK event context and local transport without credentials or a model request. It is not a live Pi worker.

- Controlled preemption of the actual writer failed with `held !== reported`, then passed after completed-byte publication.
- Error settlement failed with `assigned !== reported`, then passed with an explicit failed result.
- Aborted settlement failed with `assigned !== reported`, then passed with an explicit failed result.

Both settlement cases duplicate the settled callback and command delivery. They assert the original application remains, the addressed report is visible, and the assignment is not repeated. The writer-preemption case also explicitly reconciles without losing its result. `tests/support/tribunus-receiver.mjs` supplies only external scheduling and settlement stimuli. Production has no fault toggle.

[The remediation evidence index](remediation-evidence.json) identifies red/green logs and the original reviewer probes. All original probes were rerun. The two manual-empty-final-file probes still establish the expected corrupt-evidence hold. They deliberately bypass the writer and are not atomic-writer regressions. One top-level-await probe needed a test-only liveness timer because its watcher is unreferenced. The old source-extracted callback probe no longer runs unchanged because its local closure omits required receiver dependencies. The original failed-worker probe now fails its old no-report assertion because a failure report exists. Its minimally updated external expectation passes. The three retained public-seam tests provide the authoritative regression checks.

## Fixed-source live verification

One newly authorized managed trial reused the exact known alias controller under its existing leases. Only the reviewed observer's target literals changed. The exact diff, resolved target, seven-case pre-launch calibration, and registration/context diagnostics preceded launch. Original starts remained untouched.

The new task is `ea9ba5f0-8c93-4e95-b4c1-e4b4153fcab3@1`. Reservation is `525af25e-967c-40d1-a59a-25ea9fa80ee0`. Attempt is `0b0ccfe8-95c3-42c2-8a10-bf524bd5f8bd`. Its scope is `161c7b8e7719323806bea6833b1a2c32c0020c3d9c5226c5151cb51d8532e9ce`.

The successful original start was fsynced before the actual consumer received unknown completion. Its one worker is `w9:p1`, terminal `term_65d4aef9e60bc59`, Pi PID `1679856`, session `01a11953-e0fd-72bd-bd45-6f95e3e7563a`. Its exact clean owned worktree is `/home/vscode/.pi/agent/legion/workspaces/f55b47dc-0172-439c-9a41-1644dfa23358`. Standard trust-prompt and known-resource checks preceded preapproved session-only trust. No parent-folder or persistent trust was granted.

The same attempt reconciled without another start. Actual native user entry `5493769e`, fresh enabled pstack entry `2bdc2eb4`, and successful initialization settlement `84ed8530` precede one bounded assignment application `9d74898d`. The only tool call is `pwd`, after assignment. Final report `60f005b9` identifies the exact worktree. Public status and `Legion.state()` both report `reported`. Original uncertain startup evidence remains visible. Actual assistant messages use normal `openai-codex/gpt-6-astra` defaults with medium thinking.

[Fixed-source evidence](fixed-source-evidence.json) verifies canonical native content, journal ordering, one actual nested start, one persisted start intent, one worker, the same PID, public report, exact source hashes, and byte-identical earlier launch rows. [The fixed target](fixed-source-target.json), [literal rebinding](fixed-observer-rebinding.diff), and [actual-hook replay](fixed-live-replay.json) retain the bounded instrumentation evidence. No capabilities or full native prompt are copied into these summaries.

Repeatable observation commands use the existing preserved trial and do not launch, trust, activate, reload, assign, or clean up.

```sh
node --import tsx scripts/verify-launch-evidence.mjs /tmp/legion-t03-writer-live/remediation docs/verification/t03-local-tribunus/source-manifest.json
node --import tsx scripts/replay-launch-observer.mjs /tmp/legion-t03-writer-live/remediation
node --import tsx --test tests/tribunus-reports.test.ts
```

## Source, checks, and history

[The fixed-source manifest](source-manifest.json) records digest `72fb8e1c6216613e8319914b6230f179f081a12ec62441f2d141332a4c59b6b5`. It was captured before the fixed-source live trial. Source has not changed afterward. HEAD remains `f24bc6e72e0d4d916b02de7244987cbfeb4c86ef` on `legion/t03-verified-local-tribunus`.

[Pre-fix results](pre-fix/results.md), [pre-fix source](pre-fix/source-manifest.json), [pre-fix checks](pre-fix/checks.json), and [pre-fix live evidence](pre-fix/lost-receipt-evidence.json) remain historical proof for digest `863f49e036a0104bdf58b30638e053e1c726ad4181994bee0c4e3ac8b01ac53e`. They are not fixed-source acceptance. Earlier ordinary and lost-receipt histories remain at their original paths. They were not overwritten or assigned new source identities.

Parent review's pre-fix full suite failed 98 of 99. [The exact triage](pre-fix/parent-publication-race-triage.md) identifies inherited `assignments.pending` publication under a controlled base-source schedule. This differs from the earlier zero-owner SQLite contention. Twenty naturally scheduled base probes did not reproduce that JSON shape. The parent log remains `/tmp/legion-t03-parent-review/tests.txt`. Later 102-of-102 writer checks do not erase either inherited baseline result. Neither identity publication nor #24 was changed, and no old test was weakened.

[Final checks](checks.json) include typecheck, build, full suite, packaging, real evidence verification, captured-hook replay, and configuration preservation. [The actor inventory](actors.json) preserves all six pre-fix actors and the one new fixed-source worker. No cleanup or lease takeover occurred. [The finite TDD exception index](tdd-exceptions.json) still contains exactly twelve approved green-first alternatives. This remediation adds no TDD exception. [The decision trail](decisions.tsv) records the scope and sequencing.

Verification remains local and version-specific. `reported` is not accepted work, integration acceptance, or Centurio completion. There is no claim of power-loss durability, a malicious-extension sandbox, automatic worker draining, or contention recovery. Fresh targeted independent review remains parent-owned.
