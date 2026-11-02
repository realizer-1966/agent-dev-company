import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ELEMENTS, ASSET_TYPES, getBasicVector } from '../src/vectors.js';

/**
 * vectors 행위 테스트 — requirements.md 9장 수용기준 1번 케이스 전부.
 * (유형→기본 벡터 존재성 + 표에 없는 유형의 명확한 거부)
 * RED 확인용: 스텁 단계에서 getBasicVector는 TODO 에러를 던지므로 아래 단언은 전부 실패한다.
 */

test('수용기준 1 — 6장 표의 모든 유형에 5요소 기본 벡터가 존재한다', () => {
  for (const t of ASSET_TYPES) {
    const v = getBasicVector(t.id);
    assert.ok(v && typeof v === 'object', `${t.id} 벡터 존재`);
    assert.deepEqual(Object.keys(v).sort(), [...ELEMENTS].sort(), `${t.id} 5요소 키 완전성`);
    for (const el of ELEMENTS) {
      assert.ok(Number.isFinite(v[el]) && v[el] >= 0 && v[el] <= 100, `${t.id}.${el} 0~100 (=${v[el]})`);
    }
  }
});

test('수용기준 1 — 유형별 기본 벡터는 6장 표 값과 정확히 일치한다', () => {
  const byId = Object.fromEntries(ASSET_TYPES.map((t) => [t.id, t]));
  assert.deepEqual(getBasicVector('equity'), byId.equity.basicVector);
  assert.deepEqual(getBasicVector('energy'), byId.energy.basicVector);
  assert.deepEqual(getBasicVector('realty'), byId.realty.basicVector);
  assert.deepEqual(getBasicVector('gold'), byId.gold.basicVector);
  assert.deepEqual(getBasicVector('bonds'), byId.bonds.basicVector);
  assert.deepEqual(getBasicVector('cash'), byId.cash.basicVector);
});

test('수용기준 1 — 반환 벡터는 복사본이다(데이터 상수 오염 방지)', () => {
  const v = getBasicVector('gold');
  v['金'] = 999;
  assert.notEqual(ASSET_TYPES.find((t) => t.id === 'gold').basicVector['金'], 999, '상수는 오염되지 않는다');
  assert.equal(getBasicVector('gold')['金'], 90, '다시 조회해도 원본 값');
});

test('수용기준 1 — 표에 없는 유형은 명확히 거부한다(조용한 undefined 금지)', () => {
  for (const unknown of ['bitcoin', '성장주', '', 'GOLD', 'equities']) {
    assert.throws(() => getBasicVector(unknown), /알 수 없는 자산 유형/, `'${unknown}' 거부`);
  }
});