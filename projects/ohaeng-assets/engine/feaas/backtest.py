"""백테스트 계층 — 국면 → 배분 시프트 시뮬레이션 · 성과지표 (req-v2 §3, ③).

순수 함수만 유지한다(FS·네트워크 없음 — 회계 정확성은 고정 fixture로 유닛 테스트,
req-v2 §5.3: 복리 계산·비용 차감·MDD 정의). 실 fetch는 sources.py만,

자산 프록시(PM 확정 — 카드 t_55b34df2; 근거·한계는 README v2a ③ 섹션+리포트 고지):
- 목 = stooq ^spx(S&P 500), 화 = stooq cl.f(WTI 원유 — 실측 실패 시 gld.us 폴백),
  토 = stooq vnq.us(미국 REIT ETF), 금 = stooq iet.us(중기 국채 ETF),
  수 = FRED DTB3(3개월 단기금리 — fredgraph IRX는 404 미실측 → reviewer 검증 DTB3 채택).
- v2a 백테스트는 '규칙 기반 v2a의 한계'를 정량화하는 게 목적이며 수익 우위 필수 아님 —
  결과는 그대로 보고한다.

회계 계약(tests/test_backtest.py 고정 + README 병기):
- 배분 행: 오행 5키 완전·%p 단위·합 100(±1e-6)·음수 불가. 수익 행: 오행 5키 완전·월 수익률 소수.
- 기준 배분 BASIS_ALLOCATION(木30 火10 土20 金25 水15)과 국면 목표 배분 REGIME_ALLOCATIONS
  A~E는 v1 REGIME_PRESETS(src/regimeShift.js) 매핑 재사용 — 재설계 금지.
- 거래: 월 경계 리밸런싱 — t월 배분의 전환 거래는 t월 시작(=(t−1)월 말 NAV 확정 직후)에
  체결한다. 초기 취득(t=0, 회전 1.0) 포함 총 T회 거래. 비용 = cost_per_trade(기본 0.1%) ×
  회전율(Σ|Δw| — 거래액 비율) × 체결 시점 NAV; 표준 수익 월(drift가 목표와 일치)은 비용 0.
- 결산 NAV는 t월 성장 후 시점이며 비용은 t월 시작에 반영 — t월 월수익에 비용 포함.
- trading_costs = Σ (cost_per_trade × 회전율) — 누적 비율 합(통화 기준 아님, 복리 미적용).
- MDD는 비용 포함 NAV 곡선 고점 대비 최대 낙폭(0 ≤ mdd < 1, 양수 보고).
- annualized_vol = 모표준편차(÷N) × √12; sharpe = (CAGR − rf_annual) / 연율화 변동성
  (run_backtest는 rf=0 고정 — 변동성 0 시점 0.0 표기, 순수 함수 sharpe_ratio는 ValueError).
- 위기 방어도: 구간 내 NAV 첫 관측 → 마지막 관측 누적 수익률(전략 간 비교용 — 구간 관측
  2점 미만이면 누락).
- 기간: 최근 15년(RECENT_MONTHS=180) — '데이터 존재 범위' 절삭은 recent_window.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date

from feaas.indicators import ELEMENTS
from feaas.sources import Series

COST_PER_TRADE_DEFAULT: float = 0.001  # 거래비용 0.1%/회 — 거래액 비율(req-v2 §3)
ALLOCATION_SUM: float = 100.0  # 배분 행 합계(%p)
ALLOCATION_TOLERANCE: float = 1e-6
MONTHS_IN_YEAR: int = 12
RECENT_MONTHS: int = 180  # 최근 15년 × 12개월(req-v2 §3)

# v1 기준 배분(README 표 — 木30 火10 土20 金25 水15; element 순서 목화토금수) 재사용.
BASIS_ALLOCATION: dict[str, float] = {"목": 30.0, "화": 10.0, "토": 20.0, "금": 25.0, "수": 15.0}

# v1 국면 프리셋(src/regimeShift.js REGIME_PRESETS) 매핑 재사용 — 재설계 금지.
REGIME_ALLOCATIONS: dict[str, dict[str, float]] = {
    "A": {"목": 38.0, "화": 6.0, "토": 16.0, "금": 25.0, "수": 15.0},  # 성장 확장기
    "B": {"목": 22.0, "화": 12.0, "토": 16.0, "금": 32.0, "수": 18.0},  # 인플레이션 상승기
    "C": {"목": 24.0, "화": 6.0, "토": 28.0, "금": 26.0, "수": 16.0},  # 실물경제 안정기
    "D": {"목": 20.0, "화": 5.0, "토": 18.0, "금": 32.0, "수": 25.0},  # 금융 불안기
    "E": {"목": 36.0, "화": 8.0, "토": 16.0, "금": 28.0, "수": 12.0},  # 유동성 회복기
}

# 위기 구간(req-v2 §3 — 2008 금융위기·2020-03 코로나 충격).
DEFAULT_CRISIS_WINDOWS: dict[str, tuple[str, str]] = {
    "2008": ("2007-10-01", "2009-03-31"),
    "2020-03": ("2020-02-19", "2020-03-31"),
}


@dataclass
class BacktestResult:
    """단일 전략 백테스트 성과 — JSON+MD 리포트 직결 필드(req-v2 §3)."""

    months: int
    total_return: float
    cagr: float            # 연율화 수익(CAGR)
    vol: float             # 연율화 변동성
    mdd: float             # 최대낙폭(0 ≤ mdd < 1, 양수 보고)
    sharpe: float
    trading_costs: float   # 거래비용 총액(누적 비율 합)
    crisis_defense: dict[str, float] = field(default_factory=dict)  # 위기 구간별 방어도
    navs: list[tuple[str, float]] = field(default_factory=list)     # (date, NAV) 월 결산
    monthly_returns: list[float] = field(default_factory=list)      # 비용 포함 월수익


def _finite(value: object, label: str) -> float:
    """수치·유한 검증 — bool·비수치·NaN/inf는 ValueError(isfinite 계약)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}: 수치여야 함: {value!r}")
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"{label}: 유한한 수치여야 함: {value!r}")
    return v


