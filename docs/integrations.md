# Optional integrations

[English](integrations.md) · [简体中文](integrations.zh-CN.md)

The snapshot board works on its own. Intake, queueing and event delivery are separate layers. None of them grants permission to execute the text a user submits.

## Current Site scope

For a new private online board, follow [Sites deployment](sites-deployment.md). The deployed interface, manual status and configured request/observation services are the current product path. Queue execution, Events, relay transport and external-host setup below are optional engineering integrations, not required installation steps.

Source code and synthetic tests exist for these interfaces, but cloning the repository does not connect a native execution host or start automatic work. Direct Events delivery and the scheduled drain are disabled by the current Sites entry. Its separate relay bridge requires independent private configuration and verification; leave it out of a standard installation.

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
