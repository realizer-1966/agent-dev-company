/**
 * state.js — UI 상태 계층(티켓 ③): 자산 항목·오행 경제지표·국면 선택·localStorage 토글의
 * 상태 조작과 직렬화만 담당하는 순수 ES 모듈(DOM 의존성 없음 — node --test 대상).
 *
 * 계산 재구현 금지 원칙(req 8장, ② 티켓 핸드오프 "import src/index.js barrel only"):
 *  - 포트폴리오 분포 → weightedElementDistribution        (src/weighted.js)
 *  - EBI 균형도   → computeEBI                             (src/ebi.js)
 *  - 국면 목표 배분 → shiftAllocation / BASIS_ALLOCATION   (src/regimeShift.js)
 *  - 리밸런싱 제안 → suggestRebalance                      (src/rebalance.js)
 *  - 유형별 기본 벡터 제안 → getBasicVector / ASSET_TYPES  (src/vectors.js)
 * state.js는 코어가 거부하는 입력(음수·총액 0·형상 위반)을 코어 예외 그대로 받아
 * {ok:false, error} 형태로 되돌려 UI가 빈 상태·오류 메시지로 정상 표시하게만 한다.
 */

import {
  ELEMENTS,
  ASSET_TYPES,
  BASIS_ALLOCATION,
  REGIME_PRESETS,
  getBasicVector,
  weightedElementDistribution,
  computeEBI,
  shiftAllocation,
  suggestRebalance,
} from '../src/index.js';

/** localStorage 저장 키 — 앱(ui/app.js)이 브라우저 localStorage에 그대로 사용한다. */
export const STORAGE_KEY = 'feaas-ohaeng-state-v1';

/** 직렬화 형식 버전. 형상·규칙이 바뀌면 오른쪽 끝 숫자만 바꾼다(구 버전 데이터는 거부→새 상태). */
const SERIALIZE_VERSION = 1;

const REGIME_IDS = REGIME_PRESETS.map((r) => r.id);

/** 유한 수여야 통과한다(코어와 동일 기준: Infinity·NaN·문자열·null 거부). */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 유형별 기본 벡터 제안(5요소 슬라이더 초기값) — 코어 getBasicVector 그대로(복사본).
 * 요구사항 7장 "유형별 오행 벡터 자동 제안"의 유일 근거.
 */
export function suggestVector(typeId) {
  return getBasicVector(typeId);
}

/**
 * 사용자 벡터 검증 — null/undefined(유형 기본 제안 사용) 외에는
 * core weightedElementDistribution가 받는 형상(5오행 키 완전·0~100 유한수·합 > 0)만 허용.
 * @returns {{木:number, 火:number, 土:number, 金:number, 水:number}|null} 복사본 또는 null(기본 제안)
 */
function validatedVector(vector) {
  if (vector === null || vector === undefined) return null;
  if (vector === null || typeof vector !== 'object') {
    throw new Error('벡터는 5오행 키를 가진 객체거나 비어 있어야(유형 기본 제안) 한다');
  }
  const complete = ELEMENTS.every((el) => el in vector) && Object.keys(vector).length === ELEMENTS.length;
  if (!complete) {
    throw new Error('벡터는 5오행(木·火·土·金·水) 키가 모두 필요하다');
  }
  let sum = 0;
  for (const el of ELEMENTS) {
    const v = vector[el];
    if (!isFiniteNumber(v) || v < 0 || v > 100) {
      throw new Error(`벡터의 각 요소는 0~100의 수여야 한다 (${el}=${String(v)})`);
    }
    sum += v;
  }
  if (!(sum > 0)) {
    throw new Error('벡터 합계가 0이다 — 오행 분포로 정규화할 수 없다');
  }
  return { ...vector };
}

/** 최초 상태: 항목 없음·지표 0·국면 미선택·저장 토글 off. */
export function initialState() {
  return {
    saveEnabled: false,
    items: [],
    indicators: { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 },
    regimeId: null,
  };
}

/**
 * 자산 항목 추가. input: { name, typeId, amount, memo?, vector? }
 * vector를 생략(null)하면 유형 기본 벡터 제안을 따른다(코어 weighted 규칙과 동일).
 * @returns {{ok: true, state} | {ok: false, error: string}}
 */
