import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CIRCULATION, nextOf } from '../src/circulate.js';
import { ELEMENTS } from '../src/vectors.js';

/**
 * circulate 행위 테스트 — requirements.md 9장 수용기준 7번 케이스
 * (상생 매핑: 木→火→土→金→水→木 5오행 순환 닫힘 — 각 오행이 정확히 1회 출발·도착).
 * RED 확인용: 스텁 단계에서 nextOf는 TODO 에러를 던지므로 아래 단언은 실패한다.
 */

test('수용기준 7 — nextOf로 순환을 5오행 전체 걸으면 木로 닫힌다', () => {
  let el = '木';
  const visited = [];
  for (let i = 0; i < ELEMENTS.length; i++) {
    visited.push(el);
    el = nextOf(el);
  }
  assert.deepEqual(visited, ['木', '火', '土', '金', '水'], '5오행을 정확히 1회씩 출발');
  assert.equal(el, '木', '순환 닫힘: 水→木');
});

test('수용기준 7 — nextOf 개별 간선 = CIRCULATION 매핑(木→火·火→土·土→金·金→水·水→木)', () => {
  for (const [from, to] of Object.entries(CIRCULATION)) {
    assert.equal(nextOf(from), to, `간선 ${from}→${to}`);
  }
});

test('수용기준 7 — 출발·도착 집합이 5오행 전체와 정확히 일치(1회씩, 누락·중복 없음)', () => {
  const sources = Object.keys(CIRCULATION).sort();
  const targets = Object.values(CIRCULATION).sort();
  assert.deepEqual(sources, [...ELEMENTS].sort(), '출발 오행 5종 전부 1회');
  assert.deepEqual(targets, [...ELEMENTS].sort(), '도착 오행 5종 전부 1회');
});

test('수용기준 7 — 오행 외 값은 명확히 거부한다', () => {
  for (const bad of ['불', '', '火火', undefined, null, 5, { 火: '木' }]) {
    assert.throws(() => nextOf(bad), /오행이 아니다/, `${String(bad)} 거부`);
  }
});