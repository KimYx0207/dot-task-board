# Security

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## Scope

The `0.2.0` release candidate adds optional authenticated request storage and experimental queue/Events support to the snapshot viewer. It is not a security-isolated Agent execution environment. The queue, webhook transport and external executor require separate host integration and review.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting entry if it is available for this repository. If it is not enabled, open an issue containing only a request for a private security contact channel. Never put exploit details, real snapshots, request bodies, account information, credentials or private logs in a public issue.

Ordinary interface bugs can be reported publicly with synthetic reproductions. No response-time commitment is implied.

## Trust boundaries

- A trusted host must explicitly export and sanitize snapshot input. Field allowlists, length limits, URL filtering and text rendering are defensive measures, not a complete sanitization guarantee.
- The Node server listens only on loopback and rejects non-loopback Host values. It strips caller-supplied identity headers. Do not expose it directly to the internet.
- The Worker relies on its host for authentication and authorization. A header supplied by an untrusted client is not a verified identity. Protect all UI, data and MCP routes, including any alternate origin.
- Request records are owner-scoped, while a supplied snapshot is deployment-scoped. Do not treat this as automatic multi-tenant snapshot isolation.
- Request text is untrusted input. A saved request or accepted status does not authorize execution, credential access or an external communication.
- The local intake server uses one loopback owner identity; other trusted processes/users on that machine can reach the same local data. It is not a per-user login or production authentication boundary. Hosted integration requires separately verified identity.
- An uncertain dispatch keeps its reservation. Do not retry an external create or release a slot from a timeout, offline status or unverified report.
- Events require explicit authorization and a transport that validates and pins public destination addresses while preserving TLS hostname verification. There is no permissive fetch fallback.
- Protect request databases, signing secrets, snapshots and backups as private runtime data. Keep them and deployment identities outside public source.
- Browser drafts are local session data. Avoid entering private data in the synthetic demo or on shared devices.
- Security fixes must preserve unknown, stale and error states rather than fabricate success.

See [deployment](docs/deployment.md) for setup boundaries and [optional integrations](docs/integrations.md) for experimental behavior. Local tests do not prove a production authentication or callback integration is safe.

## First-install identity lookup

The Sites-only `/setup` and `/api/setup/identity` routes are disabled unless `DOT_BOARD_IDENTITY_SETUP_ENABLED` is exactly `true`. They require the configured HTTPS Site origin and platform-authenticated visitor identity, return only that visitor's Site ID, and never access storage or assign an owner. Existing owner configuration closes the lookup. Other routes retain their original owner checks throughout installation.

An authenticated visitor is not proof of Site ownership. The installing dot must verify the current owner and owner-only access through Sites management before enabling setup and before confirming the binding. The app does not receive a live sharing-policy attestation and cannot detect policy changes from the user header. Do not use the lookup on a public/shared deployment or behind an untrusted proxy. Never implement first-visitor ownership, copy another person's ID or use a service credential as a user identity. Follow the concrete [first-install sequence](docs/sites-deployment.md#first-installation-obtain-your-own-site-identity), including explicit runtime-configuration confirmation and closing setup afterward.

Setup output is private and non-cacheable. Do not log, publish or place its ID in URLs; no password, service token, email or snapshot is returned. Local tests verify the application contract, not the live platform's identity injection or access policy.

## CI

The workflow needs only `contents: read`; checkout does not retain write credentials. It has no `pull_request_target`, repository write permissions, secret inputs, production deployment, paid larger runners, cache or artifact upload.