def _iso_date(value: object, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label}: 날짜는 'YYYY-MM-DD' 문자열: {value!r}")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label}: 날짜 형식은 YYYY-MM-DD: {value!r}") from None


def compound(returns: Sequence[float]) -> float:
    """월 수익률 시퀀스 → 누적 복리 수익률. 빈 시퀀스는 0.0(기간 없음)."""
    product = 1.0
    for i, raw in enumerate(returns):
        r = _finite(raw, f"returns[{i}]")
        product *= 1.0 + r
    return product - 1.0


def annualized_return(total_return: float, months: int) -> float:
    """누적 수익률 → 연율화(CAGR). months ≤ 0·total_return ≤ −1은 ValueError."""
    if isinstance(months, bool) or not isinstance(months, int):
        raise ValueError(f"months는 정수: {months!r}")
    if months <= 0:
        raise ValueError(f"months는 1 이상: {months!r}")
    growth = 1.0 + _finite(total_return, "total_return")
    if growth <= 0.0:
        raise ValueError(f"total_return은 −1 초과여야 함(기하평균 불가): {total_return!r}")
    return growth ** (MONTHS_IN_YEAR / months) - 1.0


def annualized_vol(returns: Sequence[float]) -> float:
    """월 수익률 시퀀스 → 연율화 변동성(모표준편차 ÷N × √12). 빈 시퀀스는 ValueError."""
    vals = [_finite(raw, "returns") for raw in returns]
    n = len(vals)
    if n == 0:
        raise ValueError("수익률 시퀀스가 비었다 — 변동성 정의 불가")
    mean = sum(vals) / n
    var = sum((v - mean) ** 2 for v in vals) / n
    return math.sqrt(var) * math.sqrt(MONTHS_IN_YEAR)


def sharpe_ratio(returns: Sequence[float], *, rf_annual: float = 0.0) -> float:
    """샤프 = (연율화 수익 − rf) / 연율화 변동성. rf 기본 0(② 확정).

    변동성 0은 샤프가 정의되지 않는다 — ValueError(조용한 0 대신 거부).
    """
    vals = [_finite(raw, "returns") for raw in returns]
    if not vals:
        raise ValueError("수익률 시퀀스가 비었다 — 샤프 정의 불가")
    cagr = annualized_return(compound(vals), len(vals))
    vol = annualized_vol(vals)
    if vol <= 0.0:
        raise ValueError(f"변동성 0 — 샤프 비율 정의 불가(returns N={len(vals)})")
    rf = _finite(rf_annual, "rf_annual")
    return (cagr - rf) / vol


