"""FEAAS v2a 배치 진입점 — 지표 수집 → 지수 5종 → 국면 → 백테스트 → 리포트 산출.

실행 절차(req-v2 §1·§4; 상세는 README 「FEAAS v2a ③ — 배치 파이프라인」 섹션):
  1. 수집    — feaas.sources  : fetch_fred/fetch_stooq(캐시 우선) 또는 --fixtures(로컬
               CSV만 — 네트워크 호출 0). 실패 지표는 None + 사유 기록(강제 매칭 금지).
  2. 지표    — feaas.indicators : INDICATOR_DEFS 17종(오행 × 데이터 ID, ② 확정)
  3. 표준화  — feaas.scores    : standardize_indicator(10년 rolling percentile)
               / element_score(오행 평균 round) — ② 파이프라인 순수 재사용
  4. 국면    — feaas.classifier : detect_regime + regime_reasons(PM 확정 규칙,
               부족 → None + 사유)
  5. 배분    — feaas.backtest  : REGIME_ALLOCATIONS(v1 국면 프리셋) 매핑,
               null → 기준 배분(무보정 — 국면 강제 배정 금지)
  6. 리포트  — feaas.report    : build_state + validate_state → data/state.json
  7. 백테스트— feaas.backtest : 프록시 5종 월수익 × 국면 시프트 배분(+60/40·무보정
               비교 기준선) → out/backtest.json + .md

종료 코드: 0 = state.json 산출 성공(백테스트 레그 스킵은 WARN 출력과 [note] 사유로
보고), 2 = state 스키마 무효(파일 미산출) 또는 지표 전무, 그 외 argparse/IO 오류.
backtest.json 부재 = 프록시 데이터 부족으로 스킵된 것 — 출력 [note] 행을 참조한다.

네트워크·FS는 sources(수집)와 본 진입점(산출 파일 쓰기)만 접한다 — 코어 계층은
순수 함수 유지. 월간 배치 크론은 CEO 세션이 직접 운영한다 — 본 엔진에 크론 등록
포함 금지(req-v2 §4), 실행 절차만 README에 문서화된다.
"""

from __future__ import annotations

import argparse
import calendar
import json
import sys
from bisect import bisect_right
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from feaas import backtest, classifier, indicators, report, scores, sources  # noqa: E402
from feaas.backtest import (  # noqa: E402
    BASIS_ALLOCATION,
    COST_PER_TRADE_DEFAULT,
    DEFAULT_CRISIS_WINDOWS,
    REGIME_ALLOCATIONS,
    RECENT_MONTHS,
)
from feaas.classifier import REGIME_LABELS  # noqa: E402
from feaas.indicators import ELEMENTS  # noqa: E402
from feaas.report import DRAFT_PROXY_NOTE, build_state, validate_state  # noqa: E402

Series = list[tuple[str, float | None]]
SeriesLoader = Callable[[str, str], Series | None]

PIPELINE_STEPS: tuple[str, ...] = (
    "sources.fetch",
    "indicators.map",
    "scores.standardize",
    "classifier.detect",
    "backtest.run",
    "report.build_state",
)

MONTHS_HISTORY: int = 6  # 국면 규칙 '6개월 전' 이력 깊이(req-v2 §2 — classifier.MONTHS_LOOKBACK)

# 백테스트 자산 프록시(PM 확정 — req-v2 §3). 화: cl.f 실측 불가 시 gld.us 폴백.
# 수: req 표기 'IRX'는 fredgraph 404(② 실측 2026-11-02 — 카드 코멘트, 야후 심볼
# 관행) → fredgraph 검증 시리즈 DTB3(3M T-bill)로 대체. README v2a ③ 섹션 병기.
PROXY_ASSETS: dict[str, tuple[tuple[str, str], ...]] = {
    "목": (("stooq", "^spx"),),
    "화": (("stooq", "cl.f"), ("stooq", "gld.us")),
    "토": (("stooq", "vnq.us"),),
    "금": (("stooq", "iet.us"),),
    "수": (("fred", "DTB3"),),
}

# 비교 기준선 — 60/40(^spx 60 + iet.us 40)은 오행 좌표계로 목 60·금 40(프록시 대응).
FIXED_60_40: dict[str, float] = {"목": 60.0, "화": 0.0, "토": 0.0, "금": 40.0, "수": 0.0}

