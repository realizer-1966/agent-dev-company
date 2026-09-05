# 야!동하자 Sync 서버 — 수동 배포 가이드

Cloudflare 브라우저 로그인이 불가능한 환경에서는 아래 단계를 **수동**으로 진행하세요.

## 1 단계: Cloudflare 대시보드에서 리소스 생성

### 1.1 D1 데이터베이스 생성

https://dash.cloudflare.com/?to=/:account/workers/d1

1. **"Create database"** 클릭
2. 이름: `yadonghaja-sync`
3. **"Create database"** 클릭
4. 생성 후 **Database ID** 복사 (예: `abc123...`)

### 1.2 R2 버킷 생성

https://dash.cloudflare.com/?to=/:account/r2

1. **"Create bucket"** 클릭
2. 이름: `yadonghaja-blobs`
3. **"Create bucket"** 클릭

### 1.3 R2 API 토큰 발급

https://dash.cloudflare.com/?to=/:account/r2/api-tokens

1. **"Create API token"** 클릭
2. 이름: `yadonghaja-worker`
3. 권한: `Object Read & Write`
4. 버킷: `yadonghaja-blobs` (선택)
5. **토큰 3 개 복사**:
   - `R2_ACCOUNT_ID` (Cloudflare Account ID)
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`

### 1.4 HMAC 키 생성

```bash
openssl rand -hex 32
```

출력된 값 (64 자리 16 진수) 을 `SYNC_HMAC_KEY` 로 사용

---

## 2 단계: wrangler.toml 수정

`sync-server/wrangler.toml` 파일에서 다음 값을 실제 값으로 교체:

```toml
[[d1_databases]]
binding = "SYNC_D1"
database_name = "yadonghaja-sync"
database_id = "여기에_D1_Database_ID_입력"

[[r2_buckets]]
binding = "SYNC_R2"
bucket_name = "yadonghaja-blobs"
```

---

## 3 단계: 시크릿 설정 (wrangler 사용)

wrangler 가 설치되어 있고 로그인된 경우:

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server

# HMAC 키 설정
wrangler secret put SYNC_HMAC_KEY
# (openssl rand -hex 32 출력값 입력)

# R2 크리덴셜 설정
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

**wrangler 로그인이 안 되는 경우**, 대시보드에서 직접 설정:

https://dash.cloudflare.com/?to=/:account/workers/services/view/yadonghaja-sync/production/settings/environment-variables

1. **"Add environment variable"** 클릭
2. Type: **Secret** (중요!)
3. 변수명과 값 입력:
   - `SYNC_HMAC_KEY`: `openssl rand -hex 32` 출력값
   - `R2_ACCESS_KEY_ID`: 1 단계에서 복사
   - `R2_SECRET_ACCESS_KEY`: 1 단계에서 복사
   - `R2_ACCOUNT_ID`: 1 단계에서 복사

---

## 4 단계: D1 마이그레이션 적용

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server

# 로컬 (오프라인) 마이그레이션
wrangler d1 migrations apply yadonghaja-sync --local

# 리모트 (실제 D1) 마이그레이션
wrangler d1 migrations apply yadonghaja-sync --remote
```

---

## 5 단계: Workers 배포

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server
wrangler deploy
```

배포 후 출력된 URL 메모 (예: `https://yadonghaja-sync.<subdomain>.workers.dev`)

---

## 6 단계: 프론트 연동

`web/src/app.js` 에서 baseUrl 변경:

```javascript
// 기존
sync = await createSyncAdapter(actorId, 'http://127.0.0.1:8788');

// 변경
sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync.<subdomain>.workers.dev');
```

재빌드 및 배포:

```bash
cd web
npm run build
zip -r yadonghaja-v2.3.zip dist/
# OnDev 배포
```

---

## ✅ 검증

1. 브라우저에서 앱 오픈
2. F12 개발자도구 → Console 에서 `[sync] Syncular 연결 성공` 확인
3. 두 개의 브라우저 탭에서 동기화 테스트
