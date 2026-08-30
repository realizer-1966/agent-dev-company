-- Syncular 서버 스토리지 테이블 (sqliteDdlStatements() 자동 생성 — @syncular/server 0.15.48)
-- 재생성: node scripts/regen-ddl.js

CREATE TABLE IF NOT EXISTS sync_partitions(
  partition TEXT PRIMARY KEY,
  max_commit_seq INTEGER NOT NULL DEFAULT 0,
  horizon_seq INTEGER NOT NULL DEFAULT 0
)

CREATE TABLE IF NOT EXISTS sync_partition_registry(
  partition TEXT PRIMARY KEY,
  log_epoch TEXT NOT NULL,
  epoch_required INTEGER NOT NULL DEFAULT 0,
  last_authenticated_at_ms INTEGER NOT NULL
)

CREATE TABLE IF NOT EXISTS sync_row_scopes(
  partition TEXT NOT NULL, tbl TEXT NOT NULL,
  var TEXT NOT NULL, value TEXT NOT NULL, row_id TEXT NOT NULL,
  PRIMARY KEY(partition, tbl, var, value, row_id)
)

CREATE TABLE IF NOT EXISTS sync_commits(
  partition TEXT NOT NULL, commit_seq INTEGER NOT NULL,
  client_id TEXT NOT NULL, client_commit_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(partition, commit_seq)
)

CREATE INDEX IF NOT EXISTS sync_commits_by_time
  ON sync_commits(partition, created_at_ms)

CREATE TABLE IF NOT EXISTS sync_changes(
  partition TEXT NOT NULL, commit_seq INTEGER NOT NULL, idx INTEGER NOT NULL,
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, op INTEGER NOT NULL,
  row_version INTEGER, scopes TEXT NOT NULL, payload BLOB,
  PRIMARY KEY(partition, commit_seq, idx)
)

CREATE INDEX IF NOT EXISTS sync_changes_by_table
  ON sync_changes(partition, commit_seq, tbl, idx)

CREATE TABLE IF NOT EXISTS sync_change_scopes(
  partition TEXT NOT NULL, tbl TEXT NOT NULL,
  var TEXT NOT NULL, value TEXT NOT NULL, commit_seq INTEGER NOT NULL,
  PRIMARY KEY(partition, tbl, var, value, commit_seq)
)

CREATE TABLE IF NOT EXISTS sync_push_results(
  partition TEXT NOT NULL, client_id TEXT NOT NULL,
  client_commit_id TEXT NOT NULL, result TEXT NOT NULL,
  PRIMARY KEY(partition, client_id, client_commit_id)
)

CREATE TABLE IF NOT EXISTS sync_reactions(
  partition TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  type TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
  source_client_id TEXT NOT NULL, source_client_commit_id TEXT NOT NULL,
  source_commit_seq INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
  available_at_ms INTEGER NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
  lease_owner TEXT, lease_expires_at_ms INTEGER, completed_at_ms INTEGER,
  last_failure TEXT,
  PRIMARY KEY(partition, idempotency_key),
  CHECK(status IN ('pending', 'leased', 'completed', 'dead-letter'))
)

CREATE INDEX IF NOT EXISTS sync_reactions_due
  ON sync_reactions(partition, status, available_at_ms, created_at_ms, idempotency_key)

CREATE INDEX IF NOT EXISTS sync_reactions_lease
  ON sync_reactions(partition, status, lease_expires_at_ms)

CREATE INDEX IF NOT EXISTS sync_reactions_completed
  ON sync_reactions(partition, status, completed_at_ms, idempotency_key)

CREATE INDEX IF NOT EXISTS sync_reactions_dead_letter
  ON sync_reactions(partition, status, available_at_ms, idempotency_key)

CREATE TABLE IF NOT EXISTS sync_clients(
  partition TEXT NOT NULL, client_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  wire_version INTEGER NOT NULL DEFAULT 1,
  cursor INTEGER NOT NULL, subscriptions TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(partition, client_id)
)

CREATE TABLE IF NOT EXISTS sync_blob_refs(
  partition TEXT NOT NULL, tbl TEXT NOT NULL, row_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  PRIMARY KEY(partition, tbl, row_id, blob_id)
)

CREATE INDEX IF NOT EXISTS sync_blob_refs_by_blob
  ON sync_blob_refs(partition, blob_id)
