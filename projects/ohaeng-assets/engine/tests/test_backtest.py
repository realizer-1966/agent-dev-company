"""FEAAS v2a ③ backtest(백테스트·성과지표) 계층 테스트 — req-v2 §3·§5-3 (수용기준 3).

복리 계산·거래비용 차감·MDD 정의를 고정 fixture 기대값으로 고정한다. 기대값은 구현
이전에 독립 산술(순수 수식 — feaas 미사용)으로 산출했으며, 상수는 아래에 그대로 둔다.

회계 계약(README v2a ③ 섹션 + backtest.py docstring 문서화):
- 배분 행: 오행 5키 완전·합 100(허용오차 1e-6)·%p 단위. 수익 행: (1+r) 월 수익률 소수.
- 거래: 월 경계 리밸런싱 — t월 배분의 전환 거래는 t월 시작(=(t−1)월 말 NAV 확정 직후)에
  체결한다. 초기 취득(t=0, 회전 1.0) 포함 총 T회 거래. 비용 = cost_per_trade(0.1%) ×
  회전율(거래액 비율) × 체결 시점 NAV — 정적 배분·무성장 월은 회전 0 → 비용 없음.
- 결산 NAV는 t월 성장 후 시점(비용은 t월 시작에 반영 → t월 월수익에 포함).
- MDD는 비용 포함 NAV 곡선 고점 대비 최대 낙폭(0 ≤ mdd < 1, 양수 보고).
- annualized_vol = 모표준편차(÷N) × √12(월 12회). sharpe = (CAGR − rf) / 연율화 변동성 —
  변동성 0이면 정의 불가(ValueError). run_backtest는 계산 도구 계층이므로 vol 0 → 0.0 표기.
- 방어도: 위기 구간 내 NAV 첫 관측 → 마지막 관측 누적 수익률(전략 간 비교용; 구간 관측
  2점 미만 → 누락).
"""

from __future__ import annotations

import calendar
import math
import sys
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.backtest as backtest


def _month_ends(start: tuple[int, int], n: int) -> list[str]:
    """월말 날짜 n개 — (연, 월) 시작점부터 순차 생성(합성 fixture 축)."""
    y, m = start
    out: list[str] = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}")
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return out


def ret(목: float = 0.0, 화: float = 0.0, 토: float = 0.0, 금: float = 0.0, 수: float = 0.0) -> dict[str, float]:
    """완전 오행 수익 행(미사용 오행 0) — run_backtest 완전키 계약 충족용."""
    return {"목": 목, "화": 화, "토": 토, "금": 금, "수": 수}


def alloc(목: float = 0.0, 화: float = 0.0, 토: float = 0.0, 금: float = 0.0, 수: float = 0.0) -> dict[str, float]:
    """완전 오행 배분 행(%p, 합 100) — run_backtest 계약 충족용."""
    return {"목": 목, "화": 화, "토": 토, "금": 금, "수": 수}


def full_allocation(weights: dict[str, float]) -> dict[str, float]:
    """부분 배분 → 오행 5키 완전 배분."""
    return {el: weights.get(el, 0.0) for el in ("목", "화", "토", "금", "수")}


# ── fixture A: 3년(36개월) — 정적 100% 목 · 월수익 +1%(0~23개월) −2%(24~35개월) ──
FIX36_RETURNS = [ret(목=0.01, 수=0.003) for _ in range(24)] + [ret(목=-0.02, 수=0.004) for _ in range(12)]
FIX36_ALLOCATIONS = [alloc(목=100.0) for _ in range(36)]
FIX36_DATES = _month_ends((2022, 10), 36)  # 2022-10-31 .. 2025-09-30
FIX36_WINDOWS = {"2024 하락구간": ("2024-01-01", "2024-12-31")}
# 기대값(독립 산술 — scratch/bt_expected.py 산출, 복사):
FIX36_EXPECTED = {
    "total_return": -0.004614368604886843,
    "cagr": -0.0015404947738487662,
    "vol": 0.04892440346728439,
    "mdd": 0.21528327626520016,
    "sharpe": -0.03148724694985583,
    "trading_costs": 0.001,
    "monthly0": 0.008990000000000054,
    "defense_2024": 0.01917606848350406,
    "nav23": 1.2684649138833828,
    "nav35": 0.9953856313951132,
}

