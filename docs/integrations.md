# Optional integrations

[English](integrations.md) · [简体中文](integrations.zh-CN.md)

The snapshot board works on its own. Intake, queueing and event delivery are separate layers. None of them grants permission to execute the text a user submits.

## Current Site scope

For a new private online board, follow [Sites deployment](sites-deployment.md). The deployed interface, manual status and configured request/observation services are the current product path. Queue execution, Events, relay transport and external-host setup below are optional engineering integrations, not required installation steps.

Source code and synthetic tests exist for these interfaces, but cloning the repository does not connect a native execution host or start automatic work. Sites now separates owner-authenticated Events discovery from policy-gated direct delivery. Standard installation keeps delivery off; the direct path requires independently verified runtime/routing/exact-origin evidence and a real native subscription. Sites scheduled draining remains disabled. Its separate relay bridge still requires independent private configuration and verification; leave it out of a standard installation. See [Sites direct Events](sites-direct-events.md).

### Read-only project event-scope diagnostics

On owner-private Sites, `list_request_projects` can add `eventScope: {allowed, reason}` to each project already present in its normal visible list. The same predicate decides project scope for Events subscribe/delivery. It returns no owner identity, raw registry, hidden-project list, callback URL or credentials, and accepts no new lookup argument. Hidden, removed, unregistered and unrepresented projects are not added for diagnosis. Generic Workers and service calls without the adapter retain the legacy `{id, name}` records; default `projects()` calls retain that shape even when the adapter is installed.

`allowed: true` with `project_scope_allowed` means only that the current active project's scope permits Events. `project_notification_allowed` means the deferred project has a separate deployment authorization for request notifications; it remains deferred for execution. Neither reason grants execution permission. Delivery switches, authenticated entry, storage, callback policy, subscription verification and actual receipt remain independent requirements. A completed task does not close project event scope. A read creates no request, subscription, outbox item, callback or execution.

Fixed rejection reasons are `project_registry_absent`, `project_registry_invalid`, `empty_hidden_configuration`, `invalid_hidden_configuration`, `project_hidden`, `project_not_found`, `project_requests_closed`, `project_paused`, `project_deferred`, `project_canceled` and `invalid_notification_configuration`. The predicate checks registry, hidden configuration/list membership, project existence, explicit request closure, then execution state and, for deferred projects only, the notification allowlist, in that order. Missing request/execution flags retain the existing allowed defaults. Reasons for hidden/missing projects are internal predicate outcomes, not permission to expose those projects in the list.

This diagnostic deliberately preserves existing behavior: an empty-string hidden-project setting can leave the visible list readable while Events subscribe/delivery deny with `empty_hidden_configuration`; global `canSubscribe` now uses this same predicate and also stays false when no project is eligible. Malformed/non-array/invalid-ID/oversized hidden configuration still fails at the private entry with `invalid_visibility_configuration` (HTTP 503), before any project diagnostic is returned. Events list and owner-scoped unsubscribe keep their earlier authorization order and do not inherit subscribe/delivery scope gates. A diagnostic is not live native-delivery acceptance.

### Deferred-project request notifications

`DOT_BOARD_REQUEST_NOTIFICATION_PROJECT_IDS` is a deployment-only JSON array of exact, case-sensitive registry project IDs, for example `["demo-deferred"]`. Absent, empty-string or `[]` configuration grants no deferred exception. The array is bounded to 200 unique IDs and 32 KiB of UTF-8 input. Each ID must be 1–100 ASCII letters/digits or `_.:-`, start with a letter/digit, and contain no whitespace. Invalid JSON, wrong types, object wrappers/non-string entries, invalid IDs, duplicates and exceeded limits fail closed for all deferred exceptions. Active-project behavior is unchanged even if this optional configuration is invalid. No project ID is built in; request parameters cannot edit or replace this deployment setting.

