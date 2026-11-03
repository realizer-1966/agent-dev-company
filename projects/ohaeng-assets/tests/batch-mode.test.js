import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BATCH_URL,
  parseBatch,
  applyBatch,
  loadBatch,
  batchBannerText,
  formatGeneratedAt,
  formatRebalanceRow,
  measuredScores,
} from '../ui/batch.js';
import { initialState, serializeState, parseState, setRegime } from '../ui/state.js';
import { shiftAllocation, BASIS_ALLOCATION, ELEMENTS, REGIME_PRESETS } from '../src/index.js';
import { buildRadarSVG, polygonPoints, radarPoint } from '../ui/radar.js';

/**
 * 실측 모드 테스트(티켓 ⑤ — req-v2 §4·§5-5).
 * - ui/batch.js는 v1 엔진 배치 산출(engine/data/state.json, req-v2 §4 스키마 7필드)을
 *   받아 수동 모드 상태에 적용하는 순수 계층이다 — DOM·브라우저 의존성 없음(node --test 대상).
 * - 계산 재구현 금지 원칙: 목표 배분 일관성 검증은 코어 shiftAllocation·BASIS_ALLOCATION
 *   (src/index.js barrel)과의 대조로 한다(batch 값이 v1 코어 산출과 어긋나면 전체 거부).
 * - 부재(404)·무결 위반은 전부 "배치 없음"으로 수렴해 수동 모드를 유지한다(콘솔 오류 노출 금지).
 */

/** engine/data/state.json(req-v2 §4 스키마) 형식의 유효 배치 — 국면 D 실측값(README 표와 동일). */
const VALID_BATCH_TEXT = JSON.stringify({
  generated_at: '2026-11-03T11:17:34.926924+00:00',
  element_scores: { 목: 37, 화: 78, 토: 16, 금: 45, 수: 63 },
  regime: 'D',
  regime_reasons: ['지수 입력: 목=37 · 화=78 · 토=16 · 금=45 · 수=63', 'D 규칙 충족 — 금<50(금=45)'],
  target_allocation: { 목: 20.0, 화: 5.0, 토: 18.0, 금: 32.0, 수: 25.0 },
  rebalance_proposals: [
    { element: '목', basis_pct: 30.0, target_pct: 20.0, delta_pct: -10.0 },
    { element: '화', basis_pct: 10.0, target_pct: 5.0, delta_pct: -5.0 },
    { element: '토', basis_pct: 20.0, target_pct: 18.0, delta_pct: -2.0 },
    { element: '금', basis_pct: 25.0, target_pct: 32.0, delta_pct: 7.0 },
    { element: '수', basis_pct: 15.0, target_pct: 25.0, delta_pct: 10.0 },
  ],
  proxy_note: '프록시 한계: 오행 자산군은 공개 지수·금리 계열로 근사한다.',
});

/** 코어 한자 오행 → engine 배치 키(한글 초성) 역매핑 — REGIME_PRESETS 프리셋 배분을 배치 형식으로 동기화하는 데 필요하다. */
const BATCH_KEY_OF = { 木: '목', 火: '화', 土: '토', 金: '금', 水: '수' };

const SCHEMA_FIELDS = [
  'generated_at',
  'element_scores',
  'regime',
  'regime_reasons',
  'target_allocation',
  'rebalance_proposals',
  'proxy_note',
];

function withField(field, value) {
  const raw = JSON.parse(VALID_BATCH_TEXT);
  if (value === undefined) delete raw[field];
  else raw[field] = value;
  return JSON.stringify(raw);
}

/* ────────────────────────────── parseBatch — 유효 배치 ────────────────────────────── */

test('parseBatch — 유효 배치를 정규화한다(한글 오행 → 코어 한글 오행 매핑 포함)', () => {
  const batch = parseBatch(VALID_BATCH_TEXT);
  assert.equal(batch.generatedAt, '2026-11-03T11:17:34.926924+00:00');
  assert.deepEqual(batch.scores, { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 });
  assert.equal(batch.regime, 'D');
  assert.deepEqual(batch.reasons, ['지수 입력: 목=37 · 화=78 · 토=16 · 금=45 · 수=63', 'D 규칙 충족 — 금<50(금=45)']);
  assert.deepEqual(batch.target, { 木: 20.0, 火: 5.0, 土: 18.0, 金: 32.0, 水: 25.0 });
  assert.deepEqual(batch.proposals, [
    { element: '木', basisPct: 30.0, targetPct: 20.0, deltaPct: -10.0 },
    { element: '火', basisPct: 10.0, targetPct: 5.0, deltaPct: -5.0 },
    { element: '土', basisPct: 20.0, targetPct: 18.0, deltaPct: -2.0 },
    { element: '金', basisPct: 25.0, targetPct: 32.0, deltaPct: 7.0 },
    { element: '水', basisPct: 15.0, targetPct: 25.0, deltaPct: 10.0 },
  ]);
  assert.match(batch.proxyNote, /프록시 한계/);
});