def max_drawdown(nav: Sequence[float]) -> float:
    """NAV 시퀀스 → 최대낙폭(0 ≤ mdd < 1, 양수). 고점 대비 최대 하락비율(비용 포함 NAV 기준)."""
    vals = [_finite(raw, "nav") for raw in nav]
    if not vals:
        raise ValueError("NAV 시퀀스가 비었다 — MDD 정의 불가")
    peak = vals[0]
    mdd = 0.0
    for v in vals:
        if v <= 0.0:
            raise ValueError(f"NAV는 양수여야 함(파산 이하 — 프록시 회계 계약): {v!r}")
        if v > peak:
            peak = v
        mdd = max(mdd, (peak - v) / peak)
    return mdd


def crisis_defense(
    crisis_windows: Mapping[str, tuple[str, str]],
    *,
    navs: Sequence[tuple[str, float]] | None = None,
) -> dict[str, float]:
    """위기 구간(req-v2 §3: {"2008": …, "2020-03": …})에서의 NAV 방어도.

    방어도 = 구간 시작 관측 → 구간 종료 관측 누적 수익률(양수일수록 방어 우수 —
    전략 간 비교는 리포트에서 동일 구간 값을 대조한다). navs 미제공 → {}. 구간 내
    관측 2점 미만 → 해당 구간 결과 누락(산출 불가 — 강제 표기 금지).
    """
    if navs is None:
        return {}
    points: list[tuple[date, float]] = []
    for raw_d, raw_v in navs:
        d = _iso_date(raw_d, "navs date")
        v = _finite(raw_v, "navs value")
        if v <= 0.0:
            raise ValueError(f"NAV는 양수여야 함: {v!r}")
        points.append((d, v))
    points.sort(key=lambda pt: pt[0])
    out: dict[str, float] = {}
    for name, window in crisis_windows.items():
        if not isinstance(window, (tuple, list)) or len(window) != 2:
            raise ValueError(f"위기 구간 {name!r}: (start, end) 2원소: {window!r}")
        start = _iso_date(window[0], f"위기 구간 {name} start")
        end = _iso_date(window[1], f"위기 구간 {name} end")
        if start > end:
            raise ValueError(f"위기 구간 {name!r}: start > end 역순: {window!r}")
        in_window = [v for d, v in points if start <= d <= end]
        if len(in_window) < 2:
            continue  # 구간 관측 부족 — 방어도 미산출(누락)
        out[name] = in_window[-1] / in_window[0] - 1.0
    return out


def _validate_allocations(allocations_by_month: Sequence[Mapping[str, float]]) -> list[dict[str, float]]:
    if not isinstance(allocations_by_month, (Sequence,)) or isinstance(allocations_by_month, (str, bytes)):
        raise ValueError("allocations_by_month는 배분 행 시퀀스")
    if len(allocations_by_month) == 0:
        raise ValueError("배분 행이 비었다 — 백테스트 최소 1개월")
    rows: list[dict[str, float]] = []
    for t, row in enumerate(allocations_by_month):
        if not isinstance(row, Mapping):
            raise ValueError(f"배분 행 {t}: Mapping(dict)이어야 함: {row!r}")
        if set(row.keys()) != set(ELEMENTS):
            raise ValueError(
                f"배분 행 {t}: 오행 5키 완전이어야 함(누락·추가: "
                f"{sorted(set(row.keys()) ^ set(ELEMENTS))})"
            )
        values = {el: _finite(row[el], f"배분 행 {t}[{el}]") for el in ELEMENTS}
        for el, v in values.items():
            if v < 0.0:
                raise ValueError(f"배분 행 {t}: {el}는 0 이상: {v!r}")
        s = sum(values.values())
        if abs(s - ALLOCATION_SUM) > ALLOCATION_TOLERANCE:
            raise ValueError(f"배분 행 {t}: 합계는 {ALLOCATION_SUM:g}(%p): {s!r}")
        rows.append(values)
    return rows


