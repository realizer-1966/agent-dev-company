"""지표 정의서 계층 — 오행 × 경제 데이터 ID 매핑 (req-v2 §2, ② 확정).

코어는 순수 데이터·조회 함수만 유지한다(수집은 sources, 수치 표준화는 scores 책임).
확정 근거·기각 사유·프록시 한계는 docs/indicator-map.md(지표 정의서)로 문서화한다.

- 유일한 대체: req 후보 BAMLH0A0HYM2는 fredgraph.csv에서 최근 ~3년만 다운로드
  가능(ICE BofA 라이선스) → Moody's Baa 수익률 DBAA(전체 이력, 1986~)로 대체.
  수의 단기 금리도 동일 기준: SOFR은 2018-04 시작(일간 이력 ~2240건 < 10년 창 2530건
  → percentile이 영구 부족) → DFF(유효 연방기금금리, 1954~)로 대체.

매핑 표(17 지표):
- 목(성장 가능성): GDPC1(QoQ), PAYEMS(YoY), UNRATE(역방향), ^spx(stooq, YoY)
- 화(인플레이션 압력): CPIAUCSL(YoY), PPIACO(YoY), T10YIE(수준), DCOILWTICO(1y 변동)
- 토(실물자산 안정성): CSUSHPINSA(YoY), HOUST(수준), CUSR0000SEHA(임대 프록시, YoY)
- 금(금융 안정성): DBAA(역방향), VIXCLS(역방향), DGS10(수준)
- 수(시장 유동성): M2SL(YoY), DTWEXBGS(수준), DFF(역방향)
"""

from __future__ import annotations

from dataclasses import dataclass

ELEMENTS: tuple[str, ...] = ("목", "화", "토", "금", "수")


@dataclass(frozen=True)
class IndicatorDef:
    """단일 지표 정의 — 오행 소속·의미·데이터 ID·변환·방향(req-v2 §2 표 한 행)."""

    element: str          # ELEMENTS 원소: 목·화·토·금·수
    name: str             # 사람이 읽는 지표명(판정 근거 표기용)
    source: str           # "fred" | "stooq"
    ids: tuple[str, ...]  # 데이터 ID/심볼 (FRED 시리즈 ID 또는 Stooq 심볼)
    transform: str        # "level" | "yoy" | "qoq" | "1y_change"
    inverse: bool         # True면 역방향 지표 — scores.percentile에 100−p 적용


INDICATOR_DEFS: tuple[IndicatorDef, ...] = (
    IndicatorDef("목", "실질 GDP 성장", "fred", ("GDPC1",), "qoq", False),
    IndicatorDef("목", "비농업 고용", "fred", ("PAYEMS",), "yoy", False),
    IndicatorDef("목", "실업률", "fred", ("UNRATE",), "level", True),
    IndicatorDef("목", "S&P 500", "stooq", ("^spx",), "yoy", False),
    IndicatorDef("화", "소비자물가", "fred", ("CPIAUCSL",), "yoy", False),
    IndicatorDef("화", "생산자물가", "fred", ("PPIACO",), "yoy", False),
    IndicatorDef("화", "손익분기 인플레", "fred", ("T10YIE",), "level", False),
    IndicatorDef("화", "WTI 유가", "fred", ("DCOILWTICO",), "1y_change", False),
    IndicatorDef("토", "주택 가격", "fred", ("CSUSHPINSA",), "yoy", False),
    IndicatorDef("토", "주택 착공", "fred", ("HOUST",), "level", False),
    IndicatorDef("토", "주택 임대 프록시", "fred", ("CUSR0000SEHA",), "yoy", False),
    IndicatorDef("금", "신용 스프레드 프록си", "fred", ("DBAA",), "level", True),
    IndicatorDef("금", "변동성 지수", "fred", ("VIXCLS",), "level", True),
    IndicatorDef("금", "채권 수익률", "fred", ("DGS10",), "level", False),
    IndicatorDef("수", "M2 통화", "fred", ("M2SL",), "yoy", False),
    IndicatorDef("수", "달러 인덱스", "fred", ("DTWEXBGS",), "level", False),
    IndicatorDef("수", "단기 금리", "fred", ("DFF",), "level", True),
)


def indicators_for(element: str) -> tuple[IndicatorDef, ...]:
    """해당 오행에 소속된 지표 정의 목록. 미정의 오행은 ValueError."""
    if element not in ELEMENTS:
        raise ValueError(f"미정의 오행: {element!r} — ELEMENTS {ELEMENTS} 중에서 선택")
    return tuple(d for d in INDICATOR_DEFS if d.element == element)


__all__ = ["ELEMENTS", "INDICATOR_DEFS", "IndicatorDef", "indicators_for"]