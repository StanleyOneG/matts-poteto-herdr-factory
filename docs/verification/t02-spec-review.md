## Spec rereview

R1 and R2 are resolved. No remaining reachable P0/P1/P2 defect identified in the corrections or reviewed execution flow.

- **R1 resolved.** `src/intake.ts:365-387,580-587` rechecks authority after storage awaits and immediately before acquiring invocation protection, without an intervening await. This satisfies "Off immediately revokes and remains stopping while any invocation settles." The preserved real-Git reproduction passed 70 microtask cuts. All 46 held receipts retained stopping and refused replacement ownership. No discovery started after off. Fresh parent and workspace inspections now recheck authority; dispatched outcomes still settle under retained protection.
- **R2 resolved.** `src/intake.ts:952-958` retains local stopping when snapshot reads fail. The real-Git corruption reproduction returned stopping with the storage diagnostic, remained stopping after restoration, and became inactive only after settlement. This satisfies parent story 70's "visible stopping state until the shutdown conditions are met."
- **Contention verified.** `tests/workspace-git.test.ts:321-599` starts distinct processes behind FIFO barriers. My release-together run observed an actual SQLite busy loser, preserved its exact request, fingerprint, and payload, then recovered the same owner's blocker through explicit resume and fresh reserve. No duplicate refs or worktrees appeared. The held-dispatch schedule returned that blocker before the winner's invocation settled. Dirty and unrelated work remained preserved. This meets the approved fail-closed recovery policy without automatic waiting or retry.

Verified all 31 manifest entries. Reviewed identity is `aee01e4cbda23e8e20532195526127cc4d354b8f0ef1c6523b6c84bd2ad9b255`. Independently confirmed the five changed reviewed files and two added reproductions match the declared delta. No source edits or architectural extraction.

### References

- Scope and delta. `docs/verification/t02-results.md`, `docs/verification/t02-review-fixes-source-delta.txt`.
- R1/R2 reruns. `/tmp/t02-spec-rereview-r1.txt`, `/tmp/t02-spec-rereview-r2.txt`.
- Tests and manifest. `/tmp/t02-spec-rereview-focused.txt`, `/tmp/t02-spec-rereview-all-tests.txt`, `/tmp/t02-spec-rereview-manifest.txt`.

Merge verdict OK with notes. Controlled public-module scheduling is not an exact live-Pi race reproduction.

```acceptance-report
{
  "criteriaSatisfied": [{"id":"criterion-1","status":"satisfied","evidence":"R1/R2 closed by independent reruns; both process-contention schedules passed."}],
  "changedFiles": ["/home/vscode/.pi/agent/sessions/--workspaces-astraprojects-matts-poteto-herdr-factory--/subagent-artifacts/outputs/771f57f8-3cc2-44d2-8cbf-cea5d56a2c09/review/spec.md"],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command":"npm test","result":"passed","summary":"79 passed."},
    {"command":"npm run typecheck","result":"passed","summary":"No errors."},
    {"command":"sha256sum -c docs/verification/t02-implementation.sha256","result":"passed","summary":"31 verified."}
  ],
  "validationOutput": ["31 focused tests, both retained reproductions, and git diff --check passed."],
  "residualRisks": ["No live-Pi race rerun or power-loss proof; unknown completion remains blocked."],
  "noStagedFiles": true,
  "diffSummary": "Report replaced; repository unchanged.",
  "reviewFindings": ["R1 resolved", "R2 resolved", "No remaining P0/P1/P2 identified"],
  "manualNotes": "Prove It Works required reruns and actual process overlap. Model the Domain kept invocation protection distinct from durable ownership. Maintainers retain regression evidence."
}
```
