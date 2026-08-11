# LiteRT Chat — 온디바이스 LLM 데모

갤러리(gallery) 스타일 온디바이스 LLM 채팅의 **정적 데모 웹앱** (OnDev Store 배포용).

실제 LiteRT 채팅 서버(백엔드: `litert-lm serve` + FastAPI/표준라이브러리 서버)는
OnDev Store가 정적 호스팅만 지원하므로 여기에 배포할 수 없다. 이 폴더는
**브라우저에서 동작하는 인터랙티브 데모**다 — 스킬(시간·계산·날씨·랜덤)과
멀티턴 대화, 온디바이스 스트리밍 UI를 실제로 체험할 수 있다.

## 파일
- `index.html` — Vue 3 + Tailwind CDN, 단일 파일
- `icon.svg` — 앱 아이콘 (밝은 파랑/에메랄드)
- `app.json` — OnDev 메타데이터
- `litert-chat-app.zip` — 배포용 압축본 (생성됨)

## 배포
```bash
cd projects/litert-chat-deploy
zip -r litert-chat-app.zip index.html icon.svg app.json
# → POST https://ondev.store/api/deploy (app_type: web_app)
```

## 실제 백엔드 연동
실제 온디바이스 LLM 답변을 원하면 `/root/workspace/litert-chat/server.py` 를
백엔드 서버로 구동해 이 UI에서 `fetch`로 연결한다 (로컬/LAN 전용).
