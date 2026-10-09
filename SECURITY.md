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

## CI

The workflow needs only `contents: read`; checkout does not retain write credentials. It has no `pull_request_target`, repository write permissions, secret inputs, production deployment, paid larger runners, cache or artifact upload.
