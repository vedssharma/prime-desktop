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

## Step 4 — workspace explorer, editor and review (implemented: read-only explorer, Git diff, guarded text editing)

Add explicit workspace grants, path/symlink boundaries, size limits and binary-file
handling. Direct saves need external-change detection and recoverable backups.
Git diff/review is not a sandbox or a guarantee that arbitrary agent tools stay in
one directory. Show these limits accurately.

## Step 5 — queue and harness features (usage and compaction implemented)

Expose only documented operations safe within the verified owned-session boundary.
Queue previews without IDs/versioning cannot promise conflict-free editing.

Implemented for desktop-owned sessions (RPC per upstream `docs/rpc.md`, v0.9.6):

- **Usage:** `get_session_stats` (read-only) shows tokens, estimated cost and context
  usage. The session identity is verified before and after the read and the response's
  `sessionId` must match. Null context estimates (after compaction) are shown as
  "not yet estimated", never as zero.
- **Compaction:** `compact` runs only while the session is idle (no streaming,
  compaction, unfinished or queued work), with a 5-minute timeout and optional
  custom instructions (the UI currently sends none). It rewrites the agent's working
  context inside the same persistent session and keeps the identity. An uncertain
  outcome closes the pipe and is never resent.

Still open, each needing its own design and native integration coverage:

- **Fork / clone:** `fork`, `clone` and `switch_session` re-point the RPC process at a
  different session file. That is exactly the identity change the owned-session guard
  treats as a fault and freezes on. Supporting it means a new model where a fork is a
  new desktop-owned session (new process, new metadata record) rather than a mutation
  of the current one, plus a decision about which entry IDs the UI may offer.
- **Attachments:** `prompt` accepts base64 `images` (`{type, data, mimeType}`). Needs a
  picker with type/size limits, a check that the selected model supports images,
  rendering of image content in transcripts, and a total-request bound below the
  1 MiB RPC frame limit (`electron/rpc-client.ts`), which likely means downscaling
  or rejecting large images.
- **Queue editing:** unchanged; the count is shown, but message text and cancellation
  are not available without IDs/versioning.
