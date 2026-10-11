# Sites direct MCP Events: production contract

This document describes the staged owner-private Sites implementation. It does not enable a deployment, install a subscription, or certify a live callback or chat wake. Standard installation keeps direct delivery and the separate relay off. No real Site identities, callback URLs, signing secrets, runtime policy values or request contents belong in public source or examples.

## Discovery and delivery are separate

The Sites entry preserves its existing platform-authenticated owner, exact audience, visibility and project-registry boundaries. When `DOT_BOARD_INTAKE_MCP_ENABLED=true` and `DOT_BOARD_EVENT_BRIDGE_ENABLED` is not `true`, the authenticated `/mcp` endpoint advertises the Events directory through `server/discover` and supports `events/list`, even when `DOT_BOARD_EVENTS_ENABLED=false`. Listing remains subject to authorization. Directory visibility does not mean that subscriptions, transport, delivery or native chat wake are ready.

| Mode | Directory and delivery |
| --- | --- |
| Intake MCP off | No direct Events directory; event operations are unavailable |
| Intake MCP on; both delivery flags off | Owner-authenticated direct directory; no new direct subscription, challenge or delivery |
| Direct Events on; relay off | Direct directory; subscriptions/delivery still require available storage, current authorization and a separately verified deployment policy |
| Relay on; direct Events off | Existing independently configured relay path; no automatic conversion to direct Events |
| Direct Events and relay both on | Fail closed with `event_delivery_mode_conflict` |

Flags use the exact string `true`. A configured policy without `DOT_BOARD_EVENTS_ENABLED=true` does not enable transport. An enabled flag without policy is also insufficient. Missing Events storage prevents subscriptions, and enabling Events with missing required storage also blocks new intake submissions rather than losing the event side of a save.

Only `project_request.created` is defined for the direct path. Its filter is `{projectId}`; its `data` consists of `requestId`, `projectId` and `version`. The envelope carries the stable event ID, occurrence timestamp, name and `cursor: null`. Request text, task instructions and execution credentials are absent. The recipient must read the request through an authenticated tool. The existing `board.task_observed` relay domain and its controls remain distinct.

## Trusted deployment policy

The Sites adapter consumes `DOT_BOARD_SITES_EVENT_POLICY` as a JSON deployment record with schema `sites-openai-event-policy/1`. Only a trusted operator may populate it after independently verifying the actual runtime, routing boundaries, subscription and provider ownership. **The JSON fields are declarations and evidence references, not runtime attestation.** The implementation checks their structure and consistency; it cannot establish the truth of the referenced evidence.

| Field | Required contract |
| --- | --- |
| `schema` | Exactly `sites-openai-event-policy/1` |
| `deploymentAudience` | Exactly the current `DOT_BOARD_AUDIENCE`; binds the record to this deployment |
| `runtime.kind` | Exactly `cloudflare-workers-global-fetch` |
| `runtime.evidenceRef` | Private evidence that this deployment uses standard Cloudflare Workers global `fetch`, with the documented public-egress security boundary |
| `runtime.routing.kind` | Exactly `strict-public`; zone-list exclusion is unsupported |
| `runtime.routing.evidenceRef` | Trusted current-platform evidence that the entire effective outbound path through the final connection is strictly public |
| `runtime.routing.evidenceScope` | Exactly `complete-outbound-chain`; proof must cover all SaaS/outbound Workers, rewrites and private-origin exceptions |
| `callbackOrigins` | 1–16 unique, exact HTTPS origins; no default, wildcard, suffix allowance or automatic enrollment |
| `callbackOrigins[].origin` | Canonical HTTPS origin only, with no path, query, fragment, credentials or trailing slash |
| `callbackOrigins[].provider` | Exactly `openai` |
| `callbackOrigins[].nativeSubscriptionEvidenceRef` | Evidence from the actual user-approved native subscription for the intended event, project and chat |
| `callbackOrigins[].providerOwnershipEvidenceRef` | Independent evidence that OpenAI owns the exact offered origin; a callback challenge alone is insufficient |

Evidence references must be nonempty trimmed strings, at most 500 characters, without control characters. Keeping references private is important: they may identify restricted deployment or subscription records. These strings do not authorize a fetch to the evidence location or make an operator assertion self-verifying.

### Verify the actual egress boundary

Cloudflare documents a proxy-enforced outbound boundary that permits public Internet destinations **or the Worker's own zone origin**. The own-zone exception must therefore be addressed; “runs on Cloudflare” alone is not sufficient. See [Workers security model: API design](https://developers.cloudflare.com/workers/reference/security-model/#api-design).

