## Spec rereview

**Merge verdict. Pass the targeted Spec rereview.** Both original findings are resolved. No remaining P0/P1/P2 finding in this remediation. Parent owns overall acceptance.

Original findings remain separately preserved in `/tmp/t03-spec-original-review.md`.

- **P1 resolved.** `src/tribunus-host.ts:443-454` publishes addressed failed reports for errors and aborts, retains application evidence, and clears the settled operation. Operators now see failures instead of an indefinitely assigned task. Actual receiver/public-seam tests verify separate application/result evidence and duplicate delivery/settlement. Independent probes also verify failed initialization cannot authorize assignment, and manual or changed-incarnation settlement cannot publish a result.
- **P2 resolved.** `src/tribunus-host.ts:32-60` writes and fsyncs private staging bytes before linking the immutable final pathname. The real writer-preemption/public-watcher regression passes. Maintainers retain strict corruption handling without reader retries. My deliberately empty-final-file probe still produces the required preserved hold.

## Source identity

All 40 fixed-manifest hashes match `72fb8e1c6216613e8319914b6230f179f081a12ec62441f2d141332a4c59b6b5`. Comparing the original `863f49e036a0104bdf58b30638e053e1c726ad4181994bee0c4e3ac8b01ac53e` manifest confirms only `src/tribunus-host.ts` changed among existing source files. Its exact pre-fix bytes were verified before diff review.

## Checks and limits

Independently passed 23 launch/report tests, typecheck, six receiver scenarios, corrupt-final preservation, seven observer replay cases, and retained fixed-source live verification. Worker `w9:p1` has one start, native initialization before assignment, normal model defaults, and the correlated public `reported` result. Earlier launch rows remain unchanged.

Full-suite history remains explicit. Parent pre-fix checks were 98/99 due to the separately classified inherited pending-identity publication race, reproduced on base only with a scheduling delay. Writer fixed-source checks were 102/102. I did not rerun the full suite. Neither that race nor earlier SQLite contention was fixed or silently waived. Twelve approved TDD exceptions remain.

```acceptance-report
{
  "criteriaSatisfied": [{"id":"criterion-1","status":"satisfied","evidence":"Both original defects resolved with independent receiver, public-state, and retained-live checks."}],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command":"node --import tsx --test tests/tribunus-reports.test.ts tests/launch.test.ts tests/launch-script.test.ts","result":"passed","summary":"23/23."},
    {"command":"npm run typecheck","result":"passed","summary":"No errors."},
    {"command":"node --import tsx scripts/verify-launch-evidence.mjs /tmp/legion-t03-writer-live/remediation docs/verification/t03-local-tribunus/source-manifest.json","result":"passed","summary":"One fixed-source worker; public result verified."},
    {"command":"node --import tsx scripts/replay-launch-observer.mjs /tmp/legion-t03-writer-live/remediation","result":"passed","summary":"Seven cases."},
    {"command":"for scenario in error aborted init-error init-aborted manual incarnation; do SCENARIO=$scenario node --import tsx /tmp/t03-spec-probes/fixed-receiver-scenarios.mjs; done","result":"passed","summary":"Six independent safeguard scenarios."},
    {"command":"node --import tsx /tmp/t03-spec-probes/fixed-corrupt-final.mts","result":"passed","summary":"Malformed final evidence remains held."}
  ],
  "validationOutput": ["Logs /tmp/t03-spec-rereview-{tests,typecheck,live,replay,scenarios,corrupt}.txt."],
  "residualRisks": ["Inherited baseline failures remain separate. No power-loss or malicious-extension guarantees."],
  "noStagedFiles": true,
  "diffSummary": "Review artifact updated; original preserved; project unchanged.",
  "reviewFindings": ["Original P1 and P2 resolved; no remaining remediation blockers."],
  "manualNotes": "Model the Domain separated application from result. Prove It Works required independent probes and actual retained evidence. Type System Discipline guided failure-schema checks. No live control."
}
```
