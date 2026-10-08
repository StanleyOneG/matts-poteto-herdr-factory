# Ordinary managed verification checkpoint

This is ordinary same-attempt verification. It is not lost-start-receipt acceptance or acceptance of the assignment.

## Source and retained identity

Runtime source matches `/tmp/legion-t03-writer-live/final/source-manifest.json`. Its digest is `7972220e2c1732a90ad5d2119f507c96a491a4d1aadf40019429ec324160561a`. HEAD remains `f24bc6e72e0d4d916b02de7244987cbfeb4c86ef` on `legion/t03-verified-local-tribunus`. No production source changed in this continuation.

The retained attempt is `9abcdf30-b543-4f4b-abec-a2ab45423e9d`. Its reservation is `86b32f0c-5f8b-4a55-bb11-9f6ecc002b04`. The worker remains in `w7:p1`, terminal `term_65d497c9ad7b457`, at `/tmp/legion-t03-writer-live/final/workspaces/55915b29-f63d-4e78-9638-e5f77f4edf3e`.

Fresh identity, clean fixture, known resources, and the standard trust prompt preceded the parent-approved session-only trust selection. No parent-folder or persistent trust was granted. The existing controller then issued `/legion launch 483df5ea-c9f0-46bf-9389-176bb095e798@1`. This reconciled the retained attempt without a second start.

## Actual worker evidence

The worker session is `01a118f4-e60a-72d7-a545-43b929302971`. Its generation is `e395f285-f1e8-4e18-b0f3-232949d07b2d`. Its actual journal is `/home/vscode/.pi/agent/sessions/--tmp-legion-t03-writer-live-final-workspaces-55915b29-f63d-4e78-9638-e5f77f4edf3e--/2026-10-08T00-41-05-290Z_01a118f4-e60a-72d7-a545-43b929302971.jsonl`.

The journal contains these witnesses:

- Native poteto expansion user entry `c4af7491` belongs to initialization command `31bea628-66f3-45d3-9040-971e3fff4d5b`.
- Fresh enabled pstack entry `8b9d61ab` precedes the successful initialization settlement.
- Settled-hook entry `a4228196` names that initialization command and worker generation.
- Bounded assignment command `c67c3b0c-98a9-4dbc-b953-7dc567eb7085` appears in user entry `67a1adb4`, after initialization settlement.
- No tool call precedes the bounded assignment. The only implementation-stage tool call is `bash` with command `pwd`.
- Final assistant entry `d1af935f` reports `Ready for trial worktree \`55915b29-f63d-4e78-9638-e5f77f4edf3e\`.`

The worker uses normal `openai-codex/gpt-6-astra` settings. The loaded target resources include `herdr`, `poteto-mode`, `matt-tdd`, `implement`, and `code-review`. All target diagnostics report ready.

## Public result

The actual controller's `/legion status` displays launch kind `reported`. A separate read-only `Legion.state()` observation also returns `reported` with the same bounded report. This is public visibility, not a private report-file inference. The attempt's original start evidence remains `completed`.

`/tmp/legion-t03-writer-live/ordinary-checkpoint/verify-ordinary.mjs` validates the native journal, ordering, tool calls, target resources, public state, one recorded actual start, and current source hashes. It passed. Its outputs are `ordinary-evidence.json`, `public-state.json`, and `ordinary-verification.txt` in that directory. UI captures include `worker-final-terminal.txt` and `public-status-terminal.txt`.

Host `settings.json`, `.zshrc`, and `trust.json` hashes remain unchanged. All earlier startups remain preserved. No commit, model change, permission change, alternate runner, or #24 work occurred.

## Observer review boundary

The corrected test-only observer is `/tmp/legion-t03-writer-live/ordinary-checkpoint/drop-start-receipt-corrected.ts`. SHA-256 is `08319e15bfda347731194fadd6b374cd3a0eda76a9152dc4e2fd3b0e4a9c9e57`.

It has not been loaded into Pi. Its current target constants are the historical calibration target, not a new live trial. A future target requires separately authorized fixture setup and review of the new exact scope values before loading.

The old observer's command filter and its unreachable structured-result assertions were wrong. The corrected observer matches the actual named-agent and `--pane` invocation. It validates the installed Bash fields `output`, `exit_code`, and boolean `truncated`. It fsyncs the original result before replacing content, structured content, details, and error status. Fixed diagnostic slots record registration, context matching, root capture, selector predicates, injection, and failure without capabilities.

The recorded-event replay passed seven cases through installed Pi's extension runner. Matching input becomes an unknown receipt with durable original evidence and no second interception. Wrong command, parent, session, scope, terminal, or unavailable receipt remains unchanged. The observer's strict TypeScript check passed. Replay and output are `replay-corrected-observer.mjs` and `corrected-replay-result.json` in the checkpoint directory.

Raw live hook content was not persisted in the old trial. The replay's root, nested command, and CLI output come from recorded artifacts. Its authoritative result fields follow the installed Bash emitter and production consumer. The earlier synthetic merge test used the wrong shape and does not establish live validity.

The separate lost-receipt live trial, final checks, independent review, and implementation commit remain pending. The original failures and finite twelve TDD exceptions remain recorded in the preserved recovery checkpoint and mutation artifacts.
