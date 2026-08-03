# todo-web — 할 일 관리 웹앱

FastAPI 기반의 **할 일 관리 웹 서비스**입니다. 브라우저에서 할 일을 추가·조회·완료·삭제할 수 있으며, REST API도 제공합니다.

## 🚀 실행 방법

```bash
# 프로젝트 루트(agent-dev-company)에서 venv 활성화 후
cd projects/todo-web
../../.venv/bin/python run.py
```

브라우저에서 **http://127.0.0.1:8000** 접속하면 웹 UI가 열립니다.

> 💡 데이터는 `todos.json` 파일에 저장됩니다. 파일을 지우면 초기화됩니다.

## 🧪 테스트 방법

```bash
../../.venv/bin/python -m pytest -q
```

## 🔌 REST API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/` | 웹 UI (HTML) |
| `GET` | `/api/todos` | 전체 할 일 목록 |
| `POST` | `/api/todos` | 할 일 추가 `{"title": "..."}` |
| `PATCH` | `/api/todos/{id}/toggle` | 완료 상태 토글 |
| `DELETE` | `/api/todos/{id}` | 할 일 삭제 |

## 🗂️ 프로젝트 구조

```
todo-web/
├── main.py          # FastAPI 앱 + 웹 UI (HTML/JS)
├── todo_store.py    # JSON 기반 저장소
├── run.py           # 서버 실행 진입점
├── tests/
│   ├── test_api.py  # API + 저장소 테스트
└── pyproject.toml
```

## ✅ 기능

- 할 일 추가 / 목록 조회 / 완료 토글 / 삭제
- JSON 파일 영속 저장
- 완료된 항목 취소선 표시, 남은 개수 카운트
- 한글 입력 지원
