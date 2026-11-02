/**
 * regimeShift.js — requirements 3장(기준 배분·허용 범위) + 4장(경제 국면 프리셋 A~E):
 * 국면 프리셋 → 목표 배분 시프트(기준 배분에서의 시프트 + 허용 범위 clamp + 합 100 보정).
 *
 * 순수 계산 모듈(req 8장). 목표 배분 테이블은 코어 모듈의 데이터 상수로 정의하고
 * 테스트로 검증한다(req 4장). 모든 제안은 "검토 후 적용" 성격이며 어떤 제안도 합계 100%를 유지한다(req 3장).
 */

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

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 국면 프리셋 → 목표 배분.
 * @param {string} regimeId REGIME_PRESETS의 id ('A'|'B'|'C'|'D'|'E')
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} [base=BASIS_ALLOCATION] 시프트 기준 배분
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 목표 배분(합계 100, 허용 범위 내 — clamp·보정 완료)
 * @throws 미지 국면(req 9장 3번 — 미지 국면 거부)
 */
export function shiftAllocation(regimeId, base = BASIS_ALLOCATION) {
  notImplemented('shiftAllocation(regimeId, base)');
}

/**
 * 배분을 허용 범위 내 합계 100으로 보정.
 * @param {Record<'木'|'火'|'土'|'金'|'水', number>} allocation 보정 대상 배분(% 단위 가정)
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} clamp(허용 범위) 후 잔여를 재분배해 합계 100로 보정한 배분.
 *   보정 순서·초과분 재분배 규칙은 ② 티켓에서 확정한다(req 3장: 어떤 제안도 합 100 유지).
 */
export function normalizeToAllowed(allocation) {
  notImplemented('normalizeToAllowed(allocation)');
}