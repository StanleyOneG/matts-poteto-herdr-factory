---
status: accepted
---

# Keep Legion a lightweight local coordination extension

Legion v1 owns checkout-local tasks, explicit prerequisite edges, acceptance-gated launch readiness, isolated interactive Tribuni, attempt/ownership records and observable state. The Legatus defines edges and explicitly launches ready work; skills, meaningful tests and independent review own engineering methodology and content acceptance. We choose this smaller boundary over custom child, integration, delivery and recovery protocols to reduce owned code and cost per accepted outcome, accepting that arbitrary partial failure may end an attempt rather than recover it.

## Boundary

- The Legatus reviews/tests the exact result, integrates with ordinary Git, then explicitly accepts it. The extension validates caller authority, exact task/attempt/result identity and a permissible acceptance transition, plus a read-only Git ancestry fact: the identified commit is in the intended parent. It does not certify test/review quality or operate an integration lifecycle. Tracker closure and PR/MR delivery use ordinary tools and skills under separately granted authority, not Legion adapters or draft/ready state machines.
- Centuriones use ordinary pi-subagents, without Legion child registration, wrappers or custom child-workspace allocation. Parallel writers still require isolated workspaces; native facilities and the delegating principal own that method. Ordinary Trust, permissions, native limits and user model choices remain effective.
- For handoff, the Legatus directs the predecessor to the unchanged handoff skill with a purpose, obtains the temporary artifact path, verifies the predecessor and its children no longer write, then launches a new session instructed to read that path first. Preserve dirty work, actual model/thinking and workflow profile. Same-worktree reuse requires a definitively stopped prior writer. There is no custom successor state machine; native compaction stays enabled.
- A failed attempt may end without acceptance while preserving code, branches, worktrees, history and unknown outcomes. Ending its record does not stop its process, release dependencies or make its resources reusable/cleanup-eligible. If the prior writer is not definitively stopped, any new attempt needs a separate isolated worktree. Never replay an unknown effect.
- Restart retains task, dependency, result, session and worktree pointers, but does not automatically reattach/adopt actors or replay work. Status distinguishes saved facts from current observations. There is no guarantee of recovering the same attempt after arbitrary partial failure.
- No old user records exist, so build no compatibility migration layer. Existing development/test artifacts and runtime state remain separately preserved; this decision authorizes no cleanup or adoption. Automatic worktree/branch removal remains unsupported; eligible owned-tab cleanup retains its identity, settlement and permission safeguards.

## Supersession and consequences

This narrows [ADR-0001](0001-native-workflows-and-local-ownership.md): its broad code-owned “authorized effects” boundary no longer includes custom integration/delivery lifecycles, child allocation/registration, recovery reconciliation or successor protocols. Checkout-local ownership, isolated writers, skill-led methodology and preservation remain valid. Local dependency enforcement is not repository-wide scheduling.

[Spec #1](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1) and [#41](https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/41) are being aligned to this approved target. Prior custom-platform draft-to-ready and recovery qualification is **replaced, not passed**. This ADR records a decision, not shipped behavior: existing code still contains the superseded machinery. Follow the [implementation plan](../plans/legion-lightweight-v1.md); final integrated checks and fresh independent review remain pending.
