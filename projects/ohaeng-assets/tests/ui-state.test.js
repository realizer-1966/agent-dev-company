import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY,
  initialState,
  addItem,
  updateItem,
  removeItem,
  setRegime,
  setIndicator,
  setSaveEnabled,
  computeDistribution,
  computeEBIValue,
  currentTarget,
  elementGaps,
  rebalanceSuggestions,
  serializeState,
  parseState,
} from '../ui/state.js';
import * as core from '../src/index.js';

/**
 * UI 상태 모듈 테스트(티켓 ③ UI 구현의 로직 계층).
 * - ui/state.js는 계산을 절대 재구현하지 않는다 — 상태 조작·직렬화만 하고,
 *   분포(가중 평균)·EBI·국면 목표·리밸런싱 제안은 코어 barrel(src/index.js)만 호출한다.
 * - 본 테스트의 핵심 단언: state.js의 파생값이 "코어 모듈의 직접 호출 결과"와 항상 정확히 같다.
 * - DOM·브라우저 의존성은 없다(순수 ES 모듈 — node --test 대상).
 */

// --------------------------------------------------------------- 초기 상태
test('initialState — 빈 상태 기본값(토글 off·항목 없음·지표 0·국면 미선택)', () => {
  assert.deepEqual(initialState(), {
    saveEnabled: false,
    items: [],
    indicators: { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 },
    regimeId: null,
  });
});

test('STORAGE_KEY — localStorage 키는 문자열 상수', () => {
  assert.equal(typeof STORAGE_KEY, 'string');
  assert.ok(STORAGE_KEY.length > 0);
});

// ------------------------------------------------------------ addItem 유효성
test('addItem — 정상 항목 추가(vector 미지정 = 유형 기본 벡터 사용)', () => {
  const s0 = initialState();
  const r = addItem(s0, { name: '국내 주식', typeId: 'equity', amount: 1_000_000, memo: '' });
  assert.equal(r.ok, true);
  assert.equal(r.state.items.length, 1);
  const item = r.state.items[0];
  assert.equal(item.typeId, 'equity');
  assert.equal(item.name, '국내 주식');
  assert.equal(item.amount, 1_000_000);
  assert.equal(item.vector, null, '유형 기본 벡터 사용 — vector는 null로 두고 코어가 대체한다');
  assert.equal(typeof item.id, 'string');
  assert.ok(item.id.length > 0);
  // 원본 상태/입력은 변경되지 않는다(불변성)
  assert.equal(s0.items.length, 0);
});

test('addItem — 기본 벡터 슬라이더 제안값은 코어 getBasicVector와 동일', () => {
  // 미지정 vector를 UI가 어떻게 제안하는지: state.js는 코어 getBasicVector만 사용한다
  const r = addItem(initialState(), { name: '금(Gold)', typeId: 'gold', amount: 500000 });
  assert.equal(r.ok, true);
  // gold 기본 벡터(req 6장·Gold=金 반영) — 유형별 제안의 근거
  assert.deepEqual(core.getBasicVector('gold'), { 木: 0, 火: 30, 土: 40, 金: 90, 水: 0 });
  assert.equal(core.getBasicVector('gold')['金'] > core.getBasicVector('gold')['火'], true,
    'Gold는 金 주축(v1 火 폐기 — 어디에서도 火로 제안되지 않는다)');
});

test('addItem 거부 — 이름 없음·미지 유형·음수/NaN/Infinity 금액·벡터 위반(9케이스)', () => {
  const rejects = [
    { name: '', typeId: 'equity', amount: 1000 },
    { name: '   ', typeId: 'equity', amount: 1000 },
    { name: '주식', typeId: 'crypto', amount: 1000 },
    { name: '주식', typeId: 'equity', amount: -1 },
    { name: '주식', typeId: 'equity', amount: NaN },
    { name: '주식', typeId: 'equity', amount: Infinity },
    { name: '주식', typeId: 'equity', amount: 1000, vector: { 木: 100, 火: 0, 土: 0, 金: 0 } },
    { name: '주식', typeId: 'equity', amount: 1000, vector: { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 } },
    { name: '주식', typeId: 'equity', amount: 1000, vector: { 木: 120, 火: 0, 土: 0, 金: 0, 水: 0 } },
  ];
  rejects.forEach((input, i) => {
    const r = addItem(initialState(), input);
    assert.equal(r.ok, false, `케이스 ${i + 1}은 거부되어야 한다`);
    assert.ok(r.error && r.error.length > 0, `케이스 ${i + 1}의 오류 메시지`);
  });
});

