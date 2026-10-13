---
name: temp-storage
description: Keep temporary data on disk and clean up owned disposable files. Use before tests or native checks, bulk temporary writes, subagent delegation, or temporary-data cleanup in this repository.
---

# Temporary storage

## Goal

Keep bulk temporary data out of the system `/tmp` tmpfs. Use `/workspaces/astraprojects/.tmp` on the disk-backed workspace mount. Reclaim disposable data between runs without losing evidence, resumable sessions, or another actor's work.

This skill governs storage for already-authorized work. It does not authorize additional tests, global configuration changes, process restarts, or deletion of existing unrelated data. Preserve the [Legion engineering policy](../../../docs/agents/legion-engineering-policy.md).

## 1. Check storage and runtime

Before the first write, inspect the actual filesystem and free space with `findmnt -T` and `df -hT`. If the base does not exist, inspect its nearest existing ancestor and recheck after creating it. Confirm the base resolves onto the disk-backed mount and assess available capacity against the planned work. If backing or capacity is unsuitable or unknown, report the blocker instead of falling back to `/tmp` or the container root filesystem.

Separate three kinds of data:

- **Disposable data.** Fixtures, scratch files, copied dependencies, caches, and intermediate logs belonging to one command or test run.
- **Retained evidence.** Results and diagnostics needed for review, a handoff, or a pending decision.
- **Runtime state.** Pi output files, pi-subagents lifecycle records, session journals, and data needed for continuation or result delivery.

Check whether Pi itself started with disk-backed `TMPDIR`, `TMP`, and `TEMP`. Pi writes truncated tool output using its own temporary directory. Setting `export` inside the `bash` tool affects that shell and its descendants, not the already-running Pi process or native subagent tools.

For an authorized future startup configuration, give Pi a stable disk-backed temporary directory. Set `PI_SUBAGENTS_TEMP_ROOT` to a separate stable runtime directory before loading pi-subagents. Keep these roots outside disposable per-run directories and preserve the configured shell wrappers. Do not change them between launches that need the same retained state.

For an existing session, redirect commands you control and report runtime writes still using `/tmp`. Leave active state in place. Restarting Pi or migrating retained state requires separate approval.

**Ready when** the backing filesystem is checked and any runtime-routing limitation is identified.

## 2. Isolate each run

Create a short, unique disposable directory directly under the base for each test invocation or bulk operation. Give concurrent workers separate directories. Record the exact path and owner before starting work. Use short identifiers rather than nested session, child, and attempt names.

Set `TMPDIR`, `TMP`, and `TEMP` explicitly in the same shell invocation as the command. Reapply them in later tool calls. Include them when constructing a restricted child `env`. Preserve any configured stable `PI_SUBAGENTS_TEMP_ROOT`. Never redirect production subagent runtime state into the disposable command directory.

Write explicit logs, backups, archives, and scratch files into the owned directory. Replace absolute `/tmp/...` destinations. Configure tool-specific caches and output paths separately when those tools ignore the temporary-directory variables. Preserve the command's exit status when capturing or displaying logs.

Before delegation, pass this skill's absolute path. Each child owns its disposable directories and cleanup. Pass retained paths to the coordinator only when continuation or cleanup needs a handoff. A delegation prompt does not reconfigure the native subagent runtime.

Check path compatibility before a series of runs. Inspect tests that assert a literal `/tmp` prefix and consumers with Unix socket path limits. Check the full endpoint length, not just the base directory. Fix incompatibilities only within the task's authorized scope. Otherwise report the blocked operation without disabling assertions or silently reverting bulk writes to `/tmp`.

**Ready when** every planned writer has a destination, an owner, and any required environment or output-path setting.

## 3. Verify actual writes

On the first already-authorized run, inspect the resulting fixture, log, cache, and runtime paths. Confirm disposable files land in the owned directory. Check its size and any writes outside it before repeating the operation.

Treat repeated focused tests as separate runs. Finish the cleanup decision for each run before starting the next sequential run. Concurrent runs keep independent ownership. If unexpected data accumulates, identify its producer before repeating it.

Do not infer successful routing from environment variables alone. Check paths returned by Pi and pi-subagents separately from paths created by shell commands.

**Verified when** actual output locations are known and unresolved routing exceptions are reported.

## 4. Clean disposable data

The creator owns cleanup until another actor explicitly accepts the handoff. Before deleting a disposable directory:

1. Confirm its recorded owner and exact canonical path. The target must be a strict descendant of `/workspaces/astraprojects/.tmp`, not the base, a symlink escape, or a shared root.
2. Confirm every process, child, and consumer using it has settled. A timeout, cancellation request, idle terminal, or completion message alone is insufficient.
3. Confirm no reviewer, continuation, rollback, or pending human decision still needs its contents. Save the required evidence separately and verify that the saved files are readable.
4. Delete only the confirmed disposable directory or explicitly identified disposable contents. Verify removal and report any cleanup failure without hiding the original command result.

A failed run may be cleaned after diagnostics are preserved and all consumers have settled. Keep ambiguous or still-needed data. Record the retained path, owner, purpose, and condition for the next cleanup decision.

Keep runtime roots, resumable async records, journals, and pending result-delivery data out of disposable cleanup. Use pi-subagents' supported retention mechanism for its managed state. A completed child may still be resumable.

A location under the temporary base does not authorize deleting worktrees, branches, user data, or authoritative journals. Follow their separate ownership policies. Existing `/tmp` contents and pre-existing directories require a separate ownership assessment. Never use blanket `/tmp` globs or age alone as deletion authority.

**Complete when** each owned disposable path is either removed or retained with a reason, an owner, and a cleanup condition.

## Work silently by default

Perform routing checks and cleanup without routine progress messages or completion reports. Keep ownership information with the working task, not in a separate reporting artifact.

Notify the responsible coordinator or user only about a blocker, unresolved routing, cleanup failure, or a required cleanup handoff. Include only the affected path, the problem, and the action or decision needed. Report an unchanged limitation once, not after every run. When handing off retained data, include its owner and cleanup condition. Successful routing and cleanup need no announcement.
