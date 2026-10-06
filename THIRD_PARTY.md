# Source and dependency notes

[English](THIRD_PARTY.md) · [简体中文](THIRD_PARTY.zh-CN.md)

- The presentation, read model, validation and adapters were written for this module.
- There are no npm runtime or development dependencies. Tests use Node.js's built-in `node:test`.
- Node.js is installed separately; its binaries are not distributed here.
- The UI uses system-font fallbacks without downloading or bundling font files.
- Icons use simple text and this module's basic SVG favicon; no icon or image library is included.
- The Workbench adapter maps exported fields only. Its UI, execution engine and unlicensed implementations are not copied.
- GitHub Actions uses official `actions/checkout` and `actions/setup-node`, pinned to commit SHAs. They run in CI and are not bundled with the application.
- The author contact image is reused unchanged from the maintainer's [public Meta_Kim contact asset](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/docs/images/contact-qr.png). It is a documentation asset, not an application dependency.
- No third-party role definitions, core methods, prompts or capability packages are included.

Before adding third-party code or dependencies, verify provenance, license compatibility and required attribution.
