/**
 * ebi.js — requirements 7장 균형도 지수(Energy Balance Index, 0~100).
 *
 * 순수 계산 모듈(req 8장). 정의는 아래 EBI_DEFINITION 문자열 상수 + 본 주석으로 문서화하며,
 * README에도 동일 정의가 기록된다(req 7장 "정의 문서화 + 경계 테스트").
 *
 * 계산 규칙(② 티켓 t_27551fb2 확정 — tests/ebi.test.js로 고정):
 *  1. 산식: EBI = Math.round(100 − 0.5·Σ|d−기준|) — 기준 배분(木30/火10/土20/金25/水15,
 *     BASIS_ALLOCATION)과의 각 오행 절대격차 합(L1 총변동거리)의 절반을 "기준 배분으로부터의
 *     이동량(오행 간 자산 이동의 합)"으로 본다. 기준 배분 근접 → 100, 이동량 합이 클수록 낮다.
 *  2. 경계 동작(req 7장·9장 6번):
 *     - 기준 배분과 완전히 동일 → Σ|d−기준| = 0 → 최대값 100.
 *     - 단일 오행 100% 집중 → Σ|d−기준| = 200 − 2×기준비중 → EBI = 그 오행의 기준 비중 값
 *       (木→30 · 火→10 · 土→20 · 金→25 · 水→15). 합 100 도메인 전체의 최저는 火 100 집중(10)이다
 *       — "최저에 가까운"이 아니라 산식이 주는 정확한 최저값이며, 0보다는 정책적 하한이다.
 *  3. 반올림: 소수점 첫째 자리에서 Math.round(0.5는 올림) — 정수 반환(0~100).
 *  4. 입력 유효성: 5오행(木·火·土·金·水) 키 완전·각 값 유한수·합계 100(허용오차 1e-9).
 *     어긋나면 조용한 쓰레기값 대신 에러로 명확히 거부한다(weighted·rebalance와 동일 원칙).
 */

import { BASIS_ALLOCATION } from './regimeShift.js';

const ELEMENT_KEYS = ['木', '火', '土', '金', '水'];

/** 합계 100 검증 허용오차 — weighted.js 규칙 5(부동소수 근소오차 1e-9)와 같은 축. */
const SUM_TOLERANCE = 1e-9;

export const EBI_DEFINITION = [
  'EBI(Energy Balance Index) 균형도 지수 — 범위 0~100(정수).',
  '정의: 5오행 분포가 기준 배분(木30/火10/土20/金25/水15)에 가까울수록 100에 가깝고,',
  '단일 오행 100% 집중이면 최저에 가깝다.',
  '기준 배분과 완전히 동일하면 최대값(100)을 낸다(경계 동작, req 7장).',
  '산식: EBI = Math.round(100 − 0.5·Σ|d−기준|) — 기준 배분과의 각 오행 절대격차 합(L1 총변동거리)의 절반을 이동량으로 본다.',
  '단일 오행 100% 집중의 값: 그 오행의 기준 비중(木→30·火→10(전체 최저)·土→20·金→25·水→15).',
  '반올림은 소수점 첫째 자리(Math.round, 0.5는 올림), 입력 합계는 100(허용오차 1e-9)으로 검증해 어긋나면 거부한다.',
].join(' ');

/** 5오행 분포 객체 형상 검증 — 객체·키 완전·유한수. 합계 검증은 본문에서 한다(합 100 규칙). */
function validatedDistribution(distribution) {
  if (distribution === null || typeof distribution !== 'object') {
    throw new Error('computeEBI: distribution은 5오행 분포 객체여야 한다');
  }
  const complete = Object.keys(distribution).length === ELEMENT_KEYS.length
    && ELEMENT_KEYS.every((el) => el in distribution);
  if (!complete) {
    throw new Error('computeEBI: 5오행(木·火·土·金·水) 키가 모두 필요하다 — 누락·추가 키는 거부한다');
  }
  for (const el of ELEMENT_KEYS) {
    if (!Number.isFinite(distribution[el])) {
      throw new Error(`computeEBI: 각 오행 값은 유한한 수여야 한다 (${el}=${String(distribution[el])})`);
    }
  }
}

/**
 * 오행 분포 → 균형도 점수(EBI).
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} distribution 5요소 분포(합계 100, % 단위)
 * @returns {number} 0~100 정수(Math.round 반올림 — 규칙 2·3). 기준 배분 입력 시 최대(100).
 * @throws 객체 아님(null 포함)·5오행 키 누락·추가·비유한수 값·합계가 100±1e-9 밖(규칙 4)
 */
export function computeEBI(distribution) {
  validatedDistribution(distribution);
  let sum = 0;
  for (const el of ELEMENT_KEYS) sum += distribution[el];
  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    throw new Error(
      `computeEBI: 오행 분포 합계가 100이어야 한다 — 입력 합계는 ${sum}이다(허용오차 ${SUM_TOLERANCE})`,
    );
  }
  let totalDeviation = 0;
  for (const el of ELEMENT_KEYS) {
    totalDeviation += Math.abs(distribution[el] - BASIS_ALLOCATION[el]);
  }
  return Math.round(100 - 0.5 * totalDeviation);
}