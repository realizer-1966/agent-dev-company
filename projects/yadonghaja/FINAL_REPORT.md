# 야!동하자 v2.5 — 본계정 Cloudflare Workers 배포 완료

**작성일**: 2026-09-05  
**버전**: v2.5 (본계정 Workers 배포)  
**Workers URL**: https://yadonghaja-sync-v2.dydtnsp.workers.dev  
**상태**: 🟡 배포 완료, 403 문제 해결 필요

---

## ✅ 완료된 작업

### 1. 본계정 인프라 생성

| 리소스 | 이름 | ID | 상태 |
|---|---|---|---|
| **D1 Database** | yadonghaja-sync-prod | c8ac479a-2cd5-4064-a2a5-7cc6171e1cc6 | ✅ 생성됨 |
| **R2 Bucket** | yadonghaja-blobs-prod | - | ✅ 생성됨 |
| **Workers** | yadonghaja-sync-v2 | a63fff5b-66a7-449f-aa98-5ccd1abf378f | ✅ 배포됨 |

### 2. Workers 배포

**URL**: https://yadonghaja-sync-v2.dydtnsp.workers.dev

**바인딩**:
```toml
[[d1_databases]]
binding = "DB"
database_name = "yadonghaja-sync-prod"
database_id = "c8ac479a-2cd5-4064-a2a5-7cc6171e1cc6"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "yadonghaja-blobs-prod"
```

**엔드포인트**:
- `GET /health` — 헬스체크 (x-user 헤더 선택)
- `POST /sync` — Syncular 동기화 (x-user 필수)
- `POST /segments` — 세그먼트 저장
- `POST /blobs` — 사진 업로드 (presigned URL)

---

## ⚠️ 현재 문제: 403 Forbidden

### 증상

```bash
curl https://yadonghaja-sync-v2.dydtnsp.workers.dev/health
# HTTP 403: Forbidden
# error code: 1010
```

### 원인 분석

1. **API 토큰 권한 부족**
   - wrangler deploy 는 성공
   - 하지만 실제 HTTP 요청이 403 반환
   - API 토큰에 D1/R2 접근 권한이 부족할 가능성

2. **Cloudflare 인증 레이어**
   - 임시 계정 (Salt Hero) 에서는 정상 작동
   - 본계정 (dydtnsp) 에서 403 발생
   - 토큰 형식 또는 권한 스코프 문제

### 해결 방법

#### 방법 1: API 토큰 재발급 (권장)

1. https://dash.cloudflare.com/profile/api-tokens 접속
2. 기존 토큰 삭제
3. 새 토큰 생성:
   - **템플릿**: "Edit Cloudflare Workers"
   - **추가 권한**: 
     - D1: Edit
     - R2: Edit
     - Workers: Edit
4. 새 토큰으로 `wrangler deploy` 재시도

#### 방법 2: 대시보드에서 직접 배포

1. https://dash.cloudflare.com/?to=/:account/workers/view/yadonghaja-sync-v2 접속
2. **Quick Edit** 클릭
3. `worker-v2.4.js` 코드 복사/붙여넣기
4. **Deploy** 클릭
5. D1/R2 바인딩 수동 설정

#### 방법 3: wrangler config 초기화

```bash
# 기존 config 삭제
rm ~/.config/.wrangler/config.toml

# wrangler 로그인 (브라우저)
wrangler login

# 재배포
cd /root/workspace/agent-dev-company/projects/yadonghaja/sync-server
wrangler deploy
```

---

## 📊 테스트 결과

### E2E 테스트 (로컬 인메모리)

```
🚀 yadonghaja v2.1 E2E
✅ 온보딩 완료
✅ 홈 탭 렌더링됨
✅ 모집 탭 렌더링됨
✅ 미션 탭 렌더링됨
✅ 피드 탭 렌더링됨
✅ 프로필 탭 렌더링됨

🎉 E2E 통과 — 모든 탭 정상!
```

**상태**: ✅ **로컬 테스트는 정상** (인메모리 fallback)

### Workers Health Check

```
❌ HTTP 403: Forbidden
   Body: error code: 1010
```

**상태**: 🟡 **403 문제** (인증 레이어)

---

## 🔧 기술 스택

| 계층 | 기술 | URL/버전 |
|---|---|---|
| **프론트** | HTML/JS/Tailwind | v2.5 |
| **동기화** | Syncular | v0.15.48 |
| **SQLite** | OPFS + wasm | @sqlite.org/sqlite-wasm |
| **백엔드** | Cloudflare Workers | https://yadonghaja-sync-v2.dydtnsp.workers.dev |
| **DB** | Cloudflare D1 | yadonghaja-sync-prod |
| **Storage** | Cloudflare R2 | yadonghaja-blobs-prod |

---

## 📁 주요 파일

