# Contributing

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Contributions that fix bugs, improve adapters, clarify the interface or strengthen tests are welcome.

## Before changing files

1. Read the [README](README.md) and [data contract](docs/data-contract.md).
2. Reproduce behavior changes with synthetic data first.
3. Preserve presentation, application, domain and adapter boundaries. Do not implement task scheduling in the UI.
4. Keep each commit and pull request focused. Explain the problem, change, verification and remaining limits.

## Local checks

Use Node.js 24 or newer. No dependency installation is needed.

```sh
npm run check
npm run check:public
npm run build
npm test
```

For UI changes, check narrow screens, keyboard access, long text, empty data, unknown states, failed refreshes and preserved expanded details. For intake changes, check repeated submissions, uncertain save receipts, project switches, context retention and owner isolation. State which checks ran and which did not.

## Data and compatibility

- Commit only genuinely synthetic, publishable data. Renaming real task records is not sufficient.
- A new schema needs a version, compatibility policy and explicit failure behavior.
- Parent-child relationships must come from input records. Project grouping does not establish parentage.
- Without observed agents, keep the roster empty or unknown. Role labels do not create identities.
- Snapshot and Workbench adapters transform authorized input only; they do not access accounts or execute tasks.
- Optional persistence adapters must preserve owner isolation, expected versions and idempotence. Keep native execution behind an explicitly supplied host adapter.
- Request submission, read acknowledgement, acceptance and execution are separate facts. Never mark work running from a queue claim or a successful save.
- Preserve original thread/environment bindings and safe checkpoint requirements. Do not retry an uncertain external create.
- Keep queue and Events experiments disabled by default; a mock test is not live integration acceptance.

## Documentation languages

`README.md` is the English entry point; `README.zh-CN.md` is Simplified Chinese. Each has its own complete narrative and matching-language documentation links. Maintain both when capabilities or instructions change. Keep prose in one language per page; code identifiers and product names retain their original spelling.

Start with the user's questions and expected outcomes, then provide a short runnable path. Put technical detail after that. Do not present planned features as available, synthetic examples as real activity, or automated tests as production acceptance.

## Before opening a pull request

- Exclude runtime data, deployment identities, credentials, private screenshots and logs.
- Update affected documentation and tests together.
- Explain any proposed dependency, its version, purpose and license.
- Keep generated output, archives, `node_modules` and real `.env` files out of Git.
- Use the pull request template to disclose verification and unverified scope.

By contributing, you represent that you can provide the contribution under this project's MIT license. Do not copy unlicensed or restricted implementations.
