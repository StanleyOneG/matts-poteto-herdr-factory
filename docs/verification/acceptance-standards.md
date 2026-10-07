## Standards

No concrete current P0/P1/P2 findings against the documented standards or Fowler baseline.

Merge verdict: **OK with notes** at `4f44565252f87cbab9782a1e1d7af601d3d4f9c1`, reviewed against `f211b26b7556ea1ed869571fc74d9cb6cbd84434`.

Consumers retain one intake owner without lease-schema promotion. Maintainers inherit a bounded SQL change and reproducible causal checks. The paired association/aggregate leases retain acquisition order, reverse release, crash release, identity isolation, and fail-closed receipts. Aggregate durability and interpretation authority remain unchanged. The journal exception permits only the identified operational association journal deletion after mutation. Observation still preserves every byte.

**Prove It Works** changed the review from trusting reports to independent replay. The final collector reproduced 86/1,000 zero-owner rounds on verified baseline source. HEAD passed 2,000 fresh and 1,000 initialized rounds. Two additional inline-observation runs passed 3,600 initialized rounds against byte-identical HEAD production source. Native exclusive-only acquisition failed 73/500 rounds; immediate-only passed 500/500. Assertions still require exactly one owner.

All 48 tests, typecheck, build, and two unchanged actual RPC/TUI runs passed. I inspected the resulting ownership, rejected-peer, restart, and terminal records in `/tmp/legion-pi-uhd2Sb` and `/tmp/legion-pi-NEnO2G`. Each runtime covered 19 groups and 45 requests. All 22 manifest entries match. The trail remains append-only; the TDD exception and historical provider evidence remain intact.

The earlier unexplained initialized zero-owner event remains a qualification, not a proven collector defect. Finite local stress does not prove universal liveness or power-loss durability. Existing Pi/provider limitations remain.

```acceptance-report
{
  "criteriaSatisfied": [{"id":"criterion-1","status":"satisfied","evidence":"Independent standards review and causal replay at the exact SHA."}],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command":"npm test","result":"passed","summary":"48 tests"},
    {"command":"npm run typecheck && npm run build","result":"passed","summary":"Both passed"},
    {"command":"npm run verify:pi, twice","result":"passed","summary":"19 groups each"},
    {"command":"baseline census, 1000 fresh","result":"failed","summary":"Expected red, 86 zero owners"},
    {"command":"HEAD census and native probes","result":"passed","summary":"Results above"}
  ],
  "validationOutput": ["No weakened exactly-one-owner assertion."],
  "residualRisks": ["Earlier initialized event remains unexplained; finite platform coverage."],
  "noStagedFiles": true,
  "diffSummary": "Review only. No repository edits.",
  "reviewFindings": ["No current P0/P1/P2 findings."],
  "manualNotes": "Inspected actual source, regression assertions, runtime records, manifests, and historical evidence. No credentialed trial."
}
```
