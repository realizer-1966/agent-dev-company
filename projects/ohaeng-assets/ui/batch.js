/**
 * batch.js — 실측 모드 계층(티켓 ⑤, req-v2 §4·§5-5): v1 엔진 배치 산출물
 * (engine/data/state.json — 스키마 7필드)을 받아 수동 모드 상태에 조용히 적용하는 순수 ES 모듈.
 *
 * 계약(req-v2 §4):
 *  - `fetch('data/state.json')`(index.html 상대경로) — 부재(404)·네트워크 실패·무결 위반은
 *    전부 null로 수렴해 **조용히 포기**(콘솔 에러 노출 금지)하고 기존 수동 모드를 유지한다.
 *  - 존재 시: 배너("실측 모드(배치 시각)", state.json 생성시각) + 지수 5종(레이더/지표) +
 *    국면 + 목표 배분 + 제안 리밸런싱 + 프록시 한계 고지를 반영한다.
 *
 * 계산 재구현 금지 원칙(수동 모드와 동일): 목표 배분 일관성은 코어 barrel(src/index.js)의
 * shiftAllocation·BASIS_ALLOCATION·REGIME_PRESETS과의 **대조**로 검증한다 — 엔진(REGIME_ALLOCATIONS)
 * 이 v1 REGIME_PRESETS 매핑 재사용이므로 두 산출은 일치해야 하고, 어긋나면 배치 전체를 거부한다.
 *
 * 전체 거부 원칙(engine/feaas/report.py validate_state 계약 동일): 스키마 7필드 누락·외부 필드·
 * 값 위반은 무엇이든 전체 거부(null) — 절반만 반영되는 오염 없음(무결).
 */

import { ELEMENTS, BASIS_ALLOCATION, REGIME_PRESETS, shiftAllocation } from '../src/index.js';

/** 배치 산출물 URL — index.html 상대경로 고정(정적 fetch 전용 — API 서버 없음, req-v2 §4). */
export const BATCH_URL = 'data/state.json';

/** engine state.json의 오행 키(한글 초성) → 코어 ELEMENTS(한자) 매핑 — engine/feaas/report.py ELEMENT_KEYS. */
const BATCH_ELEMENTS = { 목: '木', 화: '火', 토: '土', 금: '金', 수: '水' };
const BATCH_KEYS = Object.keys(BATCH_ELEMENTS); // ['목','화','토','금','수'] — ELEMENTS 순서와 대응

/** engine 라벨(目·火…)은 element_scores 값에서 이미 제거되어 배치산출 스키마는 한글 초성 5종 고정. */
const SCHEMA_FIELDS = [
  'generated_at',
  'element_scores',
  'regime',
  'regime_reasons',
  'target_allocation',
  'rebalance_proposals',
  'proxy_note',
];

const PROPOSAL_FIELDS = ['element', 'basis_pct', 'target_pct', 'delta_pct'];

const REGIME_IDS = REGIME_PRESETS.map((preset) => preset.id);
const GENERATED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SCORE_TOL = 1e-9;      // engine report._SCORE_TOL 동일 규격
const ALLOCATION_TOL = 1e-6; // engine report._ALLOCATION_SUM_TOL 동일 규격

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** 지수·목표 배분 값 허용 범위(0~100 · 부동소수 허용 오차 — engine ±tol 규격 동일). */
function withinRange(value, tolerance) {
  return isNumber(value) && value >= -tolerance && value <= 100 + tolerance;
}

/**
 * generated_at 검증 — tz-aware ISO 8601(engine datetime.fromisoformat 계약 동일).
 * 정규식 형상 + 실존 날짜(2/30 등 롤오버 감지: 라운드트립 대조).
 */
function isValidGeneratedAt(value) {
  if (typeof value !== 'string') return false;
  const match = GENERATED_AT_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second
  );
}

/** 배치 산출물 내부 키(한글 초성) 객체의 키 집합이 오행 5종과 정확히 같은지 검사. */
function isFiveKeyObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    BATCH_KEYS.length === Object.keys(value).length &&
    BATCH_KEYS.every((key) => key in value)
  );
}

/** 목표 배분 검증·정규화(코어 shiftAllocation 대조 포함) — 무효면 null. */
function validatedTarget(targetRaw, regime) {
  if (targetRaw === null) {
    // engine 계약: 국면 판정 null → 목표 배분도 null(run_pipeline REGIME_ALLOCATIONS[regime] 재사용)
    return regime === null ? null : 'INVALID';
  }
  if (regime === null) return 'INVALID'; // 국면 null + 목표 존재 → engine 계약 위반
  if (!isFiveKeyObject(targetRaw)) return 'INVALID';
  let sum = 0;
  for (const key of BATCH_KEYS) {
    if (!withinRange(targetRaw[key], ALLOCATION_TOL)) return 'INVALID';
    sum += targetRaw[key];
  }
  if (Math.abs(sum - 100) > ALLOCATION_TOL) return 'INVALID';

  // v1 코어 대조 — 배치 목표 배분은 v1 REGIME_PRESETS 재사용이므로 코어 산출과 일치해야 한다
  const expected = shiftAllocation(regime, BASIS_ALLOCATION);
  const target = {};
  for (const key of BATCH_KEYS) {
    const element = BATCH_ELEMENTS[key];
    if (Math.abs(targetRaw[key] - expected[element]) > ALLOCATION_TOL) return 'INVALID';
    target[element] = targetRaw[key];
  }
  return target;
}

