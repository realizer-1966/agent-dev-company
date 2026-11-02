/**
 * ebi.js — requirements 7장 균형도 지수(Energy Balance Index, 0~100).
 *
 * 순수 계산 모듈(req 8장). 정의는 아래 EBI_DEFINITION 문자열 상수 + 본 주석으로 문서화하며,
 * README에도 동일 정의가 기록된다(req 7장 "정의 문서화 + 경계 테스트").
 */

/**
 * EBI 정의(req 7장 문서화 요건):
 * - 범위: 0~100.
 * - 5오행 분포가 기준 배분(木30/火10/土20/金25/水15)에 가까울수록 높다.
 * - 단일 오행 100% 집중이면 최저에 가까운 값을 낸다.
 * - 경계 동작: 기준 배분과 완전히 동일하면 최대(100), 단일 오행 100% 집중은 최저에 근접.
 * 구체 산식(측정 거리·가중)은 코어 엔진 TDD 티켓 t_27551fb2(②)가 수용기준 6번 경계 테스트와
 * 함께 확정·구현한다. 스캐폴딩 ①은 시그니처만 확정한다.
 */
export const EBI_DEFINITION = [
  'EBI(Energy Balance Index) 균형도 지수 — 범위 0~100.',
  '정의: 5오행 분포가 기준 배분(木30/火10/土20/金25/水15)에 가까울수록 100에 가깝고,',
  '단일 오행 100% 집중이면 최저에 가깝다.',
  '기준 배분과 완전히 동일하면 최대값(100)을 낸다(경계 동작, req 7장).',
  '산식은 코어 엔진 TDD 티켓 t_27551fb2(②)가 확정·구현한다.',
].join(' ');

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 오행 분포 → 균형도 점수.
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} distribution 5요소 분포(합계 100, % 단위)
 * @returns {number} 0~100 정수·반올림 규칙 포함(②에서 확정). 기준 배분 입력 시 최대(100).
 */
export function computeEBI(distribution) {
  notImplemented('computeEBI(distribution)');
}