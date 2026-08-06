# GitHub Actions 기반 클라우드 사무실 설계 (v0.1 — 검토용)

> 목표: 로컬 proot의 Hermes 앱(게이트웨이)이 꺼져 있어도, GitHub만 켜져 있으면
> 에이전트 회사(pm/dev/qa/reviewer)가 프로젝트를 수행하게 한다.

## 1. 현재 구조와 문제

```
[로컬 proot]  Hermes 앱(게이트웨이) ──┐
   ├─ 텔레그램 봇                    ├─ kanban 디스패처(60s)
   ├─ kanban.db (/root/.hermes)      ├─ 프로필 pm/dev/qa/reviewer
   └─ WebUI (18935)                  └─ 모델: ollama-cloud (클라우드 API)
```

- **에이전트 실행 주체 = 로컬 Hermes 프로세스.** 앱이 꺼지면 텔레그램도, 티켓 처리도 멈춤.
- GitHub CI(`.github/workflows/ci.yml`)는 push/PR 시 **테스트만** 클라우드에서 실행. 에이전트는 안 돌림.
- 모델(deepseek-v4-flash)은 이미 **클라우드 API** → Hermes 프로세스만 항상 켜진 곳에서 돌리면 됨.

## 2. 핵심 아이디어

**GitHub Actions 러너를 "항상 켜진 클라우드 사무실"로 전환.**

- **티켓 = GitHub Issue** (라벨로 kanban 상태 표현)
- **디스패처 = 스케줄 워크플로** (예: 15분마다, `schedule` 트리거)
- CEO가 휴대폰/웹에서 Issue만 열면 → 워크플로가 파이프라인을 클라우드에서 실행
- 로컬 앱 완전 불필요. GitHub만 켜져 있으면 됨.

## 3. 아키텍처

```
[CEO]  GitHub Issue 열기 (라벨: ready)
        │
        ▼
[GitHub Actions]  schedule 워크플로 (15분마다)
        │  1. Hermes 설치 (캐시)
        │  2. kanban.db 다운로드 (artifact/cache)
        │  3. hermes kanban dispatch  ← 클라우드에서 파이프라인 실행
        │  4. kanban.db 업로드
        │  5. Issue에 진행상황 코멘트, 완료 시 라벨/닫기
        ▼
[GitHub]  코드 커밋 → CI 테스트 → 완료
```

## 4. 상태 관리 (가장 중요한 난제)

kanban.db는 로컬 파일. GitHub Actions는 stateless → **DB를 러너 간 공유**해야 함.

| 방식 | 장점 | 단점 |
|---|---|---|
| **GitHub Actions Cache** | 빠름(분 단위), 무료 | 10GB 제한, 7일 미사용 시 삭제 |
| **GitHub Artifact** | 영구 보관 | 업/다운로드 느림, 90일 보관 |
| **GitHub 저장소에 커밋** | 단순, 영구 | 커밋 히스토리 오염, 동시성 위험 |
| **외부 DB (Supabase/Postgres)** | 진짜 공유, 동시성 안전 | 설정 복잡, 비용 |

**권장(프로토타입):** kanban.db를 저장소의 `state/kanban.db`로 커밋 + 워크플로가 pull→dispatch→push.
**장기:** 외부 Postgres로 kanban 백엔드 교체 (Hermes kanban이 SQLite 기반이라 마이그레이션 필요).

> ⚠️ 동시성: schedule 워크플로가 겹치면 DB 충돌. `concurrency` 그룹으로 직렬화 필수.

## 5. 워크플로 구성 (초안)

```yaml
# .github/workflows/cloud-office.yml
name: Cloud Office Dispatcher
on:
  schedule:
    - cron: "*/15 * * * *"   # 15분마다
  workflow_dispatch:          # 수동 실행
  issues:
    types: [opened, labeled]  # 이벤트 트리거 (선택)

concurrency:
  group: cloud-office
  cancel-in-progress: false   # 직렬화 (겹침 방지)

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Hermes (cached)
        uses: actions/cache@v4
        with:
          path: ~/.hermes
          key: hermes-${{ runner.os }}
      - name: Install Hermes
        run: pip install hermes-agent  # 또는 저장소 내 설치 스크립트
      - name: Configure secrets
        env:
          OLLAMA_CLOUD_API_KEY: ${{ secrets.OLLAMA_CLOUD_API_KEY }}
        run: hermes config set model.provider ollama-cloud
      - name: Run dispatcher
        run: hermes kanban dispatch --once
      - name: Commit state
        run: |
          git add state/kanban.db
          git commit -m "chore: kanban state sync" || true
          git push
```

