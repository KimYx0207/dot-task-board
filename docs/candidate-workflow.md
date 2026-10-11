# Candidate review and original-task continuation

[English](candidate-workflow.md) · [简体中文](candidate-workflow.zh-CN.md)

## What the owner does

1. Save a suggestion with its project, source reference, reason and expected outcome. Add a deadline or area when useful. A source is context, not an instruction to execute.
2. Read the suggestion and choose **approve and save request** or **decline**. A decision note records why. Approval creates one `received` request and preserves the candidate-to-request link.
3. dot reads that request through the existing authenticated intake tools. Acceptance, a permitted execution target and actual dispatch are separate steps.
4. Follow progress and results in their own views. A follow-up stays linked to the original task. Completion reflects the actual scoped result, not merely a successful save.

## Durable API

- `GET /api/candidates`: owner-scoped candidates, with pagination and optional client-submission lookup.
- `POST /api/candidates`: save a source-backed suggestion using `clientSubmissionId`.
- `GET /api/candidates/:id`: current candidate and its linked request when present.
- `POST /api/candidates/:id/review`: `eventId`, `expectedVersion`, `decision` (`approve` or `reject`) and `note`.
- MCP: `list_candidates`, `get_candidate`, `propose_candidate`, `review_candidate`.

The ordinary-data migration appends candidate and decision records without altering existing execution tables. Approval records the candidate decision, request and initial request receipt atomically. With Sites direct Events enabled and storage available, the same transaction also records the identifier-only `project_request.created` event and matching outbox entries; any failure rolls back the full approval. The default generic/no-direct candidate path keeps its ordinary no-Events behavior. A conflict requires a fresh read. An ambiguous response is reconciled from the saved receipt; it does not authorize a second request or native send. Approval does not write dispatch jobs, execution authorization, permissions or task bindings and never executes the request.

## Check before reserving execution

The session client provides two inspections:

- `inspectDotSessionCapabilities(...)` lists missing native tools and review functions without invoking them. Tool presence alone grants no permission.
- `client.inspectContinuation({requestId})` reads an existing, selected queued request, its original binding, withdrawal state and original session. It asks the actual host to verify scope and writer state, without claim, update or send.

A positive inspection means only that continuation evidence was reviewed. It leaves admission, controls, TTL and capacity to the existing claim/preflight checks. `dispatchNext` redoes its checks, records the durable intent, then invokes the same original thread once. An unknown outcome remains held for reconciliation. See the [complete client contract](dot-session-dispatch-client.md).

The current public package does not implement `get_request_withdrawal_state`. The session client requires that authenticated capability from its host, alongside the real review functions. Missing withdrawal evidence stops inspection and dispatch; installations must not substitute `false` to make the client proceed.

## Events connection

The [official MCP Events specification](https://developers.openai.com/plugins/build/mcp-events) uses authenticated discovery and subscriptions, HTTPS callback verification and signed webhook delivery. Delivery acknowledgement is separate from execution. Polling or a page refresh is not the same transport.

The Sites entry now exposes owner-authenticated Events discovery separately from direct transport readiness. Candidate storage works independently; direct subscription/delivery needs the enabled flag, durable storage and a separately verified runtime/routing/exact-origin policy. An enabled Sites approval can schedule at most two immediate callbacks through `ctx.waitUntil`, with a 25-second budget and 10 seconds per callback. No scheduler, autonomous retry, polling or execution is added. The directory and a `2xx` receipt do not prove a native chat wake. Verify the actual user-approved subscription, exact-origin ownership, runtime/zone evidence, challenge, persistence, arrival/chat wake and permitted result receipts before claiming the live path; original-session dispatch still requires its own authorization and evidence. See [Sites direct Events](sites-direct-events.md).

## Public inspiration and implementation

[Yoshio's task workflow](https://x.com/yoshio_nocode/status/2108111375704695191) separates task entry, execution, result review and same-session follow-up. His public demonstrations also distinguish candidate approval from starting execution. We independently implement these interaction ideas. His private prompts, gated materials, code and personal screenshots are not included. Our documentation screenshots use explicitly synthetic records on our own interface.
