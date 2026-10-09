# Execution evidence and registered task accounting

This add-on separates dispatch lifecycle from observed work. A raw `running`
receipt reserves capacity, but never by itself proves that an executor is active.

## Storage upgrade

Apply `migrations/0002_execution_evidence.sql` after the unchanged 0000 and 0001
migrations. It adds nullable JSON text `dispatch_jobs.execution_evidence` and
`dispatch_jobs.task_number`, backfills numbers in historical `(created_at,id)`
order per `(owner_id,project_id)`, including canceled rows, and adds a unique
project/task-number index. No historical activity evidence is invented.

New task numbers are allocated inside the existing atomic enqueue insert as
`MAX(task_number)+1` for that owner and project. Priority changes, cancellation,
completion, reload, and a same-request retry cannot renumber them. Each real new
queued request is a new registration; a resumed existing job keeps its number.

For the separately maintained Sites Drizzle schema, add these fields to
`dispatchJobs` and append this index to its callback:

```ts
executionEvidence: text('execution_evidence'),
taskNumber: integer('task_number'),
// In the index array:
uniqueIndex('dispatch_project_task_number').on(t.ownerId,t.projectId,t.taskNumber)
```

Do not modify previously applied migrations. Sites generated migrations remain
schema-only. An existing nonempty deployment needs a separately approved bounded
backfill before normal writes resume; adding nullable columns alone leaves old
task numbers absent. A verified empty installation needs no backfill. This
ordinary package does not contain Site deployment identities or generated schema.

## Recording actual activity

`update_dispatch_execution` supports `action: "observe"` while lifecycle is
`running`. Pass the current expected job version and the original dispatch key,
environment, thread ID and turn ID, plus a normal summary and:

```json
{
  "executionEvidence": {
    "kind": "tool_result",
    "observedAt": "2026-10-07T18:00:00.000Z",
    "source": "Synthetic execution adapter",
    "step": "Synthetic test command produced output",
    "reference": "synthetic-tool-result-id"
  }
}
```

Supported kinds and expiry from source `observedAt`:

- `tool_result`: 300,000 ms; an actual tool result, with its concrete step and reference
- `progress_output`: 300,000 ms; actual substantive progress output and its reference
- `active_process`: 60,000 ms; an observed active process, plus required `active: true`

The source adapter is responsible for attaching evidence to the correct actual
turn. Starting, assigning, `inProgress`, waiting for a response, page refreshes,
poll timers, and repeated reads are not any of these evidence kinds. The adapter
must not synthesize current observation timestamps for old output. This module
validates and persists reported evidence; it does not independently inspect a
process or fetch the referenced tool output.

`observedAt` must be an ISO UTC timestamp no later than receipt time. New evidence
must be strictly later than the last persisted evidence for that turn. Identical
event retries replay the stored operation and cannot refresh evidence. A new
turn binding clears the previous turn's evidence. A `running` transition may
carry evidence in its original receipt; `dispatchOne` forwards it only if the
host actually supplied `receipt.executionEvidence`.

Evidence expiry never releases capacity or permits preemption. Existing safe
checkpoint, version, thread-writer, completion-evidence, priority and atomic
reorder rules remain in force.

## Public field contract

`GET /api/dispatch/queue` returns these fields on each displayed job:

- `state` and `effectiveState`: raw lifecycle except `running` becomes `unknown` without fresh concrete activity
- `lifecycleState`: the original stored state, for explanatory UI only
- `taskNumber`: durable project-local registration number, independent of `queueRank`
- `registeredAt`: persisted job creation time
- `observedAt`: persisted queue-change time; not execution observation time
- `lastLifecycleObservedAt`: legacy lifecycle receipt time, retained separately
- `lastExecutionObservedAt`: original concrete source observation time, or null
- `lastEffectiveAction`: sanitized last concrete step text, including historical evidence
- `currentStep`: sanitized step only while effective running; otherwise null
- `evidenceType`, `evidenceSource`, `evidenceReference`, `evidenceFresh`, `evidenceExpiresAt`, `evidenceTtlMs`