export function addItem(state, input) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  if (!input || typeof input !== 'object') return { ok: false, error: '추가할 자산 정보가 없다' };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: '자산명·투자 대상을 입력하라' };

  const type = ASSET_TYPES.find((t) => t.id === input.typeId);
  if (!type) {
    return {
      ok: false,
      error: '유형을 선택해야 한다 — 2장 투자 대상 목록에서 고르거나 분류 가능한 이름을 입력하라',
    };
  }

  if (!isFiniteNumber(input.amount) || input.amount < 0) {
    return { ok: false, error: '금액은 0 이상의 수여야 한다(음수·텍스트는 거부)' };
  }

  let vector;
  try {
    vector = validatedVector(input.vector);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const item = {
    id: newId(),
    name,
    typeId: type.id,
    amount: input.amount,
    memo: typeof input.memo === 'string' ? input.memo.trim() : '',
    vector,
  };
  return { ok: true, state: { ...state, items: [...state.items, item] } };
}

/**
 * 항목 수정. patch: { name?, typeId?, amount?, memo?, vector? }
 * typeId가 변경될 때 patch.vector가 명시되지 않으면 벡터를 null로 되돌린다 —
 * 유형이 바뀌면 이전 유형의 슬라이더 조정값을 그대로 옮기는 것은 오행 의미를 다르게 한다.
 */
export function updateItem(state, id, patch) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  const idx = state.items.findIndex((it) => it.id === id);
  if (idx === -1) return { ok: false, error: '해당 자산 항목이 없다' };
  if (!patch || typeof patch !== 'object') return { ok: false, error: '변경 내용이 없다' };

  const prev = state.items[idx];
  const next = { ...prev };

  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name) return { ok: false, error: '자산명·투자 대상을 입력하라' };
    next.name = name;
  }
  let typeChanged = false;
  if (patch.typeId !== undefined && patch.typeId !== prev.typeId) {
    const type = ASSET_TYPES.find((t) => t.id === patch.typeId);
    if (!type) return { ok: false, error: '알 수 없는 자산 유형이다(2장 목록의 유형만 허용)' };
    next.typeId = type.id;
    typeChanged = true;
  }
  if (patch.amount !== undefined) {
    if (!isFiniteNumber(patch.amount) || patch.amount < 0) {
      return { ok: false, error: '금액은 0 이상의 수여야 한다(음수·텍스트는 거부)' };
    }
    next.amount = patch.amount;
  }
  if (patch.memo !== undefined) {
    if (typeof patch.memo !== 'string') return { ok: false, error: '메모는 텍스트여야 한다' };
    next.memo = patch.memo.trim();
  }
  if (patch.vector !== undefined || (!('vector' in patch) && typeChanged)) {
    try {
      next.vector = validatedVector(patch.vector !== undefined ? patch.vector : null);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const items = [...state.items];
  items[idx] = next;
  return { ok: true, state: { ...state, items } };
}

/** 항목 삭제. 없는 id는 거부한다(조용한 무시 대신 명확히). */
export function removeItem(state, id) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  const exists = state.items.some((it) => it.id === id);
  if (!exists) return { ok: false, error: '해당 자산 항목이 없다' };
  return { ok: true, state: { ...state, items: state.items.filter((it) => it.id !== id) } };
}

/**
 * 국면 선택(4장 A~E) — null은 "선택 없음"(목표 = 기준 배분).
 * 미지 국면은 코어 shiftAllocation과 동일 계약으로 거부한다(req 9장 3번).
 */
export function setRegime(state, regimeId) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  if (regimeId === null) return { ok: true, state: { ...state, regimeId: null } };
  if (typeof regimeId !== 'string' || !REGIME_IDS.includes(regimeId)) {
    return {
      ok: false,
      error: `알 수 없는 국면이다 — ${REGIME_IDS.join('·')} 중에서 선택하거나 해제하라`,
    };
  }
  return { ok: true, state: { ...state, regimeId } };
}

/** 오행 경제지표(4장, 0~100 슬라이더) 수동 입력. */
export function setIndicator(state, element, value) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  if (!ELEMENTS.includes(element)) return { ok: false, error: '오행(木·火·土·金·水)이 아니다' };
  if (!isFiniteNumber(value) || value < 0 || value > 100) {
    return { ok: false, error: '지표 값은 0~100의 수여야 한다' };
  }
  return { ok: true, state: { ...state, indicators: { ...state.indicators, [element]: value } } };
}

/** localStorage 저장 토글(7장 — 선택 토글). boolean만 허용. */
export function setSaveEnabled(state, enabled) {
  if (!state || typeof state !== 'object') return { ok: false, error: '상태가 없다' };
  if (typeof enabled !== 'boolean') return { ok: false, error: '토글 값은 boolean이어야 한다' };
  return { ok: true, state: { ...state, saveEnabled: enabled } };
}

/**
 * 현재 포트폴리오 오행 분포 — 코어 weightedElementDistribution 그대로.
 * 빈 목록·총액 0·형상 위반(코어 거부 케이스)은 null로 변환해 UI 빈 상태로 표시한다.
 * @returns {{木,火,土,金,水}|null} 합계 100 분포(%p) 또는 null
 */
