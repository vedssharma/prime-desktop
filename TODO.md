# Session Dock — review and prioritized to-do list

Reviewed source baseline: `3045a1c` (appearance settings).

This backlog tracks the review and subsequent fixes. Checked items have implementation
notes below. No application code was changed during the original review. Destructive and mutation scenarios used fake
sessions; checks against the installed CLI were read-only. Review scripts and
private screenshots are under ignored `artifacts/review/`, not intended for publication.

## Validation performed

- Production build and type checking: passed.
- Existing unit/backend tests: **19/19 passed**.
- Existing browser UI tests: **31/31 passed**.
- `npm audit`: **0 reported vulnerabilities**; this is not a complete security audit.
- Actual Electron: daemon connection, session list and transcript reads, isolated-profile
  appearance changes and reload persistence, renderer Node isolation, and Copy button.
- Adversarial UI tests: delayed/out-of-order reads and mutation responses, modal
  shortcuts, focus changes, draft preservation, narrow sidebar navigation.
- Layout checks at 760×560, 900×600 and 1360×900: Settings stays on screen and scrolls;
  no horizontal page overflow found.
- Production renderer performance probe with 250 modest Markdown messages (~110 KB).
- Packaged archive, license files, platform claims, dev scripts and test coverage review.

## P1 — fix first: session/action safety

### [x] 1. Prevent background actions while a modal is open — confirmed

**Implementation:** Background panels are inert while any modal is open; global New session and submission are guarded, and asynchronous completions no longer move focus. Added shortcut and delayed-send regressions.


**Where:** `src/App.tsx:146–150,170–202,235`.

**Reproduction:** Open Settings while a session is selected, press Cmd/Ctrl+N,
then type and press Enter. The dialog remains visible, but the shortcut changes
session context and the delayed focus moves to the composer behind it. A fake
`createSession` call was recorded. A delayed send completion can also move focus
out of Settings through the unconditional `textarea.focus()` in `finally`.

**Fix:** Suppress background shortcuts while a modal is open, make background
content inert, use a shared accessible dialog with focus restoration, and only
focus the composer if the originating view is still active and no modal is open.

**Acceptance:** Settings/About/Rename/Delete never allow hidden prompt submission;
resolving any pending request does not steal modal focus.

### [ ] 2. Bind every operation to the intended persistent session — confirmed race

**Implementation:** Safety mitigation shipped: current daemon is explicitly read-only; every mutation fails before dispatch. Reads verify the saved header identity and never use reusable runtime IDs. Full write restoration is BLOCKED on an atomic upstream identity contract; see docs/daemon-safety.md.


**Where:** `electron/prime.ts:136–153,198–229`.

The app refreshes its catalog before a mutation, but then sends a reusable runtime
`activeSessionId`. A CLI session switch can replace the conversation behind that
runtime between the lookup and dispatch. An isolated fake-daemon test demonstrated
renaming the wrong conversation. Prompt, abort and kill use the same vulnerable
pattern; those impacts are inferred from the shared routing, not tested on real sessions.

Reads have a related confirmed issue: a cached runtime mapping can return another
session's conversation under the selected session's title. `getMessages` does not
check the `sessionId` returned by `get_state`, and its separate history/state requests
can mix snapshots from different moments.

**Fix:** Prefer persistent session selectors, validate returned identities, and use
coherent snapshots. Coordinate an expected-session-ID check at daemon worker dispatch
for strict mutation safety; another client-side catalog refresh alone cannot close
the race. Fail closed on an identity mismatch and recover the original saved session.

**Acceptance:** Switch runtime identity between lookup and dispatch in isolated tests
for send/rename/abort/delete/read. No command affects a different persistent session,
and no transcript from another session is shown under the original title.

### [x] 3. Keep pending rename/delete operations tied to their original view — confirmed

**Implementation:** Pending dialogs cannot be dismissed with Escape. Completion captures the original target/operation and only navigates away if that session is still selected. Added delayed-delete regression.


