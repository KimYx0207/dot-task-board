# Snapshot and HTTP contract

## Versions

The normalized schema is `dot-board.snapshot/2`. Version 1 task snapshots remain readable and produce an empty Agent roster unless explicit Agent records are supplied. Unknown versions reject the snapshot. The browser keeps its previous successful data after a later failed refresh.

See [the complete synthetic example](../examples/synthetic-snapshot.json) and [Agent relationship details](../src/domain/README.md).

## Root

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Supported schema identifier |
| `importedAt` | Required UTC ISO timestamp |
| `source.label` | Human-readable source label |
| `source.mode` | `synthetic` for demos; otherwise reported observations |
| `coverage.scope` | Plain-language explanation of the selected subset |
| `tasks` | Up to the configured task limit |
| `agents` | Optional, explicitly observed Agent roster |

Unknown fields are not projected into the browser response. Invalid required task identities, duplicates, invalid imports and cyclic Agent relationships fail closed.

## Tasks

`id` and `title` are required. Supported fields include:

- `project`, `state`, `stage`, `ownerRole`
- `observedAt`, `observation`, `blocker`, `nextAction`, `nextOwnerRole`
- `goal`, `acceptanceCriteria`, `retainedDecision`
- `evidence`: safe `{label, url}` result links
- `verification.sourceReview`, `.deployment`, `.businessAcceptance`: each contains `state` plus optional `note` and `observedAt`

Task states and verification labels are centralized in `config/board.mjs`. Missing timestamps remain null. Unsupported states become unknown.

## Agents

`id` and `name` are required. The roster supports:

- `type`: `agent` or `subagent`
- `kind`: coordinator, owner, worker, reviewer or researcher
- `role`, `responsibility`, `parentAgentId`, `projectNames`, `taskIds`
- `activity`: state, summary, observedAt, blocker and nextAction
- `latestResult`: a real result summary, observation time and safe evidence links
- `source`: kind, label and observedAt

The read model adds freshness, relationship status, unresolved task counts and bidirectional task associations. It never creates an actor from a role label. The coordinator is counted separately from executing workers.

## HTTP

| Route | Response |
| --- | --- |
| `GET /` | Board UI |
| `GET /api/config` | Presentation configuration |
| `GET /api/board` | Validated v2 read model, or a safe source error |
| `GET /health` | Service health and read-only mode |
| `GET /preview/mobile` | Same app inside a 390px layout-check frame |

`HEAD` is supported. Other methods return `405`; unknown paths return `404`. Responses use `no-store`. A missing source returns `503` with `no_feed`; invalid or unavailable sources return safe error codes without private details.

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

The caller supplies an already-authorized export. No network connection, credentials, private chat access or task control is created by this function.
