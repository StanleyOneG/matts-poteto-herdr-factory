# Legion redesign research and migration rationale

This note supports [spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1); it is not another specification. The approved decisions supersede proposals in earlier research. This was source/document inspection, not a new runtime trial or benchmark.

## Current implementation

The redesign baseline is commit `988f5aa1a4a995cf6a79c4a0ec3aa5dbd49011b2`. [The checkpoint](../verification/t04-checkpoint-before-requirements-review.md) records partial #5 work, including native writable child trials with controlled seam approval and a later requirement to restore ordinary research interaction. It records a failed full suite, not final acceptance. The checkpoint and engineering policy were tracked files at this baseline.

| Existing code | Reuse and migration purpose |
| --- | --- |
| [`src/intake.ts`](../../src/intake.ts), [`src/snapshot.ts`](../../src/snapshot.ts), [`src/assignments.ts`](../../src/assignments.ts) | Reuse durable intent, decisions, receipt reconciliation and local exclusion where applicable. Remove the product's shared task-claim promise without deleting old records or assuming another run's resources are available. No replacement storage backend is selected. |
| [`src/git-workspace.ts`](../../src/git-workspace.ts), [`src/tribunus-host.ts`](../../src/tribunus-host.ts), [`src/tribunus.ts`](../../src/tribunus.ts) | Reuse isolated workspaces, addressed launch/control and the distinction between receipt and application. Tribuni are separate Pi processes; Pi's in-process event bus is not their transport. |
| [`src/engineering-contract.ts`](../../src/engineering-contract.ts), [`src/engineering-controller.ts`](../../src/engineering-controller.ts), [`src/centurio-guard.ts`](../../src/centurio-guard.ts) | Current resource/TDD and child effect protocols implement the old policy. The redesign removes custom methodology proof and Centurio model/telemetry obligations; ordinary permissions and known settlement still matter. |
| [`src/legatus-research.ts`](../../src/legatus-research.ts), [`src/centuriones.ts`](../../src/centuriones.ts), [`src/extension.ts`](../../src/extension.ts) | Replace the specialized research path and notification filtering with ordinary pi-subagents interaction. Keep normal completion notices and model turns. |
| [`src/preflight.ts`](../../src/preflight.ts) | Adapt diagnostics to the selected workflow and tested dependency composition. Installed files do not establish resources loaded in a target worktree. |

The [archived README](../archives/legion-readme-before-redesign.md) and [archived spec](../archives/legion-spec-before-redesign.md) preserve prior contracts and evidence navigation. Closed #2–4 remain historical. Superseding #5 does not accept its partial implementation or erase failures.

## Native capabilities and limits

The installed research inputs were Pi 1.1.0 and pi-subagents 0.77.0. The repository [package metadata](../../package.json) still pins Pi 1.0.4 for development and pi-subagents 0.76.1. Installation is not a compatibility test; final support pins must follow representative integration checks.

- Pi's tagged [extension types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts) expose `getContextUsage()` with estimated tokens, window and unknown values. [Compaction documentation](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/compaction.md) distinguishes context from cumulative usage. Null after compaction is not zero. UI updates need no model turn, while a significant crossing can request a short decision. The research's earlier 120k example is not the approved threshold.
- pi-subagents 0.77.0's installed `docs/observability.md` distinguishes logical completion from `process-terminal.json` evidence. Missing evidence, idle UI and model completion prose do not establish settlement. Its `docs/missions.md` describes durable records and receipts, not verified acceptance or an automatic scheduler. Temporary retention and best-effort persistence limit reuse.
- Its installed `docs/extension-api.md` and `src/runs/shared/capability-ceiling.js` provide intersected launch capability ceilings. These are not established equivalents of Legion's final-execute wrappers after permission hooks. The redesign removes the old custom obligation rather than claiming equivalence; normal permission checks remain.
- Native `contact_supervisor` / `subagent_supervisor` communication does not require pi-intercom. Optional Intercom/result bridges are separate mechanisms. The earlier research conflated them; no new Intercom dependency follows.
- Pi 1.1.0's [model documentation](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/models.md) and [codemode documentation](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/codemode.md) offer possible reuse. The Decision classifier `openai/gpt-6-luna` is distinct from chat `openai-codex/gpt-6-luna` and requires separate API credentials, not ChatGPT subscription authentication. `typesafe/jev-latest` is another candidate. Neither is a mandatory Legion subsystem; no paid calls, credentials or latency/cost claims were tested.

