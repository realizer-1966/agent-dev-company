"""FEAAS v2a ③ classifier(국면 판정) 계층 테스트 — req-v2 §2·§5-2 (수용기준 2).

PM 확정 규칙(카드 t_55b34df2 — 요구사항 §2 초안 + PM 확정분):
- A = 목≥60 且 수≥50 ; B = 화≥60 且 (금<50 或 화−금≥10) ; C = 토≥55 且 화<60 且 금≥50
- D = 금<50 且 (수<40 或 수↑) ; E = 수≥45 且 목 6개월 전 대비 상승
- 충돌 우선순위 D > B > E > A > C.
- '수↑'·'목 6개월 전 상승' = 현재값 − 6개월 전값 > 0 (동일 규격·6개월 전 = history[-6]).
- '화−금≥10' = 지수 차 ≥ 10점.
- 판정 입력 ≥2 오행 지수(단일 지표 판정 금지). 부족 → 국면 None + 사유(부족 지표 명기) —
  강제 매칭 금지: 규칙 조건 중 판정 불가(부족)가 있고 그 규칙이 남은 규칙보다
  우선순위가 높으면 이후 규칙으로 강제 내려가지 않는다.

경계 고정(리뷰어 지시 2026-11-02): A 목59/60×수49/50, B 화59/60·금49/50·화−금9.99/10,
C 토54/55·화59/60·금49/50, D 금49/50·수39/40, E 수44/45·목 6개월 변화 ±/0.

**strict-null 정책(강제 매칭 금지 — 구현·문서 고정)**: 판정 순회(D>B>E>A>C)에서 규칙이
UNKNOWN(지수 부족·이력 부족)이면 즉시 null — 하위 규칙으로 내려가지 않는다. 따라서
이력/지수를 제공하지 않은 채 하위 규칙(A·B·C) 경계만 검증하는 테스트는 평탄 6개월 이력을
명시적으로 동봉해야 한다(빈 이력 → E·D 판정 불가가 최우선이라 null). 2요소 입력은 허용되며,
상위 규칙이 완전 충족(예: D — 금<50 且 수<40)이면 판정이 결정된다.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import feaas.classifier as classifier

# 관측 부족(수<45)·비충족 기저 — 5오행 모두 있고 어떤 규칙도 TRUE가 아닌 기준 상태.
# 목50·화50·토50·금50·수40: A목<60 F·B화<60 F·C토<55 F·D금<50 F·E수<45 F.
NEUTRAL: dict[str, float] = {"목": 50.0, "화": 50.0, "토": 50.0, "금": 50.0, "수": 40.0}


def over(overrides: dict[str, float]) -> dict[str, float]:
    """NEUTRAL 기준 상태에 조건값을 얹은 지수 5종."""
    state = dict(NEUTRAL)
    state.update(overrides)
    return state


def hist(entry: dict[str, float], n: int = 6) -> list[dict[str, float]]:
    """'6개월 전' 테스트용 이력 — 같은 상태 n개월 반복(flat)."""
    return [dict(entry) for _ in range(n)]


class RegimeATests(unittest.TestCase):
    """A = 목≥60 且 수≥50 — 경계 60·50 포함(inclusive)."""

    def test_a_at_exact_boundaries(self) -> None:
        # strict-null: 이력 미제공 → E(목 상승) 판정 불가가 A보다 우선 — 평탄 이력으로 동봉.
        state = over({"목": 60.0, "수": 50.0})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "A")

    def test_a_without_history_is_blocked(self) -> None:
        # 이력 부족 → E 판정 불가 → A(하위 규칙)로 강제 내려가지 않는다(null).
        self.assertIsNone(classifier.detect_regime(over({"목": 60.0, "수": 50.0})))

    def test_a_wood_just_below(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"목": 59.9, "수": 50.0})))

    def test_a_water_just_below(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"목": 60.0, "수": 49.9})))


class RegimeBTests(unittest.TestCase):
    """B = 화≥60 且 (금<50 或 화−금≥10) — 경계 화60·금50·차10."""

    def test_b_via_spread_boundary_10(self) -> None:
        self.assertEqual(classifier.detect_regime(over({"화": 60.0, "금": 50.0})), "B")

    def test_b_spread_just_below_and_gold_not_below_50(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"화": 60.0, "금": 50.0001})))

    def test_b_via_gold_below_50(self) -> None:
        # 금<50 분기 — strict-null: 수↑ 판정 불가(이력 없음)가 D에 남으면 B로 내려가지 않으므로
        # 평탄 수 이력 동봉(수↑ 불충족 고정) → B 확정.
        state = over({"화": 60.0, "금": 49.9999})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "B")

    def test_b_fire_just_below(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"화": 59.9, "금": 50.0})))


class RegimeCTests(unittest.TestCase):
    """C = 토≥55 且 화<60 且 금≥50 — 경계 토55·화60(배타)·금50."""

    def test_c_at_exact_boundaries(self) -> None:
        self.assertEqual(classifier.detect_regime(over({"토": 55.0})), "C")

    def test_c_earth_just_below(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"토": 54.9})))

    def test_c_fire_60_disqualifies_strictly(self) -> None:
        # 화<60는 배타 — 화=60이면 C 불충족. 화=60·금=55 → B도 불충족(차<10·금≥50) → None.
        self.assertIsNone(classifier.detect_regime(over({"토": 60.0, "화": 60.0, "금": 55.0})))

    def test_c_gold_below_50_disqualifies(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"토": 60.0, "금": 49.9})))


class RegimeDTests(unittest.TestCase):
    """D = 금<50 且 (수<40 或 수↑) — 경계 금50·수40, 수↑ = 현재−6개월 전 > 0."""

    def test_d_via_water_below_40(self) -> None:
        self.assertEqual(classifier.detect_regime(over({"금": 49.9, "수": 39.9})), "D")

    def test_d_water_40_needs_rising(self) -> None:
        # 수=40: 수<40 불충족 → 수↑ 필요 — flat 이력이면 상승 아님 → D 불충족.
        self.assertIsNone(classifier.detect_regime(over({"금": 49.9, "수": 40.0})))

    def test_d_water_40_with_rising_history(self) -> None:
        # 6개월 전 39.5 → 현재 40: 40−39.5 > 0 → 수↑ 충족 → D.
        self.assertEqual(
            classifier.detect_regime(
                over({"금": 49.9, "수": 40.0}), hist(over({"금": 49.9, "수": 39.5}))
            ),
            "D",
        )

    def test_d_rising_requires_strictly_positive(self) -> None:
        # 6개월 전 40 → 현재 40: 차 0은 상승 아님(PM 확정 — >0). 하락도 아님.
        self.assertIsNone(
            classifier.detect_regime(
                over({"금": 49.9, "수": 40.0}), hist(over({"금": 49.9, "수": 40.0}))
            )
        )

    def test_d_gold_50_boundary_fails(self) -> None:
        self.assertIsNone(classifier.detect_regime(over({"금": 50.0, "수": 39.9})))


class RegimeETests(unittest.TestCase):
    """E = 수≥45 且 목 6개월 전 대비 상승 — 경계 수45, 목 증가 폭 > 0."""

    def test_e_at_boundary(self) -> None:
        # 수=45 경계(≥) + 목 65 > 6개월 전 60 → E.
        self.assertEqual(
            classifier.detect_regime(
                over({"수": 45.0, "목": 65.0}), hist(over({"목": 60.0, "수": 45.0}))
            ),
            "E",
        )

    def test_e_water_just_below(self) -> None:
        self.assertIsNone(
            classifier.detect_regime(
                over({"수": 44.9, "목": 65.0}), hist(over({"목": 60.0, "수": 44.9}))
            )
        )

    def test_e_wood_flat_is_not_rising(self) -> None:
        # 6개월 전 65 = 현재 65 → 차 0 → 상승 아님 → E 불충족(나머지도 불충족 → None).
        self.assertIsNone(
            classifier.detect_regime(
                over({"수": 47.0, "목": 65.0}), hist(over({"목": 65.0, "수": 47.0}))
            )
        )

    def test_e_wood_falling_disqualifies(self) -> None:
        self.assertIsNone(
            classifier.detect_regime(
                over({"수": 47.0, "목": 60.0}), hist(over({"목": 65.0, "수": 47.0}))
            )
        )

    def test_e_positive_spread_only_counts(self) -> None:
        self.assertEqual(
            classifier.detect_regime(
                over({"수": 47.0, "목": 65.0}), hist(over({"목": 60.0, "수": 47.0}))
            ),
            "E",
        )


class PriorityCollisionTests(unittest.TestCase):
    """우선순위 충돌 — D > B > E > A > C(PM 확정). D 4건 + 상위 3건."""

    def test_d_beats_b(self) -> None:
        # B 참(화70≥60·금<50) — 수 39.9<40 → D도 참 → D 채택.
        self.assertEqual(classifier.detect_regime(over({"화": 70.0, "금": 49.9, "수": 39.9})), "D")

    def test_d_beats_e(self) -> None:
        # E 참(수50≥45·목 상승) — 수↑(50−45>0) → D 참 → D 채택.
        self.assertEqual(
            classifier.detect_regime(
                over({"수": 50.0, "금": 49.9, "목": 65.0}),
                hist(over({"수": 45.0, "목": 60.0})),
            ),
            "D",
        )

    def test_d_beats_a(self) -> None:
        # A 참(목65≥60·수55≥50) — 수↑(55−50>0) → D 참 → D 채택.
        self.assertEqual(
            classifier.detect_regime(
                over({"목": 65.0, "수": 55.0, "금": 49.9}),
                hist(over({"수": 50.0, "목": 60.0})),
            ),
            "D",
        )

    def test_d_vs_c_mutually_exclusive_documented(self) -> None:
        # D는 금<50, C는 금≥50 — 동시 충족 불가(순서 규칙 검증 대상 아님).
        # 금=49.9: C 불충족·D 충족(수39.9<40 — 이력 불필요), 금=50: D 불충족·C 충족(토60·화<60).
        self.assertEqual(classifier.detect_regime(over({"토": 60.0, "금": 49.9, "수": 39.9})), "D")
        self.assertEqual(classifier.detect_regime(over({"토": 60.0, "금": 50.0})), "C")

    def test_b_beats_e(self) -> None:
        # B 참(화−금=10)·E 참(수50·목 상승) → B 채택.
        self.assertEqual(
            classifier.detect_regime(
                over({"화": 65.0, "금": 55.0, "수": 50.0, "목": 65.0}),
                hist(over({"목": 60.0, "수": 50.0})),
            ),
            "B",
        )

    def test_b_beats_a(self) -> None:
        # A 참(목65·수55)·B 참(화65·금<50) → B 채택. strict-null: D 수↑ 판정 불가 남지 않게
        # 평탄 이력 동봉(금45<50·수55 불상승 → D 불충족 고정).
        state = over({"목": 65.0, "화": 65.0, "금": 45.0, "수": 55.0})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "B")

    def test_e_beats_a(self) -> None:
        # A 참(목65·수50)·E 참(수50≥45·목 상승) → E 채택.
        self.assertEqual(
            classifier.detect_regime(
                over({"목": 65.0, "수": 50.0}), hist(over({"목": 60.0, "수": 50.0}))
            ),
            "E",
        )

    def test_a_beats_c(self) -> None:
        # A·C 공통 충족(토60·금55) — A(상위) 채택. strict-null: E 판정 불가가 남지 않게
        # 평탄 이력 동봉(목65 flat → 목 상승 불충족 고정).
        state = over({"목": 65.0, "수": 55.0, "토": 60.0, "화": 50.0, "금": 55.0})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "A")

    def test_c_when_lower_priority_only(self) -> None:
        # B 불충족(화<60·차<10), E 불충족(flat 이력), A 불충족(목<60) → C.
        # strict-null: 이력 없으면 E 판정 불가가 상위라 null — 평탄 이력 동봉.
        state = over({"토": 60.0, "수": 50.0})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "C")

    def test_b_vs_c_fire_boundary_documented(self) -> None:
        # B는 화≥60, C는 화<60 — 동시 충족 불가. 화=60: C 배타·B 채택, 화=59.9: B 배타·C 채택.
        self.assertEqual(classifier.detect_regime(over({"토": 60.0, "화": 60.0, "수": 30.0})), "B")
        self.assertEqual(classifier.detect_regime(over({"토": 60.0, "화": 59.9, "수": 30.0})), "C")


class InsufficientDataTests(unittest.TestCase):
    """데이터 부족 → 국면 None + 사유(부족 지표 명기) — 강제 매칭 금지(수용기준 2)."""

    def test_single_element_rejected(self) -> None:
        regime = classifier.detect_regime({"목": 65.0})
        self.assertIsNone(regime)

    def test_two_elements_resolve_d(self) -> None:
        # 2요소입력도 상위 규칙이 완전 충족이면 판정된다 — 금49.9<50 且 수39.9<40 → 수↑ 불필요.
        self.assertEqual(classifier.detect_regime({"금": 49.9, "수": 39.9}), "D")

    def test_two_elements_null_when_higher_rule_unevaluable(self) -> None:
        # {목65·수50}: A 충족이지만 D(금 부족)·B(화 부족) 판정 불가가 상위라 강제 매칭 금지 → null.
        state = {"목": 65.0, "수": 50.0}
        self.assertIsNone(classifier.detect_regime(state))
        joined = "\n".join(classifier.regime_reasons(state))
        for element in ("화", "토", "금"):
            self.assertIn(element, joined)
        self.assertIn("부족", joined)

    def test_none_value_counts_as_missing(self) -> None:
        self.assertIsNone(classifier.detect_regime({"목": 65.0, "수": None}))

    def test_missing_water_blocks_its_dependent_rules(self) -> None:
        # 수 부족 → D(수 조건)·E(수 기준) 판정 불가 — D가 최상위라 B(완전 충족)로 내려가지 않는다.
        state = over({"화": 70.0, "금": 45.0})
        del state["수"]
        self.assertIsNone(classifier.detect_regime(state))

    def test_short_history_blocks_e(self) -> None:
        # 이력 0/5개월 → '목 6개월 전 상승' 판정 불가 — E가 A보다 우선이므로 A로 강제 매칭 금지.
        state = over({"수": 50.0, "목": 65.0})
        self.assertIsNone(classifier.detect_regime(state, []))
        self.assertIsNone(classifier.detect_regime(state, hist(state, n=5)))

    def test_with_flat_history_a_resolves(self) -> None:
        state = over({"수": 50.0, "목": 65.0})
        self.assertEqual(classifier.detect_regime(state, hist(state)), "A")

    def test_missing_past_value_blocks_water_rising(self) -> None:
        # 6개월 전 항목은 있으나 수 결측 → 수↑ 판정 불가 → D(최상위) 불가 → None.
        base = over({"금": 49.9, "수": 50.0, "목": 65.0})
        first = dict(base)
        first["수"] = None
        history = [first] + [dict(base) for _ in range(5)]
        self.assertIsNone(classifier.detect_regime(base, history))

    def test_past_value_only_6_months_back_counts(self) -> None:
        # history[-6]가 '6개월 전' — history[0](7개 중)에 수=40 → 수↑(50−40>0) → D.
        base = over({"금": 49.9, "수": 50.0, "목": 65.0})
        first = over({"금": 49.9, "수": 40.0, "목": 65.0})
        history = [first, *([dict(base) for _ in range(5)])]
        self.assertEqual(classifier.detect_regime(base, history), "D")

    def test_min_indicators_below_two_rejected(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime({"목": 65.0}, min_indicators=1)

    def test_min_indicators_three_with_two_present(self) -> None:
        state = {"목": 65.0, "수": 50.0}
        self.assertIsNone(classifier.detect_regime(state, hist(state), min_indicators=3))

    def test_empty_current_is_insufficient(self) -> None:
        regime, reasons = classifier._decision({}, hist(NEUTRAL))
        self.assertIsNone(regime)
        self.assertIn("부족", " ".join(reasons))


class InputValidationTests(unittest.TestCase):
    """부적합 입력은 조용한 None이 아니라 명확히 거부한다(req 9장 1번 전통)."""

    def test_unknown_element_key(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime({"목": 50.0, "별": 60.0})

    def test_non_numeric_value(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime(over({"목": "65"}))

    def test_bool_value_rejected(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime(over({"목": True}))

    def test_non_finite_value_rejected(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime(over({"목": float("nan")}))

    def test_history_unknown_key(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime(over({}), hist({"별": 1.0}))

    def test_non_mapping_current(self) -> None:
        with self.assertRaises(ValueError):
            classifier.detect_regime(["목", 65.0])  # type: ignore[arg-type]


class RegimeReasonsTests(unittest.TestCase):
    """판정 근거 행 — 규칙별 평가줄·부족 지표 명기·최종 판정 줄."""

    def test_matched_regime_lists_all_rules_and_result(self) -> None:
        state = over({"목": 65.0, "수": 55.0, "토": 60.0, "화": 50.0, "금": 55.0})
        reasons = classifier.regime_reasons(state, hist(state))
        self.assertGreaterEqual(len(reasons), 7)  # 지수 입력 + 규칙 5 + 판정 결과
        self.assertTrue(reasons[0].startswith("지수 입력:"))
        for regime_id in ("A", "B", "C", "D", "E"):
            with self.subTest(rule=regime_id):
                self.assertTrue(
                    any(line.startswith(f"{regime_id} 규칙") for line in reasons),
                    f"{regime_id} 규칙 근거줄 없음: {reasons}",
                )
        self.assertTrue(reasons[-1].startswith("판정 결과: A"))

    def test_null_with_missing_elements_names_them(self) -> None:
        reasons = classifier.regime_reasons({"목": 65.0})
        joined = "\n".join(reasons)
        self.assertIn("부족", joined)
        for element in ("화", "토", "금", "수"):
            self.assertIn(element, joined)
        self.assertIn("null", reasons[-1])

    def test_unknown_condition_names_history_shortage(self) -> None:
        state = over({"수": 50.0, "목": 65.0})
        reasons = classifier.regime_reasons(state, [])
        joined = "\n".join(reasons)
        self.assertIn("판정 불가", joined)
        self.assertIn("이력", joined)

    def test_regime_label_present_in_result_line(self) -> None:
        state = over({"목": 65.0, "수": 55.0, "화": 50.0, "토": 60.0, "금": 55.0})
        reasons = classifier.regime_reasons(state, hist(state))
        self.assertIn("성장 확장기", "\n".join(reasons))

    def test_empty_current_reasons_non_empty(self) -> None:
        reasons = classifier.regime_reasons({})
        self.assertGreaterEqual(len(reasons), 2)


if __name__ == "__main__":
    unittest.main()