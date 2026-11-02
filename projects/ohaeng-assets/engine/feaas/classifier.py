"""국면 판정 계층 — 지수 5종 → 국면 A~E (req-v2 §2).

순수 함수만 유지한다. 규칙(초안 — 요구사항 그대로, 경계는 반드시 테스트로 고정):
- A = 목 ≥ 60 且 수 ≥ 50
- B = 화 ≥ 60 且 (금 < 50 或 화 − 금 ≥ 10)
- C = 토 ≥ 55 且 화 < 60 且 금 ≥ 50
- D = 금 < 50 且 (수 < 40 或 수 ↑)
- E = 수 ≥ 45 且 목이 6개월 전 대비 상승

조건 충돌 시 우선순위 D > B > E > A > C(REGIME_PRIORITY). 판정은 반드시 ≥2 지표
조합(단일 지표 판정 금지). 판정 불가(데이터 부족)는 국면 None + 이유 표기 —
강제 매칭 금지(regime_reasons가 근거 행을 만들어 state.json '판정 근거'로 쓴다).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

REGIME_LABELS: dict[str, str] = {
    "A": "성장 확장기",
    "B": "인플레이션 상승기",
    "C": "실물경제 안정기",
    "D": "금융 불안기",
    "E": "유동성 회복기",
}
REGIME_PRIORITY: tuple[str, ...] = ("D", "B", "E", "A", "C")

MONTHS_LOOKBACK: int = 6  # E 규칙의 "목 상승" 판단 구간(req-v2 §2)


def detect_regime(
    current: Mapping[str, float],
    history: Sequence[Mapping[str, float]] = (),
    *,
    min_indicators: int = 2,
) -> str | None:
    """지수 5종 현 상태 → 국면 라벨("A"~"E") 또는 None(판정 불가).

    history는 과거 월별 지수 시퀀스(D 규칙의 수↑, E 규칙의 목 6개월 전 대비 상승
    판단용). 지표 부족·조건 미충족 시 None과 이유 표기가 계약이다.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.classifier.detect_regime (경계 테스트 필수)")


def regime_reasons(
    current: Mapping[str, float],
    history: Sequence[Mapping[str, float]] = (),
) -> list[str]:
    """판정 근거 행 — 적용된 규칙·계산 근거(값)를 사람이 읽을 수 있는 문자열로 반환.

    detect_regime이 None을 반환할 때도 "왜 판정 불가인지"를 항목으로 담는다.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.classifier.regime_reasons")