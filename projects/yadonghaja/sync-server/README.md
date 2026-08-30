# yadonghaja-sync-server

야!동하자 v2 — Syncular 동기화 서버 (Cloudflare Workers + D1 + R2).

설계안: [../SYNCULAR_DESIGN.md](../SYNCULAR_DESIGN.md) — 스키마(§4), 스코프(§3),
이 Worker의 배포 토폴로지(§8).

## 구조

```
sync-server/
├── src/
│   ├── worker.ts              # Workers 엔트리 — resolveScopes·validators·auth·DO
│   └── syncular.generated.ts  # 스키마(11 테이블) — typegen 출력 포맷 (⚠️ 착수 단계 1에서 syncular generate로 교체)
├── migrations/
│   ├── 0001_syncular_server.sql  # Syncular 서버 테이블 (sqliteDdlStatements() 자동 생성)
│   └── 0002_yadonghaja_app.sql   # 앱 테이블 (설계안 §4)
├── scripts/regen-ddl.js       # 서버 테이블 DDL 재생성 (syncular 버전업 시)
├── local-test.mjs             # Node 로컬 검증 — 스키마·validator·스코프 격리 5/5 PASS
├── wrangler.toml             # Workers 배포 설정 (D1/R2/DO 바인딩)
└── package.json
```

## 로컬 검증 (서버 배포 없이)

```sh
npm install
node local-test.mjs
# ✅ 스키마 컴파일 + 서버 준비 (11 테이블)
# ✅ 모집글 A→B 수렴 (public 스코프)
# ✅ validator: B의 A 모집글 수정 → yadong.not_owner 거부
# ✅ 모집 신청 B→A (apply_scope)
# ✅ 개인 스코프 격리: A 미션은 B 미수신
# 결과: 5/5 통과
```

## Cloudflare 배포 절차 (실제 순서)

```sh
# 0) 사전 준비 — wrangler 로그인 (한 번)
npx wrangler login

# 1) D1 데이터베이스 생성 → 출력된 database_id를 wrangler.toml에 기입
npx wrangler d1 create yadonghaja-sync

# 2) R2 버킷 생성 (세그먼트+인증 사진)
npx wrangler r2 bucket create yadonghaja-blobs

# 3) 시크릿 설정 (R2 S3 API 키: 대시보드 → R2 → Manage API Tokens)
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put SYNC_HMAC_KEY

# 4) D1 마이그레이션 적용 (로컬 먼저, 그다음 원격)
npx wrangler d1 migrations apply yadonghaja-sync --local
npx wrangler d1 migrations apply yadonghaja-sync --remote

# 5) 배포
npx wrangler deploy
# → https://yadonghaja-sync.<계정>.workers.dev/sync

# 6) 토큰 발급(클라이언트 배포판에 적용) — HMAC 토큰 생성 예시:
#    payload = base64url({"uid":"u_<ulid>"}), sig = HMAC-SHA256(payload, SYNC_HMAC_KEY)
```

## 라우트 (배포 후)

| Route | 용도 |
|---|---|
| `POST /sync` | push+pull (파티션 DO에서 직렬화) |
| `GET /segments/:id` | 부트스트랩 세그먼트 |
| `PUT /blobs/:id` | 인증 사진 업로드 (SHA-256 검증) |
| `GET /blobs/:id` | 사진 다운로드 (행 유래 재인가) |

## 유지보수

- **syncular 버전 업그레이드 시**: `node scripts/regen-ddl.js` → 새 마이그레이션
  파일 검토 → `wrangler d1 migrations apply --remote`
- **스키마 변경**: `migrations/0003_...` 추가 + `src/syncular.generated.ts` 재생성
  (`syncular generate`) — 기존 마이그레이션은 절대 수정 금지 (lock 파일 관리)
- **v2.5 realtime WebSocket**: `worker.ts`의 `coordinator` → `realtime` 팩토리로 교체

## 비고

- 이 프로젝트의 Worker/DO 코드는 패키지 `@syncular/server-workers` README의
  "Usage"·"Wiring" 패턴 그대로다 (v0.15.48 기준).
- wrangler dev 로컬 실행도 가능하나 workerd 번들이 100MB+이므로, 로컬 검증은
  `local-test.mjs`(Node)로 하는 것이 빠르다.
- `local-test.mjs`의 인증은 테스트용 `x-user` 헤더 — 실제 배포본은 worker.ts의
  HMAC Bearer 토큰 인증을 쓴다.