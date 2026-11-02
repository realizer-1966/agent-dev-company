"""FEAAS v2a ② scores(표준화) 계층 테스트 — req-v2 §2·§5-1 (fixture·고정 입력 기반).

정책 고정(req §5-1 대안 선택): 10년 부족 → **누락 표기(None)** 채택, 감쇠 페널티 미채택.
근거: req §2 '판정 불가(데이터 부족) 시 국면=null·이유 표기 — 강제 매칭 금지'와 정합이며,
감쇠 수치는 편향된 점수로 국면 오판 위험을 남긴다 (docs/indicator-map.md 정책 절).

percentile 정의(확정): p = 100 × #{w ≤ v} / n — w는 현재를 포함한 직전 window개
관측(None 제외) → 최대 100·최소 100/n. 반올림은 Python 내장 round(banker).
"""

from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.scores as scores
from feaas.sources import parse_fred_csv

FIXTURES_DIR = ENGINE_DIR / "data" / "fixtures"


def _monthly_series(*values: float | None) -> list[tuple[str, float | None]]:
    return [(f"2020-{k + 1:02d}-01", v) for k, v in enumerate(values)]


def assert_value_series(
    case: unittest.TestCase, got: list[float | None], expected: list[float | None]
) -> None:
    """파생/표준화 값 비교 — float 파생 수치는 1e-9 허용(정확 등식은 실수 연산 아티팩트)."""
    case.assertEqual(len(got), len(expected))
    for i, (g, e) in enumerate(zip(got, expected, strict=True)):
        if e is None or g is None:
            case.assertIsNone(g, f"index {i}")
            case.assertIsNone(e, f"index {i}")
        else:
            case.assertAlmostEqual(g, e, places=9, msg=f"index {i}")


class CarryForwardTests(unittest.TestCase):
    def test_interior_missings_filled_forward(self) -> None:
        self.assertEqual(
            scores.carry_forward((1.0, None, None, 3.0, None)),
            [1.0, 1.0, 1.0, 3.0, 3.0],
        )

    def test_leading_missings_retained(self) -> None:
        self.assertEqual(scores.carry_forward((None, 2.0, None)), [None, 2.0, 2.0])

    def test_all_missing_stays_missing(self) -> None:
        self.assertEqual(scores.carry_forward((None, None)), [None, None])

    def test_empty_input(self) -> None:
        self.assertEqual(scores.carry_forward(()), [])

    def test_no_missing_is_identity(self) -> None:
        self.assertEqual(scores.carry_forward((1.0, 2.0)), [1.0, 2.0])


class RollingPercentileTests(unittest.TestCase):
    FIXTURE = (10.0, 20.0, 30.0, 20.0, 50.0)

    def test_strict_full_window_expected_values(self) -> None:
        got = scores.rolling_percentile(self.FIXTURE, window=3, strict=True)
        self.assertIsNone(got[0])
        self.assertIsNone(got[1])
        self.assertEqual(got[2], 100.0)
        self.assertAlmostEqual(got[3], 200.0 / 3.0, places=9)
        self.assertEqual(got[4], 100.0)

    def test_lax_short_window_uses_available(self) -> None:
        got = scores.rolling_percentile(self.FIXTURE, window=3, strict=False)
        self.assertEqual(got[:3], [100.0, 100.0, 100.0])
        self.assertAlmostEqual(got[3], 200.0 / 3.0, places=9)
        self.assertEqual(got[4], 100.0)

    def test_none_values_undefined_and_excluded_from_window(self) -> None:
        lax = scores.rolling_percentile((None, 1.0, 2.0, 1.0), window=2, strict=False)
        self.assertEqual(lax, [None, 100.0, 100.0, 50.0])
        strict = scores.rolling_percentile((None, 1.0, 2.0, 1.0), window=2, strict=True)
        self.assertEqual(strict, [None, None, 100.0, 50.0])

    def test_window_of_one_and_ties(self) -> None:
        self.assertEqual(scores.rolling_percentile((5.0, 5.0, 5.0), window=1), [100.0, 100.0, 100.0])

    def test_min_gets_floor_100_over_n(self) -> None:
        got = scores.rolling_percentile((4.0, 1.0, 2.0), window=2, strict=False)
        self.assertEqual(got, [100.0, 50.0, 100.0], "p=100×#{≤v}/n — 최소값은 100/n")

    def test_insufficient_history_none_is_the_fixed_policy(self) -> None:
        got = scores.rolling_percentile((1.0, 2.0, 3.0, 4.0), window=10, strict=True)
        self.assertEqual(got, [None, None, None, None])

    def test_invalid_window_rejected(self) -> None:
        with self.assertRaises(ValueError):
            scores.rolling_percentile((1.0,), window=0)


