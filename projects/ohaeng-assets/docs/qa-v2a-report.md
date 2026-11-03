# FEAAS v2a ④ — QA 독립 재현 검증 리포트

> 티켓: t_a20109a6 (qa). 기준: `docs/requirements-v2.md` 전문(§0~5)·`docs/indicator-map.md`.
> 방법: 개발자 보고를 믿지 않고 **직접 재실행·독립 재계산**으로 대조. 코드 수정 사항은
> 자체 수정하지 않고 이슈로 남겨 개발자(①②③ 티켓)에게 요청한다.
> 검증 실행: venv `engine/.venv`(Python 3.11.2), 2026-11-03 (UTC).
> QA 재계산 스크립트: 스크래치 `recalc.py`·`verify_state.py`·`check_window.py`·`probe_sui.py`
> (스크래치 경로 실행 — 레포 비침염, repo diff 없음).

## 결론 요약

| 수용기준 | 결과 | 비고 |
|---|---|---|
| §5-1 표준화(fixture) | **충족** — 독립 재계산 65건 전부 일치 | §1·§2 표 |
| §5-2 국면 판정(fixture) | **충족** — 경계·우선순위·null 사유 독립 대조 일치 | §2 표 |
| §5-3 백테스트 회계(fixture) | **충족** — 독립 NAV 시뮬레이터와 수치 전부 일치 | §3 표 |
| §5-4 실데이터 스모크 | **조건부 충족** — FRED 17/17 성공, **Stooq 0/5 실패(네트워크 사유 명확 보고)** | ISSUE-2 |
| §5-5 state.json 스키마 | **충족** — 검증기 2종(독립·feaas) 전부 오류 0건 | §4 표 |
| §5-6 README 문서화 | **충족** — 필수 항목 5종 전부 존재 | §6 표 |
| 웹 수동 모드 회귀 | **충족(대체 근거)** — v1 테스트 122/122 OK·state.json 참조 코드 0건·서빙 200; 브라우저 DOM 실측은 환경 제한으로 불가 | §5 절 |

**이슈 2건(개발자 수정 요청) + 관측 참고 1건.** 이슈 상태는 §7.

## 1. unittest 전체 재실행

```bash
cd projects/ohaeng-assets/engine && .venv/bin/python -m unittest discover
# → Ran 230 tests in 0.148s — OK — exit 0
```

| 테스트 파일 | 테스트 수 |
|---|---|
| test_skeleton.py | 9 |
| test_sources.py | 40 |
| test_indicators.py | 10 |
| test_scores.py | 35 |
| test_classifier.py | 55 |
| test_backtest.py | 57 |
| test_report.py | 14 |
| test_pipeline.py | 10 |
| **합계** | **230 — OK** |

- 개발자 보고(t_55b34df2): "230 unittest OK" — **재실행과 일치**(불일치 이슈 없음).
- 레포 트리: 검증 전후 `git status` clean(커밋 ab6cf0d 기준).

## 2. fixture 경계 독립 재계산 대조실

feaas 정책을 재사용하지 않고 근거문서 사양으로부터 **독립 구현**해 대조했다.
(스크래치 `recalc.py` — 기대값은 독립 계산, feaas 결과와 수치 대조. 총 65검사 전부 PASS.)

### 2-A 표준화(scores — req §5-1·indicator-map §4)

| 항목 | 재계산 결과 | 판정 |
|---|---|---|
| carry-forward([3,None,5,None,None]→[3,3,5,5,5], 선두 None 유지) | 일치 | PASS |
| percentile p=100×#{w≤v}/n([1,3,2] w=2 → [None,100,50]; [2,2,1,1,2.5,0.5] w=3 → [None,None,33.33,66.67,100,33.33]) | 일치 | PASS |
| 10년 부족 → 누락 표기 None(관측 4 < window 5 → 전 행 None) | 일치 | PASS |
| 역방향 100−p(invert(37)=63) | 일치 | PASS |
| clamp 0~100(120→100, −5→0) | 일치 | PASS |
| 오행 평균 round — banker([60,65]→62: round(62.5)=62)·부분 부족([80,None,50]→65)·전부 부족→None | 일치 | PASS |
| standardize_indicator 전 경로(연간 13점 yoy+inverse, window 12) — 독립 파이프라인과 13점 전부 일치 | 일치 | PASS |

### 2-B 국면 판정(classifier — req §5-2)

독립 규칙 평가기(3치: TRUE/FALSE/UNKNOWN·우선순위 D>B>E>A>C) 재구현 대조.
각 케이스에서 `detect_regime`와 독립 평가기가 **완전히 동일**했고 기대값과도 일치:

