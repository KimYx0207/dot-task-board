# Deployment

## Local Node

`npm start` binds to `127.0.0.1`. Supply `DOT_BOARD_SNAPSHOT_PATH` pointing outside the repository, or a server-side `DOT_BOARD_SNAPSHOT` JSON string. The application does not load `.env` automatically.

The local server is intended for loopback use. Do not remove its Host validation or expose it directly to the internet to make remote access easier. Use a host with appropriate authentication and authorization when remote visibility is needed.

## Worker adapter

```sh
npm run build
```

This creates `dist/server/index.js`, an ESM Worker with `fetch(request, env)`. It contains only application code and static UI assets. Deploying it is a separate operator decision; CI never deploys it.

Provide runtime data separately using either:

- `DOT_BOARD_SNAPSHOT`: one JSON string
- `DOT_BOARD_SNAPSHOT_PARTS`: number of chunks, and `DOT_BOARD_SNAPSHOT_0` through the final numbered chunk

Chunking is a transport option for hosts with per-value limits, not an encryption mechanism. Mark sensitive runtime values as secrets using the chosen host's supported controls. Never commit a real snapshot or a hosted project identity.

The Worker intentionally has no built-in account system. Before using real task data, verify that the deployment host restricts the complete UI and `/api/board` to the intended audience. A secret URL or a hidden link is insufficient.

## Refresh behavior

The browser's refresh button rereads the supplied snapshot. It does not query a native assistant, start a scheduler or acquire access to another system. Any exporter or periodic update service must be configured separately, with a clear data scope and access policy.

## Validation limits

Local tests validate the model, boundary handling, HTTP behavior and Worker dispatch. A 390px preview frame helps check layout but is not a real-phone test. Check the actual deployment, authentication boundary and target device before claiming a production or mobile acceptance pass.
