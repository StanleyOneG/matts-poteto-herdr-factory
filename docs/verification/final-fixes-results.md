# T01 final review corrections

## Result and scope

Pi users can start independent intake while another Legatus has an unresolved crash journal. A matching damaged record stays unavailable rather than silently creating replacement ownership. Recognized first creation can recover the same identity without inventing task text. Extra whitespace around reserved command arguments no longer turns status into a submitted task or a model turn.

Maintainers receive immutable scoped routing records, explicit initialization evidence, and one command grammar in the core. The adapter consumes public command disposition rather than parsing text again. The public behavioral seam remains `command`, `submit`, and `state`.

This changes `c0ecd1f41854bd56a6450bc4769bc52b7e4574a7` on `main`. The parent accepted both final reviews and approved the bounded storage shape. The commit adding this report is the current result. `git log -1 --format=%H -- docs/verification/final-fixes-results.md` resolves that commit. The external handoff records its exact SHA. No push or PR is authorized.

## Storage decisions

The current development layout has versioned `v1.` filenames. Each logical Legatus still has one aggregate and one lifetime lock. Immutable route filenames contain context and session digests plus the Legatus ID. Discovery filters those filenames before reading their strict schema or opening a snapshot. Parsed identity must agree with the filename and requested context/session. Multiple candidate IDs, malformed metadata, incomplete publication, or an uncommitted attachment fail closed for the matching lookup.

An initial route identifies creation. An alias route identifies a candidate for a later session; it cannot grant attachment or authority. The aggregate's committed attachment history and the exact Legatus lifetime lock remain authoritative. All routing and initialization publication happens under that lock. Ownership is rechecked after injected callbacks and before writing, publishing, or reconciling metadata. Publication writes an exclusive pending file, synchronizes its bytes and directory, hard-links without clobbering, synchronizes the final directory entry, and removes only the identical pending publication. Existing immutable bytes must agree before reuse.

The creation order is initial identity, committed empty bootstrap, durable initialization evidence, first aggregate mutation, then receipt. Explicit recovery can finish a complete validated pending route and an interrupted empty bootstrap. Before initialization was marked complete, absence of the table is recognized first creation. After that marker, missing data is corruption and cannot reset history. A missing marker paired with nonempty acknowledged history is not a recognized bootstrap. Wrong-context recovery rejects before publishing or initializing anything.

An empty or malformed identity publication has no positive creation evidence. It remains unavailable without takeover or fabricated task data. The earlier unprefixed development layout is explicitly unsupported and preserved. It is not scanned as current routing, migrated, reinterpreted, or deleted. Unknown old files therefore do not poison current-format unrelated discovery. No mutable global registry, queue, migration framework, PID-based ownership guess, or global cleanup was added.

## Command decisions

The lowest-risk option keeps parsing in `Legion.command` and adds behavioral disposition to its returned result. The adapter uses that disposition for observation, off, resume, and scheduling. No parser test API was introduced. The aggregate and model-facing `submit` result shapes are unchanged.

Structural whitespace before a reserved argument and around its control arguments is ignored. Direct task text remains exact. An explicit `task` consumes one separator after its keyword and preserves the remaining payload, including further spaces or newlines. This retains the previous leading-payload-space contract. Actual Pi 1.0.4 requires an ASCII space to separate `/legion` from arguments. Tabs within received arguments are supported; a tab immediately after the slash-command name is not promised.

Core off revokes authority synchronously. The adapter applies its local off effect from the result. An auth check also rechecks the public active generation before forwarding, so an off transition cannot be bypassed while the result is in flight. Existing held-auth, busy, off, resume, tool-restriction, and settlement regressions still pass.

## Actual red and green evidence

| Fix | Red observation | Green evidence |
| --- | --- | --- |
| Crash-isolated discovery | [Discovery red](final-discovery-red.txt) returned an unavailable view with `attempt to write a readonly database` instead of an unrelated acknowledged record. | [Discovery green](final-discovery-green.txt) and the final suite preserve unrelated context and same-context independent-session records and bytes. Matching discovery rejects until explicit recovery. |
| First transaction recovery | [Initial red](final-initial-red.txt) returned `rejected` instead of `applied` on explicit first-creation resume. | [Initial green](final-initial-green.txt) and the final suite retain the ID, return zero tasks before first commit, and preserve committed or acknowledged original input afterward. Repeat resume does not duplicate tasks or identity. |
| Initialization evidence | [Evidence red](final-initialization-evidence-red.txt) accepted recovery after initialization evidence was removed from acknowledged history. | [Evidence green](final-initialization-evidence-green.txt) rejects rather than reclassifying later history as first creation. |
| Recovery context | [Context red](final-recovery-context-red.txt) rejected the caller but still published and bootstrapped another context's pending identity. | [Context green](final-recovery-context-green.txt) leaves those bytes unchanged. |
| Unknown route fields | [Unknown-routing red](final-unknown-routing-red.txt) accepted unknown metadata fields. | [Unknown-routing green](final-unknown-routing-green.txt) rejects matching metadata while independent intake remains available. |
| Publication after revocation | [Authority red](final-publication-authority-red.txt) published metadata after a public off callback; [write red](final-publication-write-red.txt) wrote identity content after revocation. | [Authority green](final-publication-authority-green.txt) and [write green](final-publication-write-green.txt) prevent post-revocation changes and recover only validated identity. |
| Whitespace in real Pi | [RPC red](final-whitespace-rpc-red.txt) created active intake and a task instead of remaining inactive. | [RPC green](final-whitespace-rpc-green.txt), [extended coverage](final-whitespace-coverage.txt), and final runtime preserve inactive and active observation, generation, receipts, storage bytes, entries, and model-turn count. Direct and escaped task text remains exact. |

