# FEAAS v2 — 자동화 파이프라인 · 요구사항 (v2a 스코프)

> 발주: CEO (2026-11-02, MVP 납품 직후). 근거: docs/v2-ideas.md + requirements.md 9장.
> **v2a(본 발주)**: 실측 경제 데이터 → 오행 경제지수 → 국면 자동 판정 → 15년 백테스트 검증 → 정적 웹앱 "실측 모드" 반영.
> **v2b(다음 발주, 금지)**: ML 예측(XGBoost/LightGBM·TFT 비교), CVXPY/PyPortfolioOpt 최적화, API 서버 자동 실행, PostgreSQL.

## 0. 호스트 실측 환경 (2026-11-02 확인)
- Python 3.11.2 + pip 23.0.1. **numpy/pandas/scipy 미설치** → 첫 티켓에서 venv 부스트랩을 먼저 검증하고, 코어는 **stdlib 우선 + numpy 허용(pandas/scipy 선택)**으로 설계. 설치 실패 시 stdlib 폴백이 수용기준을 유지해야 한다.
- 네트워크: `fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>` **200·키 불필요**(DGS10 실측 확인), `stooq.com/q/d/l/?s=<sym>&i=d` 200. 외부 API 키는 사용하지 않는다(없는 것으로 설계).

## 1. 패키지 구조 (권고)
```
projects/ohaeng-assets/engine/
├── pyproject.toml 또는 requirements.txt (numpy 최소, pandas/scipy 선택)
├── feaas/
│   ├── sources.py      # FRED CSV·Stooq CSV fetcher(+로컬 캐시, retry)
│   ├── indicators.py   # 지표 정의서(오행×데이터ID 매핑)
│   ├── scores.py       # 표준화(10년 rolling percentile → 0~100)
│   ├── classifier.py   # 국면 A~E 판정(복수 지표 조합 규칙)
│   ├── backtest.py     # 국면→배분 시프트 시뮬레이션·성과지표
│   └── report.py       # state.json 구성(웹앱 실측 모드 스키마)
└── tests/              # node --test가 아닌 unittest/pytest — stdlib unittest 우선
```
- 코어 모듈은 순수 함수 유지(네트워크·FS는 sources.py로 격리) — 유닛 테스트는 fixture CSV로 수행(실측 fetch는 별도 스모크).

## 2. 오행 경제지指数 정의 (FRED 기반 초기 매핑 — PM이 확정)
| 오행 지수 | 의미 | 후보 데이터(FRED ID) | 방향 |
|---|---|---|---|
| 목 지수 | 성장 가능성 | GDPC1(QoQ), PAYEMS(YoY), UNRATE(역방향), SP500(stooq 성장) | 높을수록 성장 |
| 화 지수 | 인플레이션 압력 | CPIAUCSL(YoY), PPIACO(YoY), T10YIE, DCOILWTICO(1y 변동) | 높을수록 인플레 |
| 토 지수 | 실물자산 안정성 | CSUSHPINSA(YoY), HOUST(수준), 주택 임대 프록시 | 높을수록 실물 양호 |
| 금 지수 | 금융 안정성 | BAMLH0A0HYM2(역방향), VIXCLS(역방향), DGS10(수준 판단) | 높을수록 안정 |
| 수 지수 | 시장 유동성 | M2SL(YoY), DTWEXBGS, SOFR(역방향) | 높을수록 유동성 풍부 |

- 표준화: 각 지표 최근 10년 **rolling percentile(0~100)** — 절대 레벨 대신 "역사적 상대 위치"를 쓴다. 역방향 지표는 100−p. 오행 지수 = 소속 지표 percentile 평균(round).
- 국면 판정 규칙(초안 — 문서화+테스트 필수): A=목≥60 且 수≥50; B=화≥60 且(금<50 或 화−금≥10); C=토≥55 且 화<60 且 금≥50; D=금<50 且(수<40 或 수↑); E=수≥45 且 목이 6개월 전 대비 상승. 조건 충돌 시 우선순위 D > B > E > A > C. 판정은 반드시 ≥2 지표 조합(단일 지표 판정 금지).
- 판정 불가(데이터 부족) 시 국면=null·이유 표기 — 강제 매칭 금지.

## 3. 백테스트 (검증 게이트)
- 기간: 최근 15년(데이터 존재 범위), 월말 리밸런싱, 거래비용 0.1%/회 차감.
- 오행 자산 프록시(Stooq/FRED): 목=SP500(S&P), 화=GSPC? 대신 원자재 지수 없으면 GLD/USO 프록시 제한적, 토=US REIT 지수(없으면 SP500 하위 분해 금지 — 프록시 한계 문서화), 금=US 10y ETF 프록시(IEF 스타일 — stooq ^tnx 기반 근사 또는 캐시), 수=3M T-bill(FRED IRX).
- 비교 기준선: 60/40(주60·10y채40), 무보정 오행(기준 배분 고정).
- 산출 지표: 연율화 수익·변동성·MDD·샤프·거래비용 총액·위기 구간(2008, 2020-03) 방어도 — **리포트(JSON+MD)**. 이 백테스트는 "규칙 기반 v2a의 한계"를 정량화하는 게 목적이며, 수익 우위 필수 아님(결과 그대로 보고).
- 회계 정확성 테스트: 수익률 복리 계산·비용 차감·MDD 정의 전부 유닛 테스트(고정 fixture로 검증).

## 4. 웹앱 "실측 모드"
- engine이 `data/state.json`을 생성: {생성시각, 지수 5종, 국면, 판정 근거, 목표 배분, 제안 리밸런싱, 프록시 한계 고지}.
- 웹 app.js가 state.json 존재 시 "실측 모드(배치 시각)" 배너 + 값 채움; 부재 시 기존 수동 모드 유지(회귀 없음).
- **배치 갱신은 CEO 세션이 크론으로 운영** — 워커 티켓에 크론 작업 포함 금지(산출물과 배포만).

## 5. 수용 기준 (v2a)
1. `fetch+표준화` 유닛 테스트(fixture CSV): percentile·역방향·오행 평균·0~100 클램프·결측 처리(마지막값 carry-forward + 부족 10년 → 감쇄 페널티 또는 누락 표기).
2. 국면 판정 테스트: 규칙 5종 경계·우선순위 충돌·데이터 부족 → null.
3. 백테스트 테스트: fixture 3년 데이터로 수익·비용·MDD 회계 수치 일치.
4. 실데이터 스모크: FRED 6+ID 실제 fetch 성공(네트워크 실패 시 명확 보고 — 재시도 2회 후 실패 아카이브 가능).
5. state.json 스키마 검증 + 웹앱 실측 모드 DOM 실측(state.json 있을 때 배너/값, 없을 때 수동 모드).
6. README: 실행·크론·프록시 한계·지표 정의서 전부 문서화.
7. v2b 기능 절대 미포함.