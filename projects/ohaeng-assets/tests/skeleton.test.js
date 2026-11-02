import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ELEMENTS, ASSET_TYPES, ELEMENT_SCORE_MEANINGS, getBasicVector } from '../src/vectors.js';
import { CLASSIFY_KEYWORDS, classifyAsset, classifyToAssetType, classifyToElement } from '../src/classify.js';
import { weightedElementDistribution } from '../src/weighted.js';
import { EBI_DEFINITION, computeEBI } from '../src/ebi.js';
import { BASIS_ALLOCATION, ALLOWED_RANGES, REGIME_PRESETS, shiftAllocation, normalizeToAllowed } from '../src/regimeShift.js';
import { REBALANCE_TRIGGER_PCT, suggestRebalance } from '../src/rebalance.js';
import { CIRCULATION, CIRCULATION_NOTES, nextOf } from '../src/circulate.js';
import * as barrel from '../src/index.js';

/**
 * 골격 구조 테스트(스캐폴딩 티켓 t_c227b7e3 ①) — 계약(contract) 수준.
 *
 * 목적:
 *  - 코어 모듈 경계 7종의 존재·export 시그니처 확정 검증
 *  - ①이 배시하는 데이터 상수(기본 벡터·기준 배분·허용 범위·국면 프리셋·상생 매핑)의
 *    형상 위생(키 완전성·합 100·허용 범위 내)
 *  - 계산 함수는 전부 notImplemented 스텁이므로 "스텁이 TODO 에러로 명확히 거부한다"
 *    는 경계 동작까지만 확인 (조용히 undefined를 반환하는 실수를 방지)
 *
 * 실제 수치·행위 케이스(requirements.md 9장 수용기준)는 후속 TDD 티켓
 * t_27551fb2(② 코어 엔진 TDD)가 RED→GREEN으로 채운다.
 */

const STUB_RE = /t_27551fb2/;

// ---------------------------------------------------------------- vectors.js
test('vectors — ELEMENTS 5오행 상수', () => {
  assert.deepEqual(ELEMENTS, ['木', '火', '土', '金', '水']);
});

test('vectors — ASSET_TYPES: 6장 유형 6종 (gold 포함, 직결 유형 아님)', () => {
  assert.equal(ASSET_TYPES.length, 6);
  assert.deepEqual(
    ASSET_TYPES.map((t) => t.id).sort(),
    ['bonds', 'cash', 'energy', 'equity', 'gold', 'realty'],
  );
});

test('vectors — 각 유형: label·element·5요소 basicVector(0~100)', () => {
  for (const t of ASSET_TYPES) {
    assert.ok(t.label && typeof t.label === 'string', `${t.id}.label`);
    assert.ok(ELEMENTS.includes(t.element), `${t.id} 오행 자산군`);
    assert.deepEqual(
      Object.keys(t.basicVector).sort(),
      [...ELEMENTS].sort(),
      `${t.id} basicVector 5요소 키 완전성`,
    );
    for (const el of ELEMENTS) {
      const v = t.basicVector[el];
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 100, `${t.id}.${el} 0~100 (=${v})`);
    }
  }
});

test('vectors — 6장 기본 벡터 상수 (gold=金90·土40·火30 반영)', () => {
  const byId = Object.fromEntries(ASSET_TYPES.map((t) => [t.id, t]));
  assert.deepEqual(byId.equity.basicVector, { 木: 90, 火: 40, 土: 0, 金: 0, 水: 30 });
  assert.deepEqual(byId.energy.basicVector, { 木: 30, 火: 90, 土: 0, 金: 0, 水: 0 });
  assert.deepEqual(byId.realty.basicVector, { 木: 0, 火: 0, 土: 90, 金: 40, 水: 10 });
  assert.deepEqual(byId.gold.basicVector, { 木: 0, 火: 30, 土: 40, 金: 90, 水: 0 });
  assert.deepEqual(byId.bonds.basicVector, { 木: 0, 火: 0, 土: 60, 金: 90, 水: 20 });
  assert.deepEqual(byId.cash.basicVector, { 木: 0, 火: 0, 土: 0, 金: 20, 水: 95 });
});

