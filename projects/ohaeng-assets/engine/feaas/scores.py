"""표준화 계층 — 10년 rolling percentile → 0~100 오행 지수 (req-v2 §2·§5-1).

순수 함수만 유지한다(입력은 sources가 파싱한 Series). 절대 레벨이 아니라 "역사적
상대 위치"를 쓴다. 정책 고정(② 확정 — tests/test_scores.py + docs/indicator-map.md):

1. 결측(None) → **마지막값 carry-forward**(선두 None은 유지 = 그 시점 누락 표기).
2. percentile 정의: p = 100 × #{w ≤ v} / n — w는 현재를 포함한 직전 window개 관측
   (None 제외). 최대 100·최소 100/n. 반올림은 Python 내장 round(banker).
3. 10년 부족(window개 관측 미만) → **누락 표기(None)** 채택, 감쇠 페널티 미채택 —
   req §2 '판정 불가(데이터 부족) → 국면 null' 정책과 정합, 감쇠 수치의 오판 편향 회피.
4. 역방향 지표: 100 − p (invert).
5. 오행 지수 = 소속 지표 percentile 평균(round) (element_score). 0~100 클램프(clamp).
6. window는 주기별 관측 수로 지정 — 월 120·주 520·일 2530·분기 40·연 10
   (WINDOW_COUNTS·window_count_for; 월간 기준 상수 DEFAULT_WINDOW_MONTHS = 120).

파생(transform) 유도도 같은 계층의 순수 함수로 본다(apply_transform):
level(원값) · yoy(1년 전 대비 %, 날짜 앵커 ±보유 가드) · qoq(직전 관측 대비 %)
· 1y_change(yoy 동일 공식 — 일간 시리즈용 라벨).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from feaas.sources import Series

DEFAULT_WINDOW_MONTHS: int = 120  # 10년 × 12개월(req-v2 §2 — 월간 시리즈 기준)
MIN_QOQ_GAP_DAYS: int = 200   # QoQ 직전 관측 간격 상한(최대 주기 이상이면 파생 중단)
_MIN_YOY_AGE_DAYS: int = 358  # yoy 기준점 채택 창 — ⌜≈1년 전⌟(358일 = 365−7 휴일 여유)
_MAX_YOY_LOOKBACK_DAYS: int = 430  # 기준점 탐색 허용 상한(≈14개월 밖 결측은 기준 불가)

WINDOW_COUNTS: dict[str, int] = {
    "daily": 2530,   # 평균 253 거래일 × 10
    "weekly": 520,   # 52주 × 10
    "monthly": 120,  # 12개월 × 10
    "quarterly": 40,
    "annual": 10,
}


def carry_forward(values: Sequence[float | None]) -> list[float | None]:
    """결측(None)을 직전 유효값으로 채운다. 선두 구간의 None은 유지(누락 표기용)."""
    out: list[float | None] = []
    last: float | None = None
    for v in values:
        if v is None:
            out.append(last)
        else:
            out.append(v)
            last = v
    return out


def rolling_percentile(
    values: Sequence[float | None],
    window: int = DEFAULT_WINDOW_MONTHS,
    *,
    strict: bool = True,
) -> list[float | None]:
    """각 시점값이 직전 window개 관측(현재 포함) 안에서 차지하는 백분위(0~100).

    strict=True면(기본 — 수용기준 1 정책) 관측 수 < window → None(부족 표기),
    False면 가용 구간으로 계산. None 값 자체도 백분위 없음(None).
    """
    if window < 1:
        raise ValueError(f"window는 1 이상: {window}")
    out: list[float | None] = []
    seen: list[float] = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        seen.append(v)
        w = seen[-window:]
        n = len(w)
        if strict and n < window:
            out.append(None)
            continue
        count_le = 0
        for x in w:
            if x <= v:
                count_le += 1
        out.append(count_le * 100.0 / n)
    return out


def invert(pct: float) -> float:
    """역방향 지표 변환: 100 − pct(0~100 도메인 전제)."""
    return 100.0 - pct


def element_score(percentiles: Sequence[float | None]) -> int | None:
    """오행 지수 = 소속 지표 percentile 평균(round) — 부족(전부 None)이면 누락 표기 None.

    감쇠 페널티(coverage 가중)는 미채택 — req §5-1 대안 중 누락 표기 정책 고정
    (tests/test_scores.py·docs/indicator-map.md). 모듈 docstring 정책 3·5 참조.
    """
    valid = [p for p in percentiles if p is not None]
    if not valid:
        return None
    return int(round(sum(valid) / len(valid)))


def clamp(v: float, low: float = 0.0, high: float = 100.0) -> float:
    """0~100 클램프(req-v2 §5-1)."""
    if low > high:
        raise ValueError(f"clamp 범위 역전: low={low} > high={high}")
    return min(high, max(low, v))


def standardize_series(series: Series, *, window: int = DEFAULT_WINDOW_MONTHS) -> Series:
    """단일 지표 Series → rolling percentile 표준화 Series (수용기준 1 파이프라인).

    결측 carry-forward → strict rolling percentile(10년 부족 → None). 날짜는 그대로.
    """
    values = carry_forward([v for _, v in series])
    percentiles = rolling_percentile(values, window, strict=True)
    return [(d, p) for (d, _), p in zip(series, percentiles)]


def standardize_indicator(
    series: Series,
    *,
    transform: str = "level",
    inverse: bool = False,
    window: int = DEFAULT_WINDOW_MONTHS,
) -> Series:
    """파생 유도 → 결측 carry-forward → rolling percentile → 역방향 100−p.

    지표 정의(indicators.IndicatorDef) 1행에 대한 표준화 파이프라인 — 정책 6칙 전체.
    """
    transformed = apply_transform(series, transform)
    filled = carry_forward([v for _, v in transformed])
    percentiles = rolling_percentile(filled, window, strict=True)
    if inverse:
        percentiles = [None if p is None else invert(p) for p in percentiles]
    return [(d, p) for (d, _), p in zip(series, percentiles)]


def apply_transform(series: Series, transform: str) -> Series:
    """파생 유도(순수): level·yoy·qoq·1y_change — 결과는 (date, 값|None) Series.

    - yoy: 1년 전 관측(날짜 앵커 358~430일 창, 결측 후보 건너뜀) 대비 %.
    - qoq: 직전 관측(간격 상한 200일 — 분기 주기 가드) 대비 %.
    - 1y_change: yoy와 동일 공식(일간 시리즈용 라벨).
    - 기준점 결측/비양수/탐색 실패 → None(파생 불가 표기 — 이후 carry-forward 대상).
    """
    if transform == "level":
        return list(series)
    if transform not in ("yoy", "qoq", "1y_change"):
        raise ValueError(f"미지원 파생 유형: {transform!r}")
    dates = [date.fromisoformat(d) for d, _ in series]
    out: list[tuple[str, "float | None"]] = []
    for i, (d, v) in enumerate(series):
        if v is None:
            out.append((d, None))
            continue
        base = _base_for(series, dates, i, transform)
        if base is None or base <= 0:
            out.append((d, None))
            continue
        out.append((d, 100.0 * (v / base - 1.0)))
    return out


def _base_for(series: Series, dates: list[date], i: int, transform: str) -> float | None:
    if transform == "qoq":
        for j in range(i - 1, -1, -1):
            if series[j][1] is not None:
                if (dates[i] - dates[j]).days > MIN_QOQ_GAP_DAYS:
                    return None
                return series[j][1]
        return None
    for j in range(i, -1, -1):
        age = (dates[i] - dates[j]).days
        if age > _MAX_YOY_LOOKBACK_DAYS:
            break  # 날짜 오름차순 — 더 오래된 후보는 전부 허용창 밖
        if age < _MIN_YOY_AGE_DAYS:
            continue  # 창 안(≈1년 전)까지 스캔
        if series[j][1] is not None:
            return series[j][1]
        # 결측 관측은 건너뛰고 더 오래된 후보 탐색(창 안이면 채택)
    return None


def window_count_for(dates: Sequence[str], *, months: int = DEFAULT_WINDOW_MONTHS) -> int:
    """시리즈 날짜 간격에서 주기를 추정해 months에 상응하는 관측 수를 돌려준다.

    정책 6 — 주기별 10년 관측수(WINDOW_COUNTS): 일 2530·주 520·월 120·분기 40·연 10.
    """
    if not dates or len(dates) < 3:
        raise ValueError("주기 추정 불가: 관측 3건 미만")
    parsed = sorted(date.fromisoformat(d) for d in dates)
    gaps = sorted((b - a).days for a, b in zip(parsed, parsed[1:]) if b > a)
    if not gaps:
        raise ValueError("주기 추정 불가: 중복 날짜만 존재")
    median_gap = gaps[len(gaps) // 2]
    for threshold, freq in ((3, "daily"), (9, "weekly"), (40, "monthly"), (110, "quarterly")):
        if median_gap <= threshold:
            per_year = {"daily": 253, "weekly": 52, "monthly": 12, "quarterly": 4}[freq]
            return int(round(months / 12.0 * per_year))
    return 10


__all__ = [
    "DEFAULT_WINDOW_MONTHS",
    "WINDOW_COUNTS",
    "apply_transform",
    "carry_forward",
    "clamp",
    "element_score",
    "invert",
    "rolling_percentile",
    "standardize_indicator",
    "standardize_series",
    "window_count_for",
]