test('addItem — 금액 0은 코어 규칙상 허용(총액 0이 아니면), 상태 변경 없음 원칙', () => {
  const r = addItem(initialState(), { name: '주식', typeId: 'equity', amount: 0 });
  // 코어 weighted는 항목 금액 0을 허용하되 총액 0만 거부한다 — state.js는 코어 규칙을 따른다
  assert.equal(r.ok, true);
  assert.equal(r.state.items[0].amount, 0);
});

// ------------------------------------------------------------------ update/remove
test('updateItem — 금액·메모·이름 변경, 벡터 슬라이더 값 반영', () => {
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1000 }).state;
  const id = s1.items[0].id;
  const r = updateItem(s1, id, { amount: 2000, memo: '비중 1/3', vector: { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 } });
  assert.equal(r.ok, true);
  assert.equal(r.state.items[0].amount, 2000);
  assert.equal(r.state.items[0].memo, '비중 1/3');
  assert.deepEqual(r.state.items[0].vector, { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 });
});

test('updateItem — 유형 변경 시 벡터는 유형 기본 제안으로 리셋(null), 기존 조정값이 오염되지 않는다', () => {
  const s1 = addItem(initialState(), { name: '정기예금', typeId: 'bonds', amount: 1000 }).state;
  const id = s1.items[0].id;
  const r = updateItem(s1, id, { typeId: 'cash' });
  assert.equal(r.ok, true);
  assert.equal(r.state.items[0].typeId, 'cash');
  assert.equal(r.state.items[0].vector, null, '유형이 바뀌면 제안을 다시 받는다(vector=null → 코어 기본 벡터)');
});

test('updateItem 거부 — 음수 금액·미지 유형·유효하지 않은 벡터·없는 id', () => {
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1000 }).state;
  const id = s1.items[0].id;
  assert.equal(updateItem(s1, id, { amount: -5 }).ok, false);
  assert.equal(updateItem(s1, id, { typeId: 'nope' }).ok, false, '미지 유형');
  assert.equal(updateItem(s1, id, { vector: { 木: 50 } }).ok, false, '벡터 키 누락');
  const gone = updateItem(s1, '없는 id', { memo: 'x' });
  assert.equal(gone.ok, false);
  // 거부 시 원본 상태 불변
  assert.equal(s1.items[0].amount, 1000);
});

test('removeItem — id로 삭제, 없는 id는 거부', () => {
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1000 }).state;
  const id = s1.items[0].id;
  const r = removeItem(s1, id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.items, []);
  assert.equal(removeItem(s1, '없는 id').ok, false);
});

// ---------------------------------------------------------------- 파생값 = 코어
test('computeDistribution — 분포는 코어 weightedElementDistribution 그대로(비어 있으면 null)', () => {
  assert.equal(computeDistribution(initialState()), null, '빈 상태 — 0-총액 규칙에 따라 null(UI가 빈 상태로 표시)');

  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1_000_000 }).state;
  assert.deepEqual(computeDistribution(s1), core.weightedElementDistribution(s1.items));
  assert.deepEqual(computeDistribution(s1), { 木: 56.25, 火: 25, 土: 0, 金: 0, 水: 18.75 });
});

test('computeDistribution — 벡터 슬라이더 조정값도 코어 경유(독립 재계산과 maxdiff 0)', () => {
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1000, vector: { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 } }).state;
  const s2 = addItem(s1, { name: '현금', typeId: 'cash', amount: 1000 }).state;
  // 독립 재계산: equity(조정) 50% + cash 기본 정규화 50%
  const cashNorm = { 金: (20 / 115) * 100, 水: (95 / 115) * 100 };
  const expected = {
    木: 0.5 * 100, 火: 0, 土: 0,
    金: 0.5 * cashNorm['金'], 水: 0.5 * cashNorm['水'],
  };
  const dist = computeDistribution(s2);
  for (const el of core.ELEMENTS) {
    assert.ok(Math.abs(dist[el] - expected[el]) < 1e-9, `${el}: ${dist[el]} ≈ ${expected[el]}`);
  }
  assert.deepEqual(dist, core.weightedElementDistribution(s2.items), '코어 그대로');
});

test('computeDistribution — 총액 0(모두 0원) 항목만 있으면 null(0-총액 규칙, 코어 거부를 UI 안전 오류로)', () => {
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 0 }).state;
  assert.equal(computeDistribution(s1), null);
});

test('computeEBIValue — 코어 computeEBI 그대로(불가 상태면 null)', () => {
  assert.equal(computeEBIValue(initialState()), null);
  const s1 = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1 }).state;
  const dist = core.weightedElementDistribution(s1.items);
  assert.equal(computeEBIValue(s1), core.computeEBI(dist));
});

