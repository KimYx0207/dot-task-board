# Security

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## Supported versions

The maintained line is `0.1.x`. This is a read-only snapshot viewer, not a security-isolated agent execution environment.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting entry if it is available for this repository. If it is not enabled, open an issue containing only a request for a private security contact channel. Never put exploit details, real snapshots, account information, credentials or private logs in a public issue.

Ordinary interface bugs can be reported publicly with synthetic reproductions. No response-time commitment is implied.

## Trust boundaries

- A trusted host must explicitly export and sanitize the input.
- Field allowlists, length limits, URL filtering and `textContent` rendering are defensive measures, not a complete sanitization guarantee.
- The Node server listens only on loopback and rejects non-loopback Host values. Do not expose it directly to the internet.
- The Worker relies on its host for authentication and authorization. Before using real data, verify that signed-out visitors cannot read it; hidden navigation is insufficient.
- Deployment configuration, runtime values and snapshots are not public source.
- Security fixes must preserve unknown, stale and error states rather than fabricate success.

## CI

The workflow needs only `contents: read`; checkout does not retain write credentials. It has no `pull_request_target`, repository write permissions, secret inputs, production deployment, paid larger runners, cache or artifact upload.
