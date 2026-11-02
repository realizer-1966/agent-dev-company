/**
 * weighted.js — requirements 6장 핵심 규칙: "포트폴리오 오행 분포 = 금액 가중 평균(총합 기준)".
 *
 * 순수 계산 모듈(req 8장). UI가 아니라 코어 — 오각형 레이더 갱신의 근거 데이터를 만든다.
 */

const notImplemented = (name) => {
  throw new Error(
    `TODO(t_27551fb2): ${name} — 본문은 코어 엔진 TDD 티켓(②)에서 구현한다 (골격·시그니처는 티켓 ①스캐폴딩이 확정)`,
  );
};

/**
 * 보유 자산 목록 → 포트폴리오 오행 분포(금액 가중 평균).
 * @param {Array<{typeId: string, amount: number, vector?: Record<'木'|'火'|'土'|'金'|'水', number>}>} items
 *   자산 항목. vector는 사용자 슬라이더 조정값(req 7장 — 유형별 벡터 자동 제안 + 슬라이더 조정),
 *   없으면 유형 기본 벡터(getBasicVector)를 사용한다.
 * @returns {Record<'木'|'火'|'土'|'金'|'水', number>} 5요소 분포(% 단위, 합계 100 — 부동소수 근소오차는 ②에서 처리)
 * @throws 총액 0·음수 금액 — 경계 규칙 정의와 테스트는 ② 티켓 수용기준 2번(총액 0·음수·근소오차 케이스)이 담당
 */
export function weightedElementDistribution(items) {
  notImplemented('weightedElementDistribution(items)');
}