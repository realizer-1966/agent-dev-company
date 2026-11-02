/**
 * index.js — 코어 엔진 barrel: src/ 아래 7개 코어 모듈 전체 재노출.
 *
 * UI 모듈(후속 UI 티켓)은 이 barrel만 import하고 계산을 절대 재구현하지 않는다 —
 * 모든 수치의 근거는 코어 모듈 하나다("다음 UI 티켓은 이 모듈만 import하고 계산을 재구현하지 않는다", 티켓 ②).
 *
 * 코어 7모듈 지도(req 7·8장):
 *  - vectors.js:  유형별 기본 5요소 벡터 데이터 상수(6장, Gold=金)
 *  - classify.js: 유형 분류(2장 분류 체계)
 *  - weighted.js: 금액 가중 평균(포트폴리오 오행 분포, 6장)
 *  - ebi.js:      EBI 균형도 0~100(7장, 정의 문서화)
 *  - regimeShift.js: 국면 프리셋→목표 배분 시프트(3·4장, clamp·합 100 보정)
 *  - rebalance.js: 리밸런싱 제안(±5%p 트리거, 7장)
 *  - circulate.js: 상생 매핑 데이터 상수(木→火→土→金→水, 5장)
 */

export { ELEMENTS, ELEMENT_SCORE_MEANINGS, ASSET_TYPES, getBasicVector } from './vectors.js';
export { CLASSIFY_KEYWORDS, classifyAsset, classifyToAssetType, classifyToElement } from './classify.js';
export { weightedElementDistribution } from './weighted.js';
export { EBI_DEFINITION, computeEBI } from './ebi.js';
export {
  BASIS_ALLOCATION,
  ALLOWED_RANGES,
  REGIME_PRESETS,
  shiftAllocation,
  normalizeToAllowed,
} from './regimeShift.js';
export { REBALANCE_TRIGGER_PCT, suggestRebalance } from './rebalance.js';
export { CIRCULATION, CIRCULATION_NOTES, nextOf } from './circulate.js';