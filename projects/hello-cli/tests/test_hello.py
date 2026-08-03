"""hello-cli 프로젝트 테스트: greet 함수."""

from hello_cli import greet


def test_greet_returns_korean_greeting():
    assert greet("Agent") == "안녕하세요, Agent!"


def test_greet_with_another_name():
    assert greet("홍길동") == "안녕하세요, 홍길동!"


def test_greet_with_empty_name():
    assert greet("") == "안녕하세요, !"
