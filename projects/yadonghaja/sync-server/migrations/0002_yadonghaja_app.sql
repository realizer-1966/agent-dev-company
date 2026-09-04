-- 야!동하자 앱 테이블 — SYNCULAR_DESIGN.md §4 스키마 (수동 관리)
-- Syncular 서버 테이블(0001)과 함께 D1에 적용된다.

-- ============ 공개 영역 ============

CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,            -- 'p_' + ulid
  public_id     TEXT NOT NULL DEFAULT 'main',
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  author_avatar TEXT NOT NULL DEFAULT '💪',
  types         TEXT NOT NULL,               -- JSON '["러닝","걷기"]'
  mode          TEXT NOT NULL CHECK (mode IN ('온라인','오프라인')),
  region        TEXT NOT NULL,
  days          TEXT NOT NULL,               -- JSON '[0,2,4]'
  time_slot     TEXT NOT NULL,
  capacity      INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  intro         TEXT NOT NULL,
  deadline      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'recruiting',
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_items (
  id            TEXT PRIMARY KEY,
  public_id     TEXT NOT NULL DEFAULT 'main',
  user_id       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  avatar        TEXT NOT NULL,
  mission_title TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  photo        BLOB_REF,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cheers (
  id            TEXT PRIMARY KEY,            -- '{feed_id}:{user_id}:{type}'
  public_id     TEXT NOT NULL DEFAULT 'main',
  feed_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  cheer_type    TEXT NOT NULL CHECK (cheer_type IN ('fire','thumb','muscle')),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (feed_id, user_id, cheer_type)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id            TEXT PRIMARY KEY,            -- = user_id
  public_id     TEXT NOT NULL DEFAULT 'main',
  display_name  TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '💪',
  interests     TEXT NOT NULL DEFAULT '["홈트"]',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- ============ 모집·그룹 영역 ============

CREATE TABLE IF NOT EXISTS applications (
  id            TEXT PRIMARY KEY,            -- '{post_id}:{applicant_id}'
  apply_scope   TEXT NOT NULL DEFAULT 'open',
  post_id       TEXT NOT NULL,
  group_id      TEXT NOT NULL,
  applicant_id  TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_avatar TEXT NOT NULL DEFAULT '💪',
  status        TEXT NOT NULL DEFAULT 'pending',
  message       TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (post_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id            TEXT PRIMARY KEY,            -- '{group_id}:{user_id}'
  group_id      TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  joined_at_ms  INTEGER NOT NULL,
  UNIQUE (group_id, user_id)
);

-- ============ 인증 영역 ============

CREATE TABLE IF NOT EXISTS verifications (
  id            TEXT PRIMARY KEY,
  verify_scope  TEXT NOT NULL DEFAULT 'live',
  group_id      TEXT NOT NULL,               -- 개인 미션이면 'solo'
  user_id       TEXT NOT NULL,
  mission_id    TEXT NOT NULL,
  mission_title TEXT NOT NULL,
  mission_kind  TEXT NOT NULL CHECK (mission_kind IN ('daily','weekly','group')),
  date          TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  photo        BLOB_REF,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (user_id, mission_id)
);

-- ============ 개인 영역 ============

CREATE TABLE IF NOT EXISTS missions (
  id            TEXT PRIMARY KEY,            -- '{user_id}:{date}:{seq}' / '{user_id}:w:{week}'
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('daily','weekly')),
  date          TEXT,
  week_key      TEXT,
  title         TEXT NOT NULL,
  goal          INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'pending',
  verified_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streaks (
  id            TEXT PRIMARY KEY,            -- = user_id
  user_id       TEXT NOT NULL,
  current       INTEGER NOT NULL DEFAULT 0,
  best          INTEGER NOT NULL DEFAULT 0,
  last_date     TEXT,
  lottery_used_week TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS badges (
  id            TEXT PRIMARY KEY,            -- '{user_id}:{badge_id}'
  user_id       TEXT NOT NULL,
  badge_id      TEXT NOT NULL,
  earned_at_ms  INTEGER NOT NULL,
  UNIQUE (user_id, badge_id)
);
