# Legion

Legion is a Pi extension for approved work in local Herdr sessions. Its approved target is autonomous delivery of an independently reviewed PR/MR, or a verified branch and report when no review platform is configured.

## Status: redesign approved, implementation still legacy

[GitHub spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) is the authoritative product contract. Implementation remains partial; focused configuration checks do not establish whole-product release acceptance.

The current package implements durable intake, checkout-local ownership, isolated Git workspaces, local interactive Tribunus launch, assignment-based principal effects and native owned-child association. The specialized `/legion research` and machine skill/TDD/seam controllers are retired. Tribuni prepare isolated owned launches with `legion_centurio` using an ordinary configured native agent; Legion does not select child models/tools or install a required child guard. Native children have no Legion per-child-call veto/handshake: bounded assignment and exact owner/run/workspace authorize launch, and native events plus observed runner-close proof establish settlement. Missing/unknown evidence holds; completion prose or cancellation is not proof. Direct Legatus native research/delegation and ordinary completion notices remain native and gain no Legion adoption/cleanup authority. Managed Tribunus execution requires the exact current isolated launch returned by `legion_centurio`; unprepared, held or unsupported execution/resume/scheduled launches are visibly refused. Native inspection remains available, and child control requires the exact currently owned run. Historical records, unknown effects and controlled trials are preserved. Mandatory poteto initialization remains legacy behavior pending #32. Settings resolution and principal compatibility checks are implemented as described below; startup override arguments, workflow/profile selection and alerts retain their separate verification scope. The bounded #36 handoff checkpoint and usage are documented below.

Issues #2-4 are closed historical work. The [T04 checkpoint](docs/verification/t04-checkpoint-before-requirements-review.md) preserves partial #5 work, not acceptance. Its last full suite failed. Historical requirements and remaining-work lists in that checkpoint do not override the redesigned spec. Current focused checks do not relabel that checkpoint as accepted.

For the legacy command reference, setup instructions and evidence links, read the [archived README](docs/archives/legion-readme-before-redesign.md). Its tested combination was Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1 and Herdr 0.9.1. Installed newer packages are research inputs, not validated replacements. Ordinary installation and startup remain inactive; `/legion status` and `/legion doctor` are read-only observations, not repair or acceptance.

## Approved target

- The Emperor approves a spec, tickets or a bounded task. The Legatus is the Emperor's interactive Pi session. Each Tribunus is a separate interactive Pi session; its Centuriones use ordinary native pi-subagents.
- One active Legatus owns a working checkout/worktree. Independently created worktrees may have independent Legati. Users partition work; Legion supplies no shared task claims or inter-Legatus scheduler.
- The Legatus follows the requested skills and owns assignments, graph decisions, integration and acceptance. Code owns launch, isolation, execution state and authorized effects. Skills, meaningful tests and independent review establish methodology without a transcript-proof engine.
- Poteto is off by default. Only the Emperor may enable the Tribunus profile with `/legion poteto-mode=on {instructions}`. `/legion poteto-mode=off` affects future assignments. Matt-controlled workflows and poteto are mutually exclusive. Neither command is implemented by this docs change.
- The Legatus keeps the Emperor-selected model and reasoning. New Tribuni have a native-defaults or exact-override intent; #32 owns startup override wiring. Native child settings remain native, not Legion-controlled. The minimum 272,000-token window applies only to Legatus and Tribuni.
- Advisory context alerts default to 135,000 and 150,000 tokens, without percentage scaling. Native compaction stays enabled and unchanged. Tribunus handoff uses the unchanged `/skill:handoff` with a purpose, a temporary file and an explicit successor instruction to read that exact path before continuing.
- The target includes safe stop, explicit reconciled resume, a minimal indicator plus status/doctor, exact-result review, parent-branch integration and owned-resource cleanup. Unsupported or uncertain outcomes preserve work and ask the Emperor. Automatic Legatus rotation and manual takeover/return are outside the product.

## First-version cleanup scope (#40)

The approved first version closes only eligible accepted, reviewed, settled owned tabs after fresh exact ownership, session/process and all-occupant checks. Human-used, foreign, active, ambiguous or still-needed tabs remain retained. Missing receipts do not authorize blind repeat closure.

Worktrees and branches remain preserved, including after eligible tab closure. Automatic worktree removal is unsupported in this version; retaining a worktree alone does not prevent an otherwise eligible tab from closing. No legacy setting, saved intent, retry or public command may enable removal, and no new manual destructive-command bypass replaces it. Preserve reports, evidence, handoff references and unknown historical outcomes.

