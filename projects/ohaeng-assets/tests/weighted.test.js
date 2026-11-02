import { test } from 'node:test';
import assert from 'node:assert/strict';

import { weightedElementDistribution } from '../src/index.js';

/**
 * weighted 행위 테스트 — requirements.md 9장 수용기준 2번(금액 가중 평균: 총액 0·음수·근소오차)
 * + ② 티켓 t_27551fb2가 정의·고정하는 규칙:
 *   1. 항목 벡터는 items[i].vector(슬라이더 조정값)가 우선하고, 없으면 유형 기본 벡터다.
 *      모든 항목은 ASSET_TYPES에 실재하는 typeId를 가진다.
 *   2. 6장 벡터는 독립 0~100 점수(합이 100이 아니다)이므로, 항목별 벡터를 오행 합 100 분포로
 *      정규화한 뒤 금액 비중(amount/총액)으로 가중 평균한다 → 반환 분포는 합계 100의 %p 분포.
 *   3. 0-총액 규칙: 항목이 없거나 모든 금액이 0이면 총액 0 — 가중 평균을 정의할 수 없으므로
 *      NaN 분포를 돌려주는 대신 명확히 거부한다.
 *   4. 유효성: 음수·NaN·Infinity 금액, 5오행 키 외 벡터, 전부 0인 벡터는 거부한다.
 *   5. 부동소수 근소오차: 금액 합산(예: 0.1+0.2)·벡터 합의 표시 잡음이 결과를 뒤집지 않는다 —
 *      참값과 허용오차 1e-9 이내로 일치하며 반환 분포 합계도 100±1e-9다.
 * RED 확인용: 스텁 단계에서는 TODO(t_27551fb2) 에러로 실패한다.
 */

test('수용기준 2 — 단일 자산: 유형 기본 벡터를 오행 합 100으로 정규화해 그대로 반환', () => {
  // equity 기본 벡터 木90·火40·土0·金0·水30 (합 160) → 정규화 木56.25·火25·土0·金0·水18.75 (합 100)
  assert.deepEqual(
    weightedElementDistribution([{ typeId: 'equity', amount: 1000000 }]),
    { 木: 56.25, 火: 25, 土: 0, 金: 0, 水: 18.75 },
  );
});

test('금액 가중 평균 — 둘 이상 자산은 금액 비중(3:1)대로 섞는다(명시 벡터, 정확 소수)', () => {
  const items = [
    { typeId: 'realty', amount: 300, vector: { 木: 0, 火: 0, 土: 50, 金: 50, 水: 0 } },
    { typeId: 'equity', amount: 100, vector: { 木: 75, 火: 25, 土: 0, 金: 0, 水: 0 } },
  ];
  // 비중 0.75/0.25 → 土37.5·金37.5 (realty 쪽), 木18.75·火6.25 (equity 쪽) — 합 100
  assert.deepEqual(weightedElementDistribution(items), {
    木: 18.75, 火: 6.25, 土: 37.5, 金: 37.5, 水: 0,
  });
});

test('규칙 2 — 합이 100이 아닌 벡터는 항목별로 정규화한 뒤 섞는다(합 200 벡터)', () => {
  // 木75·火25·土0·金25·水75 (합 200) → 정규화 木37.5·火12.5·土0·金12.5·水37.5
  assert.deepEqual(
    weightedElementDistribution([
      { typeId: 'equity', amount: 1000, vector: { 木: 75, 火: 25, 土: 0, 金: 25, 水: 75 } },
    ]),
    { 木: 37.5, 火: 12.5, 土: 0, 金: 12.5, 水: 37.5 },
  );
});

test('규칙 1 — 항목 vector(슬라이더 조정값)가 유형 기본 벡터를 대체한다', () => {
  assert.deepEqual(
    weightedElementDistribution([
      { typeId: 'equity', amount: 100, vector: { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 } },
    ]),
    { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 },
  );
});

test('금액이 0인 항목은 분포에 기여하지 않는다(총액에는 합산되지 않아도 무해)', () => {
  assert.deepEqual(
    weightedElementDistribution([
      { typeId: 'equity', amount: 0 },
      { typeId: 'cash', amount: 100, vector: { 木: 25, 火: 0, 土: 0, 金: 0, 水: 75 } },
    ]),
    { 木: 25, 火: 0, 土: 0, 金: 0, 水: 75 },
  );
});

test('수용기준 2 — 0-총액 규칙: 빈 목록·전부 0 금액은 가중 평균이 정의되지 않으므로 명확히 거부한다', () => {
  assert.throws(() => weightedElementDistribution([]), /총액이 0/);
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'equity', amount: 0 },
      { typeId: 'cash', amount: 0 },
    ]),
    /총액이 0/,
  );
});