test('vectors — v1 폐기: gold(금) 유형은 어디에서도 火 주축이 아니다 (0.1·2장)', () => {
  const gold = ASSET_TYPES.find((t) => t.id === 'gold');
  assert.equal(gold.element, '金');
  assert.ok(gold.basicVector['金'] > gold.basicVector['火'], '금(Gold)은 金90 > 火30');
});

test('vectors — ELEMENT_SCORE_MEANINGS: 6장 5요소 의미 상수', () => {
  assert.deepEqual(Object.keys(ELEMENT_SCORE_MEANINGS).sort(), [...ELEMENTS].sort());
  for (const el of ELEMENTS) {
    assert.ok(ELEMENT_SCORE_MEANINGS[el] && typeof ELEMENT_SCORE_MEANINGS[el] === 'string');
  }
});

test('vectors — getBasicVector: 유형→기본 벡터·미지 유형 거부 (9장 1번 실동작, 상세는 tests/vectors.test.js)', () => {
  assert.equal(typeof getBasicVector, 'function');
  assert.deepEqual(getBasicVector('equity'), { 木: 90, 火: 40, 土: 0, 金: 0, 水: 30 });
  assert.throws(() => getBasicVector('unknown-type'), /알 수 없는 자산 유형/);
});

// --------------------------------------------------------------- classify.js
test('classify — CLASSIFY_KEYWORDS: 6장 전체 유형 대상 키워드 상수', () => {
  const ids = ASSET_TYPES.map((t) => t.id);
  assert.deepEqual(Object.keys(CLASSIFY_KEYWORDS).sort(), [...ids].sort());
  for (const id of ids) {
    assert.ok(
      Array.isArray(CLASSIFY_KEYWORDS[id]) && CLASSIFY_KEYWORDS[id].every((k) => typeof k === 'string'),
      `${id} 키워드 배열 (2장 투자 대상)`,
    );
  }
});

test('classify — 분류 함수 3종 시그니처 확정, 스텁은 TODO 에러로 거부', () => {
  for (const fn of [classifyAsset, classifyToAssetType, classifyToElement]) {
    assert.equal(typeof fn, 'function');
    assert.throws(() => fn('금'), STUB_RE);
  }
});

// --------------------------------------------------------------- weighted.js
test('weighted — 금액 가중 평균 시그니처 확정, 스텁은 TODO 에러로 거부', () => {
  assert.equal(typeof weightedElementDistribution, 'function');
  assert.throws(() => weightedElementDistribution([]), STUB_RE);
});

// -------------------------------------------------------------------- ebi.js
test('ebi — EBI 정의가 주석·문자열 상수로 문서화 (7장)', () => {
  assert.ok(typeof EBI_DEFINITION === 'string' && EBI_DEFINITION.length > 20);
  assert.ok(EBI_DEFINITION.includes('기준 배분'), '기준 배분 근접성 정의');
  assert.ok(EBI_DEFINITION.includes('0~100'), '범위 문서화');
});

test('ebi — computeEBI 시그니처 확정, 스텁은 TODO 에러로 거부', () => {
  assert.equal(typeof computeEBI, 'function');
  assert.throws(() => computeEBI(BASIS_ALLOCATION), STUB_RE);
});

// ----------------------------------------------------------- regimeShift.js
test('regimeShift — BASIS_ALLOCATION: 3장 기준 배분 30/10/20/25/15', () => {
  assert.deepEqual(BASIS_ALLOCATION, { 木: 30, 火: 10, 土: 20, 金: 25, 水: 15 });
  assert.equal(ELEMENTS.reduce((s, el) => s + BASIS_ALLOCATION[el], 0), 100, '합계 100%');
});

test('regimeShift — ALLOWED_RANGES: 3장 허용 범위·기준 배분은 범위 내', () => {
  assert.deepEqual(Object.keys(ALLOWED_RANGES).sort(), [...ELEMENTS].sort());
  for (const el of ELEMENTS) {
    const [min, max] = ALLOWED_RANGES[el];
    assert.ok(min <= BASIS_ALLOCATION[el] && BASIS_ALLOCATION[el] <= max, `${el}: 기준 배분 허용 범위 내`);
    assert.ok(0 <= min && min <= max && max <= 100);
  }
});

