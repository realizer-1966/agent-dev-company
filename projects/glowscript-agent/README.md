# glowscript-agent

**GlowScript를 학습한 에이전트** — 자연어로 물리 시뮬레이션을 설명하면 GlowScript/VPython 코드를 생성하고 검증하는 Python 패키지.

## 개요

이 프로젝트는 "LLM이 GlowScript를 학습한 에이전트"를 실용적인 코드로 구현한 것입니다. 에이전트는:

1. **지식베이스** (`knowledge.py`) — GlowScript/VPython의 핵심 API(객체, 속성, 물리 패턴)를 구조화된 형태로 보유
2. **코드 생성기** (`generator.py`) — 시뮬레이션 설명을 받아 GlowScript 코드로 변환
3. **검증기** (`validator.py`) — 생성된 코드의 문법·구조·물리적 타당성을 검증
4. **CLI** (`cli.py`) — 터미널에서 사용

## 설치

```bash
cd projects/glowscript-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
```

## 사용법

```bash
# 시뮬레이션 설명 → GlowScript 코드 생성
glowscript-agent generate "공이 위로 던져져 중력에 의해 다시 떨어지는 운동"

# 생성된 코드 검증
glowscript-agent validate scene.py

# 지식베이스 조회
glowscript-agent knowledge sphere
```

## 테스트

```bash
python -m pytest -q
```

## 지원 시뮬레이션 템플릿

| 템플릿 | 설명 |
|--------|------|
| `projectile` | 포물선 운동 (중력 하의 발사체) |
| `pendulum` | 단진자 운동 |
| `spring` | 용수철 진동 (SHM) |
| `orbit` | 중력 궤도 운동 |
| `free_fall` | 자유낙하 |
| `collision` | 두 공의 탄성 충돌 (운동량 보존) |
| `electric_field` | 점전하 주위의 전기장 (역제곱 법칙) |
| `robot_arm` | 2-링크 로봇 팔 (전방 기구학) |
| `wave` | 줄을 따라 전파되는 횡파 |
| `electromagnetic_wave` | 전자기파 (E·B장 진동) |
| `fluid` | 유체 입자 흐름 |