export function computeDistribution(state) {
  if (!state || typeof state !== 'object') return null;
  try {
    return weightedElementDistribution(state.items);
  } catch {
    return null;
  }
}

/** EBI(0~100 정수, 코어 computeEBI). 분포를 구할 수 없는 상태면 null. */
export function computeEBIValue(state) {
  const dist = computeDistribution(state);
  return dist === null ? null : computeEBI(dist);
}

/**
 * 목표 배분 — 국면 미선택이면 기준 배분(3장) 복사본, 선택 시 코어 shiftAllocation.
 * @returns {{木,火,土,金,水}} 합계 100 목표 배분
 */
export function currentTarget(state) {
  if (state && typeof state === 'object' && state.regimeId) {
    return shiftAllocation(state.regimeId, BASIS_ALLOCATION);
  }
  return { ...BASIS_ALLOCATION };
}

/**
 * 오행별 부호 있는 격차: Δ = 목표 − 현재(%p). 현재가 크면 음수.
 * 국면 제안 표(7장 격차 표시)의 수치 근거 — 반올림은 표시 계층의 몫.
 * @returns {{木:number, 火:number, 土:number, 金:number, 水:number}}
 */
export function elementGaps(distribution, target) {
  const gaps = {};
  for (const el of ELEMENTS) gaps[el] = target[el] - distribution[el];
  return gaps;
}

/**
 * 리밸런싱 제안(7장) — 코어 suggestRebalance 그대로.
 * |현재−목표| ≥ 5%p 자산군만, ELEMENTS 고정 순서, 경계 4.99%p는 미제안.
 * 분포를 구할 수 없는 상태(빈 목록·총액 0)는 비교 불가 → 빈 배열(제안 없음).
 */
export function rebalanceSuggestions(state) {
  const dist = computeDistribution(state);
  if (dist === null) return [];
  return suggestRebalance(dist, currentTarget(state));
}

function serializeItems(items) {
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    typeId: it.typeId,
    amount: it.amount,
    memo: it.memo,
    vector: it.vector,
  }));
}

/** 상태 → 직렬화 문자열(localStorage 본문). 형식 {version, saveEnabled, items, indicators, regimeId}. */
export function serializeState(state) {
  return JSON.stringify({
    version: SERIALIZE_VERSION,
    saveEnabled: state.saveEnabled,
    items: serializeItems(state.items),
    indicators: state.indicators,
    regimeId: state.regimeId,
  });
}

function isWithinRange(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/**
 * 직렬화 문자열 → 상태(완전 검증·필요한 키만 재구성). 어떤 불일치도 전체 거부(null) —
 * 복원은 원자적이다(절반만 복원되는 오염 없음; 코어의 "명확히 거부" 원칙과 동일).
 * @returns {object|null} 복원된 상태 또는 null(호출자는 초기 상태로 시작한다)
 */
export function parseState(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== SERIALIZE_VERSION) return null;
  if (typeof parsed.saveEnabled !== 'boolean') return null;
  if (!Array.isArray(parsed.items)) return null; // 빈 배열(초기 상태)은 허용한다

  const items = [];
  for (const it of parsed.items) {
    if (it === null || typeof it !== 'object' || Array.isArray(it)) return null;
    if (typeof it.id !== 'string' || !it.id) return null;
    if (typeof it.name !== 'string' || it.name.trim() === '') return null;
    const type = ASSET_TYPES.find((t) => t.id === it.typeId);
    if (!type) return null;
    if (!isFiniteNumber(it.amount) || it.amount < 0) return null;
    if (typeof it.memo !== 'string') return null;
    let vector;
    try {
      vector = validatedVector(it.vector === undefined ? null : it.vector);
    } catch {
      return null;
    }
    // 위험·불필요 키를 버리고 필요한 키만 재구성(프로토타입 오염 방지)
    items.push({ id: it.id, name: it.name.trim(), typeId: type.id, amount: it.amount, memo: it.memo, vector });
  }
  if (parsed.regimeId !== null && !REGIME_IDS.includes(parsed.regimeId)) return null;

  const ind = parsed.indicators;
  if (ind === null || typeof ind !== 'object' || Array.isArray(ind)) return null;
  if (ELEMENTS.some((el) => !isWithinRange(ind[el], 0, 100))) return null;

  return {
    saveEnabled: parsed.saveEnabled,
    items,
    indicators: { 木: ind['木'], 火: ind['火'], 土: ind['土'], 金: ind['金'], 水: ind['水'] },
    regimeId: parsed.regimeId,
  };
}