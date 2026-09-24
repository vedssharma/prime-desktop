# Contributing

Issues and pull requests are welcome. For larger changes, open an issue first.

## Development

Use Node.js 22.12+ and npm. Clone the repository, then run:

```sh
npm ci
npm run dev
```

The desktop app requires an installed, configured Prime Agent CLI. Use
`npm run dev:web` for a read-only browser preview without the CLI.

## Validation

```sh
npm run build
npm test
npx playwright install chromium
npm run test:ui
```

Unit and UI tests use simulated daemon responses. `npm run smoke` additionally
launches Electron and reads your local CLI sessions; it never sends prompts or
changes sessions. Do not use real sessions for destructive integration tests.

Keep provider credentials in the CLI, not the renderer. Never commit session
transcripts, API keys, `.env` files, or screenshots of private conversations.
Preserve resident-session behavior: closing the app must not stop the daemon.

## License

Contributions are provided under the repository's MIT license. Bundled fonts
retain their respective SIL Open Font License notices.

## Toolchain and restarts

Use `.nvmrc` (Node 22, minimum 22.12) and the npm version in `packageManager`.
`npm run typecheck` includes tests and Playwright configuration. Install browser
binaries with `npx playwright install chromium` before UI tests.

Electron 44 downloads its native runtime lazily. `npm run notices` ensures that
runtime is installed before reading its license files; no GUI or daemon is started.
Restart `npm run dev` after edits in `electron/` (main/preload compilation happens
once at startup). Renderer changes use Vite hot reload. This is intentional to avoid
restarting native windows and discarding unsent drafts unexpectedly.
