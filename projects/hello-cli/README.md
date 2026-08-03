# hello-cli

`greet(name)` 함수로 인사말을 출력하는 Python CLI 도구.

## 구조

```
projects/hello-cli/
├── hello_cli/
│   ├── __init__.py    # greet(name) 함수
│   └── __main__.py    # CLI 진입점
├── tests/
│   └── test_hello.py  # greet 함수 테스트
├── pyproject.toml
└── README.md
```

## 실행 방법 (명령어 포함)

```bash
# CLI로 인사말 출력
python -m hello_cli Agent
# => 안녕하세요, Agent!

# 코드에서 직접 사용
from hello_cli import greet
greet("홍길동")  # => "안녕하세요, 홍길동!"
```

## 테스트 방법

```bash
python -m pytest -q
```
