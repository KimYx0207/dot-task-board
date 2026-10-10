# Changelog

[English](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md)

## 0.2.0 — 2026-10-10

- Bring project progress, task owners, blockers and evidence into one view, with explicit stale observations and archived cancellation history.
- Edit existing goals, acceptance criteria and sources; retain versioned request receipts, manual status and configurable queue ordering.
- Add native task result notes linked to a saved requirement revision, with source references, idempotent saves and stable editor state across refreshes.
- Provide an existing-request session client for host-tool dispatch and result readback. Scheduled continuation uses the host's supported tools; queue execution requires a connected adapter, real user permission and verified original-task bindings.
- Simplify bilingual release guidance and retain the account-specific setup steps in the deployment and integration guides.

## 0.2.0-rc.1 — 2026-10-09 (source prerelease)

### 2026-10-09 — existing requirements and accurate loading labels

- Show existing goals/acceptance separately from new form feedback; add source-backed, incremental requirement editing with independent versions and idempotent readback on owner-private Sites. Local previews do not claim write support.
- Append only the requirements schema, preserving original identities, status, execution controls and history; distinguish reading from saving in status labels.
- Publish no maintainer task-ID exceptions; historical labels depend on observation age. Full automatic dispatch and real external callbacks remain unverified.

### 2026-10-09 — honest status views and bounded continuation acceptance

- Separate active business records from archived cancellation history without deleting source identities.
- Show stale or missing observations explicitly; mark the board's old imported version and totals as historical rather than current deployment statistics.
- Clarify the inbox's narrow lifecycle scope: an empty inbox does not mean every project is finished.
- Document a naturally scheduled native online continuation followed by a no-repeat check. Preserve the distinction from local automatic dispatch and the cloud_threads request-dispatch chain, which remain unverified.
- Publish portable presentation changes and bilingual guidance; no private snapshots, account mappings, deployment credentials, or changes to authorization/dispatch guards.

### First-install Site identity lookup

- Fix the first-install dependency loop: add a disabled-by-default, read-only `/setup` page and `/api/setup/identity` endpoint for authenticated Sites requests.
- Keep every business route closed until the existing explicit owner binding is configured. Setup never claims a Site, writes a database or grants a role; it closes once an owner is set.
- Add 16 first-install checks across source and compiled builds: origin, method, cache, output escaping, generic-entry isolation and no storage access. Full regression: 668 passing tests; the additional compiled-boundary suite remains 18 checks.
- Document the concrete management check, owner browser login, confirmed runtime binding and redeployment sequence. No automatic owner enrollment, live deployment or identity configuration is performed by this source update.

### Reader-focused setup documentation

- Keep the README focused on what the board does, a complete request to give your own dot, account requirements and the four public author links.
- Keep runtime commands, hosting internals, identity configuration and schema details in the existing installation/deployment/developer guides.
- Correct outdated integration instructions: use complete host-specific migrations, supply snapshot JSON contents, distinguish the current Sites Events boundary and document existing-thread/manual-authorization behavior accurately.
- Remove duplicate setup/build instructions. Keep still-supported developer options clearly separate from the current Site path.
- Preserve the prerelease, unverified first-time deployment and automatic-execution boundaries. No application or Site behavior changes.

### Online Site deployment handoff

- Make “give the repository to your own dot, then receive your own private Site URL” the primary installation flow; local preview is optional.
- Preserve the four public author header entries: aiking.dev, X, GitHub and WeChat Official Account.
- Document the actual Sites-only entry, platform access, Site-specific owner ID, full D1 schema and private runtime configuration. A generic Worker is not the equivalent private Site.
- Add `package:sites` to stage the private bundle and all 19 required deployment files without deploying or embedding runtime data. Add three packaging regression tests.
- Validation of that source revision: 224 files and 652 passing tests; the compiled-boundary suite had 18 tests. A separate user's first real Sites deployment and browser/real-device acceptance remain unverified.

### 2026-10-09 — portable manual-status display consistency

- Keep owner-manual completion separate from observed task state, execution evidence and business acceptance.
- Use the same display state for task ordering, filters, counts, project cards and task details; retain previous blockers and next steps in collapsed history.
- Include the shared display module in local, public Worker, candidate and owner-private Sites assets.
- Retain separate public and owner-private build outputs and read-only manual-status fallback when no trusted host service is configured.

Historical validation for the earlier portable revision: Node.js 24.19.0; 219 source files; 649/649 tests passed with zero skips in the integrated source and clean archive. All three builds, compiled syntax, synthetic owner-private observation checks, managed local installation, request persistence, idempotent retries and stop/restart passed. No dependency installation is required.

At that earlier revision, browser visual and real-device acceptance were not completed because of the available preview environment; live plugin connection, native automatic execution, automatic continuation and external callback delivery had not been verified. The bounded host-continuation result above is newer and does not establish full automatic dispatch.

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


### Earlier 0.2 development work

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
