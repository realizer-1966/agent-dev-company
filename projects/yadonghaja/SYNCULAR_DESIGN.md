# 야!동하자 v2 — Syncular 전환 설계안 (v2 정정판)

> 작성일: 2026-08-30 · 대상: syncular v0.15.48 (npm 게시판 기준) · 상태: 검토용
>
> 이 문서는 [PLAN.md](./PLAN.md) v2 로드맵의 구체화다. v1(단일 index.html + IndexedDB)을
> Syncular 오프라인-우선 멀티유저 아키텍처로 전환하는 전체 스키마 설계안이다.
>
> **v2 정정판 사유**: 초안의 다중 스코프 해석이 스펙과 달랐다. SPEC.md §3.2·§3.4를
> 정독해 4가지를 정정했다 — ① 쓰기 인가는 **선언 변수 전부 AND 통과**("All declared
> keys are required"), ② 읽기 구독은 **변수 서브셋 요청이 합법**(intersection은 요청된
> 키에만 실행), ③ 공개 테이블의 소유권 검증은 스코프가 아니라 **§6.7 validator**가
> 담당, ④ 비멤버의 모집 신청은 스코프 구조상 불가하므로 **신청 전용 스코프 축**을
> 추가해 해결. 아래 설계는 전부 정정 반영본이다.

---

## 0. 검증 기반

이 설계안의 형식·동작은 문서만 본 게 아니라 이 환경에서 실측했다:

- 퀵스타트 서버(Node 22 + Hono 브릿지) 기동 → **양방향 수렴 테스트 PASS**
  (클라이언트 A 쓰기 → B 수신 / B 쓰기 → A 수신, 독립 SQLite 클라이언트 2개)
- 스코프 3집합(requested/allowed/effective)·충돌 baseVersion·Blob(`BLOB_REF`)·
  validator(§6.7)는 공식 SPEC.md + concepts 문서 + `packages/server/src/validate.ts`
  실코드 기반으로 해석했다.

---

## 1. 전환 목표와 비목표

### 목표
1. **진짜 멀티유저** — 모집글/피드/응원을 실제 다른 사용자와 공유 (더미 시뮬레이션 제거)
2. **오프라인 우선** — 지하철·산길에서도 미션 인증·응원 쓰기 가능, 복귀 시 자동 수렴
3. **iOS ITP 해결** — 로컬 데이터가 7일 미방문으로 소실돼도 서버에 원본 존재
4. **인증 사진 Blob 분리** — 사진을 동기화 스트림에서 분리해 용량·속도 확보

### 비목표 (v2에서 안 함)
- 포인트 환전·제휴 (v3) · 이메일/전화 인증 (익명 auth 먼저) · 영상통화 (v3+)

---

## 2. 아키텍처

```
┌─────────────── Android/iOS 브라우저 (PWA) ───────────────┐
│  index.html + app.js (기존 Vanilla JS UI 유지)            │
│    └ worker.js — Syncular 클라이언트 코어                  │
│         ├ sqlite-wasm (OPFS) ← 로컬 미러                   │
│         ├ 아웃박스(오프라인 쓰기) + 충돌 큐                 │
│         └ BroadcastChannel (탭 간 단일 코어)               │
└──────────────┬───────────────────────────────────────────┘
               │ HTTPS (sync/segments/blobs)
┌──────────────▼───────────────────────────────────────────┐
│  Sync 서버 (Cloudflare Workers + D1 권장)                 │
│   ├ @syncular/server-workers — 동기화 엔드포인트           │
│   ├ resolveScopes — 스코프 인가 (아래 §3)                  │
│   ├ validators (§6.7) — 소유권·비즈니스 규칙 검증          │
│   ├ authenticate — 익명 세션 토큰                         │
│   └ R2 — Blob 저장소 (인증 사진)                           │
└──────────────────────────────────────────────────────────┘
```

**프론트 유지 전략**: 현재 `index.html`의 UI 렌더는 그대로 두고 데이터 계층만 교체.
`dbAdd/dbPut/dbAll` 호출부를 Syncular `mutate/query`로 바꾸는 어댑터
(`sync-adapter.js`)를 두면 UI 수정이 최소화된다. 빌드는 정적 3파일
(index.html + app.js + worker.js, esbuild 번들)로 — OnDev 프론트 호스팅 유지.

---

## 3. 스코프 설계 (핵심 — 스펙 정합)

