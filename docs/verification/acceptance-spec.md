# Spec review

Merge verdict: **OK with notes** at `4f44565252f87cbab9782a1e1d7af601d3d4f9c1`, against `f211b26b7556ea1ed869571fc74d9cb6cbd84434`.

No concrete current P0/P1/P2 findings. Users retain one intake owner. Maintainers inherit a scoped writer reservation without retries or factory caps.

All ten criteria were rechecked:

- 1, 2, 5, 6. Isolated installation remains inactive, preserves model/settings, retains exact intent and stable identity, and fabricates no tickets.
- 3, 4. Completion works. Status/doctor remain model-free and byte-preserving. Missing resources and disabled SQLite are diagnosed. Tested versions remain explicit.
- 7, 8. Affected work blocks, protected amendments require presented revisions, and recommendations persist in chat. Ordinary answers resolve decisions without modals.
- 9, 10. Busy independent submissions remain durable and admissible. Routing ambiguity requests clarification instead of changing assignments.

Independent public census reproduced the parent's former defect on isolated `a7ae698` source with **118/1,000 zero-owner rounds**. HEAD passed 2,000 fresh, 1,500 task-bearing, and 1,500 initialized rounds with exactly one winner and one rejection. Another 3,000 initialized rounds with immediate observations passed. Native controls refuted deletion-only `BEGIN EXCLUSIVE`. `BEGIN IMMEDIATE` passed 300 rounds. The exactly-one assertion is unchanged.

Three independent `verify:pi` runs passed 19 checks and 45 requests each. RPC inspection confirmed activation/resume contention, rejected peers without receipts/turns, and inactive same-ID restarts. Terminal answers worked. Evidence is `/tmp/legion-pi-PYRhsC/{rpc.json,tui.txt}`. Tests passed 48/48. Typecheck, isolated build, and 22 manifest hashes passed.

Selected-provider evidence matches its original artifact. Interpreter instructions, proposal/effect schemas, preflight, and provider verifier remain unchanged. No credentialed trial reran.

The approved TDD exception remains disclosed. Mutation may remove only the identified association journal. History, crash release, identity isolation, malformed metadata, and read-only boundaries remain protected.

Prove It Works required independent runtime and baseline reproduction. Test Behavior, Not Implementation required exact receipts, owners, identity, and bytes.

```acceptance-report
{
  "criteriaSatisfied": [{"id":"criterion-1","status":"satisfied","evidence":"Independent spec review, runtime repetitions, baseline red, and HEAD stress."}],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command":"npm test; npm run typecheck; npm run build -- --outDir /tmp/legion-t01/lock-spec-independent-build","result":"passed","summary":"48 tests; typecheck/build passed."},
    {"command":"npm run verify:pi, repeated three times","result":"passed","summary":"19 checks and 45 requests each."},
    {"command":"Independent startup censuses and native controls","result":"passed","summary":"HEAD 8,000 rounds; baseline reproduced 118 zero owners."}
  ],
  "validationOutput": ["Evidence /tmp/legion-t01/lock-spec-independent-*"],
  "residualRisks": ["Earlier collector's single initialized failure remains unclassified; finite stress cannot prove universal liveness or power-loss safety.","Accepted Pi provenance/attachment limits and representative model semantics remain."],
  "noStagedFiles": true,
  "diffSummary": "Read-only review; no repository changes.",
  "reviewFindings": ["No current P0/P1/P2 findings."],
  "manualNotes": "HEAD and clean index/worktree reconfirmed. No credentials used. Parent owns final acceptance."
}
```
