-- Durable native tool intent log. Contains no credentials or task prompt text.
CREATE TABLE IF NOT EXISTS native_dispatch_journal (
 owner_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 binding_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','admitted','uncertain')),
 receipt_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,operation_id)
);
