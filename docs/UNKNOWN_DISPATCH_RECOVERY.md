# Recovering an unknown original-thread send

An unknown native send keeps its dispatch key, capacity reservation and resource leases. A previous completed turn, a connected computer, elapsed time, or an expired lease is not evidence that the pending send cannot later be admitted.

The dispatch service derives `attemptStartedAt` from the latest successful claim in the existing durable operation journal, using its insertion order. It does not use the job's mutable update time. It rejects a turn already used by another job on the same owner's thread, or a turn retained from an earlier attempt of the same job.

For a known-thread job in `uncertain`, `bind` additionally requires `admissionEvidence`:

```json
{
  "requestId": "the-current-request",
  "dispatchKey": "the-current-dispatch-key",
  "threadId": "the-original-thread",
  "turnId": "the-actually-admitted-new-turn",
  "observedAt": "2026-10-08T13:00:00Z",
  "source": "cloud_threads.read",
  "reference": "actual-correlated-source-item"
}
```

The identities must match the current job and bind input. The source observation must be at or after the immutable claim, not in the future, and no older than five minutes. The structured receipt is persisted in `reconciliationEvidence`. The authorized host must actually read an admission or message that links this request to that turn. Filling fields is not a substitute for that evidence: this validation is not a platform signature verifier and cannot manufacture provider guarantees.

Completion/failure with a typed receipt rejects observations from before the current claim or more than five minutes old. Confirmed thread execution requires a terminal `tool_result` with `active: false`, `terminal: true`, the exact bound turn, and explicit no-active-writer acknowledgement. Re-read genuine results when the evidence is stale; never change a source timestamp just to pass validation.

A known-thread `uncertain` or `dispatching` job with a persisted begin intent cannot use `checkpoint` to release or requeue its reservation. An independently distinguishable pre-send safety hold, whose current claim has no begin intent at all, may checkpoint only with a fresh typed terminal read, its actual turn, and persisted reconciliation detail; stale hosts cannot begin after that versioned checkpoint. The present provider has no supported admission-status lookup or enforced late-admission fence, so no input boolean or text can authorize that release. This restriction deliberately leaves unresolved sends reserved. If a genuine correlated new turn becomes visible, bind it and follow the existing result path. Supporting authoritative no-admission/fencing receipts later requires a separately verified provider capability.

This change adds no new credentials, resources, database migration, automatic retry, or native send. Publishing it does not mutate existing jobs or prove that the platform failure was resolved.