Local pi-subagents sources above were inspected during the preceding research and corrected source addendum. They are version-specific evidence, not vendored files or stable remote permalinks. Recheck them on the chosen support pin before relying on their behavior. See the upstream [pi-subagents repository](https://github.com/nicobailon/pi-subagents) for package provenance.

## Workflow resources

The unchanged [handoff skill](../../.agents/skills/handoff/SKILL.md) writes to the OS temporary directory, `$TMPDIR` or `/tmp` on the supported local environment. Legion must provide its purpose, obtain the exact path and instruct the successor to read it before continuing. A permanent copy would contradict this approved use; compact run state may still persist elsewhere.

The operator supplied and separately maintains [StanleyOneG/stanley-pi-pstack](https://github.com/StanleyOneG/stanley-pi-pstack) for [#28](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/28). The observed `main` commit is [`6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524`](https://github.com/StanleyOneG/stanley-pi-pstack/tree/6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524). Its pinned [README](https://github.com/StanleyOneG/stanley-pi-pstack/blob/6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524/README.md) and [manifest](https://github.com/StanleyOneG/stanley-pi-pstack/blob/6365cd5ab2c56e84f83f16b4a1a5ac6f1b650524/package.json) describe a standalone import of [upstream pi-pstack 0.6.0](https://github.com/zenspc/pi-extensions/tree/10eb5399458a3946d287edba8d6cbfcf16952658/packages/pi-pstack). The package retains the name `@zenspc/pi-pstack` and version `0.6.0`, with `private: true`; the fork SHA distinguishes this candidate from upstream.

The supplied command is `pi install git:github.com/StanleyOneG/stanley-pi-pstack`. It intentionally follows `main`, not the observed SHA. The [active README](../../README.md#supplied-pstack-fork) records source replacement precautions based on the official Pi package documentation. No package commands ran for this update.

The pinned tree contains all 47 skills and two agents. The fork documents preserved runtime code, bundled tools and settings conventions, with instruction corrections confined to `poteto-mode` and `why`. Its known limits remain material:

- `multi-phase-plan.md` retains repository-specific `pstack/skills/...` paths, a cloud-sleeper branch and immediate stuck-lane replacement instructions that can conflict with corrected recovery rules.
- Existing `../references/bugbot-triage.md` links retain mixed-base conventions; the new `references/pi-delegation.md` links resolve from the `poteto-mode` root.
- Bundled tools require Bun and may install their own dependencies on first use. A preserved test depends on a machine-specific Cursor checkout. Publication establishes no live Pi, native child, MCP, scheduler or restart compatibility.

The fork's manifest exposes its extension, skills and agents. Its README describes four catalog-discoverable skills and `/skill:<name>` access to hidden skills. Required native Matt resources such as [`implement`](../../.agents/skills/implement/SKILL.md), [`implement-spec`](../../.agents/skills/implement-spec/SKILL.md), [`matt-tdd`](../../.agents/skills/matt-tdd/SKILL.md) and [`matt-teach`](../../.agents/skills/matt-teach/SKILL.md), plus the unchanged handoff skill, are separate resources, not fork contents. Preserve these names and existing model/role settings. [#32](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/32) must verify unambiguous native discovery and the selected workflow in actual target worktrees/sessions; repository presence alone is insufficient. [#41](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/41) must establish the tested support pins and supported installation.

The local `/workspaces/astraprojects/pi-pstack-fixed-skills/README.md` describes the earlier overlay for only `poteto-mode` and `why`, with remaining cloud-era assumptions. Keep it as historical evidence, not the current installation source or release-ready fork. Legion does not implement or maintain the external fork. No skills were rewritten here.

## Terminal patterns, not selected backends

The preceding source addendum pinned these examples. Their patterns inform review; none is an approved new runtime dependency.

| Source | Useful pattern and limitation |
| --- | --- |
| [pi-herdr-agents 3.2.0 adapter](https://github.com/giuseppecrj/pi-herdr-agents/blob/a663716d679a3cddc7bc9b7727918409c590b921/maestro/surfaces/herdr/herdr.ts) | Structured returned IDs and distinct missing/unavailable states. Some tab ownership is process-local; it cannot establish durable Legion ownership. MIT evidence was recorded. |
| [pi-herdsman 0.24.0 recovery](https://github.com/boadij/pi-herdsman/blob/e35f17c854ae1ab8b5a93bd513f839af9e77b7de/extension/recovery.ts) | Separates durable coordination from runtime observations. It is a broader system, under Apache-2.0, not a small drop-in. |
| [agent-fleet 2.0.19 launch](https://github.com/chankov/agent-fleet/blob/0af843fa2c92413ea16c50e50bd8a9e24f1d1995/.pi/agent-fleet/scripts/peer-launch.ts) | Separates pane creation from readiness. Registry presence does not prove work completion. MIT evidence was recorded. |
| [pi-shepherdr fleet](https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/336be4d27da28660d0688182b9ff983b6ccea0dc/packages/pi-shepherdr/src/fleet.ts) | Checks generation after asynchronous observations. Package-specific version/license and complete launch semantics were not established. |

No source was copied. Check exact licenses/notices before any future reuse. No comparison here proves reliability, exactly-once effects or permission equivalence.

## Why migrate

Custom research, child-policy and methodology protocols added code and verification cost while the desired workflow now relies on native children and skills. Checkout-local ownership also removes the original justification for shared SQLite claim contention recovery in #24. Local exclusion and uncertain-effect preservation still apply; no database rewrite follows automatically.

The approved target removes automatic Legatus rotation, manual takeover/return, compaction suppression and the custom fleet dashboard. It retains autonomous approved-work delivery, independent review, safe Tribunus handoff and owned cleanup. This reduces obligations rather than renaming them as future work. The tradeoff is explicit user partitioning between Legati and visible human decisions when supported recovery cannot establish safety.

Historical verification remains useful only when its source and assumptions match. New acceptance uses focused deterministic checks, representative native integration on named versions, a final integrated suite and fresh independent review. The docs change makes no claim that those checks have passed.

## Published tracker migration

Spec #1 now contains the approved target and the new backlog. The operator has supplied the external pstack fork handoff for [#28](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/28), as recorded above. Launch compatibility in #32 and release acceptance in #41 remain pending; delivery alone does not satisfy either. Implementation issues #29–41 are native subissues of #1, with explicit blocker relationships and matching visible links. The initially unblocked implementation outcomes are checkout ownership #29, native workflow simplification #30 and configuration #31.

Issues #5–21, #24 and #26 were closed as `not planned`, with rationale and replacement links. Their bodies, implementation evidence and unfinished work were preserved, not accepted. Closed #2–4 and open #27 were left unchanged. The missing repository-defined `ready-for-human` label was created for #28.

The docs and draft backlog passed fresh-context independent review. After publication, the coordinator read back all new bodies, labels, parent links and dependency sets, the updated spec, and every old issue disposition. Documentation link/archive checks and `git diff --check` passed. No implementation tests or live trials ran; no source, settings, dependencies or historical verification files changed. Repository documentation changes remain separate from GitHub publication. The operator authorized committing the reviewed redesign docs after this fork update; this note does not claim that commit occurred. No push is authorized.
