# Snapshot and HTTP contract

[English](data-contract.md) · [简体中文](data-contract.zh-CN.md)

## Snapshot versions

The normalized schema is `dot-board.snapshot/2`. Version 1 task snapshots remain readable and produce an empty Agent roster unless explicit Agent records are supplied. Unknown versions reject the snapshot. After a failed refresh, the browser retains its previous successful data with a warning.

See [the synthetic example](../examples/synthetic-snapshot.json) and [Agent relationship details](../src/domain/README.md).

| Root field | Meaning |
| --- | --- |
| `schemaVersion` | Supported schema identifier |
| `importedAt` | Required UTC ISO timestamp |
| `source.label` | Human-readable source label |
| `source.mode` | `synthetic` for demos; otherwise reported observations |
| `coverage.scope` | Description of the selected subset |
| `tasks` | Task records, up to the configured limit |
| `agents` | Optional, explicitly observed Agent roster |

Unknown fields are not projected into the browser response. Invalid required identities, duplicates, invalid imports and cyclic Agent relationships fail closed.

## Tasks and Agents

Tasks require `id` and `title`. Supported fields include:

- `project`, `state`, `stage`, `ownerRole`
- `observedAt`, `observation`, `blocker`, `nextAction`, `nextOwnerRole`
- `goal`, `acceptanceCriteria`, `retainedDecision`
- `evidence`: safe `{label, url}` result links
- `verification.sourceReview`, `.deployment`, `.businessAcceptance`: each contains `state`, with optional `note` and `observedAt`

Agents require `id` and `name`. The roster supports:

- `type`: `agent` or `subagent`
- `kind`: `coordinator`, `owner`, `worker`, `reviewer` or `researcher`
- `role`, `responsibility`, `parentAgentId`, `projectNames`, `taskIds`
- `activity`: `state`, `summary`, `observedAt`, `blocker` and `nextAction`
- `latestResult`: a real result summary, observation time and safe evidence links
- `source`: `kind`, `label` and `observedAt`

States and labels are centralized in `config/board.mjs` and `config/agents.mjs`. Missing timestamps stay null; unsupported states become unknown. The read model adds freshness, relationship status, unresolved task counts, project summaries and bidirectional associations. It does not create an actor from a role label.

The response's `snapshotRevision` is a SHA-256 revision of the normalized snapshot and applicable project/queue context. `generatedAt` is response time, not observation time. A request stores the revision the user saw; a newer board can flag that context as stale without rewriting the original request.

## Project registry

`DOT_BOARD_PROJECT_REGISTRY` is independent runtime JSON:

```json
[
  {"id": "demo-alpha", "name": "Demo Alpha", "aliases": ["Alpha"]}
]
```

IDs are stable identifiers, not display labels. Registry names and aliases must be unambiguous and match exported project labels. At most 200 projects are accepted. Missing or invalid registry configuration disables submission, while existing snapshot views remain available. The board also shows projects observed only through Agent membership, even without tasks.

## HTTP routes

| Route | Purpose |
| --- | --- |
| `GET /` | Board UI |
| `GET /api/config` | Presentation configuration |
| `GET /api/board` | Validated read model or safe source error |
| `GET /health` | Process health and configured mode; not integration acceptance |
| `GET /preview/mobile` | Same app in a 390px layout-check frame |
| `GET /api/intake/capabilities` | Available storage, registry and intake capabilities |
| `GET /api/projects/:projectId/requests` | Current owner's paginated project requests |
| `POST /api/projects/:projectId/requests` | Save a request and return a durable receipt |
| `GET /api/requests/:requestId` | Current owner's receipt and event history |
| `POST /mcp` | Optional JSON-RPC MCP endpoint |

Board/assets routes support `HEAD`; unsupported methods return `405`. Responses use private `no-store`. A missing snapshot returns `503` with `no_feed`; invalid or unavailable sources return safe errors without private details.

Request list/detail/write routes require an authenticated owner. Browser POSTs require a same-origin `Origin` header and JSON content. MCP accepts POST JSON-RPC; an `Origin`, if provided, must also match. Read/write tool calls require the configured bridge and verified owner. Do not expose this service by allowing arbitrary clients to choose their identity header.

## Request submission and receipts

The `dot-board.request/1` input contains:

| Field | Requirement |
| --- | --- |
| `clientSubmissionId` | Stable client-generated ID, 16–100 characters; reuse unchanged for a retry |
| `body` | Nonempty text, up to 6,000 characters |
| `contextTaskId` | Optional task in this project |
| `viewedSnapshotRevision` | The observed `sha256:` revision from `/api/board` |
| `viewedSnapshotImportedAt` | Referenced snapshot's UTC ISO import time |
| `contextSummary` | Optional plain-text context, up to 1,500 characters |

A new save returns `201`; an identical retry returns the original receipt with `200` and `replayed: true`. Reusing an ID with different content returns `409`. JSON bodies are bounded to 32 KiB. Use the returned request `version` for subsequent status events; a stale version returns a conflict rather than overwriting progress.

Saving produces `received`. Reading does not change it. A separate acknowledgement records `read`; later allowed states include `accepted`, `needs_confirmation`, `declined`, `assigned`, `in_progress`, `blocked`, `completed` and `canceled`. Assignment/progress requires linked task IDs; completion requires safe HTTPS evidence. See [lifecycle boundaries](integrations.md).

## MCP tools

| Tool | Effect |
| --- | --- |
| `get_board_snapshot` | Read the allowlisted board projection |
| `list_request_projects` | Read configured projects visible in the current board |
| `list_project_requests` | Read a bounded request page |
| `get_project_request` | Read one request and its history |
| `acknowledge_project_request` | Persist a read acknowledgement |
| `record_project_request_event` | Persist an allowed, versioned status event |

MCP reads neither acknowledge nor execute work. Event writes require an idempotent `eventId` and `expectedVersion`; matching retries replay safely. Queue tools and experimental Events methods are described in [optional integrations](integrations.md). Use `tools/list` to inspect the current server's input schemas rather than assuming optional tools are enabled.

## Workbench export mapping

```js
import {fromWorkbenchExport} from './src/adapters/workbench.mjs';

const snapshot = fromWorkbenchExport(exportedTaskDto, {
  importedAt: new Date().toISOString(),
  observedAt: null,
  projectLabels: {},
  stageLabels: {}
});
```

The caller supplies an already-authorized export. The mapper creates no network connection, credentials, private conversation access or task controls. Supplying an import timestamp does not supply a missing observation timestamp.
