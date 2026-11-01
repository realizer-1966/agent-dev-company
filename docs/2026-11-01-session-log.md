# 운영 세션 로그 — 2026-11-01

CEO 발주로 진행한 정비 세션의 전체 기록. 커밋·인프라·배포·장애 조치가 모두 이 한 세션에서 완료됐다.

## 1. 저장소 분석 (시작)

- `agent-dev-company`: 전 직원이 AI 에이전트(Hermes 프로필)인 가상 개발회사 운영 저장소.
- 커밋 310개 (2026-08-02 ~ 09-22). 마지막 커밋에서 rental-web 집중 모드(타 프로젝트 15개 워크스페이스 정리, 이력 보존).
- 핵심 자산: rental-web(임대관리 웹앱, IndexedDB 로컬 저장) + 계산 로직 QA 파이프라인(골든 마스터 + vm 드리프트 감지 + 불변식 생성).

## 2. 회사 모드 복귀 + rental-web 전용 정리

- README를 회사 모드 표기로 복귀, 프로젝트 목록은 rental-web만 유지.
- 삭제된 프로젝트의 잔여물 정리: 죽은 워크플로우 2건(dementia APK, yadonghaja 배포) 삭제, `ci.yml`을 rental-web QA 전용으로 정비, 프로젝트 전용 스크립트/docs 삭제.
- 검증: `run-qa` 92/92, `run-sync` 195/195 → 커밋 **d415d58**.
- 이때 GitHub 인증이 없어 로컬 커밋만 가능한 상태였다.

## 3. GitHub 인증

- 채팅에 토큰 전달 금지 원칙 → **GitHub 디바이스 플로우**로 인증 (scope: repo+workflow).
- 중간 장애: 폴백 스크립트가 멀티라인 JSON 파싱 실패로 `~/.config/gh/hosts.yml`을 오염 → 토큰은 유효했으므로 파일만 재작성해 복구(재발급 불필요).
- push 성공: 원격 main = d415d58 확인. 신규 CI 녹색, 과거 커밋의 CI red가 해소됨을 Actions 이력으로 확인.

## 4. 회사 운영 인프라 가동

| 구성 | 내용 |
|---|---|
| 직원 프로필 | `pm` · `dev` · `qa` · `reviewer` 생성(CEO=`default`) — 별칭 `hermes pm` 등 |
| 모델 | 전 프로필 **`glm-5.3-flash @ ollama-cloud`** (요청 반영; 죽은 LAN ollama 100.71.1.74 의존 제거) |
| Kanban | 보드 `default`, workdir `/root/workspace/agent-dev-company`, 게이트웨이 내장 디스패처 60초 주기 |
| 스탠드업 | cron **`agent-company-standup`**(a1900cd1907b) — 매일 **09:00 KST**(=00:00 UTC), 이 채널 전달 |
| 텔레그램 봇 | 미구성(봇 토큰 부재) — 발주는 이 채널/터미널로 |

## 5. 근본 장애 규명·패치 — "Android proot의 /proc 차단"

**증상**: 디스패처가 워커를 스폰해도 `Kanban owner refused: request_failed`로 연쇄 실패 → gave_up → 자동 블록. 사유가 마스킹돼 처음엔 원인 불명으로 보임.

**규명 경로**: RPC 클라이언트의 `rpc_error`는 80자 이상/구두점 포함 사유를 전부 `request_failed`로 일반화 → WS 로그의 `ws dispatch crash` traceback에서 실체 확인. **Android proot에서 `/proc/stat`와 타 프로세스 `/proc/<pid>/{stat,cmdline}` 읽기가 차단**되어 psutil 기반 검증들이 전부 AccessDenied/PermissionError.

**패치 4곳** (`/usr/local/lib/hermes-agent/`, 생명검증 유지 + /proc 의존부 폴백):

