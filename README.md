# Legion

Legion is a Pi extension for approved work in local Herdr sessions. Its approved target is autonomous delivery of an independently reviewed PR/MR, or a verified branch and report when no review platform is configured.

## Status: redesign approved, implementation still legacy

[GitHub spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) is the authoritative product contract. This documentation update does not implement the redesign or accept the unfinished code.

The current package implements durable intake, shared task reservations, isolated Git workspaces, local interactive Tribunus launch, and partial engineering/child protocols. It still contains mandatory poteto initialization, custom Centurio guards and a specialized `/legion research` path that conflict with the approved target. Do not treat the target commands or settings below as shipped behavior.

Issues #2-4 are closed historical work. The [T04 checkpoint](docs/verification/t04-checkpoint-before-requirements-review.md) preserves partial #5 work, not acceptance. Its last full suite failed. Historical requirements and remaining-work lists in that checkpoint do not override the redesigned spec. No tests or live trials ran for this documentation change.

For the legacy command reference, setup instructions and evidence links, read the [archived README](docs/archives/legion-readme-before-redesign.md). Its tested combination was Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1 and Herdr 0.9.1. Installed newer packages are research inputs, not validated replacements. Ordinary installation and startup remain inactive; `/legion status` and `/legion doctor` are read-only observations, not repair or acceptance.

## Approved target

- The Emperor approves a spec, tickets or a bounded task. The Legatus is the Emperor's interactive Pi session. Each Tribunus is a separate interactive Pi session; its Centuriones use ordinary native pi-subagents.
- One active Legatus owns a working checkout/worktree. Independently created worktrees may have independent Legati. Users partition work; Legion supplies no shared task claims or inter-Legatus scheduler.
- The Legatus follows the requested skills and owns assignments, graph decisions, integration and acceptance. Code owns launch, isolation, execution state and authorized effects. Skills, meaningful tests and independent review establish methodology without a transcript-proof engine.
- Poteto is off by default. Only the Emperor may enable the Tribunus profile with `/legion poteto-mode=on {instructions}`. `/legion poteto-mode=off` affects future assignments. Matt-controlled workflows and poteto are mutually exclusive. Neither command is implemented by this docs change.
- The Legatus keeps the Emperor-selected model and reasoning. New Tribuni use Pi launch defaults unless `tribuni_model` overrides them. Native child settings remain native, not Legion-controlled. The minimum 272,000-token window applies only to Legatus and Tribuni.
- Advisory context alerts default to 135,000 and 150,000 tokens, without percentage scaling. Native compaction stays enabled and unchanged. Tribunus handoff uses the unchanged `/skill:handoff` with a purpose, a temporary file and an explicit successor instruction to read that exact path before continuing.
- The target includes safe stop, explicit reconciled resume, a minimal indicator plus status/doctor, exact-result review, parent-branch integration and owned-resource cleanup. Unsupported or uncertain outcomes preserve work and ask the Emperor. Automatic Legatus rotation and manual takeover/return are outside the product.

Settings will use `~/.pi/agent/legion/legion.json` and `<working checkout>/.pi/legion.json`, with per-field checkout precedence over global settings and built-in defaults. These are target settings, not current configuration instructions.

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
