# #33: representative native context-alert check

`node --import tsx scripts/verify-context-alerts.mjs` passed on installed Pi **1.2.0**, Node **v22.23.1**. This is SDK/API acceptance, not paid-provider or live-workflow acceptance.

## Reproduce

Requires installed project dependencies and the unmodified supplied pstack 0.6.0 checkout used by the existing native SDK fixtures. Set `PI_TEST_PSTACK` to its root if not at `~/.pi/agent/git/github.com/StanleyOneG/stanley-pi-pstack`. Read the engineering and temp-storage policies first; inspect `findmnt -T /workspaces/astraprojects/.tmp` and `df -hT` before writing.

```sh
d=$(mktemp -d /workspaces/astraprojects/.tmp/n33-XXXX)
printf 'Owner: issue33 native check; disposable directory: %s\n' "$d"
TMPDIR="$d" TMP="$d" TEMP="$d" \
  node --import tsx scripts/verify-context-alerts.mjs >"$d/log" 2>&1
rc=$?
cat "$d/log"
printf 'Exit: %s; evidence: %s/log\n' "$rc" "$d"
# After process settlement, save needed evidence outside d and verify it readable.
# Remove only this owned canonical directory after no consumer needs it.
exit "$rc"
```

The script rejects missing/non-workspace temp routing, isolates HOME/profile/checkout, disposes its SDK session and emits settled evidence paths. It does not modify host settings or clean runtime roots. Cleanup belongs to the invoking shell after saving evidence, including on failure.

## Actual evidence

Checkout thresholds are absolute **100/200** tokens; fixture model window is **272000**. `ctx.getContextUsage()` and `session.getContextUsage()` are installed native APIs, never stubbed. Provider replies/usage are deterministic local streams. UI capture and prerequisite discovery/Herdr status are controlled boundaries; no child, tab or Herdr connection is created.

- Ordinary response: **11/272000** current tokens; exactly one requested inference, zero telemetry custom messages. Repeated status observations preserve entries and invoke no inference.
- Direct escalation: native sample **306/272000** after the first real filesystem tool effect. Exactly one warning-level UI advisory and one `legion-context-alert` custom entry, with `{ triggerTurn: true, deliverAs: "followUp" }`.
- Actual order: `request 2 → effect_one → advisory queued → request 3 → effect_two → request 4 → request 5 (advisory)`. Requests 3/4 contain no advisory; request 5 does. Both owned effect files are complete. This distinguishes follow-up from steering into the current tool continuations.
- Repeated high samples deduplicate; settled current estimate **301/272000** matches public Legion state.
- Real `session.compact()` uses Pi's default summarizer (not a replacement extension hook). Two native requests summarize history and the split-span prefix. Afterward actual usage is `{ tokens: null, contextWindow: 272000, percent: null }`; Legion is explicitly unknown, not zero, with no new alert.
- Compaction remains enabled with unchanged fixture settings `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 1 }`. The tiny retained tail is configured before creation solely to compact a small fixture; no claim about default 20000-token retention or automatic threshold compaction.
- **7 local provider requests** total: 1 ordinary + 3 current-work + 1 advisory response + 2 native summaries. Zero fetch/network provider calls and zero extension errors. Host settings unchanged.

## Boundaries and cleanup

Not covered here: assigned Tribunus native telemetry, unavailable-model shape, identity/replay rejection, separate warning/re-arm after fresh-below recovery, failed/automatic compaction, UI rendering in TUI/RPC, full suite, or independent review. Those require separate evidence; successful compaction alone does not prove re-arm behavior.

Five initial harness-only failures (missing controlled skills, status JSON parsing, context-key spelling, excluded fixture tools, and split-span summary count) were corrected in this script, not product source. Final invocation exited **0**. Each used its own disk-backed ext4 directory (about 2.1–2.2M; 296G free); all six settled owned directories were removed after saving evidence. Existing Pi runtime TMP variables were unset/potential `/tmp`; runtime was left untouched. No full suite, source edits, staging, commits, tracker writes or live paid probes were performed by this check owner.

API references read: installed `docs/sdk.md`, `extensions.md`, `compaction.md` and relevant configuration/settings/model/session/message/custom-provider cross-references; SDK extension/settings examples and existing native SDK fixture patterns.

## Final integrated acceptance

Implemented only #33 against current spec #1, preserving #29–32. Defaults remain 135000/150000. Fresh samples alone re-arm thresholds; missing/stale/compaction-unknown samples do not. Direct jumps above escalation emit one advisory. Repeated telemetry has an independent cross-process lifecycle, not the one-shot final-report lifecycle. Each eligible event requires a nonce-bound response from the authenticated current worker session and assignment. Future workflow-profile changes do not change existing assignment monitoring or pins. No handoff mechanics or Centurio context monitor was added.

Final `npm test` passed **318/318**, with zero failures, cancellations or skips. `npm run typecheck`, `npm run build` and `git diff --cached --check` each exited **0**. The validated code/test candidate was the staged diff from baseline `ecc9810c657c69d69bd59e29a1b3a98b280da9a6`, SHA-256 `b34a775dc57d24de381460bc40ee405adb0e72bbc5f2c5629da502f82d3fdce7`, before adding this acceptance summary. Validation run `96cc047c-6926-4837-9b7b-86852e766b02` checked that hash before and after execution. No source or test changed after that run.

### Independent review

Fresh-context Standards and Spec reviewers initially found a test synchronization weakness and two correctness blockers. Fixed-sleep assertions now await observable callbacks/sentinels. Live socket authentication replaces retained `hello.json` as evidence of the current incarnation. Observation authority is separate from future dispatch eligibility. Follow-up reviews found no remaining issues:

- Standards: **OK**, run `cd1dd680-7db0-406d-911d-faf396042806`.
- Spec: **OK**, run `52d47687-0d66-4d8f-a3da-ffca8e731937`.
- Socket lifecycle fix: **OK** for its Standards/Spec impact, run `d98f6f89-fcf7-4230-89e0-8c8c91779eca`.

### Failures resolved before acceptance

The first full-suite invocation used an overlong temporary path and failed Unix-socket setup. A short disk-backed path fixed setup without changing its protective assertion. Two research tests then exposed a timestamp-only state difference; they now compare unchanged durable state and unchanged monitored-principal keys separately from context samples.

A later integrated run exposed post-test `ECONNRESET` on accepted worker sockets when owner revocation aborted live context checks. The original failure reproduced three times in a focused test. An additional actual-server/public-`off` regression produced the corresponding `EPIPE` write failure. A local accepted-socket error handler now destroys only the failed connection. Tests verify no late wake, observation refresh, worker turn or assignment settlement after disposal. The final integrated run passed both original failing files and the new regression.

The native check above remains bounded Legatus SDK/API evidence. Its code, sampling, follow-up and compaction assumptions did not change during these transport fixes, so it was not replayed. Separate-process and actual-worker-handler tests establish the added transport facts, not a live Tribunus/Herdr journey. An unresponsive control peer can leave a check pending until disposal; no numeric timeout or broader recovery controller was added. #41 still owns whole-product installed journeys.

Task-owned disposable validation data was cleaned after settlement and evidence capture. Retention-managed Pi/subagent runtime was preserved. No live Herdr tab was opened, no global settings changed, and no push or tracker mutation was performed.
