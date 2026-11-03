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

# 배포(재배포 동일) — repo 루트에서 실행. engine/은 배포 아티팩트에서 제외해야 한다:
#  2026-11-03 실측 — wrangler 4.156은 .wranglerignore를 읽지 않는다(repo 내 파일은 의도 문서일 뿐).
#  그래서 배포 시 engine/을 잠깐 프로젝트 밖으로 옮겼다가 배포 직후 되돌리는 절차로 제외한다
#  (engine을 그대로 두면 27.4MiB numpy 라이브러리 > Pages 25MiB 제한으로 업로드 자체가 실패한다 — 실측).
#  2026-11-03 실측 — npx 무지정 wrangler@4.157+miniflare 신규 beta는 workerd 로딩 실패(Android/aarch64) →
#  4.156.0 고정(v1 첫 배포와 동일 버전).
ENGINE_STASH=/root/engine-deploy-stash
mv projects/ohaeng-assets/engine "$ENGINE_STASH"
HOME=/root npx --yes wrangler@4.156.0 pages deploy projects/ohaeng-assets --project-name=feaas-ohaeng --branch=main --commit-dirty=true
mv "$ENGINE_STASH" projects/ohaeng-assets/engine   # 배포 종료 후 반드시 되돌린다(엔진 복수 존재 확인)

