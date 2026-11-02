/**
 * weighted.js — requirements 6장 핵심 규칙: "포트폴리오 오행 분포 = 금액 가중 평균(총합 기준)".
 *
 * 순수 계산 모듈(req 8장). UI가 아니라 코어 — 오각형 레이더 갱신·EBI 입력·리밸런싱 격차 비교의
 * 근거 데이터를 만든다. 반환 분포는 합계 100의 %p 단위로, 기준 배분·국면 목표 배분(합 100)과
 * 같은 축에서 비교된다.
 *
 * 계산 규칙(② 티켓 t_27551fb2 확정 — tests/weighted.test.js로 고정):
 *  1. 항목 벡터: items[i].vector(슬라이더 조정값, req 7장) 우선 — undefined/null이면 유형 기본
 *     벡터(getBasicVector)를 사용한다. 모든 항목은 ASSET_TYPES에 실재하는 typeId를 가진다.
 *  2. 6장 벡터는 독립 0~100 점수(예: equity 木90·火40·水30, 합 160)이므로 항목별로 오행 합 100
 *     분포로 정규화한 뒤 금액 비중(amount/총액)으로 가중 평균한다. 합이 100인 벡터는 정규화해도
 *     동일하므로 결과는 항상 합계 100(±허용오차) 분포다.
 *  3. 0-총액 규칙: 항목이 없거나 모든 금액이 0이면 총액 0 — 0으로 나눌 수 없으므로 NaN 분포를
 *     돌려주는 대신 에러로 명확히 거부한다(조용한 쓰레기값 방지).
 *  4. 유효성: 금액은 0 이상의 유한수(음수·NaN·Infinity 거부), 벡터는 5오행(木·火·土·金·水) 키
 *     완전·각 요소 0~100 유한수·합 > 0(전부 0인 벡터 거부).
 *  5. 부동소수 근소오차: 금액 합산(0.1+0.2 등)·벡터 합의 표시 잡음은 결과를 뒤집지 않는다 —
 *     각 값은 참 가중평균과 1e-9 이내로 일치하고 반환 분포 합계도 100±1e-9다.
 *     표시용 반올림은 소비자(UI)의 책임으로 남긴다.
 */

import { ASSET_TYPES, getBasicVector } from './vectors.js';

const ELEMENT_KEYS = ['木', '火', '土', '金', '水'];

/** 벡터(vector 지정값 또는 유형 기본 벡터)를 오행 합 100 분포로 정규화한다. */
function normalizeVector(typeId, vector) {
  const source = vector === undefined || vector === null ? getBasicVector(typeId) : vector;
  if (source === null || typeof source !== 'object') {
    throw new Error('벡터 오류: 벡터는 5오행 키를 가진 객체여야 한다');
  }
  const keys = Object.keys(source);
  const complete = keys.length === ELEMENT_KEYS.length && ELEMENT_KEYS.every((el) => el in source);
  if (!complete) {
    throw new Error('벡터 오류: 5오행(木·火·土·金·水) 키가 모두 필요하다 — 누락·추가 키는 거부한다');
  }
  for (const el of ELEMENT_KEYS) {
    const v = source[el];
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new Error(`벡터 오류: 각 요소는 0~100의 유한한 수여야 한다 (${el}=${String(v)})`);
    }
  }
  let sum = 0;
  for (const el of ELEMENT_KEYS) sum += source[el];
  if (!(sum > 0)) {
    throw new Error('벡터 오류: 벡터 합계가 0이다 — 오행 분포로 정규화할 수 없다');
  }
  const normalized = {};
  for (const el of ELEMENT_KEYS) normalized[el] = (source[el] / sum) * 100;
  return normalized;
}

/**
 * 보유 자산 목록 → 포트폴리오 오행 분포(금액 가중 평균).
 * @param {Array<{typeId: string, amount: number, vector?: Record<'木'|'火'|'土'|'金'|'水', number>}>} items
 *   자산 항목. vector는 사용자 슬라이더 조정값(req 7장 — 유형별 벡터 자동 제안 + 슬라이더 조정),
 *   없으면(null 포함) 유형 기본 벡터(getBasicVector)를 사용한다.
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 5요소 분포(% 단위, 합계 100±1e-9 — 규칙 2·5).
 *   매 호출 새로 만든 복사본이다.
 * @throws 배열 아님·항목 객체 아님·미지 typeId(ASSET_TYPES 외)·음수/NaN/Infinity 금액·
 *   벡터 형상 위반(5오행 키 외·0~100 밖·합 0)·총액 0(빈 목록·전부 0 금액 — 규칙 3)
 */
export function weightedElementDistribution(items) {
  if (!Array.isArray(items)) {
    throw new Error('weightedElementDistribution: items는 자산 항목의 배열이어야 한다');
  }
  const normalized = [];
  let total = 0;
  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      throw new Error('weightedElementDistribution: 각 자산 항목은 객체여야 한다');
    }
    const { typeId, amount, vector } = item;
    if (!ASSET_TYPES.some((t) => t.id === typeId)) {
      throw new Error(
        `알 수 없는 자산 유형: ${JSON.stringify(typeId)} — `
        + `ASSET_TYPES(${ASSET_TYPES.map((t) => t.id).join(', ')})의 id만 허용된다`,
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `금액 오류: 금액은 0 이상의 유한한 수여야 한다 — 음수·NaN·Infinity 금액은 거부 (${String(amount)})`,
      );
    }
    normalized.push(normalizeVector(typeId, vector));
    total += amount;
  }
  if (!(total > 0)) {
    // 0-총액 규칙(규칙 3): 빈 목록과 "모든 금액 0"은 같은 규칙으로 거부한다.
    throw new Error(
      '총액이 0이다: 가중 평균을 정의할 수 없다 — items가 비었거나 모든 금액이 0이다(0-총액 규칙: 명확히 거부)',
    );
  }
  const distribution = {};
  for (const el of ELEMENT_KEYS) distribution[el] = 0;
  for (let i = 0; i < normalized.length; i++) {
    const weight = items[i].amount / total;
    const v = normalized[i];
    for (const el of ELEMENT_KEYS) distribution[el] += weight * v[el];
  }
  return distribution;
}