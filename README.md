# Session Dock

An unofficial, community-built desktop companion for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). Built with Electron, React, and TypeScript.

**Not affiliated with or endorsed by Prime Intellect.** Session Dock has its own name and icon; Prime Agent remains a separately installed dependency. The repository URL retains `prime-desktop` for continuity.

> **Two session modes:** With verified Prime Agent **0.9.6**, new desktop-owned sessions can accept prompts, run tools, change files, stop, and switch models through an owned RPC connection. Existing shared CLI sessions remain read-only. This is control-routing isolation, **not a filesystem sandbox**. See [owned-session design](docs/owned-rpc-design.md). Other CLI versions do not enable desktop-owned writes until reviewed.

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

On macOS, closing the window keeps the app and desktop-owned work running. **Quitting the app stops its desktop-owned sessions after confirmation.** On Linux, closing the last window requests quit. Shared CLI sessions keep running in either case. A forced process kill can leave an upstream cleanup grace period; it is not an instant cancellation guarantee.

## What it does

- Create desktop-owned sessions in trusted workspaces using your existing CLI credentials.
- Send prompts/follow-ups, view streamed output, stop work, and change the model when idle.
- Browse and search existing Prime Agent sessions without changing them.
- Read conversations, Markdown responses, and tool output.
- Copy responses through a validated native clipboard bridge.
- Keep separate unsent drafts for each session while the app is open.
- Remember the last workspace and model selection across launches.
- Configure appearance, readability, and connection paths without changing CLI state.
- Preserve saved desktop history when a session closes. Closed sessions are read-only in this first owned-session release; automatic resume and deletion are not offered.

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

This workflow is enabled only for open desktop-owned sessions on the verified CLI version; shared and closed sessions are read-only. During a running session, Enter (or **Queue follow-up**) submits a message for after the current work finishes. The app confirms admission; that is not a guarantee that the work has completed. A failed submission keeps your draft. An accepted submission clears only the exact draft that was sent, even if you have switched sessions or typed something new.

## Architecture

```text
React UI → isolated preload API → Electron main process → local Prime Agent daemon
```

The renderer has no Node.js access. An allowlisted IPC bridge exposes session operations. Only the main process can use the local daemon socket or launch the CLI. Provider credentials stay with Prime Agent. External links open in the system browser; app navigation and permission requests are blocked.

The desktop app does not implement a second agent harness, write directly to session files, or shut down the shared daemon on exit.

## Scope

This is an initial desktop companion, not complete CLI feature parity. Login, provider setup, extension-specific interactive dialogs, branching, schedules, and advanced harness settings remain in the CLI. Session display refreshes periodically rather than providing a token-by-token renderer stream. This app runs agents with your normal user permissions; workspaces are not sandboxes.

Local development and unsigned packaging are supported. Signed/notarized public distribution needs platform signing credentials and release setup. The integration targets Prime Agent 0.9.5 with daemon protocol 7 / schema 28 or newer. Other protocol versions fail with an explicit compatibility error; future protocol changes may need an adapter update.

For nonstandard installations, set `PRIME_AGENT_BIN` to the CLI executable and `PRIME_DESKTOP_SOCKET` to the public daemon socket path. The default socket discovery currently targets macOS and Linux. Windows is unsupported and no Windows installer is offered. Saved transcripts larger than 64 MiB must be opened in the CLI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and test instructions.

## License and attribution

MIT — see [LICENSE](LICENSE). Bundled DM Sans and Space Grotesk fonts are
licensed under the SIL Open Font License; notices are in `public/licenses/`.
Dependency notices ship in `THIRD_PARTY_NOTICES.txt` and the About dialog. Packaged apps also include the project license and full Electron/Chromium notices; packaging verifies their presence.

This project is not affiliated with or endorsed by Prime Intellect. Prime Agent
is a separate project and must be installed independently.

## Release builds

See [docs/releases.md](docs/releases.md) for architecture-specific app paths, native
validation, checksum generation, and optional signing/notarization. Signing requires
private credentials and has not been validated locally. Manual CI builds produce
reviewable artifacts, not automatic public releases.

## Providers and model selection

Settings → **Providers & models** groups the available catalog by provider and offers
instructions to run `prime-agent` and `/login`. Complete OAuth or key entry inside
the CLI, then refresh models in the app. No API-key input, OAuth interception, or
manual auth-file editing is implemented. Available models are not proof of valid
credentials. An idle owned session can switch models from its selector; the CLI's
saved default may change too. Shared sessions cannot be switched from this app.

## Owned-session limits

- Requires verified CLI 0.9.6 and explicit workspace trust before the first prompt.
- Tools have your normal user permissions; they are not confined to the chosen folder.
- Extensions are disabled and slash commands/navigation/scheduling are not exposed.
- App-owned transcripts live under the app's `owned-sessions/transcripts` directory;
  app display names are local metadata, not edits to shared CLI history.
- Quitting closes owned processes and their work; closed history cannot yet be resumed.
- Ambiguous admission or process loss is never retried automatically.
- Workspace explorer/editor/diff approval and richer queue controls are future steps,
  not included in this initial writable integration.

`npm run test:electron` uses disposable simulated daemons/RPC processes, including a
deterministic file write in a temporary workspace. It makes no LLM request.
`npm run test:real-owned -- /absolute/path/to/prime-agent` is an opt-in, version-pinned,
no-prompt ownership/lifecycle probe with a private temporary HOME and daemon. It
verifies actual CLI owner isolation, not provider inference or tool correctness.
