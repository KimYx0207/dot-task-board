# Source and dependency notes

[English](THIRD_PARTY.md) · [简体中文](THIRD_PARTY.zh-CN.md)

- The presentation, read model, validation and adapters were written for this module.
- There are no npm runtime or development dependencies. Tests use Node.js's built-in `node:test`.
- Node.js 24+ is installed separately; its binaries are not distributed here. Optional local persistence uses Node's built-in SQLite support.
- D1 hosting and provider tooling are optional operator choices, not npm runtime dependencies. Checked-in SQL does not require a schema generator.
- The UI uses system-font fallbacks without downloading or bundling font files.
- Four embedded Tabler SVG accessories (skull, clipboard-text, flask and check) are MIT-licensed, copyright 2020–2026 Paweł Kuna. The complete license, source URLs and original blob IDs are retained in `public/collaboration-graph.js`; no runtime icon dependency is installed.
- The eight-character team banner in `public/board-team.png` was generated for this dashboard and is decorative artwork.
- The six illustrated role portraits in `public/dot-agent-roles.png` were generated for this dashboard. They are decorative role imagery, not photos or verified identities.
- The Workbench adapter maps exported fields only. Its UI, execution engine and unlicensed implementations are not copied.
- GitHub Actions uses official `actions/checkout` and `actions/setup-node`, pinned to commit SHAs. They run in CI and are not bundled with the application.
- The author contact image is reused unchanged from the maintainer's [public Meta_Kim contact asset](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/docs/images/contact-qr.png). It is a documentation asset, not an application dependency.
- No third-party role definitions, core methods, prompts or capability packages are included.

Before adding third-party code or dependencies, verify provenance, license compatibility and required attribution.

- The public UI uses project-owned CSS/SVG circle geometry rather than an embedded OpenAI logo path. OpenAI, GitHub, X and WeChat names/marks belong to their respective owners; repository MIT terms do not grant rights to those marks or imply endorsement.
