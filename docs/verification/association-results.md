# T01 association race correction

## Result

Pi users with the same context/session now have one active logical Legatus owner. Concurrent initial activation and explicit resume cannot acquire different identities for that association. Independent contexts and different sessions remain separate.

Maintainers inherit one scoped association lease alongside the existing per-Legatus lease. The active binding contains both handles. No global registry, queue, deterministic identity rule, migration, or new execution behavior was added.

Baseline is `e063b06bffb4f1781eb7fccbc70c1fc1ec8e4544` on `main`. The parent accepted the Standards P2 and approved holding the association lease for the binding's lifetime. Both full reviews were read. The Spec axis had no findings. The external handoff records the resulting commit. `git log -1 --format=%H -- docs/verification/association-results.md` resolves it. No push or PR.

## Cause and decision

Both actors discovered an empty association before allocating different random IDs. Per-Legatus locks protected each different aggregate and therefore could not choose one association owner.

A mutation-only association lease would still let initial activation commit and release the association guard while holding its Legatus lease. Explicit resume of a different ID could then become another owner. A deterministic initial ID cannot cover arbitrary explicit reattachment without another mechanism. The parent approved the smallest complete option. Association ownership lasts as long as the bound Legatus ownership.

The acquisition order is association, post-lock discovery or explicit selection, then Legatus. Read-only context validation precedes association acquisition for explicit resume. It prevents wrong-context recovery from creating a foreign association file. Recovery validates context again under the Legatus lease. Discovery and allocation never use a pre-lock association read.

`Binding` contains generation and both SQLite handles. Local partial acquisition cannot make `state` active. Once the pair transfers to the binding, local cleanup no longer owns those handles. Off and revocation release the Legatus lease before the association lease. Failed selection, duplicate receipts, exceptions, uncertain commits, and delayed activation release only locally acquired handles. Process death relies on SQLite's kernel-backed release, not PID guesses or timeouts.

The scoped file is `association.v1.<context digest>.<session digest>.lock`. It contains no identity mapping. Existing immutable route records and aggregate attachment history remain authoritative. Multiple historical candidate routes still fail closed on implicit discovery and require explicit identity selection. The correction prevents new concurrent ownership; it does not rewrite old duplicate history.

## Red-first evidence

[Cross-process red](association-cross-process-red.txt) records actual public-seam failures for both activation and task-bearing input. Two synchronized test-owned Node processes both became active. Both tests reported `2 !== 1`. [Cross-process green](association-cross-process-green.txt) passes the original reproduction after the fix.

[Actual RPC red](association-rpc-red.txt) reproduces the same `2 !== 1` through two Pi 1.0.4 processes with the supported `--session-id` option. Full actual red records are `/tmp/legion-pi-ycVV02/rpc.json`. [RPC green](association-rpc-green.txt) passes that reproduction. The reviewer's original actual records at `/tmp/legion-standards-session-race-rpc.json` and concise output were also read.

[Extended coverage](association-coverage.txt) verifies four rounds each of activation, task-bearing activation, and activation versus different-ID resume. It checks one identity, one successful owner receipt, rejected receipt-free losers, exact source text, restart, explicit off, and process death. Additional cases keep independent associations usable during a held first transaction, preserve read-only bytes, recover the killed creation without fabricated input, release partial acquisitions after errors, and retain a prior owner's guard. [Revocation coverage](association-revocation.txt) observes a real association-only acquisition and revokes it through public off before any Legatus lock or route exists. The next owner succeeds without a leaked handle.

Publication, alias, corruption, malformed metadata, protected decisions, read-only behavior, authentication races, whitespace, busy intake, and ordinary-answer checks all remain in the final suite. The extensions added after the primary red are further verification, not mislabeled baseline reds.

Two verifier drafts failed independently of the product. A broad text replacement inserted the new RPC checks into cleanup as well as the main body. That duplicate was removed before the recorded authoritative RPC red. A large task passed as one argv exceeded the OS argument limit. The fixture now constructs that input inside its test process. An evidence inspection initially expected restart clients to have a native `get_state` response; their public snapshot observations provide the session instead. These probes did not motivate product changes.

## Final checks and actual inspection

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | 45 tests passed without skips. | [Tests](association-tests.txt) |
| `npm run typecheck` | Passed. | [Typecheck](association-typecheck.txt) |
| `npm run build` | Passed. | [Build](association-build.txt) |
| `npm run verify:pi` | 19 groups passed with 45 controlled-provider requests. | [Runtime](association-runtime.txt) and [result](association-runtime-result.json) |

Final actual runtime records are `/tmp/legion-pi-m8j7Xa/rpc.json` and `tui.txt`. [Retained RPC evidence](association-rpc-evidence.json) contains the six shared-session groups. Each has one active owner, an inactive peer without a receipt or model turn, and an inactive restart with the same ID. The task-bearing group retains exactly `"Exact association task 1  "`. The different-ID resume groups cover both concurrency and a completed initial activation whose owner remains alive. Shutdown releases both leases.

[Actual terminal output](association-tui.txt) retains completion, English doctor, no inactive question duplication, and successful ordinary answering after resume. All existing runtime guards pass. Tested versions remain Pi 1.0.4, Node 22.23.1, pstack 0.6.0, pi-subagents 0.76.1, Herdr 0.9.1, and protocol 22.

`association-implementation.sha256` identifies the current source, tests, scripts, package files, and README. The historical prevalidation manifest and TDD exception remain unchanged. `t01-decisions.tsv` remains append-only. Authored files pass whitespace checks; raw terminal padding remains actual evidence. This is writer self-review and verification, not independent changed-result acceptance.

## Provider relevance and limits

No new credentialed trial ran. The successful `openai-codex/gpt-6-astra` sample remains `remediation-provider-result.json`, bound to `c0ecd1f`. Parsed JSON matches its original artifact, and its test agent directory remains absent.

Source comparison against `e063b06` confirms byte-identical adapter/model instructions, preflight, provider verifier, proposal and snapshot/evidence schemas, and `submit`. The earlier reviews established relevance from `c0ecd1f` through `e063b06`. The new lease pair is private control state, not interpretation data. Current actual RPC and terminal checks exercise the unchanged interpretation contract. The sample is representative evidence, not a newly rerun trial or universal semantic proof.

Malformed identity metadata still requires operator investigation. Old unpublished storage is preserved and unsupported. Historical multiple candidates still require explicit selection. Local SIGKILL checks do not establish power-loss durability. Pi command provenance, attachment, unknown forwarded-failure, and user Herdr-skill discovery limits remain. Fresh-context independent review and final T01 acceptance remain parent-owned.

Model the Domain moved the shared ownership invariant before random-ID allocation and represented complete ownership as one lease pair. Type System Discipline separated local acquisition from active binding. Boundary Discipline kept association and SQLite operations in storage and policy in the core. Laziness Protocol selected one scoped lease rather than deterministic IDs plus cross-ID probes or a global registry. Test Behavior, Not Implementation required real public receipts, saved text, identity, rejection, and bytes. Prove It Works required actual concurrent processes, Pi RPC, process death, and terminal records.
