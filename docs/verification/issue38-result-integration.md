# #38 exact-result acceptance and integration

## Verified result

Implemented only #38 against spec #1 and the Legion engineering policy, preserving #29–37. Baseline: `1518ef6995092c0529c6f1a7719422dbb7350320`. Matt controlled the work; poteto remained off.

The final integrated suite ran once and passed **483/483**, with no failures, cancellations, skips or todo. Typecheck, build and diff check each exited **0**. The validator's 695-path source manifests remained identical, including symlink kind/mode/link text. Manifest SHA-256: `688669b5abb902eaa27e28e52f4c06d10ccc7ca862fe69bc0b5735ba0905de41`. This evidence summary was added afterward; production and tests have not changed since validation.

Final evidence lives under `/workspaces/astraprojects/.tmp/`:

- `v-SKSM`: source manifests, results, routing and settlement audit.
- `t-SJG0`: full suite log and original exit, disposable fixtures and endpoint observations.
- `y-lQtT`, `b-do7U`, `d-H8AP`: typecheck, build and diff-check receipts.
- `f38-MwlH`: exact review-fix diff, fourteen-path source manifest and mechanically reversible helper refactor.

An initial evidence-only manifest preflight exited 1 because its helper followed a tracked symlink. No tests had run. The coordinator authorized correcting the helper to record link text/kind/mode; repository symlinks were unchanged. The original diagnostic remains retained. This was not a suite failure or retry.

## Behavior and limits

Reported work is not accepted. Clean committed candidates bind task/scope, assignment/executor, source commit/tree, intended parent and required criteria/checks. Verification, material exceptions and independent review references bind that exact result. Changed content or verification invalidates the prior review; unchanged results reuse valid review. Reports and executor/coordinator self-review are insufficient.

Integration has a durable intent, a separate permission-correlated execution stage and a confirmed/failed/unknown outcome. Owning-run serialization permits one unresolved operation for a parent. Actual Git checks establish the intended clean owning task branch and exact source/parent identities before effects and verify operation-bound evidence afterward. Neither zero exit nor a matching final tree alone proves an uncertain integration. Failed/unknown work remains unaccepted.

The adapter supports fast-forward integration into the pinned clean owning checkout, including sessions started in its subdirectories. Divergent/conflicting work is held. Separately authorized source resolution must produce a new clean committed candidate with relevant checks and independent review before integration. Production does not resolve conflicts, stage source content, reset, force, switch to another checkout or merge into primary branches.

`legion_result` records capture, verification, review, preparation and read-only reconciliation. `legion_integrate` executes only the exact prepared operation through ordinary permission-controlled Bash. Lost acknowledgment requires read-only reconciliation, not another merge.

After stopping, `/legion integration observe <run-id> <operation-id>` reconciles the exact retained operation without restoring execution. Recovery requires the original controller session/context and matching saved generation/attachment. Existing checkout/run locks are transiently acquired and released where needed. Foreign/new-session takeover, missing authority and unavailable evidence remain held. Shutdown completes only when all existing settlement conditions pass.

Review and acceptance do not remove #37's changed-scope hold, renew assignment authority or grant Git/publication rights. No scheduler, scope reauthorization, tracker closure, PR/push, main merge, deployment, #39 spec-wide final review or #40 cleanup was added.

## Independent review

Initial parallel review workflow: `0931d854-01df-4b6f-adbe-a23ed6979f42`.

- Standards reviewer `93a85aae-7834-4d22-8c2b-84255ac4366c`: P2 positional helper arguments and an optional repeated-tool-metadata-switch suggestion.
- Spec reviewer `fdbe6603-9a8f-41a4-962a-70ceca3e0610`: P1 public reconciliation unreachable after lost acknowledgment followed by off.

The P1 received public stopping/restart regressions and the authenticated observation route. The mandatory P2 received a mechanical named-argument conversion. Optional metadata consolidation was deferred to avoid unrelated refactoring.

Fresh targeted reviewer `169170f6-4e09-4738-9b89-a7fdb864bd57`, workflow `6cb8faf4-7b55-4205-a1b0-1798ce6fe5bd`, confirmed both fixes and found no new issues. Verdict: **OK**. Unchanged implementation was not subjected to duplicate review. Final validation ran against the same source.

Review reports are retained under `/home/vscode/.pi/agent/sessions/--workspaces-astraprojects-matts-poteto-herdr-factory--/subagent-artifacts/outputs/`, in the two workflow directories above. Component handoffs are in runs `7591da3b-8b10-4536-99ec-88b2849b5f6d`, `43c191ef-b708-49cb-87ed-0d56ba5beb86`, `9b7d5bbc-2574-42a1-b3ce-4712ada0b171`; fix handoff is in `b897bd15-20db-47b0-aa1d-995d21223251`.

## Verification boundaries and retention

New coverage uses public command/task/state interfaces, registered extension controls, controlled Pi/Herdr/permission boundaries and real disposable Git/storage/transport. It checks identity/stale review, competing integrations, actual conflicts and newly reviewed resolution, applied-but-unacknowledged effects, ordinary permission denial and stopping/restart observation without write revival. This is not an installed SDK restart or #41 installed matrix. Prior native evidence and its qualifications in `issue37-corrections.md` remain unchanged.

Two focused invocations were incomplete and are not passes: `c38-Lm19` was interrupted after a test-only reentrant status call deadlocked; `t38-dpKp` hit a tool timeout without a command exit receipt. Their logs and fixtures remain retained. Later final focused validation passed 49/49; the full suite above establishes the final result.

The coordinator accepts retention responsibility for all referenced component, review-fix and final-validation evidence and Git fixtures. The two incomplete roots retain filesystem socket entries with no observed kernel listener; their scoped audits are recorded in the component handoffs. Final suite roots have no owned filesystem/kernel socket entries or observable consumers. Ten infrastructure PIDs were not fully inspectable, so universal settlement is not claimed. No real Herdr tabs were opened or retained. Evidence may be released only when continuation/review no longer needs it and ownership/settlement rules permit disposal.

Command scratch used short disk-backed workspace roots; observed final-suite endpoints were at most 104 bytes. The already-running Pi retained its existing `/tmp` runtime routing; no settings or runtime migration occurred. No prior resources/evidence were deleted. This result authorizes neither publication nor proceeding to another issue.
