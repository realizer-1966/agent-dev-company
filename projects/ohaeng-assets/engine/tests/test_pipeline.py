"""FEAAS v2a ③ 배치 진입점(run_pipeline) 테스트 — fixture 경유 산출 계약(req-v2 §1·§4·§5).

- 전체 번호 fixture(17지표+프록시 5종, 합성 13년): exit 0, state.json 스키마 유효,
  백테스트 3전략(regime_shift·60/40·무보정 오행 고정) JSON+MD 산출.
- 절묘(스파스) fixture: 지수 부족 → 국면 null+사유(AC2), 백테스트 레그 스킵(WARN).
- run_pipeline.main은 배치 조합만 검증 — 실 fetch는 ④ 스모크(네트워크 격리 유지).
"""

from __future__ import annotations

import json
import math
import random
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import run_pipeline
from feaas import report
from feaas.backtest import BASIS_ALLOCATION, REGIME_ALLOCATIONS
from feaas.indicators import ELEMENTS, INDICATOR_DEFS

_END = (2024, 12)


def _fred_csv(series_id: str, seed: float, *, months: int = 156) -> str:
    """월별 합성 fredgraph CSV — 시드 기반 결정적(sin+노이즈), 10년 창 충족."""
    rng = random.Random(hash(series_id) % 10_000)
    total_end = _END[0] * 12 + _END[1]
    lines = [f"observation_date,{series_id}"]
    for k in range(months):
        month_total = total_end - (months - 1) + k
        year, month = divmod(month_total - 1, 12)
        value = 50.0 + 12.0 * math.sin(k / 5.0 + seed) + rng.uniform(-2.0, 2.0)
        lines.append(f"{year:04d}-{month + 1:02d}-01,{value:.6f}")
    return "\n".join(lines) + "\n"


def _stooq_csv(seed: float, *, months: int = 156) -> str:
    """일별(월 3관측) 합성 stooq CSV — Date,Close, 양수 복리 경로."""
    rng = random.Random(int(seed) * 7 + 1)
    total_end = _END[0] * 12 + _END[1]
    lines = ["Date,Close"]
    price = 100.0
    for k in range(months):
        month_total = total_end - (months - 1) + k
        year, month = divmod(month_total - 1, 12)
        for day in (1, 15, calendar_month_end(year, month + 1)):
            price *= 1.0 + 0.004 + 0.006 * math.sin(k / 7.0 + seed) + rng.uniform(-0.004, 0.004)
            lines.append(f"{date(year, month + 1, day).isoformat()},{price:.4f}")
    return "\n".join(lines) + "\n"


def calendar_month_end(year: int, month: int) -> int:
    import calendar as _calendar

    return _calendar.monthrange(year, month)[1]


