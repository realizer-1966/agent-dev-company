"""feaas — Five Elements AI Asset Allocation System, v2a Python 엔진 패키지.

유일 근거문서: projects/ohaeng-assets/docs/requirements-v2.md (v2a 스코프).
계층: sources(네트워크·FS 격리) → indicators(지표 정의서) → scores(표준화 0~100)
→ classifier(국면 A~E) → backtest(시프트 시뮬레이션·성과지표) → report(state.json).
코어는 순수 함수만 — 실측 fetch와 fixture 포맷은 sources.py와 engine/data/fixtures로
격리된다. v2b(XGBoost/LightGBM·TFT 예측, CVXPY/PyPortfolioOpt, API 서버 자동 실행,
PostgreSQL)는 본 패키지에 절대 포함 금지(req-v2 머리말).
"""

__all__ = ["sources", "indicators", "scores", "classifier", "backtest", "report"]