The implementation now queues tab cleanup only. Status/doctor derive the retained worktree path and branch from an owned ready claim, not from historical unknown removal records. Legacy removal prepare/execute is refused; observation leaves its state, controllers and history unchanged. Existing confirmed removal tombstones remain historical facts, not resources to recreate. Focused checks, independent code review and a separately authorized full-suite repeat pass. The earlier suite timeout remains recorded; acceptance is still blocked by missing native product tab-close evidence. See [#40 evidence and current status](docs/verification/issue40-owned-cleanup.md). Future automatic removal is [deferred to #42](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/42), does not block the first version or #41, and has no promised date or verified supported environment.

## Explicit continuation (#35)

Ordinary startup stays inactive. Use `/legion resume <run-id>` to continue a preserved run in its saved checkout, including from a fresh Legatus session. Resume rereads configuration and checks exclusive checkout/run ownership, retained history, actual Git associations and exact worker/native identities before attaching. Dirty files, staged changes and legitimate later commits are retained, not reset to the original parent pin. Status/doctor are observations, not recovery.

Dispatched workers remain observation-only with persistent task holds; run continuation does not revive them, transfer child controls or retry missing outcomes. Unknown liveness, incomplete Git operations, missing initialized history or uncertain effects block dependent work. Preserve the named resources/evidence and resolve the exact blocker rather than resubmitting with a new key or using `on` to bypass recovery. Unresolved saved shutdown still refuses resume.

Fresh selected-workflow continuation uses compact saved tasks, questions and results, separately from Emperor inputs; it does not replay the original task/prompt or change existing assignment model/profile pins. Run-scoped poteto state persists, while a separate new run starts off. Unsupported legacy/handoff-dependent recovery is not reconstructed; retained handoff workers remain observation-only on resume.

See [#35 verification and limitations](docs/verification/issue35-resume.md). Its focused retained-resource and installed-native observations are not #41 installed journeys; final integrated checks and independent review are still pending at this checkpoint.

## Temporary Tribunus handoff (#36)

The current owning Legatus can explicitly replace a settled assigned Tribunus once, preserving its worktree, dirty/index/untracked work and actual model/thinking/workflow profile:

```text
/legion handoff <task-id>@<revision> --purpose "Fresh context" --continue "Finish the bounded task"
/legion handoff <handoff-id>
```

Purpose and continuation must be nonblank JSON string literals. The command saves an immutable request; its correlated native `legion_handoff({requestId: "<handoff-id>"})` stage performs safe-stop → actual worker/child/effect settlement → one limited unchanged `/skill:handoff` turn → exact temporary-file availability → one successor. In the selected native Legatus workflow, `legion_request({command: "handoff ..."})` can request the same transition, then `legion_handoff` executes the returned ID. Neither tool changes the future poteto preference. Use `task handoff ...` for literal task text.

If a stage/start/application acknowledgement is missing, explicitly continue the **same handoff ID**; do not create another request or relaunch. Unknown activity, missing history/resources or an absent exact file remains a visible blocker. Ordinary predecessor authority stays retired; no active children transfer. The successor receives the exact `$TMPDIR` (else `/tmp`) artifact path and an explicit read-before-continuing instruction. Legion makes no permanent document copy or silent reconstruction. Status/doctor only observe; explicit run resume does not revive these workers.

See [bounded native verification and controlled boundaries](docs/verification/issue36-handoff.md). This is not #41 installed-journey or full #36 acceptance; final integrated checks and independent review remain separate gates.

## Corrections and operator status (#37)

```text
/legion help
/legion status [run-id]
/legion status [run-id] --details
/legion doctor
/legion correction <task-id>@<revision> <text>
/legion correction deliver <correction-id>
/legion correction observe <correction-id>
```

Help/completion includes correction and handoff commands. Use `/legion task <text>` for literal text colliding with reserved words, including `help` and `correction`. Ordinary startup stays inactive. Status/doctor/help do not activate, acquire ownership, repair, dispatch or wake a model. Status shows affected tasks, persistent questions/recommendations, stopping/unknown states and available context/freshness. `--details` adds saved evidence/resource references and full state; native Herdr and pi-subagents inspection remain native. Routine updates use only Legion's small status entries, never replacement editor/footer/widgets, focus changes or modals.

A targeted correction saves input for Legatus interpretation, not worker delivery. Ambiguous ordinary chat must first receive a presented Emperor routing question; it cannot silently become a correction or new task. Protected requirements, acceptance changes, mandatory-verification waivers, access, financial commitments and irreversible actions require an exact presented Emperor-approved amendment. A technical choice remains a separate implementation decision, not correction delivery or permission approval.

The interpreter's `legion_intake` correction proposal binds a fresh ID to the saved original source, current task revision, authorization and exact assigned worker. Its returned correction stage shows persisted state, never the generic `applied` **intake** receipt as correction compliance:

- **queued**: saved intent; a sent marker is not a receipt. Delivery waits for an evidenced native safe point without steering/interruption.
- **delivered**: the exact worker's durable native user entry, not assistant prose, report, tool completion or settlement.
- **applied**: only explicit Legatus verification of the performed change, with a nonblank summary and evidence references. This is not result acceptance or integration.
- **unknown / not-delivered**: preserve the exact original worker/evidence. Unknown is not proof of absence.

The current correlated native Matt Legatus can call `legion_correction({correction: {id, digest}, action: {kind: "deliver" | "observe"}})`. After checking the performed change and obtaining genuine delivered evidence, it can use `action: {kind: "verify", summary, evidence: ["check/review reference"]}`. Current authority is adapter-derived, never model-supplied or worker permission. Native `legion_status({command: "status" | "doctor", details: true})` is passive. Raw reconcile observations are not exposed as model parameters: receipt facts come from the production host. The targeted command uses intake-only interpretation; verification requires a current selected native Legatus continuation, not that intake turn.

Explicit `correction deliver` and `correction observe` commands are **controls**, unlike passive status: they require the active owning Legatus and may reconcile durable correction state. Repeat only the same saved ID; a sent/unknown continuation observes rather than resends. A missing addressed worker never authorizes launch. Handoff/replacement never automatically transfers a correction. Explicit reissue uses a new `legion_intake` correction ID with `previous` naming a reconciled predecessor and a different actual current worker; unresolved predecessors and same-worker reissues are refused.

Receiving or verifying a protected correction does **not** renew an old assignment's changed scope. The affected-task authority-mismatch hold remains visible while independent approved work continues. There is currently no supported same-assignment scope refresh. Resume may also hold exact old-worker observation pending independently authorized controller adoption; observation never performs adoption. Preserve these blockers and ask for the missing authorization rather than bypassing them. Native Trust/permission prompts remain human/platform decisions; Legion never answers them automatically.

Focused UI/tool tests use controlled Pi/Herdr adapters and real public storage/transport. Actual installed-SDK safe-delivery/root-UI verification, final integration and independent review remain separate gates; this section is not whole-issue or #41 acceptance.

## Exact-result review and parent integration (#38)

A reported worker result is **not accepted**. In the current selected native Legatus turn, `legion_result` takes `{action: {...}}`; caller/session/generation authority comes from the extension, never tool parameters:

1. `capture`: `{kind: "capture", task: {id, revision}, requiredChecks: ["focused tests"]}` pins clean committed source content, assignment/scope, intended parent and owning checkout. It never stages or commits.
2. `verify`: `{kind: "verify", result: {id, digest}, verification: {criteria, checks, exceptions}}`. Criteria use zero-based approved criterion indices; checks use the captured names. Each outcome is `passed` or `failed` with nonempty evidence references. Exceptions retain a description and `resolution: {kind: "open"}` or `{kind: "resolved", summary, evidence}`. Missing/failed checks or open material exceptions prevent readiness.
3. `review`: `{kind: "review", id, result, verificationDigest, reviewer: {session, run}, reference, outcome: "approved", evidence}` records genuine independent skill-review evidence of that exact identity/current verification. Executor/coordinator self-review is refused. Unchanged work reuses its valid review; material changes require relevant checks/review again.
4. `prepare-integration`: `{kind: "prepare-integration", result, id}` saves an operation UUID without Git effects. Separately call `legion_integrate({requestId: id})` with that exact prepared UUID. It uses ordinary nested Bash permissions; review and preparation are not a permission grant. If the turn settles first, explicitly prepare the same pending ID in a current native Legatus turn rather than inventing a replacement operation.
5. `reconcile-integration`: `{kind: "reconcile-integration", id}` observes actual Git evidence read-only. Failed/unknown effects stay unaccepted; never retry a merge to recover a lost acknowledgment. Status/doctor remain passive and do not reconcile.

The owning checkout must be clean and on the intended non-primary task parent branch. Integration is fast-forward-only into that checkout, serialized within the owning run. Divergent/conflicting or materially changed work is held: separately authorize source resolution, produce a new clean commit, then capture/check/review the new identity. There is no reset/force, automatic conflict resolution, resource adoption, scope refresh, cross-run scheduler, main merge, push/PR, tracker closure or deployment grant. Acceptance requires confirmed exact parent integration, not command exit zero alone. Spec-wide final review and delivery use the separate #39 controls below; cleanup remains separate work.

## Final review and delivery (#39)

Delivery now has separate native `legion_delivery({action})` preparation/evidence controls and an exact `legion_deliver({requestId})` execution stage using ordinary permission-controlled nested Bash. Direct tasks need no ticket. Dependents require an accepted integrated #38 result, never a tracker closed flag or prose. Ticket closure carries full linked accepted evidence and needs separate external authority; it need not wait for main merge.

The Legatus owns the graph/frontier and explicitly declares final spec scope. Draft publication can follow the first accepted integration; ready/local-report requires all declared tasks accepted, final checks and independent interactions review. Unchanged standalone review is reused. Changed scope/content/checks require relevant rechecks/review. Existing #37 holds remain effective; unrelated approved work may continue.

The operator explicitly selects checkout-local configuration in `.pi/legion-delivery.json` with `{ "configurationFile": "checkout-local path" }`. There is no default platform, remote inference or global selector. Missing/invalid configuration holds delivery alone. Both local-only verified branch/report and generic fixed-executable remote capabilities are supported; no universal production `gh` implementation is supplied. See [delivery configuration, tools and trusted read-only provider protocol](docs/delivery.md) before configuring a provider. No real checkout is configured automatically.

Unknown closure/publication reconciles read-only, never blind retries or repeated integration:

```text
/legion delivery observe <run-id> <operation-id>
```

The exact retained controller may observe after off/restart without activation, worker revival or renewed authority. Status/doctor remain passive. Delivery does not resolve conflicts, merge main, deploy or automate #40 cleanup. Controlled boundary tests are not installed-platform or #41 journey evidence; integrated validation and independent review remain separate acceptance gates.

## Safe stopping (#34)

`/legion off` immediately withholds new assignments/effects and persists one shutdown identity. Repeated off observes that shutdown. Already-admitted effects and registered native children may settle; only corroborated native settlement and the addressed worker's parked receipt release the live owner's observation lock. Unknown effects/activity preserve resources and show stopping/blockers. Restart never schedules saved work or erases an unresolved shutdown; parked/report receipts are not acceptance, resume or cleanup authority.

Tribuni permanently latch retirement on addressed safe-stop or conservative owner loss. On supported local Linux, stage-boundary checks combine `/proc` boot/PID/start identity with the exact Herdr owner pane/session/process binding. There is no heartbeat or kill deadline. Missing/unreadable/legacy owner evidence is a sticky hold, not proof of death or settlement; returning communication, late controls and ordinary worker restart cannot restore authority. Exact read-only native settlement observation remains available for already-registered children after proven owner loss, including loss during an existing shutdown. New launches, effects and native child controls remain denied; permissions, compaction and native lifecycle proof requirements are unchanged. Installed-native validation and whole-product acceptance remain separate gates.

## Settings and principal compatibility (#31)

Legion reads `~/.pi/agent/legion/legion.json` then `<working checkout>/.pi/legion.json` at explicit `/legion`, `/legion on`, `/legion resume <id>`, and task-bearing activation while inactive. The working checkout is the owning checkout/worktree, including when Pi starts in a nested directory; it is not Git's common directory or the canonical primary checkout. Per-leaf precedence is built-in defaults < global < checkout, so partial nested objects inherit other leaves.

```json
{
  "context": { "warningTokens": 135000, "escalationTokens": 150000 },
  "tribuni_model": { "model": "openai-codex/gpt-6.1-sol", "thinking": "high" }
}
```

This is the approved **example**, not a mandatory model. Defaults are absolute 135000/150000 tokens, not percentages. Thresholds must be positive safe integers with warning below escalation. A present effective `tribuni_model` requires both an exact provider/model identifier and supported Pi thinking. Omit it to retain ordinary shell/wrapper-selected Pi launch defaults; Legion never copies the Legatus or native child-role model settings.

Only missing files mean defaults. Read/JSON/container/unsupported-field/effective-value errors identify the file and corrective action; there is no silent fallback. Leaf validation follows precedence, but malformed JSON, invalid containers and unknown fields fail even in a lower layer. Null is not a clearing/tombstone mechanism. Poteto preferences do not belong in these files.

Accepted settings are cached and exposed in `/legion status --details` state (`settings`, new-assignment `tribuniModel`, and each task's `tribunusModel` intent). Ordinary tasks, status and doctor do not reload JSON. Startup/restart remain inactive. Resume rereads prospective defaults without changing existing assignment pins; failed task-bearing activation preserves the exact input inactive and does not wake a model. Failed activation diagnostics remain visible in status/doctor until another explicit activation check.

Before managed work, Legion observes the actual Legatus model/thinking without setters and checks only principal chat models: exact native registry model, registered native provider, configured-auth metadata, native available-model snapshot, supported native thinking, and a window of at least **272000** tokens. Unknown or smaller actual principal windows fail too. Tribunus inspection records actual model/thinking/window, and incompatible or unknown observations withhold new assignment while preserving the worker. No model substitution, fuzzy matching, thinking clamp, provider request, credential acquisition/refresh, native child minimum or classifier routing is added.

These are **metadata-only capability checks**, not proof that a provider request will succeed. Auth/availability snapshots can be stale; correct native Pi configuration and verify its snapshot before explicitly retrying. Doctor observes native metadata/composition without repairs, ownership claims or model turns; it is not a provider probe.

New assignments pin actual observed model/thinking and the existing declared `assignment.workflow` as `modelPin.profile`. That profile is stored declaration, **not proof of loaded/runtime workflow exclusivity**. Existing pins remain unchanged on resume; legacy assignments with missing pins remain `existing-unknown`, never reconstructed from new defaults. Both persisted assignment shapes retain optional pins. The consumer distinction supplies #32/#36, not their launch or continuation workflows.

Shell launch is unchanged. Until #32 wires startup overrides, a new worker whose actual model/thinking differs from an accepted override is held visibly with expected/observed values, never silently assigned or relaunched. Mandatory legacy poteto initialization is not resolved or relabeled by #31. #32 owns launch/profile verification and removal of that contradictory legacy workflow; #33 owns alerts and #36 owns handoff.

## Supplied pstack fork

The operator supplied [StanleyOneG/stanley-pi-pstack](https://github.com/StanleyOneG/stanley-pi-pstack) for the [external handoff, #28](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/28). The observed `main` commit is [`6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524`](https://github.com/StanleyOneG/stanley-pi-pstack/tree/6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524), with package name `@zenspc/pi-pstack`, version `0.6.0` and `private: true`. The supplied install command is:

```bash
pi install git:github.com/StanleyOneG/stanley-pi-pstack
```

This command follows `main`; the observed SHA records the inspected source, not a pinned installation. No installation ran for this update. Before switching, review the fork and the official [Pi package source/scope rules](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/packages.md). Replace the original npm source in its configured scope rather than loading both: npm and Git sources have distinct identities even with the same package name. Preserve existing Pi settings, unrelated packages and pstack model configuration; no setup reset or global dependency patch is required.

Delivery does not establish Legion compatibility. [#32](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/32) must verify workflow resources and launch; [#41](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/41) owns supported installation and release acceptance. Native Matt and unchanged handoff resources remain separate from the fork. The local `pi-pstack-fixed-skills` overlay is historical two-skill evidence, not the current installation source. See [workflow resources and known fork limits](docs/research/legion-redesign.md#workflow-resources).

## Documentation

- [Glossary](GLOSSARY.md) defines the Legion roles.
- [Engineering policy](docs/agents/legion-engineering-policy.md) governs development, focused verification and task-owned tab cleanup.
- [Architecture decision](docs/adr/0001-native-workflows-and-local-ownership.md) records why the redesign removes custom methodology enforcement and shared scheduling.
- [Research and migration rationale](docs/research/legion-redesign.md) distinguishes source findings from untested compatibility claims.
- [Archived spec](docs/archives/legion-spec-before-redesign.md) preserves the former requirements verbatim. Historical evidence remains in `docs/verification/` unchanged.

No staging, commit, push, main-branch merge, deployment or terminal control is authorized merely by these documents.
