<div align="center">

<img src="public/board-team.png" alt="The dot task board team" width="360">

# dot task board

**See each project's tasks, agents, blockers and latest evidence in one place.**

[English](README.md) · [简体中文](README.zh-CN.md)

[Quick start](#try-it-in-3-steps) · [Deploy with your dot](docs/sites-deployment.md) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)

</div>

**Give this repository to your own dot to deploy your own private online Site.** The source includes the hosted dashboard, owner-manual status, requests, queue and observation services. Sites platform access and your own identity/data setup are required; native automatic execution and continuation remain unverified.

## Start here

When several agents work across projects, you need more than a task list: what belongs to each project, who is working on it, what is blocked, and when that status was actually observed.

**dot task board is a project-first dashboard for explicitly exported task and Agent records.** Its primary interface is an online, owner-private Site that you open in a browser. Node.js is a build/development requirement, not something viewers must run. Optional authenticated request intake keeps saved requests, read acknowledgements and progress receipts separate from the snapshot.

| Your question | What the board shows |
| --- | --- |
| What is happening in this project? | Tasks and their recorded Agent associations on one canvas |
| Who owns the work? | Observed agents, responsibilities and explicit parent-child relationships |
| Why did work stop? | Recorded blockers, waiting states and next actions |
| What was delivered? | Results and evidence links, with deployment and acceptance shown separately |
| How current is this? | Source observation times, stale records and unknown coverage |
| Was my request received? | A durable receipt, followed by separate read and progress events when intake is configured |

### What you get

- A project-first canvas, project navigation, task/Agent filters, search and detail panels
- Six generated role portraits, with a stable-ID visual fallback when a role is unverified
- A versioned JSON contract, a standalone Node server and a portable Worker adapter
- An optional read-only Workbench export mapper
- Optional persistent request intake and authenticated MCP tools for reading and recording progress
- Managed local install/start/status/stop/code-rollback commands, with user data stored outside the source
- Consistent owner-manual display states, counts, filters and collapsed history without rewriting observed evidence
- An experimental bounded queue and Events integration, disabled in the normal runtime by default
- Synthetic examples, privacy checks and regression tests

The interface currently uses Chinese labels. English and Simplified Chinese documentation are separate; an English UI switch is not implemented. Portraits are illustrations, not proof of an Agent's identity, role or availability.

### Try it in 3 steps

1. Send `https://github.com/KimYx0207/dot-task-board` to your own dot.
2. Ask it to create **your own owner-private online Site** using the instructions below. Complete any platform access or account confirmations it genuinely needs.
3. After dot confirms the new Site deployed and its owner-only checks passed, open your new hosted URL. Begin with synthetic data, then connect only your own authorized records.

Copy this request to your dot:

> Read https://github.com/KimYx0207/dot-task-board and its docs/sites-deployment.md. Use your currently supported Sites build/deploy workflow to create my own owner-private online task board. Preserve the author's four public header entries: aiking.dev, X @KimYx0207, GitHub KimYx0207, and the WeChat Official Account 老金带你玩AI. Keep my identity, project data, thread mappings and credentials private. Use the Sites-specific build, complete D1 schema and my new Site's trusted owner identity. Start with synthetic data, verify deployment and owner access, and give me my own Site URL. If platform access or the Site-specific identity setup is unavailable, tell me exactly what is missing. Do not present a local preview or an unverified execution integration as a completed online installation.

The repository cannot grant platform access or copy another person's private account. This new-account workflow has a verified build/packaging contract; an independent user's complete live deployment has not yet been tested. See [the exact deployment requirements and remaining boundary](docs/sites-deployment.md).

### Optional local preview for developers

If you only want to inspect the UI locally, use Node.js 24+; no `npm install` is needed:

```sh
git clone https://github.com/KimYx0207/dot-task-board.git
cd dot-task-board
npm run demo
```

The printed `http://127.0.0.1:4317` address is a temporary local demo, not your new hosted Site. It uses fictional records, starts no real agents and does not connect accounts. For local snapshot input, `DOT_BOARD_SNAPSHOT_PATH=/absolute/private/snapshot.json npm start` remains available. Details, including persistent local setup and PowerShell commands, are in [INSTALL.md](INSTALL.md).

## Current scope

| Capability | Status and boundary |
| --- | --- |
| Project, task and Agent views | Available from supplied snapshots; refresh does not collect new observations |
| Source freshness and evidence | Available; a completion record is separate from deployment or business acceptance |
| Request intake and MCP receipts | Optional; requires storage, project IDs and a verified authentication boundary |
| Manual task status | An authenticated host may provide editing; plain/local installs show status read-only. Manual completion remains separate from observed execution and acceptance |
| Native host adapters | Source interfaces and synthetic contract tests are included; an authorized real host still needs configuration and end-to-end acceptance |
| Finite dispatch queue | Experimental and off by default; claims and records work but does not provide a native executor |
| Events and webhook delivery | Experimental and off by default; requires a separately supplied, authorized transport |
| Native scheduling, plugin connection and external callbacks | Not established by running this repository or passing local tests |

Saving a browser request does not start, resume, cancel or preempt a native worker. A host integration must perform authorized execution separately and report what actually happened. A stale running observation is not evidence that an Agent is still running.

### Verification of this source revision

On 2026-10-09, Node.js 24.19.0 passed all **652 tests**, with zero failures or skips, both in the integrated source and a clean portable-archive extraction. All 224 source-file checksums matched. The public, candidate and owner-private builds, compiled syntax, and synthetic owner-private observation checks passed. A clean managed local install verified static asset loading, request persistence, idempotent retries, stop and restart.

Browser visual acceptance and real-device acceptance for this revision were not completed because the available preview environment could not serve the local candidate to its browser. Automated UI-contract tests are not a substitute. Live plugin connection, native automatic execution, automatic continuation and real external callback delivery remain unverified.

## Documentation

| Read next | Purpose |
| --- | --- |
| [Online Sites deployment](docs/sites-deployment.md) | Give the repository to your dot; deploy your own owner-private Site |
| [Architecture](docs/architecture.md) | Components, responsibilities and trust boundaries |
| [Data contract and HTTP API](docs/data-contract.md) | Snapshot fields, project IDs, routes and MCP tools |
| [Installation](INSTALL.md) · [Deployment](docs/deployment.md) | Local runtime, optional Worker/D1 hosting and access control |
| [Optional integrations](docs/integrations.md) | Request lifecycle, finite queue, host adapter and experimental Events |
| [Contributing](CONTRIBUTING.md) | Development and verification expectations |
| [Security](SECURITY.md) | Reporting and privacy boundaries |
| [Changelog](CHANGELOG.md) | Version history |
| [Source and dependencies](THIRD_PARTY.md) | Code, artwork and dependency provenance |

## Development

```sh
npm run check
npm run check:public
npm run build
npm test
node --check dist/server/index.js
```

Tests cover snapshot validation, relationships, freshness, project grouping, request persistence, owner isolation, idempotence and queue transitions. Documentation checks validate language entry points and local links. Passing local checks does not establish a real plugin connection, external callback delivery, native scheduling or real-phone acceptance.

The [CI workflow](.github/workflows/ci.yml) uses standard public Ubuntu runners and read-only repository permissions. It does not deploy, publish packages or upload build artifacts. Private-repository runs are skipped; local checks remain available. Hosting and provider usage are separate operator choices with their own limits and charges.

<details>
<summary><strong>Source layout</strong></summary>

| Path | Responsibility |
| --- | --- |
| `config/` | Presentation labels, states and stale thresholds |
| `src/domain/` | Snapshot, request, queue and event validation |
| `src/application/` | Read model, intake, queue transitions and optional host contract |
| `src/adapters/` | Snapshot, Workbench and persistence adapters |
| `src/presentation/` | HTTP and MCP request handling |
| `public/` | Canvas, filters, detail panels and role artwork |
| `server.mjs`, `worker.mjs` | Node and Worker entry points |
| `examples/`, `fixtures/`, `tests/` | Synthetic data and regression checks |

</details>

## Security and privacy

The Node server is for loopback use. The Worker is not an account system: the host must authenticate and authorize the whole UI and every data route before private data is used. An identity header is trusted only when a verified host strips client-supplied values and sets it after authentication. Keep real snapshots, request databases, credentials and deployment identities outside public source. Read the [security policy](SECURITY.md) before connecting private data.

## Contact

![Author contact: WeChat Official Account and personal WeChat QR codes](docs/images/contact-qr.png)

[GitHub: KimYx0207](https://github.com/KimYx0207) · [X: @KimYx0207](https://x.com/KimYx0207) · [Website: aiking.dev](https://www.aiking.dev/)

- WeChat Official Account: **老金带你玩AI**
- Personal WeChat: scan the personal WeChat QR code in the contact image and include “AI” in the request to join the group
- [Feishu knowledge base: long-term updates](https://my.feishu.cn/wiki/OhQ8wqntFihcI1kWVDlcNdpznFf)

These are the maintainer's existing public contact channels, reproduced from [Meta_Kim's contact section](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/README.md#contact).

### Bugs and security reports

For ordinary bugs, use [Issues](https://github.com/KimYx0207/dot-task-board/issues) with a synthetic reproduction. For vulnerabilities, follow [SECURITY.md](SECURITY.md); do not send exploit details or private data to a public issue or group.

## License

[MIT](LICENSE) · Copyright (c) 2026 KimYx0207

## Build targets and manual status

`npm run build` produces the portable public Worker at `dist/server/index.js`; `npm run build:sites` produces the owner-private host adapter at `dist/sites/index.js`; `npm run build:candidate` produces `dist/candidate/index.js`. The outputs do not overwrite each other. The Sites adapter still requires trusted ingress, owner and audience enforcement.

Plain Worker and loopback/local installs do not provide a trusted manual-status service. They show task status read-only and reject manual-status writes. Quick edits and notes are enabled only when the host supplies the authenticated service. Request intake and queue records do not prove live native execution or automatic continuation.
