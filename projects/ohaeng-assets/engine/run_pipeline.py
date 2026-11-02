"""FEAAS v2a 배치 진입점 stub — 실행 순서 문서화, 본문 실행은 계층 ②③ 티켓이 채운다.

실행 순서(req-v2 §1·§4; venv·실행 절차는 README 「FEAAS v2a — Python 엔진」 섹션):
  1. fetch     — feaas.sources    : FRED·Stooq CSV 실측(+로컬 캐시·retry)
  2. 지표 매핑  — feaas.indicators : 지표 정의서(오행 × 데이터 ID)
  3. 표준화    — feaas.scores     : 10년 rolling percentile → 지수 5종(0~100)
  4. 국면 판정  — feaas.classifier : 규칙 A~E + 판정 근거(판정 불가 → None 표기)
  5. 백테스트  — feaas.backtest   : 국면→배분 시프트 시뮬레이션·성과지표
  6. 리포트    — feaas.report     : data/state.json 구성·스키마 검증(웹앱 실측 모드)

월간 배치 크론은 CEO 세션이 직접 운영한다 — 티켓·엔진에 크론 등록 포함 금지(req-v2 §4).
"""

from __future__ import annotations

from collections.abc import Sequence

PIPELINE_STEPS: tuple[str, ...] = (
    "sources.fetch",
    "indicators.map",
    "scores.standardize",
    "classifier.detect",
    "backtest.run",
    "report.build_state",
)


def main(argv: Sequence[str] | None = None) -> int:
    """배치 실행 — stub: ② 티켓이 지수 산출·국면 판정, ③ 티켓이 백테스트·state.json 쓰기를 채운다."""
    raise NotImplementedError("계층 ②③ 구현 티켓 — run_pipeline.main (README FEAAS v2a 섹션 참조)")


if __name__ == "__main__":
    raise SystemExit(main())