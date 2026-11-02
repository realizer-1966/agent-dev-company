/**
 * vectors.js — requirements 6장 "자산 5요소 점수 모델": 유형별 기본 벡터 데이터 상수.
 *
 * UI와 완전히 분리된 순수 데이터 모듈(req 8장 — "코어 로직은 UI와 분리된 순수 ES 모듈").
 * DOM·네트워크·localStorage 의존성이 있어서는 안 된다.
 *
 * v2.0 핵심 결정(req 0.1·2장): Gold(금·은)은 **물질 기준으로 金**에 속한다.
 * v1의 火 배치는 폐기 — 코드·UI 어디에서도 Gold를 火로 분류하면 안 된다.
 * 채권·예금 등 금융 안정 성격의 자산도 金이지만, Gold과 위험 특성이 다르므로
 * 별도 자산 유형으로 구분해 서로 다른 기본 벡터를 부여한다(req 2장 유의사항).
 */

/** 오행 5요소의 기준 순서 — 오각형 레이더 등 UI에서도 이 순서를 사용한다. */
export const ELEMENTS = ['木', '火', '土', '金', '水'];

/**
 * 5요소 점수의 의미(req 6장). 해석 원칙: 점수가 높다고 무조건 매수가 아니라
 * "그 자산군에 유리한 환경인지" 판단하는 지표다(req 4장 고지).
 */
export const ELEMENT_SCORE_MEANINGS = {
  木: '성장성',
  火: '가치상승성',
  土: '안정성',
  金: '수익확정성',
  水: '유동성',
};

/**
 * req 6장 표의 6개 자산 유형 — Gold=金 반영(v2.0).
 * (v2 운용 노트: 직접 보유 부동산은 진단에 포함하되 리츠와 유형 구분)
 *
 * - label: UI 표기용 구분 라벨(req 2장 — 자산 유형 라벨을 구분해 보여준다)
 * - element: 오행 자산군(req 2장 분류 체계)
 * - basicVector: 유형별 기본 5요소 벡터(0~100, req 6장 예시 표 — 표에 없는 요소는 0)
 */
export const ASSET_TYPES = [
  { id: 'equity', label: '주식', element: '木',
    basicVector: { 木: 90, 火: 40, 土: 0, 金: 0, 水: 30 } },
  { id: 'energy', label: '에너지·원자재', element: '火',
    basicVector: { 木: 30, 火: 90, 土: 0, 金: 0, 水: 0 } },
  { id: 'realty', label: '부동산',
    element: '土',
    basicVector: { 木: 0, 火: 0, 土: 90, 金: 40, 水: 10 } },
  { id: 'gold', label: '금(Gold)', element: '金',
    basicVector: { 木: 0, 火: 30, 土: 40, 金: 90, 水: 0 } },
  { id: 'bonds', label: '국채·정기예금', element: '金',
    basicVector: { 木: 0, 火: 0, 土: 60, 金: 90, 水: 20 } },
  { id: 'cash', label: '현금·CMA', element: '水',
    basicVector: { 木: 0, 火: 0, 土: 0, 金: 20, 水: 95 } },
];

/**
 * 유형 ID → req 6장 기본 5요소 벡터.
 * @param {string} typeId ASSET_TYPES의 id ('equity'|'energy'|'realty'|'gold'|'bonds'|'cash')
 *   — 유형 ID는 정확히 일치하는 식별자 lookup이다(텍스트 입력의 자동 분류는 classify.js 담당).
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 0~100 벡터(원본 데이터 복사본 — 호출자가 변형해도 상수가 오염되지 않게)
 * @throws 알 수 없는 typeId(req 9장 1번 — 표에 없는 유형은 조용한 undefined 대신 명확히 거부)
 */
export function getBasicVector(typeId) {
  const type = ASSET_TYPES.find((t) => t.id === typeId);
  if (!type) {
    throw new Error(
      `알 수 없는 자산 유형: ${JSON.stringify(typeId)} — req 6장 표의 유형 `
      + `(${ASSET_TYPES.map((t) => t.id).join(', ')})만 허용된다(req 9장 1번: 표에 없는 유형은 명확히 거부)`,
    );
  }
  return { ...type.basicVector };
}