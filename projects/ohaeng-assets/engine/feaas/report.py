"""리포트 계층 — 웹앱 실측 모드용 state.json 구성·스키마 검증(순수, req-v2 §4).

engine 배치가 data/state.json을 생성: {생성시각, 지수 5종, 국면, 판정 근거, 목표
배분, 제안 리밸런싱, 프록시 한계 고지}. 파일 쓰기는 run_pipeline 진입점이 담당하고
본 모듈은 순수 dict 구성·검증만 한다. 웹 app.js는 state.json 존재 시 "실측 모드
(배치 시각)" 배너 + 값 반영, 부재 시 기존 수동 모드 유지(회귀 없음).

스키마 키(snake_case — README v2a ③ 섹션에 한글 대응 병기):
  generated_at(생성시각) · element_scores(지수 5종) · regime(국면) ·
  regime_reasons(판정 근거) · target_allocation(목표 배분) ·
  rebalance_proposals(제안 리밸런싱) · proxy_note(프록시 한계 고지)

validate_state는 예외 대신 오류 메시지 list를 반환한다(빈 list = 유효): 스키마
검증이 예외를 던지면 배치가 조용한 무결성 위반을 낼 수 없게 하는 req-v2 전통.
어떤 입력(가비지 포함)에도 예외를 던지지 않는 것이 계약이다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone

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

ELEMENT_KEYS: tuple[str, ...] = ("목", "화", "토", "금", "수")  # 目·火·土·金·水 5종 고정
REGIME_CODES: tuple[str, ...] = ("A", "B", "C", "D", "E")  # 국면 코드(판정 불가는 None)
REBALANCE_ROW_FIELDS: tuple[str, ...] = ("element", "basis_pct", "target_pct", "delta_pct")

_ALLOCATION_SUM: float = 100.0  # 목표 배분 행 합계(%p) — backtest.ALLOCATION_SUM 동일 규격
_ALLOCATION_SUM_TOL: float = 1e-6  # 합계 허용 오차 — backtest.ALLOCATION_TOLERANCE 동일
_SCORE_TOL: float = 1e-9


def _is_number(value: object) -> bool:
    """숫자만 통과(bool은 int 상속이라 명시 배제)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _normalize_rows(rows: Sequence[Mapping[str, float]] | object | None) -> object:
    """rebalance_proposals를 방어적으로 행 list로 정규화(비반복형은 원본 보존).

    build_state는 어떤 입력에도 예외를 던지지 않고, 오염 형태는 validate_state가
    보고한다(원본 형태 보존이 그 검증을 가능하게 함).
    """
    if rows is None:
        return None
    if isinstance(rows, Mapping):
        return [dict(rows)]
    if isinstance(rows, str):
        return list(rows)  # 문자열은 반복형 — 문자 단위 오염 행으로 보존
    try:
        return [dict(row) if isinstance(row, Mapping) else row for row in rows]
    except TypeError:
        return [rows]


def build_state(
    *,
    generated_at: datetime | str | None = None,
    element_scores: Mapping[str, float | None] | None = None,
    regime: str | None = None,
    regime_reasons: Sequence[str] | None = None,
    target_allocation: Mapping[str, float] | None = None,
    rebalance_proposals: Sequence[Mapping[str, float]] | None = None,
    proxy_note: str = DRAFT_PROXY_NOTE,
) -> dict[str, object]:
    """state.json 스키마 dict을 구성한다(파일 쓰기 없음 — run_pipeline 책임).

    generated_at 미지정 시 tz-aware UTC 현재시각을 기본값으로 채운다. 국면=None
    경로(데이터 부족 → 강제 매칭 금지, req-v2 §2)에서는 target_allocation=None·
    rebalance_proposals=[] 조합을 허용한다. 유효성은 validate_state가 검사하므로
    본 함수는 어떤 입력에도 예외를 던지지 않는다.
    """
    if generated_at is None:
        generated_at = datetime.now(timezone.utc)
    return {
        "generated_at": generated_at,
        "element_scores": (
            dict(element_scores) if isinstance(element_scores, Mapping) else element_scores
        ),
        "regime": regime,
        "regime_reasons": (
            list(regime_reasons) if isinstance(regime_reasons, Sequence) else regime_reasons
        ),
        "target_allocation": (
            dict(target_allocation) if isinstance(target_allocation, Mapping) else target_allocation
        ),
        "rebalance_proposals": _normalize_rows(rebalance_proposals),
        "proxy_note": proxy_note,
    }


def _validate_generated_at(generated_at: object) -> list[str]:
    """생성시각 검증 — tz-aware datetime 또는 tz-aware ISO 8601 문자열."""
    if isinstance(generated_at, datetime):
        if generated_at.tzinfo is None:
            return [f"generated_at: tz-aware datetime 필요 — naive {generated_at!r}"]
        return []
    if isinstance(generated_at, str):
        try:
            parsed = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        except ValueError:
            return [f"generated_at: ISO 8601 파싱 실패 — {generated_at!r}"]
        if parsed.tzinfo is None:
            return [f"generated_at: tz-aware ISO 8601 필요 — naive {generated_at!r}"]
        return []
    return [
        f"generated_at: tz-aware datetime 또는 ISO 8601 문자열 필요 — {generated_at!r}"
    ]


