# Architecture

```text
Explicit host export
       |
       v
Snapshot adapter / optional Workbench mapper
       |
       v
Domain validation and allowlisted records
       |
       v
Application read model
       |
       v
GET-only HTTP adapter -> browser presentation
```

## Ownership

- The external host owns execution, approvals and task persistence
- Domain code validates snapshots and observed Agent relationships
- Application code computes display counts, associations and freshness
- HTTP adapters serve data and assets; they do not schedule work
- The browser owns local selection, filtering and expanded details

`server.mjs` and `worker.mjs` share the same application and HTTP functions. `scripts/build.mjs` creates a small Worker bundle from an explicit module list. No runtime snapshot is embedded in the build.

## Relationship semantics

An Agent's `parentAgentId` is an observed relationship. `projectNames` only groups work. A project can have several collaborating agents, or none in the imported roster. A free-text task role does not create an Agent identity.

An agent can complete one result and later resume another task using the same identity. Current activity and latest result are separate. Task execution, source review, delivery and business acceptance are separate dimensions as well.

## Time and coverage

Observation time belongs to the source record. Import time says when a snapshot was prepared; request time says when it was read. Refresh must not rewrite observation time.

Counts describe the imported known subset. Missing coverage never becomes a global total. An old running observation becomes unverified, rather than automatically completed or continuously active.

## Compatibility

The optional Workbench mapper accepts task exports with fields such as `id`, `title`, `projectId`, `businessStageId`, `executionState` and `acceptanceStatus`. It does not use Workbench's UI store or execution engine, and it does not contact a running Workbench instance.