This stage supports only `strict-public` with `evidenceScope: "complete-outbound-chain"`. Establish from trusted platform facts applicable to the current deployment that standard global `fetch` and the entire effective outbound route through the final connection have strictly public routing. This includes any SaaS mapping, outbound Worker, rewrite or private-origin exception. The policy scope label and evidence reference only record that external verification; setting them cannot perform it.

Cloudflare documents that `global_fetch_strictly_public` routes own-zone requests through the public front door; without it, own-zone fetches can go directly to the zone origin. See [global fetch strictly public](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public). That fact about a Worker flag alone does not prove the effective end-to-end behavior of this particular Sites deployment or any outbound routing override. The adapter's support is conditional on independent full-chain proof, not a claim that Cloudflare has certified this application.

A visible Site hostname does not identify the effective zone, and even a different callback hostname may map into the same/provider zone. Cloudflare's [Worker-as-origin example](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/) illustrates customer hostnames entering a provider zone. Consequently, a zone list plus hostname-suffix comparison is insufficient. The old proposed `effective-zone-exclusion` contract is deliberately unsupported and fails closed. If full-chain strictly public routing cannot be verified, keep direct delivery disabled.

The adapter additionally rejects an origin equal to the deployment audience and punycode callback names. Callback URL syntax remains HTTPS-only and rejects IP literals, local/reserved-name patterns, credentials, fragments and nonstandard ports. Exact approved origins are not general access to other provider hosts. Receiving an offered callback, passing a challenge, or recognizing a familiar-looking hostname never adds it to policy.

### Narrow transport surface

`createSitesOpenAIEventTransport` implements `platform-managed-public-https-v1`. It calls the verified standard `globalThis.fetch` directly. It accepts no caller-provided fetcher, `cf.resolveOverride`, `Host` override, credentials, service-binding transport or extra fetch options. Only the required JSON and webhook signature headers are sent. Both verification and delivery require `POST`, `redirect: 'error'`, an abort signal and the existing response/body limits; redirects are rejected rather than followed.

This is a platform-managed connection-time security contract, not application-level DNS pinning. The adapter does not manufacture DNS answers or claim to inspect a socket's resolved IP. The generic `explicit-pinned-https-v1` transport remains a separate contract. Policy is checked before a cached verification can be used and again for each actual outbound connection.

## Authorization and subscription lifecycle

The original Sites sign-in/OAuth boundary, exact configured audience and owner remain mandatory. A caller-supplied identity header on an untrusted public Worker is not equivalent. Visibility filtering and the current independent project registry continue to apply. The runtime rereads current registry authorization rather than relying on a stale captured registry.

Subscribe and delivery are denied for hidden or unknown projects, `executionState` values `paused`, `deferred` or `canceled`, and `acceptNewRequests=false`. Directory discovery does not activate those projects. Existing manual-continuation exceptions, task controls, execution authorization, dispatch admission, capacity and original-thread checks are unchanged and are not bypassed by Events.

The lifecycle retains the existing implementation limits:

- A subscription is scoped to authenticated owner, event name, canonical filter arguments and exact callback URL. Repeated subscription identity refreshes the stored record.
- Default and maximum lifetime are 24 hours. `ttlMs: null` does not grant an indefinite subscription. The server returns a finite `refreshBefore`.
- Callback verification uses a signed fresh challenge, a matching successful response, a 10-second request timeout and a 1 KiB verification response limit.
- Successful verification is cached for at most five minutes, bound to owner, callback URL and signing secret. Current origin/routing policy and authorization still apply on cache hits. Authorization is rechecked before committing a subscription after a challenge.
- Replacing a live subscription's secret retains the previous key for a five-minute dual-signature rotation window. Secrets remain in protected subscription storage and are never returned in public configuration.
- Cursor replay is unsupported. Subscriptions start from their saved event sequence; a new or lapsed subscription does not replay earlier missed events.
- Unsubscribe, access revocation and expiry deactivate delivery and cancel applicable pending work. Delivery authorization is checked again before an attempt. The authenticated owner may revoke their exact saved subscription after its project is stopped, hidden or removed, even with direct delivery disabled or policy absent. This exception grants no subscribe/deliver access and cannot revoke another owner's subscription.

The implementation follows the authenticated discovery, subscription, verification and signed-delivery flow described in [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events). Advertising protocol version `2026-07-28` does not certify that a specific plugin/chat connection has passed acceptance.

