# Native cloud_threads capability adapter

Status: implementation and synthetic regression only. Not installed in a native
platform host, not deployed, and not a real automatic execution acceptance result.
No new real task or follow-up was invoked during development.

## Actual platform contract checked

On 2026-10-08 the authorized session exposes these tools:

- cloud_threads.list_environments({cursor?}) → structuredContent.environments
  with environmentId, status, is_authorized_for_tasks, and codingEnvironments.
- cloud_threads.read({threadId, limit?, cursor?}) → structuredContent.threadId,
  latestTurn:{id,status,error}, items:[{id,turnId,role,text}], nextCursor.
- cloud_threads.list_threads({limit?,cursor?,children_only?,archived?}).
- cloud_threads.create({title,prompt,environmentId? | environmentConfigId?})
  admits a new thread and returns threadId/turnId. It does not prove execution.
- cloud_threads.send_message({threadId,prompt}) admits/steers the original thread.

The read schema was verified against an authorized inProgress thread and a
completed turn whose product was still uninstalled and runtime checks pending.
Consequently turn.completed is not business completion. Private task identifiers
and result text are intentionally not copied into this portable document.

read does not return environment identity or source timestamp. Environment comes
only from a previously verified, immutable owner/task/thread mapping. observedAt
is the time the host retrieved and accepted that read, not an invented event time.
Evidence reference contains the actual thread, turn and result item IDs.

## Loading and boundaries

Import createCloudThreadsAdapter from src/adapters/cloud-threads-adapter.mjs in
an authorized native execution host. It takes bound capability functions:

    provider = {
      read: { read, list_threads, list_environments },
      write: { create, send_message }
    }

bindNativeCloudThreadTools(nativeTools) selects exactly the current catalog names
(mcp__codex_apps__cloud_threads_*) from a platform-supplied tool capability object.
Missing tools remain missing and fail closed; unrelated tools are not exposed.

Each property must call the correspondingly named real cloud_threads tool in the
current authenticated owner's authorized session and return the unchanged tool
result envelope. There is deliberately no arbitrary tool name, URL, eval, shell,
credential, token, OAuth or default write implementation.

IMPORTANT: the current session's tool functions are not globals available in Node,
a Cloudflare Worker, or a repository process. This repository cannot manufacture
a supported HTTP endpoint or install itself into that tool runtime. A platform
embedding that supplies those bound capabilities is still needed to run this
module directly. Until then, an authorized dot session may implement the same
protocol through its native tool calls after an event wakes it. Worker callback
receipt by itself never means that a task started or completed.

native_cloud is explicitly unavailable in this adapter: cloud_threads.create
selects a computer or a saved coding environment, not a native subagent. Native
subagents require a separate authorized capability adapter, never substitution of
an attached desktop. Unknown/offline/unauthorized original environments wait.

## Required trusted dependencies

- ownerId: authenticated session owner, never the submitted body owner.
- loadAuthorization({ownerId,requestId}): trusted policy record containing exact
  ownerId/requestId/environment, executionAllowed, readAllowed, paused/canceled, threadId,
  allowCreate/allowFollowup, title and approvedPrompt. The approved prompt is
  explicit authorized scope, never arbitrary shell synthesized from external text.
- preflight({ownerId,requestId,operationId,threadId,environment,phase}): use
  createNativeHostPreflight({service,loadCurrentJob,authorizeRead}) for the local
  guards service. It adapts the returned job to allowed:true. This is a fresh
  policy/resource guard that returns {allowed:true} only after checking the
  current service.preflight(ownerId,currentJob). Verify the current job's
  requestId/dispatchKey/thread/environment first. For phase observe, use read
  authorization rather than requiring a new write grant. Fail closed otherwise.
- journal: createD1NativeDispatchJournal(DB), after applying
  migrations/0004_native_dispatch_journal.sql through the authorized deployment
  flow. This durable adapter was tested with real SQLite semantics locally.
  It does not provision a production database. Never replace it with an in-memory
  map in production; never delete uncertain intent records to force a retry.
- decodeObservation: createCloudThreadDecoder({lookupBinding,acceptResult}).
  lookupBinding is the verified registry. acceptResult is a trusted acceptance
  decision based on the actual result and task criteria, returning verified,
  outcome, completedScope, pendingChecks and noActiveWriter:true. The last field
  must reflect a verified absence of active writers, including background processes;
  turn.completed by itself does not establish it. It is not a regex matching “done”.
  Zero pending checks and explicit verified completion are required for success.

The existing guarded dispatchOne calls adapter.create/followup only after saving
begin. Pass the adapter to dispatchOne. It saves the returned admission binding
but does not fabricate running evidence. On readback call reconcileNativeDispatch
with the current versioned job. Only released:true, produced after durable
terminal evidence writeback, permits dispatching the next item. To support failed
results, use supportsTerminalFailureEvidence:true only with the guards revision
whose fail transition persists and validates terminal executionEvidence.