| 케이스(경계·우선순위) | 구성 | 판정 |
|---|---|---|
| A 경계 | 목=60·수=50 정확히 충족(목 하락 이력으로 E 격리) → A | PASS |
| A 미달 | 목=59.9 → null | PASS |
| B 경계 | 화=60·금=50·차=10 → B(또는 화−금≥10 분기) | PASS |
| B 미달 | 화−금=9.999 → null | PASS |
| C 경계 | 토=55·화=59.9·금=50 → C | PASS |
| C 화<60 위반 | 화=60·토=60·금=50 → B(우선순위) | PASS |
| D 경계 | 금=49.9·수=39.9 → D | PASS |
| D 수<40 위반·금=50 | → null(정확한 경계) | PASS |
| D 수↑ 브랜치 | 금=49·수=41(+상승 이력) → D | PASS |
| E 경계 | 수=45·목 상승(−1→30·6개월 창) → E | PASS |
| E 미달 | 수=45·목 하락(31→30) → null | PASS |
| 충돌 D>B (화65·금49·수39) | → **D 채택**(B 제쳐짐) | PASS |
| 충돌 B>E (화65·금49·수50·목 상승) | → **B 채택**(E 제쳐짐) | PASS |
| 충돌 E>A (수55·목 상승·A도 참) | → **E 채택** | PASS |
| 충돌 A>C (목62·수52·토60·화50·금50) | → **A 채택**(C 제쳐짐) | PASS |
| 부족(<2 지표) | null + 사유 "부족 화·토·금·수" 명기 | PASS |
| UNKNOWN 차단(금 부족·나머지 4 존재) | null + "판정 불가"(강제 매칭 금지) | PASS |
| 모든 규칙 불충족 | null + "모든 국면 규칙 불충족" | PASS |
| min_indicators=1 | ValueError 거부(단일 지표 판정 금지 계약) | PASS |

### 2-C 백테스트 회계(backtest — req §5-3)

독립 NAV 시뮬레이터(README 회계 계약 재구현)로 3개월 시나리오 대조 — **전 필드 정확 일치**:

| 필드 | 독립 재계산 | feaas run_backtest | 판정 |
|---|---|---|---|
| NAV[0] | 1.0310679 (수기: 0.999×(0.3×1.1+0.1×1.02+0.2×1.01+0.25×0.99+0.15×1.004)) | 1.0310679 | PASS(1e-12) |
| NAV 시퀀스 / monthly_returns | 전 월 일치 | 일치 | PASS(1e-10) |
| total_return | −0.0013936681 | 동일 | PASS |
| cagr | −0.0055630295 | 동일 | PASS |
| mdd | 0.0376934919 | 동일 | PASS |
| sharpe | −0.0564531823 | 동일 | PASS |
| trading_costs | 0.0012948328(초기 1.0회전 + 리밸런스 회전×0.1%) | 동일 | PASS |
| compound([0.1,−0.1,0.1]) | 0.089 = ∏(1+r)−1 | 동일 | PASS |
| annualized_return(0.5, 36개월) | 1.5^(12/36)−1 | 동일 | PASS |
| 위기 방어도(구간 100→95→90, [90/95−1]) | −0.052631579 | 동일 | PASS |

- 회계 규약 확인: t월 시작 체결(초기 회전 1.0)·비용=0.1%×회전율×NAV·결산 NAV=t월 성장 후·
  MDD=비용 포함 NAV 고점 대비 최대 낙폭(양수) — 모두 구현 일치.

## 3. 실데이터 fetch 스모크 (req §5-4 — 수용기준 4 게이트)

`feaas/sources.py` 경유만 사용(`fetch_fred`·`fetch_stooq`). 캐시는 스크래치 디렉터리
(레포 `engine/data/cache` 무변경). URL 형식:
`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>` ·
`https://stooq.com/q/d/l/?s=<sym>&i=d` (각 총 3시도·백오프·timeout 30s — 모듈 기본값).

### 3-A FRED — **17/17 성공** (요구 6+ 이상 충족)