### Standard request metadata

The Events MCP boundary accepts `params._meta` as protocol metadata, separately from the strict subscription/unsubscription business fields. When supplied, it must be an object with the standard string `io.modelcontextprotocol/protocolVersion` and object `io.modelcontextprotocol/clientCapabilities`; known optional fields are shape-checked, while valid extension metadata remains opaque. The version must be supported and match a supplied `MCP-Protocol-Version` header. Malformed metadata returns HTTP 400 / `-32602`; unsupported metadata versions use `-32022`, and header mismatches use `-32020`.

Metadata is removed before the Events service receives the request. It is not authorization, subscription identity, stored subscription data or callback policy. Existing metadata-free callers retain their previous behavior; this narrow compatibility fix does not claim full implementation of every 2026-07-28 protocol requirement. Unknown business parameters still fail closed. See the [MCP request metadata specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta).

### Safe failure reporting

When the direct flag or trusted policy is missing, subscription fails closed before callback access. Policy failures use `sites_event_transport_not_ready` (HTTP 503, JSON-RPC `-32014`) and a categorized reason such as `direct_events_disabled`, `callback_policy_missing`, `deployment_policy_mismatch`, `runtime_contract_missing`, `runtime_contract_unsupported`, `callback_origin_unverified` or `callback_origin_not_approved`. Missing storage and denied authorization have their own existing errors; error ordering is not proof of other readiness.

Event-service and metadata rejections emit one `mcp_event_rejected` console record with a reconstructed safe error. Both this record and the JSON-RPC error use allowlisted categories, numeric codes and optional categorized reasons. An offered URL that passes callback syntax and conservative diagnostic checks may contribute only its normalized `offeredCallbackOrigin`; malformed or unsafe URLs omit it. The origin is recomputed from the request, never trusted from exception data. Unknown exception fields, `toJSON`, messages and stacks are not serialized. Logging failure cannot change the rejection.

Never expose callback userinfo, paths, queries, fragments, signing secrets/signatures, policy records, evidence references, request content or raw provider exceptions. Early ingress/authentication responses retain their existing behavior; this record does not claim to observe every rejected request. An offered origin is diagnostic input for independent review, not authorization to approve it. A 400 disappearing while `direct_events_disabled` or `callback_policy_missing` remains is not signed-delivery or native-chat acceptance.

## Durable save, approval and bounded immediate delivery

With direct Events storage enabled, an ordinary request save commits the request, initial receipt, immutable `project_request.created` event and matching outbox entries in one D1 batch. Sites candidate approval likewise includes the candidate review/link, request, initial receipt, event and matching outbox entries in one transaction. Any event/outbox/review failure rolls the transaction back. Replayed saves/reviews do not create another request or duplicate delivery row. An event can exist without an outbox row when no active matching subscription exists.

Candidate storage still works independently. With direct Events disabled, approval retains the ordinary request/receipt/review behavior. The default generic/no-direct candidate path does not gain Events implicitly. Candidate creation alone is not a request-created event. Approval never writes a dispatch job, execution authorization, permission or task binding and never executes the request.

After a newly saved request or approved candidate has committed, Sites schedules an immediate drain with `ctx.waitUntil` only when Events storage and transport are ready and that context method is available. The drain considers at most two due outbox items within a 25-second total budget; each callback has the existing 10-second timeout. When both are eligible, the oldest delivery for another event gets the first slot and one delivery for the newly created event gets the next. Remaining capacity follows the existing due-time order, so multiple matching subscriptions cannot occupy every slot while older work waits. A one-item drain serves older work first; with no older backlog, matching new-event deliveries can fill the limit. The older slot runs first so a slow new-event callback cannot consume the budget before any backlog attempt. Neither the time budget nor reserved slots guarantee that a backlog or all matching subscriptions finish in one invocation. Failure cannot turn an already committed save into a fictitious rollback.

