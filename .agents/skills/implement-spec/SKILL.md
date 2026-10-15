---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

Implement the approved spec on one **integration branch**. The Legatus owns the **task graph**, its blocking relationships, the ready **frontier**, and final acceptance. Read the configured issue tracker and local spec documents; if either is unavailable or their dependencies disagree, clarify the missing information before dependent work. Direct bounded tasks need no ticket or tracker setup.

Use sparse context pointers for delegation. A bounded Tribunus receives only its assignment, approved acceptance, relevant decisions/files, non-goals and required evidence—not ownership of the whole graph. Each concurrent writer has an isolated owned branch/worktree. Native Centuriones remain ordinary skill-selected children.

In Legion, follow the repository engineering policy and [delivery controls/configuration](../../../docs/delivery.md) for acceptance and external delivery. The workflow grants no extra Git, publication, tracker or cleanup authority. Poteto remains off unless the Emperor enables it; Matt and poteto are mutually exclusive.

## Steps

1. **Graph.** Read the approved spec, tickets and local docs as Legatus. Resolve missing/inconsistent dependencies and material requirements questions. Declare the exact spec scope and acceptance/checks. Done when each scoped task has a bounded assignment and its prerequisites are understood; clarify rather than infer acceptance from a closed flag or prose.

2. **Explore.** Where needed, use an exploration subagent with relevant pointers and an accessible temporary evidence destination outside the repo. Done when implementers have the findings needed for their assignments.

3. **Branch.** Establish the authorized integration branch. Preserve existing work and pinned ownership; a mismatched or dirty checkout needs a decision, not an automatic reset. Done when the intended parent branch/checkout is identified.

4. **Frontier.** Dispatch approved ready assignments, in the background where possible. Each implementer confirms its isolated worktree/branch and intended parent, uses `matt-tdd` at agreed public seams, and reports exact committed content with checks, exceptions and review pointers. A report is not acceptance. Done when the current frontier has bounded owners; independent approved work may proceed while other tasks are held.

5. **Accept and integrate.** For each reported result, establish approved criterion/check evidence, resolve material exceptions and obtain independent skill review of the exact content/current verification. An unchanged result reuses its valid review. Separately authorized parent integration must be confirmed before acceptance. With Legion, use `legion_result` preparation and a separate exact `legion_integrate` stage under ordinary permissions; unknown effects reconcile read-only, never repeat the merge. Divergence/conflicts require separately authorized source resolution and a new checked/reviewed candidate. Done when the result is accepted with confirmed exact parent integration, or its blocker is exposed and preserved.

6. **Deliver and advance.** After the first accepted integration, prepare a draft PR/MR when a review platform and external authority are configured. A ticket may close with its full linked accepted evidence and separate closure authority; it need not await main merge. Tracker closure never accepts work. Release dependents only from accepted integrated results, then dispatch the new frontier. Reconcile unknown closure/publication read-only; preserve the original operation rather than blind retry or repeat integration. Done when each newly eligible task has an owner or an explicit blocker.

7. **Final acceptance.** Confirm the exact final spec scope as Legatus. Check all scoped tasks are accepted and run relevant final integration checks. Obtain independent `code-review` of completed-spec interactions on the exact branch/commit/tree and verification evidence. Reuse unchanged standalone review; changed results or interactions require relevant rechecks/review. Fix findings in bounded isolated assignments, then revalidate affected evidence. Done when final acceptance covers the declared scope and all material exceptions are resolved.

8. **Publish.** Mark the confirmed draft ready only after final acceptance and separate external authority. When no review platform is configured, deliver the verified branch and report using explicitly selected local-only delivery. Missing configuration/authority is a visible hold, not an inferred GitHub default. In Legion, prepare via `legion_delivery`, then separately execute the exact `legion_deliver` stage with ordinary permissions; `/legion delivery observe <run-id> <operation-id>` provides retained-controller read-only reconciliation after stopping/restart. Done when exact delivery is confirmed or its uncertainty/blocker and evidence are reported. No main merge or deployment follows implicitly.

9. **Retain or clean.** Apply owned-resource eligibility and repository policy before cleanup: actual settlement, confirmed integration, cleanliness, ownership and no further review/continuation use. Preserve dirty, active, ambiguous or still-needed resources and hand off their exact references. #40 cleanup automation is separate. Done when each owned resource is either eligible and explicitly authorized for cleanup or retained with a reason and owner.
