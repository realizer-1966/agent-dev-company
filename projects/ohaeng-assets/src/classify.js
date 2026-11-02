/**
 * classify.js — requirements 2장 "오행×자산 분류 체계(v2)": 투자 대상 → 오행 자산군 변환.
 *
 * 순수 로직 모듈(req 8장): 문자열 입력을 사전 정의 키워드로 매칭해 유형을 제안한다.
 * 7장 입력 폼의 "유형 선택(2장의 투자 대상 목록 + 직접 입력)"에서 자동 제안에 사용된다.
 *
 * 매칭 규칙(② 티켓 t_27551fb2 확정 — tests/classify.test.js로 고정):
 *  1. 입력값은 trim·대소문자 무시(lowercase) 후 비교한다.
 *  2. 정확히 일치(exact) 매치가 부분일치보다 최우선이다 —
 *     예: '정기예금'(bonds exact)이 부분일치 '예금'(cash)보다 이긴다.
 *  3. 부분일치에서는 "입력값 안에 포함된 키워드 중 가장 긴 것"이 이긴다(더 구체적인 힌트 우선) —
 *     예: '산업금속'(energy 4자)은 부분일치 '금'(gold 1자)보다 이긴다.
 *  4. 길이 동률이면 ASSET_TYPES 등장 순서(equity→energy→realty→gold→bonds→cash)로 결정한다.
 *  5. 어느 키워드와도 일치하지 않으면 조용한 undefined 대신 명확히 거부한다 —
 *     호출자가 직접 입력 유형으로 전환하도록 분류 실패를 에러로 표현한다.
 *
 * Gold 규칙(req 0.1·2장 v2.0): gold 키워드('금(Gold)','금','은','gold','silver','골드','실버')의
 * 분류 결과는 항상 金이다 — v1의 火 배치는 폐기되어 어디에서도 재현되지 않는다.
 */

import { ASSET_TYPES } from './vectors.js';

/**
 * 2장 투자 대상 키워드 — 유형별 분류 힌트(사전 정의 유형에 사용).
 * 표의 투자 대상 표현을 유형 키워드로 사전 정의한다(매칭은 위 규칙 1~5).
 */
export const CLASSIFY_KEYWORDS = {
  equity: ['주식', '국내 주식', '해외 주식', 'AI', '반도체', '바이오', '로봇', '벤처', '스타트업', '성장형 펀드'],
  energy: ['에너지', '유가', '원자재', '산업금속', '전력'],
  realty: ['부동산', '토지', '상가', '리츠', '인프라', '임대'],
  gold: ['금(Gold)', '금', '은', 'gold', 'silver', '골드', '실버'],
  bonds: ['국채', '우량 회사채', '회사채', '채권', '정기예금', '확정금리', '보험'],
  cash: ['현금', '원화', '달러', '즉시인출 예금', '예금', 'CMA', 'MMF', '단기 금융상품'],
};

/**
 * 투자 대상 텍스트 → 분류 결과 전체.
 * @param {string} text 자산 입력값(유형 선택·직접 입력 라벨, req 7장)
 * @param {string} [forcedTypeId] 직접 입력으로 유형을 강제할 때의 ASSET_TYPES id.
 *   지정하면 키워드 매칭을 건너뛰고 source 'manual'로 기록한다(UI가 수동 선택을 남길 때).
 * @returns {{typeId: string, element: '木'|'火'|'土'|'金'|'水', matchedKeyword: string|null,
 *            source: 'keyword'|'manual'}} 분류 상세
 * @throws 무일치(keyword 경로)·미지 forcedTypeId — 자동 분류 실패를 조용한 undefined 대신
 *   에러로 표현(호출자가 직접 입력 유형으로 전환하도록)
 */
export function classifyAsset(text, forcedTypeId = null) {
  if (forcedTypeId) {
    const forced = ASSET_TYPES.find((t) => t.id === forcedTypeId);
    if (!forced) {
      throw new Error(
        `알 수 없는 자산 유형: ${JSON.stringify(forcedTypeId)} — `
        + `ASSET_TYPES(${ASSET_TYPES.map((t) => t.id).join(', ')})의 id만 강제할 수 있다`,
      );
    }
    return { typeId: forced.id, element: forced.element, matchedKeyword: null, source: 'manual' };
  }

  if (typeof text !== 'string') {
    throw new Error(`분류 실패: 입력값이 문자열이 아니다 (${String(text)}) — 직접 입력 유형으로 전환하라`);
  }
  const query = text.trim().toLowerCase();
  if (!query) {
    throw new Error('분류 실패: 입력값이 비어 있다 — 직접 입력 유형으로 전환하라');
  }

  let best = null; // { typeId, keyword, order }: exact → 긴 키워드 → ASSET_TYPES 순서
  ASSET_TYPES.forEach((type, order) => {
    for (const keyword of CLASSIFY_KEYWORDS[type.id]) {
      const k = keyword.toLowerCase();
      const exact = k === query;
      const contained = !exact && query.includes(k);
      if (!exact && !contained) continue;
      if (
        best === null
        || (exact && !best.exact)
        || k.length > best.keyword.toLowerCase().length
        || (k.length === best.keyword.toLowerCase().length && exact && !best.exact)
        || (k.length === best.keyword.toLowerCase().length && order < best.order && !best.exact && exact)
      ) {
        best = { typeId: type.id, element: type.element, keyword, order, exact };
      }
    }
  });

  if (best === null) {
    throw new Error(`분류 실패: '${text}'와 일치하는 사전 정의 유형이 없다 — 직접 입력 유형으로 전환하라`);
  }
  return { typeId: best.typeId, element: best.element, matchedKeyword: best.keyword, source: 'keyword' };
}

/**
 * 투자 대상 텍스트 → 자산 유형 ID.
 * @param {string} text 자산 입력값
 * @returns {string} ASSET_TYPES의 id ('equity'|'energy'|'realty'|'gold'|'bonds'|'cash')
 * @throws 무일치
 */
export function classifyToAssetType(text) {
  return classifyAsset(text).typeId;
}

/**
 * 투자 대상 텍스트 → 오행 자산군.
 * @param {string} text 자산 입력값
 * @returns {'木'|'火'|'土'|'金'|'水'} 오행(ELEMENTS의 원소)
 * @throws 무일치
 */
export function classifyToElement(text) {
  return classifyAsset(text).element;
}