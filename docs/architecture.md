# Architecture

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

```text
Authorized snapshot export -> validation -> board read model -> project canvas
                                      ^
                        optional queue record projection

Authenticated browser -> request storage <- authenticated MCP tools
                               |                     |
                       optional event outbox    optional finite queue
                               |                     |
                       injected transport      injected host adapter
```

## Ownership

- The exporter supplies authorized observations, timestamps and evidence.
- Domain code validates snapshots, Agent relationships, request events and queue transitions.
- Application code computes associations, freshness and counts within the imported subset.
- Storage adapters persist requests and optional queue/event records.
- HTTP and MCP adapters expose bounded operations; they do not grant account access or execution permission.
- The browser selects projects, filters records, opens details and, when enabled, saves project requests.
- An external host owns authentication, approvals and actual execution. It must report verified outcomes before they appear as running or completed work.

`server.mjs` and `worker.mjs` share application and presentation code. `scripts/build.mjs` produces a Worker bundle of code and static assets. Runtime snapshots, request databases and deployment identity are supplied separately.

## Projects and relationships

Projects are the primary navigation and canvas grouping. Recorded task-to-Agent associations are separate from `parentAgentId`, which represents an observed Agent parent-child relationship. Project membership never proves a dependency or a creator relationship. A free-text task role never creates an Agent identity.

An independent project registry supplies fixed IDs, canonical names and optional aliases for intake. A project can still appear without a registry entry; it cannot receive requests until its ID is configured. Invalid intake configuration must not hide an otherwise valid snapshot.

Six generated portraits distinguish Agent cards. When a role is unverified, a deterministic selection from the Agent ID keeps its illustration stable. This is visual continuity, not an inferred role, and it does not create a new Agent record.

## Time and coverage

Observation time belongs to the source record. Import time says when a snapshot was prepared; response generation time says when it was read. Refresh must not rewrite observation time. Future or missing timestamps are not fresh evidence.

Counts describe the imported known subset. An Agent shared by projects is deduplicated in aggregate counts. Missing coverage is never presented as a global total. Old running observations become unverified. Task completion, latest Agent result, deployment and business acceptance remain distinct.

## Intake and execution

The request store keeps the submitted text, referenced snapshot revision, original task context and ordered status events. Saving, reading, accepting, assigning and completing are separate transitions. A list/read operation does not acknowledge a request.

The optional queue persists intent before external execution, bounds simultaneous reservations and retains original thread/environment bindings. An uncertain external result retains its reservation until reconciled. The host adapter is an interface to supply, not an included native scheduler. Browser submission never directly invokes it.

Events support is a separate experiment: a persisted outbox plus an injected, authorized webhook transport. A flag or a mocked transport is not evidence that a real callback or plugin is connected. See [optional integrations](integrations.md).

## Portable and host-specific pieces

The local snapshot server does not require a hosted service. The Worker can use a D1-compatible `DB` binding for intake and experiments. A particular host's private-site configuration, identity verification, database binding and callback transport are deployment responsibilities, not portable defaults.

The Workbench adapter only maps an already-authorized export. It does not connect to Workbench sessions, copy its execution engine, discover agents or read private conversations.