class RunPipelineFixtureModeTests(unittest.TestCase):
    """합성 전체 커버리지 fixture → state.json + 백테스트 3전략 산출(실적 경로 재현)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        root = Path(cls._tmp.name)
        cls.fixtures = root / "fixtures"
        cls.fixtures.mkdir()
        for index, ind in enumerate(INDICATOR_DEFS):
            for key in ind.ids:  # ⑥ — 후보 ID 전부(목: NASDAQCOM+SP500 폴백 포함)
                (cls.fixtures / f"fredgraph_{key}.csv").write_text(
                    _fred_csv(key, 0.7 * index + 0.5), encoding="utf-8"
                )
        # ⑥: 프록시는 FRED 우선(indicator fixture 공용) — stooq 폴백 파일 작성 불필요.
        (cls.fixtures / "fredgraph_DTB3.csv").write_text(
            _fred_csv("DTB3", 8.5), encoding="utf-8"
        )  # DTB3는 지표가 아닌 수 레그 전용 프록시 — 별도 작성 필요
        cls.state_path = root / "state.json"
        cls.out_dir = root / "out"
        cls.rc = run_pipeline.main(
            [
                "--fixtures", str(cls.fixtures),
                "--state-path", str(cls.state_path),
                "--out-dir", str(cls.out_dir),
            ]
        )
        cls.state = json.loads(cls.state_path.read_text(encoding="utf-8"))
        cls.backtest = json.loads((cls.out_dir / "backtest.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_exit_zero_and_state_schema_valid(self) -> None:
        self.assertEqual(self.rc, 0)
        self.assertEqual(report.validate_state(self.state), [])

    def test_element_scores_fully_populated(self) -> None:
        scores_row = self.state["element_scores"]
        for el in ELEMENTS:
            with self.subTest(element=el):
                value = scores_row[el]
                self.assertIsInstance(value, (int, float))
                self.assertGreaterEqual(value, 0)
                self.assertLessEqual(value, 100)

    def test_regime_consistent_with_target_and_proposals(self) -> None:
        regime = self.state["regime"]
        target = self.state["target_allocation"]
        proposals = self.state["rebalance_proposals"]
        if regime is None:
            self.assertIsNone(target)
            self.assertEqual(proposals, [])
            return
        self.assertIn(regime, REGIME_ALLOCATIONS)
        self.assertEqual(target, REGIME_ALLOCATIONS[regime])
        self.assertEqual(len(proposals), len(ELEMENTS))
        total = sum(row["target_pct"] for row in proposals)
        self.assertAlmostEqual(total, 100.0, places=6)
        for row in proposals:
            self.assertEqual(set(row), {"element", "basis_pct", "target_pct", "delta_pct"})
            self.assertAlmostEqual(
                row["delta_pct"], row["target_pct"] - row["basis_pct"], places=6
            )

    def test_backtest_three_strategies_written(self) -> None:
        strategies = self.backtest["strategies"]
        self.assertEqual(
            set(strategies),
            {"regime_shift", "baseline_60_40", "baseline_fixed_elements"},
        )
        months = self.backtest["window"]["months"]
        self.assertGreaterEqual(months, 100, "13년 합성 정렬 월 수 기대(≥100)")
        for name, result in strategies.items():
            with self.subTest(strategy=name):
                self.assertEqual(result["months"], months)
                self.assertGreater(result["trading_costs"], 0.0)  # 초기 취득 비용 포함
                self.assertGreaterEqual(result["mdd"], 0.0)
                self.assertLess(result["mdd"], 1.0)
                self.assertEqual(len(result["navs"]), months)

    def test_crisis_defense_2020_03_computed(self) -> None:
        for name, result in self.backtest["strategies"].items():
            with self.subTest(strategy=name):
                self.assertIn("2020-03", result["crisis_defense"])

    def test_proxies_chosen_with_fallback_priority(self) -> None:
        self.assertEqual(
            self.backtest["asset_proxies"],
            {
                "목": "NASDAQCOM",   # FRED 우선(⑥)
                "화": "DCOILWTICO",
                "토": "CSUSHPINSA",
                "금": "DGS10",       # 듀레이션 근사 총수익
                "수": "DTB3",
            },
        )

    def test_markdown_report_written(self) -> None:
        md = (self.out_dir / "backtest.md").read_text(encoding="utf-8")
        for fragment in ("국면", "프록시 한계", "MDD", "거래비용", "수익 우위 필수 아님"):
            self.assertIn(fragment, md)


class RunPipelineSparseFixtureTests(unittest.TestCase):
    """부족 fixture → 국면 null + 사유(AC2) · 백테스트 레그 스킵(WARN 사유)."""

    def test_sparse_fixtures_produce_null_regime_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_name:
            root = Path(tmp_name)
            fixtures = root / "fixtures"
            fixtures.mkdir()
            # UNRATE 12관측(1년) — 10년 rolling percentile 창 미달 → 전 구간 None
            lines = ["observation_date,UNRATE"]
            for month in range(1, 13):
                lines.append(f"2024-{month:02d}-01,{35.0 + month}")
            (fixtures / "fredgraph_UNRATE_2024.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")

            state_path = root / "state.json"
            out_dir = root / "out"
            rc = run_pipeline.main(
                ["--fixtures", str(fixtures), "--state-path", str(state_path), "--out-dir", str(out_dir)]
            )
            self.assertEqual(rc, 0)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(report.validate_state(state), [])
            self.assertIsNone(state["regime"], "데이터 부족은 국면 강제 매칭 금지(req-v2 §2)")
            self.assertIsNone(state["target_allocation"])
            self.assertEqual(state["rebalance_proposals"], [])
            self.assertTrue(
                any(("부족" in reason or "미제공" in reason) for reason in state["regime_reasons"]),
                f"부족 사유 행 필요: {state['regime_reasons']}",
            )
            self.assertFalse((out_dir / "backtest.json").exists(), "프록시 부족 → 백테스트 스킵")


class RunPipelineUnitTests(unittest.TestCase):
    """build_report_state 단독 계약 — 결정적 지수 그리드로 국면 A 경로 고정."""

    def test_declining_growth_resolves_regime_a_with_proposals(self) -> None:
        months = ["2024-06", "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12"]
        # 목 91→85 하락(E 규칙 '목 6개월 상승' 탈락) · 수≥50(A 충족) · 화<60·토<55·금≥50
        # → 우선순위 충돌 없이 A만 충족(D>B>E>A>C 중 D·B·E 불충족, C 불충족).
        by_element = {
            "목": [91, 90, 89, 88, 87, 86, 85],
            "화": [50, 50, 50, 50, 50, 50, 50],
            "토": [40, 40, 40, 40, 40, 40, 40],
            "금": [70, 70, 70, 70, 70, 70, 70],
            "수": [55, 55, 55, 55, 55, 55, 55],
        }
        state = run_pipeline.build_report_state(grid=months, by_element=by_element, notes=[])
        self.assertEqual(state["regime"], "A")
        self.assertEqual(state["target_allocation"], REGIME_ALLOCATIONS["A"])
        proposals = state["rebalance_proposals"]
        self.assertEqual(proposals[0]["element"], "목")
        self.assertAlmostEqual(proposals[0]["delta_pct"], 8.0, places=6)
        self.assertEqual(report.validate_state(state), [])

    def test_state_to_json_serializes_generated_at_iso(self) -> None:
        from datetime import datetime as _dt, timezone as _tz

        state = report.build_state(
            generated_at=_dt(2026, 11, 3, tzinfo=_tz.utc),
            element_scores={el: float(i) for i, el in enumerate([*ELEMENTS], start=10)},
            regime=None,
            regime_reasons=["부족 사유"],
        )
        text = run_pipeline.state_to_json(state)
        self.assertIn('"generated_at": "2026-11-03T00:00:00+00:00"', text)


class RunPipelineDailyWindowTests(unittest.TestCase):
    """ISSUE-1 회귀 — 일간 시리즈는 주기별 창(scores.window_count_for → 2530)을 쓴다.

    QA 리포트 §7 ISSUE-1: 구 파이프라인은 모든 지표를 DEFAULT(120)로 표준화했다 —
    일간 지표는 "최근 약 6개월" 창이 되어 국면이 전도될 수 있다(2026-11 실측: B→D 전도).
    """

    def test_daily_indicator_uses_frequency_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_name:
            root = Path(tmp_name)
            fixtures = root / "fixtures"
            fixtures.mkdir()
            # 지표 계약: NASDAQCOM은 yoy 파생(1년 전=358일 앵커) → 결측 358일 후 유효 시작.
            # 유효 관측이 10년 창(2530)을 채우려면 n ≥ 358+2530 → 2950관측 사용.
            n = 2950
            lines = ["observation_date,NASDAQCOM"]
            value = 100.0
            closes: list[float] = []
            for k in range(n):
                day = date(2018, 1, 1) + timedelta(days=k)
                value *= 1.0 + 0.0004 + 0.0004 * math.sin(k / 11.0)
                closes.append(value)
                lines.append(f"{day.isoformat()},{value:.6f}")
            # 독립 기대값 계산 — yoy(≈358일 앵커, 연속 날짜) → 유효 시퀀스 → percentile
            valid = [
                100.0 * (closes[i] / closes[i - 358] - 1.0)
                for i in range(358, n)
            ]
            expected = 100.0 * sum(1 for x in valid[-2530:] if x <= valid[-1]) / 2530
            expected_uniform120 = (
                100.0 * sum(1 for x in valid[-120:] if x <= valid[-1]) / 120
            )
            self.assertNotAlmostEqual(
                expected,
                expected_uniform120,
                delta=5.0,
                msg="테스트 디자인 — 주기별 창(2530)과 uniform-120 값이 달라야 회귀 검증이 의미 있다",
            )
            notes: list[str] = []
            loader = run_pipeline.make_fixture_loader(fixtures, notes)
            (fixtures / "fredgraph_NASDAQCOM.csv").write_text(
                "\n".join(lines) + "\n", encoding="utf-8"
            )
            standardized = run_pipeline.collect_standardized(loader, notes)
            def_nasdaq = next(
                ind for ind in INDICATOR_DEFS if ind.ids[0] == "NASDAQCOM"
            )
            self.assertIn(def_nasdaq, standardized)
            got_last = standardized[def_nasdaq][-1][1]
            self.assertAlmostEqual(
                got_last,
                expected,
                places=6,
                msg="일간 시리즈의 마지막 percentile은 2530 창 계산과 일치해야 한다(구 창 120 아님)",
            )

    def test_tiny_series_falls_back_and_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_name:
            root = Path(tmp_name)
            fixtures = root / "fixtures"
            fixtures.mkdir()
            loader = run_pipeline.make_fixture_loader(fixtures, (notes := []))
            (fixtures / "fredgraph_AB2M.csv").write_text(
                "observation_date,AB2M\n2024-01-01,1.0\n2024-02-01,2.0\n",
                encoding="utf-8",
            )
            fake_def = next(iter(INDICATOR_DEFS))
            # 2관측 시리즈 — 주기 추정 불가 → 기본 창 폴백 + 사유 기록(전 구간 None)
            import unittest.mock as mock

            with mock.patch.object(
                run_pipeline.indicators,
                "INDICATOR_DEFS",
                (run_pipeline.indicators.IndicatorDef(
                    fake_def.element, "2관측 테스트", "fred", ("AB2M",), "level", False
                ),),
            ):
                standardized = run_pipeline.collect_standardized(loader, notes)
                self.assertTrue(
                    any("주기 추정 불가" in note for note in notes),
                    f"폴백 사유 기록 필요: {notes}",
                )
                def_two = next(d for d in standardized)
                self.assertTrue(all(pct is None for _, pct in standardized[def_two]))


if __name__ == "__main__":
    unittest.main()