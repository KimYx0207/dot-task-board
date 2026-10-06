# Contributing

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Contributions that fix bugs, improve adapters, clarify the interface or strengthen tests are welcome.

## Before changing files

1. Read the [README](README.md) and [data contract](docs/data-contract.md).
2. Reproduce behavior changes with synthetic data first.
3. Preserve presentation, application, domain and adapter boundaries. Do not implement task scheduling in the UI.
4. Keep each commit and pull request focused. Explain the problem, change, verification and remaining limits.

## Local checks

Use Node.js 22 or newer. No dependency installation is needed.

```sh
npm run check
npm run check:public
npm test
npm run build
```

For UI changes, check narrow screens, keyboard access, long text, empty data, unknown states, failed refreshes and preserved expanded details. State which checks ran and which did not.

## Data and compatibility

- Commit only genuinely synthetic, publishable data. Renaming real task records is not sufficient.
- A new schema needs a version, compatibility policy and explicit failure behavior.
- Parent-child relationships must come from input records. Project grouping does not establish parentage.
- Without observed agents, keep the roster empty or unknown. Role labels do not create identities.
- Adapters transform input only. They must not collect credentials, access accounts or control tasks.

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
