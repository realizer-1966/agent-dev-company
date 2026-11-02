/**
 * classify.js — requirements 2장 "오행×자산 분류 체계(v2)": 투자 대상 → 오행 자산군 변환.
 *
 * 순수 로직 모듈(req 8장): 문자열 입력을 사전 정의 키워드로 매칭해 유형을 제안한다.
 * 7장 입력 폼의 "유형 선택(2장의 투자 대상 목록 + 직접 입력)"에서 자동 제안에 사용된다.
 */

/**
 * 2장 투자 대상 키워드 — 유형별 분류 힌트(사전 정의 유형에 사용).
 * 매칭 우선순위·부분일침 규칙은 ② 티켓(t_27551fb2)에서 확정한다.
 */
export const CLASSIFY_KEYWORDS = {
  equity: ['주식', '국내 주식', '해외 주식', 'AI', '반도체', '바이오', '로봇', '벤처', '스타트업', '성장형 펀드'],
  energy: ['에너지', '유가', '원자재', '산업금속', '전력'],
  realty: ['부동산', '토지', '상가', '리츠', '인프라', '임대'],
  gold: ['금(Gold)', '금', '은', 'gold', 'silver', '골드', '실버'],
  bonds: ['국채', '우량 회사채', '회사채', '채권', '정기예금', '확정금리', '보험'],
  cash: ['현금', '원화', '달러', '즉시인출 예금', '예금', 'CMA', 'MMF', '단기 금융상품'],
};

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 투자 대상 텍스트 → 분류 결과 전체.
 * @param {string} text 자산 입력값(유형 선택·직접 입력 라벨, req 7장)
 * @returns {{typeId: string, element: '木'|'火'|'土'|'金'|'水', matchedKeyword: string,
 *            source: 'keyword'|'manual'}} 분류 상세
 * @throws 무일치 — 자동 분류 실패를 조용한 undefined 대신 에러로 표현(호출자가 직접 입력 유형으로 전환하도록)
 */
export function classifyAsset(text) {
  notImplemented('classifyAsset(text)');
}

/**
 * 투자 대상 텍스트 → 자산 유형 ID.
 * @param {string} text 자산 입력값
 * @returns {string} ASSET_TYPES의 id ('equity'|'energy'|'realty'|'gold'|'bonds'|'cash')
 * @throws 무일치
 */
export function classifyToAssetType(text) {
  notImplemented('classifyToAssetType(text)');
}

/**
 * 투자 대상 텍스트 → 오행 자산군.
 * @param {string} text 자산 입력값
 * @returns {'木'|'火'|'土'|'金'|'水'} 오행(ELEMENTS의 원소)
 * @throws 무일치
 */
export function classifyToElement(text) {
  notImplemented('classifyToElement(text)');
}