<div align="center">

<img src="public/board-team.png" alt="The dot task board team" width="360">

# dot task board

**See each project's tasks, agents, blockers and latest evidence in one place.**

[English](README.md) · [简体中文](README.zh-CN.md)

[Get started](#try-it-in-3-steps) · [Setup guide for your dot](docs/sites-deployment.md) · [MIT](LICENSE)

</div>

## Start here

**Give this GitHub repository to your own dot and ask it to deploy your own private online task board.** Once setup and access checks are complete, dot gives you a Site URL to open in your browser. You do not need to run development commands yourself.

The board helps you see:

- Each project's tasks and associated agents
- Recorded progress, blockers, next steps and evidence links
- Search, filters and task details in one workspace
- Your manual status changes and notes when configured
- Saved requests and separate read/progress receipts when connected

It displays records you authorize it to use. It does not automatically obtain every conversation or turn a saved request into an executing agent. The interface currently uses Chinese labels.

### Try it in 3 steps

1. Send `https://github.com/KimYx0207/dot-task-board` to your own dot.
2. Paste the request below. Complete any platform access or account confirmations it genuinely needs.
3. After dot verifies your new Site and its private access, open the URL it gives you. Start with sample data, then connect your own authorized records.

**Copy this request to your dot:**

> Read https://github.com/KimYx0207/dot-task-board and its docs/sites-deployment.md. Use your currently supported Sites build and deployment workflow to create my own private online task board, accessible only to me. Preserve the author's four public header entries: personal website aiking.dev, X @KimYx0207, GitHub KimYx0207, and the WeChat Official Account 老金带你玩AI. Use only my account and records I authorize; keep my identity, project data, conversation mappings and credentials private. Follow the complete deployment and access setup guide, including its read-only first-install identity page. Guide me through signing in and confirming my own Site configuration; do not ask me to guess an account ID. Begin with sample data, verify the deployed page and owner-only access, and then give me my own Site URL with a short account of what works and what still needs setup. If a required platform feature or permission is unavailable, explain the exact missing step. Do not describe a local preview or unverified automatic execution as a completed online installation.

### What you need

- Your dot and account must support creating and hosting a private Site, including the storage and connected tools described in the [setup guide](docs/sites-deployment.md).
- You may need to confirm account access or deployment actions. The repository cannot grant platform features or permissions for you.
- Your copy starts with sample data. The original author's private projects, conversations and account are not included.

This is a prerelease. The build and packaging path has been checked, but a separate user's complete first-time online deployment has not yet been tested. Setup may require steps specific to that user's account.

### Latest update: clear status and verified online continuation

1. See projects, tasks, associated agents, blockers and evidence together. Canceled history stays in the archive; old or missing observations are marked explicitly.
2. Save requests with separate read/progress receipts, and drag already-queued tasks into order when the optional queue is configured.
3. Connect an explicitly authorized dot scheduled check to continue the original online task. The maintainer verified a natural scheduled wake, real work, result readback, and a later scheduled check that did not repeat the completed step.

The third item is a **verified host workflow**, not a scheduler installed by this repository. Your own dot needs the supported scheduling, original-task access and execution tools. Follow the [continuation setup and acceptance steps](docs/integrations.md#scheduled-dot-continuation).

**Local automatic dispatch, the cloud-thread request-dispatch chain, and real external callbacks remain unverified.** A saved request, a running-turn receipt or one completed substep does not prove that every task is finished. The release preserves the existing execution controls and does not import the maintainer's private account, task data or schedule.

Automated checks and the exact revision are available in [CI](https://github.com/KimYx0207/dot-task-board/actions). A separate user's full first-time setup and real-device acceptance remain incomplete. See the [deployment checklist](docs/sites-deployment.md#5-accept-the-new-online-installation).

### Keep existing requirements visible

Existing goals and acceptance criteria are shown separately from new form feedback; an empty inbox does not mean there are no task requirements. Owner-private Sites with the complete schema can edit these fields and source references on the original task, using independent versions and idempotent saves while preserving task identity, status and controls. Default local previews remain view-only. See the [requirements interface and boundaries](docs/integrations.md#existing-task-requirements). Descriptions never start execution.

## The four public author links

The board keeps these four header entries:

- [Personal website: aiking.dev](https://www.aiking.dev/)
- [X: @KimYx0207](https://x.com/KimYx0207)
- [GitHub: KimYx0207](https://github.com/KimYx0207)
- WeChat Official Account: **老金带你玩AI**

## Documentation

For everyday use, start with the copyable request above. Your dot can follow the deployment guide; implementation and developer instructions are kept in the linked documents.

| Document | Purpose |
| --- | --- |
| [Online Site setup](docs/sites-deployment.md) | Deploy and verify your own private online board |
| [Installation](INSTALL.md) | Optional developer preview and local installation |
| [Deployment](docs/deployment.md) | Hosting and access-control implementation |
| [Architecture](docs/architecture.md) | Application components and boundaries |
| [Data contract and API](docs/data-contract.md) | Data formats and service interfaces |
| [Optional integrations](docs/integrations.md) | Request receipts and execution integration limits |
| [Contributing](CONTRIBUTING.md) | Development commands and testing expectations |
| [Security](SECURITY.md) | Privacy and vulnerability reporting |
| [Changelog](CHANGELOG.md) | Release history |
| [Source and dependencies](THIRD_PARTY.md) | Code and artwork provenance |

## Contact

![Author contact: WeChat Official Account and personal WeChat QR codes](docs/images/contact-qr.png)

- WeChat Official Account: **老金带你玩AI**
- Personal WeChat: scan the personal WeChat QR code in the contact image and include “AI” in the request to join the group
- [Feishu knowledge base: long-term updates](https://my.feishu.cn/wiki/OhQ8wqntFihcI1kWVDlcNdpznFf)

These are the maintainer's existing public contact channels, reproduced from [Meta_Kim's contact section](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/README.md#contact).

For ordinary bugs, use [Issues](https://github.com/KimYx0207/dot-task-board/issues) with sample data. For vulnerabilities, follow [SECURITY.md](SECURITY.md); do not post private data or exploit details publicly.

## License

[MIT](LICENSE) · Copyright (c) 2026 KimYx0207
