# Queue editing: upstream requirements

Status: blocked for Prime Agent 0.9.6 at
`e260085dd8f742e0def3d871860c9a888b114851`. Desktop queue counts and pending
request state are implemented. Individual queued-message edit, cancel and reorder
are not available through the verified client-owned RPC connection.

## Source findings

`packages/coding-agent/src/modes/rpc/rpc-types.ts` and `rpc-mode.ts` expose
prompt/follow-up admission and queue mode settings, but no queue snapshot or
individual mutation operation. `get_state` provides an aggregate queued count.

The daemon protocol separately offers `get_queue` and `mutate_queued_message`.
The latter selects a lane and index with `expectedText`. These commands route
through mutable `activeSessionId`, and do not provide stable message IDs or a
queue revision. Matching text alone cannot distinguish identical queued prompts,
attachment differences, or a remove-and-reinsert race. These daemon operations
must not be added to the desktop's owned pipe or shared-session adapter.

The no-provider native probe checks that an unrelated daemon peer cannot read or
clear the client-owned queue by either active or persistent selector, and that
the unsupported RPC `get_queue` command produces no response within the probe
timeout; source inspection confirms it is absent from the RPC command dispatcher. It uses private disposable sessions and
sends no prompts. This establishes the current boundary, not future compatibility.

## Contract needed before implementing the UI

- Queue snapshots and mutations through the same client-owned RPC connection.
- Stable IDs for individual entries, including image attachments and lane.
- A monotonic queue revision; edit/cancel/reorder must atomically compare the
  expected revision and message ID at dispatch. A consumed message returns a
  conflict without affecting its successor.
- A snapshot identifies the persistent session; mutations cannot navigate the
  connection or take over another owner's session.
- Explicit admission and conflict replies. Lost acknowledgements are uncertain
  outcomes and must never be automatically retried.

Once upstream supplies this contract, add per-session queue snapshots, drafts for
editing queued messages, explicit cancel/reorder controls, conflict refresh and
visible uncertain outcomes. Native coverage must include identical text with
different images, consumption between snapshot and mutation, competing edits,
wrong identity, disconnection after admission, and independent session queues.

Closing a desktop session already stops its process and queued work after explicit
confirmation. It is not individual-message cancellation. Composer drafts can be
edited before sending; an admitted follow-up is not a local editable draft.
