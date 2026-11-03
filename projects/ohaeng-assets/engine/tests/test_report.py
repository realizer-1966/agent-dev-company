"""FEAAS v2a ③ report 계층 테스트 — req-v2 §4·§5-5 (state.json 스키마 본문 계약).

스키마 키는 골격(STATE_SCHEMA_FIELDS) 고정: {생성시각, 지수 5종, 국면, 판정 근거,
목표 배분, 제안 리밸런싱, 프록시 한계 고지} — snake_case 매핑은 README v2a ③ 섹션.
validate_state는 예외 대신 오류 메시지 list를 반환한다(빈 list = 유효) — 파이프라인이
조용한 무결성 위반을 낼 수 없게 하는 req 9장 전통(상태 오염 방지).
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.report as report


def valid_state(**overrides: object) -> dict[str, object]:
    """스키마 완전 state — 각 테스트에서 1필드만 오염시키는 기준선."""
    base: dict[str, object] = {
        "generated_at": datetime(2026, 11, 3, 1, 30, tzinfo=timezone.utc),
        "element_scores": {"목": 62.0, "화": 48.0, "토": 30.0, "금": 55.0, "수": 51.0},
        "regime": "A",
        "regime_reasons": [r"목=62(≥60) 且 수=51(≥50) → A 일치"],
        "target_allocation": {"목": 38.0, "화": 6.0, "토": 16.0, "금": 25.0, "수": 15.0},
        "rebalance_proposals": [
            {"element": "목", "basis_pct": 30.0, "target_pct": 38.0, "delta_pct": 8.0},
            {"element": "화", "basis_pct": 10.0, "target_pct": 6.0, "delta_pct": -4.0},
        ],
        "proxy_note": "프록시 한계 고지(예시)",
    }
    base.update(overrides)
    return base


class BuildStateShapeTests(unittest.TestCase):
    """req-v2 §4 스키마 그대로 — 7필드·키 완전·기본 생성시각."""

    def test_full_state_has_exactly_schema_fields(self) -> None:
        st = report.build_state(**valid_state())
        self.assertEqual(set(st.keys()), set(report.STATE_SCHEMA_FIELDS))
        self.assertEqual(st["regime"], "A")
        self.assertEqual(st["element_scores"]["목"], 62.0)
        self.assertEqual(len(st["rebalance_proposals"]), 2)

    def test_generated_at_default_is_utc_now_aware(self) -> None:
        before = datetime.now(timezone.utc)
        payload = valid_state()
        payload.pop("generated_at")  # 기본값 경로 검증 — 명시 생성시각 제거
        st = report.build_state(**payload)
        after = datetime.now(timezone.utc)
        gen = st["generated_at"]
        assert isinstance(gen, datetime)
        self.assertTrue(gen.tzinfo is not None, "생성시각은 tz-aware(UTC)")
        self.assertGreaterEqual(gen, before)
        self.assertLessEqual(gen, after)

    def test_null_regime_carries_reasons_and_null_target(self) -> None:
        # 데이터 부족 경로 — 국면 null + 사유 + 목표 배분 null(강제 매칭 금지, req §2).
        st = report.build_state(
            generated_at=datetime(2026, 11, 3, tzinfo=timezone.utc),
            element_scores={"목": 62.0, "화": None, "토": None, "금": None, "수": None},
            regime=None,
            regime_reasons=["부족 지표(현재 미제공): 화·토·금·수"],
            target_allocation=None,
            rebalance_proposals=[],
        )
        self.assertIsNone(st["regime"])
        self.assertIsNone(st["target_allocation"])
        self.assertEqual(st["rebalance_proposals"], [])
        self.assertEqual(report.validate_state(st), [])

    def test_is_pure_no_file_write(self) -> None:
        # build_state는 파일을 만들지 않는다(순수 구성 — 쓰기는 run_pipeline 책임).
        st = report.build_state(**valid_state())
        self.assertIsInstance(st, dict)


class ValidateStateTests(unittest.TestCase):
    """빈 list = 유효 · 오류 메시지 list = 무효 — 예외 대신 메시지(계약)."""

    def test_valid_state_passes_with_empty_errors(self) -> None:
        self.assertEqual(report.validate_state(report.build_state(**valid_state())), [])

    def test_missing_field_reports_field_name(self) -> None:
        st = report.build_state(**valid_state())
        del st["regime_reasons"]  # type: ignore[operator]
        errors = report.validate_state(st)
        self.assertTrue(any("regime_reasons" in e for e in errors))

    def test_unknown_field_reports(self) -> None:
        st = report.build_state(**valid_state())
        st["surprise"] = 1  # type: ignore[assignment]
        self.assertTrue(any("surprise" in e for e in report.validate_state(st)))

    def test_generated_at_unparseable_rejected(self) -> None:
        errors = report.validate_state(report.build_state(**valid_state(generated_at="not-a-date")))
        self.assertTrue(any("generated_at" in e for e in errors))

    def test_element_scores_contract(self) -> None:
        wrong_keys = report.build_state(**valid_state(element_scores={"목": 50.0}))
        self.assertTrue(any("element_scores" in e for e in report.validate_state(wrong_keys)))
        out_of_range = report.build_state(
            **valid_state(element_scores={"목": 101.0, "화": 50.0, "토": 50.0, "금": 50.0, "수": 50.0})
        )
        self.assertTrue(any("element_scores" in e for e in report.validate_state(out_of_range)))
        with_null_ok: dict[str, object] = {"목": None, "화": 50.0, "토": 50.0, "금": 50.0, "수": 50.0}
        st = report.build_state(**valid_state(element_scores=with_null_ok))
        self.assertEqual(report.validate_state(st), [])
        non_numeric = report.build_state(
            **valid_state(element_scores={"목": "六十", "화": 50.0, "토": 50.0, "금": 50.0, "수": 50.0})
        )
        self.assertTrue(any("element_scores" in e for e in report.validate_state(non_numeric)))

    def test_regime_labels_contract(self) -> None:
        for bad in ("F", "a", 3.0):
            with self.subTest(bad=bad):
                st = report.build_state(**valid_state(regime=bad))
                self.assertTrue(any("regime" in e for e in report.validate_state(st)))

    def test_target_allocation_sum_and_keys(self) -> None:
        bad_sum = report.build_state(
            **valid_state(
                target_allocation={"목": 50.0, "화": 50.0, "토": 50.0, "금": 25.0, "수": 15.0}
            )
        )
        self.assertTrue(any("target_allocation" in e for e in report.validate_state(bad_sum)))
        bad_keys = report.build_state(
            **valid_state(target_allocation={"목": 100.0})
        )
        self.assertTrue(any("target_allocation" in e for e in report.validate_state(bad_keys)))
        negative = report.build_state(
            **valid_state(
                target_allocation={"목": 110.0, "화": -10.0, "토": 0.0, "금": 0.0, "수": 0.0}
            )
        )
        self.assertTrue(any("target_allocation" in e for e in report.validate_state(negative)))

    def test_rebalance_proposals_row_contract(self) -> None:
        bad_row = report.build_state(
            **valid_state(rebalance_proposals=[{"element": "우주", "basis_pct": 0.0, "target_pct": 0.0, "delta_pct": 0.0}])
        )
        self.assertTrue(any("rebalance_proposals" in e for e in report.validate_state(bad_row)))
        missing_key_row = report.build_state(
            **valid_state(rebalance_proposals=[{"element": "목", "delta_pct": 8.0}])
        )
        self.assertTrue(any("rebalance_proposals" in e for e in report.validate_state(missing_key_row)))
        non_list = report.build_state(**valid_state(rebalance_proposals="none"))
        self.assertTrue(any("rebalance_proposals" in e for e in report.validate_state(non_list)))

    def test_proxy_note_must_be_nonempty_string(self) -> None:
        st = report.build_state(**valid_state(proxy_note=""))
        self.assertTrue(any("proxy_note" in e for e in report.validate_state(st)))
        self.assertTrue(any("proxy_note" in e for e in report.validate_state(report.build_state(**valid_state(proxy_note=42)))))


class ValidationIsTotalTests(unittest.TestCase):
    """validate_state는 어떤 입력에도 예외를 던지지 않는다(전체 방어 — 회귀 방지 계약)."""

    def test_never_raises_on_garbage(self) -> None:
        garbage: list[object] = [
            None,
            42,
            "state",
            {},
            {"generated_at": None},
            {"element_scores": None, "regime": None, "regime_reasons": None,
             "target_allocation": None, "rebalance_proposals": None, "proxy_note": None},
        ]
        for g in garbage:
            with self.subTest(g=type(g).__name__):
                try:
                    report.validate_state(g)  # type: ignore[arg-type]
                except Exception as exc:  # noqa: BLE001 — 계약 위반 그 자체가 실패
                    self.fail(f"validate_state는 예외 대신 메시지 list: {exc!r}")


if __name__ == "__main__":
    unittest.main()