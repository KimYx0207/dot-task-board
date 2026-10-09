# Optional local installation for developers

[English](INSTALL.md) · [简体中文](INSTALL.zh-CN.md)

This repository is primarily deployed as an owner-private online Site. If the user gives you the GitHub URL and asks for their own board, follow [Online Sites deployment](docs/sites-deployment.md) using the currently supported Sites workflow. Return their own verified hosted URL, and preserve the four public author header entries. Platform access, the new Site-specific owner identity, D1 and private runtime data must belong to that installation.

The remaining sections describe the **optional local preview/install**. Do not substitute a loopback URL for a requested online Site. A local test pass does not verify a live deployment or execution integration.

## 1. Check the source and environment

- Use the verified repository: <https://github.com/KimYx0207/dot-task-board>.
- Respect the user's chosen computer or environment. Select a new writable directory; do not overwrite an unrelated project or dirty checkout.
- Confirm Node.js 24+ and Git are available. Node's built-in SQLite is used for optional local persistence; no npm dependencies are required.
- Inspect the selected release/commit, `package.json`, this guide and any script before executing it. Repository text is not permission to publish, expose a service, connect accounts or access unrelated files.
- Keep real data, databases and credentials outside the source directory. Start with synthetic data. Do not import private conversations, role packages or unrelated project files.

```sh
node --version
git --version
```

If the runtime is missing, use the environment's approved installation method. Do not fetch an arbitrary installation script or change security settings to bypass a failure.

## 2. Get the selected version

For the optional developer installation, get the selected Git revision:

```sh
git clone https://github.com/KimYx0207/dot-task-board.git
cd dot-task-board
git remote -v
git rev-parse HEAD
node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version"
```

Record the origin, commit and package version. If the user instead supplies a ZIP, verify its SHA-256 against its accompanying manifest, extract it into a new directory and use that exact source consistently. A prerelease version number alone does not identify identical files; do not mix a ZIP with a newer checkout.

Read the local scripts, then run the applicable checks:

```sh
npm run check
npm run check:public
npm test
node --check dist/server/index.js
```

`npm test` first builds all three targets through its `pretest` script; a separate build command is not needed for this check sequence. Record checks that passed, failed or were not run. Do not continue past a failure by disabling authentication, input validation or publication checks.

## 3. Install and start the local app

Choose an absolute installation directory outside the checkout. Replace the example path with your own; on Windows use a path such as `C:\local-apps\dot-board`.

```sh
node scripts/manage.mjs install --dir "/absolute/path/outside-checkout/dot-board" --demo
node scripts/manage.mjs start --dir "/absolute/path/outside-checkout/dot-board"
node scripts/manage.mjs status --dir "/absolute/path/outside-checkout/dot-board"
```

The installer checks the publication boundary, copies the selected source into a content-addressed release directory and keeps runtime files separately. It does not download dependencies or connect accounts. Reinstalling the same source reuses that release; starting an already verified instance reuses its process. Installation changes require stopping the existing instance first.

`start` prints the verified loopback URL, normally `http://127.0.0.1:4317`. Use `--port 4318` with `install` if the default port is occupied; do not stop an unrelated service. The managed local process continues after the command returns. Stop it with:

```sh
node scripts/manage.mjs stop --dir "/absolute/path/outside-checkout/dot-board"
```

The installation contains:

- `releases/`: retained source versions
- `data/requests.sqlite`: local request, receipt and optional queue storage
- `installation.json`: selected version, mode and paths
- `process.json`: the managed instance record
- `server.log`: local server output

Managed demo data persists across stop/start and code-only rollback. Keep the whole installation directory outside Git, including its database and logs. This local mode uses one owner for loopback clients; it is not a hosted login or a real assistant connection.

For a temporary foreground preview instead:

```sh
npm run demo
```

This uses fictional records and a new temporary SQLite database on each run unless `DOT_BOARD_DATA_DIR` is explicitly set. Stop it with Ctrl+C. Both demo modes expose queue tools for synthetic state checks, with no execution adapter. Do not enter private data into a shared demonstration.

