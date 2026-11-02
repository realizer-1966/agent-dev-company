import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASIS_ALLOCATION, EBI_DEFINITION, computeEBI } from '../src/index.js';

/**
 * ebi 행위 테스트 — requirements.md 9장 수용기준 6번(EBI 경계: 기준 배분과 완전 동일 = 최대(100),
 * 단일 오행 100% 집중 = 최저에 가까움) + 7장 "정의 문서화 + 경계 테스트".
 *
 * EBI 산식(② 티켓 t_27551fb2 확정 — tests/ebi.test.js·README로 고정):
 *   EBI(d) = round(100 − 0.5·Σ|d−기준|)  — L1 총변동거리의 절반(오행 간 이동량 합)을
 *   기준 배분(木30/火10/土20/金25/水15)과의 거리로 본다.
 *   - 기준 배분과 완전 동일 → Σ|d−기준| = 0 → 최대 100.
 *   - 단일 오행 100% 집중 → Σ|d−기준| = 200 − 2×기준비중 → EBI = 그 오행의 기준 비중 값
 *     (木→30, 火→10, 土→20, 金→25, 水→15). 합 100 도메인 전체의 최저는 火 100 집중(10)이다.
 *   - 반올림: 소수점 첫째 자리에서 Math.round(0.5는 올림) — 정수 반환.
 *   - 입력 합계는 100(허용오차 1e-9)로 검증하며, 어긋나면 거부한다.
 * RED 확인용: 스텁 단계에서는 TODO(t_27551fb2) 에러로 실패한다.
 */

test('수용기준 6 — 기준 배분(30/10/20/25/15)과 완전 동일하면 최대값 100이다', () => {
  assert.equal(computeEBI(BASIS_ALLOCATION), 100);
});

test('수용기준 6 — 단일 오행 100% 집중은 최저에 가깝다(ETB = 그 오행 기준 비중 값·전체 최저는 火 10)', () => {
  // 산식 유도: 집중 분포의 Σ|d−기준| = 200 − 2×기준비중 → EBI = 기준비중(문서화된 성질)
  assert.equal(computeEBI({ 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 }), 30);
  assert.equal(computeEBI({ 木: 0, 火: 100, 土: 0, 金: 0, 水: 0 }), 10, '합 100 도메인의 전체 최저');
  assert.equal(computeEBI({ 木: 0, 火: 0, 土: 100, 金: 0, 水: 0 }), 20);
  assert.equal(computeEBI({ 木: 0, 火: 0, 土: 0, 金: 100, 水: 0 }), 25);
  assert.equal(computeEBI({ 木: 0, 火: 0, 土: 0, 金: 0, 水: 100 }), 15);
});

test('EBI 산식 — L1 총변동거리 절반 반영: 20%p 이동이면 100 − 10 = 90', () => {
  // {木40,火10,土20,金25,水5}: |40−30| + |5−15| = 20 → 0.5·20 = 10 → 90
  assert.equal(computeEBI({ 木: 40, 火: 10, 土: 20, 金: 25, 水: 5 }), 90);
});

test('EBI 산식 — 반올림 규칙(소수점 첫째 자리 Math.round, 0.5 올림): 98.75→99, 99.5→100', () => {
  // {木31.25,...,水13.75}: Σ|d−기준| = 1.25 + 1.25 = 2.5 → 100 − 1.25 = 98.75 → 99
  assert.equal(computeEBI({ 木: 31.25, 火: 10, 土: 20, 金: 25, 水: 13.75 }), 99);
  // {木30.5,...,水14.5}: Σ = 0.5 + 0.5 = 1 → 99.5 → 100 (기준 근접 입력의 표시상 최대 취급)
  assert.equal(computeEBI({ 木: 30.5, 火: 10, 土: 20, 金: 25, 水: 14.5 }), 100);
});

test('EBI 입력 — 합계 100(허용오차 1e-9)을 벗어나면 거부한다', () => {
  assert.throws(() => computeEBI({ 木: 50, 火: 10, 土: 20, 金: 25, 水: 15 }), /합계가 100/); // 합 120
  assert.throws(() => computeEBI({ 木: 30, 火: 10, 土: 20, 金: 25, 水: 14 }), /합계가 100/); // 합 99
  const withinTolerance = { 木: 30.0000000001, 火: 10, 土: 20, 金: 25, 水: 14.9999999999 };
  assert.equal(computeEBI(withinTolerance), 100, '1e-9 이내 근소오차는 흡수된다');
});

test('EBI 입력 — 5오행 키 완전·유한수를 검증한다', () => {
  assert.throws(() => computeEBI({ 木: 30, 火: 10, 土: 20, 金: 25 }), /5오행/);
  assert.throws(() => computeEBI({ 木: NaN, 火: 10, 土: 20, 金: 25, 水: 15 }), /유한/);
  assert.throws(() => computeEBI(null), /객체/);
});

test('규칙 문서화 — EBI_DEFINITION 상수에 산식·범위·경계가 기록된다(req 7장 정의 문서화)', () => {
  assert.ok(typeof EBI_DEFINITION === 'string');
  assert.ok(EBI_DEFINITION.includes('0~100'), '범위');
  assert.ok(EBI_DEFINITION.includes('기준 배분'), '기준 배분 근접성 정의');
  assert.ok(EBI_DEFINITION.includes('0.5·Σ|d−기준|'), '산식과 코드·README 동기화');
  assert.ok(EBI_DEFINITION.includes('100'), '최대 경계');
});