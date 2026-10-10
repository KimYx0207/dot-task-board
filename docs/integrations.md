# Optional integrations

[English](integrations.md) · [简体中文](integrations.zh-CN.md)

The snapshot board works on its own. Intake, queueing and event delivery are separate layers. None of them grants permission to execute the text a user submits.

## Current Site scope

For a new private online board, follow [Sites deployment](sites-deployment.md). The deployed interface, manual status and configured request/observation services are the current product path. Queue execution, Events, relay transport and external-host setup below are optional engineering integrations, not required installation steps.

Source code and synthetic tests exist for these interfaces, but cloning the repository does not connect a native execution host or start automatic work. Direct Events delivery and the scheduled drain are disabled by the current Sites entry. Its separate relay bridge requires independent private configuration and verification; leave it out of a standard installation.

## Scheduled dot continuation

The maintainer's online deployment completed a bounded two-cycle acceptance on 2026-10-09: a natural scheduled wake continued the same native online task, performed a real presentation fix, ran tests, published it and read the result back; the next natural wake only checked the finished result and did not repeat the write. This verifies that host-native continuation path. It does not verify local-computer dispatch, the cloud_threads request/job chain, all projects, or an external callback transport.

A Sites server does not need to invoke cloud_threads directly for this workflow. The scheduled check runs in the user's authorized dot session, which must have access to the original task and the required native tools. A hosted page refresh or a copied configuration flag cannot supply those capabilities. The repository does not create or resume schedules on installation.

### Configure with your own dot

1. Deploy your own private board and verify the existing authenticated read/write interfaces. Identify one real unfinished online task and its original executor using your own account. Never copy the maintainer's private mappings or substitute another project.
2. Explicitly authorize the selected work and the check's schedule. Reuse a suitable existing check; leave canceled projects and paused schedules unchanged unless you specifically resume them. If scheduling or original-task access is missing, report that exact missing capability rather than inventing an endpoint or binding.
3. The check reads current state before acting. If an original executor is still working, follow it without sending duplicate work. If a bounded step is finished but another authorized step remains and no writer is active, continue the same original task once through the supported native capability. Preserve user pause/cancel/completion decisions. An UNKNOWN result is reconciled read-only, never automatically resent or released.
4. Read actual tool/output evidence, record the finished scope and remaining checks, and read back any permitted status write. A missing board observation binding is not permission to create one or pretend a callback was saved. The original task's own receipt may document the bounded step while the project's board state remains incomplete.

A suggested instruction for your own dot:

> For the online task I have explicitly selected, use my authorized scheduled check to read the original task, continue an unfinished allowed step only when no executor is active, and verify the actual result. Preserve stopped tasks, use the same original executor, and do not retry unknown sends. Record what completed and what remains. Do not treat one substep as the whole project's completion or turn this into permission to resume my other projects.

### Accept the actual path

- Keep the natural schedule-trigger receipt; a manual Run now is a manual trigger and must be labeled accordingly.
- Correlate the same original task with actual execution, the durable result and the readback. Admission alone is insufficient.
- At the next natural check, verify that the completed step is not dispatched or written again.
- Claim only the path exercised. Native collaboration continuation and cloud_threads request-dispatch are different paths. Complete the latter's existing request/version/claim/preflight/binding/terminal protocol separately before claiming it works.

No new credentials, permission expansion or changes to execution guards are included in this update. Checkpoint, cancellation, TTL and uncertain-result rules remain unchanged.

## Authenticated request intake

The server stores a request only after checking the project, owner, payload limits and referenced context. The saved receipt is the source of truth; text in a browser draft is not a server save. Browser drafts are scoped to the current tab's session storage.

The lifecycle deliberately separates these facts:

1. `received`: storage confirmed the request was saved
2. `read`: a reader explicitly acknowledged reading that request
3. `accepted`, `needs_confirmation` or `declined`: actual triage was recorded
4. `assigned`, `in_progress` or `blocked`: recorded work has task IDs and a truthful summary
5. `completed`: evidence links accompany the completion record

A request can be canceled only through allowed transitions. Reading a request, accepting it and writing an event never execute its contents. Required user approvals remain the responsibility of the connected host.

Configure a project registry, durable storage and an authenticated MCP bridge before enabling submission. Configuration flags report operator setup; they are not proof that a real client successfully connected. Set verified flags only after checking the corresponding read/write path. The optional poll interval is a display statement; this package does not create a polling service.