**Where:** `src/App.tsx:148,205–208,235`.

Escape closes the delete dialog even while its mutation is pending, bypassing the
backdrop/close-button guards. Select a different session before delete completes:
the late handler unconditionally navigates to New session. It can also close a
newer dialog. Drafts are retained internally, but the unexpected navigation is real.

**Fix:** Capture the operation target and a view/dialog generation; guard completion
side effects. Apply one consistent dismissal policy while mutations are pending.

**Acceptance:** A delayed rename/delete cannot switch an unrelated session or close
a newer modal. Errors remain associated with the operation that caused them.

## P2 — correctness, responsiveness, and release readiness

### [x] 4. Stop older transcript reads from overwriting newer state — confirmed

**Implementation:** Polling and post-send reads share a monotonic request sequence. Session switches invalidate prior reads and errors. Added controlled out-of-order transcript regression.


**Where:** `src/App.tsx:129–141,186–189`.

A polling `getMessages` request can remain pending while sending a prompt triggers
a second read. Resolve the post-send read first and the old poll second: the
conversation rolls back to older/empty content even though the send was accepted.

**Fix:** Use per-session request sequence/generation checks or one coordinated query
cache. Cancel/ignore older reads and use monotonic transcript versions where available.

**Acceptance:** Controlled out-of-order replies never remove newer messages or
replace another session's displayed data.

### [x] 5. Repair Copy response in the actual Electron app — confirmed

**Implementation:** Added allowlisted, main-frame-validated clipboard IPC with input bound and visible error feedback. Native Electron clipboard test restores prior clipboard; no daemon mutations.


**Where:** `electron/main.ts:70`; `src/App.tsx:25`.

The real Copy button left the clipboard unchanged and never displayed “Response
copied.” Direct renderer clipboard access returned “Write permission denied.” The
main process denies every permission request, and the UI silently discards failures.

**Fix:** Prefer a narrow, validated clipboard-write IPC method with sender checks,
or explicitly allow the required permission only for the trusted renderer. Show
an actionable failure state instead of swallowing it.

**Acceptance:** A real Electron click copies the exact displayed response and shows
confirmation; other permissions stay denied. Restore the previous clipboard after tests.

### [x] 6. Reduce transcript rendering and polling costs — measured

**Implementation:** Memoized message rendering by value, limited initial DOM to100 messages with load-earlier, slowed idle polling to10s, and cached unchanged saved files by identity/inode/timestamps/size. Added long-transcript DOM regression.


**Where:** `src/App.tsx:21–26,129–143,230`; `electron/prime.ts:145–157`.

Every draft keystroke re-renders all Markdown messages. With 250 small messages,
typing six characters in a production renderer took ~573 ms with six 82–91 ms
long tasks on this machine. Full transcripts are also fetched/parsed every two
seconds, including idle saved sessions. Measurements are environment-specific,
not a formal performance benchmark.

**Fix:** Memoize message rendering; separate composer and conversation state;
virtualize long histories; avoid re-reading unchanged saved files; use incremental
updates or lifecycle-aware polling rather than replacing whole transcripts.

**Acceptance:** Composer updates do not reparse unchanged messages. Add a repeatable
long-history performance test and verify tool expansion/scroll position stay stable.

### [x] 7. Remove the closed narrow sidebar from keyboard navigation — confirmed

**Implementation:** Closed narrow sidebar is inert/hidden, open drawer makes main panel inert and traps focus, and closing restores focus to its toggle. Added760px keyboard regression.


**Where:** `src/styles.css:332–333`; `src/App.tsx:213–222`.

At width 760, closing the sidebar only translates it off-screen. Tab still reaches
New session, Search, session rows and Reconnect at negative x coordinates. Some
controls can be activated while invisible.

**Fix:** Use `inert`/visibility/tab-order control when the responsive sidebar is closed.
Restore focus to the toggle; trap focus or make the main panel inert while the
sidebar overlay is open.