test('parseBatch — 국면 D 목표 배분이 v1 코어 shiftAllocation 산출과 일치한다(재구현 아님 — 대조)', () => {
  const batch = parseBatch(VALID_BATCH_TEXT);
  const coreTarget = shiftAllocation('D', BASIS_ALLOCATION);
  for (const el of ELEMENTS) {
    assert.ok(Math.abs(batch.target[el] - coreTarget[el]) <= 1e-6, `코어 목표 일치 (${el})`);
  }
});

test('parseBatch — v1 REGIME_PRESETS 국면 코드(A~E)만 수용한다', () => {
  const ids = REGIME_PRESETS.map((r) => r.id);
  assert.deepEqual(ids, ['A', 'B', 'C', 'D', 'E']);
});

/* ────────────────────────────── parseBatch — 무결(전체 거부) ────────────────────────────── */

test('parseBatch — 파일 무결 원칙: 어떤 형태의 오염도 전체 거부(null)한다', () => {
  // 가비지·빈 값·배열·비객체
  for (const garbage of ['', '   ', '{중괄호 짝 안 맞음', 'null', '[]', '"문자열"', '42']) {
    assert.equal(parseBatch(garbage), null, `가비지 거부: ${JSON.stringify(garbage)}`);
  }
  assert.equal(parseBatch(VALID_BATCH_TEXT + '뒤에 붙은 쓰레기'), null, 'JSON 뒤틀린 텍스트 거부');
});

test('parseBatch — 스키마 7필드: 누락·외부 필드는 전체 거부(engine validate_state 계약 동일)', () => {
  for (const field of SCHEMA_FIELDS) {
    assert.equal(parseBatch(withField(field)), null, `필수 필드 누락 거부: ${field}`);
  }
  assert.equal(
    parseBatch(withField('unknown_field', 1)),
    null,
    '알 수 없는 필드 거부(engine 스키마 7필드 고정)',
  );
});

test('parseBatch — element_scores: null(부족 지표) 수용, 범위·형식 위반 거부', () => {
  const partial = JSON.parse(VALID_BATCH_TEXT);
  partial.element_scores = { 목: null, 화: 78, 토: 16, 금: 45, 수: 63 };
  const batch = parseBatch(JSON.stringify(partial));
  assert.notEqual(batch, null, 'None(부족 지표) 수용(req-v2 §2 — 강제 매칭 금지)');
  assert.deepEqual(batch.scores, { 木: null, 火: 78, 土: 16, 金: 45, 水: 63 });

  assert.equal(parseBatch(withField('element_scores', { 목: 101, 화: 78, 토: 16, 금: 45, 수: 63 })), null, '101 범위 위반');
  assert.equal(parseBatch(withField('element_scores', { 목: -1, 화: 78, 토: 16, 금: 45, 수: 63 })), null, '음수 거부');
  assert.equal(parseBatch(withField('element_scores', { 목: '37', 화: 78, 토: 16, 금: 45, 수: 63 })), null, '문자열 거부');
  assert.equal(parseBatch(withField('element_scores', { 목: true, 화: 78, 토: 16, 금: 45, 수: 63 })), null, 'boolean 거부');
  assert.equal(
    parseBatch(withField('element_scores', { 목: 37, 화: 78, 토: 16, 금: 45 })),
    null,
    '오행 5키 미완성 거부',
  );
  assert.equal(
    parseBatch(withField('element_scores', { 목: 37, 화: 78, 토: 16, 금: 45, 수: 63, 木: 1 })),
    null,
    '모르는 키 추가 거부(engine ELEMENT_KEYS 5종 고정)',
  );
});

