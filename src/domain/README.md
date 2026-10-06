# Agent relationship input, version 2

The current normalized contract is `dot-board.snapshot/2`. Version 1 task-only imports remain readable and produce an explicitly empty agent roster. No task owner label is converted into an agent.

An import contains the existing task fields plus `agents[]`. Each observed agent has a stable `id`, a readable `name`, `type` (`agent` or `subagent`), `kind` (`coordinator`, `owner`, `worker`, `reviewer`, or `researcher`), `role`, `parentAgentId`, `projectNames[]`, `taskIds[]`, and a short `responsibility` summary.

`activity` contains `state`, `summary`, `observedAt`, `blocker`, and `nextAction`. States are centralized in `config/agents.mjs`. A thread being present is not proof of current execution: the exporter must provide an actual activity observation. Do not copy raw thread text, prompts, internal process names, private paths or role/method assets into these fields.

`latestResult`, when a result really exists, contains `summary`, `observedAt`, and safe `evidence[]` links. It is independent of current activity: the same reviewer can finish one check, then start another, without becoming a new identity. An agent's result does not advance task deployment or business acceptance.

`source` records the source `kind`, a short human-readable `label`, and its real `observedAt`. A missing time is null. Import time and request time never replace observation time.

Parentage must come from actual host records. Project grouping never supplies a parent. An absent parent is marked unknown; cyclic or duplicate identities reject the snapshot. Task references are deduplicated, missing references counted, and `tasks[].assignedAgentIds` is projected from those actual associations.

The application returns `agents`, `agentSummary`, and `projectSummaries` alongside the legacy tasks view. The coordinator is counted separately. Confirmed active workers require `running` plus a valid, current observation; stale or missing activity remains explicitly unverified. Completed observations remain historical completions. These are counts within the imported known roster, never platform-wide totals or a continuous live feed.

The browser only reads `/api/board`; it cannot call native assistant tools. The integration is an explicit host export/import. Refresh rereads the same imported records until the authorized host provides a newer private snapshot.
