"""FEAAS v2a 골격 계약 테스트 (req docs/requirements-v2.md §1).

티켓 ① 스코프: 6모듈 import 성공·핵심 순수 함수 시그니처 존재(타입힌트)·stub 본문
(NotImplementedError)·배치 진입점 stub·FRED fredgraph.csv 포맷 fixture(2개 이상).
함수 본문 구현은 계층 ②③ 티켓이 채운다 — 본 테스트는 계약만 고정한다.
"""

from __future__ import annotations

import dataclasses
import inspect
import re
import sys
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

FIXTURES_DIR = ENGINE_DIR / "data" / "fixtures"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# (모듈, 함수명, 필수 인자 개수) — 골격 계약: 존재·callable·(아직 stub이면)NotImplementedError.
# ②에서 구현이 채워진 모듈(sources)은 stub 본문 검사에서 제외 — 계층 테스트가 계약을 인수받았다.
STUB_FUNCTIONS: dict[str, list[tuple[str, int]]] = {
    "feaas.classifier": [
        ("detect_regime", 1),
        ("regime_reasons", 1),
    ],
    "feaas.backtest": [
        ("compound", 1),
        ("annualized_return", 2),
        ("annualized_vol", 1),
        ("sharpe_ratio", 1),
        ("max_drawdown", 1),
        ("crisis_defense", 2),
        ("run_backtest", 2),
    ],
    "feaas.report": [
        ("build_state", 0),
        ("validate_state", 1),
    ],
}

MIN_IMPORTS = (
    "feaas",
    "feaas.sources",
    "feaas.indicators",
    "feaas.scores",
    "feaas.classifier",
    "feaas.backtest",
    "feaas.report",
)


class SkeletonImportContract(unittest.TestCase):
    """수용기준: feaas 6모듈 import 성공(venv에서)."""

    def test_six_modules_and_package_import(self) -> None:
        import importlib

        for name in MIN_IMPORTS:
            with self.subTest(module=name):
                module = importlib.import_module(name)
                self.assertTrue(module.__doc__, f"{name} 의 문서 문자열이 비어있다")

    def test_run_pipeline_stub_importable(self) -> None:
        import importlib

        run_pipeline = importlib.import_module("run_pipeline")
        self.assertTrue(callable(run_pipeline.main))
        self.assertIn("README", inspect.getdoc(run_pipeline) or "")


class SkeletonSignatureContract(unittest.TestCase):
    """골격 계약: 핵심 순수 함수가 존재하고 callable이며 타입힌트를 갖는다."""

    def test_stub_functions_exist_with_annotations(self) -> None:
        for modname, funcs in STUB_FUNCTIONS.items():
            module = __import__(modname, fromlist=[""])
            for fname, min_args in funcs:
                with self.subTest(f"{modname}.{fname}"):
                    fn = getattr(module, fname)
                    self.assertTrue(callable(fn))
                    sig = inspect.signature(fn)
                    self.assertGreaterEqual(len(sig.parameters), min_args)
                    self.assertTrue(
                        sig.parameters or sig.return_annotation is not inspect.Signature.empty,
                        f"{modname}.{fname} 타입힌트 부재",
                    )
                    annotated = any(
                        p.annotation is not inspect.Parameter.empty for p in sig.parameters.values()
                    ) or sig.return_annotation is not inspect.Signature.empty
                    self.assertTrue(annotated, f"{modname}.{fname}은 최소 1개 타입힌트 필요")

    def test_backtest_result_dataclass_fields(self) -> None:
        import feaas.backtest as backtest

        self.assertTrue(dataclasses.is_dataclass(backtest.BacktestResult))
        names = {f.name for f in dataclasses.fields(backtest.BacktestResult)}
        self.assertLessEqual(
            {"cagr", "vol", "mdd", "sharpe", "trading_costs"}, names
        )

    def test_indicator_def_dataclass_fields(self) -> None:
        import feaas.indicators as indicators

        self.assertTrue(dataclasses.is_dataclass(indicators.IndicatorDef))
        names = {f.name for f in dataclasses.fields(indicators.IndicatorDef)}
        self.assertLessEqual({"element", "name", "ids", "inverse"}, names)


