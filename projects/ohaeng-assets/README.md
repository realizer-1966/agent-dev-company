# ohaeng-assets — 오행 자산 진단기 (FEAAS 1단계 MVP)

보유 자산을 오행 5자산군으로 분류·점수화하고, 포트폴리오의 오행 분포·균형도(EBI)를 진단하며,
경제 국면 프리셋(A~E)에 따른 목표 배분 제안과 리밸런싱 힌트를 제공하는 한국어 단일 페이지 정적 웹앱.

- **FEAAS**: Five Elements AI Asset Allocation System — 운용 기간 3~5년 중장기, 균형 성장형
- 철학: "자산을 예측하는 것이 아니라 경제의 변화를 예측하고, 경제의 변화에 맞춰 자산의 균형을 조절한다."
- **유일 근거문서**: [`docs/requirements.md`](docs/requirements.md) (v2.0) — 이 README는 그 요약이다
- **v2a Python 엔진(엔진 계열)**: [`docs/requirements-v2.md`](docs/requirements-v2.md) — 엔진 스코프의 유일 근거문서 (아래「FEAAS v2a — Python 엔진」섹션)
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

# 방법 2 — Cloudflare Pages(배포): https://feaas-ohaeng.pages.dev
# http(s) 서빙이므로 동일하게 동작 — rental-web 인증 경로 재사용, 별도 프로젝트 이름(req 8장)
```

## 배포 (Cloudflare Pages — req 8장·수용기준 3번)

- **프로덕션 URL**: https://feaas-ohaeng.pages.dev — 별도 프로젝트 **`feaas-ohaeng`**(rental-web-aeh.pages.dev와 분리, 덮어쓰기 없음)
- **인증**: rental-web과 동일한 기기 OAuth device-flow 토큰 재사용(`/root/.wrangler/config/default.toml` — 만료 시 refresh_token으로 자동 연장). 프로필 샌드박스 환경에서는 `HOME=/root`로 실행해야 레거시 `~/.wrangler` 토큰 경로를 읽는다.

```bash
# 최초 1회 — 프로젝트 생성 (production branch: main)
HOME=/root npx --yes wrangler pages project create feaas-ohaeng --production-branch=main

# 배포(재배포 동일) — repo 루트에서 실행
HOME=/root npx --yes wrangler pages deploy projects/ohaeng-assets --project-name=feaas-ohaeng --branch=main --commit-dirty=true

