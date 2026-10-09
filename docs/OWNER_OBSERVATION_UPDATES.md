# Owner-private source observations

The private Site has two distinct data paths:

1. The initial imported source snapshot describes the selected real projects.
2. Authenticated observations of already mapped original tasks are appended to
   D1 and projected over that snapshot. Recording one observation does not require
   republishing or changing environment variables.

Neither path starts or resumes tasks. Callback events and automatic wakeup remain
closed on this deployment. The open page refreshes persisted board data every
30 seconds; this does not poll external task tools or claim real-time activity.

## Read and record

Published MCP names are `get_task_observation_state` and
`record_task_observation`. Hosts must discover the actual installed connector
method after publication; never invent a callable tool namespace. A tool's
existence in source is not proof it has been refreshed in a particular client.

Equivalent owner-private HTTP routes are:
- GET /api/observations/tasks/{existingTaskId}
- POST /api/observations/events (same-origin Origin is required)

Only the existing Sites-injected identity matching this Site's exact owner is
accepted. A service access token does not substitute for a signed-in owner.
The mapping is supplied through private runtime binding
DOT_BOARD_OBSERVATION_BINDINGS, never source code or static assets. An original
thread with unknown environment has environment:null; this remains unknown and
cannot authorize execution. Unmapped or non-readable tasks cannot be updated.

Call the read method to obtain expectedVersion, then send a bounded observation:
- taskId, stable eventId and expectedVersion
- source: exact mapped threadId/environment, actual turnId/itemId and observedAt
- changes: source-backed observation text and optional task state, stage, blocker,
  nextAction and HTTPS evidence links
- acceptance: explicit verified scope, no pending checks and no active writer,
  required together with result evidence before requesting completed

The authenticated caller must actually read the cited original-task receipt.
The Site validates mapping, shape, time, monotonicity, version, controls and
idempotency; it does not independently call cloud_threads or cryptographically
attest the supplied external receipt. Save the tool receipt privately for audit.
The observation timestamp is when that source was genuinely observed; it is not
an invented process-start, completion or source-message timestamp. Never use a
fresh polling time to turn old activity into running evidence.

An in-progress or completed turn alone cannot establish business completion.
Partial delivery remains partial. Current pause/cancel controls dominate the
projected status. A dispatch-only deferred gate does not falsely pause existing
work. Other tasks, Agent observations and the original import timestamp retain
their own times. Public projection omits raw thread, turn, item and environment
identifiers; the state read is intentionally owner-private.

## Persistence and safety

The append-only journal uses owner+event identity and task version CAS. Identical
replays return the saved receipt without another append; conflicting event reuse,
old expected versions and late observations are rejected. Earlier inherited
fields retain their source times. Newer base imports supersede older fields.
No receipt creates intake rows, queue jobs, bindings or new execution rights.

Production acceptance must include an actual owner-authenticated record, readback,
unchanged unrelated records and an identical replay with an unchanged version.
Synthetic tests alone are not production acceptance. If the client has not yet
exposed the new tool, report that discovery blocker instead of using a fabricated
method or impersonating the user with headers.

## Separate owner scope controls

`get_task_execution_control` and `set_task_execution_control` read/apply an
explicit user decision to one existing task using a control version. The write
only accepts paused, deferred or canceled; it cannot activate or resume work.
These records live in the existing dispatch_controls table, not the observation
journal. They block enqueue, claim and final preflight for the controlled task,
including original context-task bindings, without pausing a sibling or project.
They do not terminate an already running process or delete historical results.
Paused/canceled controls also dominate the board projection after observations;
the control application time is not presented as a new execution observation.
