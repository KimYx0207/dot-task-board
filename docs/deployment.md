# Developer reference: alternative deployment modes

[English](deployment.md) · [简体中文](deployment.zh-CN.md)

For the primary online product, start with [Deploy your own online Site](sites-deployment.md). That guide selects the Sites-specific entry, full schema, owner identity and private deployment artifact. The modes below are optional alternatives; a generic Worker is not a substitute for the full private Sites adapter.

## Optional modes; not the online Site installation sequence

| Mode | Requirements | What it does |
| --- | --- | --- |
| Local snapshot | Node.js 24+ and an exported snapshot | Displays observations on loopback |
| Synthetic demo | Node.js 24+ | Fictional projects, temporary SQLite receipts and queue-state checks without execution |
| Authenticated intake | Durable storage, project registry and verified owner identity | Saves requests and versioned read/progress receipts |
| Generic Worker with D1 | A separately configured Worker host, authentication and `DB` binding | Snapshot UI and optional persisted intake; does not include the Sites-only manual-status and observation services |
| Queue / Events experiments | Explicit flags plus the required storage and host integration | Records queue intent / delivers through an injected transport |

No npm dependency installation is needed to run, test or build the repository. A hosting provider's CLI and account setup are separate. For the optional local installation, see [INSTALL.md](../INSTALL.md). For the online product, use only the [Sites installation sequence](sites-deployment.md).

## Local snapshot server

`npm start` binds to `127.0.0.1`. Supply `DOT_BOARD_SNAPSHOT_PATH` pointing outside the repository, or a server-side `DOT_BOARD_SNAPSHOT` JSON string. The application does not load `.env` files automatically. `DOT_BOARD_PORT` changes the default `4317` port.

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

Missing input reports `no_feed`; it does not substitute fictional activity. Local Node strips caller-supplied owner identity headers. A custom intake integration must supply the server's authentication callback with a verified identity.

Keep the local server on loopback. Do not remove Host validation or expose it directly to the internet. For remote use, put the complete application behind a verified authentication and authorization boundary.

## Persistent local installation

Use the managed `install`, `start`, `status` and `stop` commands in [INSTALL.md](../INSTALL.md). They keep versioned source under a separate installation directory and SQLite data under its `data/` directory. Managed demo storage survives restarts; a plain `npm run demo` uses a new temporary directory unless explicitly configured otherwise.

Local intake uses a single owner identity for loopback clients. It is not hosted authentication. The persistent local app rereads its external snapshot on board/API requests; source observation times remain unchanged. Registry files are loaded at startup and require a restart after changes. The snapshot-only `npm start` also rereads its snapshot file on board requests.

## Worker build

```sh
npm run build
node --check dist/server/index.js
```

This creates `dist/server/index.js`, an ESM Worker. It exports the request handler and optional scheduled event drain, with application code and static UI assets. The build does not deploy anything. Runtime data and credentials are not embedded.

Provide snapshots through one of these methods:

- `DOT_BOARD_SNAPSHOT`: a complete JSON string
- `DOT_BOARD_SNAPSHOT_PARTS`: the number of chunks, with `DOT_BOARD_SNAPSHOT_0` through the final numbered chunk

Chunking addresses per-value transport limits; it is not encryption. Store sensitive runtime values with your host's supported secret controls. Do not commit a real snapshot or hosted project identity.

## Optional D1 storage

For the current complete plain-SQL schema, a generic Worker needs a D1-compatible database bound as `DB`. Apply the entire `migrations/` chain in order to a new database; the first two files alone are not the full current schema:

1. `0000_project_intake.sql`
2. `0001_events_dispatch.sql`
3. `0002_execution_evidence.sql`
4. `0003_dispatch_guards.sql`
5. `0004_native_dispatch_journal.sql`
6. `0005_board_observations.sql`
7. `0006_board_observation_outbox.sql`
8. `0007_dispatch_manual_authorizations.sql`
9. `0008_manual_task_status.sql`
10. `0009_task_requirements.sql`

A complete schema does not enable every host-specific feature. **Sites deployments use the separate full Drizzle chain in [the online guide](sites-deployment.md), not these instructions.** Never apply both chains to the same database. Managed local installation applies its own plain-SQL migration chain; do not manually repeat it.

