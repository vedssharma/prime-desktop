# Writable desktop roadmap

## Step 1 — owned-session execution boundary (implemented for CLI 0.9.6)

Use the documented LF JSONL RPC subprocess interface, not mutable public daemon
runtime IDs. Bound each desktop session to one owned process/connection, never
expose new/switch/fork/import or arbitrary RPC commands, and fail on unexpected
identity changes. Verify client-owned worker isolation against the installed CLI
before enabling prompt/abort/model actions. Existing shared CLI sessions remain
read-only. Uncertain prompt outcomes must never auto-retry.

This isolates control routing, not filesystem permissions. Agents execute with the
user's permissions. A future sandbox or enforceable approval mechanism is separate.

## Step 2 — prompting and agent tools (initial implementation)

After isolation/lifecycle tests pass, enable new desktop sessions, prompts, follow-ups,
stop, and transcript streaming. Document that closing an owned RPC process stops its
work, unlike detaching a resident CLI worker. Persist desktop session references
without secrets, and avoid silently taking ownership of existing CLI sessions.

## Step 3 — providers and models (guided authentication implemented)

Prime Agent 0.9.6 exposes available models and session model/reasoning setters in RPC,
but no supported login/OAuth/API-key-write API. Provide guided CLI login and refresh,
not a fake desktop auth flow or manual auth.json manipulation. Never label an
available-model catalog as proof of a valid account. Never send /login to the model.

## Step 4 — workspace explorer, editor and review

Add explicit workspace grants, path/symlink boundaries, size limits and binary-file
handling. Direct saves need external-change detection and recoverable backups.
Git diff/review is not a sandbox or a guarantee that arbitrary agent tools stay in
one directory. Show these limits accurately.

## Step 5 — queue and harness features

Expose only documented operations safe within the verified owned-session boundary.
Queue previews without IDs/versioning cannot promise conflict-free editing. Add
fork/compaction/usage/attachments incrementally with native integration coverage.
