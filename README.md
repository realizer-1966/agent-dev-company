# Agent Dev Company 🤖🏢

전 직원이 AI 에이전트(Hermes 프로필)인 가상 개발회사.
대표(사용자)가 발주하면 PM → Dev → Reviewer 에이전트가 협업해 소프트웨어를 설계·구현·리뷰·납품한다.

## 조직도

| 직원 | 프로필 | 역할 |
|---|---|---|
| CEO (대표) | `default` | 의사결정, 최종 승인, 납품 검수 |
| PM | `pm` | 요구사항 분석, 티켓 분해, 배정, 일정 관리 |
| Dev | `dev` | TDD 구현, 테스트, 커밋 |
| Reviewer | `reviewer` | 코드 리뷰, 품질 게이트, 승인/반려 |

## 업무 흐름

```
backlog → ready → in_progress → review → done
```

1. PM이 요구사항을 티켓으로 분해 (`kanban create`)
2. 티켓을 ready로 올리고 담당자 배정 (`kanban assign`)
3. 게이트웨이 디스패처가 담당 프로필을 자동 실행
4. Dev가 구현·테스트·커밋 후 완료 처리
5. Reviewer가 리뷰 후 승인(complete) 또는 반려(block)
6. CEO가 최종 검수 후 납품

## 사무실 구조

```
agent-company/
├── AGENTS.md        # 사내 공통 규칙 (모든 직원이 로드)
├── README.md        # 회사 소개 (이 파일)
└── projects/        # 실제 개발 프로젝트
    └── <project>/
```

## 시작하기

```bash
cd /root/workspace/agent-company
hermes kanban list    # 현재 업무 현황
```

## 프로젝트 목록

| 프로젝트 | 상태 | 설명 |
|---|---|---|
| (첫 프로젝트 대기 중) | — | — |