/**
 * 배치 JSON 텍스트 → 정규화 배치 객체 또는 null(부재 아님 — **무결 위반**도 null로 수렴).
 * 어떤 오염도 전체 거부(절반 적용 없음) — 수동 모드가 그대로 유지된다.
 * @param {string} text state.json 본문
 * @returns {{generatedAt: string, generatedAtText: string, scores: Object.<string,(number|null)>,
 *            regime: string|null, reasons: string[], target: Object|null,
 *            proposals: Object[], proxyNote: string}|null}
 */
export function parseBatch(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  // 스키마 7필드 고정(engine validate_state 계약 동일 — 누락·외부 필드 전부 거부)
  const keys = Object.keys(raw);
  if (keys.length !== SCHEMA_FIELDS.length || !SCHEMA_FIELDS.every((field) => field in raw)) {
    return null;
  }

  if (!isValidGeneratedAt(raw.generated_at)) return null;

  // 지수 5종 — 오행 키 5종 고정, 값은 null(부족 지표 — 미반영) 또는 0~100 숫자
  const scoresRaw = raw.element_scores;
  if (!isFiveKeyObject(scoresRaw)) return null;
  for (const key of BATCH_KEYS) {
    const score = scoresRaw[key];
    if (score !== null && !withinRange(score, SCORE_TOL)) return null;
  }

  // 국면 — A~E 或 null
  const regime = raw.regime;
  if (regime !== null && (typeof regime !== 'string' || !REGIME_IDS.includes(regime))) return null;

  // 판정 근거 — 비공백 문자열 list
  const reasons = raw.regime_reasons;
  if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string' || reason.trim() === '')) {
    return null;
  }

  // 목표 배분
  const target = validatedTarget(raw.target_allocation, regime);
  if (target === 'INVALID') return null;

  // 제안 리밸런싱 — target 有: engine은 ELEMENTS 전 행(기준 배분 합 100) 산출 / target 無: []
  const proposalsRaw = raw.rebalance_proposals;
  if (!Array.isArray(proposalsRaw)) return null;
  if (target === null && proposalsRaw.length > 0) return null;
  const proposals = [];
  const seen = new Set();
  let basisSum = 0;
  for (const row of proposalsRaw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    if (
      PROPOSAL_FIELDS.length !== Object.keys(row).length ||
      !PROPOSAL_FIELDS.every((field) => field in row)
    ) {
      return null;
    }
    const batchKey = row.element;
    if (typeof batchKey !== 'string' || !(batchKey in BATCH_ELEMENTS)) return null;
    if (seen.has(batchKey)) return null; // 중복 행 거부(engine은 오행당 1행)
    if (!isNumber(row.basis_pct) || !isNumber(row.target_pct) || !isNumber(row.delta_pct)) return null;
    const element = BATCH_ELEMENTS[batchKey];
    if (target !== null && Math.abs(row.target_pct - target[element]) > ALLOCATION_TOL) return null;
    if (target !== null && Math.abs(row.delta_pct - (target[element] - row.basis_pct)) > ALLOCATION_TOL) return null;
    seen.add(batchKey);
    basisSum += row.basis_pct;
    proposals.push({ element, basisPct: row.basis_pct, targetPct: row.target_pct, deltaPct: row.delta_pct });
  }
  if (target !== null && Math.abs(basisSum - 100) > ALLOCATION_TOL) return null; // 기준 배분 합 100

  // 프록시 한계 고지 — 비어있지 않은 문자열
  const proxyNote = raw.proxy_note;
  if (typeof proxyNote !== 'string' || proxyNote.trim() === '') return null;

  const scores = {};
  for (const key of BATCH_KEYS) scores[BATCH_ELEMENTS[key]] = scoresRaw[key];

  return {
    generatedAt: raw.generated_at,
    generatedAtText: formatGeneratedAt(raw.generated_at),
    scores,
    regime,
    reasons,
    target,
    proposals,
    proxyNote,
  };
}

/** 배너 표시용 생성시각 — 초 미만 절삭·Z → +00:00·T → 공백(결정적 문자열 — 라이브러리 파싱 없음). */
export function formatGeneratedAt(value) {
  return String(value)
    .replace('Z', '+00:00')
    .replace(/T(\d{2}:\d{2}:\d{2})(\.\d+)?/, ' $1');
}