Cloudflare documents a shared 30-second post-response limit for HTTP `waitUntil` work. The smaller application budget leaves headroom, aborts outstanding callback work and keeps unfinished work durable; it does not guarantee completion before an invocation is interrupted. See [Workers context: waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

This stage installs **no scheduler, autonomous retry loop, polling or external supervisor**. The Sites `scheduled()` entry explicitly returns `disabled: true` with `no_sites_retry_trigger_configured`. A generic Worker's separate scheduled handler is not installed or enabled for Sites.

Durable retry eligibility is not a promise of a future invocation. A later qualifying, authorized new-request save or candidate approval can drain due work; a page refresh or directory read does not trigger draining. If no such invocation occurs, pending work can remain until expiry or later maintenance. Interrupted claims are eligible for recovery through the existing lease mechanism on a subsequent authorized drain; no additional retry service is created here.

Existing claim and retry semantics remain:

- Compare-and-set claim with a 30-second lease; claim attempts are counted, including interrupted attempts. Maximum five attempts.
- Exponential backoff from one second, capped at 60 seconds, for transient errors and HTTP `408`, `425`, `429` or `5xx`.
- HTTP `410` revokes the subscription; `413` and other permanent `4xx` fail the delivery. Unsafe destinations and redirects fail closed.
- A completed attempt is fenced by its lease token. Expired in-flight leases can be reclaimed within the attempt limit. Expiry, revocation and exhausted attempts are handled by existing maintenance on a drain.
- Event IDs remain stable across retries, while signing timestamps/signatures are fresh. At-least-once delivery requires receiver deduplication and idempotent downstream writes.

A `2xx` means callback receipt only. It does not prove a chat wake, a request read, execution, original-thread continuation or completion. Transport status and actual execution/result receipts must remain separate.

## Safe status in configuration

The owner-protected configuration exposes `eventDelivery` with `mode: 'sites-direct'`, `requested`, `discoveryReady`, `storageReady`, `transportReady`, `canSubscribe`, a categorized `reason`, owner-scoped `activeSubscriptions` and outbox state counts, `immediateDelivery`, and `autonomousRetry: false`.

No callback URL, secret, policy record, evidence reference or request content appears in this summary. Counts can be `null` when storage/summary information is unavailable. `immediateDelivery` indicates that the current invocation has `waitUntil`; it does not mean an event was delivered. `canSubscribe` also requires enabled MCP and at least one eligible visible project; each requested project is checked again. `ready_for_native_subscription` reports local configured readiness, not independent attestation or a live subscription. `active_callback_subscription` reflects a stored unexpired subscription count, not a proven native chat wake. A `delivered` counter records callback acknowledgement only.

## Required live acceptance evidence

Source code, mocks, public documentation, a successful build and a visible event directory do not replace live acceptance. Before claiming the deployed direct path works:

1. Obtain the user's actual subscription instruction, naming the event, project, intended native chat and permitted response. Discovery alone does not grant standing action authority.
2. Observe the genuine native `events/subscribe` offer. Keep its callback path and signing secret private. Independently establish ownership of its exact origin and record both native-subscription and provider-ownership evidence.
3. Verify the current deployment audience, standard global-fetch runtime and effective routing boundary. Record trusted current-platform proof of strictly public routing across the complete outbound chain, including SaaS mappings, outbound Workers, rewrites and private-origin exceptions. A zone list or source-level fetch mock is insufficient.
4. Only after those separate checks and appropriate authorization, configure the trusted private policy and enable the direct flag with the relay off. This document and source update perform no runtime configuration changes.
5. Confirm the signed challenge, durable subscription, refresh/expiry behavior and private storage. Verify wrong owner, hidden/stopped project and mismatched filter cases fail closed.
6. Perform an authorized matching save and candidate approval; verify atomic persistence and replay safety. Confirm the real event arrives and wakes the specifically subscribed native chat.
7. Verify the permitted authenticated read and response. If execution/continuation was separately authorized, require actual original-context execution and result receipts before claiming those stages complete.
8. Record callback receipt, native arrival/chat wake, permitted response and execution/result acceptance separately. If any proof is missing, report that boundary as unverified and leave its dependent claims off.

There is no guessed OpenAI origin, wildcard approval, automatic callback enrollment or implicit subscription in this process. The separately configured relay remains unchanged; never enable both delivery flags to bridge a missing proof.

## Implementation references

- [Sites entry and authorization](../src/application/sites-entry.mjs)
- [Sites callback transport and policy validation](../src/adapters/sites-openai-event-transport.mjs)
- [Worker composition, safe status and immediate drain](../worker.mjs)
- [Events service, challenge, signing and drain](../src/application/mcp-events-service.mjs)
- [D1 Events transactions and leases](../src/adapters/d1-mcp-events.mjs)
- [Candidate approval transaction](../src/adapters/d1-candidates.mjs)
- [Online installation](sites-deployment.md), [integration overview](integrations.md), [candidate workflow](candidate-workflow.md)