def _validate_returns(
    element_returns_by_month: Sequence[Mapping[str, float]] | None, months: int
) -> list[dict[str, float]]:
    if element_returns_by_month is None:
        return [{el: 0.0 for el in ELEMENTS} for _ in range(months)]
    if len(element_returns_by_month) != months:
        raise ValueError(
            f"수익 행 수({len(element_returns_by_month)})와 배분 수({months})가 다르다"
        )
    rows: list[dict[str, float]] = []
    for t, row in enumerate(element_returns_by_month):
        if not isinstance(row, Mapping):
            raise ValueError(f"수익 행 {t}: Mapping(dict)이어야 함: {row!r}")
        keys = set(row.keys())
        if keys != set(ELEMENTS):
            raise ValueError(
                f"수익 행 {t}: 오행 5키 완전이어야 함(불일치: {sorted(keys ^ set(ELEMENTS))})"
            )
        rows.append({el: _finite(row[el], f"수익 행 {t}[{el}]") for el in ELEMENTS})
    return rows


def run_backtest(
    allocations_by_month: Sequence[Mapping[str, float]],
    element_returns_by_month: Sequence[Mapping[str, float]] | None = None,
    *,
    cost_per_trade: float = COST_PER_TRADE_DEFAULT,
    dates: Sequence[str] | None = None,
    crisis_windows: Mapping[str, tuple[str, str]] | None = None,
) -> BacktestResult:
    """국면 → 배분 시프트 시뮬레이션 — 월경계 리밸런싱·거래비용 차감 NAV 회계.

    회계 규약(모듈 docstring + README v2a ③ 섹션): t월 배분의 전환 거래는 t월 시작에
    체결(초기 취득 포함 총 T회) — 비용 = cost_per_trade × 회전율 × NAV. NAV 결산은
    t월 성장 후 시점. dates를 제공하면 NAV·방어도가 실제 월말 날짜로 산출된다.

    반환: BacktestResult — months·total_return·cagr·vol·mdd·sharpe·trading_costs·
    crisis_defense(crisis_windows 제공 시)·navs·monthly_returns.
    """
    rows = _validate_allocations(allocations_by_month)
    returns_rows = _validate_returns(element_returns_by_month, len(rows))
    cost = _finite(cost_per_trade, "cost_per_trade")
    if not 0.0 <= cost < 1.0:
        raise ValueError(f"cost_per_trade는 [0, 1) 범위: {cost!r}")

    if dates is not None:
        if len(dates) != len(rows):
            raise ValueError(f"dates 수({len(dates)})와 배분 수({len(rows)})가 다르다")
        parsed_dates = [_iso_date(raw, f"dates[{i}]") for i, raw in enumerate(dates)]
        for i in range(1, len(parsed_dates)):
            if parsed_dates[i] <= parsed_dates[i - 1]:
                raise ValueError(f"dates는 날짜 오름차순: {dates[i-1]!r} ≥ {dates[i]!r}")
        nav_dates: list[str] = [d.isoformat() for d in parsed_dates]
    else:
        nav_dates = [str(i) for i in range(len(rows))]

    t_total = len(rows)
    prev_nav = 1.0
    books: dict[str, float] = {}
    trading_costs = 0.0
    navs: list[tuple[str, float]] = []
    monthly: list[float] = []
    for t in range(t_total):
        weights = {el: rows[t][el] / 100.0 for el in ELEMENTS}
        if t == 0:
            turnover = 1.0  # 초기 취득 — 전량 매입(회전 1.0)
        else:
            drift = {el: books[el] / prev_nav for el in ELEMENTS}
            turnover = sum(abs(weights[el] - drift[el]) for el in ELEMENTS)
        cost_frac = cost * turnover
        if cost_frac >= 1.0:
            raise ValueError(f"월 {t}: 거래비용이 NAV 전액 초과 — 회전율 {turnover!r} 재검토")
        base = prev_nav * (1.0 - cost_frac)
        trading_costs += cost_frac
        books = {el: base * weights[el] for el in ELEMENTS}
        for el in ELEMENTS:
            books[el] *= 1.0 + returns_rows[t][el]
        nav = sum(books.values())
        navs.append((nav_dates[t], nav))
        monthly.append(nav / prev_nav - 1.0)
        prev_nav = nav

    total_return = navs[-1][1] - 1.0
    vol = annualized_vol(monthly)
    defense: dict[str, float] = {}
    if crisis_windows and dates is not None:
        defense = crisis_defense(crisis_windows, navs=[(d, v) for d, v in navs])
    return BacktestResult(
        months=t_total,
        total_return=total_return,
        cagr=annualized_return(total_return, t_total),
        vol=vol,
        mdd=max_drawdown([v for _, v in navs]),
        sharpe=((annualized_return(total_return, t_total) - 0.0) / vol) if vol > 0.0 else 0.0,
        trading_costs=trading_costs,
        crisis_defense=defense,
        navs=navs,
        monthly_returns=monthly,
    )