The publication-phase checks were added after the approved storage shape existed. They are extended verification of the red-first storage fixes, not falsely labeled baseline reds. [The publication checks](final-publication-checks.txt) and final suite kill real test-owned processes after complete pending route write, route publication, bootstrap commit, before and after initialization-marker publication, before first task commit, after commit, and after an actual saved receipt. Alias publication and attachment-before-commit cases are included. Empty pending metadata, corrupt initialized data, unknown route metadata, ambiguous candidates, and repeated recovery are also covered through the public seam.

A whitespace verifier draft had a JavaScript string-newline syntax error. It was corrected before runtime verification and is not product red evidence. All stated reds above are actual behavior failures.

## Final verification

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | 39 tests passed without skips. | [Tests](final-fixes-tests.txt) |
| `npm run typecheck` | Passed. | [Typecheck](final-fixes-typecheck.txt) |
| `npm run build` | Passed. | [Build](final-fixes-build.txt) |
| `npm run verify:pi` | 17 real RPC/TUI groups passed with 43 controlled-provider requests. | [Runtime](final-fixes-runtime.txt) and [result](final-fixes-runtime-result.json) |

Actual runtime evidence is `/tmp/legion-pi-lHkZb3/rpc.json` and `tui.txt`. Selected public observations and terminal output are retained with this report. The writer inspected actual command responses, empty inactive lookup, active generation and receipt preservation, zero observation turns, exact literal sources, resumed answering, and the expected injected uncorrelated error. The tested versions remain Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, and local Herdr 0.9.1 with protocol 22. No unrelated panes or sessions were controlled.

The final manifest identifies executable files, tests, package files, and README. The historical integration prevalidation manifest and the approved TDD exception remain unchanged. `t01-decisions.tsv` is still append-only. This is writer verification, not the separate fresh-context review that follows.

## Representative-provider evidence

The successful selected-provider evidence remains [remediation-provider-result.json](remediation-provider-result.json), bound to `c0ecd1f41854bd56a6450bc4769bc52b7e4574a7`. Its real `openai-codex/gpt-6-astra` trial admitted direct intake, blocked material ambiguity only for affected work, and resolved an ordinary answer. It ran only `legion_intake`, preserved original auth/config bytes, and removed test-owned authentication.

That credentialed trial was not rerun. The changes do not alter model instructions, proposal schemas, task interpretation data, ordinary-answer validation, or `submit` result shape. The storage representation is internal. Normal one-separator task commands retain the same payload. Command disposition is adapter control data and is not model provenance. Fresh controlled-provider RPC/TUI checks exercise the changed storage and routing with the existing interpretation and answer flow. The previous representative sample remains applicable evidence of interpretation behavior, not a claim of a new credentialed trial or universal semantics. No credentials were copied or refreshed during this correction run.

## Remaining limits and review

- Empty or malformed identity metadata cannot be safely reconstructed automatically. Matching lookup remains unavailable and requires operator investigation.
- The unpublished old development layout is not upgrade-compatible. Its files remain intact.
- SIGKILL and byte-preserving read checks apply to this local filesystem. They do not prove power-loss durability.
- Unknown host-only failure after forwarding still requires safe Pi restart. Representative semantics, Herdr-skill discovery, Pi command-source and attachment limitations, and intake-only scope remain as previously documented.
- A separate fresh-context review is pending for this changed commit.

Model the Domain changed discovery from reading global aggregates to selecting scoped immutable identity first. Make Operations Idempotent changed publication to no-clobber verification and recovery to repeatable identity-preserving transitions. Type System Discipline made routing and initialization metadata strict and modeled command intent as a tagged union. Boundary Discipline kept filesystem validation at storage boundaries and grammar authority in the core. Test Behavior, Not Implementation required public saved text, rejection, identity, bytes, and real RPC assertions. Prove It Works required actual SIGKILL, RPC, and terminal observations. Laziness Protocol kept one aggregate and lock, removed redundant schema creation from ordinary writes, and rejected a global registry or migration framework.
