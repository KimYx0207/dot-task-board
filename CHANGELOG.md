# Changelog

[English](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md)

## 0.2.0-rc.1 — 2026-10-09 (source prerelease)

### 2026-10-09 — portable manual-status display consistency

- Keep owner-manual completion separate from observed task state, execution evidence and business acceptance.
- Use the same display state for task ordering, filters, counts, project cards and task details; retain previous blockers and next steps in collapsed history.
- Include the shared display module in local, public Worker, candidate and owner-private Sites assets.
- Retain separate public and owner-private build outputs and read-only manual-status fallback when no trusted host service is configured.

Validation: Node.js 24.19.0; 219 source files; 649/649 tests passed with zero skips in the integrated source and clean archive. All three builds, compiled syntax, synthetic owner-private observation checks, managed local installation, request persistence, idempotent retries and stop/restart passed. No dependency installation is required.

This is still a prerelease. Browser visual and real-device acceptance were not completed because of the available preview environment. Live plugin connection, native automatic execution, automatic continuation and real external callback delivery remain unverified.

- Separate public, candidate and owner-private build outputs; include all loopback static assets and the exact structural schema chain.
- Gate manual status edits on a trusted host service; retain read-only status on unsupported installs.
- Keep the automatic-wakeup limitation visible after project changes; make relay security tests self-contained at the signed HTTP boundary.

### 2026-10-08 — compact workspace and quick manual status

- Place the eight-character team artwork beside the top navigation’s dot task board brand; reuse the artwork at the top of both READMEs.
- Add the author’s aiking.dev homepage alongside X, GitHub and the WeChat account name, with equal hit targets and optically aligned icon sizes.
- Change task status directly from its badge, with version checks, owner-manual attribution, locked-state guards and recoverable conflict or uncertain-save feedback.
- Retain existing owner notes on quick status changes and restore keyboard focus after a save without interrupting another control.
- Keep search visible with a clear action, compact the empty inbox, and open the existing request composer near the heading with sensible focus and draft preservation.

These are presentation and existing manual-status improvements. They do not start native workers, reopen paused/canceled execution, or establish end-to-end automatic continuation.


- Make projects the main navigation and show project tasks and associated Agents on one canvas.
- Add task/Agent filters, search, detail panels and six generated portraits with stable-ID visual fallback.
- Preserve observed timestamps, stale/unknown states, bounded coverage and separate completion/acceptance evidence.
- Add independent project IDs and optional authenticated persistent request intake with explicit read and progress receipts.
- Add owner-scoped MCP tools, idempotent saves/events and version-conflict handling.
- Add an experimental finite queue with atomic claims, original thread/environment binding, safe checkpoints and conservative uncertain-result handling.
- Add experimental Events subscriptions and a durable outbox behind an explicit flag and injected transport.
- Add dependency-free Node.js 24+ SQLite persistence and managed install/start/status/stop/code-rollback commands with retained user data.
- Provide bilingual installation and integration guidance while preserving the existing public author contacts.

Queueing, Events and the host execution contract do not establish a native scheduler or a live external connection. Browser requests do not automatically start workers. This candidate does not claim verified real-phone, plugin or live webhook end-to-end acceptance.

## 0.1.0 — 2026-10-06

- Publish a standalone, read-only Agent and task board.
- Show explicit main-agent/subagent relationships and project grouping.
- Support v2 snapshots while remaining compatible with v1 task snapshots.
- Separate activity observations, results, deployment and business acceptance.
- Provide Node, Worker and Workbench export adapters.
- Add stale/unknown states, safe input validation, synthetic examples and regression tests.
- Release under MIT with contribution, security and deployment guidance.

The 0.1.0 release did not include automatic native-agent integration, a real-time event feed, task controls or public runtime data.
