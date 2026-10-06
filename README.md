<div align="center">

# dot task board

**See who is working, what is blocked, and what was delivered.**

[English](README.md) · [简体中文](README.zh-CN.md)

[Quick start](#try-it-in-3-steps) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)

</div>

## Start here

When several agents work across projects, a list of tasks is not enough. You need to see who owns the work, which agents are related, what they are waiting for, and how recent that information is.

**dot task board turns an explicitly exported status snapshot into an Agent-first dashboard.** It runs independently with Node.js and has no third-party runtime dependencies.

| Your question | What the board shows |
| --- | --- |
| Who is doing the work? | Observed agents, their responsibilities and linked tasks |
| Which agent created which subagent? | Explicit parent-child relationships, separate from project grouping |
| Why did work stop? | Recorded blockers, waiting states and next actions |
| What has actually been delivered? | Latest results and evidence links, separate from deployment and acceptance |
| Can I trust this status? | Observation times, stale records and unknown coverage |

### What you get

- An Agent-first overview, project filters and task details
- A versioned JSON contract for connecting your own exports
- A standalone local server and a portable Worker adapter
- An optional Workbench export mapper that does not require Workbench to run
- Synthetic examples, privacy checks and regression tests

The current interface uses Chinese labels. These documents are available separately in English and Simplified Chinese; an English interface switch is not implemented.

### Try it in 3 steps

Requires **Node.js 22 or newer**. No `npm install` is needed.

1. Get the source:

   ```sh
   git clone https://github.com/KimYx0207/dot-task-board.git
   cd dot-task-board
   ```

2. Start the synthetic demo:

   ```sh
   npm run demo
   ```

3. Open `http://127.0.0.1:4317`, or the address printed in the terminal. Select an agent to inspect its tasks, recent result and recorded relationships.

The demo contains fictional records. It does not connect an account or start real agents.

### Connect your own data

Prepare a sanitized snapshot using the [example](examples/synthetic-snapshot.json) and [data contract](docs/data-contract.md). Keep real data outside this repository.

macOS / Linux:

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

PowerShell:

```powershell
$env:DOT_BOARD_SNAPSHOT_PATH = 'C:\private-data\snapshot.json'
npm start
```

The server listens on `127.0.0.1`. Set `DOT_BOARD_PORT` to change the default port `4317`. Without an input source, the board shows that no feed is connected; it does not silently use demo data. [`.env.example`](.env.example) describes the options; `.env` files are not loaded automatically.

## Current scope

This version reads snapshots provided by an external host. Refresh rereads the supplied snapshot; it cannot discover new activity until the exporter provides new observations.

| Available now | Outside the current release |
| --- | --- |
| Observed agent relationships and task status | Native agent discovery or orchestration |
| Freshness, blockers and evidence links | Automatic real-time event collection |
| Read-only Node and Worker endpoints | Project submission, task execution or pause/resume controls |
| Optional exported-task mapping | Direct access to Workbench sessions or private conversations |

A completed agent result does not automatically mean the project is deployed or accepted. Missing evidence stays unknown.

## Documentation

| Read next | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Layer boundaries and responsibility |
| [Data contract and HTTP API](docs/data-contract.md) | Input fields, compatibility and routes |
| [Deployment](docs/deployment.md) | Runtime data, access control and refresh behavior |
| [Contributing](CONTRIBUTING.md) | Development and verification expectations |
| [Security](SECURITY.md) | Reporting and trust boundaries |
| [Changelog](CHANGELOG.md) | Version history |
| [Source and dependencies](THIRD_PARTY.md) | Provenance and dependency policy |

## Development

```sh
npm run check
npm run check:public
npm test
npm run build
node --check dist/server/index.js
```

Tests cover input contracts, observed relationships, stale counts, privacy boundaries, read-only HTTP, export mapping and Worker dispatch. The documentation checks validate language entry points and local links. Automated checks do not establish real-phone visual acceptance or a particular host integration.

CI uses Node.js 22/24 on standard public Ubuntu runners with read-only permissions. It does not deploy, publish packages or upload build artifacts. Private-repository runs are skipped; local checks remain available. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

<details>
<summary><strong>Source layout</strong></summary>

| Path | Responsibility |
| --- | --- |
| `config/` | Presentation labels, states and stale thresholds |
| `src/domain/` | Versioned inputs, allowlists and relationship validation |
| `src/application/` | Read model, freshness and scoped counts |
| `src/adapters/` | Snapshot and optional Workbench export adapters |
| `public/` | Overview, filters and detail views |
| `server.mjs`, `worker.mjs` | Node and Worker runtime entry points |
| `examples/`, `fixtures/`, `tests/` | Synthetic data and regression checks |

</details>

## Security and privacy

The Node server is local-only. The Worker has no built-in account system: a deployment host must authenticate and authorize access to both the UI and API before real data is used. Keep real tasks, conversations, credentials and deployment identity outside the public source. Read the [security policy](SECURITY.md) before connecting private data.

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