def month_end_close(series: Series) -> Series:
    """일별(또는 무주기) 가격 Series → 월말(월별 마지막 유효 관측) Series.

    월 키는 YYYY-MM. 결측(None) 관측은 건너뛰며, 월 전체 결측이면 그 월은 누락된다.
    날짜 오름차순 위반이면 ValueError.
    """
    buckets: dict[str, tuple[str, float]] = {}
    order: list[str] = []
    prev_d = ""
    for d, v in series:
        if prev_d and d < prev_d:
            raise ValueError(f"시리즈는 날짜 오름차순이어야 함: {d!r} after {prev_d!r}")
        prev_d = d
        if v is None:
            continue
        key = d[:7]
        if key not in buckets:
            order.append(key)
        buckets[key] = (d, v)
    return [buckets[key] for key in order]


def monthly_returns_from_prices(series: Sequence[tuple[str, float]]) -> Series:
    """가격 Series → 월 수익률 Series — 첫 관측 제외, 직전 유효 가격 대비 비율.

    결측 가격(None) 행은 건너뛴다. 유효 가격 2점 간 구간이 월 경계와 어긋나는 경우의
    처리는 호출자(파이프라인)가 month_end_close로 정규화해 책임진다.
    """
    out: Series = []
    prev: float | None = None
    prev_d = ""
    for d, v in series:
        d_ok = _iso_date(d, "가격 시리즈 날짜")  # 형식 검증
        if prev_d and d < prev_d:
            raise ValueError(f"가격 시리즈는 날짜 오름차순이어야 함: {d!r} after {prev_d!r}")
        prev_d = d
        if v is None:
            continue
        v = _finite(v, "가격")
        if v <= 0.0:
            raise ValueError(f"가격은 양수여야 함: {v!r}")
        if prev is not None:
            out.append((d, v / prev - 1.0))
        prev = v
    return out


def recent_window(series: Sequence[tuple[str, float]], *, months_back: int = RECENT_MONTHS) -> Series:
    """마지막 관측 기준 직전 months_back개 월로 절삭(마지막 관측 포함).

    '최근 15년(데이터 존재 범위)' — req-v2 §3. 월 키 YYYY-MM 비교(ISO 문자열 순서
    = 연월 순서). months_back ≤ 0·빈 시리즈는 ValueError.
    """
    if not isinstance(months_back, int) or isinstance(months_back, bool) or months_back <= 0:
        raise ValueError(f"months_back은 1 이상 정수: {months_back!r}")
    if not series:
        raise ValueError("절삭 대상 시리즈가 비었다")
    last_key = series[-1][0][:7]
    y = int(last_key[:4])
    m = int(last_key[5:7])
    total = y * 12 + (m - 1) - (months_back - 1)
    cutoff = f"{total // 12:04d}-{total % 12 + 1:02d}"
    return [(d, v) for d, v in series if d[:7] >= cutoff]


__all__ = [
    "ALLOCATION_SUM",
    "ALLOCATION_TOLERANCE",
    "BASIS_ALLOCATION",
    "COST_PER_TRADE_DEFAULT",
    "DEFAULT_CRISIS_WINDOWS",
    "MONTHS_IN_YEAR",
    "RECENT_MONTHS",
    "BacktestResult",
    "REGIME_ALLOCATIONS",
    "annualized_return",
    "annualized_vol",
    "compound",
    "crisis_defense",
    "max_drawdown",
    "month_end_close",
    "monthly_returns_from_prices",
    "recent_window",
    "run_backtest",
    "sharpe_ratio",
]