test('parseBatch — regime: A~E 전 코드 수용(목표 배분·제안도 국면에 맞춰 동기화된 배치)', () => {
  for (const preset of REGIME_PRESETS) {
    const raw = JSON.parse(VALID_BATCH_TEXT);
    raw.regime = preset.id;
    raw.target_allocation = {};
    raw.rebalance_proposals = [];
    for (let i = 0; i < ELEMENTS.length; i += 1) {
      const el = ELEMENTS[i];
      const batchKey = BATCH_KEY_OF[el];
      const target = preset.targetAllocation[el];
      const basis = BASIS_ALLOCATION[el];
      raw.target_allocation[batchKey] = target;
      raw.rebalance_proposals.push({
        element: batchKey,
        basis_pct: basis,
        target_pct: target,
        delta_pct: target - basis,
      });
    }
    const batch = parseBatch(JSON.stringify(raw));
    assert.notEqual(batch, null, `국면 ${preset.id} 배치 수용`);
    assert.equal(batch.regime, preset.id);
  }
  for (const bad of [null, 'X', '', 'D ', 5, true]) {
    assert.equal(parseBatch(withField('regime', bad)), null, `국면 코드 거부: ${JSON.stringify(bad)}`);
  }
});

test('parseBatch — regime_reasons: 비공백 문자열 list 필요', () => {
  const raw = JSON.parse(VALID_BATCH_TEXT);
  raw.regime_reasons = ['지수 입력'];
  assert.notEqual(parseBatch(JSON.stringify(raw)), null);
  assert.equal(parseBatch(withField('regime_reasons', '문자열 단독')), null);
  assert.equal(parseBatch(withField('regime_reasons', [42])), null);
  assert.equal(parseBatch(withField('regime_reasons', ['근거', '  '])), null, '공백 근거 행 거부');
});

test('parseBatch — target_allocation: 합 100·범위·v1 코어 대조(어긋나면 전체 거부)', () => {
  assert.equal(
    parseBatch(withField('target_allocation', { 목: 21.0, 화: 5.0, 토: 18.0, 금: 32.0, 수: 25.0 })),
    null,
    'v1 표와 다른 목표 배분 거부(국면 D → 木20 필요)',
  );
  assert.equal(
    parseBatch(withField('target_allocation', { 목: 20.0, 화: 5.0, 토: 18.0, 금: 32.0, 水: 25.0 })),
    null,
    '오행 키 혼용(수/水) 거부 — 엔진 키는 한글 초성 5종',
  );
  assert.equal(
    parseBatch(withField('target_allocation', { 목: 20.0, 화: 5.0, 토: 18.0, 금: 32.0, 수: 24.0 })),
    null,
    '합계 99 거부',
  );
  assert.equal(
    parseBatch(withField('target_allocation', { 목: '20', 화: 5.0, 토: 18.0, 금: 32.0, 수: 25.0 })),
    null,
    '문자열 거부',
  );

  // 1e-6 허용 오차(engine _ALLOCATION_SUM_TOL 동일 규격) — 부동소수 미세 노이즈는 수용
  const noisy = JSON.parse(VALID_BATCH_TEXT);
  noisy.target_allocation = { 목: 20.0 + 5e-7, 화: 5.0, 토: 18.0, 금: 32.0, 수: 25.0 };
  assert.notEqual(parseBatch(JSON.stringify(noisy)), null, '허용 오차 내 부동소수 노이즈 수용');
});

test('parseBatch — 국면 None 경로: target_allocation·rebalance_proposals는 null·[]만 허용(engine 계약)', () => {
  const raw = JSON.parse(VALID_BATCH_TEXT);
  raw.element_scores = { 목: null, 화: null, 토: null, 금: null, 수: null };
  raw.regime = null;
  raw.target_allocation = null;
  raw.rebalance_proposals = [];
  raw.regime_reasons = ['지수 입력: 목=None · 화=None · 토=None · 금=None · 수=None', '판정 불가 — 데이터 부족'];
  const batch = parseBatch(JSON.stringify(raw));
  assert.notEqual(batch, null, '국면 None(null) 배치 수용 — 수동 모드 유지용(null 채움 방지)');
  assert.equal(batch.regime, null);
  assert.equal(batch.target, null);
  assert.deepEqual(batch.proposals, []);

  raw.target_allocation = { 목: 22.0, 화: 12.0, 토: 16.0, 금: 32.0, 수: 18.0 };
  assert.equal(
    parseBatch(JSON.stringify(raw)),
    null,
    '국면 null + 목표 배분 존재 → engine 계약(target=REGIME_ALLOCATIONS[regime]) 위반 거부',
  );
});

