# Agent Dev Company — 사내 규칙 (AGENTS.md)

이 파일은 모든 직원 에이전트(pm, dev, reviewer)가 작업 시 자동으로 로드하는 공통 규칙이다.

## 기본 원칙

- **커밋은 컨벤셔널 형식**을 따른다: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **TDD**: 테스트를 먼저 작성하고, 실패를 확인한 후 구현한다
- **작은 커밋**: 하나의 작업 = 하나의 커밋. 자주 커밋한다
- 변경 후 반드시 테스트 실행: `python -m pytest -q`
- 코드는 `projects/<project>/` 아래에만 작성한다
- 작업 완료 시 **kanban 코멘트**로 결과 요약(구현 내용 + 테스트 결과)을 남긴다

## 업무 흐름

```
backlog → ready → in_progress(claimed) → review → done
```

- 담당 티켓을 시작하면 `kanban_show`로 상세 내용을 확인한다
- 작업이 끝나면 `kanban_complete`로 완료 처리한다 (리뷰 대기 상태가 된다)
- Reviewer가 반려하면 `kanban_block` + 코멘트가 달리며 다시 backlog로 돌아간다

## 프로젝트 표준

- Python 프로젝트는 `projects/<name>/` 아래에 패키지 + `tests/` 구조를 만든다
- `pyproject.toml` 또는 `requirements.txt`로 의존성을 명시한다
- 실행 방법과 테스트 방법을 `README.md`에 문서화한다

## 소통 규칙

- 티켓 설명은 구체적으로: 무엇을, 왜, 어떻게 검증할지
- 질문이 있으면 kanban 코멘트로 남긴다
- 최종 결과물은 사용자(CEO)가 검수한다
