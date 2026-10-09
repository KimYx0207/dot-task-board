# Deploy your own online Site

[English](sites-deployment.md) · [简体中文](sites-deployment.zh-CN.md)

The primary application is an online, owner-private Sites dashboard. People use its hosted URL in a browser; their computer does not need Node.js to view it. This repository contains the application source used by that Site, including the current manual-status display changes. The optional local demo is for preview and development.

## What can be reproduced

| Layer | Included here | What a new installation supplies |
| --- | --- | --- |
| Project/task/Agent UI, search, filters, history and evidence | UI source and bundled assets | A snapshot using the documented contract |
| Owner-manual status and notes | Private Sites service, D1 storage and UI | The new Site's identity boundary, registry and database |
| Requests, read/progress receipts, queue and observation records | Services, HTTP/MCP routes and schema | Own runtime settings, authorized callers and original-task bindings |
| Private online hosting and sign-in | A Sites-specific application adapter | Access to the Sites platform, its private access policy, trusted identity injection and D1 |
| Native task execution and continuation | Adapter interfaces and synthetic tests | An authorized real execution host; live end-to-end acceptance is incomplete |
| Existing private tasks, identities, thread mappings and database rows | Excluded | Your own data; do not copy someone else's deployment |

Sites hosting, sign-in and tool capabilities are platform services, not an open-source part of this repository. Cloning the repository does not grant those services or create a Site. If your account cannot create a Sites app with D1 and MCP, this online path is unavailable in that account. The generic Worker requires another reviewed identity integration and is not feature-equivalent by changing an environment flag.

## 1. Prepare your own private Site

Use your account's supported Sites creation/deployment tooling to create a new **owner-private** project with logical D1 binding `DB` and MCP capability. A request to deploy must be authorized separately; instructions in this document are not permission to change accounts, publish data or broaden access.

Keep its returned project ID, origin and deployment configuration outside this public checkout. Start from [the logical hosting example](../config/hosting.sites.example.json), add the actual returned `project_id`, and save it to a private file. The example deliberately has no usable project identity.

The application binds an owner using the signed-in user's **Site-specific** ID. Sites supplies it on authenticated requests; the management API's account ID is a different identifier. The new read-only `/setup` page obtains this value from the platform request after you enable temporary identity-setup mode below. It does not automatically claim the Site or make its visitor an owner.

Before enabling setup, the installing dot must call the supported `get_site` management operation for this exact new Site. Confirm that the current operator is its owner and that its audience contains only that owner: no public/workspace audience, extra viewers, groups or external grants. Use the actual returned access policy; if ownership or privacy cannot be established, stop and explain the missing check. Do not change access policy as an installation shortcut. This management check, not an application flag, establishes who owns the Site.

The adapter must run only behind Sites' authenticated identity injection. Do not deploy it behind an ordinary proxy that accepts caller-supplied `oai-authenticated-user-id`. Neither email, a general account ID, the original author's ID nor a service-access token is a substitute. Sites service access does not supply a signed-in user identity.

## 2. Build and stage the online application

Use Node.js 24+ for building; no npm dependencies are required:

```sh
npm run check
npm run check:public
npm test
npm run package:sites -- --hosting "/absolute/private/hosting.json" --out "/absolute/new/sites-stage"
```

The output directory must be new and outside the source checkout. The command builds `dist/sites/index.js`, then stages the private entry at the deployment path `dist/server/index.js`. It does not overwrite the public build, connect an account or deploy anything. It accepts only `project_id`, `d1: "DB"` and `capabilities: ["mcp"]` in the private hosting file; runtime data and credentials are rejected.

The staged directory contains 21 files:

- `dist/server/index.js`: the owner-private Sites application and UI assets
- `dist/.openai/hosting.json`: your installation's project identity and logical capabilities
- `dist/.openai/drizzle/`: nine SQL migrations, nine schema snapshots and the journal

The full application source remains this repository; the staged build is a private deployment artifact. Do not commit it or upload your private configuration to GitHub. Use your supported Sites packaging/version/deployment flow with this exact source revision and private output. Preserve owner-only access. A successful local build does not establish that a new Site has deployed.

