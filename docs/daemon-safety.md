# Shared-daemon safety limitation

This document applies to existing/shared CLI sessions. New desktop-owned sessions
use a separate verified RPC owner boundary in [owned-rpc-design.md](owned-rpc-design.md).

Prime Agent 0.9.5 protocol 7 reuses active session IDs after CLI switches. The
supervisor resolves selectors before forwarding; there is no atomic expected
persistent-session ID check. A client-side preflight cannot close this race.

Session Dock therefore disables ALL shared-session mutations on the catalog integration.
It reads saved files only after checking the persisted header ID against the requested
persistent ID. Live partial tokens are unavailable; persisted messages still refresh.
No unsafe environment override is provided. Existing CLI sessions are unchanged.

To restore writes, upstream must expose a documented capability with an immutable
session identity precondition enforced at execution for prompt, abort, rename,
create/resume and delete. Delete's supervisor-side tombstone/worker-stop must also
respect the guard; worker rejection alone is insufficient. Then implement a new
adapter and race tests before enabling controls. Never assume that an unknown
capability string or an ignored JSON field supplies this guarantee.

## Live updates for shared sessions

Shared sessions are refreshed by re-reading the saved transcript: every 600 ms while
the agent reports work, backing off to 3 s while nothing changes, and every 10 s when
idle (`pollDelay` in `src/stream.ts`). The public daemon's live path is `attach`, which
delivers snapshots and sequenced events (upstream `docs/daemon.md`, "Reconnect, Replay,
and Snapshots"). It is not used here: `attach` selects a worker by its reusable runtime
session ID, so it has the same identity race as the mutations above, and attaching adds
a client attachment to a CLI-owned worker. Revisit when upstream offers an observation
command bound to the persistent session ID.
