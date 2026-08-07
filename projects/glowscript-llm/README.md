# glowscript-llm

**GlowScript LLM 생성 백엔드** — 자연어 설명을 받아 **진짜 LLM(클라우드 Ollama)이 GlowScript/VPython 코드를 생성**하는 FastAPI 서비스입니다.

OnDev Store의 정적 웹앱은 API 키를 클라이언트에 노출할 수 없으므로, 이 백엔드가 LLM 호출을 중개합니다.

## 개요

- **`POST /api/generate`** — 자연어 설명 → GlowScript 코드 생성
- **`GET /health`** — 서버 상태 확인
- LLM 실패 시 **템플릿 폴백**으로 항상 유효한 코드 반환

## 구성

- `app/llm.py` — `LLMClient`(클라우드 Ollama API 호출) + `GlowScriptGenerator`(코드 추출·폴백)
- `app/main.py` — FastAPI 엔드포인트 (API 키를 환경변수 또는 Hermes config에서 로드)

## API 키 로드

API 키는 다음 순서로 로드됩니다:
1. 환경변수 `GLOWSCRIPT_LLM_API_KEY`
2. Hermes config (`~/.hermes/config.yaml`의 `model.api_key`)

키가 없으면 LLM 없이 템플릿 폴백만 동작합니다.

## 실행

```bash
cd projects/glowscript-llm
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

## 사용 예

```bash
# 진짜 LLM이 코드 생성
curl -X POST http://127.0.0.1:8010/api/generate \
  -H "Content-Type: application/json" \
  -d '{"description": "공을 위로 던져 포물선 운동"}'
```

## 테스트

```bash
python -m pytest -q   # 7 tests
```

## 보안 메모

- OnDev 웹앱은 정적 호스팅이라 **API 키를 클라이언트에 넣으면 안 됩니다.**
- 이 백엔드는 키를 서버 측에서만 보관하며, 웹앱은 이 백엔드의 `POST /api/generate`만 호출하면 됩니다.
- 배포 시 CORS를 구성해 웹앱 도메인만 허용하세요.