test('currentTarget — 국면 미선택 = 기준 배분 복사본, 선택 시 = 코어 shiftAllocation', () => {
  assert.deepEqual(currentTarget(initialState()), core.BASIS_ALLOCATION);
  assert.deepEqual(currentTarget(initialState()), { 木: 30, 火: 10, 土: 20, 金: 25, 水: 15 });
  // 원본 상수 오염 방지(복사본)
  assert.notEqual(currentTarget(initialState()), core.BASIS_ALLOCATION);

  const sA = setRegime(initialState(), 'A').state;
  assert.deepEqual(currentTarget(sA), core.shiftAllocation('A'));
  const sE = setRegime(initialState(), 'E').state;
  assert.deepEqual(currentTarget(sE), core.shiftAllocation('E'));
  const presetE = core.REGIME_PRESETS.find((r) => r.id === 'E');
  assert.deepEqual(currentTarget(sE), presetE.targetAllocation);
});

test('elementGaps — 현재와 목표의 부호 있는 격차(Δ%p, 표시용)', () => {
  const current = { 木: 38, 火: 6, 土: 16, 金: 25, 水: 15 };
  const targetA = core.shiftAllocation('A'); // { 木:38, 火:6, 土:16, 金:25, 水:15 }
  const gapsA = elementGaps(current, targetA);
  assert.deepEqual(gapsA, { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }, '목표와 동일하면 격차 0');

  const gapsB = elementGaps(current, core.shiftAllocation('B')); // { 木22 火12 土16 金32 水18 }
  assert.deepEqual(gapsB, { 木: -16, 火: 6, 土: 0, 金: 7, 水: 3 }, 'Δ = 목표 − 현재 (현재가 크면 음수)');
  for (const el of core.ELEMENTS) assert.equal(typeof gapsB[el], 'number');
});

// ------------------------------------------------------------------ setRegime 등
test('setRegime — A~E 중 선택·해제(null), 미지 국면은 거부(UI는 select라 도달 불가 — 방어 규칙)', () => {
  const sA = setRegime(initialState(), 'A');
  assert.equal(sA.ok, true);
  assert.equal(sA.state.regimeId, 'A');

  const sNone = setRegime(sA.state, null);
  assert.equal(sNone.ok, true);
  assert.equal(sNone.state.regimeId, null);

  for (const id of core.REGIME_PRESETS.map((r) => r.id)) {
    assert.equal(setRegime(initialState(), id).ok, true);
  }

  const bad = setRegime(initialState(), 'F');
  assert.equal(bad.ok, false);
  assert.equal(setRegime(initialState(), 'a').ok, false, '대소문자 구분(코어 shiftAllocation와 동일 계약)');
  // 거부 시 상태 불변
  assert.equal(setRegime(initialState(), 'F').state, undefined, '거부 반환값에 상태를 넣지 않는다');
});

test('setIndicator — 오행 경제지표 0~100 슬라이더 값 저장, 범위 외·오행 외 거부', () => {
  const r = setIndicator(initialState(), '木', 70);
  assert.equal(r.ok, true);
  assert.equal(r.state.indicators['木'], 70);
  assert.equal(r.state.indicators['火'], 0, '다른 오행은 그대로');

  for (const [el, v] of [['木', -1], ['火', 101], ['土', NaN], ['金', 'high'], ['水', undefined]]) {
    const bad = setIndicator(initialState(), el, v);
    assert.equal(bad.ok, false, `${el}=${String(v)} 거부`);
  }
  const badEl = setIndicator(initialState(), '불', 50);
  assert.equal(badEl.ok, false);
});

test('setSaveEnabled — 토글(boolean만)', () => {
  assert.equal(setSaveEnabled(initialState(), true).state.saveEnabled, true);
  assert.equal(setSaveEnabled(initialState(), false).state.saveEnabled, false);
  assert.equal(setSaveEnabled(initialState(), 1).ok, false, 'truthy 숫자도 거부 — boolean만');
});

// ------------------------------------------------------ 리밸런싱 제안 = 코어
test('rebalanceSuggestions — 코어 suggestRebalance 그대로·불가 상태는 빈 배열', () => {
  assert.deepEqual(rebalanceSuggestions(initialState()), []);

  // 현금만 있는 포트폴리오 → 기준 배분과의 격차가 오행 5종 전부 5%p 이상
  const s1 = addItem(initialState(), { name: '현금', typeId: 'cash', amount: 1_000_000 }).state;
  const dist = core.weightedElementDistribution(s1.items);
  const hints = rebalanceSuggestions(s1);
  assert.deepEqual(hints, core.suggestRebalance(dist, core.BASIS_ALLOCATION));
  // 현금 기본 벡터: 金17.39·水82.61 → 木·火·土·金 증가 제안, 水 감소 제안
  assert.deepEqual(
    hints.map((h) => [h.element, h.direction]),
    [['木', 'increase'], ['火', 'increase'], ['土', 'increase'], ['金', 'increase'], ['水', 'decrease']],
  );
  for (const h of hints) assert.ok(h.gapPct >= core.REBALANCE_TRIGGER_PCT, `${h.element} ${h.gapPct}%p ≥ 5%p`);

  const s2 = addItem(s1, { name: '국내 주식', typeId: 'equity', amount: 9_000_000 }).state;
  assert.deepEqual(rebalanceSuggestions(s2), core.suggestRebalance(
    core.weightedElementDistribution(s2.items),
    core.BASIS_ALLOCATION,
  ));
});

