import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_TYPES,
  CLASSIFY_KEYWORDS,
  classifyAsset,
  classifyToAssetType,
  classifyToElement,
} from '../src/index.js';

/**
 * classify 행위 테스트 — requirements.md 9장 수용기준 8번('gold' 분류 = 金) +
 * 분류 우선순위 규칙(② 티켓에서 확정):
 *   1. 대소문자 무시·trim — 정확히 일치(exact) 매치가 최우선
 *   2. 부분일치 시 "입력값 안에 포함된 키워드 중 가장 긴 것"이 이긴다(더 구체적인 힌트 우선)
 *   3. 길이 동률이면 ASSET_TYPES 등장 순서(equity→energy→realty→gold→bonds→cash)로 결정
 *   4. 어느 키워드와도 일치하지 않으면 명확히 거부한다(호출자가 직접 입력 유형으로 전환)
 * RED 확인용: 스텁 단계에서는 TODO 에러로 실패한다.
 */

test('분류 규칙 사전 정의 — CLASSIFY_KEYWORDS의 모든 키워드가 자기 유형으로 분류된다', () => {
  for (const t of ASSET_TYPES) {
    for (const kw of CLASSIFY_KEYWORDS[t.id]) {
      assert.equal(classifyToAssetType(kw), t.id, `'${kw}' → ${t.id}`);
    }
  }
});

test('수용기준 8 — gold 유형 분류 결과는 항상 金, 어디에서도 火가 아니다 (v2.0 0.1·2장)', () => {
  for (const kw of CLASSIFY_KEYWORDS.gold) {
    assert.equal(classifyToAssetType(kw), 'gold', `'${kw}' → gold 유형`);
    assert.equal(classifyToElement(kw), '金', `'${kw}' → 金`);
    assert.notEqual(classifyToElement(kw), '火', `'${kw}'은 火로 분류 금지 (v1 폐기)`);
  }
  for (const variant of ['Gold', 'GOLD', 'Silver', ' 고양이 gold 고양이 ']) {
    assert.equal(classifyToAssetType(variant), 'gold', `'${variant}' 대소문자·부분일치 → gold`);
    assert.equal(classifyToElement(variant), '金');
  }
});

test('분류 규칙 1 — 정확히 일치(exact)가 부분일치보다 우선한다', () => {
  // '정기예금'은 bonds 키워드이지만 cash 키워드 '예금'도 부분일치 — exact bonds가 이긴다
  assert.equal(classifyToAssetType('정기예금'), 'bonds');
  assert.equal(classifyToElement('정기예금'), '金');
  // '단기 금융상품'(cash exact) 안의 '금'(gold 부분일치)은 무시된다
  assert.equal(classifyToAssetType('단기 금융상품'), 'cash');
  // '즉시인출 예금'(cash exact)도 cash
  assert.equal(classifyToAssetType('즉시인출 예금'), 'cash');
});

test('분류 규칙 2 — 부분일치에서는 포함된 키워드 중 가장 긴 것이 이긴다', () => {
  // '산업금속'(energy 4자) vs '금'(gold 1자) — 더 구체적인 energy 승
  assert.equal(classifyToAssetType('산업금속'), 'energy');
  assert.equal(classifyToElement('산업금속'), '火');
  assert.equal(classifyToAssetType('산업금속 선물'), 'energy');
});

test('classifyAsset — 분류 상세 전체를 반환한다(keyword 경로)', () => {
  assert.deepEqual(classifyAsset('금(Gold)'), {
    typeId: 'gold',
    element: '金',
    matchedKeyword: '금(Gold)',
    source: 'keyword',
  });
  assert.equal(classifyAsset('AI 반도체').typeId, 'equity');
});

test('분류 규칙 4 — 어느 키워드와도 일치하지 않으면 명확히 거부한다(직접 입력 전환 신호)', () => {
  for (const text of ['비트코인', '', '   ', 'S&P500']) {
    assert.throws(() => classifyAsset(text), /분류 실패/, `'${text}' 거부`);
    assert.throws(() => classifyToAssetType(text), /분류 실패/);
    assert.throws(() => classifyToElement(text), /분류 실패/);
  }
});

test('classifyAsset — 직접 입력 유형 강제(forcedTypeId)는 manual 분류로 기록된다', () => {
  assert.deepEqual(classifyAsset('비트코인', 'realty'), {
    typeId: 'realty',
    element: '土',
    matchedKeyword: null,
    source: 'manual',
  });
  // 미지 유형 ID 강제는 거부한다
  assert.throws(() => classifyAsset('비트코인', 'crypto'), /알 수 없는 자산 유형/);
});

test('분류 함수 3종 일관성 — 같은 텍스트면 같은 결과다', () => {
  for (const text of ['국채', '리츠', 'MMF', '에너지']) {
    const detail = classifyAsset(text);
    assert.equal(classifyToAssetType(text), detail.typeId);
    assert.equal(classifyToElement(text), detail.element);
    const type = ASSET_TYPES.find((t) => t.id === detail.typeId);
    assert.equal(detail.element, type.element, 'element는 유형의 오행과 일치');
  }
});