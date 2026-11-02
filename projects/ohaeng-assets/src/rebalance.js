/**
 * rebalance.js — requirements 7장 리밸런싱 힌트: "|현재 비중 − 목표 비중| ≥ 5%p인 자산군만 이동 제안".
 *
 * 순수 계산 모듈(req 8장). 자동 리밸런싱이 아니다 — 제안(힌트)만 계산하며,
 * 자동 실행 로직은 v2 범위로 절대 포함하지 않는다(docs/v2-ideas.md).
 */

/** 리밸런싱 제안 트리거(%p). 경계 값은 포함(≥): 7장 "경계 4.99%는 제안 없음". */
export const REBALANCE_TRIGGER_PCT = 5;

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 현재 분호와 목표 배분의 격차 → 이동 제안 목록.
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} current 현재 오행 분포(%)
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} target 목표 배분(%, 합계 100)
 * @returns {Array<{element: '木'|'火'|'土'|'金'|'水', gapPct: number,
 *                   direction: 'increase'|'decrease'}>} |현재−목표| ≥ REBALANCE_TRIGGER_PCT인 항목만.
 *   제안이 필요 없으면 빈 배열(빈 배열은 "제안 없음"을 의미한다).
 */
export function suggestRebalance(current, target) {
  notImplemented('suggestRebalance(current, target)');
}