BASIS_ALLOCATION_LABEL: str = "무보정 오행 고정(木30 火10 土20 金25 水15 — v1 기준 배분 재사용)"

PROXY_NOTES: tuple[str, ...] = (
    "프록시 한계: 각 오행 자산은 단일 공개 프록시로 근사한다 — 目=S&P 500(^spx), "
    "火=WTI 원유 계약(cl.f, 실측 불가 시 GLD gld.us), 土=미국 REIT ETF(vnq.us), "
    "金=중기 국채 ETF(iet.us), 水=3M T-bill 금리(DTB3). 추적 오차·ETF 보유 비용·"
    "원유 선물 롤오버 효과는 반영되지 않는다(req-v2 §3).",
    "水(초단기 금리)는 가격이 아닌 연율 금리 시리즈 — 월수익 = 연율/12의 근사 변환을 "
    "적용한다(T-bill 무위험 수익 근사).",
    "국면 판정이 None인 월은 기준 배분(무보정 오행 고정)으로 운용한다 — 국면을 강제 "
    "배정하지 않는 req-v2 §2 정책의 배분 확장이며, 사유는 백테스트 노트로 기록된다.",
    "이 백테스트는 규칙 기반 v2a의 한계를 정량화하는 게 목적이며, 수익 우위는 필수가 "
    "아니다(req-v2 §3) — 결과는 그대로 보고된다.",
)


