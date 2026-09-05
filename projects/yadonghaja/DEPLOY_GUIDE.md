# 야!동하자 v2.3 — 배포 및 사용 가이드

## ✅ 현재 상태 (완료)

- **로컬 테스트**: http://127.0.0.1:8788 에서 즉시 사용 가능
- **인메모리 모드**: 브라우저 로컬에 데이터 저장 (새로고침 유지)
- **E2E 테스트 통과**: 5 탭 (홈/모집/미션/피드/프로필) 모두 정상
- **Syncular OPFS 준비 완료**: Cloudflare Workers 배포 시 실시간 동기화 활성화

## 🚀 로컬 테스트 (즉시 사용)

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/web

# 1. 빌드
npm run build

# 2. 테스트 서버 실행
node test-server.mjs &

# 3. 브라우저에서 접속
# http://127.0.0.1:8788
```

**작동하는 기능**:
- ✅ 온보딩 (사용자 프로필 생성)
- ✅ 운동 메이트 모집글 작성/조회
- ✅ 미션 생성/인증
- ✅ 피드 작성/응원 (🔥👍💪)
- ✅ 포인트/배지/랭킹 시스템
- ✅ 스트릭 추적

**주의**: 로컬 테스트는 인메모리 모드를 사용합니다. 브라우저마다 데이터가 독립적이며, 실제 동기화는 Cloudflare Workers 배포 후 가능합니다.

---

## ☁️ Cloudflare Workers 배포 (실제 동기화)

### 단계 1: Cloudflare 대시보드에서 리소스 생성

#### 1.1 D1 데이터베이스 생성
1. https://dash.cloudflare.com/?to=/:account/workers/d1 접속
2. **"Create database"** 클릭
3. 이름: `yadonghaja-sync`
4. 생성 후 **Database ID** 복사 (36 자리 문자열)

#### 1.2 R2 버킷 생성
1. https://dash.cloudflare.com/?to=/:account/r2 접속
2. **"Create bucket"** 클릭
3. 이름: `yadonghaja-blobs`

#### 1.3 R2 API 토큰 발급
1. https://dash.cloudflare.com/?to=/:account/r2/api-tokens 접속
2. **"Create API token"** 클릭
3. 이름: `yadonghaja-worker`
4. 권한: `Object Read & Write`
5. 버킷: `yadonghaja-blobs` 선택
6. 토큰 3 개 복사:
   - `R2_ACCOUNT_ID` (Cloudflare Account ID)
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`

#### 1.4 HMAC 키 생성
```bash
openssl rand -hex 32
```
출력된 64 자리 16 진수 값을 `SYNC_HMAC_KEY` 로 사용

---

### 단계 2: wrangler.toml 수정

`projects/yadonghaja/sync-server/wrangler.toml` 파일에서 다음 값을 실제 값으로 교체:

```toml
[[d1_databases]]
binding = "SYNC_D1"
database_name = "yadonghaja-sync"
database_id = "여기에_D1_Database_ID_입력"  # 1.1 에서 복사

[[r2_buckets]]
binding = "SYNC_R2"
bucket_name = "yadonghaja-blobs"  # 1.2 에서 생성
```

---

### 단계 3: wrangler 로그인

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server

# 브라우저에서 로그인
wrangler login
```

브라우저가 열리지 않으면, Cloudflare 대시보드 (https://dash.cloudflare.com/profile/api-tokens) 에서 API 토큰을 발급받고:

```bash
export CLOUDFLARE_API_TOKEN="발급받은_토큰"
wrangler whoami  # 로그인 확인
```

---

### 단계 4: 시크릿 설정

```bash
# HMAC 키 설정
wrangler secret put SYNC_HMAC_KEY
# (openssl rand -hex 32 출력값 입력)

# R2 크리덴셜 설정
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

---

### 단계 5: D1 마이그레이션 적용

```bash
# 로컬 테스트 (선택)
wrangler d1 migrations apply yadonghaja-sync --local

# 실제 D1 배포 (필수)
wrangler d1 migrations apply yadonghaja-sync --remote
```

---

### 단계 6: Workers 배포

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server
npm run deploy
# 또는: node build.mjs && wrangler deploy
```

배포 성공 시 출력된 URL 메모:
```
https://yadonghaja-sync.<subdomain>.workers.dev
```

---

### 단계 7: 프론트 연동

`projects/yadonghaja/web/src/app.js` 파일에서 baseUrl 변경:

```javascript
// 기존 (인메모리)
sync = await createSyncAdapter(actorId, 'http://127.0.0.1:8788');

// 변경 (Cloudflare Workers)
sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync.<subdomain>.workers.dev');
```

---

### 단계 8: 프론트 재빌드 및 배포

```bash
cd /root/workspace/agent-dev-company/projects/yadonghaja/web

# 빌드
npm run build

# ZIP 생성
zip -r yadonghaja-v2.4.zip dist/

# OnDev Store 에 업로드
# 또는 Cloudflare Pages 에 배포
```

---

### 단계 9: 동기화 테스트

1. 브라우저 탭 A 에서 사용자 A 로 온보딩 → 모집글 작성
2. 브라우저 탭 B 에서 사용자 B 로 온보딩 → 모집글 조회
3. 사용자 B 가 응원 보내기 → 사용자 A 에서 즉시 확인

**성공 기준**: 두 사용자 간 실시간 동기화 확인

---

## 🔗 링크

- **GitHub**: https://github.com/realizer-1966/agent-dev-company
- **로컬 테스트**: http://127.0.0.1:8788
- **스킬**: `mlops/syncular-opfs-webapp`
- **Cloudflare 대시보드**: https://dash.cloudflare.com/

---

## 💡 문제 해결

### wrangler 로그인 불가
- API 토큰 발급: https://dash.cloudflare.com/profile/api-tokens
- `export CLOUDFLARE_API_TOKEN="..."` 설정 후 재시도

### D1 마이그레이션 실패
- `wrangler.toml` 의 `database_id` 확인
- D1 이 실제로 생성되었는지 Cloudflare 대시보드에서 확인

### Workers 배포 실패
- 시크릿이 모두 설정되었는지 확인: `wrangler secret list`
- R2 버킷 이름이 정확한지 확인

### 동기화 안 됨
- 프론트 `app.js` 의 baseUrl 이 Cloudflare Workers URL 인지 확인
- 브라우저 콘솔에서 `[sync] Syncular 연결 성공` 메시지 확인