test('parseBatch — rebalance_proposals: 행 필드 4종 고정·delta/target 일치·오행 키 엄격', () => {
  assert.equal(
    parseBatch(withField('rebalance_proposals', [])),
    null,
    '국면 D인데 제안 행이 비면 engine 계약(5행) 위반 — 거부',
  );
  const rows = JSON.parse(VALID_BATCH_TEXT).rebalance_proposals;

  const wrongDelta = JSON.parse(VALID_BATCH_TEXT);
  wrongDelta.rebalance_proposals = rows.map((r) =>
    r.element === '목' ? { ...r, delta_pct: -9.0 } : r,
  );
  assert.equal(parseBatch(JSON.stringify(wrongDelta)), null, 'delta ≠ target − basis 행 거부');

  const wrongTarget = JSON.parse(VALID_BATCH_TEXT);
  wrongTarget.rebalance_proposals = rows.map((r) =>
    r.element === '수' ? { ...r, target_pct: 24.0 } : r,
  );
  assert.equal(parseBatch(JSON.stringify(wrongTarget)), null, 'target_pct ≠ target_allocation 거부');

  const unknownEl = JSON.parse(VALID_BATCH_TEXT);
  unknownEl.rebalance_proposals = [...rows, { element: '甲', basis_pct: 0, target_pct: 0, delta_pct: 0 }];
  assert.equal(parseBatch(JSON.stringify(unknownEl)), null, '알 수 없는 오행 행 거부');

  const extraField = JSON.parse(VALID_BATCH_TEXT);
  extraField.rebalance_proposals = rows.map((r) => ({ ...r, note: 'x' }));
  assert.equal(parseBatch(JSON.stringify(extraField)), null, '행 외부 필드 거부(engine REBALANCE_ROW_FIELDS 고정)');

  const missingField = JSON.parse(VALID_BATCH_TEXT);
  missingField.rebalance_proposals = rows.map((r) => {
    const { delta_pct, ...rest } = r;
    void delta_pct;
    return rest;
  });
  assert.equal(parseBatch(JSON.stringify(missingField)), null, '행 필수 필드 누락 거부');

  assert.equal(parseBatch(withField('rebalance_proposals', 'rows')), null, '문자열 list 거부');
});

test('parseBatch — proxy_note: 비어있지 않은 문자열 필요', () => {
  assert.equal(parseBatch(withField('proxy_note', '')), null);
  assert.equal(parseBatch(withField('proxy_note', 42)), null);
});

test('parseBatch — generated_at: tz-aware ISO 8601 필요(존재하지 않는 날짜 거부)', () => {
  assert.equal(parseBatch(withField('generated_at', '2026-11-03T11:17:34')), null, 'naive(타임존 없음) 거부');
  assert.equal(parseBatch(withField('generated_at', '2026-02-30T00:00:00+00:00')), null, '2/30 없는 날짜 거부');
  assert.equal(parseBatch(withField('generated_at', 'not-a-date')), null);
  assert.equal(parseBatch(withField('generated_at', 42)), null);

  for (const stamp of ['2026-11-03T12:00:00Z', '2026-11-03T11:17:34+09:00', '2026-11-03T11:17:34.5+00:00']) {
    const raw = JSON.parse(VALID_BATCH_TEXT);
    raw.generated_at = stamp;
    assert.notEqual(parseBatch(JSON.stringify(raw)), null, `tz-aware ISO 수용: ${stamp}`);
  }
});

/* ────────────────────────────── 표시 포맷 ────────────────────────────── */

test('formatGeneratedAt — 초 미만 절삭·Z → +00:00·T → 공백(결정적 표시 문자열)', () => {
  assert.equal(formatGeneratedAt('2026-11-03T11:17:34.926924+00:00'), '2026-11-03 11:17:34+00:00');
  assert.equal(formatGeneratedAt('2026-11-03T12:00:00Z'), '2026-11-03 12:00:00+00:00');
  assert.equal(formatGeneratedAt('2026-11-03T11:17:34+09:00'), '2026-11-03 11:17:34+09:00');
});

test('batchBannerText — "실측 모드(배치 시각: 생성시각)" 배너 문구', () => {
  const batch = parseBatch(VALID_BATCH_TEXT);
  assert.equal(batchBannerText(batch), '실측 모드(배치 시각: 2026-11-03 11:17:34+00:00)');
});