| ID | 행수 | 범위 | 마지막 값 | 결측 | 소요 |
|---|---|---|---|---|---|
| GDPC1 | 319 | 1947-01~2026-07 | 24611.077 | 0 | 0.4s |
| PAYEMS | 1053 | 1939-01~2026-09 | 159044.0 | 0 | 5.5s |
| UNRATE | 945 | 1948-01~2026-09 | 4.2 | 1 | 0.2s |
| CPIAUCSL | 957 | 1947-01~2026-09 | 336.298 | 1 | 0.2s |
| PPIACO | 1365 | 1913-01~2026-09 | 295.708 | 0 | 0.3s |
| T10YIE | 6218 | 2003-01~2026-11 | 2.29 | 255 | 0.3s |
| DCOILWTICO | 10649 | 1986-01~2026-10 | 103.37 | 1117 | 0.6s |
| CSUSHPINSA | 476 | 1987-01~2026-08 | 336.741 | 0 | 0.2s |
| HOUST | 813 | 1959-01~2026-09 | 1221.0 | 0 | 0.7s |
| CUSR0000SEHA | 549 | 1981-01~2026-09 | 450.429 | 1 | 0.6s |
| DBAA | 10652 | 1986-01~2026-10 | 6.47 | 408 | 0.9s |
| VIXCLS | 9609 | 1990-01~2026-10 | 19.42 | 302 | 0.3s |
| DGS10 | 16914 | 1962-01~2026-10 | 4.94 | 721 | 0.4s |
| M2SL | 813 | 1959-01~2026-09 | 23413.9 | 0 | 0.2s |
| DTWEXBGS | 5435 | 2006-01~2026-10 | 121.6656 | 213 | 0.3s |
| DFF | 26420 | 1954-07~2026-10 | 3.88 | 0 | 0.4s |
| DTB3 | 19000 | 1954-01~2026-10 | 3.99 | 801 | 1.0s |

- 결측(일간 주말·휴일 빈 셀)은 carry-forward 정책이 흡수 — 파서가 정상 파싱.
- ② 정의서의 10년 창 관측수 요건: 일간 계열 2530 — T10YIE·DBAA·VIXCLS·DGS10·DCOILWTICO·
  DFF·DTB3·DTWEXBGS·DTB3(19000행) 전부 초과 충족. 분기 GDPC1 — 320행 이상(40 충족).

### 3-B Stooq — **0/5 실패(명확 보고 + 실패 아카이브)**

| 심볼 | fetch_stooq 결과 | 사유 |
|---|---|---|
| ^spx · cl.f · gld.us · vnq.us · iet.us | **전부 3시도 실패 → FetchError** | `HTTPError 404: 'Not Found'` |

원인 분리(프로브 실측):
- Python(urllib 기본 UA `Python-urllib/3.11`) → **HTTP 404** — stooq가 프로그래밍 접근을
  상시 차단하는 사양으로 보임.
- 브라우저 UA(Firefox) curl → HTTP **200**이나 본문은 **JS proof-of-work 챌린지 HTML**
  (`<noscript>This site requires JavaScript to verify your browser…`) — ② 관측 재현.
  **CSV가 아니므로 fetch 계약(파서)은 여전 불가** — 커먼 UA 헤더만 추가해 해결되지 않는다.
→ req §5-4: "네트워크 실패 시 명확 보고(재시도 2회 후 실패 아카이브 가능)" — 실패 보고 본
  절 + 아카이브 5건(`failures/stooq-*.txt`: URL·3시도 에러·응답 원문)로 충족시킨다.
→ **수용기준 4는 FRED 절(17/17)로 충족되지만, stooq 프록시 의존 기능(백테스트 4자산·
  지표 ^spx)은 현재 환경에서 실측 불가** — 후속 결정은 §7 ISSUE-2.

### 3-C 실측 모드 파이프라인 전체 실측(레포 무변경)

```
run_pipeline.py --cache-dir <스크래치>/cache \
  --state-path <스크래치>/out/state.json --out-dir <스크래치>/out
→ [state.json] 산출 · 기준 월 2026-11 · 지수 목=39 화=72 토=16 금=32 수=54 ·
  국면 B(인플레이션 상승기) · [WARN] 백테스트 레그 스킵 · exit 0
```

- 설계 그대로: 실패 지표(^spx 1종)는 지표 누락 + [note] 사유, 백테스트 레그는
  프록시 부족으로 스킵(WARN·exit 0) — README 「백테스트 레그 스킵」 계약 준수.
- 스크래치 산출 state.json: 스키마 유효(§4-A), 근거 행이 수집 실패 사유까지 전부 기록.

## 4. state.json 스키마 검증 (req §5-5·§4)

### 4-A 필드·타입 독립 검증

검증기 2종(완전 독립 구현 + `feaas.report.validate_state`)을 state.json 2종에 적용:

| 대상 | 독립 검증기 | feaas validate_state |
|---|---|---|
| 커밋된 fixture 실적 `engine/data/state.json`(생성 2026-11-03T01:29:50Z) | 오류 0 | 오류 0 |
| 실측 스모크 산출(스코프 3-C) | 오류 0 | 오류 0 |