A listed project must still exist, be visible to the authenticated owner at the configured audience, accept new requests and have `executionState: "deferred"`. Paused/canceled projects always deny. The allowlist affects only `project_request.created` notifications, including the shared project diagnostic/readiness predicate. It does not change registry execution state, dispatch admission, task controls, queue capacity, resource locks, original-thread bindings or callback transport policy.

Authorization is reread before subscription, after its challenge and on every delivery attempt, including cached-verification refreshes. Once the new configuration is in effect, removing an ID denies subsequent admission and revokes/cancels its pending delivery when an authorized drain next examines it. It cannot retract a callback already sent and does not install a drain scheduler; explicitly unsubscribe for immediate stored revocation. The owner can still unsubscribe after removal, hiding or project deletion. Re-adding an ID does not reactivate a revoked subscription. A valid notification allowlist proves neither the receiving native chat's identity nor actual delivery; those still require the original native subscription and separate live receipts.

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

The Events boundary validates and strips standard request `params._meta` before strict business validation. Metadata never grants access or enters subscription identity/storage. Rejection logs and RPC errors expose only allowlisted error categories and a validated normalized callback origin, never callback paths, secrets or raw exceptions. Metadata-free callers remain compatible; this change does not establish live native delivery. See [metadata and safe failures](sites-direct-events.md#standard-request-metadata).

The generic Worker, candidate host and owner-private Sites have different readiness gates. Sites advertises the direct Events directory whenever intake MCP is enabled and the relay is off, including when direct delivery is off. Subscription and delivery require available storage, `DOT_BOARD_EVENTS_ENABLED=true` and the separately verified [Sites deployment policy](sites-direct-events.md). Its optional relay remains a distinct path; both delivery flags together fail closed. Sites scheduled draining stays disabled.

For the generic Worker, `DOT_BOARD_EVENTS_ENABLED=true` enables experimental Events methods when their storage exists; the flag is off by default. Sites directory discovery is independent of that flag, while direct subscriptions and transport require it plus the verified policy. The implementation advertises experimental protocol value `2026-07-28`; compatibility with any particular client is not established by that identifier.

The event `project_request.created` contains request/project identifiers and a version, not the request body. It is a notification to read the request through an authenticated tool, not an execution command.

The implementation includes `events/list`, `events/subscribe` and `events/unsubscribe`, subscription verification, HMAC webhook signatures, a durable outbox and bounded retries. A subscription lasts at most 24 hours; event replay by cursor is not supported. An authorized host must supply `authorizeEvent` and one of the two implemented transport contracts: `explicit-pinned-https-v1` with DNS resolution and address-pinned sending, or `platform-managed-public-https-v1` under a separately verified platform egress boundary. A bare `fetch` function is not a transport contract. The [candidate implementation](candidate-worker.md) includes platform-managed transport source but denies ingress/authorization until a real trusted integration is supplied; it is not production-ready by cloning.

Both contracts validate callback URLs and reject redirects. The explicit-pinned path rechecks DNS results and currently accepts only public IPv4 addresses; private/reserved addresses and IPv6 fail closed. The platform-managed path relies on the actual verified platform public-egress boundary rather than manufacturing DNS results or accepting caller-selected origin overrides. The receiver must verify signatures, reject stale messages and deduplicate deliveries. Delivery can be retried; treat it as at-least-once, not exactly-once.

The generic Worker provides an outbox drain in its `scheduled` handler, but a platform schedule must be configured separately. Sites explicitly disables that handler. Its direct path atomically stores events/outbox entries with ordinary requests or approved candidates and uses `ctx.waitUntil` for at most two immediate delivery attempts, within 25 seconds and 10 seconds per callback. Durable transient retries and expired-lease recovery need a subsequent authorized drain; no scheduler, polling or autonomous retry is installed. A `2xx` proves callback receipt only. Real native subscription, exact-origin ownership, runtime/zone proof, challenge, persistence, event arrival/chat wake and permitted result receipts require separate acceptance. Local fixtures and mocks establish only the behaviors tested; see the [full Sites contract](sites-direct-events.md).

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
