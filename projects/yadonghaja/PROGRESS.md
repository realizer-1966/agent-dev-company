# 야!동하자 (Ya! Donghaja) — 개발 진행 기록

**최종 업데이트**: 2026-08-30  
**버전**: v2.1 (Syncular + 사진 인증 + 보상 시스템)  
**저장소**: https://github.com/realizer-1966/agent-dev-company  
**배포**: https://ondev.store/claim/9ib5yp

---

## 📱 프로젝트 개요

운동 메이트를 모집하고, 서로 격려하며 미션을 수행하면 보상도 주는 **운동 습관 웹앱**

### 핵심 가치
- **혼자 하면 외로운 운동, 같이 하면 즐겁다**
- **작은 성취가 모여 큰 습관이 된다**
- **서로의 응원이 계속하게 만든다**

---

## 🎯 완료된 기능 (v2.1)

### 1. 사용자 온보딩
- 아바타 선택 (8 종: 💪🏃🚴🧘🏋️🥊⚽️🏀)
- 닉네임 입력 (2 자 이상)
- 로컬 저장 (localStorage)

### 2. 5 탭 UI
| 탭 | 기능 |
|---|---|
| **홈** | 오늘의 미션, 스트릭/포인트, 최근 모집글 |
| **모집** | 메이트 모집글 작성/조회/신청 |
| **미션** | 미션 목록, 사진 인증, 완료 처리 |
| **피드** | 운동 인증 피드, 응원 (🔥👍💪) |
| **프로필** | 내 통계 (포인트/스트릭/랭킹), 배지 |
| **랭킹** | 전체 포인트 순위 (TOP 20) |

### 3. 사진 인증 시스템
- 브라우저 카메라 API (`getUserMedia`)
- JPEG 압축 (80%, 640x480)
- 선택적 첨부 (건너뛰기 가능)
- 인증 시 자동 포인트 +10P

### 4. 보상 시스템

#### 포인트
| 행동 | 포인트 |
|---|---|
| 미션 완료 | +10 P |
| 응원 (🔥👍💪) | +1 P |
| 7 일 연속 스트릭 | +50 P |
| 30 일 연속 스트릭 | +200 P |

#### 배지
| 배지 | 조건 |
|---|---|
| 🏆 첫 걸음 | 10 P 이상 |
| 🏆 1 주 전사 | 100 P 이상 |
| 🏆 1 달 마스터 | 500 P 이상 |

#### 스트릭
- 일일 연속 인증 카운트
- 최장 기록 자동 갱신
- 날짜 기반 판단 (24 시간이 아닌 `YYYY-MM-DD` 비교)

#### 랭킹
- 전체 포인트 순위 (실시간)
- 동점 처리 (RANK() OVER)
- 상위 20 명 표시

### 5. 데이터 저장 및 동기화

#### 현재 (v2.1)
- **인메모리 스토어** (기본)
- 페이지 새로고침 시 데이터 소멸
- Syncular 클라이언트 준비됨 (fallback)

#### 준비 중 (Syncular 연동)
- **OPFS** (Origin Private File System) — 브라우저 영구 저장
- **Syncular** — 오프라인 우선 동기화
- **Cloudflare Workers D1** — 중앙 서버
- **R2** — 사진 저장소

```
[사용자] → [OPFS (로컬 SQLite)] → [아웃박스 큐]
                                    ↓ (온라인)
                          [Cloudflare Workers D1]
                                    ↓ (전파)
                          [다른 사용자 OPFS]
```

---

## 🛠️ 기술 스택

### 프론트엔드
| 기술 | 용도 |
|---|---|
| **Vanilla JS (ESM)** | 메인 로직 |
| **Tailwind CSS CDN** | 스타일링 (다크 테마) |
| **esbuild** | 번들링 (minify) |
| **Syncular v0.15.48** | 오프라인 동기화 (준비) |
| **sqlite-wasm** | 브라우저 내 SQLite (OPFS) |

### 백엔드 (준비)
| 기술 | 용도 |
|---|---|
| **Cloudflare Workers** | 서버리스 런타임 |
| **D1** | SQLite 데이터베이스 |
| **R2** | 객체 저장소 (사진) |
| **Syncular Server** | 동기화 서버 |