1. `gateway/session_kanban.py` — owner_admitted 마커의 birth → `_owner_birth()` 폴백
2. `agent/managed_worker.py` — hello 프레임: birth 폴백 + `parents()` 실패 시 `os.getppid()`
3. `gateway/session_worker_reservation.py` — verify_worker_identity: birth 미확인 시 hello 신뢰 + Popen 생존/ancestor 검증 강등
4. `gateway/session_worker.py` — worker.adopt 동일 폴백 (+ `session_worker_delegation.py`)

⚠️ **`hermes update` 시 패치 소멸** → 스킬 `android-proot-gateway-fixes`에 절차 저장됨.

## 6. 파이프라인 실증 (스모크)

| 테스트 | 결과 |
|---|---|
| PM 발주·수행(스모크) | ✅ run 33 — glm 호출 11회, 코멘트+완료 처리, done |
| Dev 수행 | ✅ run 35 — 21초(8메시지/4콜) |
| Reviewer 리뷰 레인 | ✅ request-review → run 37 — 30메시지/15콜로 dev run 대조·파일 mtime 스캔·git 상태 확인 후 **승인 판정** → done |
| 운영 규칙 | `request-review`는 **running/ready 상태에서만** 가능(완료 후 불가) |

검증 후 테스트 티켓 4건 전량 archive.

## 7. rental-web 배포 — "앱을 설치할 수 없습니다" 해소

원인 3단계 규명:

1. **PWA 요건 부족**: 배포 zip에 manifest.json/sw.js/PNG 아이콘 없음 → 추가. 아이콘은 icon.svg(단순 사각형 집합)를 이미지 툴 없이 **순수 파이썬으로 PNG 렌더**(192/512, 안티앨리어싱).
2. **OnDev 구조 발견**: zip에 manifest/sw가 없는 앱에만 플랫폼이 설치 래퍼(install/index.html)를 자동 생성 → 자체 PWA를 넣자 오히려 /install이 사라짐 → **install/index.html을 직접 제공**(beforeinstallprompt 버튼 + 수동 안내).
3. **QA 회귀 발견·해소**: vm 로더는 첫 bare `<script>`를 앱 본체로 추출 → head의 PWA 스크립트에 `data-pwa` 어트리뷰트 + `typeof navigator` 가드 → 92/195 회복.

**배포 채널 정비**:

- OnDev Store: claim 재게시 불안정(서브도메인 "Game not found" 404 반복, 플랫폼쪽 상태) → **대안으로 축소**.
- **최종: Cloudflare Pages** — wrangler 디바이스 플로우 인증(계정 dydtnsp@gmail.com, 토큰은 기기에만 저장) → **https://rental-web-aeh.pages.dev** 배포.
- 실측: `/`, manifest, sw, icons, `/install/` 모두 200 + 설치 버튼 렌더. **폰에서 설치 성공 확인 받음.**
- 주의: 도메인은 `rental-web-aeh`지만 프로젝트명은 `rental-web` (배포 명령 기준).

## 8. 최종 상태

| 항목 | 값 |
|---|---|
| GitHub | `realizer-1966/agent-dev-company` main = 커밋 `444b40f` (CI: rental-web QA 녹색) |
| 배포 | https://rental-web-aeh.pages.dev (+ /install 설치 페이지) |
| 회사 | CEO→PM→Dev→Reviewer 사이클 가동, 매일 09:00 KST 스탠드업 보고 |
| 재배포 명령 | `npx wrangler pages deploy projects/rental-web --project-name=rental-web --branch=main --commit-dirty=true` |
| 데이터 이관 | 앱 내 📤 백업(rental-backup-YYYY-MM-DD.json) → 📥 복원 |

관련 문서: README(회사·배포), AGENTS.md(업무 규칙), `docs/hermes-environment-notes.md`(환경 기록), 스킬 `android-proot-gateway-fixes`·`static-web-pwa`.

## 9. 남은 과제

- 텔레그램 봇 토큰 세팅 시 @agent_dev_company_bot 발주 채널 복원.
- 첫 실제 개발 티켓에서 QA 프로필 사이클 자연 검증.
- `hermes update` 후 proot 패치 재적용 (스킬 절차 따르기).