# ── fixture B: 1년(12개월) — 水100% 6개월 → 木100% 6개월(회전 2.0 → 비용 0.2%) ──
FIX12_RETURNS = [ret(수=0.003) for _ in range(6)] + [ret(목=0.02) for _ in range(6)]
FIX12_ALLOCATIONS = [alloc(수=100.0) for _ in range(6)] + [alloc(목=100.0) for _ in range(6)]
FIX12_DATES = _month_ends((2024, 10), 12)
FIX12_EXPECTED = {
    "total_return": 0.1431485194542521,
    "cagr": 0.1431485194542521,
    "vol": 0.029219290801055897,
    "mdd": 0.0,
    "trading_costs": 0.003,
    "monthly0": 0.0019969999999998045,
    "monthly6": 0.017959999999999976,
}

# ── fixture C: 3개월 — 60/40(木60·金40) 유지보수 회전 비용 경로 ──
FIX3_RETURNS = [ret(목=0.01, 금=0.0) for _ in range(3)]
FIX3_ALLOCATIONS = [alloc(목=60.0, 금=40.0) for _ in range(3)]
FIX3_DATES = _month_ends((2024, 10), 3)
FIX3_EXPECTED = {
    "navs": [1.004994, 1.0110191400288, 1.017080401977101],
    "monthly": [0.004993999999999943, 0.005995200000000089, 0.005995200000000311],
    "total_return": 0.017080401977100923,
    "cagr": 0.07009206596579332,
    "vol": 0.0016349527536500988,
    "trading_costs": 0.0010095427435387674,
    "mdd": 0.0,
}

# ── 무거래 회전: 정적 단일 자산 + 월수익 0 — 유지보수 비용 없음(회전 0) ──
FIXZERO_RETURNS = [ret(수=0.0) for _ in range(6)]
FIXZERO_ALLOCATIONS = [alloc(수=100.0) for _ in range(6)]
FIXZERO_DATES = _month_ends((2024, 10), 6)


class CompoundTests(unittest.TestCase):
    def test_three_months_alternating(self) -> None:
        # 1.01×0.99×1.01 − 1 — 독립 산술 0.009899.
        self.assertAlmostEqual(backtest.compound((0.01, -0.01, 0.01)), 0.009899000000000102, places=12)

    def test_half_then_double(self) -> None:
        # −50% 후 +100% → 원점 회복 0.0 — 복리의 비가산성 고정.
        self.assertEqual(backtest.compound((-0.5, 1.0)), 0.0)

    def test_single_and_empty(self) -> None:
        self.assertAlmostEqual(backtest.compound((0.05,)), 0.050000000000000044, places=12)
        self.assertEqual(backtest.compound(()), 0.0)

    def test_rejects_non_numeric_and_non_finite(self) -> None:
        with self.assertRaises(ValueError):
            backtest.compound(("0.01",))
        with self.assertRaises(ValueError):
            backtest.compound((float("nan"),))
        with self.assertRaises(ValueError):
            backtest.compound((True,))


class AnnualizedReturnTests(unittest.TestCase):
    def test_one_year_exact(self) -> None:
        self.assertAlmostEqual(backtest.annualized_return(0.1, 12), 0.1, places=12)

    def test_two_years_21pct(self) -> None:
        self.assertAlmostEqual(backtest.annualized_return(0.21, 24), 0.1, places=12)

    def test_zero_return_stays_zero(self) -> None:
        self.assertEqual(backtest.annualized_return(0.0, 6), 0.0)

    def test_monthless_and_negative_rejects(self) -> None:
        for months in (0, -1):
            with self.subTest(months=months):
                with self.assertRaises(ValueError):
                    backtest.annualized_return(0.1, months)

    def test_sub_negative_one_rejects(self) -> None:
        with self.assertRaises(ValueError):
            backtest.annualized_return(-1.0, 12)

    def test_fractional_years(self) -> None:
        # 6개월 동안 +21% → 연율 (1.21)^2 − 1.
        self.assertAlmostEqual(backtest.annualized_return(0.21, 6), 1.21**2 - 1, places=12)