### 3.1 먼저 외워야 할 스펙 규칙 3가지

1. **쓰기(§3.4)**: 테이블이 선언한 스코프 변수 **전부**에 대해 행 값이 actor의
   allowed 목록(또는 `*`)에 있어야 한다. 부분 통과 없음 (AND).
2. **읽기(§3.2)**: 구독은 선언 변수의 **서브셋**만 요청할 수 있다 — intersection은
   요청된 키에만 실행된다. 단 요청한 키가 allowed에 없으면 그 구독 전체가 revoked.
3. **공개 ≠ 소유**: `public:{public_id}` 스코프는 "전체가 읽는다"만 뜻한다. 누가
   썼는지는 스코프가 검증하지 않는다 → **validator(§6.7)가 필수** (§3.4 참조).

### 3.2 스코프 축 설계

Syncular에 글로벌 테이블은 없다(§3.1). 야!동하자는 5개 축을 쓴다:

| 스코프 변수 | 의미 | 값 예시 |
|---|---|---|
| `public_id` | 전체 공개 데이터 | 단일값 `'main'` |
| `group_id` | 승인 완료 그룹 (모집글 확정) | `'post:42'` |
| `user_id` | 개인 데이터 소유자 | `u_9f3k…` |
| `apply_scope` | **모집 신청 전용 축** (치킨에그 해결) | `'open'` (신청 가능한 모집글 전체) |
| `verify_scope` | 그룹 인증 공유 축 (AND 우회용) | `'live'` (인증 활동 전체) |

**`apply_scope` 왜 필요한가** — 신청(`applications`)은 아직 비멤버가 쓰는 데이터다.
`group:{group_id}`로 스코프하면 §3.4에 따라 비멤버(allowed에 그 group_id 없음)의
신청 쓰기가 전부 거부된다. 신청 가능한 모집글 전체에 단일값 `'open'`을 줘서
"누구나 신청 행 생성"을 허용하고, **신청 대상 모집글이 실제 모집 중인지는
validator가 검증**한다. 방장의 승인(상태 변경)은 기존 행 대상 쓰기라 §3.4가
**authorization row = 저장된 행** 기준으로 검사하므로, 방장이 신청 시점에 심은
`group_id` 값이 방장의 allowed에 있으면 통과한다 — 즉 **신청자가 신청 행에 본인
미소속 group_id를 심어도 방장 아니면 그 후 수정은 불가**하다. (쓰기 시 actor의
allowed가 그 값을 포함해야 하므로.)

**`verify_scope` 왜 필요한가** — 그룹 인증을 그룹원끼리만 공유하려면 `group_id`
하나로 충분하다(§4 스키마의 `verifications`는 `group_id`만 선언). 그런데 **내 인증
전체(개인 미션 포함)**를 한 구독으로 받고 싶으면 user 축이 필요해지고, 다중
선언 시 §3.4의 AND가 비그룹 개인 인증 쓰기를 막는다. 해결: 인증 테이블에
`verify_scope='live'`를 **단일 스코프**로 주고, 그룹별 필터링은 쿼리(WHERE
group_id IN …)로 한다. 스코프는 인가(누가 동기화하나)용, 쿼리는 뷰(무엇을
보여주나)용으로 분리하는 게 스펙 권장(§3.2 "Scopes are not server search indexes").

### 3.3 resolveScopes (서버가 직접 짜는 유일한 인가 함수)