class InvertTests(unittest.TestCase):
    def test_invert(self) -> None:
        self.assertEqual(scores.invert(40.0), 60.0)
        self.assertEqual(scores.invert(0.0), 100.0)
        self.assertEqual(scores.invert(100.0), 0.0)
        self.assertAlmostEqual(scores.invert(12.5), 87.5, places=9)


class ElementScoreTests(unittest.TestCase):
    def test_mean_rounded(self) -> None:
        self.assertEqual(scores.element_score((50.0, 60.0)), 55)
        self.assertEqual(scores.element_score((40.0, 51.0, 62.0)), 51)
        self.assertEqual(scores.element_score((40.0, 55.0, 51.0)), 49)

    def test_none_percentiles_skipped(self) -> None:
        self.assertEqual(scores.element_score((50.0, None, 60.0)), 55)
        self.assertEqual(scores.element_score((51.7,)), 52)

    def test_all_missing_returns_none(self) -> None:
        self.assertIsNone(scores.element_score(()))
        self.assertIsNone(scores.element_score((None, None)))

    def test_coverage_decay_not_adopted(self) -> None:
        """감쇠 페널티 미채택 원칙: coverage 파라미터는 계약에서 제거한다."""
        self.assertEqual(list(inspect.signature(scores.element_score).parameters), ["percentiles"])


class ClampTests(unittest.TestCase):
    def test_clamp(self) -> None:
        self.assertEqual(scores.clamp(150.0), 100.0)
        self.assertEqual(scores.clamp(-5.0), 0.0)
        self.assertEqual(scores.clamp(55.0), 55.0)
        self.assertEqual(scores.clamp(2.5, low=-2.0, high=2.0), 2.0)


class StandardizeSeriesTests(unittest.TestCase):
    """수용기준 1 상단: fixture → carry-forward → rolling percentile(0~100)."""

    def test_unrate_fixture_window_over_history_is_all_none(self) -> None:
        rows = parse_fred_csv(
            (FIXTURES_DIR / "fredgraph_UNRATE_2024.csv").read_text(encoding="utf-8")
        )
        got = scores.standardize_series(rows, window=120)
        self.assertEqual([d for d, _ in got], [d for d, _ in rows])
        self.assertEqual([v for _, v in got], [None] * len(rows), "10년 부족 → 누락 표기")

    def test_synthetic_window_4_expected(self) -> None:
        series = _monthly_series(10.0, 20.0, 30.0, 20.0, 50.0, 5.0, 70.0)
        got = scores.standardize_series(series, window=4)
        self.assertEqual([v for _, v in got], [None, None, None, 75.0, 100.0, 25.0, 100.0])

    def test_carry_forward_composition(self) -> None:
        series = _monthly_series(10.0, 20.0, None, 50.0)
        got = scores.standardize_series(series, window=3)
        self.assertEqual([v for _, v in got], [None, None, 100.0, 100.0])

    def test_vix_fixture_inverse_end_to_end(self) -> None:
        rows = parse_fred_csv(
            (FIXTURES_DIR / "fredgraph_VIXCLS_2021-02.csv").read_text(encoding="utf-8")
        )
        got = scores.standardize_indicator(rows, transform="level", inverse=True, window=5)
        expected = [None, None, None, None, 0.0, 20.0, 0.0, 20.0, 80.0, 0.0, 20.0]
        assert_value_series(self, [v for _, v in got], expected)

    def test_unrate_fixture_inverse_window_6(self) -> None:
        rows = parse_fred_csv(
            (FIXTURES_DIR / "fredgraph_UNRATE_2024.csv").read_text(encoding="utf-8")
        )
        got = scores.standardize_indicator(rows, transform="level", inverse=True, window=6)
        expected = [None, None, None, None, None, 0.0, 0.0, 0.0, 100.0 / 3.0, 100.0 / 3.0, 0.0, 50.0]
        assert_value_series(self, [v for _, v in got], expected)

    def test_element_score_over_real_fixture_tail(self) -> None:
        """VIX fixture 마지막 7백분위(역방향 [0,20,0,20,80,0,20]) 평균 = 140/7 = 20."""
        rows = parse_fred_csv(
            (FIXTURES_DIR / "fredgraph_VIXCLS_2021-02.csv").read_text(encoding="utf-8")
        )
        got = scores.standardize_indicator(rows, transform="level", inverse=True, window=5)
        tail = [v for _, v in got][4:]
        self.assertEqual(scores.element_score(tail), 20)