Use the host's documented migration tooling, record which database is being changed, and back up existing data before an upgrade. The plain SQL is checked in; a schema generator is not a runtime requirement. A missing table disables the corresponding capability; do not announce intake as ready from process health alone.

An ordinary Worker deployment requires its own configuration for bindings, routing and access control. A private-site flag from another host is not a general Worker authentication mechanism. This public source does not carry a private deployment's configuration, URL, project ID or runtime data.

## Runtime configuration

This table describes the generic adapter, not a second configuration checklist for Sites. All booleans below require the exact string `true`; absent optional flags remain off. The current private Sites entry forcibly disables direct Events delivery regardless of its flag; see [the current integration scope](integrations.md).

| Variable | Purpose |
| --- | --- |
| `DOT_BOARD_PROJECT_REGISTRY` | JSON array of stable project IDs, names and aliases |
| `DOT_BOARD_INTAKE_ENABLED` | Operator enables request intake |
| `DOT_BOARD_INTAKE_MCP_ENABLED` | Operator enables the authenticated MCP bridge |
| `DOT_BOARD_INTAKE_CONNECTION_VERIFIED` | Operator confirms the client connection was tested |
| `DOT_BOARD_INTAKE_READER_VERIFIED` | Operator confirms read/acknowledgement verification |
| `DOT_BOARD_INTAKE_WRITER_VERIFIED` | Operator confirms progress-event verification |
| `DOT_BOARD_INTAKE_POLL_MINUTES` | Optional displayed polling interval; does not create a scheduler |
| `DOT_BOARD_QUEUE_ENABLED` | Enables experimental queue support when tables exist |
| `DOT_BOARD_QUEUE_CAPACITY` | Per-owner reservation limit, default 1, range 1–32 |
| `DOT_BOARD_EVENTS_ENABLED` | Enables experimental Events support when tables exist |

Submission requires enabled intake, storage, a valid nonempty project registry, an enabled bridge and a verified connection. Reader/writer verification additionally changes the reported readiness state. These flags declare setup; they cannot prove it. Consult `/api/intake/capabilities` and exercise the actual authenticated flow before setting verified flags.

## Authentication boundary

The Worker does not implement a login system or verify an arbitrary incoming identity header. The host must authenticate requests, remove forged client identity headers and inject a verified owner ID. It must protect the entire UI, `/api/board`, intake routes and `/mcp`; do not publish an unprotected Worker route alongside the protected one.

Request records are owner-scoped. The snapshot is deployment-scoped, so this is not an automatic multi-tenant snapshot service. Use a single authorized audience per deployed snapshot, or implement a separately reviewed owner-aware snapshot source.

Browser submission requires same-origin JSON requests. This protects the intended flow but does not replace authentication. A hidden URL, a UI privacy label or a successful health response is not access control.

## Refresh, events and validation

Refresh rereads supplied records without updating their observation times. An exporter or polling service must be configured separately. For the generic host experiment, Events additionally require an authorized transport contract and a separately configured scheduled drain; see [the two transport contracts](integrations.md). Candidate transport source is included, but no production callback connection or native execution scheduler is supplied or verified. The standard private Sites entry keeps direct Events and scheduled draining disabled.

Verify signed-out access denial, owner isolation, save/retry/read/event flows and any selected host's behavior with synthetic data before connecting private records. A 390px frame checks layout, not a real phone. Verify real devices and live integrations separately before claiming their acceptance. Provider limits and charges depend on the chosen account and configuration; no free-service or throughput guarantee is made here.

## Build targets for developers

| Command | Output | Scope |
| --- | --- | --- |
| `npm run build:sites` | `dist/sites/index.js` | Current owner-private Sites adapter: manual status, observations, task controls and read-only task checks |
| `npm run build` | `dist/server/index.js` | Generic Worker; requires separate trusted identity integration and does not inject the Sites-only services |
| `npm run build:candidate` | `dist/candidate/index.js` | Experimental ingress/callback development target; not part of the standard Site installation or a verified automatic-execution release |

Outputs are separate. The online staging command selects the Sites build and packages it at the host's expected path; follow [the online guide](sites-deployment.md). Plain Worker and local installs keep manual-status editing unavailable unless an appropriate trusted host service is supplied.