```ts
resolveScopes: async ({ actorId }) => {
  const groups = await d1.query(
    `SELECT DISTINCT group_id FROM group_members
     WHERE user_id = ? AND role IN ('owner','member')`, [actorId]);
  const owned = await d1.query(
    `SELECT DISTINCT group_id FROM group_members WHERE user_id = ? AND role = 'owner`,
    [actorId]);
  return {
    public_id:  ['main'],                                // 공개 피드·모집글
    user_id:    [actorId],                               // 내 미션·포인트·배지
    group_id:   groups.map(g => g.group_id),             // 내가 속한 그룹
    apply_scope:['open'],                                // 누구나 신청 생성 가능
    verify_scope:['live'],                               // 인증 활동 (그룹원 인증 포함)
  };
};
```

### 3.4 스코프 패턴 → 데이터 흐름 매트릭스 (정정판)

| 테이블 | 스코프 패턴 | 읽기 | 쓰기 (§3.4 AND) | 비고 |
|---|---|---|---|---|
| `posts` | `public:{public_id}` | 전체 | 생성: validator가 `author_id=actor` 강제 | 수정은 validator가 소유자만 |
| `feed_items` | `public:{public_id}` | 전체 | validator: `user_id=actor` | |
| `cheers` | `public:{public_id}` | 전체 | validator: `user_id=actor` + UNIQUE 중복 방지 | |
| `user_profiles` | `public:{public_id}` | 전체(랭킹) | validator: `id=actor` (본인 프로필만) | |
| `applications` | `apply:{apply_scope}` | 전체가 읽고… **아니라** — 방장+신청자 | 신청 생성: `apply_scope='open'` 누구나 | 목록 쿼리가 postId별 필터. 방장 승인 쓰기는 authorization-row 규칙으로 자연 통과. **비밀 신청 메모는 v2.5 과제** |
| `group_members` | `group:{group_id}` | 그룹 멤버 | 방장(생성), validator: 그룹 방장만 | 승인 시 방장이 멤버십 행 upsert |
| `verifications` | `verify:{verify_scope}` | `verify_scope` 구독자(전원) | validator: `user_id=actor` | 그룹 인증 공유는 이 단일 축으로 해결 |
| `missions` | `user:{user_id}` | 본인 | 본인 (`user_id=actor` 자동) | |
| `point_ledger` | `user:{user_id}` | 본인 | 본인 | |
| `streaks` | `user:{user_id}` | 본인 | 본인 | |
| `badges` | `user:{user_id}` | 본인 | 본인 | |

### 3.5 validators (§6.7 — 소유권·비즈니스 규칙)

```ts
const validators: ValidatorRegistry = {
  posts: (op, ctx) => {
    if (op.op === 'upsert') {
      // 생성: author_id 위조 방지
      if (!op.existing && op.row.author_id !== ctx.actorId)
        throw new ValidationRejection('yadong.not_owner');
      // 수정: 기존 행 소유자만
      if (op.existing && op.existing.author_id !== ctx.actorId)
        throw new ValidationRejection('yadong.not_owner');
    }
  },
  feed_items: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  cheers: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  applications: async (op, ctx, read) => {
    if (op.op === 'upsert') {
      // 신청 생성: applicant_id 위조 방지 + 모집글 상태 검증
      if (!op.existing) {
        if (op.row.applicant_id !== ctx.actorId)
          throw new ValidationRejection('yadong.not_applicant');
        const post = await ctx.read.getRow('posts', op.row.post_id);
        if (!post || post.row.status !== 'recruiting' || post.row.deadline < todayStr())
          throw new ValidationRejection('yadong.post_closed');
      } else if (op.existing.applicant_id !== ctx.actorId) {
        // 상태 변경(승인/거절): 신청자도 아니면 → 방장인지 별도 검증
        const owner = await isGroupOwner(op.existing.post_id, ctx.actorId);
        if (!owner) throw new ValidationRejection('yadong.not_host');
      }
    }
  },
  verifications: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
    // 일 3회 인증 제한 등 비즈니스 규칙도 여기
  },
};
```

> validator는 커밋 트랜잭션 안에서 실행되고 throw 시 **커밋 전체가 원자 롤백**된다
> (§6.4). "MUST NOT mutate the row" — 검증만 하고 변형은 금지.

---

## 4. 스키마 (migrations/0001_initial.sql) — 정정판

```sql
-- ============ 공개 영역 ============