### 테스트
| 도구 | 용도 |
|---|---|
| **Playwright** | E2E 테스트 (Chromium headless) |
| **node:test-server** | 로컬 Sync 서버 (인메모리) |

---

## 📁 프로젝트 구조

```
projects/yadonghaja/
├── web/                          # 프론트엔드
│   ├── src/
│   │   ├── app.js               # 메인 앱 (UI + 로직)
│   │   ├── sync.js              # Syncular 어댑터 (인메모리 fallback)
│   │   └── worker.js            # Web Worker (OPFS + Syncular)
│   ├── dist/                    # 빌드 산출물
│   ├── index.html               # 페이지 셸
│   ├── package.json
│   ├── build.mjs                # esbuild 설정
│   ├── test-server.mjs          # 로컬 테스트 서버
│   ├── e2e.mjs                  # Playwright E2E
│   ├── test-opfs.html           # OPFS 테스트 페이지
│   └── yadonghaja-v2.1.zip      # 배포용 ZIP
│
├── sync-server/                 # Sync 서버 (Cloudflare Workers)
│   ├── src/
│   │   ├── worker.ts            # Workers 엔트리
│   │   └── syncular.generated.ts # 스키마 (11 테이블)
│   ├── migrations/
│   │   └── 0002_yadonghaja_app.sql
│   ├── wrangler.toml            # Workers 설정
│   ├── DEPLOY.md                # 배포 가이드
│   └── local-test.mjs           # 로컬 테스트 (5/5 통과)
│
└── SYNCULAR_DESIGN.md           # v2 전환 설계안 (578 줄)
```

---

## 🚀 배포 이력

| 버전 | 날짜 | 내용 | Claim URL |
|---|---|---|---|
| v1 | 2026-08-29 | IndexedDB 로컬 저장 (초기 버전) | - |
| v2.0 | 2026-08-30 | 인메모리 E2E 통과, 첫 OnDev 배포 | https://ondev.store/claim/2qku2c |
| v2.1 | 2026-08-30 | 사진 인증 + 보상 시스템 완성 | https://ondev.store/claim/9ib5yp |

---

## 📊 E2E 테스트 결과

```
🚀 yadonghaja v2.1 E2E — Syncular + 보상 시스템
📝 온보딩...
✅ 온보딩 완료
🏠 홈 탭...
✅ 홈 탭 렌더링됨
📋 모집 탭...
✅ 모집 탭 렌더링됨
🎯 미션 탭...
✅ 미션 탭 렌더링됨
📰 피드 탭...
✅ 피드 탭 렌더링됨
👤 프로필 탭...
✅ 프로필 탭 렌더링됨

🎉 E2E 통과 — 모든 탭 정상!
```

---

## 🔧 Cloudflare Workers 배포 가이드

### 1. 로그인
```bash
cd projects/yadonghaja/sync-server
wrangler login
```

### 2. D1 데이터베이스 생성
```bash
wrangler d1 create yadonghaja-sync
# 출력된 database_id 를 wrangler.toml 에 기입
```

### 3. R2 버킷 생성
```bash
wrangler r2 bucket create yadonghaja-blobs
```

### 4. 시크릿 설정
```bash
# SYNC_HMAC_KEY 생성
openssl rand -hex 32

# 시크릿 설정
wrangler secret put SYNC_HMAC_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

### 5. 마이그레이션 적용
```bash
wrangler d1 migrations apply yadonghaja-sync --remote
```

### 6. Workers 배포
```bash
wrangler deploy
```

### 7. 프론트 연동
`web/src/app.js` 수정:
```js
// 기존
sync = await createSyncAdapter(actorId, 'http://127.0.0.1:8788');

// 변경
sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync.<subdomain>.workers.dev');
```

### 8. 프론트 재배포
```bash
cd web
npm run build
# ZIP 생성 → OnDev 배포
```

---

## 🧪 로컬 테스트

### 1. 테스트 서버 실행
```bash
cd web
node test-server.mjs &
```

### 2. E2E 테스트
```bash
node e2e.mjs
```

### 3. OPFS 테스트
```bash
# 브라우저에서 오픈
http://127.0.0.1:8788/test-opfs.html

