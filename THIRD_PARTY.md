# Source and dependency notes

[English](THIRD_PARTY.md) · [简体中文](THIRD_PARTY.zh-CN.md)

- The presentation, read model, validation and adapters were written for this module.
- There are no npm runtime or development dependencies. Tests use Node.js's built-in `node:test`.
- Node.js is installed separately; its binaries are not distributed here.
- The UI uses system-font fallbacks without downloading or bundling font files.
- Icons use simple text and this module's basic SVG favicon; no icon or image library is included.
- The Workbench adapter maps exported fields only. Its UI, execution engine and unlicensed implementations are not copied.
- GitHub Actions uses official `actions/checkout` and `actions/setup-node`, pinned to commit SHAs. They run in CI and are not bundled with the application.
- No third-party role definitions, core methods, prompts or capability packages are included.

Before adding third-party code or dependencies, verify provenance, license compatibility and required attribution.