**Acceptance:** At all supported widths, Tab visits only visible interactive controls.

### [x] 8. Preserve visible saved-transcript entries — confirmed

**Implementation:** Selected-branch history now maps visible custom entries and branch/compaction summaries consistently with active message normalization. Hidden custom entries stay excluded; history before compaction is retained for display. Fixture parity test added.


**Where:** `electron/prime.ts:32–46,53–73`.

The saved parser keeps only `type: "message"`. An official `custom_message` record
with `display: true` disappears when read from disk, while the same visible notice
renders in an active session. Source inspection also found missing branch/context
summary mappings. This produces incomplete history rather than disk data loss.

**Fix:** Map supported custom and summary entries according to the installed session
format, continue excluding hidden custom messages, and define how compaction/context
summaries should appear. Prefer an agent-native reader if a supported one
becomes available rather than duplicating format assumptions.

**Acceptance:** Active/saved fixture pairs preserve user-visible notices, branches and
summaries consistently; hidden entries remain hidden.

### [x] 9. Refresh model discovery instead of caching it forever — source-verified

**Implementation:** Removed service-lifetime model caching (concurrent reads still coalesce). Reconnect always reloads, automatic connected transitions fetch models, and discovery errors are visible. CLI-shim test verifies empty→populated catalog and invalid-output handling.


**Where:** `electron/prime.ts:108–123,159–174`; `src/App.tsx:102,162–164`.

The service permanently caches model results, including an empty list. Logging in or
changing providers in the CLI does not invalidate it, even after Reconnect. Closing
and reopening the macOS window keeps the service alive, so a full app quit may be
needed. This was verified in code, not through a live login change.

**Fix:** Invalidate or explicitly refresh the catalog on reconnect, add a refresh
control/TTL, and distinguish parsing errors from a genuine empty catalog. Reload
models after automatic reconnection as well as manual reconnection.

**Acceptance:** A fake CLI returning [] first and new models after login is reflected
without restarting Electron; failures display actionable diagnostics.

### [x] 10. Include software licenses in distributed app artifacts — confirmed

**Implementation:** Build generates exact dependency/font/Electron notices and fails missing licenses. Project license and notices ship in app.asar; Chromium/Electron notices ship in resources. afterPack validates exact bytes. About exposes acknowledgements.4 notice tests,12 UI smoke tests and fresh archive verification passed.


**Where:** `package.json:42–47`; `README.md` license section.

The packaged `app.asar` includes compiled code and the font OFLs, but excludes the
project LICENSE and a third-party license bundle. Bundled React/lucide code does
not retain its required notices in the generated JS. A source-repository LICENSE
alone does not address the contents of downloaded binaries.

**Fix:** Generate `THIRD_PARTY_NOTICES` for bundled dependencies, ship it and LICENSE
with the application, and verify archive contents during packaging. Preserve the
existing font notices. Keep the UI's third-party acknowledgements easy to find.

**Acceptance:** Inspect a freshly built archive and confirm all required notices
ship alongside bundled code. Recheck notices when dependencies change.

### [x] 11. Add CI and isolated Electron integration tests — coverage gap

**Implementation:** CI added for macOS/Linux clean installs, tests, native Electron and package notice verification. Isolated Electron suite covers cold start, missing executable, reconnect, read-only mutation guards, clipboard, IPC input validation, navigation, picker bridge and detach. Packaging now depends on tests. Local native test passed; hosted CI/platform results must be monitored after push.


**Where:** `package.json:15–16`; `scripts/smoke.mjs`; no tracked CI workflow.

The browser tests inject `window.prime`, so they do not cover preload/IPC validation,
clipboard permissions, native dialogs, packaged file URLs or actual desktop lifecycle.
Package commands compile but do not run tests. Existing smoke tests require a live
CLI and cover only read-only operations.

