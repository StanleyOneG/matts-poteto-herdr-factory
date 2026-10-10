# T04 checkpoint before requirements review

## Status and authority

This is a work-in-progress preservation checkpoint for [#5](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/5), under [spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1). It is not implementation acceptance or authority to close the issue.

The operator requested a status record, commit and push, then a pause for another grilling session to reconsider the product requirements. Do not continue implementation or launch more live trials until that discussion establishes the next assignment. The checkpoint is on the existing `main` branch, based on `fdfc401c3234c9fca9494504c0a15b21f6513574`. Publication preserves unfinished work; it does not establish the required final review or integration acceptance.

## Latest product clarification

The main workflow remains:

1. The Legatus assigns bounded implementation work to a Tribunus in a new Herdr tab in the Legatus's workspace.
2. That Tribunus can launch its own Centuriones through pi-subagents.
3. The Legatus coordinates decisions and acceptance. It does not replace the Tribunus with its own implementation child.

Substantial preparatory research is optional. For this research, the operator explicitly wants **ordinary agent interaction with pi-subagents**, including normal native completion notifications and model turns. Do not introduce a separate notification-suppression mechanism or change pi-subagents to avoid those turns.

This supersedes the previous proposed research no-wake requirement and the dependency blocker derived from it. It does not silently change the Tribunus execution/reporting contract. Do not treat native notification prose as independent proof of child lifecycle.

**The code has not yet been simplified to match this clarification.** It still contains the specialized `/legion research` composition, dispatch and notification filtering. Reconsider that machinery against the ordinary-interaction requirement before editing; do not assume the next task is merely to remove one conditional.

## Implemented and checked so far

These are bounded results, not acceptance of the complete ticket:

- Corrected offline Tribunus IPC fixtures and preserved diagnostic failures. The focused 13-test run passed, with independent review.
- Added shared owned-child tracking through native pi-subagents. Transient missing terminal proof can reconcile; actual identity contradictions remain held. Notifications are not lifecycle authority.
- Added writable Centuriones in retained isolated Git worktrees/branches. Native pi-subagents remains the executor; workspace preparation is not a second executor or filesystem sandbox.
- Corrected native read/edit argument normalization without discarding original journal provenance.
- Enabled actual writable child skill inheritance. Deferred the Tribunus's final report until independently observed child/effect settlement, rather than treating the principal's settled turn as child completion.
- Tightened writable verification to join exact calls, results, resource ranges, exits and independently corroborated journals.
- Completed a real native writable trial in fixture `wc-d613a31b`. It exercised actual skill loading, meaningful assertion red/green, a normal denied write, isolated retained changes and delayed reporting. Independent review accepted this bounded result. **Its seam approval was controlled fixture input, not an actual Legatus model decision.**
- Implemented and exercised native Legatus preparatory research in fixture `lr-3d1cf9ca`, through the public command and configured exploration role. This implementation now needs simplification under the operator's clarification above.
- Fixed research cleanup after safe `/legion off`. It disposes owned runtime registrations and sockets without releasing unresolved children. Independent review accepted this correction. The later concern about an unavoidable native completion turn is superseded by the operator's clarification, not fixed by a new API.
- Added development-tab cleanup policy. Closed 11 verified settled task-owned test tabs across the writable and research work. Retained journals, worktrees, branches and dirty files; preserved unrelated actors and the coordinator.

## Verification limits

| Evidence | Result and scope |
| --- | --- |
| Research-off correction | 140/140 focused regressions passed; typecheck passed. Covers research, intake, transport composition, shared child runtime, read-only effects and Tribunus reports. |
| Correction red/green | Both safe-off scenarios failed against pinned pre-fix source and passed against corrected source. Independent reviewer inspected the receipts. |
| Native writable trial | Genuine native execution and bounded acceptance, with controlled approval only. |
| Native research trial | Genuine command-origin native research; historical trial precedes the cleanup correction and latest requirement clarification. |
| Last recorded full suite | 226 tests: 212 passed, 11 failed, 3 cancelled. This remains a failed run. |
| Isolated historical failures | Association 6/6 and lock-startup 3/3 passed in isolation. This neither proves the full-suite cause nor waives it. |
| Publication checkpoint | Parent ran `npm run typecheck`, `npm run build` and `git diff --check`; all exited 0. No fresh full suite or whole-deliverable review was run for this preservation commit. |

## Remaining work before #5 can close

Revalidate this list after grilling and update the authoritative requirements before resuming.

- [ ] Simplify the Legatus research path to ordinary pi-subagents interaction. Verify normal notifications, ordinary post-off use and required child tracking without retaining an unnecessary parallel control protocol.
- [ ] Perform a representative integrated disposable change with a **real Legatus-origin seam approval**, a real managed Tribunus, actual Matt/pstack resource loading and behavior-first red/green evidence.
- [ ] Exercise a necessary TDD exception with actual Legatus approval, a durable rationale and meaningful alternative verification carried into the final result. No self-approval or meaningless substitute test.
- [ ] Verify distinct `matt-tdd`/`matt-teach` names and actionable refusal when required resources are absent or incompatible on the final composition.
- [ ] Verify final role-model selection, owned native child identities, independently observed lifecycle/result references, and protocol refusals through the agreed public command/task/state seam. Earlier partial evidence is reusable only where its source and assumptions remain applicable.
- [ ] Diagnose remaining full-suite failures. Run the complete tests, typecheck and build against the final source, preserving true exit codes and failed evidence.
- [ ] Obtain fresh-context independent review of the whole deliverable against both repository standards and the final approved spec. Resolve valid findings and recheck affected behavior.
- [ ] Record sanitized acceptance evidence tied to the tested source and accepted commit. Verify required integration/publication, then close #5. The preservation push does not satisfy these acceptance steps by itself.

## Evidence and preservation

The checkpoint commits current implementation, tests, verification scripts, README, development policy and this status record. It deliberately does not publish raw private runtime journals, capabilities, local evidence archives or copied historical source trees.

The following evidence remains **local and is not backed up by this Git push**:

- `/tmp/legion-t04-completion-plan.md`: detailed chronological coordinator decisions. This checkpoint's latest operator clarification and pause supersede its earlier continuation/no-wake instructions.
- `/tmp/legion-t04-final-live/`: accepted bounded writable trial and parent correction for the omitted `contact_supervisor` refusal. No guard relaxation or replay was needed.
- `/tmp/legion-t04-research-off-fix/`: exact before/after source, assertion reds/greens, 140-test receipts, API evidence and preservation manifests.
- `/tmp/legion-t04-suite-diagnosis/`: isolated association and lock-startup results, not a full-suite pass.
- `/tmp/legion-t04-tab-cleanup/`: verified closure receipts for the first ten test tabs. The research worker separately retained its eleventh closure receipt.
- `/tmp/legion-t04-publication-checkpoint/`: publication typecheck/build exits and staging manifest.
- `docs/verification/t04-owned-centuriones/`: untracked historical evidence and copied source, preserved locally, not included wholesale in this commit.
- Pi session subagent artifacts for workflows `9aac74b4-8c36-4029-a673-f4ac14990df3` (writable trial), `2d3cd503-0cb3-4776-97b4-ecf60ce130e7` (research), and `7ace4ee7-727f-4320-b879-cf0cbd8ec748` (off correction/review). Follow-up review run `cb320dfb-f66a-492a-9397-5779e8812b2e` established the notification API limitation before the operator removed that extra requirement.

The inherited `docs/retrospectives/`, `.agents/skills/legion-continue/` and `.pi/skills/legion-continue` remain outside this implementation checkpoint and are preserved unchanged locally. Development does not activate poteto-mode or legion-continue. This does not remove the existing product-managed Tribunus poteto requirement; any change belongs in the upcoming product discussion.

No branch/worktree cleanup, dependency patch, requirements rewrite or issue closure is authorized by this checkpoint. Real Trust prompts remain human-only. Preserve ordinary permissions, machine configuration, selected models and unrelated work when resuming.