class SkeletonStubBodyContract(unittest.TestCase):
    """stub 본문: 본문 구현 전까지 NotImplementedError — ②③이 채운 뒤 이 테스트는 갱신/삭제."""

    def test_pure_stub_functions_raise_not_implemented(self) -> None:
        import feaas.sources as sources
        import feaas.indicators as indicators
        import feaas.scores as scores
        import feaas.classifier as classifier
        import feaas.backtest as backtest
        import feaas.report as report

        calls: list[tuple[str, object, tuple]] = [
            ("classifier.detect_regime", classifier.detect_regime, ({"목": 65.0},)),
            ("classifier.regime_reasons", classifier.regime_reasons, ({"목": 65.0},)),
            ("backtest.compound", backtest.compound, ((0.01, -0.01),)),
            ("backtest.annualized_return", backtest.annualized_return, (0.1, 12)),
            ("backtest.annualized_vol", backtest.annualized_vol, ((0.01, 0.02),)),
            ("backtest.sharpe_ratio", backtest.sharpe_ratio, ((0.01, 0.02),)),
            ("backtest.max_drawdown", backtest.max_drawdown, ((100.0, 90.0, 105.0),)),
            (
                "backtest.crisis_defense",
                backtest.crisis_defense,
                ({"2008": ("2020-01-01", "2020-03-01")},),
                {},
            ),
            (
                "backtest.run_backtest",
                backtest.run_backtest,
                (({"목": 100.0},),),
                {},
            ),
            ("report.validate_state", report.validate_state, (dict(),)),
        ]
        for item in calls:
            if len(item) == 3:
                label, fn, args = item  # type: ignore[misc]
                kwargs: dict = {}
            else:
                label, fn, args, kwargs = item  # type: ignore[misc]
            with self.subTest(label=label):
                with self.assertRaises(NotImplementedError) as ctx:
                    fn(*args, **kwargs)
                self.assertTrue(str(ctx.exception), "예외 메시지는 후속 티켓 지시를 담는다")

    def test_run_pipeline_main_stub_raises(self) -> None:
        import run_pipeline

        with self.assertRaises(NotImplementedError):
            run_pipeline.main()


class FixtureFormatContract(unittest.TestCase):
    """수용기준: fixture CSV 존재·포맷 README 명시 — FRED fredgraph.csv 실측 포맷 2개 이상."""

    def test_at_least_two_fixtures_exist(self) -> None:
        csvs = sorted(FIXTURES_DIR.glob("*.csv"))
        self.assertGreaterEqual(
            len(csvs), 2, f"fixture 2개 이상 필요: {[p.name for p in csvs]}"
        )

    def test_fixture_fred_graph_csv_format(self) -> None:
        """헤더 DATE/<ID> 또는 실측 observation_date/<ID> · 결측 '.' 또는 빈칸 · 날짜 정규형."""
        csvs = sorted(FIXTURES_DIR.glob("fredgraph_*.csv"))
        self.assertGreaterEqual(len(csvs), 2)
        missing_seen = False
        for path in csvs:
            with self.subTest(fixture=path.name):
                lines = path.read_text(encoding="utf-8").strip().splitlines()
                self.assertGreaterEqual(len(lines), 2, f"{path.name}: 데이터 행 부족")
                header = lines[0].split(",")
                self.assertEqual(2, len(header), f"{path.name}:fredgraph 포맷은 2열")
                date_col, series_col = header
                self.assertIn(date_col, {"DATE", "observation_date"})
                self.assertRegex(series_col, r"^[A-Z0-9_]+$", msg=f"{path.name}: 시리즈 ID 대문자")
                for line in lines[1:]:
                    fields = line.split(",")
                    self.assertEqual(2, len(fields), f"{path.name}: {line}")
                    d, v = fields
                    self.assertRegex(d, r"\d{4}-\d{2}-\d{2}")
                    if v == "" or v == ".":
                        missing_seen = True
                    else:
                        float(v)  # ValueError → 포맷 계약 실패
        self.assertTrue(missing_seen, "결측 셀('.' 또는 빈칸) 샘플이 1건 이상 필요")


if __name__ == "__main__":
    unittest.main()