test('formatRebalanceRow — 기준 배분 → 국면 목표의 제안 행 표시 문자열', () => {
  assert.equal(
    formatRebalanceRow({ element: '木', basisPct: 30.0, targetPct: 20.0, deltaPct: -10.0 }),
    '木 감소 제안 — 기준 30%p → 목표 20%p (Δ −10%p)',
  );
  assert.equal(
    formatRebalanceRow({ element: '金', basisPct: 25.0, targetPct: 32.0, deltaPct: 7.0 }),
    '金 증가 제안 — 기준 25%p → 목표 32%p (Δ +7%p)',
  );
  assert.equal(
    formatRebalanceRow({ element: '土', basisPct: 20.0, targetPct: 18.0, deltaPct: -2.0 }),
    '土 감소 제안 — 기준 20%p → 목표 18%p (Δ −2%p)',
  );
  assert.equal(
    formatRebalanceRow({ element: '金', basisPct: 25.0, targetPct: 25.0, deltaPct: 0 }),
    '金 유지 — 기준 25%p = 목표 25%p (Δ ±0%p)',
  );
});

/* ────────────────────────────── applyBatch(값 반영) ────────────────────────────── */

test('applyBatch — 지수 5종(지표 슬라이더)·국면을 실측 값으로 채운다', () => {
  const result = applyBatch(initialState(), parseBatch(VALID_BATCH_TEXT));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.indicators, { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 });
  assert.equal(result.state.regimeId, 'D');
  assert.equal(result.state.saveEnabled, false, '수동 나머지 영역(items·토글)은 그대로');
  assert.deepEqual(result.state.items, []);
});

test('applyBatch — 배치 메타(생성시각·근거·프록시 고지·제안·지수 스냅샷)를 state.batch로 보관한다', () => {
  const batch = parseBatch(VALID_BATCH_TEXT);
  const result = applyBatch(initialState(), batch);
  assert.deepEqual(result.state.batch.scores, { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 });
  assert.equal(result.state.batch.generatedAt, batch.generatedAt);
  assert.equal(result.state.batch.generatedAtText, '2026-11-03 11:17:34+00:00');
  assert.equal(result.state.batch.regime, 'D');
  assert.equal(result.state.batch.hasAllScores, true);
  assert.deepEqual(result.state.batch.reasons, batch.reasons);
  assert.deepEqual(result.state.batch.proposals, batch.proposals);
  assert.match(result.state.batch.proxyNote, /프록시 한계/);
});

test('applyBatch — 부족 지표(null) 슬라이더는 미반영(기존 값 유지) + hasAllScores false', () => {
  const raw = JSON.parse(VALID_BATCH_TEXT);
  raw.element_scores = { 목: null, 화: 78, 토: 16, 금: 45, 수: null };
  const batch = parseBatch(JSON.stringify(raw));
  const before = initialState();
  before.indicators = { 木: 5, 火: 10, 土: 20, 金: 25, 水: 7 };
  const result = applyBatch(before, batch);
  assert.equal(result.ok, true);
  assert.equal(result.state.indicators['木'], 5, 'null 지수 → 미반영');
  assert.equal(result.state.indicators['水'], 7, 'null 지수 → 미반영');
  assert.equal(result.state.indicators['火'], 78, '실측 값 반영');
  assert.equal(result.state.batch.hasAllScores, false);
});

test('applyBatch — 국면 null 배치는 국면 선택을 해제한다(강제 매칭 금지)', () => {
  const raw = JSON.parse(VALID_BATCH_TEXT);
  raw.regime = null;
  raw.target_allocation = null;
  raw.rebalance_proposals = [];
  raw.element_scores = { 목: null, 화: null, 토: null, 금: null, 수: null };
  raw.regime_reasons = ['판정 불가 — 데이터 부족'];
  const prepared = setRegime(initialState(), 'B');
  assert.equal(prepared.ok, true, '시험 준비: 국면을 심은 상태');
  const result = applyBatch(prepared.state, parseBatch(JSON.stringify(raw)));
  assert.equal(result.ok, true);
  assert.equal(result.state.regimeId, null, '배치 국면 null → 선택 해제');
});