```
projects/yadonghaja/
├── web/
│   ├── src/
│   │   ├── app.js              ✅ Workers URL 연동 (임시: 로컬)
│   │   ├── sync.js             ✅ Syncular 어댑터
│   │   ├── schema.ts           ✅ 12 테이블 스키마
│   │   └── worker.js           ✅ Sync 워커
│   └── dist/                   ✅ 빌드 산출물 (1.4MB)
├── sync-server/
│   ├── src/
│   │   └── worker-v2.4.js      ✅ Workers 엔트리 (본계정)
│   └── wrangler.toml           ✅ 본계정 D1/R2 설정
└── DEPLOY_COMPLETE.md          ✅ 배포 완료 보고서
```

---

## 🚀 다음 단계

### 1. Workers 403 문제 해결 (우선)

**가장 빠른 방법**: 대시보드에서 직접 배포

```bash
# 1. worker-v2.4.js 내용 복사
cat /root/workspace/agent-dev-company/projects/yadonghaja/sync-server/src/worker-v2.4.js

# 2. Cloudflare 대시보드 접속
https://dash.cloudflare.com/?to=/:account/workers/view/yadonghaja-sync-v2

# 3. Quick Edit 에서 코드 붙여넣기 및 Deploy

# 4. D1/R2 바인딩 설정
#    - DB → yadonghaja-sync-prod
#    - BUCKET → yadonghaja-blobs-prod
```

### 2. 프론트 Workers URL 로 변경

`web/src/app.js` 수정:

```javascript
// 현재 (로컬 테스트용)
sync = await createSyncAdapter(actorId, 'http://127.0.0.1:8788');

// 변경 (Workers 연동)
sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync-v2.dydtnsp.workers.dev');
```

### 3. 재빌드 및 테스트

```bash
cd web
npm run build

# 로컬 서버 재시작
node test-server.mjs &

# 브라우저에서 접속
# http://127.0.0.1:8788
```

### 4. 2 사용자 동기화 테스트

1. 탭 A: 사용자 A 로 온보딩 → 모집글 작성
2. 탭 B: 사용자 B 로 온보딩 → 모집글 조회
3. 동기화 확인 (실시간 업데이트)
4. 응원 보내기 → 즉시 확인

### 5. OnDev 배포 (v2.5)

```bash
cd web
npm run build
zip -r yadonghaja-v2.5.zip dist/
# OnDev Store 에 업로드
```

---

## 📈 버전 히스토리

| 버전 | 날짜 | 주요 변경사항 |
|---|---|---|
| v2.0 | 2026-08-30 | 인메모리 스토어, 기본 UI |
| v2.1 | 2026-09-04 | Syncular 연결 시도, wasm 404 문제 |
| v2.2 | 2026-09-05 | Syncular OPFS 완성, 스키마 정합성 |
| v2.3 | 2026-09-05 | 인메모리 로컬 테스트 완성 |
| v2.4 | 2026-09-05 | 임시 계정 Workers 배포 (Salt Hero) |
| **v2.5** | **2026-09-05** | **본계정 Workers 배포 (dydtnsp)** |
| v2.6 | (예정) | 403 문제 해결, 2 사용자 동기화 |

---

## 🔗 링크

- **Workers URL**: https://yadonghaja-sync-v2.dydtnsp.workers.dev
- **GitHub**: https://github.com/realizer-1966/agent-dev-company/commit/e2b4372
- **D1 대시보드**: https://dash.cloudflare.com/?to=/:account/workers/d1/c8ac479a-2cd5-4064-a2a5-7cc6171e1cc6
- **R2 대시보드**: https://dash.cloudflare.com/?to=/:account/r2
- **Workers 대시보드**: https://dash.cloudflare.com/?to=/:account/workers/view/yadonghaja-sync-v2
- **배포 가이드**: `DEPLOY_GUIDE.md`
- **완료 보고서**: `DEPLOY_COMPLETE.md`
- **스킬**: `mlops/syncular-opfs-webapp`

---

## ✅ 체크리스트

- [x] 로컬 서버 실행
- [x] E2E 테스트 통과 (인메모리)
- [x] 스키마 정합성 확보
- [x] wasm 404 해결
- [x] 인메모리 어댑터 완성
- [x] 배포 가이드 작성
- [x] 스킬 저장
- [x] GitHub 푸시
- [x] 임시 계정 Workers 배포
- [x] 본계정 D1 생성
- [x] 본계정 R2 생성
- [x] 본계정 Workers 배포
- [ ] Workers 403 문제 해결
- [ ] 2 사용자 동기화 테스트
- [ ] OnDev 배포 (v2.5)

---

**상태**: 🟡 **Workers 배포 완료, 403 문제 해결 대기 중**

**다음 액션**: Cloudflare 대시보드에서 직접 배포 또는 API 토큰 재발급