class ApplyTransformTests(unittest.TestCase):
    def test_level_passthrough(self) -> None:
        series = [("2020-01-01", 5.0), ("2020-02-01", None)]
        self.assertEqual(scores.apply_transform(series, "level"), series)

    def test_yoy_monthly_date_anchored(self) -> None:
        series = [("2023-01-01", 100.0), ("2023-06-01", 90.0), ("2024-01-01", 110.0)]
        got = [v for _, v in scores.apply_transform(series, "yoy")]
        assert_value_series(self, got, [None, None, 10.0])

    def test_yoy_daily_base_about_one_year_prior(self) -> None:
        series = [("2020-01-02", 100.0), ("2020-12-31", 123.4), ("2021-01-04", 110.0)]
        got = [v for _, v in scores.apply_transform(series, "yoy")]
        assert_value_series(self, got, [None, 23.4, 10.0])

    def test_qoq_one_observation_back(self) -> None:
        series = [("2024-01-01", 100.0), ("2024-04-01", 103.0)]
        got = [v for _, v in scores.apply_transform(series, "qoq")]
        assert_value_series(self, got, [None, 3.0])

    def test_1y_change_same_formula_as_yoy(self) -> None:
        series = [("2023-02-01", 80.0), ("2024-02-01", 88.0)]
        got = [v for _, v in scores.apply_transform(series, "1y_change")]
        assert_value_series(self, got, [None, 10.0])

    def test_none_base_and_nonpositive_base_yield_none(self) -> None:
        series = [("2023-01-01", None), ("2024-01-01", 110.0)]
        self.assertEqual(
            [v for _, v in scores.apply_transform(series, "yoy")], [None, None]
        )
        series = [("2023-01-01", 0.0), ("2024-01-01", 10.0)]
        self.assertEqual(
            [v for _, v in scores.apply_transform(series, "yoy")], [None, None]
        )

    def test_unknown_transform_rejected(self) -> None:
        with self.assertRaises(ValueError):
            scores.apply_transform([("2020-01-01", 1.0)], "mom")


class WindowFrequencyTests(unittest.TestCase):
    """주기별 10년 관측수 표 — 월120·주520·일2530·분기40·연10 (문서+테스트 고정)."""

    def test_window_counts_constant(self) -> None:
        self.assertEqual(
            scores.WINDOW_COUNTS,
            {"daily": 2530, "weekly": 520, "monthly": 120, "quarterly": 40, "annual": 10},
        )

    def test_window_count_for_detection(self) -> None:
        monthly = [f"2024-{m + 1:02d}-01" for m in range(12)]
        self.assertEqual(scores.window_count_for(monthly), 120)
        daily = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
        self.assertEqual(scores.window_count_for(daily), 2530)
        quarterly = ["2024-01-03", "2024-04-01", "2024-07-01", "2024-10-01"]
        self.assertEqual(scores.window_count_for(quarterly), 40)
        weekly = ["2024-01-05", "2024-01-12", "2024-01-19", "2024-01-26"]
        self.assertEqual(scores.window_count_for(weekly), 520)
        annual = ["2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"]
        self.assertEqual(scores.window_count_for(annual), 10)

    def test_too_few_dates_rejected(self) -> None:
        with self.assertRaises(ValueError):
            scores.window_count_for(["2024-01-01", "2024-01-02"])

    def test_default_window_is_ten_years_monthly(self) -> None:
        self.assertEqual(scores.DEFAULT_WINDOW_MONTHS, 120)


if __name__ == "__main__":
    unittest.main()