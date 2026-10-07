# Session Dock

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/vedssharma/prime-desktop)

An unofficial, community-built desktop companion for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). Built with Electron, React, and TypeScript.

**Not affiliated with or endorsed by Prime Intellect.** Session Dock has its own name and icon; Prime Agent remains a separately installed dependency. The repository URL retains `prime-desktop` for continuity.

> **Two session modes:** With verified Prime Agent **0.9.6**, new desktop-owned sessions can accept prompts, run tools, change files, stop, and switch models through an owned RPC connection. Existing shared CLI sessions remain read-only. This is control-routing isolation, **not a filesystem sandbox**. See [owned-session design](docs/owned-rpc-design.md). Other CLI versions do not enable desktop-owned writes until reviewed.

## Install

Download the latest version from [Releases](https://github.com/vedssharma/prime-desktop/releases/latest). Session Dock needs the Prime Agent CLI: install it, run `prime-agent` once, and use `/login` and `/model` to set up a provider before opening the app.

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `Session-Dock-<version>-mac-arm64.dmg` |
| Ubuntu / Debian (x64) | `Session-Dock-<version>-linux-amd64.deb` |
| Other Linux (x64) | `Session-Dock-<version>-linux-x86_64.AppImage` |

Intel Macs and Windows are not supported yet.

**macOS.** Open the DMG and drag Session Dock into Applications. Builds are not signed with an Apple Developer ID yet, so the first launch is blocked with a message that Apple could not verify the app. Open **System Settings → Privacy & Security**, scroll to the message about Session Dock and click **Open Anyway**, then confirm. (On macOS 14 and earlier you can instead Control-click the app in Applications and choose **Open**.) Later launches open normally. Do not turn off Gatekeeper to do this.

**Ubuntu / Debian.** Install the package with `sudo apt install ./Session-Dock-<version>-linux-amd64.deb`, then start Session Dock from your applications menu. The package installs an AppArmor profile so Electron's sandbox works on Ubuntu 24.04.

**Other Linux.** Make the AppImage executable (`chmod +x Session-Dock-*.AppImage`) and run it. AppImages need FUSE 2 (`libfuse2` or `libfuse2t64` on Ubuntu-based systems).

**Check a download.** Each release includes `SHA256SUMS`. Run `shasum -a 256 <file>` on macOS or `sha256sum <file>` on Linux and compare the result with the matching line.

## Run locally

Requirements: Node.js 22.12+ (or a current supported Node.js release), npm, and an installed, configured `prime-agent` CLI.

```sh
git clone https://github.com/vedssharma/prime-desktop.git
cd prime-desktop
npm ci
npm run dev
```

Authenticate and choose your default model in the CLI first (`prime-agent`, then `/login` and `/model`). The desktop app uses the same local agent service, credentials, workspaces, and saved conversations. It does not ask for or store provider API keys.

```sh
npm run build       # Type-check and compile the UI and Electron code
npm start           # Run the compiled desktop app
npm run lint        # ESLint (TypeScript and React hooks rules)
npm run check       # Lint, typecheck and every unit/UI test suite (what CI runs)
npm test            # Backend unit tests
npm run test:coverage  # Unit tests with a coverage report (CI publishes it on Linux)
npm run test:ui     # Browser UI tests with a fake backend
npm run test:ui:coverage  # UI tests with a per-file coverage report of src/ (CI publishes it on Linux)
npm run test:electron  # Native Electron tests with simulated daemons (no LLM requests)
npm run smoke       # Read-only Electron smoke test against your local CLI
npm run dev:web     # Browser-only UI preview; cannot control local sessions
npm run package     # Build an unpacked app for your current platform
npm run dist        # Build an installer for your current platform
```

The browser preview deliberately has no access to the daemon. Use the Electron app for real sessions.

## macOS build

A local Apple Silicon build is generated at `release/mac-arm64/Session Dock.app`. Open it with:

```sh
open "release/mac-arm64/Session Dock.app"
```

The renamed app uses a new application ID and local preferences profile. Existing CLI sessions are unchanged; you may need to select your workspace and model again. Internal `PRIME_DESKTOP_*` environment variables remain supported for compatibility.

On macOS, closing the window keeps the app and desktop-owned work running. **Quitting the app stops its desktop-owned sessions after confirmation.** On Linux, closing the last window requests quit. Shared CLI sessions keep running in either case. A forced process kill can leave an upstream cleanup grace period; it is not an instant cancellation guarantee. Tools can also create independent resident agents, which can outlive the desktop session and must be managed separately in the CLI.

## What it does

- Create desktop-owned sessions in trusted workspaces using your existing CLI credentials.
- Send prompts/follow-ups, attach images, view streamed output, stop work, and change the model when idle.
- Browse and search existing Prime Agent sessions without changing them. Sidebar search matches titles, folders, tags and conversation text, with an excerpt of the match.
- Read conversations, Markdown responses, and tool output.
- Copy responses through a validated native clipboard bridge.
- Keep separate unsent drafts for each session while the app is open, and optionally across restarts.
- Remember the last workspace and model selection across launches.
- Configure appearance, readability, and connection paths without changing CLI state.
- Export or copy a conversation as Markdown or JSON (session menu or command palette).
- Syntax-highlighted code blocks and one-line previews of tool output.
- File edits by the agent's `edit` tool show as diffs: the proposed replacements on the call and the applied diff (with line numbers) on the result. **Show raw** gives the original output, and **Show in Changes** opens that file's Git diff in the workspace panel.
- Native notifications when a session finishes while the app is in the background (Settings → Readability).
- Pin sessions, add local tags, filter by tag, and group the sidebar by date or workspace. Pins and tags are stored only in this app.
- Command palette (Cmd/Ctrl+K) for actions and jumping between sessions.
- Find in the open conversation (Cmd/Ctrl+F), including collapsed tool output. Messages hidden behind **Load earlier** can be loaded into the search.
- Read-only workspace panel: Git changes with diffs, and a file browser with previews. Paths are confined to the session's folder, symlinks are not followed, and Git is run with external diff and fsmonitor hooks disabled. This is a viewer, not a sandbox for agent tools.
- Preserve saved desktop history when a session closes. Closed sessions remain read-only until explicitly resumed with renewed workspace trust.
- Archive closed desktop sessions to hide them from the sidebar (**Show archived** brings them back), or delete them: the saved transcript moves to the system trash and workspace files are not touched. Shared CLI sessions cannot be archived or deleted from the app.

## Appearance

Open **Settings** (the gear in the sidebar) to customize the app:

- **Theme:** Light, Dark, or System. System follows your OS appearance and updates when it changes.
- **Palette:** Stone, Slate, or Sand for neutral surfaces and backgrounds.
- **Accent:** Choose a preset or use a custom color picker / six-digit hex value.

Changes apply immediately and persist locally across launches. Accent text and
button labels adjust for contrast. **Reset appearance** restores System, Stone,
and the default lime accent without touching workspace/model choices or drafts.
These are desktop-only settings and do not change the CLI's theme.

## Drafts and follow-ups

By default, drafts live only in renderer memory. Switching sessions keeps them, but closing or reloading the window clears them. To keep unsent draft text across restarts, turn on **Keep unsent draft text** in Settings → Readability. Draft text is then saved unencrypted in the app's local storage on this device; attached images are never saved. Turning the setting off deletes the saved text.

This workflow is enabled only for open desktop-owned sessions on the verified CLI version; shared and closed sessions are read-only. During a running session, Enter (or **Queue follow-up**) submits a message for after the current work finishes. The app confirms admission; that is not a guarantee that the work has completed. A failed submission keeps your draft. An accepted submission clears only the exact draft that was sent, even if you have switched sessions or typed something new.

## Resume and fork saved history

Close a desktop-owned session, select it in the sidebar, and open **Session actions**:

- **Resume saved session** reopens the same saved conversation and workspace.
- **Fork saved session** creates a separate conversation from the saved history in
  the same workspace. The original stays closed.

Both actions require renewed workspace trust and verified Prime Agent 0.9.6. Neither
sends a prompt automatically. Shared CLI sessions cannot be resumed or forked by the
desktop. A live desktop session must be closed first. The fork dialog can copy full
history or history through a selected earlier user/assistant message, including that
message. Assistant messages containing tool calls cannot be selected. Identity mismatches, unavailable workspaces, and
ownership conflicts fail visibly without takeover or automatic retry.

## Image attachments

Use **Attach images** in a writable desktop-owned session or before creating one.
PNG, JPEG, and WebP are supported: up to four images, totaling 384 KiB, at most
16 megapixels and 8192 pixels on each side. Resize larger files before attaching.
The selected model must report image support; new sessions check the actual CLI
model before submitting the first prompt. Image-only prompts and queued follow-ups
are supported. Remove thumbnails to discard attachments before sending.

Unsent images stay in each draft's memory and disappear on reload. Accepted images
become part of the CLI transcript and appear in saved history and conversation
exports. Failed submissions keep the draft; late admission never clears newer edits.
The complete message and images must fit the 1 MiB RPC request limit. Shared and
closed sessions remain read-only. Remote Markdown images remain external links.

## Architecture

```text
React UI → isolated preload API → Electron main process → local Prime Agent daemon
```

The renderer has no Node.js access. An allowlisted IPC bridge exposes session operations. Only the main process can use the local daemon socket or launch the CLI. Provider credentials stay with Prime Agent. External links open in the system browser; app navigation and permission requests are blocked.

The desktop app does not implement a second agent harness, write directly to session files, or shut down the shared daemon on exit.

## Scope

This is an initial desktop companion, not complete CLI feature parity. Login, provider setup, extension-specific interactive dialogs, branching, schedules, and advanced harness settings remain in the CLI. Desktop-owned sessions stream replies into the view as they are generated; shared CLI sessions refresh periodically. This app runs agents with your normal user permissions; workspaces are not sandboxes.

Local development and unsigned packaging are supported. Signed/notarized public distribution needs platform signing credentials and release setup. Browsing shared CLI sessions needs a daemon speaking protocol 7 / schema 28 or newer (Prime Agent 0.9.5 and later); other protocol versions fail with an explicit compatibility error. Desktop-owned sessions additionally need a verified CLI release, currently 0.9.6, listed in `electron/cli-versions.ts`. If another version is installed, the app says which one it found and keeps shared sessions read-only.

For nonstandard installations, set `PRIME_AGENT_BIN` to the CLI executable and `PRIME_DESKTOP_SOCKET` to the public daemon socket path. The default socket discovery currently targets macOS and Linux. Windows is unsupported and no Windows installer is offered. Saved transcripts larger than 64 MiB must be opened in the CLI.

## Documentation

Generated codebase documentation is available on
[DeepWiki](https://deepwiki.com/vedssharma/prime-desktop), where you can also ask
questions about the code. It is produced automatically from this repository and may
lag behind recent changes; the design notes in [docs/](docs/) and this README take
precedence.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and test instructions.

## License and attribution

MIT — see [LICENSE](LICENSE). Bundled DM Sans and Space Grotesk fonts are
licensed under the SIL Open Font License; notices are in `public/licenses/`.
Dependency notices ship in `THIRD_PARTY_NOTICES.txt` and the About dialog. Packaged apps also include the project license and full Electron/Chromium notices; packaging verifies their presence.

This project is not affiliated with or endorsed by Prime Intellect. Prime Agent
is a separate project and must be installed independently.

## Release builds

To ship a version, set it in `package.json` and push a matching tag (`v0.2.0`). CI tests
and packages the installers and attaches them to a draft GitHub release; nothing is public
until you publish that draft. See [docs/releases.md](docs/releases.md) for the full steps,
architecture-specific app paths, native validation, checksums and optional
signing/notarization. Signing requires private credentials and has not been validated.

## Providers and model selection

Settings → **Providers & models** groups the available catalog by provider and offers
instructions to run `prime-agent` and `/login`. Complete OAuth or key entry inside
the CLI, then refresh models in the app. No API-key input, OAuth interception, or
manual auth-file editing is implemented. Available models are not proof of valid
credentials. An idle owned session can switch models from its selector; the CLI's
saved default may change too. Shared sessions cannot be switched from this app.

## Owned-session limits

- Requires a verified CLI version (currently 0.9.6) and explicit workspace trust before the first prompt. Supporting a new CLI release means running `npm run test:real-owned` against it (with `PRIME_PROBE_VERSION` set to that version) and adding it to `electron/cli-versions.ts` after review.
- Tools have your normal user permissions; they are not confined to the chosen folder.
- Extensions are disabled and slash commands/navigation/scheduling are not exposed.
- App-owned transcripts live under the app's `owned-sessions/transcripts` directory;
  app display names are local metadata, not edits to shared CLI history.
- Quitting closes owned processes and their work. Closed desktop history can be explicitly resumed or forked after renewed workspace trust.
- Ambiguous admission or process loss is never retried automatically.
- The workspace panel can edit existing UTF-8 text files (up to 512 KiB) in desktop-owned sessions only.
  A save is refused if the file changed on disk since you opened it (for example, the agent wrote to it),
  and the previous bytes are backed up under the app's `workspace-backups` folder (newest 200 kept).
  The check and write are not one atomic step. Creating, renaming and deleting files is not offered.
- The queue shows the agent-reported follow-up count. Queued text, reordering and cancellation
  need upstream IDs/versioning. Closed desktop history supports explicit startup fork and resume.
  Usage, compaction and image attachments are implemented.
- Fork/resume is restricted to closed desktop-owned history. Earlier-message forks require version 3 history; opening shared CLI sessions for writes remains unsupported (see `docs/owned-rpc-design.md`).

`npm run test:electron` uses disposable simulated daemons/RPC processes, including a
deterministic file write in a temporary workspace. It makes no LLM request.
`npm run test:real-owned -- /absolute/path/to/prime-agent` is an opt-in, version-pinned,
no-prompt ownership/lifecycle probe with a private temporary HOME and daemon. It
verifies actual CLI owner isolation, not provider inference or tool correctness.
