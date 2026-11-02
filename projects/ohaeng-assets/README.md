# ohaeng-assets — 오행 자산 진단기 (FEAAS 1단계 MVP)

보유 자산을 오행 5자산군으로 분류·점수화하고, 포트폴리오의 오행 분포·균형도(EBI)를 진단하며,
경제 국면 프리셋(A~E)에 따른 목표 배분 제안과 리밸런싱 힌트를 제공하는 한국어 단일 페이지 정적 웹앱.

- **FEAAS**: Five Elements AI Asset Allocation System — 운용 기간 3~5년 중장기, 균형 성장형
- 철학: "자산을 예측하는 것이 아니라 경제의 변화를 예측하고, 경제의 변화에 맞춰 자산의 균형을 조절한다."
- **유일 근거문서**: [`docs/requirements.md`](docs/requirements.md) (v2.0) — 이 README는 그 요약이다
- v2 아이디어(실시간 경제데이터·ML 예측·백테스트·자동 리밸런싱·Python/DB 스택)는 MVP에 포함 금지 — [`docs/v2-ideas.md`](docs/v2-ideas.md) 기록 전용

## 실행 방법

빌드 도구는 불필요하지만, 코어 로직이 ES 모듈(import/export)이므로 **정적 서버(http) 경유가 필요하다**.
`file://` 직접 열기는 동작하지 않는다 — ES 모듈 CORS 제약: Chromium은 file:// 모듈 로딩을 전면 차단하고
Firefox/LibreWolf는 "Module source URI is not allowed… / CORS request not http"로 상위 디렉터리 import를
차단한다(WHATWG whatwg/html#8121 참조).

```bash
# 방법 1 — 정적 서버(권장, 로컬 실측 기준)
cd projects/ohaeng-assets && python3 -m http.server 8000
# → http://localhost:8000 접속 — index.html이 ui/app.js(ES 모듈 진입점)를 로드해 앱이 동작한다

# 방법 2 — Cloudflare Pages(배포)
# http(s) 서빙이므로 동일하게 동작 — rental-web 인증 경로 재사용, 별도 프로젝트 이름(req 8장)
```

## 테스트 방법

Node 22 내장 러너(`node --test`)만 사용 — 외부 의존성 0, 라이브러리 설치 없음:

```bash
cd projects/ohaeng-assets
node --test "tests/**/*.test.js"   # 또는: npm test
```

- `tests/structure.test.js` — 러너·Node 버전 구조 확인(플레이스홀더)
- `tests/skeleton.test.js` — 골격 계약 테스트: 코어 7모듈의 export 시그니처 존재성, 데이터 상수 형상(키 완전성·합 100·허용 범위 내), 각 모듈 핵심 실동작 요약 단언
- `tests/*.test.js` (모듈별) — 실제 수치·행위 케이스(req 9장 수용기준 1번 8종) — 코어 엔진 TDD 티켓이 RED→GREEN으로 채움
- `tests/ui-*.test.js` (UI 3종) — 상태 모듈 계약({ok, state|error}·원자적 복원), 레이더·상생 SVG 빌더, index.html 구조 계약 — UI 티켓 TDD로 채움. 현재 **122/122 통과(코어 78 + UI 44)**

## 구조

```
projects/ohaeng-assets/
├── index.html            # 한국어 단일 페이지 정적 진단기 — 7섹션 전체 (ui/app.js가 module 진입점)
├── ui/                   # UI 레이어 — 계산은 src barrel import 전용(UI에서 재구현 금지)
│   ├── app.js            # 엔트리 — DOM 생성·이벤트·렌더 바인딩 ({ok, state|error} 계약 경유)
│   ├── state.js          # 상태 모듈 — 항목 추가·수정·삭제, 지표/국면/토글, 직렬화·완전검증 복원
│   ├── radar.js          # 오각형 레이더·상생 순환 SVG 빌더 (허용 범위 밴드·기준 배분 오버레이)
│   └── styles.css        # 스타일 — 고지 스티키 바, 375px 모바일 우선 레이아웃
├── src/                  # 코어 로직 — UI와 분리된 순수 ES 모듈 (req 8장)
│   ├── vectors.js        # 유형별 기본 5요소 벡터 상수 (req 6장, Gold=金 반영)
│   ├── classify.js       # 유형 분류: 투자 대상 → 오행 자산군 (req 2장)
│   ├── weighted.js       # 금액 가중 평균 → 포트폴리오 오행 분포 (req 6장)
│   ├── ebi.js            # EBI 균형도 0~100 (req 7장, 정의 문서화)
│   ├── regimeShift.js    # 국면 프리셋→목표 배분 시프트 (req 3·4장, clamp·합 100 보정)
│   ├── rebalance.js      # 리밸런싱 제안 (±5%p 트리거, req 7장)
│   ├── circulate.js      # 상생 매핑 상수 木→火→土→金→水 (req 5장)
│   └── index.js          # barrel — UI는 이 모듈만 import, 계산 재구현 금지
├── tests/                # node --test (Node 22 내장 러너)
├── docs/
│   ├── requirements.md   # 유일 근거문서 v2.0
│   └── v2-ideas.md       # v2 기록 전용 (MVP 금지 항목)
└── package.json          # 테스트 실행 안내 수준 (의존성 0)
```

## 코어 규칙 (데이터 상수 요약 — 근거는 requirements.md)

| 항목 | 값 | 근거 |
|---|---|---|
| 기준 배분 | 木30 · 火10 · 土20 · 金25 · 水15 (합 100) | req 3장 |
| 허용 범위 | 木20~40 · 火5~15 · 土10~30 · 金20~35 · 水10~30 | req 3장 |
| 국면 프리셋 | A 성장 확장기 · B 인플레이션 상승기 · C 실물경제 안정기 · D 금융 불안기 · E 유동성 회복기 (E는 수→목 이동 방향) | req 4장 |
| 리밸런싱 트리거 | \|현재−목표\| ≥ 5%p만 이동 제안 (4.99%는 제안 없음) | req 7장 |
| Gold 분류 | 금(Gold)·은(Silver)은 **金** — v1의 火 배치 폐기 | req 0.1·2장 (v2.0) |

## EBI(균형도 지수) 정의 — req 7장

EBI(Energy Balance Index)는 0~100의 균형도 지수다. 5오행 분포가 기준 배분(木30/火10/土20/金25/水15)에
가까울수록 100에 가깝고, 단일 오행 100% 집중이면 최저에 가까운 값을 낸다. 기준 배분과 완전히 동일하면
최대값(100)이다.

산식(`src/ebi.js` — tests/ebi.test.js로 경계 고정):

```
EBI(d) = Math.round(100 − 0.5·Σ|d−기준|)   // 기준 배분과의 각 오행 절대격차 합(L1 총변동거리)의 절반
```

- 기준 배분과 동일 → 격차 합 0 → **100(최대)**. 단일 오행 100% 집중 → **그 오행의 기준 비중 값**
  (木→30 · 火→10 · 土→20 · 金→25 · 水→15; 합 100 도메인 전체 최저는 火 100 집중 = 10).
- 반올림은 소수점 첫째 자리(Math.round, 0.5는 올림) — 정수 반환. 입력 합계는 100(허용오차 1e-9)으로
  검증하며 어긋나면 거부한다.

## 구현 상태 (티켓 ① 스캐폴딩 + ② 코어 엔진 TDD + ③ UI 구현)

- 코어 7모듈 + barrel의 **경계·시그니처 확정 완료(①)**. 계산 함수 본문은 ② 티켓이
  모듈별 수직 슬라이스(RED→GREEN)로 구현 완료:
  vectors(수용기준 1) · circulate(7) · classify(8) · weighted(2) · regimeShift(3·4) ·
  rebalance(5) · ebi(6).
- UI는 ③ 티켓이 구현 완료: `index.html`의 `<script type="module" src="ui/app.js">` 진입점으로
  레이더·자산 입력·벡터 슬라이더·지표·국면 제안(Δ%p)·리밸런싱 힌트·EBI·상생 SVG·고지 3종+
  Gold=金 노트·localStorage 토글·375px 모바일 우선을 바인딩 — 계산은 코어 barrel 경유(UI 재구현 0).
- `src/*` 데이터 상수(ASSET_TYPES 기본 벡터·기준 배분·허용 범위·국면 프리셋·상생 매핑)는 확정 값이며
  골격 계약 테스트 + 모듈별 행위 테스트로 고정돼 있다.
- QA(브라우저 실측 — 수용기준 2번: 레이더 갱신·국면 제안·localStorage 복원·375px) →
  Cloudflare Pages 배포는 후속 티켓.