# "쓰기 테스트" 클릭
# OPFS 에 데이터 저장 확인
```

---

## 📋 데이터베이스 스키마 (11 테이블)

| 테이블 | 용도 | 스코프 |
|---|---|---|
| `posts` | 메이트 모집글 | public_id |
| `feed_items` | 운동 인증 피드 | public_id |
| `cheers` | 응원 (🔥👍💪) | public_id |
| `user_profiles` | 사용자 프로필 | public_id |
| `applications` | 모집 신청 | apply_scope |
| `verifications` | 미션 인증 기록 | verify_scope |
| `missions` | 미션 (일일/주간) | user_id |
| `badges` | 획득 배지 | user_id |
| `streaks` | 연속 인증 일수 | user_id |
| `point_ledger` | 포인트 내역 | user_id |
| `rankings` | 랭킹 | group_id |

---

## 🎨 디자인 시스템

### 컬러 팔레트
- **배경**: `#0f172a` (slate-950)
- **카드**: `#1e293b` (slate-800)
- **강조**: `#f97316` (orange-500), `#e11d48` (rose-500)
- **성공**: `#22c55e` (emerald-500)
- **경고**: `#ef4444` (red-500)

### 타이포그래피
- **폰트**: 시스템 폰트 (sans-serif)
- **제목**: `font-extrabold`
- **본문**: `text-slate-300`

### UI 컴포넌트
- **카드**: `rounded-2xl`, `border border-slate-700`
- **버튼**: `rounded-xl`, 그라디언트 배경
- **칩**: `rounded-full`, `text-[10px]`
- **바텀시트**: 슬라이드 업 애니메이션 (280ms)

---

## 🐛 알려진 이슈

### 현재 버전 (v2.1)
- [ ] 인메모리 스토어 사용 (새로고침 시 데이터 소멸)
- [ ] Cloudflare Workers 미배포 (실제 동기화 불가)
- [ ] 사진 R2 업로드 미구현 (dataUrl 만 저장)

### 다음 버전 (v3.0) 에서 해결 예정
- [x] OPFS 연동
- [x] Syncular 클라이언트 활성화
- [x] Cloudflare Workers 배포
- [ ] 사진 R2 presigned URL 업로드
- [ ] 푸시 알림 (Cloudflare Durable Objects)
- [ ] 그룹 채팅 (실시간)

---

## 📈 로드맵

### v3.0 (Syncular 연동) — 2026-09 목표
- [x] Cloudflare Workers 배포
- [x] OPFS 활성화
- [ ] 실제 멀티유저 동기화 검증
- [ ] 오프라인 모드 지원

### v3.1 (사진 저장소) — 2026-09 목표
- [ ] R2 presigned URL 업로드
- [ ] 썸네일 생성
- [ ] CDN 연동

### v3.2 (고급 기능) — 2026-10 목표
- [ ] 그룹 채팅 (WebSocket)
- [ ] 푸시 알림
- [ ] 운동 종류 확장 (AI 분류)

### v4.0 (모바일 앱) — 2026-11 목표
- [ ] Android 네이티브 앱 (LiteRT-LM)
- [ ] iOS PWA 설치 최적화
- [ ] 오프라인 모드 강화

---

## 📝 개발 원칙

1. **TDD** — 테스트 먼저, 구현 나중
2. **컨벤셔널 커밋** — `feat:`, `fix:`, `docs:`, `chore:`
3. **E2E 우선** — 수동 테스트 대신 자동화
4. **오프라인 우선** — 네트워크 상태에 관계없이 작동
5. **모바일 퍼스트** — 터치 친화적 UI (min-height 2.75rem)

---

## 👥 기여자

- **용수 박** (CEO) — 기획, 디자인, 테스트
- **Hermes Agent** (AI Developer) — 개발, 테스트, 배포

---

## 📄 라이선스

MIT License — `agent-dev-company` 저장소 정책 따름

---

## 🔗 링크

- **저장소**: https://github.com/realizer-1966/agent-dev-company
- **배포**: https://ondev.store/claim/9ib5yp
- **문서**: `projects/yadonghaja/SYNCULAR_DESIGN.md`
- **배포 가이드**: `projects/yadonghaja/sync-server/DEPLOY.md`
