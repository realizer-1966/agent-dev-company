"""FEAAS v2a ② indicators(지표 정의서) 계층 테스트 — req-v2 §2 표 확정 고정.

req §2의 '초기 매핑(PM 확정)'을 실측 가능성 기준(2026-11-02 fredgraph.csv 실측)으로
확정한 결과를 표로 고정한다. 확정 근거·기각 사유는 docs/indicator-map.md.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.indicators as indicators

# (element, name, source, ids, transform, inverse) — req-v2 §2 표 → ② 확정(§ 실측 근거 문서)
EXPECTED_ROWS: list[tuple[str, str, str, tuple[str, ...], str, bool]] = [
    ("목", "실질 GDP 성장", "fred", ("GDPC1",), "qoq", False),
    ("목", "비농업 고용", "fred", ("PAYEMS",), "yoy", False),
    ("목", "실업률", "fred", ("UNRATE",), "level", True),
    ("목", "S&P 500", "stooq", ("^spx",), "yoy", False),
    ("화", "소비자물가", "fred", ("CPIAUCSL",), "yoy", False),
    ("화", "생산자물가", "fred", ("PPIACO",), "yoy", False),
    ("화", "손익분기 인플레", "fred", ("T10YIE",), "level", False),
    ("화", "WTI 유가", "fred", ("DCOILWTICO",), "1y_change", False),
    ("토", "주택 가격", "fred", ("CSUSHPINSA",), "yoy", False),
    ("토", "주택 착공", "fred", ("HOUST",), "level", False),
    ("토", "주택 임대 프록시", "fred", ("CUSR0000SEHA",), "yoy", False),
    ("금", "신용 스프레드 프록시", "fred", ("DBAA",), "level", True),
    ("금", "변동성 지수", "fred", ("VIXCLS",), "level", True),
    ("금", "채권 수익률", "fred", ("DGS10",), "level", False),
    ("수", "M2 통화", "fred", ("M2SL",), "yoy", False),
    ("수", "달러 인덱스", "fred", ("DTWEXBGS",), "level", False),
    ("수", "단기 금리", "fred", ("SOFR",), "level", True),
]
EXPECTED_COUNTS = {"목": 4, "화": 4, "토": 3, "금": 3, "수": 3}


class TableDefinitionTests(unittest.TestCase):
    """req §2 표를 시작점으로 실측 가능성 기준으로 확정한 매핑 표 — 전면 고정."""

    def test_table_matches_confirmed_spec(self) -> None:
        actual = {
            (d.element, d.source, d.ids, d.transform, d.inverse)
            for d in indicators.INDICATOR_DEFS
        }
        expected = {(row[0], row[2], row[3], row[4], row[5]) for row in EXPECTED_ROWS}
        self.assertEqual(actual, expected, "확정 매핑 표와 불일치")

    def test_row_count(self) -> None:
        self.assertEqual(len(indicators.INDICATOR_DEFS), len(EXPECTED_ROWS), 17)

    def test_element_distribution(self) -> None:
        counts: dict[str, int] = {}
        for d in indicators.INDICATOR_DEFS:
            counts[d.element] = counts.get(d.element, 0) + 1
        self.assertEqual(counts, EXPECTED_COUNTS)
        self.assertEqual(set(counts), set(indicators.ELEMENTS), "5오행 전부 대표")

    def test_field_domains(self) -> None:
        for d in indicators.INDICATOR_DEFS:
            with self.subTest(f"{d.element}:{d.ids}"):
                self.assertIn(d.source, {"fred", "stooq"})
                self.assertIn(
                    d.transform,
                    {"level", "yoy", "qoq", "1y_change"},
                    "req-v2 §5-1파생 유형 계약",
                )
                self.assertIsInstance(d.inverse, bool)
                self.assertTrue(d.ids and all(d.ids), "ID/심볼 비어있으면 안 된다")
                self.assertTrue(d.name, "사람이 읽는 지표명 필요")

    def test_unique_mapping_rows(self) -> None:
        keys = [(d.source, d.ids, d.transform) for d in indicators.INDICATOR_DEFS]
        self.assertEqual(len(set(keys)), len(keys), "동일 (소스,ID,파생) 중복 금지")

    def test_fred_ids_uppercase_format(self) -> None:
        import re

        for d in indicators.INDICATOR_DEFS:
            if d.source == "fred":
                with self.subTest(d.ids):
                    for series_id in d.ids:
                        self.assertRegex(series_id, r"^[A-Z0-9_]+$")

    def test_inverse_flags_per_req(self) -> None:
        inverse_ids = {d.ids[0] for d in indicators.INDICATOR_DEFS if d.inverse}
        self.assertEqual(
            inverse_ids,
            {"UNRATE", "DBAA", "VIXCLS", "SOFR"},
            "역방향 지표 4종(req §2 — BAML 슬롯은 DBAA 대체)",
        )


class IndicatorsForQueries(unittest.TestCase):
    def test_each_element_returns_its_defs(self) -> None:
        for d in indicators.INDICATOR_DEFS:
            with self.subTest(f"{d.element}:{d.ids}"):
                self.assertIn(d, indicators.indicators_for(d.element))

    def test_returns_only_requested_element(self) -> None:
        for element in indicators.ELEMENTS:
            got = indicators.indicators_for(element)
            self.assertEqual(len(got), EXPECTED_COUNTS[element])
            self.assertTrue(all(d.element == element for d in got))

    def test_unknown_element_raises(self) -> None:
        for bad in ("땅", "", "wood", "木 木"):
            with self.subTest(bad):
                with self.assertRaises(ValueError):
                    indicators.indicators_for(bad)


if __name__ == "__main__":
    unittest.main()