# 도달 확인 (수용기준 3번)
curl -sS -o /dev/null -w '%{http_code}\n' https://feaas-ohaeng.pages.dev/                 # → 200
curl -sS -o /dev/null -w '%{http_code}\n' https://feaas-ohaeng.pages.dev/ui/app.js       # → 200 (ES 모듈 진입점)
curl -sS https://rental-web-aeh.pages.dev/ | grep -o "<title>[^<]*</title>"              # → <title>임대관리 앱</title> (대조 — 영향 없음)
```

- 2026-11-02 첫 배포 실적: 29파일 업로드, `/`·`ui/app.js`·`src/*.js` 전부 HTTP 200, 배포 스냅샷 `https://a316f1d5.feaas-ohaeng.pages.dev`

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

## FEAAS v2a — Python 엔진 (engine/)

v2a 스코프: **실측 경제 데이터(FRED·Stooq) fetch → 오행 경제지수(10년 rolling percentile, 0~100) →
국면 A~E 자동 판정 → 15년 백테스트 검증 → 정적 웹앱 "실측 모드"(state.json) 반영**.
- 유일 근거문서: [`docs/requirements-v2.md`](docs/requirements-v2.md) — `docs/requirements.md`는 v1(web MVP) 기준일 뿐
- **테스트 정책**: 표준 라이브러리 **unittest**(venv 기준) — AGENTS.md pytest 지침의 v2a 예외. pytest-mock·mutmut·cProfile은 v2a 미적용

### venv 부스트랩(1회)

```bash
cd projects/ohaeng-assets
python3 -m venv engine/.venv
engine/.venv/bin/pip install -r engine/requirements.txt   # numpy 최소 — aarch64 wheel 실측 2.4.6 (2026-11-02)
```

- 설치 실패 시 **stdlib 폴백 전환**: numpy 미사용을 이 README에 선언하고 코어를 순수 stdlib로
  설계해 수용기준을 유지한다(req-v2 §0). 현재는 설치 성공 → 코어는 **stdlib 우선 + numpy 허용**.
- pandas·scipy는 선택 항목 — v2a에서 **설치 금지**.

### 테스트 실행

```bash
cd projects/ohaeng-assets/engine
.venv/bin/python -m unittest discover        # 골격 계약 + 모듈 행위 테스트 전부
```

### 구조 v2a (req-v2 §1) — 현재 골격 상태

| 파일 | 역할 | 상태 |
|---|---|---|
| `engine/feaas/sources.py` | FRED·Stooq CSV fetcher + 로컬 캐시·retry — **네트워크·FS 격리 계약**: 실 fetch는 이 모듈만 | **② v2a 구현 완료** (총 3시도 retry·백오프·timeout 30s·캐시 히트 0네트워크) |
| `engine/feaas/indicators.py` | 지표 정의서 — 오행×데이터 ID 매핑 | **② v2a 구현 완료** — `INDICATOR_DEFS` 17종 확정 → [`docs/indicator-map.md`](docs/indicator-map.md) |
| `engine/feaas/scores.py` | 표준화 — 10년 rolling percentile → 0~100 | **② v2a 구현 완료** (carry-forward·역방향 100−p·평균 round·clamp·부족=누락 표기) |
| `engine/feaas/classifier.py` | 국면 A~E 판정(복수 지표 조합 규칙) | skeleton(stub) — ③ |
| `engine/feaas/backtest.py` | 국면→배분 시프트 시뮬레이션·성과지표 | skeleton(stub) |
| `engine/feaas/report.py` | state.json 구성·스키마 검증(순수) | skeleton(stub) |
| `engine/run_pipeline.py` | 배치 진입점 stub — 실행 순서 문서화 | stub(NotImplementedError) |

함수 본문(구현)은 계층 ②(지수·판정)·③(백테스트·실측 모드) 티켓이 TDD(RED→GREEN)로 채운다.

### FRED fixture 포맷 (`engine/data/fixtures/`)

fetch 실측 포맷과 일치시켜 ② 티켓이 그대로 재사용하는 샘플 — **4종**:

| fixture | 포맷 | 내용 |
|---|---|---|
| `fredgraph_DGS10_2024-01.csv` | 실측 다운로드 원본 | 미국채 10년 (일간, 결측 1건) |
| `fredgraph_VIXCLS_2021-02.csv` | 실측 다운로드 원본 | VIX (일간, 역방향 지표, 결측 1건) |
| `fredgraph_UNRATE_2024.csv` | 실측 다운로드 원본 | 실업률 (월간, 수준 지표) |
| `fredgraph_LEGACY_DATE_dot.sample.csv` | 문서 포맷 · 합성 샘플 | 결측 `.` 마커 시연 |
| `stooq_spx_daily.sample.csv` | 문서 포맷 · 합성 샘플 | Stooq 일별 CSV(Date,Open,High,Low,Close,Volume — ② 확정) |

- **실측 포맷(2026-11-02 확인)**: 헤더 `observation_date,<FRED_ID>` — 결측은 **빈 문자열** (예: `2024-01-15,`)
- **문서 포맷(req-v2 §0·티켓 명시, 구 FRED 응답)**: 헤더 `DATE,<FRED_ID>` — 결측 `.` (예: `2024-01-09,.`)
- 파서 계약(② 구현): 두 헤더 변형 모두 수용, 결측 `.`·빈 문자열을 모두 None으로 정규화 — fixture 4종으로 고정
- URL: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>` — API 키 불필요(실측 200, req-v2 §0)
- **지표 정의서(② 산출)**: [`docs/indicator-map.md`](docs/indicator-map.md) — 오행×ID 17종 매핑 표,
  후보 기각·대체 근거(BAMLH0A0HYM2/SP500/SOFR 라이선스·이력 한계), 표준화 정책(carry-forward·역방향
  100−p·평균 round·clamp·**부족 10년 → 누락 표기 확정**)을 전부 기록
- fetch 정책(② 확정): 총 3시도(재시도 2회·백오프 0.5→1.0s)·timeout 30s·실패 시 `FetchError`·
  캐시 히트 시 네트워크 0호출(refresh=True만 재수집) — 캐시 파일은 `engine/data/cache/`(FRED `<ID>.csv`·Stooq `stooq-<심볼>-<주기>.csv`)

### v2a / v2b 경계

- **v2a(본 스코프)**: fetch+표준화, 지표 정의서, 국면 판정, 백테스트(한계 정량화 목적 — 수익 우위 필수 아님), state.json 생성·검증. 월간 배치 크론 등록은 **CEO 직접**(엔진·티켓에 크론 포함 금지, req-v2 §4)
- **v2b 절대 금지**: ML 예측(XGBoost/LightGBM·TFT), CVXPY/PyPortfolioOpt 최적화, API 서버 자동 실행, PostgreSQL

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
├── tests/                # node --test (Node 22 내장 러너) — 웹 v1 전용
├── engine/               # v2a Python 엔진 — 「FEAAS v2a — Python 엔진」섹션
│   ├── feaas/            # sources·indicators·scores·classifier·backtest·report (순수 함수)
│   ├── run_pipeline.py   # 배치 진입점 stub — 실행은 ②③ 티켓
│   ├── tests/            # v2a unittest — 표준 라이브러리(venv 기준, pytest 예외)
│   ├── data/fixtures/    # FRED fredgraph.csv 샘플 4종 + Stooq 샘플 1종 (② 확정)
│   └── requirements.txt  # numpy 최소 · pandas/scipy 선택 주석
├── docs/
│   ├── requirements.md        # v1(web MVP) 유일 근거문서 v2.0
│   ├── requirements-v2.md     # v2a 엔진 유일 근거문서
│   ├── indicator-map.md       # v2a 지표 정의서 — 오행×ID 매핑·기각 근거·표준화 정책 (②)
│   └── v2-ideas.md            # v2 기록 전용 (MVP 금지 항목)
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