test('applyBatch — 배치 메타는 localStorage 직렬화에 오염되지 않는다(세션 스코프)', () => {
  const result = applyBatch(initialState(), parseBatch(VALID_BATCH_TEXT));
  const serialized = serializeState(result.state);
  assert.equal(parseState(serialized) !== null, true, '직렬화·복원 계약 유지');
  assert.doesNotMatch(serialized, /proxyNote|generatedAt|hasAllScores/);
  assert.equal(JSON.parse(serialized).regimeId, 'D', '국면 값은 사용자 상태로 보존');
});

test('applyBatch — 어떤 오염된 배치 입력도 거부하고 원본 상태를 보존한다', () => {
  const before = initialState();
  const result = applyBatch(before, null);
  assert.equal(result.ok, false);
  assert.notEqual(result.error, '');
  assert.deepEqual(before, initialState(), '거부 시 원본 불변');
});

/* ────────────────────────────── measuredScores(레이더 오버레이) ────────────────────────────── */

test('measuredScores — 지수 5종이 모두 있을 때만 레이더 오버레이 값을 내보낸다', () => {
  const full = parseBatch(VALID_BATCH_TEXT);
  assert.deepEqual(measuredScores(full), { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 });

  const partialRaw = JSON.parse(VALID_BATCH_TEXT);
  partialRaw.element_scores = { 목: null, 화: 78, 토: 16, 금: 45, 수: 63 };
  const partial = parseBatch(JSON.stringify(partialRaw));
  assert.notEqual(partial, null);
  assert.equal(measuredScores(partial), null, '부분 부족 배치는 오버레이 미표시(0 다각형 왜곡 방지)');
  assert.equal(measuredScores(null), null);
});

/* ────────────────────────────── loadBatch(fetch 경로) ────────────────────────────── */

test('BATCH_URL — index.html 상대경로 data/state.json 고정(req-v2 §4)', () => {
  assert.equal(BATCH_URL, 'data/state.json');
});

test('loadBatch — 배치 산출물 有: text → parseBatch 정규화 배치 반환', async () => {
  let requested = null;
  const batch = await loadBatch(async (url) => {
    requested = url;
    return { ok: true, text: async () => VALID_BATCH_TEXT };
  });
  assert.equal(requested, 'data/state.json');
  assert.notEqual(batch, null);
  assert.equal(batch.regime, 'D');
});

test('loadBatch — 배치 부재(404)·네트워크 실패·텍스트 오류·무결 위반 → null(조용히 포기)', async () => {
  assert.equal(await loadBatch(async () => ({ ok: false, status: 404, text: async () => 'nope' })), null);
  assert.equal(await loadBatch(async () => { throw new Error('network down'); }), null);
  assert.equal(
    await loadBatch(async () => ({ ok: true, text: async () => { throw new Error('stream error'); } })),
    null,
  );
  assert.equal(await loadBatch(async () => null), null, '알 수 없는 응답 형태도 무시');
  assert.equal(await loadBatch(async () => ({ ok: true, text: async () => '{중괄호 짝 안 맞음' })), null, '무결 위반도 배치 없음');
  assert.equal(await loadBatch(async () => ({ ok: true, text: async () => '' })), null);
});

test('loadBatch — 실패 경로에서 콘솔 오류·경고 노출 0건(부재 시 조용한 포기 계약)', async () => {
  const calls = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => calls.push(['error', ...args]);
  console.warn = (...args) => calls.push(['warn', ...args]);
  try {
    await loadBatch(async () => ({ ok: false, status: 404, text: async () => 'x' }));
    await loadBatch(async () => { throw new Error('network'); });
    await loadBatch(async () => ({ ok: true, text: async () => 'garbage{' }));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0, `콘솔 노출 없어야 — 실제: ${JSON.stringify(calls)}`);
});

/* ────────────────────────────── 레이더 실측 오버레이(선택 파라미터 — v1 회귀 없음) ────────────────────────────── */

test('buildRadarSVG — measured 미지정(또는 null)이면 v1 SVG와 완전히 동일하다(바이트 동일)', () => {
  const dist = { ...BASIS_ALLOCATION };
  assert.equal(buildRadarSVG({ current: null, measured: null }), buildRadarSVG({ current: null }));
  assert.equal(buildRadarSVG({ current: dist, measured: null }), buildRadarSVG({ current: dist }));
  assert.doesNotMatch(buildRadarSVG({ current: dist }), /radar-measured/);
});

