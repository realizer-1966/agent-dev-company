# 야!동하자 Sync 서버 — Cloudflare 배포 가이드

## 1. Cloudflare 로그인

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server
wrangler login
```

브라우저가 열리지 않으면:
```bash
# URL 을 복사해서 브라우저에서 열고, 인증코드 입력
wrangler login --scopes=account:read,user:read,workers:write,d1:write
```

## 2. D1 데이터베이스 생성

```bash
wrangler d1 create yadonghaja-sync
```

출력된 `database_id` 를 `wrangler.toml` 에 기입:
```toml
[[d1_databases]]
binding = "DB"
database_name = "yadonghaja-sync"
database_id = "여기에_복사"  # ← create 출력에서 복사
```

## 3. R2 버킷 생성

```bash
wrangler r2 bucket create yadonghaja-blobs
```

## 4. 시크릿 설정

```bash
# SYNC_HMAC_KEY 생성 (임의 32 바이트)
openssl rand -hex 32

# 생성된 값으로 시크릿 설정
wrangler secret put SYNC_HMAC_KEY
# (프롬프트에 값 붙여넣기)

# R2 시크릿 (Cloudflare 대시보드 → R2 → API 토큰에서 발급)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

## 5. D1 마이그레이션 적용

```bash
# 로컬 스키마 확인
wrangler d1 migrations apply yadonghaja-sync --remote
```

## 6. Workers 배포

```bash
wrangler deploy
```

출력:
```
✅ yadonghaja-sync
   https://yadonghaja-sync.<subdomain>.workers.dev
```

## 7. 프론트 endpoint 변경

`web/src/app.js` 의 `createSyncAdapter` 호출을 수정:

```js
// 기존
sync = await createSyncAdapter(actorId, 'http://127.0.0.1:8788');

// 변경
sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync.<subdomain>.workers.dev');
```

## 8. OPFS 활성화

`web/src/worker.js` 에서 OPFS 사용 확인:

```js
await handle.startSync({
  // ...
  useOpfs: true,  // ← 추가 (기본값 true)
});
```

## 9. 프론트 재빌드 및 배포

```bash
cd ../web
npm run build
# ZIP 생성 → OnDev 배포
```

## 10. 검증

1. 브라우저에서 앱 실행
2. F12 → Application → OPFS → sqlite 데이터베이스 확인
3. 네트워크 탭 → `/sync` POST 요청 확인
4. 다른 브라우저 탭에서 동기화 확인

## 문제 해결

### `Error: Cloudflare account not found`
```bash
wrangler logout
wrangler login
```

### `D1 database already exists`
```bash
wrangler d1 delete yadonghaja-sync
wrangler d1 create yadonghaja-sync
```

### `R2 bucket already exists`
```bash
wrangler r2 bucket delete yadonghaja-blobs
wrangler r2 bucket create yadonghaja-blobs
```

### `Secrets not found`
```bash
wrangler secret list
# 누락된 시크릿 재설정
wrangler secret put <NAME>
```