// ---------------------------------------------------------------- 직렬화/복원
test('serializeState → parseState — 왕복 동일(항목·벡터 조정·지표·국면·토글)', () => {
  let s = addItem(initialState(), { name: '국내 주식', typeId: 'equity', amount: 1000, memo: '성장' }).state;
  s = addItem(s, { name: '정기예금', typeId: 'bonds', amount: 500 }).state;
  const [item] = s.items;
  s = updateItem(s, item.id, { vector: { 木: 80, 火: 20, 土: 0, 金: 0, 水: 0 } }).state;
  s = setRegime(s, 'D').state;
  s = setIndicator(s, '金', 80).state;
  s = setSaveEnabled(s, true).state;

  const restored = parseState(serializeState(s));
  assert.ok(restored, '복원 성공');
  assert.equal(restored.saveEnabled, true);
  assert.equal(restored.regimeId, 'D');
  assert.deepEqual(restored.indicators, { 木: 0, 火: 0, 土: 0, 金: 80, 水: 0 });
  assert.equal(restored.items.length, 2);
  assert.deepEqual(restored.items[0], s.items[0], 'id까지 포함 왕복');
  assert.deepEqual(restored.items[1], s.items[1]);
  // 복원 결과로도 동일 파생값
  assert.deepEqual(computeDistribution(restored), computeDistribution(s));
  assert.deepEqual(rebalanceSuggestions(restored), rebalanceSuggestions(s));
});

test('parseState — 훼손·이질 데이터는 전부 null(조용한 오염 대신 거부)', () => {
  assert.equal(parseState('not json'), null);
  assert.equal(parseState(''), null);
  assert.equal(parseState(null), null);
  assert.equal(parseState(undefined), null);
  assert.equal(parseState(42), null);
  assert.equal(parseState('{}'), null, '필수 형상 없음');
  assert.equal(parseState('{"version":0}'), null, '지원 버전 아님');
  const s = setSaveEnabled(addItem(initialState(), { name: '주식', typeId: 'equity', amount: 10 }).state, true).state;
  const ok = JSON.parse(serializeState(s));
  assert.equal(parseState(JSON.stringify({ ...ok, version: 2 })), null, '미래 버전 거부');
  const corrupted = JSON.parse(serializeState(s));
  corrupted.items[0].typeId = 'crypto';
  assert.equal(parseState(JSON.stringify(corrupted)), null, '알 수 없는 유형 항목 거부');
  const corruptedAmount = JSON.parse(serializeState(s));
  corruptedAmount.items[0].amount = -3;
  assert.equal(parseState(JSON.stringify(corruptedAmount)), null, '음수 금액 항목 거부');
  const corruptedInd = JSON.parse(serializeState(s));
  corruptedInd.indicators['木'] = 150;
  assert.equal(parseState(JSON.stringify(corruptedInd)), null, '지표 0~100 밖 거부');
  const corruptedRegime = JSON.parse(serializeState(s));
  corruptedRegime.regimeId = 'F';
  assert.equal(parseState(JSON.stringify(corruptedRegime)), null, '미지 국면 거부');
});

test('parseState — 불필요·위험 키는 버리고 필요한 형상만 재구성', () => {
  const s = setSaveEnabled(addItem(initialState(), { name: '금(Gold)', typeId: 'gold', amount: 100 }).state, true).state;
  const obj = JSON.parse(serializeState(s));
  obj.__proto__ = { polluted: true };
  obj.items[0].constructor = 'evil';
  obj.items[0].__proto__ = { polluted: true };
  const restored = parseState(JSON.stringify(obj));
  assert.ok(restored);
  assert.equal(
    Object.prototype.hasOwnProperty.call(restored.items[0], 'constructor'),
    false,
    'constructor 키는 재구성 시 버려진다',
  );
  assert.equal(restored.items[0].polluted, undefined, '주입된 __proto__ 데이터는 살아남지 않는다');
  const keys = Object.keys(restored);
  assert.deepEqual([...keys].sort(), ['indicators', 'items', 'regimeId', 'saveEnabled'].sort());
});