test('수용기준 2 — 음수 금액 거부(단독·혼합 모두)', () => {
  assert.throws(() => weightedElementDistribution([{ typeId: 'equity', amount: -1 }]), /음수/);
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'equity', amount: 5 },
      { typeId: 'cash', amount: -2 },
    ]),
    /음수/,
  );
});

test('유효성 — NaN·Infinity 금액, 배열 아닌 입력, 항목 객체 아님은 거부한다', () => {
  assert.throws(() => weightedElementDistribution([{ typeId: 'equity', amount: NaN }]), /금액/);
  assert.throws(() => weightedElementDistribution([{ typeId: 'equity', amount: Infinity }]), /금액/);
  assert.throws(() => weightedElementDistribution('nope'), /배열/);
  assert.throws(() => weightedElementDistribution([null]), /자산 항목/);
});

test('수용기준 2 — 근소오차: 금액 합산 부동소수 잡음(0.1+0.2)이 결과를 뒤집지 않는다', () => {
  const d = weightedElementDistribution([
    { typeId: 'equity', amount: 0.1, vector: { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 } },
    { typeId: 'cash', amount: 0.2, vector: { 木: 0, 火: 0, 土: 0, 金: 0, 水: 100 } },
  ]);
  // 총액 = 0.1+0.2 = 0.30000000000000004 — 참값 木 100/3·水 200/3와 1e-9 이내, 합계 100±1e-9
  assert.ok(Math.abs(d.木 - 100 / 3) < 1e-9, `木=${d.木} (기대 ${100 / 3})`);
  assert.ok(Math.abs(d.水 - 200 / 3) < 1e-9, `水=${d.水} (기대 ${200 / 3})`);
  assert.ok(Math.abs(d.火) < 1e-9 && Math.abs(d.土) < 1e-9 && Math.abs(d.金) < 1e-9);
  const sum = d.木 + d.火 + d.土 + d.金 + d.水;
  assert.ok(Math.abs(sum - 100) < 1e-9, `합계=${sum}`);
});

test('규칙 5 — 벡터 합의 근소오차(0.1+0.2)도 1e-9 허용오차로 흡수된다', () => {
  const d = weightedElementDistribution([
    { typeId: 'equity', amount: 100, vector: { 木: 0.1 + 0.2, 火: 0, 土: 0, 金: 0, 水: 0.2 + 0.4 } },
  ]);
  // 벡터 합 = 0.9000000000000002 → 참값 木 100/3·水 200/3
  assert.ok(Math.abs(d.木 - 100 / 3) < 1e-9, `木=${d.木}`);
  assert.ok(Math.abs(d.水 - 200 / 3) < 1e-9, `水=${d.水}`);
});

test('유효성 — 벡터는 5오행 키 완전·각 요소 0~100 유한수여야 한다', () => {
  assert.throws(
    () => weightedElementDistribution([{ typeId: 'equity', amount: 1, vector: { 木: 50 } }]),
    /5오행/,
  );
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'equity', amount: 1, vector: { 木: 101, 火: 0, 土: 0, 金: 0, 水: 0 } },
    ]),
    /0~100/,
  );
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'equity', amount: 1, vector: { 木: NaN, 火: 0, 土: 0, 金: 0, 水: 0 } },
    ]),
    /0~100/,
  );
});

test('유효성 — 벡터 합계가 0인 항목은 오행 분포로 정규화할 수 없으므로 거부한다', () => {
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'equity', amount: 1, vector: { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 } },
    ]),
    /합계가 0/,
  );
});

test('미지 유형의 기본 벡터 조회는 vectors 계약대로 거부된다(명시 vector가 있어도 typeId는 실재해야 한다)', () => {
  assert.throws(
    () => weightedElementDistribution([{ typeId: 'unknown', amount: 5 }]),
    /알 수 없는 자산 유형/,
  );
  assert.throws(
    () => weightedElementDistribution([
      { typeId: 'unknown', amount: 5, vector: { 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 } },
    ]),
    /알 수 없는 자산 유형/,
  );
});

test('반환값은 호출자 변경에 영향받지 않는 복사본이고, 입력 항목도 변경하지 않는다', () => {
  const items = [{ typeId: 'equity', amount: 100 }];
  const first = weightedElementDistribution(items);
  first.木 = 999;
  assert.deepEqual(weightedElementDistribution(items), {
    木: 56.25, 火: 25, 土: 0, 金: 0, 水: 18.75,
  });
  assert.equal(items[0].vector, undefined, '입력 항목은 변경되지 않는다');
});