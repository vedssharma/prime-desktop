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

## Step 5 — queue and harness features (usage, compaction, image attachments and saved-history startup implemented)

Expose only documented operations safe within the verified owned-session boundary.
Queue previews without IDs/versioning cannot promise conflict-free editing.

Implemented for desktop-owned sessions (RPC per upstream `docs/rpc.md`, v0.9.6):

- **Usage:** `get_session_stats` (read-only) shows tokens, estimated cost and context
  usage. The session identity is verified before and after the read and the response's
  `sessionId` must match. Null context estimates (after compaction) are shown as
  "not yet estimated", never as zero.
- **Compaction:** `compact` runs only while the session is idle (no streaming,
  compaction, unfinished or queued work), with a 5-minute timeout and optional
  custom instructions supplied through the usage panel (up to 16 KiB). It rewrites the agent's working
  context inside the same persistent session and keeps the identity. An uncertain
  outcome closes the pipe and is never resent.

- **Image attachments:** new prompts and follow-ups accept up to four PNG/JPEG/WebP
  images, totaling at most 384 KiB decoded. The picker rejects corrupt files and images
  over 16 megapixels or 8192 pixels on either side. Resize larger images externally.
  Draft images remain in memory per session, clear only on unchanged-draft admission,
  and survive rejection or late responses. The main process revalidates MIME/signatures,
  base64, aggregate size and the complete escaped UTF-8 RPC frame (1 MiB including ID/LF).
  Current owned model metadata must explicitly include image input before admission.
  Live/saved transcripts and JSON/Markdown exports retain supported image blocks.
  Unsupported/oversized historical images display an unavailable notice.
  Native Electron tests use disposable image fixtures and make no model request.

- **Saved-history fork / resume:** explicit startup `--fork <file>` creates a
  separate owned process, persistent identity, transcript and desktop metadata record.
  `--resume <file>` binds a new owned pipe to the exact expected saved identity.
  Both accept only closed desktop-owned history, require renewed workspace trust,
  validate the stored header/workspace/path, and reject duplicate openings or upstream
  lease conflicts. No prompt is sent automatically; no navigation RPC is enabled.
  Native no-prompt coverage on pinned v0.9.6 verifies peer denial, separate fork identity,
  parent history, exact resume identity and rejection of concurrent resume. Native
  Electron fixture tests cover the dialogs, IPC and independent follow-ups.

Still open, each needing its own design and native integration coverage:

- **Fork from an earlier message:** selecting individual entry IDs and safely making
  a partial-history fork is not implemented. Current startup fork copies saved history.

- **Queue editing:** unchanged; the count is shown, but message text and cancellation
  are not available without IDs/versioning.
