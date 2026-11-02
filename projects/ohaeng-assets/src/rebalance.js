/**
 * rebalance.js — requirements 7장 리밸런싱 힌트: "|현재 비중 − 목표 비중| ≥ 5%p인 자산군만 이동 제안".
 *
 * 순수 계산 모듈(req 8장). 자동 리밸런싱이 아니다 — 제안(힌트)만 계산하며,
 * 자동 실행 로직은 v2 범위로 절대 포함하지 않는다(docs/v2-ideas.md).
 */

import { ELEMENTS } from './vectors.js';

/** 리밸런싱 제안 트리거(%p). 격차 ≥ 5%p인 오행만 제안한다(7장 "경계 4.99%는 제안 없음"). */
export const REBALANCE_TRIGGER_PCT = 5;

/** 5오행 분포 객체 형상 검증 — 키 완전·유한수. 합계 100 검증은 하지 않는다(요소별 격차 규칙). */
function validatedDistribution(value, label) {
  if (value === null || typeof value !== 'object') {
    throw new Error(`${label}: 5오행 분포 객체여야 한다`);
  }
  const complete = Object.keys(value).length === ELEMENTS.length && ELEMENTS.every((el) => el in value);
  if (!complete) {
    throw new Error(`${label}: 5오행(木·火·土·金·水) 분포 객체여야 한다 — 누락·추가 키는 거부한다`);
  }
  for (const el of ELEMENTS) {
    const v = value[el];
    if (!Number.isFinite(v)) {
      throw new Error(`${label}: 각 오행 값은 유한한 수여야 한다 (${el}=${String(v)})`);
    }
  }
}

/**
 * 현재 분포와 목표 배분의 격차 → 이동 제안 목록.
 *
 * 규칙(② 티켓 t_27551fb2 확정 — tests/rebalance.test.js로 고정):
 *  - 격차는 오행별 |현재 − 목표|를 계산한 뒤 소수점 둘째 자리에서 반올림(Math.round)한 값
 *    (%p 2자리)으로 트리거 비교와 보고를 둘 다 한다 — 부동소수 표시 잡음(예: 20.01−25 =
 *    4.990000000000002)이 4.99/5.00 경계를 뒤집지 않게 하기 위함.
 *  - 격차 ≥ REBALANCE_TRIGGER_PCT인 오행만 제안에 포함하고, 순서는 ELEMENTS(木火土金水) 고정
 *    순서다. direction: 현재 < 목표 → 'increase', 현재 > 목표 → 'decrease'.
 *  - 제안이 필요 없으면 빈 배열 — 빈 배열이 "제안 없음"을 의미한다.
 *
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} current 현재 오행 분포(%)
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} target 목표 배분(%)
 * @returns {Array<{element: '木'|'火'|'土'|'金'|'水', gapPct: number,
 *                   direction: 'increase'|'decrease'}>} |현재−목표| ≥ 5%p인 항목만(ELEMENTS 순서).
 * @throws current·target 형상 위반(5오행 키 외·비유한수·객체 아님)
 */
export function suggestRebalance(current, target) {
  validatedDistribution(current, 'suggestRebalance: current');
  validatedDistribution(target, 'suggestRebalance: target');
  const suggestions = [];
  for (const el of ELEMENTS) {
    // 2자리 반올림으로 경계를 판정한다(+0.005 이내 노이즈 흡수 — 4.99는 제안 없음이 유지된다).
    const gapPct = Math.round(Math.abs(current[el] - target[el]) * 100) / 100;
    if (gapPct < REBALANCE_TRIGGER_PCT) continue;
    suggestions.push({
      element: el,
      gapPct,
      direction: current[el] < target[el] ? 'increase' : 'decrease',
    });
  }
  return suggestions;
}