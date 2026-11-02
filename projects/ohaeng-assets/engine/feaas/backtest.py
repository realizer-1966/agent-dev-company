"""백테스트 계층 — 국면 → 배분 시프트 시뮬레이션 · 성과지표 (req-v2 §3).

순수 함수만 유지한다(FS·네트워크 없음 — 회계 정확성은 fixture로 유닛 테스트,
req-v2 §5.3: 복리 계산·비용 차감·MDD 정의를 고정 fixture로 검증).

- 주기: 최근 15년(데이터 존재 범위), 월말 리밸런싱, 거래비용 0.1%/회 차감.
- 오행 자산 프록시(Stooq/FRED): 目≈지수, 火≈원자재(GLD/USO 한계), 土≈부동산(REIT 프록시
  한계 문서화), 金≈10y 채권 근사(^tnx), 水≈3M T-bill(IRX).
- 비교 기준선: 60/40(주60·10y채40), 무보정 오행(기준 배분 고정).
- 산출: 연율화 수익·변동성·MDD·샤프·거래비용 총액·위기(2008, 2020-03) 방어도 —
  JSON+MD 리포트. 수익 우위는 필수가 아니며 결과는 그대로 보고(req-v2 §3).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

COST_PER_TRADE_DEFAULT: float = 0.001  # 거래비용 0.1%/회(req-v2 §3)


@dataclass
class BacktestResult:
    """단일 전략 백테스트 성과 — JSON+MD 리포트 직결 필드(req-v2 §3)."""

    months: int
    total_return: float
    cagr: float            # 연율화 수익
    vol: float             # 연율화 변동성
    mdd: float             # 최대낙폭(0~1, 양수 보고 — 정의는 ②가 테스트로 고정)
    sharpe: float
    trading_costs: float   # 거래비용 총액(누적 비율)
    crisis_defense: dict[str, float] = field(default_factory=dict)  # 위기 구간별 방어도


def compound(returns: Sequence[float]) -> float:
    """월 수익률 시퀀스 → 누적 복리 수익률."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.compound")


def annualized_return(total_return: float, months: int) -> float:
    """누적 수익률 → 연율화(CAGR). months ≤ 0은 ValueError(② 테스트 고정)."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.annualized_return")


def annualized_vol(returns: Sequence[float]) -> float:
    """월 수익률 시퀀스 → 연율화 변동성."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.annualized_vol")


def sharpe_ratio(returns: Sequence[float], *, rf_annual: float = 0.0) -> float:
    """샤프 = (연율화 수익 − rf) / 연율화 변동성. rf 기본 0(② 확정)."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.sharpe_ratio")


def max_drawdown(nav: Sequence[float]) -> float:
    """NAV 상수 시퀀스 → 최대낙폭(0 ≤ mdd ≤ 1, 양수). 고점 대비 최대 하락비 율."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.max_drawdown")


def crisis_defense(
    crisis_windows: Mapping[str, tuple[str, str]],
    *,
    navs: Sequence[tuple[str, float]] | None = None,
) -> dict[str, float]:
    """위기 구간(예: {"2008": (…,), "2020-03": (…,)} — req-v2 §3)에서의 NAV 방어도."""
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.crisis_defense")


def run_backtest(
    allocations_by_month: Sequence[Mapping[str, float]],
    element_returns_by_month: Sequence[Mapping[str, float]] | None = None,
    *,
    cost_per_trade: float = COST_PER_TRADE_DEFAULT,
) -> BacktestResult:
    """국면 → 배분 시프트 시뮬레이션.

    월말 리밸런싱·거래비용 0.1%/회 차감. 비교 기준선(60/40·무보정 오행) 실행과
    월/일별 NAV 시퀀스 반환 계약은 ② 티켓이 확정한다.
    """
    raise NotImplementedError("② 구현 티켓 — feaas.backtest.run_backtest")