Host policy must refresh the verified registry after creation admission, preserving
original environment. Source readbacks never supply a replacement environment.
Paused/canceled requests cannot create or continue. Explicit readAllowed:true
permits observing their original thread for safe terminal reconciliation. Final preflight must be tied
to the claim's held resources and current version, not a cached authorization.

## Uncertain results and recovery

The native tools have no operationId/idempotency parameter or authoritative
operation lookup. The durable journal therefore guarantees at most one write
attempt per operation. A create/send timeout causes a readback, never retry.
Create uncertainty performs a list read, but a missing thread in a page does not
prove absence. Follow-up uncertainty reads the original thread. Automatic
reconciliation remains blocked until the host verifies exact operation-to-turn
mapping; latestTurn alone may belong to another turn. No new thread may be created
as a fallback. Reservations/resources remain held through uncertainty, lag or
process restart. Journal recovery is not permission to repeat the action.

## Verification

node --test tests/cloud-threads-adapter.test.mjs

All write-provider tests are SYNTHETIC. They verify argument contracts, authority
checks, concurrent durable reservations, pause/owner/environment guards, offline
waiting, original-thread continuation, timeouts, and acceptance-only terminal
release. They do not prove production tools, event subscriptions, database or
native host integration have been deployed or authorized.

## Existing-thread opaque bindings (continuation only)

The additional target `{type:'existing_thread', id:null}` is a dispatch binding
mode, not a literal environment identity. Actual observation environment fields
may remain null. A verified owner/task/thread registry entry must already exist;
enqueue cannot use this target for a new task, and adapter.create always rejects
it. It never becomes native_cloud, an invented computer ID or an attached desktop.
No observation schema, production registry contents or database migration changes
are necessary for this dispatch-only mode.

The authorized host policy supplies existingThreadVerified:true and
`environmentConstraintsSatisfied:true`. The latter means the host checked all
explicit user/environment restrictions against existing provenance; it must NOT be
set just because a thread ID exists. For example an unresolved “cloud only”
restriction still blocks a thread whose executor type cannot be established.
This is a policy validation result, not an additional request for user approval.

For an existing_thread target, dispatchOne uses preflightContinuation rather than
requiring a literal-ID list_environments lookup. It checks normal owner/task,
pause/cancel and resource guards, then reads the original thread. A known offline
executor waits without a write. Unknown connectivity remains unknown, but does
not by itself prohibit asking the platform's send_message to continue its stored
existing executor. There is no fallback create or environment selection. The
adapter's environmentStatus returns available:null, connectionStatus:'unknown'
for this mode; a continuation admission does not claim observed connectivity.

createCloudThreadDecoder accepts a separate trusted inspectExecution callback.
It may return `{verified:true,noActiveWriter:true}` only from checked execution
sources. This allows safe continuation even when business acceptance is pending.
The completed turn flag alone is insufficient proof that background writers are
absent. acceptResult continues to decide business completion independently; a
pending check keeps the current business task incomplete and retains its slot.

Read-before-send is not an atomic idle-only operation. cloud_threads.read may lag,
and send_message may steer a turn that starts concurrently. The host takes a
second read immediately before the opaque write, rechecks mutable authorization,
and refuses if the turn changed or became active. There is no platform CAS flag
in the verified schema; code does not invent one. Known same-turn receipts,
explicit steered/unknown responses, missing turn receipts and timeouts all retain
the durable reservation, read the original thread and require reconciliation.
An admitted new turn ID is still only assigned, not running or complete. Native
API responses may not expose whether steering occurred; this cannot be eliminated
without a platform idle-only/CAS capability. The board's lease coordinates its own
writers, not arbitrary concurrent writers outside its authority.

Opaque coverage uses synthetic providers with a real local SQLite journal and
queue. It includes null environment identity, no-create enforcement, cross-owner
binding rejection, unknown/offline connection, pending business acceptance,
active/racing turns, pauses, resource conflicts, ambiguous/steered receipts and
restart-safe no-repeat behavior. No real thread was created or continued.

### Recover an opaque preflight hold

An active or unreadable original writer keeps the reservation in uncertain state.
It is not released by timeout or by absence of a new send. Recovery is explicit:
read the same original thread through the authorized adapter, verify a terminal
turn and positive no-active-writer evidence, then use the existing versioned
checkpoint operation with `reconciliation:'confirmed_no_active_writer'`, the exact
original dispatch/thread/environment binding, and `nextState:'blocked'`. This
safely releases resource leases without sending, queuing or claiming business
completion. Read failure, active execution or missing writer proof keeps the hold.
The blocked task must be reconsidered under current user scope before any resume;
paused/canceled controls remain effective. A regression test exercises both the
refusal and this verified release path with a synthetic provider and real SQLite.
