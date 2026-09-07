-- Syncular 서버 스토리지 테이블 (sqliteDdlStatements + createTableDdl 자동 생성)
-- 재생성: node scripts/regen-ddl.mjs  (2026-09-07)

CREATE TABLE IF NOT EXISTS sync_partitions(
  partition TEXT PRIMARY KEY,
  max_commit_seq INTEGER NOT NULL DEFAULT 0,
  horizon_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_partition_registry(
  partition TEXT PRIMARY KEY,
  log_epoch TEXT NOT NULL,
  epoch_required INTEGER NOT NULL DEFAULT 0,
  last_authenticated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_row_scopes(
  partition TEXT NOT NULL, tbl TEXT NOT NULL,
  var TEXT NOT NULL, value TEXT NOT NULL, row_id TEXT NOT NULL,
  PRIMARY KEY(partition, tbl, var, value, row_id)
);

CREATE TABLE IF NOT EXISTS sync_commits(
  partition TEXT NOT NULL, commit_seq INTEGER NOT NULL,
  client_id TEXT NOT NULL, client_commit_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(partition, commit_seq)
);

CREATE INDEX IF NOT EXISTS sync_commits_by_time
  ON sync_commits(partition, created_at_ms);

CREATE TABLE IF NOT EXISTS sync_changes(
  partition TEXT NOT NULL, commit_seq INTEGER NOT NULL, idx INTEGER NOT NULL,
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, op INTEGER NOT NULL,
  row_version INTEGER, scopes TEXT NOT NULL, payload BLOB,
  PRIMARY KEY(partition, commit_seq, idx)
);

CREATE INDEX IF NOT EXISTS sync_changes_by_table
  ON sync_changes(partition, commit_seq, tbl, idx);

CREATE TABLE IF NOT EXISTS sync_change_scopes(
  partition TEXT NOT NULL, tbl TEXT NOT NULL,
  var TEXT NOT NULL, value TEXT NOT NULL, commit_seq INTEGER NOT NULL,
  PRIMARY KEY(partition, tbl, var, value, commit_seq)
);

CREATE TABLE IF NOT EXISTS sync_push_results(
  partition TEXT NOT NULL, client_id TEXT NOT NULL,
  client_commit_id TEXT NOT NULL, result TEXT NOT NULL,
  PRIMARY KEY(partition, client_id, client_commit_id)
);

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
);

CREATE INDEX IF NOT EXISTS sync_reactions_due
  ON sync_reactions(partition, status, available_at_ms, created_at_ms, idempotency_key);

CREATE INDEX IF NOT EXISTS sync_reactions_lease
  ON sync_reactions(partition, status, lease_expires_at_ms);

CREATE INDEX IF NOT EXISTS sync_reactions_completed
  ON sync_reactions(partition, status, completed_at_ms, idempotency_key);

CREATE INDEX IF NOT EXISTS sync_reactions_dead_letter
  ON sync_reactions(partition, status, available_at_ms, idempotency_key);

CREATE TABLE IF NOT EXISTS sync_clients(
  partition TEXT NOT NULL, client_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  wire_version INTEGER NOT NULL DEFAULT 1,
  cursor INTEGER NOT NULL, subscriptions TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(partition, client_id)
);

CREATE TABLE IF NOT EXISTS sync_blob_refs(
  partition TEXT NOT NULL, tbl TEXT NOT NULL, row_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  PRIMARY KEY(partition, tbl, row_id, blob_id)
);

CREATE INDEX IF NOT EXISTS sync_blob_refs_by_blob
  ON sync_blob_refs(partition, blob_id);

CREATE TABLE IF NOT EXISTS "posts" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "public_id" TEXT NOT NULL, "author_id" TEXT NOT NULL, "author_name" TEXT NOT NULL, "author_avatar" TEXT NOT NULL, "types" TEXT NOT NULL, "mode" TEXT NOT NULL, "region" TEXT NOT NULL, "days" TEXT NOT NULL, "time_slot" TEXT NOT NULL, "capacity" INTEGER NOT NULL, "intro" TEXT NOT NULL, "deadline" TEXT NOT NULL, "status" TEXT NOT NULL, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "feed_items" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "public_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "user_name" TEXT NOT NULL, "avatar" TEXT NOT NULL, "mission_title" TEXT NOT NULL, "memo" TEXT NOT NULL, "photo" TEXT, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "cheers" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "public_id" TEXT NOT NULL, "feed_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "cheer_type" TEXT NOT NULL, "created_at_ms" INTEGER, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "user_profiles" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "public_id" TEXT NOT NULL, "display_name" TEXT NOT NULL, "avatar" TEXT NOT NULL, "interests" TEXT NOT NULL, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "applications" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "apply_scope" TEXT NOT NULL, "post_id" TEXT NOT NULL, "group_id" TEXT NOT NULL, "applicant_id" TEXT NOT NULL, "applicant_name" TEXT NOT NULL, "applicant_avatar" TEXT NOT NULL, "status" TEXT NOT NULL, "message" TEXT NOT NULL, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "group_members" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "group_id" TEXT NOT NULL, "post_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "role" TEXT NOT NULL, "joined_at_ms" INTEGER NOT NULL, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "verifications" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "verify_scope" TEXT NOT NULL, "group_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "mission_id" TEXT NOT NULL, "mission_title" TEXT NOT NULL, "mission_kind" TEXT NOT NULL, "date" TEXT NOT NULL, "memo" TEXT NOT NULL, "photo" TEXT, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "missions" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "date" TEXT, "week_key" TEXT, "title" TEXT NOT NULL, "goal" INTEGER NOT NULL, "status" TEXT NOT NULL, "verified_at_ms" INTEGER, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "point_ledger" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "amount" INTEGER NOT NULL, "reason" TEXT NOT NULL, "balance_after" INTEGER NOT NULL, "created_at_ms" INTEGER, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "streaks" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "current" INTEGER NOT NULL, "best" INTEGER NOT NULL, "last_date" TEXT, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "badges" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "badge_id" TEXT NOT NULL, "badge_name" TEXT NOT NULL, "earned_at_ms" INTEGER NOT NULL, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));

CREATE TABLE IF NOT EXISTS "rankings" ("_sync_partition" TEXT NOT NULL, "_sync_row_id" TEXT NOT NULL, "id" TEXT NOT NULL, "group_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "total_points" INTEGER NOT NULL, "created_at_ms" INTEGER, "updated_at_ms" INTEGER NOT NULL, "_sync_server_version" INTEGER NOT NULL, "_sync_scopes" TEXT NOT NULL, "_sync_payload" BLOB NOT NULL, PRIMARY KEY ("_sync_partition", "_sync_row_id"));
