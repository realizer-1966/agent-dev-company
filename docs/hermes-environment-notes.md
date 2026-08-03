# Hermes 환경 설정 & 운영 기록

이 문서는 이 저장소를 운영하는 Hermes 에이전트 환경에서 적용한 설정 변경 사항을 기록한 것이다.
민감 정보(봇 토큰, API 키)는 **저장하지 않는다** — 실제 값은 `~/.hermes/.env`에만 존재한다.

> ⚠️ **보안 주의:** 아래에 `<봇 토큰>` 등으로 표기된 값은 실제 값을 절대 이 문서나 git에 커밋하지 말 것.

---

## 1. 텔레그램 봇 연동

### 봇 정보 (공개 정보)

| 항목 | 값 |
|---|---|
| 봇 사용자명 | `@agent_dev_company_bot` |
| 봇 ID | `8619360365` |
| 봇 이름 | 에이전트(회사) |

### 설정 위치: `~/.hermes/.env`

| 환경변수 | 값 | 설명 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `<봇 토큰 — 비밀, 미기록>` | BotFather에서 발급받은 토큰 |
| `TELEGRAM_ALLOWED_USERS` | `577294968` | 봇과 대화 허용 사용자 (용수 박) |
| `TELEGRAM_HOME_CHANNEL` | `577294968` | 홈 채널 (DM) |

### 운영 참고 (Android proot 환경 특성)

- 이 환경은 **Hermes WebUI (Android proot)** 위에서 동작한다.
- 게이트웨이 실행 시 **`Telegram polling conflict`** 경고가 반복될 수 있다.
  - 원인: 봇 토큰을 사용하는 세션이 텔레그램 서버에 남아 있는 경우 또는 어댑터 폴링 불안정.
  - 웹훅은 설정되어 있지 않음 (`getWebhookInfo`의 `url`이 비어있음) → 폴링 모드 정상.
  - 봇 수신 자체는 동작하므로, 기능 문제가 없으면 경고는 무시해도 됨.
  - **다른 곳에서 동일 봇 토큰을 사용 중이면 충돌이 지속**되므로, 동일 토큰의 중복 사용을 피할 것.
- 텔레그램 봇 명령: 게이트웨이 시작 시 30개 등록됨.

---

## 2. 모델 Provider 설정 수정

### 문제
`~/.hermes/config.yaml`의 `model.provider`가 `ollama-cloud:deepseek-v4-flash`로
설정되어 있었는데, 이러면 게이트웨이가 이를 **"Unknown provider"** 로 처리하여
LLM 인증에 실패한다 (`Primary provider auth failed`).

### 수정 방법
provider 이름과 모델은 **분리**해야 한다.

```yaml
model:
  provider: ollama-cloud        # provider 이름만
  default: deepseek-v4-flash:0731  # 모델은 default로 분리
```

### 검증
```bash
hermes config set model.provider ollama-cloud
hermes doctor   # provider 관련 오류 사라짐 확인
```

---

## 3. Hermes 소스 버그 수정 (`_run_npm_install_deterministic`)

### 문제
`hermes dashboard` 실행 시 다음 오류로 웹 UI 빌드가 실패했다:

```
TypeError: _run_npm_install_deterministic() got an unexpected keyword argument 'env'
```

### 원인
`/usr/local/lib/hermes-agent/hermes_cli/main.py`의 `_build_web_ui()`가
`_run_npm_install_deterministic()`을 `env=build_env`로 호출하는데, 해당 함수
시그니처에 `env` 파라미터가 없었다. 함수 내부는 이미 `env or {}`를 참조하고 있었다.

### 수정
함수 시그니처에 `env` 파라미터를 추가:

```python
def _run_npm_install_deterministic(
    npm: str,
    cwd: Path,
    *,
    extra_args: tuple[str, ...] = (),
    capture_output: bool = True,
    env: dict | None = None,   # ← 추가
) -> subprocess.CompletedProcess:
```

### ⚠️ 유의
이 수정은 **설치된 Hermes 소스**에 직접 적용한 것으로, `hermes update` 시
덮어써질 수 있다. 업데이트 후 대시보드 빌드가 실패하면 이 패치를 다시 적용할 것.

---

## 4. 대시보드 실행

이 환경에는 두 개의 웹 대시보드가 있다:

| 포트 | 명령 | 용도 |
|---|---|---|
| `18935` | Hermes WebUI (Android proot) | 주 대시보드, Kanban 탭 포함 |
| `9119` | `hermes dashboard --port 9119 --no-open` | config/세션/API키 관리 대시보드 |

9119 대시보드 실행 예시 (백그라운드):
```bash
hermes dashboard --port 9119 --no-open &
```

---

## 5. 테스트/CI 현황

| 프로젝트 | 테스트 수 | 상태 |
|---|---|---|
| `hello-cli` | 3 | ✅ |
| `todo-list` | 30 | ✅ |
| `fastapi-backend` | 5 | ✅ (100% 커버리지) |

CI 워크플로: `.github/workflows/ci.yml` — 3개 프로젝트 매트릭스 테스트, 실패 시 실패 처리.
fastapi-backend는 `httpx2` dev 의존성 필요 (`pip install -e '.[dev]'`).