# ─── 로더(수집 격리 — 유일하게 sources·FS·네트워크에 접근하는 부분) ────────────
def make_fixture_loader(fixtures_dir: Path, notes: list[str]) -> SeriesLoader:
    """fixture 모드 로더 — 로컬 CSV만 읽는다(네트워크 호출 0, 테스트·오프라인 재현용).

    FRED: fredgraph_<ID>*.csv 중 데이터 행이 가장 많은 파일(헤더 시리즈 ID로 검증).
    Stooq: stooq_<심볼 변형>*.csv(예: ^spx→spx, cl.f→cl_f) 첫 매칭 파일.
    """
    root = Path(fixtures_dir)
    if not root.is_dir():
        raise ValueError(f"fixture 디렉터리 없음: {root}")
    cache: dict[tuple[str, str], Series | None] = {}

    def loader(kind: str, key: str) -> Series | None:
        memo = cache.get((kind, key), False)
        if memo is not False:
            return memo  # type: ignore[return-value]
        series: Series | None = None
        if kind == "fred":
            for path in sorted(root.glob(f"fredgraph_{key}*.csv")):
                try:
                    parsed = sources.parse_fred_csv(path.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    continue
                if series is None or len(parsed) > len(series):
                    series = parsed  # 중복 fixture(레거시 샘플 등)는 더 긴 쪽 채택
        elif kind == "stooq":
            for variant in _symbol_variants(key):
                for path in sorted(root.glob(f"stooq_{variant}*.csv")):
                    try:
                        series = sources.parse_stooq_csv(path.read_text(encoding="utf-8"))
                    except (ValueError, OSError):
                        series = None
                        continue
                    break
                if series is not None:
                    break
        else:
            raise ValueError(f"알 수 없는 소스 종류: {kind!r}")
        cache[(kind, key)] = series
        return series

    return loader


def make_fetch_loader(
    *, cache_dir: Path | None = None, refresh: bool = False, notes: list[str]
) -> SeriesLoader:
    """실측 fetch 로더 — sources.fetch_*(캐시 우선, refresh=True 재수집).

    캐시 히트(refresh=False) 시 네트워크 호출 없음. 전 시도 실패는 FetchError →
    None + 사유 기록(파이프라인이 지표를 강제로 만들지 않는다 — req-v2 §2).
    Stooq는 JS proof-of-work 챌린지면(200·HTML, ② 관측 2026-11-02) 실패 가능성이
    있으며, 실패 시 WARN 사유로 기록된다 — README v2a ③ 섹션 병기.
    """

    def loader(kind: str, key: str) -> Series | None:
        try:
            if kind == "fred":
                return sources.fetch_fred(key, cache_dir=cache_dir, refresh=refresh)
            if kind == "stooq":
                return sources.fetch_stooq(key, cache_dir=cache_dir, refresh=refresh)
            raise ValueError(f"알 수 없는 소스 종류: {kind!r}")
        except (sources.FetchError, ValueError, OSError) as exc:
            notes.append(f"수집 실패: {kind}/{key} — {exc}")
            return None

    return loader


def _symbol_variants(symbol: str) -> tuple[str, ...]:
    """stooq 심볼 → fixture 파일명 접두 변형(^spx→spx, cl.f→cl_f·cl.f)."""
    bare = symbol.lstrip("^=")
    seen: list[str] = []
    for candidate in (bare, bare.replace(".", "_"), symbol, symbol.replace(".", "_")):
        if candidate and candidate not in seen:
            seen.append(candidate)
    return tuple(seen)


# ─── 지표 → 월별 오행 지수(순수 조합 — ② 함수 계약 재사용) ──────────────────────
def collect_standardized(
    loader: SeriesLoader, notes: list[str]
) -> dict[indicators.IndicatorDef, Series]:
    """지표 정의 17종 × 로더 → 표준화 Series(standardize_indicator 순수 재사용).

    수집 실패·전 구간 부족(10년 창 미달 → None) 지표는 결과에서 생략 + 사유 기록 —
    나머지 지표로만 오행 지수를 계산한다(강제 매칭 금지, req-v2 §2).
    """
    standardized: dict[indicators.IndicatorDef, Series] = {}
    for ind in indicators.INDICATOR_DEFS:
        series: Series | None = None
        for key in ind.ids:
            fetched = loader(ind.source, key)
            if fetched:
                series = fetched
                break
        if not series:
            notes.append(f"수집 실패: {ind.element}·{ind.name}({','.join(ind.ids)}) — 지표 누락")
            continue
        std = scores.standardize_indicator(series, transform=ind.transform, inverse=ind.inverse)
        if all(pct is None for _, pct in std):
            notes.append(
                f"표준화 부족(10년 창 미달): {ind.element}·{ind.name}({ind.ids[0]}) — 전 구간 None"
            )
            standardized[ind] = std
            continue
        standardized[ind] = std
    return standardized


def _month_end(month: str) -> str:
    """'YYYY-MM' → 해당 월 말일 ISO 날짜(as-of 조인 컷오프·백테스트 결산일)."""
    year, month_no = int(month[:4]), int(month[5:7])
    return date(year, month_no, calendar.monthrange(year, month_no)[1]).isoformat()


def monthly_element_scores(
    standardized: Mapping[indicators.IndicatorDef, Series],
) -> tuple[list[str], dict[str, list[int | None]]]:
    """지표 관측 월들의 유니온 월 그리드에서 오행 지수 5종을 월별 산출.

    지표별 최신 as-of percentile(월 말일 기준) → element_score(오행 평균 round,
    전부 None이면 None — 누락 표기). 반환: (오름차순 월 그리드, {오행: 월별 지수}).
    """
    months = sorted({d[:7] for series in standardized.values() for d, _ in series})
    snapshots: dict[indicators.IndicatorDef, tuple[list[str], list[float | None]]] = {
        ind: ([d for d, _ in series], [pct for _, pct in series])
        for ind, series in standardized.items()
    }
    by_element: dict[str, list[int | None]] = {el: [] for el in ELEMENTS}
    for month in months:
        cutoff = _month_end(month)
        for el in ELEMENTS:
            pcts: list[float | None] = []
            for ind in indicators.indicators_for(el):
                dates, pcts_all = snapshots.get(ind, ([], []))
                idx = bisect_right(dates, cutoff) - 1
                pcts.append(pcts_all[idx] if idx >= 0 else None)
            by_element[el].append(scores.element_score(pcts))
    return months, by_element


def _rows_by_month(
    grid: Sequence[str], by_element: Mapping[str, Sequence[int | None]]
) -> dict[str, dict[str, int | None]]:
    return {month: {el: by_element[el][i] for el in ELEMENTS} for i, month in enumerate(grid)}


def classify_row(
    month: str,
    rows: Mapping[str, Mapping[str, int | None]],
    grid: Sequence[str],
) -> tuple[str | None, list[str]]:
    """단일 월 국면 판정 — 이전 월 이력(최대 6개월)을 classifier에 전달(순수 재사용)."""
    current = dict(rows[month]) if month in rows else {el: None for el in ELEMENTS}
    prior = [dict(rows[m]) for m in grid if m < month][-MONTHS_HISTORY:]
    regime = classifier.detect_regime(current, prior)
    return regime, classifier.regime_reasons(current, prior)


def rebalance_proposals(
    target: Mapping[str, float] | None,
) -> list[dict[str, float]]:
    """기준 배분(v1 木30 火10 土20 金25 水15) → 국면 목표 배분의 제안 리밸런싱 행."""
    if target is None:
        return []
    return [
        {
            "element": el,
            "basis_pct": float(BASIS_ALLOCATION[el]),
            "target_pct": float(target[el]),
            "delta_pct": round(float(target[el]) - float(BASIS_ALLOCATION[el]), 6),
        }
        for el in ELEMENTS
    ]


# ─── state.json 리포트 ────────────────────────────────────────────────────────
def build_report_state(
    *,
    grid: Sequence[str],
    by_element: Mapping[str, Sequence[int | None]],
    notes: Sequence[str],
    generated_at: datetime | None = None,
) -> dict[str, object]:
    """state.json 스키마 dict 구성 — 현재 월 지수·국면·근거·목표 배분·제안.

    국면 판정에는 직전 최대 6개월 이력을 전달하고, 수집·표준화 사유는 판정 근거에
    별도 행으로 덧붙인다(부족 지표 명기 — req-v2 §2).
    """
    rows = _rows_by_month(grid, by_element)
    current_month = grid[-1]
    current = rows[current_month]
    history = [dict(rows[m]) for m in grid if m < current_month][-MONTHS_HISTORY:]
    regime = classifier.detect_regime(current, history)
    reasons = classifier.regime_reasons(current, history)
    reasons.extend(f"파이프라인 노트: {note}" for note in notes)
    target = dict(REGIME_ALLOCATIONS[regime]) if regime is not None else None
    generated = generated_at or datetime.now(timezone.utc)
    return build_state(
        generated_at=generated,
        element_scores={el: current[el] for el in ELEMENTS},
        regime=regime,
        regime_reasons=reasons,
        target_allocation=target,
        rebalance_proposals=rebalance_proposals(target),
        proxy_note=DRAFT_PROXY_NOTE,
    )


def state_to_json(state: Mapping[str, object]) -> str:
    """state dict → JSON 텍스트 — generated_at은 ISO 8601(UTC) 문자열 직렬화."""
    payload: dict[str, object] = dict(state)
    generated_at = payload.get("generated_at")
    if isinstance(generated_at, datetime):
        payload["generated_at"] = generated_at.astimezone(timezone.utc).isoformat()
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _atomic_write_text(path: Path, text: str) -> Path:
    """tmp→replace 원자적 쓰기(② sources.save_cache와 동일 계약)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return path


# ─── 백테스트 레그 ─────────────────────────────────────────────────────────────
def asset_returns_by_element(
    loader: SeriesLoader, notes: list[str]
) -> tuple[dict[str, Series], dict[str, str]]:
    """프록시 5종 → 월수익 Series({오행: [(월, 수익)]}) + 채택 프록시 키.

    프록시 선택은 PROXY_ASSETS 폴백 순서(화: cl.f → gld.us). 水(3M T-bill 금리)는
    가격이 아니라 연율 수준 — 월수익 = (연율/100)/12 근사 변환(README 병기).
    """
    returns: dict[str, Series] = {}
    used: dict[str, str] = {}
    for element, candidates in PROXY_ASSETS.items():
        series: Series | None = None
        chosen: tuple[str, str] | None = None
        for candidate in candidates:
            series = loader(candidate[0], candidate[1])
            if series:
                chosen = candidate
                break
        if series is None or chosen is None:
            notes.append(
                f"프록시 수집 실패: {element}({','.join(key for _, key in candidates)}) — 백테스트 레그 스킵"
            )
            continue
        month_closes = backtest.month_end_close(series)
        try:
            if element == "수":
                raw: Series = [
                    (month, (value / 100.0) / 12.0)
                    for month, value in _month_levels(month_closes)
                ]
            else:
                raw = [
                    (d[:7], ret) for d, ret in backtest.monthly_returns_from_prices(month_closes)
                ]
        except ValueError as exc:
            notes.append(f"프록시 변환 실패: {element}({chosen[1]}) — {exc}")
            continue
        returns[element] = raw
        used[element] = chosen[1]
    return returns, used


def _month_levels(month_closes: Sequence[tuple[str, float | None]]) -> list[tuple[str, float]]:
    """월말 수준 Series → (월 키, 수준) — 금리처럼 '가격 아닌 수준' 시리즈용."""
    return [(d[:7], value) for d, value in month_closes if value is not None]


def _aligned_result(
    *,
    allocations_by_month: Sequence[Mapping[str, float]],
    returns_by_month: Sequence[Mapping[str, float]],
    month_ends: Sequence[str],
) -> backtest.BacktestResult:
    return backtest.run_backtest(
        list(allocations_by_month),
        list(returns_by_month),
        cost_per_trade=COST_PER_TRADE_DEFAULT,
        dates=list(month_ends),
        crisis_windows=DEFAULT_CRISIS_WINDOWS,
    )


def _recent_months(months: Sequence[str], months_back: int) -> list[str]:
    """최근 N개월 절삭 — backtest.recent_window 규격 재사용(월 키 오름차순 전제)."""
    pivoted = backtest.recent_window([(m, 1.0) for m in months], months_back=months_back)
    return [m for m, _ in pivoted]


def run_backtest_leg(
    *,
    loader: SeriesLoader,
    grid: Sequence[str],
    by_element: Mapping[str, Sequence[int | None]],
    months_back: int = RECENT_MONTHS,
    notes: list[str],
) -> tuple[str, dict[str, dict[str, object]], list[str], dict[str, str]] | None:
    """국면 시프트 + 비교 기준선 2종 백테스트 — 산출 직렬화 직전까지(순수 조합).

    - 국면 월별 배분: REGIME_ALLOCATIONS(v1 프리셋, 재설계 금지), 판정 None 월은
      기준 배분(무보정) 운용 — 국면 강제 배정 금지(req-v2 §2), 노트 기록.
    - 기준선: 60/40(목 60·금 40)과 무보정 오행 고정 배분(req-v2 §3).
    - 프록시 5종이 모두 존재하고 지수 그리드와 정렬된 월 ≥2가 아니면 None(스킵)+사유.

    반환: (제목, {전략명: 결과}, 정렬 월, 채택 프록시) 또는 None.
    """
    returns_by_element, used = asset_returns_by_element(loader, notes)
    if set(returns_by_element) != set(ELEMENTS):
        return None
    common_months: set[str] = set.intersection(
        *({m for m, _ in series} for series in returns_by_element.values())
    )
    aligned = _recent_months(
        sorted(common_months & set(grid)), months_back
    )
    if len(aligned) < 2:
        notes.append(
            f"백테스트 스킵: 지수·프록시 정렬 월 부족({len(common_months & set(grid))}개월) — "
            f"최근 {months_back}개월 요청(req-v2 §3)"
        )
        return None

    rows = _rows_by_month(grid, by_element)
    allocations: list[dict[str, float]] = []
    null_regime_months = 0
    for month in aligned:
        regime, _ = classify_row(month, rows, grid)
        if regime is None:
            null_regime_months += 1
            allocations.append(dict(BASIS_ALLOCATION))
        else:
            allocations.append(dict(REGIME_ALLOCATIONS[regime]))
    if null_regime_months:
        notes.append(
            f"국면 판정 None 월 {null_regime_months}개 — 기준 배분(무보정) 운용(판정 강제 금지)"
        )

    lookup = {el: dict(series) for el, series in returns_by_element.items()}
    returns_rows = [{el: lookup[el][month] for el in ELEMENTS} for month in aligned]
    month_ends = [_month_end(m) for m in aligned]

    regime_shift = _aligned_result(
        allocations_by_month=allocations, returns_by_month=returns_rows, month_ends=month_ends
    )
    baseline_60_40 = _aligned_result(
        allocations_by_month=[dict(FIXED_60_40)] * len(aligned),
        returns_by_month=returns_rows,
        month_ends=month_ends,
    )
    baseline_fixed = _aligned_result(
        allocations_by_month=[dict(BASIS_ALLOCATION)] * len(aligned),
        returns_by_month=returns_rows,
        month_ends=month_ends,
    )
    label = (
        f"FEAAS v2a 국면→배분 시프트 백테스트 "
        f"({aligned[0]}~{aligned[-1]} {len(aligned)}개월, 거래비용 0.1%/회)"
    )
    return (
        label,
        {
            "regime_shift": dict(asdict(regime_shift)),
            "baseline_60_40": dict(asdict(baseline_60_40)),
            "baseline_fixed_elements": dict(asdict(baseline_fixed)),
        },
        aligned,
        used,
    )


def backtest_to_json(
    *,
    label: str,
    strategies: Mapping[str, Mapping[str, object]],
    months: Sequence[str],
    used_proxies: Mapping[str, str],
    notes: Sequence[str],
) -> str:
    """백테스트 결과 → engine/out/backtest.json 본문(req-v2 §3 리포트)."""
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "label": label,
        "window": {"months": len(months), "first": months[0], "last": months[-1]},
        "asset_proxies": dict(used_proxies),
        "cost_per_trade": COST_PER_TRADE_DEFAULT,
        "strategies": dict(strategies),
        "proxy_limitations": list(PROXY_NOTES),
        "notes": list(notes),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def backtest_to_markdown(
    *,
    label: str,
    strategies: Mapping[str, Mapping[str, object]],
    months: Sequence[str],
    used_proxies: Mapping[str, str],
    notes: Sequence[str],
) -> str:
    """out/backtest.md 본문 — JSON 요약표 + 프록시 한계 고지(req-v2 §3)."""
    strategy_names = (
        ("regime_shift", "국면 시프트(v1 프리셋)"),
        ("baseline_60_40", "60/40"),
        ("baseline_fixed_elements", BASIS_ALLOCATION_LABEL),
    )

    def pct(value: object) -> str:
        return f"{float(value) * 100:.2f}%" if isinstance(value, (int, float)) else "n/a"

    proxies_line = " · ".join(f"{el}={key}" for el, key in used_proxies.items())
    lines = [
        f"# {label}",
        "",
        f"- 기간: {months[0]}~{months[-1]}({len(months)}개월) — 데이터 존재 범위 내 최근 15년 요청(req-v2 §3)",
        f"- 자산 프록시: {proxies_line}",
        "- 회계: 월말 리밸런싱 · 거래비용 0.1%/회 차감 · 복리 NAV",
        "",
        "| 지표 | 국면 시프트(v1 프리셋) | 60/40 | 무보정 오행 고정 |",
        "|---|---|---|---|",
    ]
    rows = (
        ("연율화 수익(CAGR)", "cagr", pct),
        ("연율화 변동성", "vol", pct),
        ("MDD(고점 대비 최대 하락)", "mdd", pct),
        ("샤프(rf=0)", "sharpe", lambda v: f"{float(v):.2f}"),
        ("거래비용 총액", "trading_costs", pct),
    )
    for title, field, fmt in rows:
        cells = " | ".join(fmt(strategies[key].get(field)) for key, _ in strategy_names)
        lines.append(f"| {title} | {cells} |")

    crisis_keys = sorted(strategies["regime_shift"].get("crisis_defense") or {})
    for crisis in crisis_keys:
        cells = []
        for key, _ in strategy_names:
            defense = strategies[key].get("crisis_defense") or {}
            cells.append(
                pct(defense[crisis]) if crisis in defense else "n/a(구간 외·관측 부족)"
            )
        lines.append(f"| 위기 방어도 {crisis} | {' | '.join(cells)} |")
    lines += [
        "",
        "## 프록시 한계 고지",
        *[f"- {note}" for note in PROXY_NOTES],
        "",
        "> 수익 우위 필수 아님 — 규칙 기반 v2a의 한계를 정량화하는 게 목적(req-v2 §3).",
        "",
    ]
    return "\n".join(lines)


# ─── 진입점 ───────────────────────────────────────────────────────────────────
def main(argv: Sequence[str] | None = None) -> int:
    """배치 실행 — README 「FEAAS v2a ③ — 배치 파이프라인」 절차를 그대로 수행한다."""
    parser = argparse.ArgumentParser(
        prog="run_pipeline",
        description=(
            "FEAAS v2a 배치 — 지수 5종·국면 판정·state.json(+백테스트 리포트) 산출. "
            "월간 크론은 CEO 세션 관할(req-v2 §4)."
        ),
    )
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=None,
        help="fixture CSV 디렉터리 — 지정 시 네트워크 호출 0(로컬 파일만 사용)",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=ENGINE_DIR / "data" / "cache",
        help="sources 캐시 디렉터리(기본 engine/data/cache)",
    )
    parser.add_argument("--refresh", action="store_true", help="캐시 무시하고 실측 fetch 재수집")
    parser.add_argument(
        "--state-path",
        type=Path,
        default=ENGINE_DIR / "data" / "state.json",
        help="state.json 출력 경로(기본 engine/data/state.json)",
    )
    parser.add_argument(
        "--out-dir", type=Path, default=ENGINE_DIR / "out", help="백테스트 산출 디렉터리(기본 engine/out)"
    )
    parser.add_argument("--no-backtest", action="store_true", help="백테스트 레그 생략(state.json만 산출)")
    parser.add_argument(
        "--months-back",
        type=int,
        default=RECENT_MONTHS,
        help=f"백테스트 최근 개월 수(기본 {RECENT_MONTHS} = 15년)",
    )
    args = parser.parse_args(argv)

    notes: list[str] = []
    if args.fixtures is not None:
        loader = make_fixture_loader(args.fixtures, notes)
        notes.append("모드: fixture(로컬 CSV만 — 네트워크 호출 없음)")
    else:
        loader = make_fetch_loader(cache_dir=args.cache_dir, refresh=args.refresh, notes=notes)
        notes.append("모드: fetch+캐시(캐시 히트 외 실측 네트워크 사용)")

    standardized = collect_standardized(loader, notes)
    grid, by_element = monthly_element_scores(standardized)
    if not grid:
        print("[ERROR] 지표 데이터 전무 — state.json 미산출(강제 매칭 금지, req-v2 §2)")
        return 2

    state = build_report_state(grid=grid, by_element=by_element, notes=notes)
    errors = validate_state(state)
    if errors:
        print("[ERROR] state 스키마 무효 — state.json 미산출:")
        for message in errors:
            print(f"  - {message}")
        return 2

    state_path = _atomic_write_text(Path(args.state_path), state_to_json(state))
    rows = _rows_by_month(grid, by_element)
    print(f"[state.json] {state_path}")
    print(
        f"  기준 월: {grid[-1]} · 지수: "
        + " ".join(f"{el}={rows[grid[-1]][el]}" for el in ELEMENTS)
    )
    print(f"  국면: {state['regime']} (라벨: {REGIME_LABELS.get(str(state['regime']), '—')})")
    for note in notes:
        print(f"  [note] {note}")

    if args.no_backtest:
        return 0
    outcome = run_backtest_leg(
        loader=loader, grid=grid, by_element=by_element, months_back=args.months_back, notes=notes
    )
    if outcome is None:
        print("[WARN] 백테스트 레그 스킵 — 프록시/정렬 월 부족(사유는 위 [note] 행 참조)")
        return 0
    label, strategies, months, used_proxies = outcome
    out_dir = Path(args.out_dir)
    json_path = _atomic_write_text(
        out_dir / "backtest.json",
        backtest_to_json(
            label=label,
            strategies=strategies,
            months=months,
            used_proxies=used_proxies,
            notes=notes,
        ),
    )
    md_path = _atomic_write_text(
        out_dir / "backtest.md",
        backtest_to_markdown(
            label=label,
            strategies=strategies,
            months=months,
            used_proxies=used_proxies,
            notes=notes,
        ),
    )
    print(f"[backtest] {json_path}")
    print(f"[backtest] {md_path}")
    print(f"  기간: {months[0]}~{months[-1]} · {len(months)}개월 · 프록시: {dict(used_proxies)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())