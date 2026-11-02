import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASIS_ALLOCATION, REBALANCE_TRIGGER_PCT, suggestRebalance } from '../src/index.js';

/**
 * rebalance 행위 테스트 — requirements.md 9장 수용기준 5번(리밸런싱 트리거 경계:
 * |현재−목표| = 5.00%p → 제안 있음, 4.99%p → 제안 없음) + 7장 트리거 규칙.
 *
 * ② 티켓 t_27551fb2가 정의·고정하는 규칙:
 *   1. 격차는 오행별로 |현재 − 목표|를 계산하고, 소수점 둘째 자리에서 반올림(Math.round, %p 2자리)
 *      한 값으로 트리거(REBALANCE_TRIGGER_PCT = 5) 비교와 보고(gapPct)를 둘 다 한다 —
 *      부동소수 표시 잡음(예: 20.01−25 = 4.990000000000002)이 경계를 뒤집지 않게 하기 위함.
 *   2. 격차 ≥ 5%p인 오행만 제안에 포함된다. 제안 항목 형상:
 *      { element, gapPct(2자리 반올림), direction: 현재<목표 → 'increase', 현재>목표 → 'decrease' }.
 *   3. 제안 순서는 ELEMENTS(木火土金水) 고정 순서다 — 판단 근거의 결정론적 재현.
 *   4. 제안이 필요 없으면 빈 배열을 반환한다(빈 배열 = "제안 없음").
 *   5. 입력은 5오행 분포 객체(키 완전·유한수)로 검증하며, 합계 100 여부는 검증하지 않는다 —
 *      격차가 오행별 독립 계산인 트리거 규칙(7장)은 요소별 비교가 본질이다.
 * RED 확인용: 스텁 단계에서는 TODO(t_27551fb2) 에러로 실패한다.
 */

test('수용기준 5 — 격차 5.00%p는 제안에 포함된다(트리거 경계 포함 ≥)', () => {
  // 현재 木35 vs 목표 木30 — 격차 5.00%p. 요소별 독립 격차 규칙이라 합계 100은 검증하지 않는다.
  const current = { 木: 35, 火: 10, 土: 20, 金: 25, 水: 15 };
  assert.deepEqual(suggestRebalance(current, BASIS_ALLOCATION), [
    { element: '木', gapPct: 5, direction: 'decrease' },
  ]);
});

test('수용기준 5 — 격차 4.99%p는 제안에 포함되지 않는다(경계 미만)', () => {
  // 현재 水19.99 vs 목표 水15 — 실수 계산값 4.990000000000002지만 2자리 반올림 4.99 < 5
  const current = { ...BASIS_ALLOCATION, 水: 19.99 };
  assert.deepEqual(suggestRebalance(current, BASIS_ALLOCATION), []);
});

test('트리거 규칙 — 격차 5.01%p는 제안에 포함되고 gapPct는 2자리 반올림으로 보고된다', () => {
  const current = { ...BASIS_ALLOCATION, 木: 35.01 };
  assert.deepEqual(suggestRebalance(current, BASIS_ALLOCATION), [
    { element: '木', gapPct: 5.01, direction: 'decrease' },
  ]);
});

test('트리거 규칙 — 증가·감소 방향이 모두 표시되고 순서는 ELEMENTS(木火土金水) 순이다', () => {
  // 현재 {木25,火15,土20,金25,水15} vs 기준 {木30,火10,土20,金25,水15}
  // 木 25<30 → increase(격차 5), 火 15>10 → decrease(격차 5) — 나머지 격차 0은 미포함
  const current = { 木: 25, 火: 15, 土: 20, 金: 25, 水: 15 };
  assert.deepEqual(suggestRebalance(current, BASIS_ALLOCATION), [
    { element: '木', gapPct: 5, direction: 'increase' },
    { element: '火', gapPct: 5, direction: 'decrease' },
  ]);
});

test('트리거 규칙 — 제안이 필요 없으면 빈 배열이다(완전 일치·경계 미만 모두)', () => {
  assert.deepEqual(suggestRebalance(BASIS_ALLOCATION, BASIS_ALLOCATION), [], '클릭 일치');
  const near = { ...BASIS_ALLOCATION, 土: 24 }; // 격차 4%p
  assert.deepEqual(suggestRebalance(near, BASIS_ALLOCATION), [], '4%p < 5%p');
});

test('gapPct 보고 규칙 — 격차는 소수점 둘째 자리 반올림(Math.round 0.5 올림) 값이다', () => {
  // 木 35.125 vs 30 — 격차 5.125 → 2자리 반올림 5.13 (≥ 5이므로 포함)
  const current = { ...BASIS_ALLOCATION, 木: 35.125 };
  assert.deepEqual(suggestRebalance(current, BASIS_ALLOCATION), [
    { element: '木', gapPct: 5.13, direction: 'decrease' },
  ]);
});

test('유효성 — current·target은 5오행 분포 객체(키 완전·유한수)여야 한다', () => {
  assert.throws(() => suggestRebalance({ 木: 30 }, BASIS_ALLOCATION), /5오행/);
  assert.throws(() => suggestRebalance(BASIS_ALLOCATION, null), /객체/);
  assert.throws(
    () => suggestRebalance({ ...BASIS_ALLOCATION, 金: NaN }, BASIS_ALLOCATION),
    /유한/,
  );
});