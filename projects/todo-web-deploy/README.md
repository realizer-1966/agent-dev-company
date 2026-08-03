# todo-web-deploy — OnDev 배포용 버전

OnDev Store에 배포된 **할 일 관리 웹앱**의 정적(프론트 전용) 버전입니다.

## 🔗 배포 링크

- **Claim URL**: `https://ondev.store/claim/i4fpk4` (claim 후 실제 앱 페이지가 열립니다)
- **app_id**: `todo-web-app`

> ⚠️ 이 버전은 **브라우저 `localStorage`**에 데이터를 저장하는 프론트 전용 앱입니다.
> (동일 기능의 FastAPI 백엔드 버전은 `projects/todo-web/`에 있습니다)

## 🗂️ 구성

```
todo-web-deploy/
├── index.html   # 할 일 관리 앱 (HTML + Tailwind + JS)
├── icon.svg     # 앱 아이콘
├── app.json     # OnDev 메타데이터
└── todo-web-app.zip  # 배포용 ZIP
```

## 🚀 재배포 방법

```bash
cd projects/todo-web-deploy
ZIP_B64=$(base64 < todo-web-app.zip | tr -d '\n')
curl -s -X POST https://ondev.store/api/deploy -H "Content-Type: application/json" -d "{
  \"app_id\": \"todo-web-app\",
  \"zip_b64\": \"$ZIP_B64\",
  \"app_type\": \"web_app\",
  \"site_map\": [\"/\"]
}"
```

## ✨ 기능

- 할 일 추가 / 완료 토글 / 삭제
- 진행중 / 완료 필터, 완료 항목 일괄 삭제
- 데이터 자동 저장 (localStorage)
- 모던 반응형 UI (Tailwind CSS)