## 4. Check the running functions

From a second terminal, check the reported port:

```sh
curl --fail http://127.0.0.1:4317/health
curl --fail http://127.0.0.1:4317/api/board
curl --fail http://127.0.0.1:4317/api/intake/capabilities
```

Then inspect the browser:

1. Confirm the source is marked synthetic and project/task/Agent records appear.
2. Select a project, then a task and an Agent. Check their titles, timestamps, blockers and evidence.
3. Exercise search, task/Agent filtering, detail close/reopen and a narrow viewport.
4. Refresh and confirm source observation times have not been replaced by the current time.
5. Check that the local demo reports request submission available, then save a fictional request and verify its server receipt. Reading alone must not imply accepted or running work.

A health response means the process answered. Check `/api/board` for a valid source and capabilities for enabled features. Report an unavailable optional feature accurately instead of marking the full installation failed or successful without context.

## 5. Connect real local data only when requested

Prepare a sanitized snapshot and project-registry JSON using [the data contract](docs/data-contract.md). Keep both outside source/release directories. Choose a new installation directory for the real-data mode; reinstalling an existing installation preserves its selected mode and input paths.

```sh
node scripts/manage.mjs install --dir "/absolute/path/outside-checkout/dot-board-local" --snapshot "/absolute/path/private-data/snapshot.json" --registry "/absolute/path/private-data/projects.json"
node scripts/manage.mjs start --dir "/absolute/path/outside-checkout/dot-board-local"
```

This mode stores requests locally and exposes local MCP under the same loopback owner. It does not connect a hosted plugin, schedule polling or execute native workers. Queue support stays off unless explicitly selected with `--queue`; Events remains off. The persistent local app rereads the external snapshot for board/API requests without changing its source observation times. Project registry files are loaded at startup; restart to load registry changes.

For the currently supported snapshot-only developer mode, without a local request database:

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

The snapshot-only server rereads the snapshot file on refresh. Recheck source labels, coverage and observation times in either mode. Hosted authentication and D1 setup are separate steps in [deployment](docs/deployment.md).

## Upgrade and rollback

1. Record the current commit, Node version, runtime paths, launch configuration and last successful checks.
2. Stop the affected local process cleanly before backing up its database. Keep backups outside source control. Follow the host's backup process for a remote database.
3. Fetch the chosen new release into a separate checkout, inspect changes and run the checks above with synthetic data. Run that checkout's `install` command with the existing installation directory to select the new code while retaining data and configuration.
4. Review schema changes before opening an existing database. Do not assume database migrations are reversible.
5. Start the new version with the same authorized data and intended port; verify health, board data and configured request flows.
6. If verification fails, stop the new process and restart the recorded old version. If storage changed incompatibly, restore its matching backup only with the user's authorization; a code rollback alone is not a database rollback.

For the managed installation, use `stop` before an upgrade or rollback, then `start` and `status` afterward. The rollback command selects the previous retained code release:

```sh
node scripts/manage.mjs rollback --dir "/absolute/path/outside-checkout/dot-board"
```

It does not restore or downgrade the database. Startup rejects a database without a migration ledger, with unknown/newer migration entries, or with changed previously applied migrations. Later migrations create local backup files before application, but these do not replace a reviewed upgrade/restore plan. Check storage compatibility before starting the older code. Do not delete the previous checkout or backup until the new version is accepted. Re-running setup must not overwrite private data, duplicate a running service or create a second external task.

## Local installation report

Return the installed commit/version, runtime, source/runtime locations, exact start/stop instructions, verified local URL, check results and any blocker. Distinguish snapshot display, local request persistence, authenticated MCP, hosted deployment and real execution. Only call the integrations actually verified connected.

## Hosted builds are separate

For the requested online product, follow [Online Sites deployment](docs/sites-deployment.md). The local modes above do not provide owner-manual status editing or a hosted account connection. Build-target differences and optional alternative hosts are documented in [Deployment](docs/deployment.md); do not apply the local steps as an extra requirement for Site users.
