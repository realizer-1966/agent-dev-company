# 2026-11-02 세션 로그 — ohaeng-assets (FEAAS) 발주 → 납품

## 개요
- CEO 컨셉 문서 3편 통합 → `projects/ohaeng-assets/docs/requirements.md` v2.0 작성(FEAAS 1단계 진단기 MVP)
- 분류 체계 v2 확정: **Gold=金**(v1의 火 배치 폐기), 화=에너지·원자재. 기준 배분 木30/火10/土20/金25/水15 + 허용 범위, 국면 프리셋 A~E, EBI 균형도, ±5%p 리밸런싱 트리거
- CEO 확정 조건: 목적=경제환경 예측·자동 배분 / 3~5년 / 균형 성장형

## 실행 기록
- 스모크: `t_5d093e39` 통과(ready→running→done, 17s)
- PM: `t_eee5e53d` — MVP 티켓 5장 분해 + 의존성 1←2←3←4←5 (gated_by)
- ① 스캐폴딩: 코어 ES 모듈 8종·index.html 7섹션·node --test 22/22 — ※reviewer 없이 done 새어나감(감시 루프 force 누락) → CEO 직접 검수로 폐쇄
- ② 코어 TDD: reviewer 라운드1 변경요청(수정 체크리스트) → 라운드2 승인(독립 실측 78/78·퍼즈 5,000·경계 8종)
- ③ UI: 레이더(밴드·오버레이)·상태 모듈·app.js 바인딩 — reviewer 승인
- ④ QA: reviewer 직수행, 실브라우저 36/36(Chromium headless-shell 156, 375×812 DPR2) + 증빙 스크린샷 9장 → `/root/.hermes/profiles/reviewer/qa4-evidence/`(내구 복사본)
- ⑤ 배포: https://feaas-ohaeng.pages.dev (wrangler, 29 files, rental-web 기기 토큰 재사용) — reviewer 독립 재현
- CEO 최종 검수: prod에서 동일 프로브 36/36 재현(3원 대조), 상시 URL 200, snapshot 200, rental-web 200 무영향, src/index.js·ui/app.js 해시 동일(prod==로컬), 테스트 122/122
- 푸시: GitHub main (19 commits) / 보드 전부 아카이브

## 교훈
1. kanban `request-review`는 live claim(running) 티켓에 `--force` 필수 — 생략 시 거부로 reviewer 없이 done 새어나감(감시 루프 출력 필터에 'not' 같은 과잉 키워드 금지)
2. 워커는 본인 티켓으로 스코핑됨 — PM이 자식 티켓의 request-review 대행 불가
3. 모델 응답 중단으로 워커 run이 크래시해도 자동 retry·재할당은 작동(이틀 총 3회)
4. uv 기반 브라우저 자동화는 하드링크 한계로 실패 — `npm playwright-core` + `npx playwright install chromium --only-shell` + `PLAYWRIGHT_BROWSERS_PATH` 우회(실증: reviewer r2-verify)
5. 감시 루프(45s 폴링 + flag 파일 + 로그)로 리뷰 레인 자동화 — 무인 사망 대비 재기동 스크립트 파일로 운용