def _validate_element_scores(element_scores: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(element_scores, Mapping):
        errors.append(
            f"element_scores: 오행 5종 지수 dict 필요 — {type(element_scores).__name__}"
        )
        return errors
    if set(element_scores.keys()) != set(ELEMENT_KEYS):
        errors.append(
            f"element_scores: 키는 오행 5종({ELEMENT_KEYS}) 필요 — "
            f"{sorted(map(repr, element_scores.keys()))}"
        )
    for key, score in element_scores.items():
        if score is None:
            continue  # 데이터 부족 지표의 None(누락 표기) 허용 — req-v2 §2
        if not _is_number(score):
            errors.append(f"element_scores[{key}]: 0~100 숫자 또는 None 필요 — got {score!r}")
        elif not (-_SCORE_TOL <= float(score) <= 100.0 + _SCORE_TOL):
            errors.append(f"element_scores[{key}]: 0~100 범위 필요 — got {score!r}")
    return errors


def _validate_target_allocation(target_allocation: object) -> list[str]:
    errors: list[str] = []
    if target_allocation is None:
        return errors
    if not isinstance(target_allocation, Mapping):
        errors.append(
            f"target_allocation: dict 또는 None 필요 — {type(target_allocation).__name__}"
        )
        return errors
    if set(target_allocation.keys()) != set(ELEMENT_KEYS):
        errors.append(
            f"target_allocation: 키는 오행 5종({ELEMENT_KEYS}) 필요 — "
            f"{sorted(map(repr, target_allocation.keys()))}"
        )
    total = 0.0
    all_numeric = True
    for key, weight in target_allocation.items():
        if not _is_number(weight):
            errors.append(f"target_allocation[{key}]: 숫자 필요 — got {weight!r}")
            all_numeric = False
        else:
            if not (-_ALLOCATION_SUM_TOL <= float(weight) <= 100.0):
                errors.append(f"target_allocation[{key}]: 0~100 범위(음수 불가) — got {weight!r}")
            total += float(weight)
    if all_numeric and abs(total - _ALLOCATION_SUM) > _ALLOCATION_SUM_TOL:
        errors.append(
            f"target_allocation: 합계 {_ALLOCATION_SUM:.0f}%p 필요 — 합계 {total:.6g}%p"
        )
    return errors


def validate_state(state: Mapping[str, object]) -> list[str]:
    """스키마 검증 — 빈 list면 유효, 오류 메시지 list면 무효(req-v2 §5.5 재사용).

    어떤 입력에도 예외를 던지지 않는다(전체 방어 계약): Mapping이 아니면 단일 오류
    메시지, 필드 누락·모르는 필드·값 스키마 위반은 필드명이 포함된 메시지로 각각
    보고한다.
    """
    errors: list[str] = []
    if not isinstance(state, Mapping):
        return [f"state: dict(Mapping) 필요 — got {type(state).__name__}"]

    known = set(STATE_SCHEMA_FIELDS)
    present = set(state.keys())
    for field in sorted(known - present):
        errors.append(f"필수 필드 누락: {field}")
    for field in sorted(present - known):
        errors.append(f"알 수 없는 필드: {field}")

    errors.extend(_validate_generated_at(state.get("generated_at")))
    errors.extend(_validate_element_scores(state.get("element_scores")))

    regime = state.get("regime")
    if regime is not None:
        if not isinstance(regime, str) or regime not in REGIME_CODES:
            errors.append(
                f"regime: 국면 코드 {REGIME_CODES} 또는 None(판정 불가) 필요 — got {regime!r}"
            )

    reasons = state.get("regime_reasons")
    if not isinstance(reasons, list):
        errors.append(
            f"regime_reasons: 판정 근거 문자열 list 필요 — "
            f"{type(reasons).__name__ if not isinstance(reasons, str) else repr(reasons)}"
        )
    else:
        for index, reason in enumerate(reasons):
            if not isinstance(reason, str) or not reason.strip():
                errors.append(
                    f"regime_reasons[{index}]: 비어있지 않은 문자열 필요 — got {reason!r}"
                )

    errors.extend(_validate_target_allocation(state.get("target_allocation")))

    proposals = state.get("rebalance_proposals")
    if not isinstance(proposals, list):
        errors.append(
            f"rebalance_proposals: 제안 행 list 필요 — {type(proposals).__name__}"
        )
    else:
        for index, row in enumerate(proposals):
            if not isinstance(row, Mapping):
                errors.append(
                    f"rebalance_proposals[{index}]: dict 행 필요 — {type(row).__name__}"
                )
                continue
            for field in REBALANCE_ROW_FIELDS:
                if field not in row:
                    errors.append(f"rebalance_proposals[{index}].{field}: 필수 필드 누락")
            for field in row.keys():
                if field not in REBALANCE_ROW_FIELDS:
                    errors.append(
                        f"rebalance_proposals[{index}].{field}: 알 수 없는 필드"
                    )
            element = row.get("element")
            if "element" in row and (
                not isinstance(element, str) or element not in ELEMENT_KEYS
            ):
                errors.append(
                    f"rebalance_proposals[{index}].element: 오행 {ELEMENT_KEYS} 중 하나 필요 "
                    f"— got {element!r}"
                )
            for field in ("basis_pct", "target_pct", "delta_pct"):
                if field in row and not _is_number(row[field]):
                    errors.append(
                        f"rebalance_proposals[{index}].{field}: 숫자 필요 — got {row[field]!r}"
                    )

    note = state.get("proxy_note")
    if not isinstance(note, str) or not note.strip():
        errors.append(f"proxy_note: 비어있지 않은 문자열 필요 — got {note!r}")

    return errors