# 도달 확인 (수용기준 3번·5번)
curl -sS -o /dev/null -w '%{http_code}\n' https://feaas-ohaeng.pages.dev/                 # → 200
curl -sS -o /dev/null -w '%{http_code}\n' https://feaas-ohaeng.pages.dev/ui/app.js       # → 200 (ES 모듈 진입점)
curl -sS https://rental-web-aeh.pages.dev/ | grep -o "<title>[^<]*</title>"              # → <title>임대관리 앱</title> (대조 — 영향 없음)
```

- 2026-11-02 첫 배포 실적: 29파일 업로드, `/`·`ui/app.js`·`src/*.js` 전부 HTTP 200, 배포 스냅샷 `https://a316f1d5.feaas-ohaeng.pages.dev`
- 2026-11-03 v2a 재배포 실적(티켓 ⑤): **engine/ 제외**(위 절차) — 배포 파일 35개 = engine 제외 전체 산출물
  (`find projects/ohaeng-assets -path engine -prune -o -type f` 전부; 첫 배포 29 대비 +6 — `ui/batch.js`·
  `tests/batch-mode.test.js`·`.wranglerignore`·`docs/qa-v2a-report.md`·README·docs 갱신. venv·캐시·out 유출 0 —
  engine 존재 시 업로드가 25MiB 제한으로 실패했던 실측이 방어선). 배포 스냅샷 `https://e92c2fed.feaas-ohaeng.pages.dev`.
  `/`·`/ui/app.js`·`/ui/batch.js`·`/docs/requirements-v2.md` HTTP 200 실측. **`/data/state.json`·`/engine/*`는
  CF Pages 단일 페이지 폴백으로 200+index.html(text/html) — 파일 존재가 아님**; 웹앱은 본문이 JSON이 아님을
  검증해 조용히 수동 모드로 유지한다(실측 모드 fetch 계약).
  **이번 배포는 `data/state.json` 없이 배포**(부재 → 수동 모드 — 수용기준 5의 無 케이스 실측이기도 하다);
  CEO 주간 Actions(feaas-batch.yml)가 `engine/data/state.json` → `data/state.json` 복사 후 재배포하면 실측 모드로 전환된다(아래).
- **배포 후 아티팩트 검증 방법(⑤ 실측 절차)**: (1) `git ls-files`(engine/·docs/ 제외 — 정적 웹 산출물 30종)의
  md5를 배포 URL 응답과 1:1 대조 — 전 파일 MATCH여야 한다(스크래치 도구). (2) 존재해서 안 되는 경로
  (`data/state.json`·`engine/*`)는 CF Pages 단일 페이지 폴백 200+text/html임을 확인 — 파일 존재가 아님.
  (3) `/`·`/ui/app.js` HTTP 200. 각 재배포의 스냅샷 ID는 배포 시점마다 갱신되므로 보고(칸반)에 기록한다.

## 실측 모드(배치 산출 반영) — 티켓 ⑤ (req-v2 §4)

웹앱은 `data/state.json`(index.html 상대경로)를 `fetch`로 확인해 두 가지로 분기한다:

| state.json | 동작 |
|---|---|
| **부재(404·네트워크 실패·무결 위반)** | **조용히 포기** — 배너 노출·콘솔 에러 노출 0, 기존 수동 모드 그대로(회귀 없음) |
| **존재(무결)** | 배너 **「실측 모드(배치 시각: <생성시각>)」** + 지수 5종(레이더 실측 다각형 오버레이·지표 슬라이더)·국면·목표 배분·배치 제안 리밸런싱·프록시 한계 고지를 실측 값으로 반영 — UI·계산은 v1을 그대로 재사용(코어 barrel 경유, 목표 배분은 v1 REGIME_PRESETS 대조 무결 검증 — 어긋나면 배치 전체 거부) |

- 배치 메타(배너·근거·고지·제안)는 세션 스코프 — localStorage 직렬화에서 제외된다(재방문 시 재fetch로 갱신).
- 배치 산출물 반영 계약은 `ui/batch.js`(순수 ES 모듈, tests/batch-mode.test.js 33케이스)가 담당한다.

**배치 산출물 연결 절차(Actions feaas-batch.yml 매주 월요일 수행 — 로컬 실행 금지, req-v2 §4)**:

```bash
cd projects/ohaeng-assets
# (1) 엔진 배치 — engine/data/state.json 갱신(상세는「배치 실행 절차(run_pipeline)」섹션)
engine/.venv/bin/python engine/run_pipeline.py --refresh
# (2) 배포본에 산출물 반영 — engine/data/state.json → data/state.json 복사
mkdir -p data && cp engine/data/state.json data/state.json
# (3) 재배포(위「배포」절 동일 — engine/ 옮기기→배포→복귀) → 사이트가 실측 모드로 전환(배너 생성시각 갱신)
```

**DOM 실측 절차(req-v2 §5-5 — 수용기준 5 대상 실측 방법)**:

```bash
cd projects/ohaeng-assets
cp engine/data/state.json data/state.json   # (有 케이스) 실측 배치 임시 배치
python3 -m http.server 8000                  # 프로젝트 디렉토리에서 정적 서버
# → http://localhost:8000 접속: 배너·근거·지수·국면·목표·제안·고지 확인 → 확인 후 임시 파일 제거
rm -rf data                                  # (有 실측 종료) 배포 아티팩트에 포함되지 않게 제거
```

- **2026-11-03 실측 실적(22항목 전부 일치)**: 無(404·콘솔 0건·배너 히든·수동 값 유지) 9항목 →
  有(배너 「실측 모드(배치 시각: 2026-11-03 11:17:34+00:00)」·근거 8행·프록시 고지·지표 37·78·16·45·63·
  국면 D·목표 20/5/18/32/25·제안 5행·레이더 실측 다각형·콘솔 0건·수동 UI 잔존) 10항목 →
  無 복귀(배너 재히든·수동 초기값) 3항목. 단, 본 실행 환경에는 브라우저 CLI가 없고 설치도 파일시스템
  hardlink 제한으로 불가(qa-v2a-report §5와 동일 사유) → **표준 DOM 엔진(jsdom) + 실제 http.server +
  실제 ui/app.js 모듈 그래프**로 동일 경로를 실측했다(레포 의존성 아님 — 스크래치 도구; 상대경로 fetch 해석은
  브라우저와 1:1). 시각 픽셀 렌더링만 미검증 — DOM·CSS 계약은 테스트(155개)+이 DOM 실측으로 고정.
- **2026-11-03 v2a ⑤ 검증 런 독립 재실측(동일 방식 — 39항목 전부 일치)**: 無(404) 9항목 → 有 12항목
  (배너 문구·생성시각 「2026-11-03 11:17:34+00:00」·근거 8행·1행 문구 「지수 입력: 목=37 · 화=78 · 토=16 ·
  금=45 · 수=63」·프록시 고지 본문·제안 5행·제안 1행 「木 감소 제안 — 기준 30%p → 목표 20%p (Δ −10%p)」·
  국면 D·국면 D 설명·지수 5종 37/78/16/45/63·레이더 실측 다각형·localStorage batch 미포함·콘솔 0건) →
  無 복귀 9항목 → **배포 URL(https://feaas-ohaeng.pages.dev) 無 9항목**(SPA 폴백 본문에서 조용한 포기 —
  수동 모드 유지). 브라우저 CLI 부재·hardlink 제한은 본 런에서 재확인(`hermes pm install agent-browser` →
  uv sync hardlink 오류 재현) — 동일 jsdom 방식 유지.
- 배포본 도달 실측(無 케이스 — 위 v2a 재배포 실적): `https://feaas-ohaeng.pages.dev` 200·`/ui/app.js` 200 +
  배포 URL 기준 DOM 실측 8항목 전부 일치(fetch가 배포 URL 기준으로 해석→미분기 케이스에서 수동 모드 유지).

## 테스트 방법

Node 22 내장 러너(`node --test`)만 사용 — 외부 의존성 0, 라이브러리 설치 없음:

```bash
cd projects/ohaeng-assets
node --test "tests/**/*.test.js"   # 또는: npm test
```

**CI(GitHub Actions)**: push/PR to main 시 `.github/workflows/ci.yml`가 자동 실행 —
rental-web QA + **ohaeng-assets 웹 테스트(node --test) + v2a 엔진 unittest(venv+numpy)**.
로컬 푸시·주간 배치 푸시 모두 CI가 게이트로 동작한다(레드 시 채널로 결과 보고).

- `tests/structure.test.js` — 러너·Node 버전 구조 확인(플레이스홀더)
- `tests/skeleton.test.js` — 골격 계약 테스트: 코어 7모듈의 export 시그니처 존재성, 데이터 상수 형상(키 완전성·합 100·허용 범위 내), 각 모듈 핵심 실동작 요약 단언
- `tests/*.test.js` (모듈별) — 실제 수치·행위 케이스(req 9장 수용기준 1번 8종) — 코어 엔진 TDD 티켓이 RED→GREEN으로 채움
- `tests/ui-*.test.js` (UI 3종) — 상태 모듈 계약({ok, state|error}·원자적 복원), 레이더·상생 SVG 빌더, index.html 구조 계약 — UI 티켓 TDD로 채움
- `tests/batch-mode.test.js` (실측 모드 33종 — 티켓 ⑤) — engine 배치 state.json 무결 파싱(스키마 7필드·전체 거부)·有/無 fetch 각 경로·배너·값 반영(지수·국면·목표·제안)·커밋된 엔진 배치 스모크·레이더 실측 오버레이
- 현재 **155/155 통과(코어 78 + UI 44 + 실측 모드 33** — v1 동결분 122 유지)**

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
| `engine/feaas/classifier.py` | 국면 A~E 판정(복수 지표 조합 규칙) | **③ v2a 구현 완료** (PM 확정 규칙 — 아래「FEAAS v2a ③」섹션, test_classifier.py 경계·우선순위·부족 null 계약) |
| `engine/feaas/backtest.py` | 국면→배분 시프트 시뮬레이션·성과지표 | **③ v2a 구현 완료** (복리·거래비용 0.1%/회·MDD·위기 방어도 — test_backtest.py 고정 fixture 계약) |
| `engine/feaas/report.py` | state.json 구성·스키마 검증(순수) | **③ v2a 구현 완료** (7필드 스키마·오류 list 반환·전체 방어 — test_report.py) |
| `engine/run_pipeline.py` | 배치 진입점 — fixture/캐시 로더·국면·state.json·백테스트 산출 | **③ v2a 구현 완료** (test_pipeline.py — 아래「FEAAS v2a ③」섹션) |

함수 본문은 계층 ②(지수·판정)·③(백테스트·실측 모드) 티켓이 TDD(RED→GREEN)로 채웠다 —
venv unittest 전체 **245 tests OK**(skeleton·sources(PoW 포함)·indicators·scores·classifier·backtest(채권 근사 포함)·report·pipeline).

### FEAAS v2a ⑥ — stooq PoW 우회 + FRED 레그 전환 + 주기별 창 수정 (CEO 직접 — 2026-11-03)

dev 워커가 공급자 정체로 반복 사망(산출 0)하여 티켓 t_93bb9f6a를 CEO가 직접 구현했다(투명 기록):

1. **ISSUE-1 수정**: `run_pipeline.collect_standardized`가 `scores.window_count_for(날짜들)`로
   주기별 10년 창(일 2530·주 520·월 120·분기 40·연 10)을 전달한다 — 구: 전 지표 uniform-120
   (일간 지표 ≈ 6개월 창 → 국면 전도, QA 실측 B→D). 회귀 테스트: 일간 2950관측 fixture로
   2530-창 percentile 일치(uniform-120과 어긋남 검증 포함).
2. **ISSUE-2 결정+구현**: stooq PoW 클라이언트(`solve_pow`·`parse_stooq_challenge`·
   `build_verify_request` — Origin/Referer 필수 403 계약) + cookiejar 세션 재수집. 단,
   **CSV 엔드포인트 'Access denied'는 회수 불가 실측** → 지표·프록시 레그 전부 FRED 전환
   (목=NASDAQCOM+SP500 폴백, 화=DCOILWTICO, 토=CSUSHPINSA, 금=DGS10→듀레이션 근사,
   수=DTB3), stooq는 폴백 후보(클라이언트 유지 — 서버 조건 변화에 대응).
3. **신규 15건 테스트**: sources PoW 7건(주입 fake)·backtest 채권 근사 5건·pipeline 창 2건+
   indicator 표 전환 1건 — **unittest 245 OK**.
4. **실측 배치 산출**: state.json(국면 D)+backtest.json+.md(180개월 3전략 — 위 표).

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

### FEAAS v2a ③ — 국면 판정·15년 백테스트·state.json

**국면 판정(PM 확정 — req-v2 §2, test_classifier.py 경계 고정)**. 10년 rolling percentile 표준화 오행 지수(0~100) 입력:

| 국면 | 규칙 |
|---|---|
| A(성장 확장기) | 목≥60 且 수≥50 |
| B(인플레이션 상승기) | 화≥60 且 (금<50 或 **화−금≥10** — 지수 차 ≥10점) |
| C(실물경제 안정기) | 토≥55 且 화<60 且 금≥50 |
| D(금융 불안기) | 금<50 且 (수<40 或 수↑) |
| E(유동성 회복기) | 수≥45 且 목 6개월 전 대비 상승 |

- **충돌 우선순위 D > B > E > A > C** — 복수 규칙 충족 시 D가 B/E/A/C를 제치고 채택된다.
- '**수↑**'과 '목 6개월 전 대비 상승'은 동일 규격: **현재값 − 6개월 전값 > 0**.
- 판정 입력 **≥2개 오행 지수**(단일 지표 판정 금지). 데이터 부족 → **국면=null + 사유**(부족 지표 명기) — 강제 매칭 금지.

**백테스트 회계(req-v2 §3, test_backtest.py 고정 fixture 계약)**: 최근 15년(데이터 존재 범위), 월말 리밸런싱,
거래비용 **0.1%/회** 거래액 차감(초기 취득 전량 매입 포함), 복리 NAV. 산출: 연율화 수익(CAGR)·연율화 변동성·
MDD(고점 대비 최대 하락, 양수)·샤프(rf=0)·거래비용 총액·위기 방어도(구간 시작→종료 누적 수익 — 2008: 2007-10~2009-03,
2020-03: 2020-02-19~2020-03-31, 관측 부족 시 미산출). 비교 기준선 2종: **60/40**(^spx 60+iet.us 40 — 오행 좌표
목 60·금 40)·**무보정 오행 고정**(木30 火10 土20 金25 水15 — v1 기준 배분 재사용).
**수익 우위 필수 아님** — 규칙 기반 v2a의 한계 정량화 목적, 결과 그대로 보고.

**국면별 목표 배분 = v1 국면 프리셋(`src/regimeShift.js` REGIME_PRESETS) 매핑 재사용 — 재설계 금지**:

| 국면 | 목 | 화 | 토 | 금 | 수 | 합 |
|---|---|---|---|---|---|---|
| A | 38 | 6 | 16 | 25 | 15 | 100 |
| B | 22 | 12 | 16 | 32 | 18 | 100 |
| C | 24 | 6 | 28 | 26 | 16 | 100 |
| D | 20 | 5 | 18 | 32 | 25 | 100 |
| E | 36 | 8 | 16 | 28 | 12 | 100 |

국면 판정 None 월은 기준 배분(무보정)으로 운용 — 국면 강제 배정 금지(req-v2 §2)의 배분 확장이며 노트로 기록된다.

**자산 프록시(⑥ CEO 확정 2026-11-03 — stooq 차단으로 FRED 우선 재구성)**:

| 오행 | 프록시 | 선택 근거·한계 |
|---|---|---|
| 目 | FRED **NASDAQCOM**(나스닥 종합, 일간 가격 지수) | stooq 차단(ISSUE-2) 대체 — 일간 이력 1971~ 실측 14,541행(10년 창·15년 백테스트 창 충족). S&P 성장 프록시로 채택 — S&P 500(FRED SP500)은 10년 데이터 한계(후보 2순위, yoy 폴백) |
| 火 | FRED **DCOILWTICO**(WTI 현물) | 원자재 대표 — 선물 롤오버·베이시스 효과 미반영 |
| 土 | FRED **CSUSHPINSA**(주택가격 지수) | 실물 부동산 대응 — 리츠 총수익과 달리 배당·레버리지·공실 미반영 |
| 金 | FRED **DGS10**(10년물 수익률) → **듀레이션 근사 총수익**(6.5년, `monthly_bond_returns_from_yields`) | 채권 총수익 시리즈가 FRED에 없어 근사 — 쿠폰 재투자·만기 수렴 단순화(v2b 정교화 경계) |
| 水 | FRED **DTB3**(3M T-bill 금리) | req §3 표기 'IRX'는 fredgraph **404**(② 실측) → DTB3 대체. 가격이 아닌 연율 금리 — **월수익 = 연율/12 근사 변환** |

- **Stooq 차단 실측(⑥ — CEO 검증 2026-11-03)**: ① urllib 기본 UA → HTTP 404. ② 브라우저 UA → **JS proof-of-work
  챌린지 HTML(200)** — `const c`,`d` 추출 → sha256 PoW → `POST /__verify`(Content-Type+**Origin+Referer 필수**,
  누락 시 403) → 'ok'+auth 쿠키(까지는 stdlib로 실측 통과, `engine/feaas/sources.py`에 클라이언트 구현·테스트됨).
  ③ **그러나 verify 성공 후에도 CSV 다운로드는 'Access denied' 차단** — stooq는 데이터 소스로 신뢰 불가.
  → ⑥ 결정: 지표·백테스트 레그 전부 FRED 전환, stooq는 폴백 후보로만 유지(PoW 클라이언트가 챌린지 변화에 대응).
- 표준화·지수 산출은 ② 파이프라인(`standardize_indicator`·`element_score`·`window_count_for`·`WINDOW_COUNTS`)을
  그대로 순수 재사용 — ③은 조합 계층만 추가한다.

**state.json 스키마(req-v2 §4 — report.STATE_SCHEMA_FIELDS 고정)**:

| 필드(snake_case) | 한글 | 타입·규격 |
|---|---|---|
| `generated_at` | 생성시각 | tz-aware UTC ISO 8601(예: `2026-11-03T01:29:50+00:00`) |
| `element_scores` | 지수 5종 | {목,화,토,금,수}: 0~100 숫자 또는 null(부족 지표) |
| `regime` | 국면 | "A".."E" 또는 null(판정 불가) |
| `regime_reasons` | 판정 근거 | 문자열 list — 지수 입력·규칙 평가·부족 사유 |
| `target_allocation` | 목표 배분 | {목,화,토,금,수} 합 100%p, 또는 null |
| `rebalance_proposals` | 제안 리밸런싱 | [{element, basis_pct, target_pct, delta_pct}] 또는 [] |
| `proxy_note` | 프록시 한계 고지 | 비어있지 않은 문자열 |

- `validate_state`는 예외 대신 **오류 메시지 list**(빈 list=유효)를 반환하고 어떤 입력에도 예외를 던지지 않는다
  (전체 방어 계약 — 배치가 조용한 무결성 위반을 낼 수 없게 함).

**배치·배포는 GitHub Actions로 수행(2026-11-03 확정 — 로컬 빌드 금지)**:

- 워크플로: [`.github/workflows/feaas-batch.yml`](../../.github/workflows/feaas-batch.yml) —
  매주 월요일 00:00 UTC(09:00 KST) 자동 + `workflow_dispatch` 수동 트리거(2026-11-03 월간→주간 변경).
- 흐름: 테스트 게이트(unittest 전체) → 배치(--refresh, FRED 직접 fetch) → state.json 커밋·푸시 → Pages 배포(engine 스태시 이동 절차 내장) → 배포본 해시 검증.
- **시크릿(일회성 세팅 — repo Settings→Secrets→Actions)**: `CLOUDFLARE_API_TOKEN`
  (Cloudflare 대시보드 → My Profile → API Tokens → Create — 권한 **Account·Cloudflare Pages → Edit**)·
  `CLOUDFLARE_ACCOUNT_ID`. 미설정이면 커밋까지만 수행하고 배포 단계를 `[SKIP]` 로깅 — 시크릿 세팅 후
  Actions 탭에서 Run workflow로 재배포. (로컬 wrangler 인증 경로는 폐지 — 토큰을 채팅으로 다루지 않는 계정 규범 유지)
- **비상 폴백만 로컬 허용**(Actions 사용 불가 재난 시) — 아래 절차는 폴백 용도로 보관:

```bash
cd projects/ohaeng-assets
# venv 가드(부재 시 재생성) — 크론·수동 공통
[ -x engine/.venv/bin/python ] || { python3 -m venv engine/.venv && engine/.venv/bin/pip install -r engine/requirements.txt; }
# (a) 실측 배치 — 캐시 우선(engine/data/cache), 캐시 미스 시 네트워크 fetch
engine/.venv/bin/python engine/run_pipeline.py            # → engine/data/state.json + engine/out/backtest.json+.md
engine/.venv/bin/python engine/run_pipeline.py --refresh  # 캐시 무시하고 재수집
# (b) 오프라인 재현 — fixture만 사용(네트워크 호출 0)
engine/.venv/bin/python engine/run_pipeline.py --fixtures engine/data/fixtures
```

- 옵션: `--state-path`(기본 engine/data/state.json)·`--out-dir`(기본 engine/out)·`--months-back`(기본 180=15년)·`--no-backtest`.
- 종료 코드: **0** = state.json 산출 성공(백테스트 레그 스킵은 WARN), **2** = state 스키마 무효·지표 전무(파일 미산출).
- 프록시 5종이 모두 수집되지 않거나 지수 그리드와 정렬 가능한 월이 2개 미만이면 **백테스트 레그를 스킵**하고
  사유([note] 행)를 출력한다 — **backtest.json 부재 = 스킵 의미**(미산출 ≠ 오류).
- **⑥ 실측 배치(2026-11-03, --refresh)**: 지수 목37·화78·토16·금45·수63(기준월 2026-11) → **국면 D(금융 불안기)** —
  ISSUE-1 수정(주기별 창) 이후 QA 예측 전도(B→D) 그대로 재현. **백테스트 산출(레그 5종 FRED)**:
  2011-09~2026-08 180개월 — 국면 시프트 CAGR 7.88%·변동성 5.82%·MDD 8.55%·샤프 1.35 vs 60/40
  (CAGR 10.75%·변동성 10.67%·MDD 24.80%·샤프 1.01) — 위험조정 성과·하방 방어 우위가 정량 기록됨(수익 우위 필수 아님).
  2008 위기 구간은 데이터 창 밖이라 방어도 미산출(계약대로 누락).
- **⑥ 이후 커밋된 `engine/data/state.json`은 (a) 실측 배치 실적(2026-11-03, --refresh — FRED 17/17)**:
  지수 목37·화78·토16·금45·수63·국면 D. fixture 실행(위의 (b))은 스키마·AC2 경로 검증 용도로 남기고
  배치 산출은 매월 크론(CEO 직접 등록)이 갱신한다 — 수치가 실측으로 채워진 state.json이 웹 "실측 모드" 산입이다.

### v2a / v2b 경계

- **v2a(본 스코프)**: fetch+표준화, 지표 정의서, 국면 판정, 백테스트(한계 정량화 목적 — 수익 우위 필수 아님), state.json 생성·검증. 월간 배치 크론 등록은 **CEO 직접**(엔진·티켓에 크론 포함 금지, req-v2 §4)
- **v2b 절대 금지**: ML 예측(XGBoost/LightGBM·TFT), CVXPY/PyPortfolioOpt 최적화, API 서버 자동 실행, PostgreSQL

## 구조

```
projects/ohaeng-assets/
├── index.html            # 한국어 단일 페이지 정적 진단기 — 7섹션 전체 (ui/app.js가 module 진입점)
├── ui/                   # UI 레이어 — 계산은 src barrel import 전용(UI에서 재구현 금지)
│   ├── app.js            # 엔트리 — DOM 생성·이벤트·렌더 바인딩 ({ok, state|error} 계약 경유) + 실측 모드 부팅(⑤)
│   ├── batch.js          # 실측 모드 계층(⑤) — engine 배치 state.json fetch·무결·적용(순수 ES, node --test 대상)
│   ├── state.js          # 상태 모듈 — 항목 추가·수정·삭제, 지표/국면/토글, 직렬화·완전검증 복원
│   ├── radar.js          # 오각형 레이더·상생 순환 SVG 빌더 (허용 범위 밴드·기준 배분·실측 지수 오버레이 ⑤)
│   └── styles.css        # 스타일 — 고지 스티키 바, 375px 모바일 우선 레이아웃, 실측 모드 스킨(⑤)
├── data/                 # 배포본 실측 산출(⑤) — 크론이 engine/data/state.json를 복사(README「실측 모드」절).
│                         #   부재가 정상(수동 모드) — 실측/배포 절차서 대로만 존재
├── src/                  # 코어 로직 — UI와 분리된 순수 ES 모듈 (req 8장)
│   ├── vectors.js        # 유형별 기본 5요소 벡터 상수 (req 6장, Gold=金 반영)
│   ├── classify.js       # 유형 분류: 투자 대상 → 오행 자산군 (req 2장)
│   ├── weighted.js       # 금액 가중 평균 → 포트폴리오 오행 분포 (req 6장)
│   ├── ebi.js            # EBI 균형도 0~100 (req 7장, 정의 문서화)
│   ├── regimeShift.js    # 국면 프리셋→목표 배분 시프트 (req 3·4장, clamp·합 100 보정)
│   ├── rebalance.js      # 리밸런싱 제안 (±5%p 트리거, req 7장)
│   ├── circulate.js      # 상생 매핑 상수 木→火→土→金→水 (req 5장)
│   └── index.js          # barrel — UI는 이 모듈만 import, 계산 재구현 금지
├── tests/                # node --test (Node 22 내장 러너) — 웹 v1 수동 모드 + ⑤ 실측 모드
├── engine/               # v2a Python 엔진 — 「FEAAS v2a — Python 엔진」섹션 (배포 아티팩트 제외)
│   ├── feaas/            # sources·indicators·scores·classifier·backtest·report (순수 함수)
│   ├── run_pipeline.py   # v2a 배치 진입점 — 지수·국면·state.json·백테스트 산출 (③)
│   ├── tests/            # v2a unittest — 표준 라이브러리(venv 기준, pytest 예외)
│   ├── data/fixtures/    # FRED fredgraph.csv 샘플 4종 + Stooq 샘플 1종 (② 확정)
│   ├── data/state.json   # 실측 모드 산출 — run_pipeline 배치가 생성(⑥ 실측 국면 D; CEO 크론이 data/로 복사)
│   ├── out/              # 백테스트 리포트 backtest.json+.md — 프록시/정렬 월 부족 시 미산출(스킵)
│   └── requirements.txt  # numpy 최소 · pandas/scipy 선택 주석
├── docs/
│   ├── requirements.md        # v1(web MVP) 유일 근거문서 v2.0
│   ├── requirements-v2.md     # v2a 엔진 유일 근거문서
│   ├── indicator-map.md       # v2a 지표 정의서 — 오행×ID 매핑·기각 근거·표준화 정책 (②)
│   ├── qa-v2a-report.md       # v2a ④ QA 독립 재현 리포트 — ISSUE-1·2(→⑥ 해소)
│   └── v2-ideas.md            # v2 기록 전용 (MVP 금지 항목)
├── .wranglerignore       # 배포 제외 의도 문서(engine/) — wrangler 4.156 미적용 실측 → 실제 제외는 배포 절차의 mv 방식(README「배포」절)
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