**Fix:** Add CI for clean installation, typecheck, unit/UI tests, and a fake-daemon
Electron smoke suite. Cover cold start, missing CLI, reconnect, native bridge,
application close, stale runtime IDs, partial mutation failure, and packaged licenses.
Use only disposable fake sessions for mutations. Make release jobs depend on passing tests.

## P3 — usability and maintenance improvements

### [x] 12. Improve first-run connection and model discovery

**Implementation:** Added explicit service-start/reconnect action, setup guidance and editable validated executable/socket paths (stored main-side, no keys), plus model search. Errors already surfaced by item9. Connection edits replace only the client connection, not workers.


Explain CLI installation/login requirements in-app, offer a distinct **Start agent
service** action instead of only Reconnect, expose diagnostics and executable/socket
configuration, and surface model-list errors rather than silently showing an empty
catalog. Add a model search UI for large catalogs. Invalidate the cached model list
when credentials/provider configuration changes (`electron/prime.ts:159–174`).

### [ ] 13. Expose queue state and per-session pending operations

The UI acknowledges admission but does not show the authoritative queued prompts,
allow cancellation/editing, or distinguish queued/running/completed work clearly.
A single global `pending` flag can disable Stop in another session while an operation
is pending. Add per-session operation state, queue visibility, and clear uncertain-
outcome recovery without automatically resending prompts.

### [ ] 14. Make text sizing and status messages easier to read

Several secondary/status/safety labels are 7–9 px, including the no-sandbox warning
and draft/send guidance. Add density/font-size settings, raise useful text minimums,
and test keyboard use and layout at 125–200% zoom. Keep decorative text separate from
critical guidance.

### [ ] 15. Polish custom-color validation and preferences feedback

Typing an invalid hex color and clicking Done can insert an error on blur, moving
the button before its click lands; the first click leaves Settings open. Keep error
space stable or make validation/closing behavior explicit. Add visible feedback for
workspace/model preference save failures (currently swallowed), consistent with the
appearance settings storage warning.

### [ ] 16. Type-check tests and standardize development tooling

Tests and `playwright.config.ts` are excluded from current tsconfigs. An explicit
test typecheck finds TS2345 at `tests/prime.test.ts:106` (`records.map(JSON.stringify)`);
use an explicit callback and add a test tsconfig. Declare Node engines and the tested
package-manager version. Document Electron restart requirements or add main/preload
watch-and-restart support (`scripts/dev.mjs:3–4`).

### [ ] 17. Validate daemon records and enforce byte-based resource limits — source-verified

**Where:** `electron/transport.ts:62–91`; `electron/prime.ts:155–157`.

Syntactically valid JSON such as `null` passes parsing, then `record.type` throws
outside the error handler. Validate object/response schemas before access and turn
bad frames into a controlled connection error. The response limit counts JavaScript
characters rather than bytes, and saved-file stat/read can race file growth. Use
bounded reads and account for parsing/rendering overhead. These are local protocol
robustness issues, not a demonstrated remote exploit.

**Acceptance:** Scalar/null/malformed records and oversized/multibyte payloads fail
cleanly without crashing the desktop or exceeding the documented limits.

### [ ] 18. Clarify and automate release support

Keep Windows marked unsupported until its daemon transport is implemented and tested.
Document host-architecture output paths (the current macOS example is Apple Silicon).
Before general binary distribution, add signing/notarization, reproducible release
artifacts/checksums and supported-platform smoke tests. Unsigned builds and missing
Windows support are already documented limitations, not newly discovered regressions.

## Suggested implementation order

1. Modal/action guards and stable session identity.
2. Stale-response protection and real Electron clipboard support.
3. Keyboard accessibility and long-history performance.
4. License-complete packaging and CI/native integration coverage.
5. Onboarding, queue visibility, text sizing and release polish.

## Boundaries

Passing tests and a clean dependency audit do not establish that every daemon command,
platform, extension or arbitrary transcript is safe or compatible. No real prompt was
sent, no real session was renamed/deleted/stopped, and no release or GitHub issue was
published as part of this review. Implementation status is recorded beside each item below.
