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
from datetime import date
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
            (cls.fixtures / f"fredgraph_{ind.ids[0]}.csv").write_text(
                _fred_csv(ind.ids[0], 0.7 * index + 0.5), encoding="utf-8"
            )
        for filename, seed in (
            ("stooq_spx.csv", 1.0),       # 목 지표(^spx yoy) + 백테스트 목 프록시 공용
            ("stooq_cl_f.csv", 2.0),      # 화(cl.f — gld.us 폴백 미발동)
            ("stooq_vnq_us.csv", 3.0),    # 토
            ("stooq_iet_us.csv", 4.0),    # 금
            ("stooq_gld_us.csv", 5.0),    # 폴백 프록시(채택되지 않아야 함)
        ):
            (cls.fixtures / filename).write_text(_stooq_csv(seed), encoding="utf-8")
        (cls.fixtures / "fredgraph_DTB3.csv").write_text(_fred_csv("DTB3", 8.5), encoding="utf-8")
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
            {"목": "^spx", "화": "cl.f", "토": "vnq.us", "금": "iet.us", "수": "DTB3"},
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


if __name__ == "__main__":
    unittest.main()