# Owner task status

The existing private Site supports `GET /api/tasks/:taskId/status` and same-origin `POST` at that path. Sites must authenticate and inject the verified owner identity. Public clients cannot supply an identity to establish trust.

A write contains `expectedVersion` (0 for the first write), unique `eventId`, `state`, and optional `reason`. States are `queued`, `running`, `blocked`, `paused`, `completed`, and `canceled`. The response is the current manual record with `taskId`, `version`, `state`, `reason`, `updatedAt`, `source: "owner_manual"`, `executionControl`, and for writes `duplicate`. Repeating the exact event is idempotent; a different payload with that ID or an outdated version is rejected. After a conflict, fetch the current record before a new choice.

The board includes the manual record as `task.manualStatus`. Original observations, their time, verification, and Agent activity remain independent. A manual running label is not evidence that an executor is running, and manual completion does not manufacture acceptance evidence.

Pause/cancel writes atomically preserve the corresponding dispatch admission control. They do not terminate an already running process or release a resource lease. Other display choices cannot clear existing paused/canceled controls or activate a deferred project. Completed creates a deferred admission control. Execution still requires the existing scoped authorization, native provider, preflight, and actual result protocol.

Private data is stored in the existing Site D1 database. The additive migration preserves all existing requests, observations, dispatch history, and controls. No event subscription, credential, cron, or external relay is enabled by this feature.
