import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASIS_ALLOCATION,
  ALLOWED_RANGES,
  REGIME_PRESETS,
  shiftAllocation,
  normalizeToAllowed,
} from '../src/index.js';

/**
 * regimeShift 행위 테스트 — requirements.md 9장 수용기준 3번(국면 프리셋 A~E 전부 존재·
 * 각 목표 배분 합계 정확히 100·모든 오행 허용 범위 내·미지 국면 거부) + 4번(E 국면 수→목 이동 방향).
 *
 * ② 티켓 t_27551fb2가 정의·고정하는 규칙:
 *   1. shiftAllocation(regimeId)은 REGIME_PRESETS의 목표 배분 상수를 그대로(복사본) 반환한다 —
 *      기본 base는 BASIS_ALLOCATION이고 프리셋 상수 자체가 합 100·범위 내로 확정돼 있다
 *      (상수 형상은 tests/skeleton.test.js가 검증).
 *   2. base를 지정하면 기준 배분 대비 사전 정의 시프트(Δ = 프리셋 − 기준 배분)를 base에 적용한 뒤
 *      normalizeToAllowed로 범위 clamp·합 100 보정한다.
 *   3. normalizeToAllowed 보정 규칙: ① 각 값을 1%p 정수로 반올림(Math.round, 0.5는 올림)
 *      ② 허용 범위 [min,max]로 clamp ③ 잔여(100−합)를 ELEMENTS(木火土金水) 고정 순서로
 *      순회하며 이동 여유가 남은 오행에 1%p씩 반대 방향 재분배한다(상한·하한에 닿으면 건너뜀).
 *      Σmin=65 ≤ 100 ≤ Σmax=150이므로 어떤 유한 입력도 항상 보정 수렴한다.
 *   4. 미지 국면(id 불일치·대소문자 차이 포함)은 명확히 거부한다 — 조용한 undefined 방지.
 * RED 확인용: 스텁 단계에서는 TODO(t_27551fb2) 에러로 실패한다.
 */

test('수용기준 3 — shiftAllocation은 A~E 각 국면의 목표 배분 상수를 그대로 반환한다', () => {
  for (const preset of REGIME_PRESETS) {
    const result = shiftAllocation(preset.id);
    assert.deepEqual(result, preset.targetAllocation, `국면 ${preset.id}(${preset.label})`);
    const sum = Object.values(result).reduce((s, v) => s + v, 0);
    assert.equal(sum, 100, `${preset.id} 합계 정확히 100`);
  }
  // 반환값은 복사본 — 결과 변경이 프리셋 상수를 훼손하지 않는다
  shiftAllocation('A').木 = 999;
  assert.equal(REGIME_PRESETS[0].targetAllocation.木, 38);
});

test('수용기준 3 — 미지 국면 거부: id 불일치·대소문자·빈값·비문자', () => {
  for (const unknown of ['Z', 'a', '', ' A', null, 42]) {
    assert.throws(() => shiftAllocation(unknown), /알 수 없는 국면/, `${String(unknown)} 거부`);
  }
});

test('수용기준 4 — E 국면(유동성 회복기)은 수→목 이동 방향이다', () => {
  const e = shiftAllocation('E');
  assert.ok(e.水 < BASIS_ALLOCATION.水, `水 ${e.水} < 기준 ${BASIS_ALLOCATION.水} (수 비중 감소)`);
  assert.ok(e.木 > BASIS_ALLOCATION.木, `木 ${e.木} > 기준 ${BASIS_ALLOCATION.木} (목 비중 증가)`);
});

test('규칙 2 — base 지정: 기준 배분 대비 프리셋 Δ를 적용해 반환한다(범위 내면 무보정)', () => {
  // E의 Δ: 木+6·火−2·土−4·金+3·水−3 → base에서 raw {木26,火8,土16,金28,水22} — 전부 범위 내·합 100
  const base = { 木: 20, 火: 10, 土: 20, 金: 25, 水: 25 };
  assert.deepEqual(shiftAllocation('E', base), { 木: 26, 火: 8, 土: 16, 金: 28, 水: 22 });
});

test('규칙 2 — base 지정: 범위 밖 raw는 clamp 후 합 100으로 보정된다', () => {
  // base {木10,火10,土20,金25,水35} + E Δ → raw {木16,火8,土16,金28,水32}
  // clamp: 木16→20(하한), 水32→30(상한) → 합 102 → 잔여 −2 재분배: 木(하한 skip), 火8→7, 土16→15
  const base = { 木: 10, 火: 10, 土: 20, 金: 25, 水: 35 };
  assert.deepEqual(shiftAllocation('E', base), { 木: 20, 火: 7, 土: 15, 金: 28, 水: 30 });
});