class AnnualizedVolTests(unittest.TestCase):
    def test_symmetric_two_month(self) -> None:
        # 모표준편차(÷N): mean 0 · 분산 (0.02²×2)/2 = 4e-4 · std 0.02 × √12.
        self.assertAlmostEqual(backtest.annualized_vol((0.02, -0.02)), 0.02 * math.sqrt(12), places=12)

    def test_constant_series_has_zero_vol(self) -> None:
        self.assertEqual(backtest.annualized_vol((0.01, 0.01, 0.01)), 0.0)

    def test_empty_rejects(self) -> None:
        with self.assertRaises(ValueError):
            backtest.annualized_vol(())

    def test_population_not_sample(self) -> None:
        # 표본(÷(N−1))이면 0.02×√24 — 모평균 고정(README 회계 계약).
        self.assertAlmostEqual(backtest.annualized_vol((0.02, -0.02)), 0.06928203230275509, places=12)


class SharpeRatioTests(unittest.TestCase):
    def test_rf_zero(self) -> None:
        self.assertAlmostEqual(
            backtest.sharpe_ratio((0.01, 0.03)), 7.722365085017755, places=12
        )

    def test_rf_subtracted(self) -> None:
        self.assertAlmostEqual(
            backtest.sharpe_ratio((0.01, 0.03), rf_annual=0.12), 4.258263469880001, places=12
        )

    def test_zero_vol_is_undefined(self) -> None:
        with self.assertRaises(ValueError):
            backtest.sharpe_ratio((0.01, 0.01))

    def test_empty_rejects(self) -> None:
        with self.assertRaises(ValueError):
            backtest.sharpe_ratio(())


class MaxDrawdownTests(unittest.TestCase):
    def test_textbook_path(self) -> None:
        # 고점 120 대비 90 → 0.25(양수 보고) — 이후 105는 여전히 고점 미달.
        self.assertAlmostEqual(backtest.max_drawdown((100.0, 120.0, 90.0, 105.0)), 0.25, places=12)

    def test_monotonic_rising_is_zero(self) -> None:
        self.assertEqual(backtest.max_drawdown((3.0, 6.0)), 0.0)

    def test_trough_before_peak(self) -> None:
        self.assertAlmostEqual(backtest.max_drawdown((3.0, 6.0, 2.0)), 1 - 2 / 6, places=12)

    def test_single_point_is_zero(self) -> None:
        self.assertEqual(backtest.max_drawdown((7.0,)), 0.0)

    def test_empty_and_nonpositive_reject(self) -> None:
        with self.assertRaises(ValueError):
            backtest.max_drawdown(())
        with self.assertRaises(ValueError):
            backtest.max_drawdown((0.0, 1.0))
        with self.assertRaises(ValueError):
            backtest.max_drawdown((100.0, float("nan")))


class CrisisDefenseTests(unittest.TestCase):
    NAVS = [
        ("2020-02-19", 100.0),
        ("2020-02-28", 90.0),
        ("2020-03-31", 80.0),
        ("2020-04-30", 85.0),
    ]

    def test_window_return(self) -> None:
        defense = backtest.crisis_defense(
            {"2020-03": ("2020-02-19", "2020-03-31")}, navs=self.NAVS
        )
        self.assertAlmostEqual(defense["2020-03"], 80.0 / 100.0 - 1.0, places=12)

    def test_two_windows_and_boundary_dates_inclusive(self) -> None:
        defense = backtest.crisis_defense(
            {
                "2020-03": ("2020-02-19", "2020-03-31"),
                "2020-02": ("2020-02-01", "2020-02-29"),
                "2021": ("2021-01-01", "2021-12-31"),
            },
            navs=self.NAVS,
        )
        self.assertAlmostEqual(defense["2020-03"], -0.2, places=12)
        self.assertAlmostEqual(defense["2020-02"], -0.1, places=12)
        self.assertNotIn("2021", defense, "구간 관측 부족 → 방어도 누락(계약)")

    def test_no_navs_means_no_defense(self) -> None:
        self.assertEqual(backtest.crisis_defense({"2008": ("2007-10-01", "2009-03-31")}), {})

    def test_reversed_window_rejects(self) -> None:
        with self.assertRaises(ValueError):
            backtest.crisis_defense({"2008": ("2009-03-31", "2007-10-01")}, navs=self.NAVS)

    def test_bad_window_shape_rejects(self) -> None:
        with self.assertRaises(ValueError):
            backtest.crisis_defense({"2008": ("2007-10-01",)}, navs=self.NAVS)


