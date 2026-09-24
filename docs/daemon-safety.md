# Identity-safe daemon integration

Prime Agent 0.9.5 protocol 7 reuses active session IDs after CLI switches. The
supervisor resolves selectors before forwarding; there is no atomic expected
persistent-session ID check. A client-side preflight cannot close this race.

Session Dock therefore disables ALL session mutations on the current integration.
It reads saved files only after checking the persisted header ID against the requested
persistent ID. Live partial tokens are unavailable; persisted messages still refresh.
No unsafe environment override is provided. Existing CLI sessions are unchanged.

To restore writes, upstream must expose a documented capability with an immutable
session identity precondition enforced at execution for prompt, abort, rename,
create/resume and delete. Delete's supervisor-side tombstone/worker-stop must also
respect the guard; worker rejection alone is insufficient. Then implement a new
adapter and race tests before enabling controls. Never assume that an unknown
capability string or an ignored JSON field supplies this guarantee.