/** 배너 문구 — "실측 모드(배치 시각: 생성시각)"(req-v2 §4 배너 계약). */
export function batchBannerText(batch) {
  return `실측 모드(배치 시각: ${batch?.generatedAtText ?? ''})`;
}

/** 제안 리밸런싱 행 표시 문자열 — 기준 배분 → 국면 목표 배분("검토 후 적용" 성격 — UI 본문에서 병기). */
export function formatRebalanceRow(row) {
  const pct = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
  const basis = pct(row.basisPct);
  const target = pct(row.targetPct);
  const delta = pct(Math.abs(row.deltaPct));
  if (row.deltaPct === 0) {
    return `${row.element} 유지 — 기준 ${basis}%p = 목표 ${target}%p (Δ ±${delta}%p)`;
  }
  const direction = row.deltaPct > 0 ? '증가 제안' : '감소 제안';
  const sign = row.deltaPct > 0 ? '+' : '−';
  return `${row.element} ${direction} — 기준 ${basis}%p → 목표 ${target}%p (Δ ${sign}${delta}%p)`;
}

/** 레이더 오버레이 값 — 지수 5종이 모두 존재할 때만(부분 부족 배치의 0 다각형 왜곡 방지). */
export function measuredScores(batch) {
  if (batch === null || typeof batch !== 'object' || batch.scores === null || typeof batch.scores !== 'object') {
    return null;
  }
  return ELEMENTS.every((el) => Number.isFinite(batch.scores[el])) ? batch.scores : null;
}

/**
 * 배치를 수동 모드 상태에 적용 — 실측 값(지수 5종·국면)만 채우고 배치 메타를 state.batch로 보관.
 * 부족 지표(null) 슬라이더는 미반영(기존 값 유지 — 0 다각형·왜곡 방지), 국면 null 배치는 선택 해제.
 * 배치 메타는 세션 스코프 — localStorage 직렬화(serializeState)에 포함되지 않는다.
 * @returns {{ok: true, state} | {ok: false, error: string}} 수동 모드와 동일한 {ok,state|error} 계약
 */
export function applyBatch(state, batch) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  if (batch === null || typeof batch !== 'object') {
    return { ok: false, error: '배치 데이터가 없다 — 부재(404)·무결 위반은 수동 모드로 유지한다' };
  }
  if (batch.scores === null || typeof batch.scores !== 'object') {
    return { ok: false, error: '배치 형식이 옳지 않다 — 지수 5종이 필요하다' };
  }

  const indicators = { ...state.indicators };
  let hasAllScores = true;
  for (const el of ELEMENTS) {
    const value = batch.scores[el];
    if (value === null || value === undefined) {
      hasAllScores = false; // 부족 지표 — 미반영(기존 값 유지)
      continue;
    }
    if (!isNumber(value) || value < 0 || value > 100) {
      return { ok: false, error: `배치 지수는 0~100의 수여야 한다 (${el}=${String(value)})` };
    }
    indicators[el] = value;
  }

  return {
    ok: true,
    state: {
      ...state,
      indicators,
      regimeId: batch.regime ?? null,
      batch: {
        generatedAt: batch.generatedAt ?? null,
        generatedAtText: batch.generatedAtText ?? '',
        regime: batch.regime ?? null,
        scores: { ...batch.scores },
        reasons: [...(batch.reasons ?? [])],
        target: batch.target === null || batch.target === undefined ? null : { ...batch.target },
        proposals: (batch.proposals ?? []).map((row) => ({ ...row })),
        proxyNote: batch.proxyNote ?? '',
        hasAllScores,
      },
    },
  };
}

/**
 * 배치 로드 — `fetch('data/state.json')`(index.html 상대경로).
 * 부재(404·ok:false)·네트워크 실패·텍스트 오류·무결 위반은 전부 null — **콘솔 에러 노출 없이 조용히 포기**.
 * @param {(url: string) => Promise<{ok: boolean, text: () => Promise<string>}>} fetcher 표준 fetch 주입점
 * @returns {Promise<Object|null>} 정규화 배치 또는 null(수동 모드 유지)
 */
export async function loadBatch(fetcher) {
  if (typeof fetcher !== 'function') return null;
  let response;
  try {
    response = await fetcher(BATCH_URL);
  } catch {
    return null; // 네트워크 실패 — 조용히 포기
  }
  if (response === null || typeof response !== 'object' || response.ok !== true) {
    return null; // 부재(404 등) — 조용히 포기
  }
  let text;
  try {
    text = await response.text();
  } catch {
    return null; // 스트림 오류 — 조용히 포기
  }
  if (typeof text !== 'string') return null;
  return parseBatch(text); // 무결 위반도 null — 수동 모드 유지(콘솔 노출 없음)
}