test('규칙 3 — normalizeToAllowed: 이미 유효한 배분은 동일 값을 복사본으로 반환한다', () => {
  const result = normalizeToAllowed(BASIS_ALLOCATION);
  assert.deepEqual(result, BASIS_ALLOCATION);
  assert.notEqual(result, BASIS_ALLOCATION, '동일 참조가 아니다');
  result.木 = 999;
  assert.equal(BASIS_ALLOCATION.木, 30, '원본 상수는 훼손되지 않는다');
});

test('규칙 3 — clamp만으로 합 100이 되는 입력은 잔여 재분배 없이 clamp만 적용한다', () => {
  // {木50,火3,土15,金30,水2} → clamp {木40,火5,土15,金30,水10} — 정확히 합 100
  assert.deepEqual(normalizeToAllowed({ 木: 50, 火: 3, 土: 15, 金: 30, 水: 2 }),
    { 木: 40, 火: 5, 土: 15, 金: 30, 水: 10 });
});

test('규칙 3 — clamp 후 초과분은 ELEMENTS 순서로 1%p씩 재분배한다(상·하한 오행 건너뜀)', () => {
  // {木45,火10,土20,金25,水0}: clamp {木40,火10,土20,金25,水10} 합 105 → 잔여 −5
  // 木40→39, 火10→9, 土20→19, 金25→24, 水 하한 skip, 木39→38
  assert.deepEqual(normalizeToAllowed({ 木: 45, 火: 10, 土: 20, 金: 25, 水: 0 }),
    { 木: 38, 火: 9, 土: 19, 金: 24, 水: 10 });
});

test('규칙 3 — 범위 내이지만 합이 100이 아닌 입력도 잔여를 재분배해 합 100으로 고정한다', () => {
  // {木25,火10,土20,金25,水25} 합 105 → 잔여 −5: 木24, 火9, 土19, 金24, 水24
  const result = normalizeToAllowed({ 木: 25, 火: 10, 土: 20, 金: 25, 水: 25 });
  assert.deepEqual(result, { 木: 24, 火: 9, 土: 19, 金: 24, 水: 24 });
  assert.equal(Object.values(result).reduce((s, v) => s + v, 0), 100);
});

test('규칙 3 — 비정수 입력은 1%p 정수로 반올림(Math.round, 0.5 올림) 후 보정된다', () => {
  // {木25.4,火10.5,土20,金25,水15} → 반올림 {25,11,20,25,15} 합 96 → 잔여 +4:
  // 木25→26, 火11→12, 土20→21, 金25→26
  assert.deepEqual(normalizeToAllowed({ 木: 25.4, 火: 10.5, 土: 20, 金: 25, 水: 15 }),
    { 木: 26, 火: 12, 土: 21, 金: 26, 水: 15 });
});

test('유효성 — 5오행 키 누락·비유한수 값은 거부한다(shiftAllocation base 포함)', () => {
  assert.throws(() => normalizeToAllowed({ 木: 30, 火: 10, 土: 20, 金: 25 }), /5오행/);
  assert.throws(() => normalizeToAllowed({ 木: NaN, 火: 10, 土: 20, 金: 25, 水: 15 }), /유한/);
  assert.throws(() => normalizeToAllowed(null), /객체/);
  assert.throws(() => shiftAllocation('A', { 木: 30, 火: 10, 土: 20, 金: 25 }), /5오행/);
});

test('규칙 3 — 어떤 유한 입력도 허용 범위 내 합계 100으로 수렴한다(보정 가능성 보장)', () => {
  const samples = [
    { 木: 0, 火: 0, 土: 0, 金: 0, 水: 100 },
    { 木: 100, 火: 100, 土: 100, 金: 100, 水: 100 },
    { 木: -50, 火: 300, 土: 7, 金: 19, 水: 33 },
    { 木: 33.3, 火: 7.7, 土: 22.2, 金: 27.3, 水: 9.5 },
  ];
  for (const sample of samples) {
    const result = normalizeToAllowed(sample);
    for (const el of ['木', '火', '土', '金', '水']) {
      const [min, max] = ALLOWED_RANGES[el];
      assert.ok(min <= result[el] && result[el] <= max, `${el}=${result[el]} ∈ [${min},${max}]`);
    }
    assert.equal(Object.values(result).reduce((s, v) => s + v, 0), 100, `합 100 (${JSON.stringify(sample)})`);
  }
});