class RunBacktestFixtureATests(unittest.TestCase):
    """복리·비용·MDD 고정 fixture 3년(수용기준 3 — 핵심)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = backtest.run_backtest(
            FIX36_ALLOCATIONS,
            FIX36_RETURNS,
            dates=FIX36_DATES,
            crisis_windows=FIX36_WINDOWS,
        )

    def test_compounding_with_initial_cost(self) -> None:
        self.assertAlmostEqual(self.result.total_return, FIX36_EXPECTED["total_return"], places=12)
        self.assertAlmostEqual(self.result.cagr, FIX36_EXPECTED["cagr"], places=12)
        self.assertAlmostEqual(self.result.monthly_returns[0], FIX36_EXPECTED["monthly0"], places=12)
        self.assertAlmostEqual(self.result.navs[23][1], FIX36_EXPECTED["nav23"], places=12)
        self.assertAlmostEqual(self.result.navs[35][1], FIX36_EXPECTED["nav35"], places=12)

    def test_trading_costs(self) -> None:
        # 정적 배분 — 월내 회전 0 → 초기 취득 0.001 한 번.
        self.assertAlmostEqual(self.result.trading_costs, FIX36_EXPECTED["trading_costs"], places=12)

    def test_mdd_from_cost_inclusive_nav(self) -> None:
        # MDD = 1 − 0.98^12 — 비용·회전 무관(단일 자산 상대 폭), 양수 보고.
        self.assertAlmostEqual(self.result.mdd, FIX36_EXPECTED["mdd"], places=12)

    def test_vol_and_sharpe(self) -> None:
        self.assertAlmostEqual(self.result.vol, FIX36_EXPECTED["vol"], places=12)
        self.assertAlmostEqual(self.result.sharpe, FIX36_EXPECTED["sharpe"], places=12)

    def test_window_defense(self) -> None:
        defense = self.result.crisis_defense["2024 하락구간"]
        self.assertAlmostEqual(defense, FIX36_EXPECTED["defense_2024"], places=12)

    def test_shape_contract(self) -> None:
        self.assertEqual(self.result.months, 36)
        self.assertEqual(len(self.result.navs), 36)
        self.assertEqual(self.result.navs[0][0], "2022-10-31")
        self.assertAlmostEqual(self.result.monthly_returns[-1], -0.02, places=12)


class RunBacktestFixtureBTests(unittest.TestCase):
    """회전 기반 거래비용 — 배분 전환 수 수수."""
    @classmethod
    def setUpClass(cls) -> None:
        cls.result = backtest.run_backtest(
            FIX12_ALLOCATIONS, FIX12_RETURNS, dates=FIX12_DATES
        )

    def test_costs_accumulate_turnover(self) -> None:
        # 0.1%/거래 · 거래액 비율 합계: 초기 1.0 + 전환 2.0 → 0.003(누적 비율).
        self.assertAlmostEqual(self.result.trading_costs, 0.003, places=12)

    def test_nav_path(self) -> None:
        self.assertAlmostEqual(self.result.total_return, FIX12_EXPECTED["total_return"], places=12)
        self.assertAlmostEqual(self.result.cagr, FIX12_EXPECTED["cagr"], places=12)
        self.assertAlmostEqual(self.result.monthly_returns[0], FIX12_EXPECTED["monthly0"], places=12)
        self.assertAlmostEqual(self.result.monthly_returns[6], FIX12_EXPECTED["monthly6"], places=12)

    def test_rising_path_has_no_drawdown(self) -> None:
        self.assertAlmostEqual(self.result.mdd, 0.0, places=12)
        self.assertAlmostEqual(self.result.vol, FIX12_EXPECTED["vol"], places=12)


class RunBacktestSixtyFortyMaintenanceTests(unittest.TestCase):
    """정적 60/40 — 월 성장률 왜곡(drift)에 의한 유지보수 회전·비용."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = backtest.run_backtest(FIX3_ALLOCATIONS, FIX3_RETURNS, dates=FIX3_DATES)

    def test_navs_and_monthly_returns_exact(self) -> None:
        for i, nav in enumerate(FIX3_EXPECTED["navs"]):
            self.assertAlmostEqual(self.result.navs[i][1], nav, places=12)
        for i, m in enumerate(FIX3_EXPECTED["monthly"]):
            self.assertAlmostEqual(self.result.monthly_returns[i], m, places=12)

    def test_costs_and_metrics(self) -> None:
        self.assertAlmostEqual(
            self.result.trading_costs, FIX3_EXPECTED["trading_costs"], places=12
        )
        self.assertAlmostEqual(self.result.cagr, FIX3_EXPECTED["cagr"], places=12)
        self.assertAlmostEqual(self.result.vol, FIX3_EXPECTED["vol"], places=12)
        self.assertAlmostEqual(self.result.mdd, FIX3_EXPECTED["mdd"], places=12)


