# Session Dock

An unofficial, community-built desktop companion for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). Built with Electron, React, and TypeScript.

**Not affiliated with or endorsed by Prime Intellect.** Session Dock has its own name and icon; Prime Agent remains a separately installed dependency. The repository URL retains `prime-desktop` for continuity.

> **Current safety limitation:** Prime Agent 0.9.5 is supported in read-only compatibility mode. Browse persisted sessions in the desktop; create/send/stop/rename/delete in the CLI. See [daemon safety](docs/daemon-safety.md). The workflow UI remains tested with simulated backends but is disabled for the installed unsafe protocol.

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
npm test            # Backend unit tests
npm run test:ui     # Browser UI tests with a fake backend
npm run smoke       # Read-only Electron smoke test against your local CLI
npm run dev:web     # Browser-only UI preview; cannot control local sessions
npm run package     # Build an unpacked app for your current platform
npm run dist        # Build an installer for your current platform
```

The browser preview deliberately has no access to the daemon. Use the Electron app for real sessions.

## macOS build

An unsigned Apple Silicon app is generated at `release/mac-arm64/Session Dock.app`. Open it with:

```sh
open "release/mac-arm64/Session Dock.app"
```

The renamed app uses a new application ID and local preferences profile. Existing CLI sessions are unchanged; you may need to select your workspace and model again. Internal `PRIME_DESKTOP_*` environment variables remain supported for compatibility.

Closing the window does not stop agent work. Use Stop in a session to interrupt it. Deleting a session stops its worker and removes its shared CLI history, not just the desktop entry.

## What it does

- Browse and search existing Prime Agent sessions.
- Start a session in a chosen workspace with the configured default model or an available model.
- Read conversations, Markdown responses, and tool output.
- Send prompts, queue follow-ups while an agent works, and stop current work.
- Keep separate unsent drafts for each session while the app is open.
- Remember the last workspace and model selection across launches.
- Rename and delete sessions with confirmation.
- Keep resident sessions running when the app closes, so you can return from the desktop or CLI.

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

Drafts live only in renderer memory. Switching sessions keeps them, but closing or reloading the window clears them. Only the new-session workspace path, model choice, and appearance settings are stored locally.

During a running session, Enter (or **Queue follow-up**) submits a message for after the current work finishes. The app confirms admission; that is not a guarantee that the work has completed. A failed submission keeps your draft. An accepted submission clears only the exact draft that was sent, even if you have switched sessions or typed something new.

## Architecture

```text
React UI → isolated preload API → Electron main process → local Prime Agent daemon
```

The renderer has no Node.js access. An allowlisted IPC bridge exposes session operations. Only the main process can use the local daemon socket or launch the CLI. Provider credentials stay with Prime Agent. External links open in the system browser; app navigation and permission requests are blocked.

The desktop app does not implement a second agent harness, write directly to session files, or shut down the shared daemon on exit.

## Scope

This is an initial desktop companion, not complete CLI feature parity. Login, provider setup, extension-specific interactive dialogs, branching, schedules, and advanced harness settings remain in the CLI. Session display refreshes periodically rather than providing a token-by-token renderer stream. This app runs agents with your normal user permissions; workspaces are not sandboxes.

Local development and unsigned packaging are supported. Signed/notarized public distribution needs platform signing credentials and release setup. The integration targets Prime Agent 0.9.5 with daemon protocol 7 / schema 28 or newer. Other protocol versions fail with an explicit compatibility error; future protocol changes may need an adapter update.

For nonstandard installations, set `PRIME_AGENT_BIN` to the CLI executable and `PRIME_DESKTOP_SOCKET` to the public daemon socket path. The default socket discovery currently targets macOS and Linux. Windows packaging is scaffolded, but Windows daemon transport is not supported yet. Saved transcripts larger than 64 MiB must be opened in the CLI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and test instructions.

## License and attribution

MIT — see [LICENSE](LICENSE). Bundled DM Sans and Space Grotesk fonts are
licensed under the SIL Open Font License; notices are in `public/licenses/`.
Dependency licenses remain with their respective packages.

This project is not affiliated with or endorsed by Prime Intellect. Prime Agent
is a separate project and must be installed independently.
