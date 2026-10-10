# Existing-request client for a dot session

`src/application/dot-session-dispatch-client.mjs` supplies a bounded client for an
already authorized dot session. It invokes the actual fixed tool names through
`src/adapters/dot-session-tools.mjs`. It is not a Sites server entry, scheduler,
credential loader, authorization issuer, or a new native executor.

## Required host capabilities

- The session's existing board read/claim/preflight/update tools and original
  `cloud_threads.read` / `cloud_threads.send_message` tools.
- `reviewContinuation({job, request, raw})`: the host must independently verify the
  actual owner-approved scope, instruction and absence of original active writers.
  It returns `verified`, `noActiveWriter`, matching `requestId`, `threadId`,
  `priorTurnId`, the reviewed `approvedPrompt`, and an actual evidence `reference`.
  Request text and a completed turn are not sufficient proof.
- `reviewCompletion({job, request, raw})`: independently review the same execution
  and actual result. Return matching request/thread/turn, a real `resultItemId`,
  `verified`, `noActiveWriter`, `outcome`, `completedScope`, and `pendingChecks`.
  A successful completion requires no pending checks. These callbacks are trusted
  host capabilities, never JSON received from a task, form or untrusted message.
- `newEventId()` supplies a distinct event ID for each CAS operation. The host
  supplies and retains one `claimEventId` for the selected request attempt.

Missing tools or review functions fail before any queue mutation. The repository
does not provide fabricated production reviewers, credentials or an in-memory
journal. The existing server's durable claim/begin records protect this client's
single native write attempt; this does not replace or instantiate the separate
`createCloudThreadsAdapter` / D1 native-journal contract.

## Flow and limits

1. `dispatchNext({requestId, claimEventId})` consumes one existing accepted request
   with an already registered original-thread binding and valid server admission.
   It currently requires that request to be the sole queued candidate, because the
   existing claim tool does not accept a request selector. A concurrent unexpected
   claim is retained without sending and is reported for reconciliation. The
   current queue list caps at 500 without pagination, so a full 500-record page
   fails closed; it cannot establish that no other queued candidate is hidden.
2. It reads request, binding, withdrawal state and original-thread evidence before
   claim. After claim it rechecks the server, source state and host review, saves
   `begin`, checks the server again, then sends once to that original thread.
3. The actual admission receipt is persisted with `bind`. Admission is not recorded
   as actual execution. Replayed claims never send again. Ambiguous sends retain
   the reservation as uncertain when that write can be confirmed; failed reads or
   writes are reported explicitly, without retry or release.
4. `reconcile({jobId})` reads a confirmed assigned/running attempt. It records a
   terminal result only after host acceptance proves the same turn's scoped work
   and no active writer. Source time is captured at the thread read, not after
   review; the existing server freshness checks remain authoritative. A lost
   terminal write response is read back, not retried.

This client does not prepare, accept, authorize, renew or create requests. It does
not register bindings, modify controls, change TTLs, release unknown reservations,
add migrations, create threads, or invoke other projects. No network endpoint or
credential is added. It deliberately does not resume uncertain/blocked work.

The platform currently offers neither an operation-ID lookup/idempotency argument
nor idle-only/CAS `send_message`. A final read narrows but cannot remove the race
with an external writer. UNKNOWN recovery remains a separate unresolved boundary.

The tests use synthetic tools and review evidence. Passing them proves protocol
behavior, not a production request-to-execution acceptance. An authorized host
must bind these capabilities and run a real applicable request before claiming
that complete production chain works. Do not manufacture a request for that claim.

## 中文范围说明

这是 dot 会话使用现有工具的客户端，不会让 Sites 服务器自动获得执行权限。
仅处理已有请求、有效准入和原线程；授权来源、原线程无在途写入及业务验收必须由
真实宿主核实。缺少工具或核验能力会停止，不提供虚构的成功默认值。
重复领取不重发，UNKNOWN 不释放；模拟协议测试不代表真实生产全链验收。
