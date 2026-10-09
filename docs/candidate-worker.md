# Event Worker integration candidate

This optional entry wraps the release Worker and preserves its dispatch HTTP,
execution-evidence validation, owner-scoped queue and project-accounting modules.
It is disabled and unconfigured. It is not a deployed service or a verified login,
webhook subscription, automatic wakeup, or native-executor integration.

## Build and validation

- `npm run build:candidate` emits `dist/candidate/index.js`.
- `node --import ./tests/candidate-no-network.mjs --test tests/candidate-*.test.mjs`
  runs synthetic adapter, owner-entry and platform callback tests with network
  sockets disabled. Test mocks are not deployment adapters.
- `npm test`, `npm run check` and `npm run check:public` check the release plus
  candidate source. The test pre-step builds both bundles.
- `config/wrangler.candidate.jsonc` selects only the candidate bundle. Its gates
  are all off; it has no D1 binding, cron, routes, account, or private services.

## Identity and permission contract

`src/adapters/deployment-adapters.mjs` intentionally denies both hooks.
A future trusted ingress adapter must cryptographically validate the configured
issuer and signature, token expiration and audience. It must not convert a
caller-controlled identity header into a verified result. Only after validation
may `authenticate` return `{verified:true,ownerId,audience,expiresAt}`.

The entry requires configured `DOT_BOARD_OWNER_ID` and `DOT_BOARD_AUDIENCE` and
compares both exactly. A second, server-side revocable grant must have
`active:true`, the same `ownerId` and `audience`, and `boardAccess:true`.
This board-wide grant intentionally authorizes the global snapshot and assets;
event-only project grants never authorize board viewing or task operations.
Every route passes this gate, including assets, health, board, MCP, requests and
dispatch. The untrusted incoming identity header is replaced only afterward.
No grant is cached. Missing configuration, malformed/expired claims, adapter
failures, wrong owners/audiences, and revoked grants fail closed.

Events additionally require the exact event name and a nonempty `projectIds`
allowlist. Registration and delivery recheck grants; background draining never
substitutes a service identity for the owner. A scheduled call is not a scheduled
trigger: no cron is configured in this candidate.

## Callback transport boundary

The candidate always constructs `platform-managed-public-https-v1` using only
`globalThis.fetch`; it accepts no injected private Fetcher. The configuration
requires `global_fetch_strictly_public`. The transport preserves the original
HTTPS hostname, rejects IP literals/private-looking names/nonstandard ports,
uses `redirect: error`, and reconstructs the allowed request headers and options.
It does not accept origin/resolve overrides, Host headers, or private bindings.
A JS kind string is not a platform attestation. Before any deployment, inspect
the actual effective compatibility flags and all Worker bindings.

The separate existing explicit-IP transport interface remains for backwards
compatibility. It is not selected by this entry and still requires public DNS
results and a real socket-pinning implementation from its caller.

## Remaining real wiring

Still required, with appropriate authorization: reviewed ingress verification and
authoritative revocable owner grants; effective platform egress verification;
persistent database binding and migrations; deployment/route selection; real
receiver challenge and signed subscription; permitted wake trigger; native host
provider plus genuine execution observations and terminal/no-active-writer
reconciliation. A synthetic running receipt does not prove any of these.