- 필드 7종 전부 존재: generated_at(tz-aware ISO·"Z/UTC")·element_scores(오행 5키)·regime·
  regime_reasons(비공백 문자열 list)·target_allocation(합 100%p)·rebalance_proposals
  ({element,basis_pct,target_pct,delta_pct})·proxy_note(비공백).
- 지수 0~100: fixture 실적 = 전부 null(10년 창 미달 — AC2 정상 경로 확인)·
  실측 산출 = 39·72·16·32·54 전부 0~100 내.
- 국면 A~E 或 null: fixture 실적=null(+부족 사유 21행 = AC2 경로)·실측 산출=B.
- target_allocation=B 프리셋 **(목22·화12·토16·금32·수18)** — README 표·v1 REGIME_PRESETS와
  일치(재설계 없음 확인). 제안 행 5건 = 기준 배분 대비 delta 일치.
- 판정 근거 행: 지수 입력·규칙별 평가(D 불충족/… 충족)·판정 결과·파이프라인 노트 순서로
  근거가 기록됨 — "수↑(54 vs 6개월 전 64(−10))" 등 수치까지 내부 일관성 확인
  (6개월 전 값은 원본 캐시 CSV에서 uniform-120 재계산으로 64 재현 — §2 근거).

## 5. 웹 수동 모드 회귀 (req §5-5 후반)

- 서빙: `python3 -m http.server 8000`(프로젝트 루트) — `/`=200, `/ui/app.js`=200.
- **브라우저 DOM 실측은 불가** — 이 환경(agent 환경)에 브라우저 CLI가 없고 설치도 파일시스템
  hardlink 제한으로 실패. 대신 아래 3가지로 수동 모드 회귀를 검증:
1. `ui/app.js`·`ui/state.js`·`index.html`에 `state.json`·"실측" 참조 **0건** — 실측 모드
   통합 코드가 아직 웹에 없으므로, "state.json 유무와 무관히 기존 수동 모드가 그대로
   채택된다"는 계약이 구조적으로 보장된다(회귀 여지가 될 만한 코드 경로 자체가 없다).
2. v1 테스트 스위트: `node --test "tests/**/*.test.js"` — **122 pass / 0 fail**
   (README 명시 122/122와 일치).
3. 정적 서빙 200 — `index.html`·`ui/app.js`·`src/ 계열` 전부.
- 실측 모드 배너·값 채움 DOM 실측은 웹 통합 티켓(후속)에서 브라우저 가능 환경으로
  수행 필요 — 이 리포트에서는 검증 불가 사유를 명시적으로 기록한다.

## 6. README 문서화 점검 (req §5-6)

| 필수 항목 | 확인 내용 | 판정 |
|---|---|---|
| venv 절차 | 「venv 부스트랩(1회)」 — venv 생성 + `pip install -r engine/requirements.txt` 명시 | ✓ |
| unittest 정책 | 「테스트 정책」 — unittest 기준·AGENTS.md pytest 예외 명시 + `unittest discover` 명령 | ✓ |
| 프록시 한계 | 「자산 프록시」 표 5종(근거·한계 병기) + Stooq PoW 챌린지 caveat + 수 금리→월수익 근사 | ✓ |
| 지표 정의서 링크 | `docs/indicator-map.md` 링크 2건(엔진 섹션·fixture 포맷 섹션) | ✓ |
| state.json 생성 절차 | 「배치 실행 절차(run_pipeline)」 — 실측(a)·fixture(b) 명령·옵션·종료 코드 0/2 병기 | ✓ |
| 크론 CEO 문서화 | "크론 등록은 금지(CEO 세션 영역, req-v2 §4)" — 엔진은 절차만 문서화 | ✓ |

## 7. 이슈 목록

### ISSUE-1 — [수정 요청·개발자 ③ 티켓] run_pipeline이 주기별 10년 창을 쓰지 않음(전부 120)

- **위치**: `engine/run_pipeline.py` 197행 — `standardize_indicator(series, transform=…, inverse=…)`
  에 **window 미전달** → 모든 지표가 `DEFAULT_WINDOW_MONTHS=120`으로 표준화.
- **계약 어김**: `docs/indicator-map.md` §4-7 확정 — "window는 주기별 관측 수: 월 120·주 520·
  **일 2530·분기 40**·연 10(`scores.WINDOW_COUNTS`·`scores.window_count_for` — **파이프라인이
  주기별로 선택**)". `window_count_for`는 구현·테스트(test_scores.py 235~245)만 있고
  **파이프라인이 아예 호출하지 않는다**. README v2a ③의 "window_count_for 순수 재사용" 표현도
  실제로는 미적용.
