## Standards rereview

Merge verdict: **OK with notes, Standards axis only**. Both original P1 findings are resolved. No remaining P0/P1/P2 documented-standard breach or actionable heuristic smell in the remediation.

Users receive completed and failed reports without repeated assignment. Maintainers retain the existing addressed application/result protocol.

- `src/tribunus-host.ts:32-60` fsyncs private staging bytes before exclusive hard-link publication. Independent writer-preemption regression passes. Additional collision probes preserve existing bytes, reject conflicting or malformed finals and symlinks, and remove staging. Deliberately corrupt final files must still hold.
- `src/tribunus-host.ts:439-455` publishes bounded, addressed `failed` reports for error/aborted assignments and clears the active operation. Real receiver/public-state regressions pass, including duplicate settlement and command delivery. Failed initialization remains unapproved; incarnation and manual-control checks remain effective.

All 40 manifest hashes and digest `72fb8e1c6216613e8319914b6230f179f081a12ec62441f2d141332a4c59b6b5` match. HEAD remains `f24bc6e72e0d4d916b02de7244987cbfeb4c86ef`. A hash-matched pre-fix source recovered from the original transcript confirms one production-file delta and two added test files. Publication affects all worker evidence; launch authority, ledger, transport, and old tests remain byte-identical. Changed comments/suppressions: **zero**.

Original findings are preserved at `/tmp/legion-t03-standards-rereview/standards-original.md`. That directory also holds the exact diff, probes, and logs. Independent pre-fix replay fails all three new assertions; fixed-source checks pass. Read-only live verification confirms one retained worker/start, native initialization, public reporting, and unchanged prior launch rows. Its output was redirected outside preserved runtime artifacts.

Prove It Works required independent red/green replay. Boundary Discipline required collision and corruption checks. Model the Domain and Type System Discipline retained separate application and typed result evidence.

```acceptance-report
{
  "criteriaSatisfied": [{"id":"criterion-1","status":"satisfied","evidence":"Both findings independently verified fixed."}],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command":"npm test","result":"passed","summary":"102/102."},
    {"command":"node --import tsx --test tests/tribunus-reports.test.ts tests/launch.test.ts tests/launch-script.test.ts","result":"passed","summary":"23/23."},
    {"command":"npm run typecheck","result":"passed","summary":"Clean."},
    {"command":"cd /tmp/legion-t03-standards-rereview/pre-fix && node --import tsx --test tests/tribunus-reports.test.ts","result":"failed","summary":"Expected three original failures."},
    {"command":"node /tmp/legion-t03-standards-rereview/publication-boundary.mjs","result":"passed","summary":"Eight boundary checks."},
    {"command":"node --import tsx /tmp/legion-t03-standards-rereview/verify-live-readonly.mjs /tmp/legion-t03-writer-live/remediation docs/verification/t03-local-tribunus/source-manifest.json","result":"passed","summary":"Retained live evidence verified."}
  ],
  "validationOutput": ["40 hashes verified; zero comments/suppressions."],
  "residualRisks": ["Earlier parent 98/99 inherited publication-race result and original 78/79 contention remain unresolved. Controlled baseline scheduling was not a natural reproduction. Twelve approved TDD exceptions remain. Finite local checks do not prove power-loss durability."],
  "noStagedFiles": true,
  "diffSummary": "Review artifacts only.",
  "reviewFindings": ["No remaining targeted blockers."],
  "manualNotes": "No source edits, live control, new Pi workers, settings changes, or publication. Parent owns acceptance."
}
```
