/**
 * circulate.js — requirements 5장 상생 순환 모델(개념도): 木→火→土→金→水→木.
 *
 * 순수 데이터 모듈(req 8장). 상생 순환 다이어그램 뷰(7장)의 근거 데이터로,
 * 고지 문구 "상생 순환은 개념도다 —모든 자산이 이 순서대로 수익을 내거나 이동하는 것은 아니다"가
 * UI에 항상 함께 노출돼야 한다(req 5장 고지 필수).
 */

/** 상생 매핑: 각 오행이 다음으로 흘러가는 오행. 木→火→土→金→水→木 (5오행 순환 닫힘). */
export const CIRCULATION = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

/**
 * 5장 상생 사이클 노트 — 각 간선의 경제적 의미.
 * 사이클: 성장 → 가치 실현 → 축적 → 수익 확정 → 유동성 확보 → 재투자.
 */
export const CIRCULATION_NOTES = [
  '木→火: 성장투자에서 수익 실현',
  '火→土: 수익을 실물로 전환',
  '土→金: 안정적 현금흐름 확보',
  '金→水: 이자·배당 현금화',
  '水→木: 현금을 새 성장투자에 투입',
];

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 상생 순환의 다음 오행.
 * @param {'木'|'火'|'土'|'金'|'水'} element 현재 오행
 * @returns {'木'|'火'|'土'|'金'|'水'} CIRCULATION[element]
 * @throws 오행 외 값(ELEMENTS에 없는 문자열)
 */
export function nextOf(element) {
  notImplemented('nextOf(element)');
}