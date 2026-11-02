"""지표 정의서 계층 — 오행 × 경제 데이터 ID 매핑 (req-v2 §2).

코어는 순수 데이터·조회 함수만 유지한다(수집은 sources, 수치 표준화는 scores 책임).
매핑 후보(req-v2 §2 표 — 확정은 ② 티켓이 테스트와 함께):
- 목(성장 가능성): GDPC1(QoQ), PAYEMS(YoY), UNRATE(역방향), SP500(stooq)
- 화(인플레이션 압력): CPIAUCSL(YoY), PPIACO(YoY), T10YIE(level), DCOILWTICO(1y 변동)
- 토(실물자산 안정성): CSUSHPINSA(YoY), HOUST(수준)
- 금(금융 안정성): BAMLH0A0HYM2(역방향), VIXCLS(역방향), DGS10(수준 판단)
- 수(시장 유동성): M2SL(YoY), DTWEXBGS(level), SOFR(역방향)
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
    ids: tuple[str, ...]  # 데이터 ID(프록시 변환 시 복수 ID 허용 — ② 확정)
    transform: str        # "level" | "yoy" | "qoq" | "1y_change"
    inverse: bool         # True면 역방향 지표 — scores.percentile에 100−p 적용


INDICATOR_DEFS: tuple[IndicatorDef, ...] = ()  # ② 티켓이 req-v2 §2 표를 확정해 채움


def indicators_for(element: str) -> tuple[IndicatorDef, ...]:
    """해당 오행에 소속된 지표 정의 목록. 미정의 오행은 ValueError(② 테스트 고정)."""
    raise NotImplementedError("② 구현 티켓 — feaas.indicators.indicators_for")