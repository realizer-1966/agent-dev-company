# ladder-web — 사다리 게임

OnDev Store에 배포된 **사다리 게임 웹앱**입니다.

## ✨ 기능

- 참가자 이름과 결과(상품/꽝 등)를 입력해 **사다리타기**로 랜덤 매칭
- 참가자 수와 결과 수가 달라도 자동 처리 (결과 부족 시 "꽝"으로 채움)
- **가로선 밀도** 조절 (3~12) — 가로선 개수로 난이도 변경
- 결과는 **공개 버튼**을 누르기 전까지 숨겨져 있어 모두가 긴장감을 즐길 수 있음
- 공개 시 참가자 → 결과 매칭을 화살표로 강조
- 세련된 그라데이션 다크/라이트 혼합 반응형 UI (Tailwind CSS)
- 데이터는 로컬에서만 처리 (서버 전송 없음, 개인정보 안전)

## 🗂️ 구성

```
ladder-web/
├── index.html      # 사다리 게임 앱 (HTML + Tailwind + JS)
├── icon.svg        # 앱 아이콘
├── app.json        # OnDev 메타데이터
└── ladder-web.zip  # 배포용 ZIP
```

## 🚀 재배포

```bash
cd projects/ladder-web
ZIP_B64=$(base64 < ladder-web.zip | tr -d '\n')
curl -s -X POST https://ondev.store/api/deploy -H "Content-Type: application/json" -d "{
  \"app_id\": \"ladder-web\",
  \"zip_b64\": \"$ZIP_B64\",
  \"app_type\": \"game\",
  \"site_map\": [\"/\"]
}"
```

## 🎲 사다리타기 원리

- 세로줄 N개, 가로선은 인접한 두 세로줄을 잇는다
- 위에서 아래로 내려가며 가로선을 만나면 옆 줄로 이동
- 도착한 세로줄 아래에 결과가 배치됨
- 가로선이 연속으로 겹쳐 이중 이동하는 경우는 생성 로직에서 방지
