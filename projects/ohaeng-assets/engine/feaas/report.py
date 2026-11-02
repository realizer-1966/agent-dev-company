"""리포트 계층 — 웹앱 실측 모드용 state.json 구성·스키마 검증(순수, req-v2 §4).

engine 배치가 data/state.json을 생성: {생성시각, 지수 5종, 국면, 판정 근거, 목표
배분, 제안 리밸런싱, 프록시 한계 고지}. 파일 쓰기는 run_pipeline 진입점이 담당하고
본 모듈은 순수 dict 구성·검증만 한다. 웹 app.js는 state.json 존재 시 "실측 모드
(배치 시각)" 배너 + 값 반영, 부재 시 기존 수동 모드 유지(회귀 없음).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime

DRAFT_PROXY_NOTE: str = (
    "프록시 한계: 오행 자산군은 공개 지수·금리 계열로 근사한다(目≈지수, 火≈원자재, "
    "土≈부동산 지표, 金≈중장기 채권, 水≈초단기 금리). 프록시 추적 오차와 미존재 항목은 "
    "해석 한계로 명시된다(req-v2 §3)."
)  # ② 티켓이 확정

STATE_SCHEMA_FIELDS: tuple[str, ...] = (
    "generated_at",
    "element_scores",
    "regime",
    "regime_reasons",
    "target_allocation",
    "rebalance_proposals",
    "proxy_note",
)


def build_state(
    *,
    generated_at: datetime | None = None,
    element_scores: Mapping[str, float] | None = None,
    regime: str | None = None,
    regime_reasons: Sequence[str] | None = None,
    target_allocation: Mapping[str, float] | None = None,
    rebalance_proposals: Sequence[Mapping[str, float]] | None = None,
    proxy_note: str = DRAFT_PROXY_NOTE,
) -> dict[str, object]:
    """state.json 스키마 dict을 구성한다(파일 쓰기 없음 — run_pipeline 책임).

    skeleton 단계에서는 None 인자 허용(NotImplementedError 우선) — 실제 시그니처와
    필수값 검증은 ② 티켓이 확정한다.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.report.build_state (state.json 스키마)")


def validate_state(state: Mapping[str, object]) -> list[str]:
    """스키마 검증 — 빈 list면 유효, 오류 메시지 list면 무효(req-v2 §5.5 재사용)."""
    raise NotImplementedError("② 구현 티켓 — feaas.report.validate_state")