# Desktop-owned RPC safety (Prime Agent 0.9.6)

## Scope and evidence

The desktop can create a **new, client-owned RPC root**. It does not gain write
access to a CLI-owned session. Existing CLI sessions remain read-only.

Reviewed installed version: `0.9.6`, release directory:
`0.9.6-darwin-arm64-97aff54310fde0c7a1d2a596a362db526f553395348a81696ec12c7c339052e1`.
The installed binary ships `docs/rpc.md`, `docs/daemon.md`, and
`docs/agent-connection.md`, but not TypeScript source. Source review used upstream
[`v0.9.6`](https://github.com/PrimeIntellect-ai/prime-agent/tree/e260085dd8f742e0def3d871860c9a888b114851),
commit `e260085dd8f742e0def3d871860c9a888b114851`. The release directory suffix is
not asserted to be a source commit. Documentation's daemon protocol version is
stale; ownership code, not that version label, is the evidence below.

No production prompts or mutations to existing sessions were used to validate
this design. Unit tests use an injected fake RPC transport. A native no-prompt
probe also passed against the installed 0.9.6 binary. It used a temporary HOME,
agent directory, session directory, supervisor registry, and private socket;
no credentials were inherited. The model came from the offline bundled catalog.
The temporary supervisor was stopped directly, never through global shutdown.
Do not silently enable this policy for unreviewed CLI versions.

Reproduce explicitly (not part of the normal test suite):

```text
node scripts/test-real-owned-rpc.mjs /absolute/path/to/prime-agent [report.json]
```

Observed results: `get_state` returned a file inside the private session directory;
`get_messages` was empty; the worker descriptor had an owner client ID. Another
client's `get_state` and `new_session` were rejected for both the active runtime ID
and persistent session ID. The owner identity stayed unchanged. EOF exited with
code 0, removed the worker descriptor, and left a JSONL header with the matching
persistent identity.

All source paths below are relative to `packages/coding-agent/` at that commit.

## Why another CLI cannot switch this root

1. `src/main.ts:185` classifies RPC as client-owned, even when transcripts persist.
   `createDaemonClientConnection` (`:1044`) requires the
   `client_owned_sessions` capability and sends `create` with
   `lifecycle: "client_owned"` (`:1103`). It does not reuse a resident root when
   `clientOwned` is true.
2. `src/modes/daemon/daemon-supervisor.ts:5311-5320` routes through
   `findWorkerForClient` / `isWorkerAccessibleToClient`. A client-owned worker is
   accessible only when its `ownerClientId` equals the protocol client ID.
3. The default command routing block (`daemon-supervisor.ts:2965` onward) applies
   that filter before forwarding `new_session`, `switch_session`, `fork`,
   `import_jsonl`, prompt, abort, and model changes. The narrow worker-token
   exception is for `set_session_name`, not navigation.
4. `attachClient` (`:5437` onward) explicitly rejects a different owner.
   `assertWorkerCreateOwner` (`:3347`) rejects conflicting create/resume ownership
   with `SessionAlreadyActiveError`. Ambiguous selectors fail; they do not pick
   a worker. Canonical session-file leases prevent concurrent transcript writers
   within the same agent directory.
5. `src/modes/agent-connection/daemon-agent-connection.ts:1598-1634` normally can
   reattach a resident client when switching encounters an active session. It
   explicitly refuses that transfer when `ownedSession` is true.
6. Workers receive authenticated supervisor traffic. They trust the supervisor's
   client filtering; they do not independently implement public-client ownership.

This differs from selecting a writable resident worker by its reusable active
session ID. The desktop keeps the new RPC process and its stdin pipe. Renderer
requests never choose an active runtime ID.

The boundary is **process coordination, not a same-user security sandbox**.
Tools and trusted local code retain the user's filesystem/process permissions.
Global shutdown, updates, failures, or external file edits can still affect
availability. A hostile process with the same user's access is out of scope.

## Launch and fixed identity

The desktop launch is equivalent to:

```text
prime-agent --mode rpc --cwd <absolute-project-path> \
  --session-dir <absolute-desktop-session-directory> --no-extensions
```

Optional, real CLI flags are `--daemon-socket <path>` and
`--model <provider/model>`. No positional prompt is passed. The first request is
`get_state`; the returned persistent `sessionId` and `sessionFile` bind the pipe.
The storage directory is canonicalized and the returned file must be directly
inside it. The transcript may not exist until the first message, so startup does
not require a successful file `realpath`.

`--no-session` is not needed for ownership; it disables persistence. There is no
public CLI flag that changes RPC into the SDK's in-process mode. Do not use
internal worker environment variables as an integration shortcut.

The normal configured supervisor is used. This preserves native provider auth,
models, and settings without copying credentials. Creating the root is an
intentional user action and can trigger the normal CLI supervisor startup.

A desktop launched from an agent tool shell can inherit internal process roles.
Before spawning the native CLI, remove all `PRIME_AGENT_INTERNAL_*` variables,
matching upstream `collectDaemonLaunchEnv` in `daemon-protocol.ts`. In particular,
`PRIME_AGENT_INTERNAL_OWNED_WORKER=1` bypasses the daemon client path;
`PRIME_AGENT_INTERNAL_DAEMON_CATALOG=1` diverts startup into the catalog; and
`PRIME_AGENT_INTERNAL_DAEMON_WORKER=1` enables worker startup-gate handling.
Remove `PI_STARTUP_BENCHMARK` as well. Keep native provider credentials and user
profile settings. Runtime injection variables such as `NODE_OPTIONS`,
`BUN_OPTIONS`, and `ELECTRON_RUN_AS_NODE` should not alter the selected CLI launch.
The isolated native probe deliberately sets its own internal registry location;
it does not use the production launch environment.

A separate `--daemon-socket` honors routing isolation, including early startup,
and descriptors are stored under a hash of the socket path. But a private socket
alone does not isolate all side effects: an auto-launched supervisor inherits the
agent directory and default session directory, can scan saved schedules, and
runs normal migrations. A truly separate profile would require inherited
`PRIME_AGENT_CODING_AGENT_DIR` and `PRIME_AGENT_SESSION_DIR`; that also separates
auth and is not this desktop policy.

## Allowed operations and guard limits

`electron/owned-rpc.ts` exposes only:

- `get_state`, `get_messages`, and `get_available_models`;
- plain-text `prompt` (always declaring `followUp` to handle idle-to-running races);
- `abort`; and
- idle-only `set_model`.

Leading slash commands are rejected. No navigation, resume, fork, clone, import,
raw command API, extension UI approval, or schedule/heartbeat mutation is exposed.
`--no-extensions` disables discovery, and no explicit `--extension` is passed.
Unexpected extension UI closes the connection.

Scheduling is important: RPC `add_schedule` and `set_heartbeat` call adapter
methods that **promote a client-owned worker to resident**. See
`daemon-agent-connection.ts:1072`, `:1102`, and `withOwnedSessionPromotion`.
Exposing these would invalidate this ownership argument.

State checks before writes and around transcript reads detect identity drift and
close the connection. They are defense in depth, **not atomic dispatch-time
identity guards**. RPC commands have no supported expected persistent-session ID
field. `id` is request correlation only. Unknown extra JSON fields cannot supply
an identity guard.

The RPC wrapper currently forwards session events, extension errors/UI requests,
and terminal closure. It drops connection-level `session_replaced` and
`session_resynced` notifications (`src/modes/rpc/rpc-mode.ts:130` onward).
Do not invent a replacement notification. The desktop checks identity on reads;
the upstream ownership and the desktop command allowlist prevent normal CLI
replacement races in the first place.

## Protocol and lifecycle

- Frames are JSON objects delimited by LF, not Unicode line separators. Responses
  have `type: "response"`, matching request `id`, `command`, and `success`.
- A successful `prompt` response acknowledges admission or queueing, not model
  completion. Later errors arrive through normal events/messages. No automatic
  retry follows uncertain admission or process loss.
- `get_state` returns persistent identity, current model, stream/compaction state,
  and queue state. `get_messages` returns `{ messages: [...] }` without identity.
- `get_available_models` returns `{ models: [...] }`. RPC does not expose the
  richer daemon-only `get_model_catalog`. `set_model` uses exact `provider` and
  `modelId` fields and returns the selected model. Selection also updates the
  native CLI's saved default via `AgentSession.setModel` →
  `settingsManager.setDefaultModelAndProvider`. The UI must disclose this shared
  setting change. It does not change another active session's selected model.
- `abort` is an operation cancellation, not worker deletion. EOF first drains
  pending input and waits for idle (`rpc-mode.ts:529`). EOF alone is not an
  immediate stop during a long generation.
- `shutdown()` in RPC (`:185`) disposes the connection. Adapter disposal
  (`daemon-agent-connection.ts:1842`) sends `complete_owned_session`, which stops
  and removes the owned worker without archiving the transcript. RPC `SIGTERM`
  invokes disposal; `SIGKILL` cannot do so.
- Unexpected client disconnect triggers a 30-second owner cleanup grace
  (`daemon-supervisor.ts:249`, `:1960`). A stable-identity reconnect can cancel it.
  Killing the subprocess does not prove immediate worker termination.
- The desktop closes only its own pipe/process. It never issues daemon shutdown.
  Saved closed sessions are not automatically resumed by this wrapper. Lease
  conflicts must surface as errors, never trigger a takeover.

## Authentication UI

RPC has no login/logout/auth-management commands. Built-in TUI commands, including
`/login`, are not equivalent to RPC prompts. Use the native interactive CLI for
OAuth and key setup. Existing auth storage or inherited provider API-key variables
continue to work. The CLI can fail before serving RPC if no startup model is
available (`src/main.ts:1624`). The desktop must report that startup failure and
must not claim to offer provider login through extension UI.

## Launch environment

The desktop mirrors upstream launch sanitation: all `PRIME_AGENT_INTERNAL_*` variables
are removed, along with startup benchmarking and Node/Bun/Electron injection variables.
This prevents inheriting a parent agent worker role that bypasses client ownership.
Native provider/profile configuration remains inherited; values are never logged.
