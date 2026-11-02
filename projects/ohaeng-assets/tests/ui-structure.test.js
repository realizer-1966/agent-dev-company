import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ui-structure.test.js — 티켓 ③ UI 마크업 구조 계약 테스트.
 * index.html이 7장 MVP 제품 요구사항의 위젯·고지·375px 진입점을 전부 담고 있는지 계약으로 고정한다.
 * DOM 런타임(브라우저) 실측은 티켓 ③ 검증 절차(11항목 브라우저 동작 확인)와 QA 티켓 ④가 담당하며,
 * 본 테스트는 정적 마크업의 존재·형상만 검증한다(외부 의존성 0 — 문자열 계약).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const html = readFileSync(join(root, 'index.html'), 'utf8');

test('index.html — 정적 웹앱 표준: 외부 의존성 0·ES 모듈 진입점(7장)', () => {
  assert.match(html, /<link[^>]+href="ui\/styles\.css"/, '스타일은 로컬 styles.css에서 로드한다');
  assert.match(html, /<script[^>]+type="module"[^>]+src="ui\/app\.js"/, '앱 진입점은 ES 모듈 ui/app.js다');
  assert.doesNotMatch(html, /src="https?:/, '외부 스크립트 CDN 없다(외부 의존성 0)');
  assert.doesNotMatch(html, /href="https?:\/\/[^"]*\.css/, '외부 CSS 없다(외부 의존성 0)');
});

test('index.html — 7섹션 구현 뼈대 유지', () => {
  for (const id of ['input-section', 'distribution-section', 'ebi-section', 'indicator-section', 'regime-section', 'rebalance-section', 'circulation-section']) {
    assert.match(html, new RegExp(`id="${id}"`), `섹션 ${id} 존재`);
  }
});

test('항목 9 — 고지 문구 3종 + Gold=金 노트가 상시 접근(스티키 고지 바 + 푸터 본문)', () => {
  assert.match(html, /id="notice-bar"/, '상시 고지 바(sticky) 존재');
  const pills = html.match(/class="notice-pill"/g) ?? [];
  assert.ok(pills.length >= 4, `고지 바에 4개 이상의 pill(3종 고지 + Gold=金)이 필요 — 현재 ${pills.length}`);
  for (const phrase of ['투자 조언', '설계용 기준', '개념도', 'Gold']) {
    assert.match(html, new RegExp(`<a[^>]+class="notice-pill"[^>]*>[^<]*${phrase}`), `고지 바 pill에 "${phrase}" 노출`);
  }
  assert.match(html, /id="disclaimer-footer"|\<footer/, '고지 본문(푸터) 존재');
});

test('항목 10 — localStorage 저장·복원 토글 + 서버 전송 없음 고지', () => {
  assert.match(html, /id="save-toggle"[^>]*type="checkbox"|id="save-toggle"/, '저장 토글 input#save-toggle 존재');
  assert.match(html, /서버로 전송되지 않|서버 전송 없|서버로 보내지 않/, '서버 전송 없음 고지 존재');
});

test('항목 2 — 자산 입력 폼: 유형 선택(목록 + 자동 분류 직접 입력)·금액·메모', () => {
  assert.match(html, /id="asset-form"/, '폼 존재');
  assert.match(html, /id="asset-name"/, '자산명·투자 대상 입력');
  assert.match(html, /id="type-select"/, '유형 선택 select');
  assert.match(html, /id="asset-amount"/, '금액 입력');
  assert.match(html, /id="asset-memo"/, '메모 입력');
  assert.match(html, /type-select[\s\S]{0,2000}?value=""[^>]*>[^<]*자동 분류|자동 분류/, '유형 select는 자동 분류(직접 입력) 옵션을 제공한다');
  assert.match(html, /id="asset-list"/, '추가된 항목 목록');
});

test('항목 3 — 폼·항목 카드의 5요소 벡터 슬라이더(0~100)와 자동 제안 안내', () => {
  const formVecSliders = (html.match(/data-el=/g) ?? []).length;
  assert.equal(formVecSliders, 5, `폼 벡터 슬라이더는 5오행(폼 전용 5개) — 현재 ${formVecSliders}`);
  assert.match(html, /id="vector-hint"/, '유형별 자동 제안 힌트 노출 지점');
  assert.match(html, /id="vector-reset"/, '유형 기본 제안 복원 버튼');
  assert.match(html, /id="form-error"/, '폼 오류 표시');
});

test('항목 1 — 레이더 섹션: SVG 컨테이너 + 현재/기준/허용 범위 범례', () => {
  assert.match(html, /id="radar-container"/, '레이더 SVG 주입 지점');
  assert.match(html, /허용 범위/, '허용 범위 밴드 범례');
  assert.match(html, /기준 배분/, '기준 배분 오버레이 범례');
});

test('항목 7 — EBI 표시(0~100) + 정의 노출 지점', () => {
  assert.match(html, /id="ebi-value"/, 'EBI 값 표시');
  assert.match(html, /id="ebi-bar-fill"/, 'EBI 게이지 채움');
  assert.match(html, /id="ebi-definition"/, 'EBI 정의 노출 지점(코어 EBI_DEFINITION 주입)');
});

test('항목 4 — 오행 경제지표 슬라이더 5종(0~100) + 4장 지표 예시 라벨', () => {
  const indSliders = (html.match(/data-ind=/g) ?? []).length;
  assert.equal(indSliders, 5, `지표 슬라이더 5종(오행별) — 현재 ${indSliders}`);
  for (const example of ['GDP', 'PMI', 'CPI', '신용스프레드', '달러지수']) {
    assert.match(html, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `지표 예시 라벨(${example})`);
  }
});

test('항목 5 — 국면 프리셋 A~E 선택 + 목표 배분/격차 표 + "검토 후 적용"', () => {
  assert.match(html, /id="regime-select"/, '국면 선택 select');
  assert.match(html, /<option[^>]*value="A"/, '국면 A 옵션');
  assert.match(html, /<option[^>]*value="E"/, '국면 E 옵션');
  assert.match(html, /id="proposal-table"/, '목표 배분·격차 표');
  assert.match(html, /격차/, '격차(Δ%p) 표기');
  assert.match(html, /검토 후 적용/, '"검토 후 적용" 성격 명시');
  assert.match(html, /id="regime-desc"/, '선택 국면 설명(4장 운용 방향) 노출 지점');
});

test('항목 6 — 리밸런싱 힌트: ±5%p 제안 목록 + "제안 없음" 상태', () => {
  assert.match(html, /id="rebalance-list"/, '제안 목록');
  assert.match(html, /id="rebalance-empty"/, '제안 없음 상태 표시');
  assert.match(html, /5%p/, '±5%p 트리거 표기');
});

test('항목 8 — 상생 순환 다이어그램 + 노트 5종 + 개념도 고지', () => {
  assert.match(html, /id="circulation-container"/, '다이어그램 SVG 주입 지점');
  assert.match(html, /id="circuit-notes"/, '상생 노트 목록');
  assert.match(html, /class="concept-disclaimer"/, '개념도 고지(5장)');
});