test('buildRadarSVG — measured 오버레이: 실측 지수 5종 다각형 + 스케일 확장(78 → 90 눈금)', () => {
  const measured = { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 };
  const svg = buildRadarSVG({ current: null, measured });
  assert.match(svg, /data-testid="radar-measured"/);
  assert.match(svg, />22\.5</, '확장 스케일 90의 1/4 눈금 노출');
  assert.match(svg, />90</, '확장 스케일 상단 눈금 노출');
  const pointsMatch = svg.match(/data-testid="radar-measured"\s+points="([^"]+)"/);
  assert.equal(pointsMatch[1], polygonPoints(measured, 90));
});

test('레이더 오버레이 계약 — measured 축도 코어 ELEMENTS 순서(벡터 투영 계약 공유)', () => {
  const measured = { 木: 37, 火: 78, 土: 16, 金: 45, 水: 63 };
  const svg = buildRadarSVG({ current: null, measured });
  const points = svg.match(/data-testid="radar-measured"\s+points="([^"]+)"/)[1];
  const firstPoint = points.split(' ')[0];
  const top = radarPoint(0, 37, 90); // 木은 12시 방향(코어 ELEMENTS[0])
  assert.equal(firstPoint, `${top.x.toFixed(2)},${top.y.toFixed(2)}`);
});

/* ────────────────────────────── 실제 엔진 배치 산출물 무결 스모크 ────────────────────────────── */

test('parseBatch — 커밋된 engine/data/state.json 실측 배치가 무결하다(req-v2 스키마 7필드)', () => {
  const engineState = readFileSync(new URL('../engine/data/state.json', import.meta.url), 'utf8');
  const batch = parseBatch(engineState);
  assert.notEqual(batch, null, '엔진 배치 산출이 파싱되어야 한다(국면·지수 갱신에도 계약 불변)');

  const scoreValues = ELEMENTS.map((el) => batch.scores[el]);
  assert.ok(
    scoreValues.every((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100)),
    '지수는 null(부족) 또는 0~100',
  );
  if (batch.regime === null) {
    assert.equal(batch.target, null, '국면 null → engine 계약상 목표 배분도 null');
  } else {
    const coreTarget = shiftAllocation(batch.regime, BASIS_ALLOCATION);
    for (const el of ELEMENTS) {
      assert.ok(Math.abs(batch.target[el] - coreTarget[el]) <= 1e-6, `${batch.regime} → v1 표 일치 (${el})`);
    }
  }
  assert.ok(batch.proxyNote.trim().length > 0, '프록시 한계 고지 존재');
  assert.ok(batch.reasons.length > 0, '판정 근거 존재');
});

/* ────────────────────────────── app.js 연결 계약(정적 — DOM은 브라우저 실측) ────────────────────────────── */

test('ui/app.js — 실측 모드 연결: loadBatch(fetch)·적용·렌더 연결 존재, 콘솔 오류 없음', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, '../ui/app.js'), 'utf8');
  assert.match(app, /loadBatch\(/, '배치 로드 진입점 존재');
  assert.match(app, /(fetch\((?:BATCH_URL|loadBatch))/s, '표준 fetch 경유(정적 fetch만 — API 서버 없음)');
  assert.doesNotMatch(app, /console\.error|console\.warn/, '콘솔 오류 노출 금지(req-v2 §4 — 부재 시 조용한 포기)');
  assert.doesNotMatch(app, /XMLHttpRequest|WebSocket/, '정적 fetch만(v2b API 서버 금지)');
});

test('index.html — 실측 모드 배너·근거·프록시 고지·배치 제안 거점 존재(기본 hidden — 수동 모드 유지)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, '../index.html'), 'utf8');
  for (const id of ['batch-banner', 'batch-banner-text', 'batch-reasons', 'batch-proxy-note', 'batch-rebalance-note', 'batch-rebalance']) {
    assert.match(html, new RegExp(`id="${id}"`), `실측 모드 거점 존재: ${id}`);
  }
  assert.match(html, /id="batch-banner"[^>]*hidden/, '배너는 기본 hidden(부재 시 수동 모드 그대로)');
  assert.match(html, /swatch-measured/, '레이더 실측 지수 범례 존재');
  assert.doesNotMatch(html, /src="https?:|href="https?:\/\/[^"]*\.css/, '외부 의존성 여전히 0');
  const indSliders = (html.match(/data-ind=/g) ?? []).length;
  assert.equal(indSliders, 5, '지표 슬라이더 5종 유지(회귀 방지)');
});

/* ────────────────────────────── (끝) ────────────────────────────── */