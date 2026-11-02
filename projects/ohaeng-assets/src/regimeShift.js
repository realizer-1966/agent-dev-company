/**
 * regimeShift.js — requirements 3장(기준 배분·허용 범위) + 4장(경제 국면 프리셋 A~E):
 * 국면 프리셋 → 목표 배분 시프트(기준 배분에서의 시프트 + 허용 범위 clamp + 합 100 보정).
 *
 * 순수 계산 모듈(req 8장). 목표 배분 테이블은 코어 모듈의 데이터 상수로 정의하고
 * 테스트로 검증한다(req 4장). 모든 제안은 "검토 후 적용" 성격이며 어떤 제안도 합계 100%를 유지한다(req 3장).
 */

import { ELEMENTS } from './vectors.js';

/**
 * req 3장 기준 배분(FEAAS 기준 포트폴리오) — 합계 100%.
 * 설계용 기준 비중이며 개인별 투자 권고가 아님(고지 필수).
 */
export const BASIS_ALLOCATION = { 木: 30, 火: 10, 土: 20, 金: 25, 水: 15 };

/** req 3장 허용 범위 — [min, max] (%p). 모든 오행이 범위 내 유지돼야 한다. */
export const ALLOWED_RANGES = {
  木: [20, 40],
  火: [5, 15],
  土: [10, 30],
  金: [20, 35],
  水: [10, 30],
};

/**
 * req 4장 경제 국면 프리셋 A~E — 각 국면의 목표 배분(코어 데이터 상수).
 * 설계 원칙(req 3·4장):
 *  - 각 목표 배분은 합계 100%(정확히), 모든 오행 허용 범위 내.
 *  - 허용 범위 상단을 여럿이 동시에 적용하지 않는다(≤1개).
 *  - E(유동성 회복기)는 수→목 이동 방향: 水 비중은 기준 배분보다 감소, 木 비중은 증가.
 * 판정은 사용자가 국면을 직접 선택하거나 오행 경제지표를 수동 입력해 힌트를 받는다(req 4장).
 */
export const REGIME_PRESETS = [
  { id: 'A', label: '성장 확장기', targetAllocation: { 木: 38, 火: 6, 土: 16, 金: 25, 水: 15 } },
  { id: 'B', label: '인플레이션 상승기', targetAllocation: { 木: 22, 火: 12, 土: 16, 金: 32, 水: 18 } },
  { id: 'C', label: '실물경제 안정기', targetAllocation: { 木: 24, 火: 6, 土: 28, 金: 26, 水: 16 } },
  { id: 'D', label: '금융 불안기', targetAllocation: { 木: 20, 火: 5, 土: 18, 金: 32, 水: 25 } },
  { id: 'E', label: '유동성 회복기', targetAllocation: { 木: 36, 火: 8, 土: 16, 金: 28, 水: 12 } },
];

/** 5오행 분포 객체 형상 검증 — 키 완전·유한수. 조용한 부정합 대신 에러로 거부한다. */
function validatedDistribution(value, label) {
  if (value === null || typeof value !== 'object') {
    throw new Error(`${label}: 5오행 분포 객체여야 한다`);
  }
  const complete = Object.keys(value).length === ELEMENTS.length && ELEMENTS.every((el) => el in value);
  if (!complete) {
    throw new Error(`${label}: 5오행(木·火·土·金·水) 키가 모두 필요하다 — 누락·추가 키는 거부한다`);
  }
  for (const el of ELEMENTS) {
    const v = value[el];
    if (!Number.isFinite(v)) {
      throw new Error(`${label}: 각 오행 값은 유한한 수여야 한다 (${el}=${String(v)})`);
    }
  }
}