The `package:sites` command is the current online packaging path. Other build targets are [developer alternatives](deployment.md#build-targets-for-developers), not additional installation steps. Do not deploy the generic build in place of the private Sites bundle.

## 3. Apply the complete database schema

For Sites, retain the unchanged `drizzle/` journal, all nine SQL files and all nine snapshots. They are bundled by the staging command. The migration chain is:

1. `0000_project_intake`
2. `0001_events_dispatch`
3. `0002_regular_nomad` (execution evidence)
4. `0003_lame_ultimates` (dispatch guards and native journal)
5. `0004_living_mephisto` (board observations)
6. `0005_board_observation_outbox`
7. `0006_dispatch_manual_authorizations`
8. `0007_manual_task_status`
9. `0008_task_requirements`

Use the platform's migration mechanism against the new installation's `DB`. Do not apply only the first two files. The separate `migrations/` directory is the plain-SQL/local chain, numbered 0000 through 0009; do not apply both chains to the same database. Existing installations need their own backup and migration review; packaging must not copy production rows or rewrite previously applied migrations.

## 4. Configure private runtime values

### First installation: obtain your own Site identity

The user only needs to give this repository to their dot and follow its sign-in/configuration prompts. They do not need to discover an ID or understand environment variables. The installing dot performs this sequence through the currently supported Sites tools:

1. Recheck the exact Site's owner-private access in `get_site`. Reuse that Site; do not create another one. Obtain the applicable permission for the actual runtime/deployment changes before applying them.
2. Through `update_environment_variables` (or the supported Sites runtime-settings UI), set `DOT_BOARD_INGRESS=sites-owner-private-v1`, `DOT_BOARD_AUDIENCE` to the exact new HTTPS origin, and `DOT_BOARD_IDENTITY_SETUP_ENABLED=true`. Leave `DOT_BOARD_OWNER_ID` absent for a genuinely uninitialized Site; never remove or replace an existing owner binding to use setup. Leave execution/Events features off.
3. Save and deploy the exact Sites build with the normal private publishing workflow. A runtime-variable update requires deploying a saved version to take effect. This is an **installation stage**, not a usable-board completion: ordinary routes still return `owner_binding_unconfigured` until binding is finished.
4. Have the actual owner open the new origin followed by `/setup` in their normal signed-in browser. The page displays only the current visitor's platform-provided Site ID. The installing dot may read `/api/setup/identity` using that same authenticated browser context; a service token cannot obtain a user identity. Do not put the ID in a URL, public issue or source file. If login is needed, use the platform sign-in UI; never ask for passwords or tokens in chat.
5. Reconfirm ownership/private access and have the owner confirm that this is their own signed-in session. Ask the required concrete confirmation to bind that identity to this named Site. Use the supported runtime configuration operation to set `DOT_BOARD_OWNER_ID` to the returned `siteUserId` and set `DOT_BOARD_IDENTITY_SETUP_ENABLED=false` (or remove that setup flag), preserving unrelated values. Do not guess or accept a third party's proposed ID.
6. Deploy the saved version again to apply the new runtime revision. Confirm that normal owner access works, a different user is denied, and `/setup` plus `/api/setup/identity` are disabled. Then finish the feature checks below before adding real data or calling installation complete.

If any step is unavailable, report that exact step; do not silently use a local preview or disable authorization. The setup routes never write a database, owner binding, credential or runtime value. Concurrent visits cannot claim the Site. Once an owner is configured, these routes also refuse identity lookup even if someone forgot to turn off the flag.

**Trust boundary:** the application sees an authenticated visitor ID, not a platform owner/private-policy attestation. It cannot determine a changed sharing policy from that header. The installing dot must verify current ownership and owner-only access in the management plane before setup and again before binding. The lookup itself grants no role or business access. Automated tests model the trusted Sites boundary; they do not prove live platform header stripping, private-policy enforcement or a successful new-account deployment.

### Normal runtime settings after identity setup

Set these through your Site's runtime configuration, not source files or browser code:

| Setting | Required value or source |
| --- | --- |
| `DOT_BOARD_INGRESS` | `sites-owner-private-v1` |
| `DOT_BOARD_OWNER_ID` | The exact `siteUserId` obtained and confirmed through the first-install flow above |
| `DOT_BOARD_IDENTITY_SETUP_ENABLED` | Temporary `true` only during first setup; `false` or absent afterward |
| `DOT_BOARD_AUDIENCE` | The exact HTTPS origin returned for the new Site |
| `DB` | The Site's D1 binding, with the complete schema |
| `DOT_BOARD_SNAPSHOT` | The JSON **contents** of `examples/synthetic-snapshot.json`, not its file path; use your own authorized snapshot contents later |
| `DOT_BOARD_PROJECT_REGISTRY` | Stable IDs and names matching the chosen snapshot |
| `DOT_BOARD_INTAKE_ENABLED`, `DOT_BOARD_INTAKE_MCP_ENABLED` | Enable only the configured features |
| `DOT_BOARD_INTAKE_CONNECTION_VERIFIED`, `DOT_BOARD_INTAKE_READER_VERIFIED`, `DOT_BOARD_INTAKE_WRITER_VERIFIED` | Set to `true` only after that actual connection/flow was checked |
| `DOT_BOARD_OBSERVATIONS_ENABLED` | Optional; requires the observation schema and authorized original-task mappings |
| `DOT_BOARD_OBSERVATION_BINDINGS` | Your own private task/thread/environment mappings; never copy the original deployment |
| `DOT_BOARD_QUEUE_ENABLED`, `DOT_BOARD_QUEUE_CAPACITY` | Optional queue policy; does not install an executor |

Create a synthetic registry from the included snapshot if needed:

```sh
node -e "const s=require('./examples/synthetic-snapshot.json'); console.log(JSON.stringify([...new Set(s.tasks.map(t=>t.project))].map((name,i)=>({id:'demo-'+i,name,aliases:[]}))))"
```

The current private Sites entry disables direct Events delivery and its scheduled drain; an environment flag cannot enable them. Leave Events/relay settings out of the standard installation. The optional separately configured relay bridge is a host-integration experiment, not a required setup step or a verified automatic-execution connection. Do not publish relay URLs, secrets or real observations. See [owner observations](OWNER_OBSERVATION_UPDATES.md) and [native host contract](NATIVE_HOST_ADAPTER.md) for the additional integration boundary.

## 5. Accept the new online installation

After the platform confirms deployment, use the new hosted URL:

1. Verify sign-in, signed-out denial and wrong-owner denial; the configured audience must match and both setup routes must be disabled.
2. Verify synthetic projects, assets, filtering and task details on the actual hosted page.
3. Change a synthetic task's manual status, reload, and confirm it persists without rewriting observed evidence or claiming execution.
4. When intake/MCP is configured, verify one saved request, its retry, read receipt and progress receipt; no real executor should start from this test.
5. Verify observations only against your own explicitly mapped test task, preserving source timestamps.

The original hosted application and this source have automated private-entry coverage. A new-account end-to-end Sites deployment, browser visual acceptance, real-device testing, native execution/continuation and real callback delivery have **not** been verified by the repository's automated suite. Record them separately; do not equate source availability or CI success with a fully connected copy of the original private account.
