"""표준화 계층 — 10년 rolling percentile → 0~100 오행 지수 (req-v2 §2).

순수 함수만 유지한다(입력은 sources가 파싱한 Series). 절대 레벨이 아니라 "역사적
상대 위치"를 쓴다. 역방향 지표는 100−p(invert). 오행 지수 = 소속 지표 percentile
평균(round)(element_score). 결측은 마지막값 carry-forward + 10년 미만 구간에 대해
감쇠 페널티 또는 누락 표기(req-v2 §5.1 — 정책 선택은 ② 티켓이 테스트로 확정).
"""

from __future__ import annotations

from collections.abc import Sequence

DEFAULT_WINDOW_MONTHS: int = 120  # 10년 × 12개월(req-v2 §2 — 월간 시리즈 기준)


def carry_forward(values: Sequence[float | None]) -> list[float | None]:
    """결측(None)을 직전 유효값으로 채운다. 선두 구간의 None은 유지(누락 표기용)."""
    raise NotImplementedError("② 구현 티켓 — feaas.scores.carry_forward")


def rolling_percentile(
    values: Sequence[float | None],
    window: int = DEFAULT_WINDOW_MONTHS,
    *,
    strict: bool = True,
) -> list[float | None]:
    """각 시점값이 직전 window개 관측(현재 포함) 안에서 차지하는 백분위(0~100).

    strict=True면 관측 수 < window → None(부족 표기), False면 가용 구간으로
    계산(req-v2 §5.1 감쇠 페널티 대안과의 선택은 ② 확정).
    """
    raise NotImplementedError("② 구현 티켓 — feaas.scores.rolling_percentile")


def invert(pct: float) -> float:
    """역방향 지표 변환: 100 − pct(0~100 도메인 전제)."""
    raise NotImplementedError("② 구현 티켓 — feaas.scores.invert")


def element_score(percentiles: Sequence[float], coverage: float | None = None) -> int:
    """오행 지수 = 소속 지표 percentile 평균(round).

    coverage(0~1, 데이터 충분율)가 기준 미달이면 감쇠 페널티를 적용하거나 누락
    표기로 반환한다 — req-v2 §5.1. 기준 수치는 ② 티켓이 확정.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.scores.element_score")


def clamp(v: float, low: float = 0.0, high: float = 100.0) -> float:
    """0~100 클램프(req-v2 §5.1)."""
    raise NotImplementedError("② 구현 티켓 — feaas.scores.clamp")