/**
 * 국면 프리셋 → 목표 배분.
 *
 * 규칙(② 티켓 t_27551fb2 확정 — tests/regimeShift.test.js로 고정):
 *  - base 미지정(기본 BASIS_ALLOCATION)이면 프리셋 상수의 목표 배분을 복사본으로 그대로 반환한다 —
 *    프리셋 상수 자체가 합 100·허용 범위 내로 확정돼 있다(형상은 tests/skeleton.test.js가 검증).
 *  - base 지정 시 기준 배분 대비 사전 정의 시프트 Δ = 프리셋 − 기준 배분을 base에 적용한 뒤
 *    normalizeToAllowed로 허용 범위 clamp·합 100 보정한다.
 *
 * @param {string} regimeId REGIME_PRESET의 id ('A'|'B'|'C'|'D'|'E') — 대소문자 구분
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} [base=BASIS_ALLOCATION] 시프트 기준 배분
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 목표 배분(합계 정확히 100, 허용 범위 내
 *   — clamp·보정 완료). 매 호출 새로 만든 복사본이다.
 * @throws 미지 국면(req 9장 3번 — 미지 국면 거부)·base 형상 위반(5오행 키 외·비유한수)
 */
export function shiftAllocation(regimeId, base = BASIS_ALLOCATION) {
  const preset = REGIME_PRESETS.find((r) => r.id === regimeId);
  if (!preset) {
    throw new Error(
      `알 수 없는 국면: ${JSON.stringify(regimeId)} — `
      + `REGIME_PRESETS(${REGIME_PRESETS.map((r) => r.id).join('·')})의 id만 허용된다(req 9장 3번: 미지 국면 거부)`,
    );
  }
  validatedDistribution(base, 'shiftAllocation: base');
  const raw = {};
  for (const el of ELEMENTS) {
    raw[el] = base[el] + (preset.targetAllocation[el] - BASIS_ALLOCATION[el]);
  }
  return normalizeToAllowed(raw);
}

/**
 * 배분을 허용 범위 내 합계 정확히 100으로 보정.
 *
 * 보정 규칙(② 티켓 t_27551fb2 확정 — tests/regimeShift.test.js로 고정):
 *  1. 각 값을 1%p 정수로 반올림(Math.round — 0.5는 올림)한다(배분·프리셋·기준 배분은 1%p 정수 체계).
 *  2. 허용 범위 [min, max]로 clamp한다.
 *  3. 잔여(100 − 합)를 ELEMENTS(木火土金水) 고정 순서로 순회하며 이동 여유가 남은 오행에
 *     1%p씩 재분배한다 — 잔여 >0이면 상한 여유가 남은 오행에 가산, <0이면 하한 여유가 남은
 *     오행에서 감산한다(상한·하한에 닿은 오행은 건너뜀).
 *  Σmin=65 ≤ 100 ≤ Σmax=150이므로 어떤 유한 입력도 항상 보정 수렴한다(수렴 보장 테스트 존재).
 *
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} allocation 보정 대상 배분(% 단위)
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 합계 정확히 100·허용 범위 내 배분(복사본)
 * @throws 5오행 키 외·비유한수 값·(내부 방어) 재분배 비수렴
 */
export function normalizeToAllowed(allocation) {
  validatedDistribution(allocation, 'normalizeToAllowed: allocation');
  const out = {};
  for (const el of ELEMENTS) {
    const [min, max] = ALLOWED_RANGES[el];
    out[el] = Math.min(max, Math.max(min, Math.round(allocation[el])));
  }
  let residual = 100 - ELEMENTS.reduce((sum, el) => sum + out[el], 0);
  let guard = 0;
  while (residual !== 0) {
    guard += 1;
    if (guard > 1000) break; // 내부 방어 — 이론상 도달 불가(수렴 보장 테스트 참조)
    let moved = false;
    for (const el of ELEMENTS) {
      if (residual === 0) break;
      const [min, max] = ALLOWED_RANGES[el];
      if (residual > 0 && out[el] < max) {
        out[el] += 1;
        residual -= 1;
        moved = true;
      } else if (residual < 0 && out[el] > min) {
        out[el] -= 1;
        residual += 1;
        moved = true;
      }
    }
    if (!moved) break; // 더 이상 이동 가능한 오행이 없다 — 아래에서 계약 위반으로 거부
  }
  if (residual !== 0) {
    throw new Error('normalizeToAllowed: 허용 범위 내 합계 100 보정이 불가능하다(내부 오류)');
  }
  return out;
}