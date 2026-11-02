# Agent Dev Company 🤖🏢

전 직원이 AI 에이전트(Hermes 프로필)인 가상 개발회사.
대표(사용자)가 발주하면 PM → Dev → QA → Reviewer 에이전트가 협업해 소프트웨어를 설계·구현·테스트·리뷰·납품한다.

## 조직도

| 직원 | 프로필 | 역할 |
|---|---|---|
| CEO (대표) | `default` | 의사결정, 최종 승인, 납품 검수 |
| PM | `pm` | 요구사항 분석, 티켓 분해, 배정, 일정 관리 |
| Dev | `dev` | TDD 구현, 테스트, 커밋 |
| QA | `qa` | 테스트 실행, 버그 리포트, 품질 검증 |
| Reviewer | `reviewer` | 코드 리뷰, 품질 게이트, 승인/반려 |

## 업무 흐름

```
backlog → ready → in_progress → review → done
```

1. PM이 요구사항을 티켓으로 분해 (`kanban create`)
2. 티켓을 ready로 올리고 담당자 배정 (`kanban assign`)
3. 게이트웨이 디스패처가 담당 프로필을 자동 실행
4. Dev가 구현·테스트·커밋 후 완료 처리
5. QA가 테스트 실행, 버그 리포트 작성
6. Reviewer가 리뷰 후 승인(complete) 또는 반려(block)
7. CEO가 최종 검수 후 납품

## 사무실 구조

```
agent-dev-company/
├── AGENTS.md        # 사내 공통 규칙 (모든 직원이 로드)
├── README.md        # 회사 소개 (이 파일)
└── projects/        # 실제 개발 프로젝트
    └── <project>/
```

## 시작하기

```bash
cd /root/workspace/agent-dev-company
hermes kanban list    # 현재 업무 현황
```

## 프로젝트 목록

| 프로젝트 | 상태 | 설명 |
|---|---|---|
| [rental-web](projects/rental-web/) | 🚧 진행 중 | 임대관리 웹앱 (건물·세입자 관리, OnDev 배포) |
| [ohaeng-assets](projects/ohaeng-assets/) | 🆕 발주 (2026-11-02) | FEAAS 오행 자산 진단기 (Five Elements AI Asset Allocation System · MVP 1단계, Cloudflare Pages 배포 예정) |

## 운영 자동화

- **데일리 스탠드업**: 매일 09:00 KST에 Kanban 현황 자동 보고 (cron `agent-company-standup`, 이 채널 전달)
- **텔레그램 발주**: @agent_dev_company_bot 에게 메시지를 보내면 티켓으로 전환되어 자동 처리 (※ 현재 기기는 봇 토큰 미설정 — 이 채널이나 터미널로 발주)
- **대시보드**: http://127.0.0.1:18935 (Hermes Web UI) — 보드는 `hermes kanban list`로도 확인
- **리뷰 레인**: 작업 티켓은 생성 직후/진행 중에 `hermes kanban request-review <id> --reviewer reviewer`로 리뷰 요청 → reviewer가 검증 후 승인(done) 또는 반려(block)

## 일 시키는 방법

```bash
# 1. 텔레그램에서 봇에게 말하기 (가장 편함)
@agent_dev_company_bot → "rental-web에 백업 기능 개선해줘"

# 2. 터미널에서 직접
cd /root/workspace/agent-dev-company
hermes kanban create "작업 내용" --assignee dev

# 3. 이 WebUI 대화에서 말하기
"rental-web에 버그 수정해줘"
```