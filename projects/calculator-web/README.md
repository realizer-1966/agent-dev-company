# calculator-web — 계산기 웹앱

OnDev Store에 배포된 **계산기 웹앱**입니다.

## 🔗 배포 링크

- **Claim URL**: `https://ondev.store/claim/3hy69c`
- **app_id**: `calculator-web`

## ✨ 기능

- 사칙연산 (+, −, ×, ÷)
- 소수점, 퍼센트(%), 백스페이스, 전체 초기화(AC)
- 마우스 클릭 + 키보드 지원 (Enter=계산, Backspace=삭제, Esc=초기화)
- 0으로 나누기 오류 처리
- 세련된 다크 테마 반응형 UI (Tailwind CSS)

## 🗂️ 구성

```
calculator-web/
├── index.html      # 계산기 앱 (HTML + Tailwind + JS)
├── icon.svg        # 앱 아이콘
├── app.json        # OnDev 메타데이터
└── calculator-web.zip  # 배포용 ZIP
```

## 🚀 재배포

```bash
cd projects/calculator-web
ZIP_B64=$(base64 < calculator-web.zip | tr -d '\n')
curl -s -X POST https://ondev.store/api/deploy -H "Content-Type: application/json" -d "{
  \"app_id\": \"calculator-web\",
  \"zip_b64\": \"$ZIP_B64\",
  \"app_type\": \"web_app\",
  \"site_map\": [\"/\"]
}"
```
