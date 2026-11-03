"""국면 판정 계층 — 지수 5종 → 국면 A~E (req-v2 §2·§5-2, ③ PM 확정).

순수 함수만 유지한다. 규칙 조건은 3치 논리(TRUE/FALSE/UNKNOWN)로 평가한다 —
지수 부족·이력 부족 조건은 UNKNOWN이며, 상위 규칙이 UNKNOWN이면 그 규칙이
TRUE일 수 있으므로 이후(하위 우선순위) 규칙으로 강제 내려가지 않고 국면 null을
반환한다(req §2 '판정 불가 → 국면 null + 이유 표기 — 강제 매칭 금지').

**PM 확정 규칙(카드 t_55b34df2, 2026-11-02 — README/지표 정의서에 병기)**:
- A = 목 ≥ 60 且 수 ≥ 50
- B = 화 ≥ 60 且 (금 < 50 或 화 − 금 ≥ 10)  — '화−금≥10'은 지수 차 ≥ 10점
- C = 토 ≥ 55 且 화 < 60 且 금 ≥ 50
- D = 금 < 50 且 (수 < 40 或 수 ↑)
- E = 수 ≥ 45 且 목이 6개월 전 대비 상승
- 충돌 우선순위: **D > B > E > A > C** (`REGIME_PRIORITY`)
- '수↑'과 '목 6개월 전 대비 상승'은 동일 규격 — **현재값 − 6개월 전값 > 0**.
  6개월 전값은 `history[-6]`(현재 월 직전부터 과거로 오른차순인 월별 지수
  시퀀스; 파이프라인이 월간 간격으로 공급). 이력이 6개월 미만이거나 6개월 전
  항목의 값이 결측이면 해당 조건은 UNKNOWN.

입력 계약:
- `current`·`history` 항목: 오행 키(목·화·토·금·수) → 수치(float·int) 또는
  `None`/키 생략(부족 표기). 미정의 키·비수치·비유한수·bool은 ValueError로 거부.
- 판정 입력은 ≥2개 오행 지수(단일 지표 판정 금지) — `min_indicators`(기본 2)
  미만이면 국면 None + 부족 사유(부족 오행 명기).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from enum import Enum

from feaas.indicators import ELEMENTS

REGIME_LABELS: dict[str, str] = {
    "A": "성장 확장기",
    "B": "인플레이션 상승기",
    "C": "실물경제 안정기",
    "D": "금융 불안기",
    "E": "유동성 회복기",
}
REGIME_PRIORITY: tuple[str, ...] = ("D", "B", "E", "A", "C")

MONTHS_LOOKBACK: int = 6  # E 규칙의 "목 상승"·D 규칙의 "수↑" 판단 구간(req-v2 §2)
DEFAULT_MIN_INDICATORS: int = 2  # 판정 입력 ≥2 오행 지수(단일 지표 판정 금지)

_ELEMENT_JOINT = "·"


class _Tri(Enum):
    """3치 규칙 평가 — TRUE(충족)/FALSE(불충족)/UNKNOWN(판정 불가·데이터 부족)."""

    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


def _tri_and(a: _Tri, b: _Tri) -> _Tri:
    if a is _Tri.FALSE or b is _Tri.FALSE:
        return _Tri.FALSE
    if a is _Tri.UNKNOWN or b is _Tri.UNKNOWN:
        return _Tri.UNKNOWN
    return _Tri.TRUE


def _tri_or(a: _Tri, b: _Tri) -> _Tri:
    if a is _Tri.TRUE or b is _Tri.TRUE:
        return _Tri.TRUE
    if a is _Tri.UNKNOWN or b is _Tri.UNKNOWN:
        return _Tri.UNKNOWN
    return _Tri.FALSE


def _ge(value: float | None, threshold: float) -> _Tri:
    if value is None:
        return _Tri.UNKNOWN
    return _Tri.TRUE if value >= threshold else _Tri.FALSE


def _lt(value: float | None, threshold: float) -> _Tri:
    if value is None:
        return _Tri.UNKNOWN
    return _Tri.TRUE if value < threshold else _Tri.FALSE


def _spread_ge(left: float | None, right: float | None, threshold: float) -> _Tri:
    """지수 차 left − right ≥ threshold — 양쪽 값 필요, 하나 부족이면 UNKNOWN."""
    if left is None or right is None:
        return _Tri.UNKNOWN
    return _Tri.TRUE if (left - right) >= threshold else _Tri.FALSE


def _rising(
    current: Mapping[str, float | None],
    past: Mapping[str, float | None],
    element: str,
) -> _Tri:
    """현재값 − 6개월 전값 > 0 — 부재·결측은 UNKNOWN('수↑'·'목 상승' 동일 규격)."""
    current_value = current.get(element)
    past_value = past.get(element)
    if current_value is None or past_value is None:
        return _Tri.UNKNOWN
    return _Tri.TRUE if (current_value - past_value) > 0.0 else _Tri.FALSE


def _validate(scores: Mapping[str, float | None], label: str) -> None:
    if not isinstance(scores, Mapping):
        raise ValueError(f"{label}: 오행 지수는 Mapping(dict) 입력이어야 한다")
    for key, value in scores.items():
        if key not in ELEMENTS:
            raise ValueError(
                f"{label}: 알 수 없는 오행 키 {key!r} — ELEMENTS "
                f"{_ELEMENT_JOINT.join(ELEMENTS)} 중에서만 허용"
            )
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{label}: {key}는 수치 또는 None이어야 함: {value!r}")
        if not math.isfinite(float(value)):
            raise ValueError(f"{label}: {key}는 유한한 수치여야 함: {value!r}")


def _history_at_6(history: Sequence[Mapping[str, float | None]]) -> tuple[Mapping[str, float | None] | None, str]:
    """'6개월 전' 지수 항목(history[-6])과 부족 사유 문구 — 부족 시 (None, 사유)."""
    if len(history) < MONTHS_LOOKBACK:
        note = f"이력 부족(6개월 항목 없음 — {len(history)}개월 제공)"
        return None, note
    past = history[-MONTHS_LOOKBACK]
    note = ""
    missing = [el for el in ELEMENTS if past.get(el) is None]
    if missing:
        note = f"6개월 전 결측({_ELEMENT_JOINT.join(missing)})"
    return past, note


def _fmt(value: float | None) -> str:
    return "없음" if value is None else f"{value:g}"


def _describe(
    rule_id: str,
    verdict: _Tri,
    current: Mapping[str, float | None],
    past: Mapping[str, float | None] | None,
    past_note: str,
) -> str:
    def v(element: str) -> str:
        return _fmt(current.get(element))

    def delta_text(element: str) -> str:
        if current.get(element) is None or past is None or past.get(element) is None:
            base = f"{v(element)} vs 6개월 전 없음"
            return f"{base}({past_note})" if past_note else base
        diff = current[element] - past[element]
        return f"{v(element)} vs 6개월 전 {past[element]:g}({diff:+g})"

    if rule_id == "A":
        cond = f"목≥60({'목=' + v('목')}) · 수≥50({'수=' + v('수')})"
    elif rule_id == "B":
        fire = current.get("화")
        gold = current.get("금")
        diff = "화−금 판정 불가(화·금 부족)" if (fire is None or gold is None) else f"화−금={fire - gold:g}"
        cond = f"화≥60({'화=' + v('화')}) · (금<50({'금=' + v('금')}) 或 {diff})"
    elif rule_id == "C":
        cond = f"토≥55({'토=' + v('토')}) · 화<60({'화=' + v('화')}) · 금≥50({'금=' + v('금')})"
    elif rule_id == "D":
        cond = f"금<50({'금=' + v('금')}) · (수<40({'수=' + v('수')}) 或 수↑({delta_text('수')}))"
    elif rule_id == "E":
        cond = f"수≥45({'수=' + v('수')}) · 목 6개월 전 상승({delta_text('목')})"
    else:  # 방어 — 호출 경로에서 정의된 규칙만
        raise ValueError(f"미정의 국면 규칙: {rule_id!r}")

    word = {_Tri.TRUE: "충족", _Tri.FALSE: "불충족", _Tri.UNKNOWN: "판정 불가"}[verdict]
    return f"{rule_id} 규칙 {word} — {cond}"


def _decision(
    current: Mapping[str, float | None],
    history: Sequence[Mapping[str, float | None]] = (),
    *,
    min_indicators: int = DEFAULT_MIN_INDICATORS,
) -> tuple[str | None, list[str]]:
    """국면 판정 + 근거 행 — detect_regime·regime_reasons 공유 코어.

    반환: (국면 라벨 또는 None, 근거 문자열 목록). 우선순위 순회 중 규칙이
    TRUE면 즉시 확정; UNKNOWN이면(null + 부족 사유) 순회 중단 — 강제 매칭 금지.
    """
    if not isinstance(min_indicators, int) or isinstance(min_indicators, bool):
        raise ValueError(f"min_indicators는 정수: {min_indicators!r}")
    if min_indicators < 2:
        raise ValueError(
            f"min_indicators ≥ 2 필요 — 단일 지표 판정 금지(req-v2 §2): {min_indicators!r}"
        )
    if min_indicators > len(ELEMENTS):
        raise ValueError(
            f"min_indicators는 오행 수({len(ELEMENTS)}) 이하: {min_indicators!r}"
        )

    _validate(current, "current")
    for i, entry in enumerate(history):
        _validate(entry, f"history[{i}]")

    past, past_note = _history_at_6(history)
    present = [el for el in ELEMENTS if current.get(el) is not None]

    reasons: list[str] = [
        "지수 입력: " + " · ".join(f"{el}={_fmt(current.get(el))}" for el in ELEMENTS)
    ]

    verdicts: dict[str, _Tri] = {}
    verdicts["A"] = _tri_and(
        _ge(current.get("목"), 60.0), _ge(current.get("수"), 50.0)
    )
    verdicts["B"] = _tri_and(
        _ge(current.get("화"), 60.0),
        _tri_or(
            _lt(current.get("금"), 50.0),
            _spread_ge(current.get("화"), current.get("금"), 10.0),
        ),
    )
    verdicts["C"] = _tri_and(
        _tri_and(_ge(current.get("토"), 55.0), _lt(current.get("화"), 60.0)),
        _ge(current.get("금"), 50.0),
    )
    verdicts["D"] = _tri_and(
        _lt(current.get("금"), 50.0),
        _tri_or(_lt(current.get("수"), 40.0), _rising(current, past or {}, "수")),
    )
    verdicts["E"] = _tri_and(
        _ge(current.get("수"), 45.0), _rising(current, past or {}, "목")
    )

    if len(present) < min_indicators:
        missing = [el for el in ELEMENTS if current.get(el) is None]
        reasons.append(
            f"오행 지수 부족 — 판정 입력 최소 {min_indicators}개 필요(현재 {len(present)}개): "
            f"부족 {_ELEMENT_JOINT.join(missing) if missing else '없음'}"
        )
        reasons.append("판정 결과: null — 오행 지수 부족(강제 매칭 금지)")
        return None, reasons

    regime: str | None = None
    blocked: str | None = None
    for rule_id in REGIME_PRIORITY:
        verdict = verdicts[rule_id]
        if verdict is _Tri.TRUE:
            regime = rule_id
            break
        if verdict is _Tri.UNKNOWN:
            blocked = rule_id
            break

    for rule_id in REGIME_PRIORITY:
        reasons.append(_describe(rule_id, verdicts[rule_id], current, past, past_note))

    missing_now = [el for el in ELEMENTS if current.get(el) is None]
    if missing_now:
        reasons.append(f"부족 지표(현재 미제공): {_ELEMENT_JOINT.join(missing_now)}")

    if regime is not None:
        reasons.append(
            f"판정 결과: {regime}({REGIME_LABELS[regime]}) — 충돌 우선순위 "
            f"{' > '.join(REGIME_PRIORITY)}"
        )
    elif blocked is not None:
        reasons.append(
            f"판정 결과: null — {blocked} 규칙 판정 불가(데이터 부족 — 강제 매칭 금지)"
        )
    else:
        reasons.append("판정 결과: null — 모든 국면 규칙 불충족")
    return regime, reasons


def detect_regime(
    current: Mapping[str, float],
    history: Sequence[Mapping[str, float]] = (),
    *,
    min_indicators: int = DEFAULT_MIN_INDICATORS,
) -> str | None:
    """지수 5종 현 상태 → 국면 라벨("A"~"E") 또는 None(판정 불가).

    history는 과거 월별 지수 시퀀스(오름차순, 현재 월 제외) — '6개월 전'은
    history[-6]. 부족 오행은 키 생략 또는 None으로 표기한다. 규칙·우선순위·
    부족 정책은 모듈 docstring 'PM 확정 규칙' 참조 — 경계는 tests/test_classifier.py 고정.
    """
    regime, _ = _decision(current, history, min_indicators=min_indicators)
    return regime


def regime_reasons(
    current: Mapping[str, float],
    history: Sequence[Mapping[str, float]] = (),
) -> list[str]:
    """판정 근거 행 — 지수 입력·규칙별 평가·최종 판정(또는 부족 사유) 문자열 반환.

    detect_regime이 None을 반환할 때도 '왜 판정 불가인지'를 항목으로 담는다
    (부족 지표 명기 — state.json '판정 근거' 필드로 직결). 오행이 제공되지 않은
    지수가 있으면 '부족 지표(현재 미제공): …' 행을 추가한다.
    """
    return _decision(current, history)[1]


__all__ = [
    "DEFAULT_MIN_INDICATORS",
    "MONTHS_LOOKBACK",
    "REGIME_LABELS",
    "REGIME_PRIORITY",
    "detect_regime",
    "regime_reasons",
]