CREATE TABLE posts (
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
  status        TEXT NOT NULL DEFAULT 'recruiting',  -- recruiting|full|closed
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE feed_items (
  id            TEXT PRIMARY KEY,
  public_id     TEXT NOT NULL DEFAULT 'main',
  user_id       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  avatar        TEXT NOT NULL,
  mission_title TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  photo         BLOB_REF,                    -- ⭐ dataUrl 금지, Blob 참조만
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE cheers (
  id            TEXT PRIMARY KEY,            -- '{feed_id}:{user_id}:{type}'
  public_id     TEXT NOT NULL DEFAULT 'main',
  feed_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  cheer_type    TEXT NOT NULL CHECK (cheer_type IN ('fire','thumb','muscle')),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (feed_id, user_id, cheer_type)
);

CREATE TABLE user_profiles (
  id            TEXT PRIMARY KEY,            -- = user_id
  public_id     TEXT NOT NULL DEFAULT 'main',
  display_name  TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '💪',
  interests     TEXT NOT NULL DEFAULT '["홈트"]',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- ============ 모집·그룹 영역 ============

CREATE TABLE applications (
  id            TEXT PRIMARY KEY,            -- '{post_id}:{applicant_id}'
  apply_scope   TEXT NOT NULL DEFAULT 'open',  -- 신청 생성 허용 축
  post_id       TEXT NOT NULL,
  group_id      TEXT NOT NULL,               -- 'post:{post_id}' (방장 쓰기 인가용)
  applicant_id  TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_avatar TEXT NOT NULL DEFAULT '💪',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|rejected
  message       TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (post_id, applicant_id)
);

CREATE TABLE group_members (
  id            TEXT PRIMARY KEY,            -- '{group_id}:{user_id}'
  group_id      TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- owner|member
  joined_at_ms  INTEGER NOT NULL,
  UNIQUE (group_id, user_id)
);

-- ============ 인증 영역 (단일 스코프 — AND 문제 해결) ============

CREATE TABLE verifications (
  id            TEXT PRIMARY KEY,
  verify_scope  TEXT NOT NULL DEFAULT 'live',
  group_id      TEXT NOT NULL,               -- 개인 미션이면 'solo' (인가 아님, 쿼리용)
  user_id       TEXT NOT NULL,               -- 인증자 (validator가 actor 일치 검증)
  mission_id    TEXT NOT NULL,
  mission_title TEXT NOT NULL,
  mission_kind  TEXT NOT NULL CHECK (mission_kind IN ('daily','weekly','group')),
  date          TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  photo         BLOB_REF,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (user_id, mission_id)
);

-- ============ 개인 영역 ============

CREATE TABLE missions (
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

CREATE TABLE point_ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE streaks (
  id            TEXT PRIMARY KEY,            -- = user_id
  user_id       TEXT NOT NULL,
  current       INTEGER NOT NULL DEFAULT 0,
  best          INTEGER NOT NULL DEFAULT 0,
  last_date     TEXT,
  lottery_used_week TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE badges (
  id            TEXT PRIMARY KEY,            -- '{user_id}:{badge_id}'
  user_id       TEXT NOT NULL,
  badge_id      TEXT NOT NULL,               -- first|week7|month30|cheer50|verify100|group10
  earned_at_ms  INTEGER NOT NULL,
  UNIQUE (user_id, badge_id)
);
```

> `server_version` 열은 Syncular가 자체 관리(§2.4)하므로 마이그레이션에 넣지 않는다.
> `updated_at_ms`는 앱 도메인 값(클라이언트가 씀) — 혼동 주의.

---

## 5. syncular.json 매니페스트 (정정판)

```json
{
  "manifestVersion": 1,
  "migrations": "./migrations",
  "output": {
    "ir": "./syncular.ir.json",
    "module": "./src/syncular.generated.ts"
  },
  "schemaVersions": [{ "version": 1, "through": "0001_initial" }],
  "tables": [
    { "name": "posts",         "scopes": ["public:{public_id}"] },
    { "name": "feed_items",    "scopes": ["public:{public_id}"] },
    { "name": "cheers",        "scopes": ["public:{public_id}"] },
    { "name": "user_profiles", "scopes": ["public:{public_id}"] },
    { "name": "applications",  "scopes": ["apply:{apply_scope}"] },
    { "name": "group_members", "scopes": ["group:{group_id}"] },
    { "name": "verifications", "scopes": ["verify:{verify_scope}"] },
    { "name": "missions",      "scopes": ["user:{user_id}"] },
    { "name": "point_ledger",  "scopes": ["user:{user_id}"] },
    { "name": "streaks",       "scopes": ["user:{user_id}"] },
    { "name": "badges",        "scopes": ["user:{user_id}"] }
  ],
  "subscriptions": [
    { "name": "publicFeed",   "table": "feed_items",    "scopes": { "public_id": ["main"] } },
    { "name": "publicPosts",  "table": "posts",         "scopes": { "public_id": ["main"] } },
    { "name": "publicCheers", "table": "cheers",        "scopes": { "public_id": ["main"] } },
    { "name": "leaderboard",  "table": "user_profiles", "scopes": { "public_id": ["main"] } },
    { "name": "allApplies",   "table": "applications",  "scopes": { "apply_scope": ["open"] } },
    { "name": "allVerifs",    "table": "verifications", "scopes": { "verify_scope": ["live"] } },
    { "name": "myMissions",   "table": "missions",      "scopes": { "user_id": ["{actorId}"] } },
    { "name": "myLedger",     "table": "point_ledger",  "scopes": { "user_id": ["{actorId}"] } },
    { "name": "myStreak",     "table": "streaks",       "scopes": { "user_id": ["{actorId}"] } },
    { "name": "myBadges",     "table": "badges",        "scopes": { "user_id": ["{actorId}"] } }
  ]
}
```

**구독 전략 — 읽기는 심플하게**: 초안의 `{myGroups}` 치환 구독을 버렸다.
`allApplies`/`allVerifs`는 스코프가 단일값('open'/'live')이라 **전체 데이터가 다
동기화**되고, "내 글의 신청 목록", "우리 그룹 인증"은 **클라이언트 WHERE 쿼리**로
필터링한다. 사용자 수가 커지면(수천 명+) 그때 §4.8 windowing/구독 분할을 적용한다.
이렇게 하면 v1의 데이터 접근 패턴(S.posts 전체 스캔 → JS 필터)과 거의 동일해져
어댑터 전환이 단순해진다.

> 트레이드오프: 전체 applications/verifications가 모든 기기에 내려온다. 초기
> 커뮤니티 규모(수백~수천 인증/일)면 SQLite 로컬 쿼리로 문제없고, 규모 시
> windowing(§4.8)이 공식 답이다. 대안으로 verifications에 group 축+user 축 이중
> 선언은 AND 문제로 기각했다(§3.2 규칙 5 위반 — 부분 스코프만 받으면 revoke).

---

## 6. 데이터 흐름 시나리오

### 6.1 미션 인증 (오프라인 포함)

```
[인증 버튼] 사진 촬영 → 800px 리사이즈(기존 로직 유지) →
  ① client.uploadBlob(jpegBytes)            → blob_ref 확보
  ② mutate missions       {status:'done', verified_at_ms}  (baseVersion로 충돌 감지)
  ③ mutate verifications  {photo: blob_ref, verify_scope:'live', group_id:…}
  ④ mutate feed_items     {photo: blob_ref, public_id:'main'}
  ⑤ mutate point_ledger   {amount:10, balance_after}
  ⑥ streaks 재계산 upsert
→ 오프라인이면 ①~⑥ 전부 아웃박스 적재, 복귀 시 자동 flush (실측 동작)
→ 멤버십이 끊긴 그룹 인증이면 서버 reject → rejections 목록 → UI 안내
```

### 6.2 응원 보내기

`cheers` upsert(id 정규화 + UNIQUE로 중복 방지, validator가 user_id=actor 검증) +
`point_ledger`(+1P). 일 5회 제한은 앱이 오늘 날짜 cheers 쿼리로 선검사(클라이언트
검사) + validator 이중 검사(선택). 피드 카드 응원 수는 `SELECT cheer_type, COUNT(*)
FROM cheers WHERE feed_id = ?` 집계 — 기존 `cheers:{…}` 카운터 객체 폐지.

### 6.3 모집 → 그룹 전환

```
신청자: applications upsert (apply_scope:'open', status:'pending')
   → validator: post 모집중 검증, applicant 위조 방지
방장: applications upsert (status:'accepted')  ← 기존 행 대상 쓰기
   → §3.4 authorization-row 검사 (행의 group_id가 방장 allowed에 있음 → 통과)
   → validator: 방장 여부 재검증 (isGroupOwner)
방장: group_members upsert (group_id:'post:{id}', role:'member')
   → 그룹 스코프 쓰기는 방장 allowed에 group_id 있으므로 통과
신청자: 다음 pull에서 자기 user_id가 group_members에 생긴 것을 수신
   → resolveScopes 재계산으로 group_id allowed 확장 → 그룹 데이터 흐름 개시
   (스코프 허용 확장이므로 revoke 없이 자연 증가)
```

### 6.4 포인트·레벨·배지·랭킹

- 레벨 = `point_ledger.balance_after` 최신값 (기존 150/400/900/2000 임계 유지)
- 배지 = 조건 달성 시 `badges` upsert (기존 BADGES 로직 재사용)
- 주간 랭킹 = 이번 주 `point_ledger` 합계 + `user_profiles` 조인 — 더미 12명 대신 실제 유저

---

## 7. 기존 데이터 마이그레이션 (일회성)

v1 IndexedDB → Syncular 첫 로그인 시 로컬 임포트:

```js
async function importV1Data() {
  const v1 = await v1ReadAll();  // profile, posts, missions, verifs, feed, apps, ledger, badges
  const me = client.actorId;
  const ops = [];
  // 프로필 → user_profiles (public)
  ops.push({ table:'user_profiles', op:'upsert', values:{ id:me, public_id:'main',
    display_name:v1.profile.name, avatar:v1.profile.avatar, interests:JSON.stringify(v1.profile.interests||['홈트']),
    created_at_ms:Date.now(), updated_at_ms:Date.now() } });
  // 스트릭 → streaks (user)
  ops.push({ table:'streaks', op:'upsert', values:{ id:me, user_id:me,
    current:v1.profile.streak, best:v1.profile.streakBest, last_date:v1.profile.lastVerifyDate||null,
    updated_at_ms:Date.now() } });
  // 미션·인증·피드·원장·배지 … (§4 필드명 매핑)
  for (const m of v1.missions) ops.push({ table:'missions', op:'upsert', values:{
    id:'v1m'+m.id, user_id:me, kind:m.kind, date:m.date, week_key:m.weekKey,
    title:m.title, goal:m.goal||1, status:m.status,
    verified_at_ms:m.verifiedAt ? Date.parse(m.verifiedAt) : null,
    updated_at_ms:Date.now() } });
  // ⭐ v1 사진 dataUrl → Blob 업로드 후 blob_ref 치환
  for (const v of v1.verifs) {
    let photo = null;
    if (v.photoDataUrl) {
      const bytes = new Uint8Array(await (await fetch(v.photoDataUrl)).arrayBuffer());
      photo = await client.uploadBlob(bytes, { mediaType:'image/jpeg' });
    }
    ops.push({ table:'verifications', op:'upsert', values:{
      id:'v1v'+v.id, verify_scope:'live', group_id:'solo', user_id:me,
      mission_id:'v1m'+v.missionId, mission_title:v.missionTitle, mission_kind:'daily',
      date:v.date, memo:v.memo, photo, created_at_ms:Date.parse(v.createdAt) } });
  }
  // v1 모집글·신청·그룹 (내가 방장인 것만 승격; 시드 더미는 버림)
  ...
  await client.mutate(ops);
  await client.sync();
}
```

시드 더미(모집글 10건·피드 15건·유저 12명)는 미러링하지 않는다. 서버가 상시
유지하는 공식 샘플 모집글 3건만 public 피드에 남긴다(빈 앱 경험 완화).

---

## 8. 배포 토폴로지

| 계층 | 플랫폼 | 비고 |
|---|---|---|
| 프론트 (PWA) | OnDev (기존 유지) | index.html + app.js + worker.js + manifest 정적 서빙 |
| Sync 서버 | Cloudflare Workers (무료 티어) | `@syncular/server-workers` + D1 |
| Blob (사진) | Cloudflare R2 | 콘텐츠 어드레싱, 다운로드마다 인가 재검사(§5.9) |
| 인증 | Workers KV + 서명 토큰 | 익명 디바이스 토큰 → v2.5 소셜 업그레이드 |

**비용**: Workers 무료(10만 req/일) + D1(5GB) + R2(10GB)면 초기 수천 사용자까지 $0.

---

## 9. 리스크 & 오픈 이슈

| # | 리스크 | 완화 |
|---|---|---|
| 1 | syncular v0.15.x pre-1.0 breaking change | `syncular.migrations.lock.json` 커밋 + 버전 고정, 업데이트 시 레포 내장 conformance 스위트 실행 |
| 2 | Bun 1.4.0 조건부 exports 충돌 (실측) | 서버·테스트 전부 Node 22+ 또는 Workers로 통일 |
| 3 | OPFS 미지원 구형 브라우저 | Chrome/Edge 109+, Safari 16.4+ — 2023년 이후 기기 커버 |
| 4 | 전체 applications/verifications 동기화 (§5 트레이드오프) | 초기 규모엔 충분; 성장 시 §4.8 windowing 또는 구독 분할 마이그레이션 |
| 5 | 응원 스팸·포인트 인플레이션 | validator 이중 검증 + guide-domain-events 패턴의 서버 명령 승격 (v2.5) |
| 6 | 무한 아웃박스 증가 (장기 오프라인) | outbox 카운터 UI + "보호된 저장소" 안내 (퀵스타트 웹 템플릿 패턴) |
| 7 | 신청 비밀 메시지가 전원에게 동기화됨 | v2에선 message 필드 공개 전제. 프라이빗 신청은 v2.5에서 서버 명령+별도 저장으로 |
| 8 | 스코프 열 불변(§3.4 rule 5) | 모집글 마감·그룹 이동은 스코프 열이 아니라 status 등 도메인 열 변경으로 처리 (설계 반영됨) |

---

## 10. 단계별 착수 계획

| 단계 | 내용 | 산출물 |
|---|---|---|
| 0 | `bun create syncular-app yadonghaja-v2 --template web` (빌드는 Node로) | 스캐폴드 |
| 1 | 본 문서 §4·§5 그대로 `syncular.json` + `migrations/0001_initial.sql` → `syncular generate` | 생성 타입 + IR + lock |
| 2 | `resolveScopes` + validators(§3.3·§3.5) + 익명 auth | Workers 배포 |
| 3 | sync-adapter.js — 기존 UI의 dbAdd/dbPut/dbAll 교체 | 프론트 전환 |
| 4 | v1 임포터(§7) + Playwright E2E (기존 16 시나리오 + 2클라이언트 수렴) | 검증 리포트 |
| 5 | OnDev 재배포 (신규 claim URL) | 배포본 |
| 6 | v1 사용자 베타 안내 | 피드백 |

---

## 부록 A: v1 → v2 매핑 표

| v1 IndexedDB | v2 테이블 | 주요 변환 |
|---|---|---|
| `profile`(단일) | `user_profiles` + `streaks` | 공개/비공개 분리 |
| `posts` | `posts` | `mine` → `author_id = me` 쿼리 |
| `apps` | `applications` + `group_members` | 승인 시 멤버십 파생 |
| `missions` | `missions` | id 문자열 정규화, ISO→ms 에폭 |
| `verifs` | `verifications` | `photoDataUrl` → `BLOB_REF` |
| `feed` | `feed_items` + `cheers` | 카운터 → 집계 쿼리 |
| `badges` | `badges` | `{user_id}:{badge_id}` 복합키 |
| `ledger` | `point_ledger` | `balance_after` 스냅샷 (랭킹 O(1)) |
| `kv` | (없음) | 시드 플래그 → 임포터 마커 |

## 부록 B: 초안 → 정정판 변경 요약

| 항목 | 초안 (오류) | 정정판 (스펙 기준) |
|---|---|---|
| 다중 스코프 시맨틱 | OR 결합으로 해석 | **AND** (§3.4 "All declared keys are required") |
| verifications 스코프 | `group:{group_id}` + `user:{user_id}` 이중 선언 | 단일 `verify:{verify_scope}` + 쿼리 필터 |
| 구독 변수 치환 | `{myGroups}` 런타임 배열 구독 | 단일값 스코프 구독 + 클라이언트 WHERE (초기 규모) |
| 모집 신청 | group 스코프 안에 배치 (비멤버 쓰기 불가) | `apply:{apply_scope}` 별도 축 + validator 검증 |
| 공개 테이블 소유권 | 스코프가 지켜줄 것이라 암묵 가정 | §6.7 validators가 author/user 일치 강제 |
| applications 읽기 | 방장+신청자만 | 전원 동기화 + 쿼리 필터 (v2.5에 프라이빗 승격 과제) |

## 부록 C: 검증 로그 (2026-08-30 실측)

```
$ node server-node.mjs                 # 퀵스타트 서버 (Node 22 + Hono 브릿지)
syncular quickstart server (node bridge): http://127.0.0.1:8787

$ node convergence-test.mjs
[conv] 클라이언트 2개 기동
[conv] A가 todo-1 쓰기 (upsert)
[conv] A 아웃박스 flush 완료
[conv] B 풀 완료
[conv] B 읽기: [{"id":"todo-1","title":"Buy milk","done":0}]
[conv] 역방향 B→A: [{"id":"todo-1"},{"id":"todo-2"}]
RESULT: PASS — 양방향 수렴 확인
BIDIR: PASS
```

- Bun 1.4.0에서 `@syncular/client` 조건부 exports가 L2S 캐시 충돌로 실패
  (npm 0.15.48) — Node 22 정상. 서버/클라 모두 Node 계열 확정.
- 스키마 로드 → `ensureSyncServerReady` 356ms (in-memory).
- 스코프 AND/서브셋 규칙·validator API는 SPEC.md §3.2·§3.4·§6.7 +
  `packages/server/src/validate.ts` 소스에서 직접 확인.