## 6. Issue ↔ kanban 매핑

| GitHub Issue | kanban |
|---|---|
| Issue 본문 | 티켓 설명 |
| 라벨 `ready` | ready 상태 |
| 라벨 `in_progress` | claimed |
| 라벨 `review` | review |
| 라벨 `done` | done |
| Issue 코멘트 | kanban 코멘트 |
| Issue 닫기 | 완료 |

**동기화 스크립트** (`scripts/sync_issues.py`):
- Issue 열림 → `hermes kanban create`
- 라벨 변경 → `hermes kanban assign/promote/complete`
- 완료 → Issue 닫기 + 코멘트

## 7. 프로필 격리 (클라우드)

로컬에서는 프로필이 `~/.hermes/profiles/<name>/`로 분리. 클라우드에서도 동일:
- 각 프로필 실행 시 `HERMES_HOME` 또는 `hermes -p <name>` 사용
- `hermes kanban dispatch`가 담당 프로필을 자동 실행 (로컬과 동일 로직)

## 8. 보안

- **모델 API 키**: GitHub Secrets (`OLLAMA_CLOUD_API_KEY` 등)
- **GitHub 토큰**: `GITHUB_TOKEN` (자동 주입, 저장소 범위)
- **kanban.db**: 저장소에 커밋 시 민감정보 없어야 함 (티켓 내용만)
- **러너**: `ubuntu-latest` 공용 러너 → 코드/시크릿 노출 위험 낮음 (공개 저장소는 주의)

## 9. 비용

| 항목 | 무료 티어 |
|---|---|
| GitHub Actions | private 2,000분/월, public 무제한 |
| 모델 API | ollama-cloud 기존 사용량 |
| 저장소 | 무제한 (public) |

15분마다 1회 실행 ≈ 2,880회/월. 각 실행 2~5분 → **약 6,000~14,000분/월**.
→ **private 저장소는 무료 티어 초과 위험.** public 저장소로 전환하거나 실행 빈도 조정 필요.

## 10. 리스크 & 한계

1. **DB 동시성**: schedule 겹침 → `concurrency`로 직렬화. 그래도 DB 커밋 충돌 가능.
2. **첫 실행 지연**: Hermes 설치(캐시 미스 시) 2~5분. 캐시로 완화.
3. **상태 유실**: 러너가 죽으면 DB 커밋 전 유실. artifact 백업 권장.
4. **공용 러너 제약**: 장시간 작업(>6h) 불가, 네트워크 제한.
5. **로컬 기능 상실**: WebUI, 텔레그램 실시간, 대시보드(9119)는 클라우드에 없음.
   → 텔레그램은 GitHub Issue 알림으로 대체 가능.

## 11. 대안 (비교)

| 대안 | 설명 | 장점 | 단점 |
|---|---|---|---|
| **A. GitHub Actions (본 설계)** | 클라우드 스케줄 디스패처 | 무료, GitHub만 필요 | DB 공유 복잡, 공용 러너 제약 |
| **B. 외부 VPS/서버** | Hermes를 항상 켜진 서버에 배포 | 로컬과 동일 기능, DB 로컬 | 비용, 서버 관리 |
| **C. GitHub Codespaces** | 클라우드 개발환경 | Hermes 설치 용이 | 항상 켜짐 아님, 비용 |
| **D. 하이브리드** | 로컬 + 클라우드 병행 | 유연 | 복잡 |

## 12. 다음 단계 (프로토타입)

1. [ ] `scripts/sync_issues.py` 작성 (Issue ↔ kanban 동기화)
2. [ ] `cloud-office.yml` 워크플로 작성
3. [ ] kanban.db 저장소 커밋 방식 검증 (동시성 테스트)
4. [ ] GitHub Secrets에 모델 API 키 등록
5. [ ] 테스트 Issue로 파이프라인 E2E 검증
6. [ ] 비용/빈도 조정 (15분 → 30분 등)

---
*작성: 2026-08-06 · 검토용 초안. 승인 후 프로토타입 진행.*