- **실측 영향(2026-11 기준, 원본 캐시 CSV에서 독립 재계산 — 3방향 폐쇄)**:
  - state(파이프라인=120 통일) = {목39 화72 토16 금32 수54} — uniform-120 재계산과 정확 일치(재생산성 확인).
  - 정책 창(주기별) 독립 재계산 = **{목41 화78 토16 금45 수63}** — 4종 불일치.
  - **국면 전도 실측**: 정책 창 기준 수는 6개월(5월 56→11월 63) 상승 → D 규칙(금<50 且 수↑) 충족 →
    **국면 B가 아니라 D(금융 불안기)가 될 것**. 현재 배포된 지수는 10년 창이 아닌
    "일간 = 최근 약 6개월" 창 —    "역사적 상대 위치" 정의(req §2)가 이 계산에서 위반된다.
- **왜 유닛테스트가 놓쳤나**: test_pipeline 합성 fixture가 전부 월간이라 120이 우연히 정답 창.
- **요청 최소 수정**: `collect_standardized`에서 `window=scores.window_count_for([d for d, _ in series])`
  전달(또는 indicators.IndicatorDef에 창 규격 추가). 수정 후 실측 스모크 재실행 요망.
- 상태: **미해결 — 개발자 수정 대기**. QA는 코드를 수정하지 않음(역할 분리).

### ISSUE-2 — [해결 방향 결정 필요] Stooq 실측 fetch 전면 실패(Python UA 404·브라우저 UA= JS PoW)

- 재현: `fetch_stooq(심볼)` → 3시도 전부 HTTP 404(네트워크·TLS 정상 — FRED는 17/17로 증명).
- curl(브라우저 UA) → 200 + JS proof-of-work 챌린지 HTML — CSV 회수 불가(JavaScript 해결자 필요).
- 영향: 백테스트 레그 전체(4 stooq 프록시) + 지표 ^spx(목 4지표 중 1) — 현재 환경에서 실측 불가.
  파이프라인은 스킵+사유(WARN·exit 0)로 회계 계약대로 동작(회귀 아님).
- 후보 결정지(개발자/CEO): (a) User-Agent 헤더 주입(단, CSV 확보는 안 됨 — PoW 해결자 필요), 
  (b) 대체 CSV 소스(예: Yahoo Finance) 또는 PoW 통과 컨텍스트 도입, (c) 현행대로 fixture·캐시
  기반 산출 유지 + req §5-4 '명확 보고' 정책 유지. **QA는 결정권이 없으며, 대안 검토는 v2a
  경계(v2b 금지: API 서버 등) 안에서 결정할 것.**
- 상태: **미해결 — 결정 대기**. 실패 아카이브: 5건(`failures/stooq-*.txt`).

### 참고 — 측정 관측(수정 불필요)

- 커밋된 fixture `state.json`은 소형 샘플로 10년 창 미달 → 지수 전부 null — AC2 정상 경로
  (개발자 보고와 일치, 불일치 없음).
- 실측 스모크 state.json의 2026-05 수=64 근거값과 독립 재계산(uniform-120, 월말 컷오프 5-31)이 일치 —
  파이프라인 내부 수치는 자기 일관적. (검증 스크립트 28일 컷오프 근사는 ±1 차이 — 계측 인공물,
  결함 아님.)

## 8. 산출물·증거 파일

| 파일 | 내용 |
|---|---|
| `docs/qa-v2a-report.md` | 본 리포트(도커 커밋) |
| 스크래치 `out/state.json` | 실측 fetch 모드 파이프라인 산출(기준 월 2026-11·국면 B) |
| 스크래치 `smoke.json` | 스모크 전체 기록(17 FRED + 5 stooq, 행수·범위·마지막 값) |
| 스크래치 `failures/stooq-*.txt` | Stooq 실패 아카이브 5건(URL·3시도 에러·응답 원문) |
| 스크래치 `recalc.py`·`verify_state.py`·`check_window.py`·`probe_sui.py` | 독립 재계산 도구(65검사·3방향 폐쇄) |

*실패 아카이브·스모크 JSON은 실측 증거로 보존 가치가 있어 티켓 첨부로 남긴다(kanban 첨부).
스모크 캐시 CSV 17종은 FRED 원본 응답 — 용량이 커서 첨부 제외(캐시 재실행으로 재현 가능).*