class RunBacktestZeroTradeTests(unittest.TestCase):
    """무성장+정적 배분 → 회전 0 → 유지보수 비용 없음. 초기 취득 비용은 t0 월수익에
    포함(계약) → 첫 월 −0.001 → 변동성 0 아님(모표준편차 ×√12). 비용 0 지정 시
    월수익 전부 0 → 변동성 0 → sharpe 0.0 표기 분기."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = backtest.run_backtest(
            FIXZERO_ALLOCATIONS, FIXZERO_RETURNS, dates=FIXZERO_DATES
        )
        cls.free = backtest.run_backtest(
            FIXZERO_ALLOCATIONS, FIXZERO_RETURNS, dates=FIXZERO_DATES, cost_per_trade=0.0
        )

    def test_costs_and_flat_nav(self) -> None:
        self.assertAlmostEqual(self.result.trading_costs, 0.001, places=12)  # 초기 취득만
        self.assertAlmostEqual(self.result.total_return, -0.001, places=12)
        self.assertAlmostEqual(self.result.monthly_returns[0], -0.001, places=12)
        self.assertAlmostEqual(self.result.mdd, 0.0, places=12)
        # t0 비용 포함 월수익 [-0.001, 0×5] — 모표준편차 ×√12:
        self.assertAlmostEqual(self.result.vol, 0.0012909944487358067, places=12)
        self.assertAlmostEqual(self.result.sharpe, -1.548418741813703, places=12)

    def test_zero_cost_flat_nav_has_zero_vol_and_sharpe_0(self) -> None:
        # cost_per_trade=0 → 월수익 전부 0 → 변동성 0 → sharpe 0.0 표기(계약 분기).
        self.assertEqual(self.free.vol, 0.0)
        self.assertEqual(self.free.sharpe, 0.0)
        self.assertEqual(self.free.total_return, 0.0)


class RunBacktestValidationTests(unittest.TestCase):
    """계약 위반은 조용한 수치 대신 ValueError(req 9장 전통 — 상태 오염 방지)."""

    def _alloc(self, **overrides: float) -> list[dict[str, float]]:
        rows = [alloc(목=100.0)]
        if overrides:
            rows = [dict(rows[0], **overrides)]
        return rows

    def test_allocation_row_incomplete_keys(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([{"목": 100.0}], FIX36_RETURNS[:1])

    def test_allocation_sum_not_100(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([alloc(목=90.0)], FIX36_RETURNS[:1])

    def test_allocation_negative_or_extra_key(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([alloc(목=110.0, 금=-10.0)], FIX36_RETURNS[:1])
        with self.assertRaises(ValueError):
            backtest.run_backtest([{"목": 50.0, "우주": 50.0, "화": 0.0, "토": 0.0, "금": 0.0, "수": 0.0}], FIX36_RETURNS[:1])

    def test_returns_length_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest(FIX36_ALLOCATIONS[:2], FIX36_RETURNS[:1])

    def test_returns_missing_element_key(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([alloc(목=100.0)], [{"목": 0.01}])

    def test_returns_nan_and_bool(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([alloc(목=100.0)], [ret(목=float("nan"))])
        with self.assertRaises(ValueError):
            backtest.run_backtest([alloc(목=100.0)], [ret(목=True)])

    def test_cost_per_trade_out_of_range(self) -> None:
        for cost in (-0.001, 1.0):
            with self.subTest(cost=cost):
                with self.assertRaises(ValueError):
                    backtest.run_backtest([alloc(목=100.0)], FIX36_RETURNS[:1], cost_per_trade=cost)

    def test_cost_can_be_zero(self) -> None:
        result = backtest.run_backtest(
            [alloc(목=100.0)], [ret(목=0.01)], cost_per_trade=0.0
        )
        self.assertAlmostEqual(result.total_return, 0.01, places=12)
        self.assertEqual(result.trading_costs, 0.0)

    def test_dates_length_and_order(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest(
                [alloc(목=100.0)] * 2, [ret(목=0.01)] * 2, dates=["2024-01-31"]
            )
        with self.assertRaises(ValueError):
            backtest.run_backtest(
                [alloc(목=100.0)] * 2,
                [ret(목=0.01)] * 2,
                dates=["2024-02-29", "2024-01-31"],  # 역순
            )
        with self.assertRaises(ValueError):
            backtest.run_backtest(
                [alloc(목=100.0)] * 2, [ret(목=0.01)] * 2, dates=["2024-13-01", "2024-03-01"]
            )

    def test_empty_allocations(self) -> None:
        with self.assertRaises(ValueError):
            backtest.run_backtest([], [])


class MonthlyResampleHelperTests(unittest.TestCase):
    """month_end_close · monthly_returns_from_prices · recent_window — 파이프라인 순수 보조."""

    def test_month_end_close_picks_last_valid_of_month(self) -> None:
        series = [("2022-02-01", 2.0), ("2022-02-10", 2.5), ("2022-02-28", 3.0), ("2022-03-01", 4.0)]
        self.assertEqual(backtest.month_end_close(series), [("2022-02-28", 3.0), ("2022-03-01", 4.0)])

    def test_month_end_close_skips_none_and_empty_months(self) -> None:
        series = [("2022-01-31", 1.0), ("2022-02-05", None), ("2022-02-20", None), ("2022-03-15", 9.0)]
        self.assertEqual(backtest.month_end_close(series), [("2022-01-31", 1.0), ("2022-03-15", 9.0)])

    def test_daily_fixture_sample(self) -> None:
        text = (ENGINE_DIR / "data" / "fixtures" / "stooq_spx_daily.sample.csv").read_text(encoding="utf-8")
        from feaas.sources import parse_stooq_csv

        monthly = backtest.month_end_close(parse_stooq_csv(text))
        self.assertEqual([d[:7] for d, _ in monthly], ["2022-01"])
        # fixture 마지막(최근) 유효 관측 2022-01-24 close 4410.45 — 고정 값(fixture 대조 독립 재확인)
        self.assertAlmostEqual(monthly[0][1], 4410.45, places=6)

    def test_monthly_returns_from_prices(self) -> None:
        prices = [("2024-01-31", 100.0), ("2024-02-29", 110.0), ("2024-03-31", 99.0), ("2024-04-30", 99.0)]
        out = backtest.monthly_returns_from_prices(prices)
        self.assertEqual([d for d, _ in out], ["2024-02-29", "2024-03-31", "2024-04-30"])
        self.assertAlmostEqual(out[0][1], 0.1, places=12)
        self.assertAlmostEqual(out[1][1], 99.0 / 110.0 - 1.0, places=12)
        self.assertAlmostEqual(out[2][1], 0.0, places=12)

    def test_recent_window_slices_months(self) -> None:
        series = [(f"202{k}-01-15", float(i)) for k, i in ((2, 1), (3, 2), (4, 3), (5, 4))]
        # 마지막 월 2025-01 기준 직전 13개월 창 = 2024-01..2025-01 → 2건 유지.
        self.assertEqual(
            backtest.recent_window(series, months_back=13),
            [("2024-01-15", 3.0), ("2025-01-15", 4.0)],
        )
        # 직전 2개월 창 = 2024-12..2025-01 → 시리즈에 2024-12가 없으면 2025-01만.
        self.assertEqual(backtest.recent_window(series, months_back=2), [("2025-01-15", 4.0)])

    def test_recent_window_rejects_bad_input(self) -> None:
        with self.assertRaises(ValueError):
            backtest.recent_window([], months_back=36)
        with self.assertRaises(ValueError):
            backtest.recent_window([("2024-01-31", 1.0)], months_back=0)


class MonthlyBondReturnsTests(unittest.TestCase):
    """⑥ — DGS10 연율 수익률 → 듀레이션 근사 총수익 변환(수 레그 근사와 대칭 계약)."""

    def test_manual_example_matches_formula(self) -> None:
        levels = [("2024-01", 4.0), ("2024-02", 4.1), ("2024-03", 3.9)]
        got = backtest.monthly_bond_returns_from_yields(levels)
        # 2월: 쿠폰 4.0/1200 − 6.5×0.10/1.04
        r_feb = (4.0 / 1200.0) - 6.5 * 0.001 / 1.04
        # 3월: 쿠폰 4.1/1200 − 6.5×(−0.20)/1.041
        r_mar = (4.1 / 1200.0) + 6.5 * 0.002 / 1.041
        self.assertEqual([m for m, _ in got], ["2024-02", "2024-03"])
        self.assertAlmostEqual(got[0][1], r_feb, places=12)
        self.assertAlmostEqual(got[1][1], r_mar, places=12)

    def test_first_month_excluded(self) -> None:
        got = backtest.monthly_bond_returns_from_yields(
            [("2024-01", 3.0), ("2024-02", 3.0)]
        )
        self.assertEqual(len(got), 1)
        yield_month, r = got[0]
        self.assertEqual(yield_month, "2024-02")
        self.assertAlmostEqual(r, 3.0 / 1200.0, places=12)  # Δy=0 → 쿠폰만

    def test_none_rows_skipped_with_prior_kept(self) -> None:
        got = backtest.monthly_bond_returns_from_yields(
            [("2024-01", 4.0), ("2024-02", None), ("2024-03", 4.0)]
        )
        self.assertEqual([m for m, _ in got], ["2024-03"])  # None 건너뜀 — prev 4.0 기준
        self.assertAlmostEqual(got[0][1], 4.0 / 1200.0, places=12)

    def test_nonpositive_yield_and_bad_duration_rejected(self) -> None:
        with self.assertRaises(ValueError):
            backtest.monthly_bond_returns_from_yields([("2024-01", 0.0)])
        with self.assertRaises(ValueError):
            backtest.monthly_bond_returns_from_yields(
                [("2024-01", -1.0)]
            )
        with self.assertRaises(ValueError):
            backtest.monthly_bond_returns_from_yields(
                [("2024-01", 4.0), ("2024-02", 4.0)], duration_years=0.0
            )
        with self.assertRaises(ValueError):
            backtest.monthly_bond_returns_from_yields(
                [("2024-01", 4.0), ("2024-02", 4.0)], duration_years=float("nan")
            )

    def test_bad_month_key_rejected(self) -> None:
        with self.assertRaises(ValueError):
            backtest.monthly_bond_returns_from_yields([("202401", 4.0)])


if __name__ == "__main__":
    unittest.main()