test('regimeShift — REGIME_PRESETS: 4장 국면 A~E 5종, 목표 배분 합100·범위 내', () => {
  assert.equal(REGIME_PRESETS.length, 5);
  assert.deepEqual(REGIME_PRESETS.map((r) => r.id), ['A', 'B', 'C', 'D', 'E']);
  for (const r of REGIME_PRESETS) {
    assert.ok(r.label && typeof r.label === 'string', `${r.id} label`);
    assert.deepEqual(Object.keys(r.targetAllocation).sort(), [...ELEMENTS].sort(), `${r.id} 5오행 키`);
    for (const el of ELEMENTS) {
      const [min, max] = ALLOWED_RANGES[el];
      const v = r.targetAllocation[el];
      assert.ok(min <= v && v <= max, `${r.id}.${el} 허용 범위 내 (${v} ∈ [${min},${max}])`);
    }
    assert.equal(ELEMENTS.reduce((s, el) => s + r.targetAllocation[el], 0), 100, `${r.id} 합계 100`);
    // 3장: 허용 범위 상단을 여럿이 동시에 적용하지 않는다
    const tops = ELEMENTS.filter((el) => r.targetAllocation[el] === ALLOWED_RANGES[el][1]);
    assert.ok(tops.length <= 1, `${r.id} 상단 동시 적용 금지 (${tops})`);
  }
});

test('regimeShift — 시프트 함수 2종 시그니처 확정, 스텁은 TODO 에러로 거부', () => {
  assert.equal(typeof shiftAllocation, 'function');
  assert.equal(typeof normalizeToAllowed, 'function');
  assert.throws(() => shiftAllocation('A'), STUB_RE);
  assert.throws(() => shiftAllocation('UNKNOWN'), STUB_RE); // 미지 국면도 스텁 규정상 거부
  assert.throws(() => normalizeToAllowed(BASIS_ALLOCATION), STUB_RE);
});

// -------------------------------------------------------------- rebalance.js
test('rebalance — 트리거 상수 5%p(7장)·함수 시그니처 확정', () => {
  assert.equal(REBALANCE_TRIGGER_PCT, 5);
  assert.equal(typeof suggestRebalance, 'function');
  assert.throws(() => suggestRebalance(BASIS_ALLOCATION, REGIME_PRESETS[0].targetAllocation), STUB_RE);
});

// -------------------------------------------------------------- circulate.js
test('circulate — 상생 매핑 상수: 木→火→土→金→水 5오행 순환 닫힘 (5장)', () => {
  assert.deepEqual(Object.keys(CIRCULATION).sort(), [...ELEMENTS].sort());
  // 木→火→土→金→水→木 : 5오행 각각 정확히 1회 출발·도착
  let el = '木';
  const visited = [];
  for (let i = 0; i < ELEMENTS.length; i++) {
    visited.push(el);
    el = CIRCULATION[el];
  }
  assert.deepEqual(visited, ELEMENTS, '5오행 전체를 정확히 1회 방문');
  assert.equal(el, '木', '순환 닫힘');
});

test('circulate — 상생 노트 5종·nextOf 시그니처 확정', () => {
  assert.equal(CIRCULATION_NOTES.length, 5);
  assert.equal(typeof nextOf, 'function');
  assert.throws(() => nextOf('木'), STUB_RE);
});

// ----------------------------------------------------------------- index.js
test('index barrel — 코어 7모듈 전체 재노출', () => {
  const required = [
    // vectors
    'ELEMENTS', 'ASSET_TYPES', 'ELEMENT_SCORE_MEANINGS', 'getBasicVector',
    // classify
    'CLASSIFY_KEYWORDS', 'classifyAsset', 'classifyToAssetType', 'classifyToElement',
    // weighted
    'weightedElementDistribution',
    // ebi
    'EBI_DEFINITION', 'computeEBI',
    // regimeShift
    'BASIS_ALLOCATION', 'ALLOWED_RANGES', 'REGIME_PRESETS', 'shiftAllocation', 'normalizeToAllowed',
    // rebalance
    'REBALANCE_TRIGGER_PCT', 'suggestRebalance',
    // circulate
    'CIRCULATION', 'CIRCULATION_NOTES', 'nextOf',
  ];
  const missing = required.filter((k) => barrel[k] === undefined);
  assert.deepEqual(missing, []);
});