Only a safe HTTPS reference is serialized in the public view. Opaque proof IDs
remain in owner-scoped executor storage. Text uses the existing path/credential
redaction. No raw tool payload, thread ID, turn ID, dispatch key or environment
identifier is added to the public view. The authenticated execution MCP retains
its existing raw job contract, including the typed evidence for the coordinator.

`counts.running` means fresh evidenced running across the whole queue.
`counts.reportedRunning` is the raw lifecycle count;
`counts.unknownRunning` is its unverified subset. Held slots remain independent.

Both queue API and `/api/board` expose `projectTotals[]`:

- `projectId`, `projectName`
- `registered`: all registered queue jobs, including completed and canceled jobs
- `completed`, `removed` (canceled jobs), `activeRegistered` (`registered-removed`)
- `lastTaskNumber`: highest allocated number
- `current[]`: all freshly evidenced parallel running tasks, each with `taskNumber`, `jobId`, `currentStep`, `evidenceType`, `lastExecutionObservedAt`, `evidenceExpiresAt`
- `unverifiedRunning[]`: task numbers with a raw running lifecycle but no fresh proof
- `scopeChanges[]`: stored enqueue/cancel operations as `{type: "registered"|"removed", taskNumber, recordedAt}`
- `coverage`: `scope: "managed_queue"`, `totalsComplete: true`, `includesCanceled: true`, `scopeChangesTotal`, `scopeChangesShown`, `scopeChangesOmitted`, `dependencyCoverage: "not_recorded"`

Scope changes show the latest 500 owner-scoped registration/removal operations,
with explicit per-project omissions. Totals and current lists cover all stored
jobs independently of the 500-row queue and 200-task board display limits.
Unmanaged snapshot tasks and unknown project dependencies are not counted or
invented. Display “registered total,” not an inferred total project plan. A new
registration increases the total with its corresponding real registration event;
removal preserves its number and appears as a separate removal event.

Board dispatch tasks expose `taskNumber`. `queueUpdates.records[]` includes the
same activity fields plus raw `phase`; `queueUpdates.projectTotals` mirrors the
top-level totals. Original snapshot timestamps and original cards are preserved.

## Required UI integration

This candidate leaves frontend files unchanged for the owner's UI integration.
Do not use raw `phase`, raw `lifecycleState`, `started`, the old two-hour generic
freshness threshold, or `lastLifecycleObservedAt` to color a worker as running.

Use `effectiveState` and `evidenceExpiresAt`. A cached board must locally become
unknown once evidence expires, even before the next fetch. Re-rendering may only
age evidence; it must never replace `lastExecutionObservedAt` or any source
timestamp with page time. Account for expired entries when showing the cached
`projectTotals.current` count and current task-number list. The queue currently
polls every 30 seconds; the main board currently requires an explicit reread, so
client-side expiry is necessary there.

This add-on neither installs an execution host nor proves six agents are active.
The real host must submit actual observations during the separate acceptance run.

## Native host receipt boundary

A canonical native child identity such as `/root/synthetic_reviewer` may be bound
verbatim in the owner-only executor record. It is never shown in the public
projection. Computer/coding-environment thread IDs retain the existing format.
When a host does not expose its platform turn ID, the coordinator may use
`attempt:<dispatchKey>` as an application invocation ID. This identifies the
persisted dispatch attempt, not a claimed platform-native turn identifier.
Every follow-up still targets the original exact thread and environment.

Completion accepts either genuine HTTPS result links or a new typed
`executionEvidence` record from an actual terminal tool/result receipt. A live
process observation cannot establish completion. A terminal result must explicitly
set `terminal: true` and `active: false`. The coordinator must verify
that no active writer remains. Opaque receipt references are stored only in the
owner-scoped executor record; public output exposes the sanitized result summary
and its original observation time, without inventing a URL.

## Empty registered projects

A registry entry with `acceptNewRequests: true` is an explicitly configured
project that can receive its first request even without imported tasks. Existing
entries default to observation-only inclusion, so stale unused registry labels
do not reappear automatically. Empty registered projects have zero observed
tasks/agents and no invented observation timestamp.