## Finite queue: experimental

`DOT_BOARD_QUEUE_ENABLED=true` enables the queue only when its storage is available. It is off in the normal runtime by default; the synthetic demo enables queue tools to exercise state transitions without executing work. `DOT_BOARD_QUEUE_CAPACITY` defaults to 1 and accepts integers from 1 to 32. This is a per-owner reservation policy, not a promise about the host platform's concurrency limits.

| MCP tool | Purpose |
| --- | --- |
| `list_dispatch_jobs` | Read owner-scoped jobs and configured capacity |
| `enqueue_request_dispatch` | Queue an exact accepted request version for a verified environment |
| `claim_next_dispatch` | Atomically reserve a slot and persist an idempotent dispatch intent |
| `change_dispatch_priority` | Reorder work that is queued or safely blocked |
| `update_dispatch_execution` | Record a versioned, verified execution transition |

An accepted request is eligible for queueing; browser submission does not enqueue it automatically. Retries use event IDs and expected versions. Replaying a claim receipt must never trigger another external create operation.

The lifecycle is `queued` → `claimed` → `dispatching` → `assigned` → `running`, with explicit blocked, uncertain and terminal outcomes. Creating a queue row is not execution. A verified thread receipt is required for assignment, and a verified running turn is required for a running state.

Follow-ups to queue-backed tasks retain their original thread and environment. A task without a verified original binding is rejected for continuation; the queue must not silently create a replacement thread. Environment types include `native_cloud`, `coding_environment` and `computer`; the latter two require an ID supplied by the host. The special `existing_thread` target has `id: null` and only permits continuation of an already verified original thread. It is not a known physical environment and cannot create a new thread; see [the existing-thread contract](NATIVE_HOST_ADAPTER.md#existing-thread-opaque-bindings-continuation-only).

Priority changes do not kill or preempt active work. Releasing a slot requires an acknowledged safe checkpoint with no active writer. An offline environment, timeout or missing response is insufficient. An uncertain creation outcome must be reconciled by binding the existing thread or verifying that none was created. Completion also requires result evidence.

## Execution host contract: experimental

`src/application/dispatch-host.mjs` defines `dispatchOne` around an injected adapter:

- `environmentStatus(environment)` checks the chosen environment
- `create(...)` creates authorized work with the persisted operation ID
- `followup(...)` continues the original verified thread

The adapter must return a verifiable thread/environment receipt and, if execution actually started, a turn ID. The durable begin record is written before the external side effect. Ambiguous effects retain their reservation and require reconciliation rather than an automatic create retry.

The repository includes a `cloud_threads` capability adapter, but no connected native tool client, account credentials or deployed execution scheduler. A real authorized host must supply and verify that connection. Queue and adapter source alone do not make browser requests run automatically; see [the native host contract](NATIVE_HOST_ADAPTER.md).

## Events and webhooks: experimental

This section describes the generic Worker and separate candidate-host experiment, not the standard private Site. The Sites adapter forces direct Events off and disables its scheduled drain; its optional relay bridge is a different, separately configured path.

`DOT_BOARD_EVENTS_ENABLED=true` enables experimental Events methods when their storage exists. It is off by default. The implementation advertises experimental protocol value `2026-07-28`; compatibility with any particular client is not established by that identifier.

The event `project_request.created` contains request/project identifiers and a version, not the request body. It is a notification to read the request through an authenticated tool, not an execution command.

The implementation includes `events/list`, `events/subscribe` and `events/unsubscribe`, subscription verification, HMAC webhook signatures, a durable outbox and bounded retries. A subscription lasts at most 24 hours; event replay by cursor is not supported. An authorized host must supply `authorizeEvent` and one of the two implemented transport contracts: `explicit-pinned-https-v1` with DNS resolution and address-pinned sending, or `platform-managed-public-https-v1` under a separately verified platform egress boundary. A bare `fetch` function is not a transport contract. The [candidate implementation](candidate-worker.md) includes platform-managed transport source but denies ingress/authorization until a real trusted integration is supplied; it is not production-ready by cloning.

Both contracts validate callback URLs and reject redirects. The explicit-pinned path rechecks DNS results and currently accepts only public IPv4 addresses; private/reserved addresses and IPv6 fail closed. The platform-managed path relies on the actual verified platform public-egress boundary rather than manufacturing DNS results or accepting caller-selected origin overrides. The receiver must verify signatures, reject stale messages and deduplicate deliveries. Delivery can be retried; treat it as at-least-once, not exactly-once.

The Worker provides an outbox drain in its `scheduled` handler, but a platform schedule must be configured separately. This repository does not claim verified Cloudflare callback delivery, plugin connection, native automatic scheduling or real-phone end-to-end acceptance. Local fixtures and mock transports establish only the behaviors they test.

## Durable dispatch guards (experimental)

Apply the complete migration chain for the selected host before enabling queue features: [Sites uses Drizzle](sites-deployment.md#3-apply-the-complete-database-schema); [generic/local hosts use the plain-SQL chain](deployment.md#optional-d1-storage). Do not mix them or apply only the old guards migration. Missing required tables disable readiness. Registry `executionState` supports `active` (compatibility default), `paused`, `deferred` and `canceled`. Non-active states block execution by default. A verified, request-scoped manual authorization can admit a specific existing-task request in a `deferred` project; it does not activate the project, override `paused`/`canceled`, or replace the host's execution approval. The current bounded manual-check flow is read-only. Runtime user decisions must also be persisted with `service.control(owner, {scope, targetId, state, expectedVersion, reason})`, where scope is `project` or `task`, and version `0` means create. An explicit, versioned active decision is needed to release a hold. Ordinary priority changes never release a hold. Controls do not kill an existing writer.

Declare exclusive resources on enqueue as `resources: [{kind, id}]`; supported kinds are `browser`, `foreground`, `gpu`, `repository` and `service`. IDs must be canonical host-verified resource identities shared by conflicting projects, not project-local aliases. A job without resource declarations is not globally serialized. Claims atomically reserve capacity and all resource leases. Resources are exclusive across owners in the same store. Multi-store hosts must share one lease authority; isolated databases do not provide global exclusion. Expiry is advisory and blocks host preflight; it never grants another writer ownership. Only the original job's verified safe checkpoint/terminal transition releases its leases. This does not acquire OS locks or stop services.

Trusted hosts can persist known task mappings with `service.registerBinding(owner, {taskId, projectId, threadId, environment, verified: true, evidence})`. Existing mappings cannot be reassigned. Reconnect uses the original environment and thread; repeated enqueue receipts preserve the original task number. `service.preflight(owner, job)` and MCP `preflight_dispatch_execution` recheck current policy, intent version and lease ownership immediately before invocation. The host must treat any failed check as no permission to execute. There is no distributed atomic transaction between the final policy read and an external native call; an already-started writer requires a cooperative safe checkpoint, never a forced kill.

These APIs are plumbing for an explicitly authorized host. The repository does not infer private project pauses from natural-language history, register all projects, or install live policies. Set every paused work category in private runtime configuration before enabling execution. Local fixtures provide synthetic verification only.

## Existing task requirements

Owner-private Sites can persist `goal` and `acceptanceCriteria` for an existing task through `GET/POST /api/tasks/:taskId/requirements`, or `get_task_requirements` and `record_task_requirements`. Apply the complete schema chain first. Updates use an independent expected version and idempotent event ID; per-field source references are retained. The calling host must verify those references. Text never grants execution permission, creates a request, changes task identity or releases a queue reservation. The existing task detail exposes the editor only when `/api/config` reports `requirementsEnabled`. The default Node server, generic Worker and candidate do not inject this service and show the original task requirements without an editable form. A saved description is not automatic chat capture or dispatch.

## Native task result notes

`record_task_native_evidence` appends descriptive sources to an existing task's requirements journal. Supply its current `expectedVersion`, an existing immutable text-edit `requirementVersion` (at least 1; evidence-only revisions are not valid anchors), the original native task name, observation time, summary, and typed result references. The recording host must verify the cited results; these notes are not platform-certified execution receipts. Read them using `get_task_requirements` or the original task inspector. The normal authenticated HTTP equivalent is `POST /api/tasks/:taskId/requirements/native-evidence`.

The server stamps the original requirement event and its recorded sources, retains all earlier notes, and uses the existing owner checks, CAS and idempotent event ID. Text edits retain evidence. The journal version advances without changing requirement text, task identity, binding, state, controls or queue. Notes neither create requests nor grant execution permission, and do not prove cloud-thread dispatch or whole-project acceptance. References render as text. The ledger rejects writes beyond 20 entries or 64 KiB instead of dropping history.

No database migration is needed. Deploy the compatible reader before the first evidence write; subsequent rollback builds must retain that reader, because older readers reject the extended JSON envelope.
