/**
 * app.js — 오행 자산 진단기 UI 엔트리(티켓 ③). DOM 생성·이벤트·렌더만 담당하고,
 * 계산은 전부 코어 barrel(src/index.js)→ui/state.js를 경유해 받는다(재구현 금지).
 *
 *  - 자산 입력(항목 2·3): 유형 선택(코어 ASSET_TYPES) + 직접 입력(코어 classifyAsset 자동 분류),
 *    금액·메모, 5요소 벡터 슬라이더(0~100 — 유형 기본 제안 채움·조정 시 명시 벡터).
 *  - 레이더(항목 1)·EBI(항목 7)·지표(항목 4)·국면(항목 5)·리밸런싱(항목 6)·상생(항목 8) 렌더.
 *  - localStorage(항목 10): saveEnabled 토글 on → 매 변경 저장, off → 저장 소거.
 * 모든 상태 변경은 state.js의 {ok, state|error} 계약을 거친다 — UI는 거부문을 그대로 보여준다.
 */

import {
  ELEMENTS,
  ELEMENT_SCORE_MEANINGS,
  ASSET_TYPES,
  EBI_DEFINITION,
  CIRCULATION_NOTES,
  classifyAsset,
} from '../src/index.js';
import {
  initialState,
  addItem,
  updateItem,
  removeItem,
  setRegime,
  setIndicator,
  setSaveEnabled,
  computeDistribution,
  computeEBIValue,
  currentTarget,
  elementGaps,
  rebalanceSuggestions,
  suggestVector,
  serializeState,
  parseState,
  STORAGE_KEY,
} from './state.js';
import { buildRadarSVG, buildCirculationSVG } from './radar.js';
import {
  BATCH_URL,
  loadBatch,
  applyBatch,
  batchBannerText,
  formatRebalanceRow,
  measuredScores,
} from './batch.js';

/* ------------------------------------------------------------------ 상태·저장 */

let state = initialState();

/** 새로고침 복원(항목 10): 토글 on 상태로 저장된 데이터만 파싱 성공 시 복원 — 훼손이면 초기 상태. */
(function restore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const restored = parseState(raw); // null(미저장·훼손)이면 초기 상태 유지
    if (restored) state = restored;
  } catch {
    /* localStorage 비가용(비공개 모드 등) — 초기 상태로 동작 */
  }
})();

function persist() {
  try {
    if (state.saveEnabled) {
      window.localStorage.setItem(STORAGE_KEY, serializeState(state));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* 저장 실패해도 UI는 계속 동작한다(로컬 저장 실패 치명 아님) */
  }
}

/* ------------------------------------------------------------------ 유틸 */

const $ = (sel) => document.querySelector(sel);
const fmt = (v) => Math.round(v * 100) / 100; // %p 표시용 2자리 반올림
const fmtSigned = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;

/** req 4장 국면 설명(표시용 정적 문구 — 판정은 사용자 선택·지표 입력 힌트다). */
const REGIME_NOTES = {
  A: 'A · 성장 확장기 — 목지수 높음+유동성 양호: 주식·AI·반도체 비중 확대, 현금은 적정 유지',
  B: 'B · 인플레이션 상승기 — 화지수 높음: 원자재·에너지 검토, 금 비중 확대, 장기 고정금리 채권 위험 관리',
  C: 'C · 실물경제 안정기 — 토지수 안정: 임대수익·리츠·인프라, 현금흐름 안정 자산',
  D: 'D · 금융 불안기 — 금지수 스트레스: 우량 국채·금, 신용위험 자산 축소, 현금 확대',
  E: 'E · 유동성 회복기 — 수지수 회복→성장: 현금 일부 → 성장자산 이동, 기업실적 확인, 분할 매수',
};

function vectorSummary(vector) {
  return ELEMENTS.map((el) => `${el}${Math.round(vector[el])}`).join(' · ');
}

/* ------------------------------------------------------------------ 자산 입력 폼(항목 2·3) */

const form = $('#asset-form');
const typeSelect = $('#type-select');
const formError = $('#form-error');

/** 유형 select를 코어 ASSET_TYPES로 채운다(단일 근거 — 마크업에는 자동 분류 옵션만 정적). */
for (const type of ASSET_TYPES) {
  typeSelect.insertAdjacentHTML('beforeend', `<option value="${type.id}">${type.label}</option>`);
}

const vectorHint = $('#vector-hint');
const formVecSliders = [...form.querySelectorAll('input[type="range"][data-el]')];
let formVectorTouched = false;

function refreshVectorHint() {
  const typeId = typeSelect.value;
  vectorHint.textContent = typeId
    ? `유형 기본 제안(${ASSET_TYPES.find((t) => t.id === typeId).label}): ${vectorSummary(suggestVector(typeId))}`
    : '자동 분류: 유형이 결정되면 해당 유형 기본 제안이 적용된다(슬라이더로 조정 가능)';
}

/** 폼 벡터 슬라이더를 유형 기본 제안(또는 0)으로 되돌린다(항목 3 "자동 제안"). */
function setFormVector(vector) {
  formVectorTouched = false;
  for (const slider of formVecSliders) {
    const value = vector ? Math.round(vector[slider.dataset.el]) : 0;
    slider.value = String(value);
    slider.closest('.vec-row').querySelector('output').textContent = String(value);
  }
}

typeSelect.addEventListener('change', () => {
  setFormVector(typeSelect.value ? suggestVector(typeSelect.value) : null);
  refreshVectorHint();
});

for (const slider of formVecSliders) {
  slider.addEventListener('input', () => {
    slider.closest('.vec-row').querySelector('output').textContent = slider.value;
  });
  slider.addEventListener('change', () => {
    formVectorTouched = true;
  });
}

$('#vector-reset').addEventListener('click', () => {
  setFormVector(typeSelect.value ? suggestVector(typeSelect.value) : null);
  refreshVectorHint();
});

function showFormError(message) {
  formError.textContent = message || '';
  formError.classList.toggle('show', Boolean(message));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#asset-name').value;
  const amount = $('#asset-amount').valueAsNumber;
  const memo = $('#asset-memo').value;

  let input = { name, amount, memo };
  try {
    // 유형 명시 선택 → classifyAsset(forced|manual), 공란(자동 분류) → 직접 입력 텍스트로 자동 분류.
    // 어느 쪽이든 유형 결정 근거는 코어 classifyAsset뿐이다(UI 자체 매칭 없음).
    input = { ...input, typeId: classifyAsset(name, typeSelect.value || null).typeId };
  } catch (e) {
    showFormError(e.message);
    return;
  }

  // 벡터: 슬라이더 조정 없으면 명시 전달 없음 → state.js가 코어 getBasicVector 제안 사용,
  // 조정했으면 슬라이더 값(0~100)을 명시 벡터로 전달한다.
  if (formVectorTouched) {
    const vector = {};
    for (const slider of formVecSliders) vector[slider.dataset.el] = slider.valueAsNumber;
    input = { ...input, vector };
  }

  const result = addItem(state, input);
  if (!result.ok) {
    showFormError(result.error);
    return;
  }
  state = result.state;
  showFormError('');
  form.reset();
  setFormVector(null);
  refreshVectorHint();
  persist();
  render();
});

/* ------------------------------------------------------------------ 항목 목록(카드 편집·삭제) */

const assetList = $('#asset-list');
const listError = $('#list-error');

function showListError(message) {
  if (message) {
    listError.textContent = message;
    listError.hidden = false;
  } else {
    listError.textContent = '';
    listError.hidden = true;
  }
}

function renderAssetList() {
  assetList.innerHTML = state.items.length
    ? ''
    : '<li class="empty-note">자산을 추가하면 금액 가중 평균으로 오행 분포가 계산된다.</li>';

  for (const item of state.items) {
    const type = ASSET_TYPES.find((t) => t.id === item.typeId);
    const vector = item.vector ?? suggestVector(item.typeId); // 코어 제안(단일 근거) — 카드 표시에 코어를 그대로 경유한다
    const vectorAdjusted = item.vector !== null && item.vector !== undefined;
    assetList.insertAdjacentHTML('beforeend', `
      <li class="asset-card" data-id="${item.id}" data-element="${type.element}">
        <div class="asset-head" data-element="${type.element}">
          <span class="element-badge" data-element="${type.element}" title="오행 자산군">${type.element}</span>
          <input type="text" class="asset-name" value="${escapeAttr(item.name)}" aria-label="자산명·투자 대상" />
          <button type="button" class="danger-ghost asset-remove" aria-label="삭제">삭제</button>
        </div>
        <div class="asset-meta">
          <select class="asset-type" aria-label="유형">
            ${ASSET_TYPES.map((t) => `<option value="${t.id}"${t.id === item.typeId ? ' selected' : ''}>${t.label}</option>`).join('')}
          </select>
          <input type="number" class="asset-amount" min="0" step="any" value="${item.amount}" aria-label="금액(원)" />
        </div>
        <input type="text" class="asset-memo" value="${escapeAttr(item.memo)}" placeholder="메모" aria-label="메모" />
        <details class="vector-editor"${vectorAdjusted ? ' open' : ''}>
          <summary>5요소 벡터 <span class="suggest-summary">${vectorAdjusted ? `조정 중: ${vectorSummary(vector)}` : `유형 기본 제안: ${vectorSummary(vector)}`}</span></summary>
          ${ELEMENTS.map((el) => `
            <div class="vec-row">
              <span class="vec-name ind-name-${el}">${el} (${ELEMENT_SCORE_MEANINGS[el]})</span>
              <input type="range" min="0" max="100" step="1" value="${Math.round(vector[el])}" data-el="${el}" aria-label="${el}(${ELEMENT_SCORE_MEANINGS[el]}) 점수" />
              <output>${Math.round(vector[el])}</output>
            </div>`).join('')}
          <div class="vector-reset-row">
            <button type="button" class="ghost asset-vector-reset">유형 기본 제안으로 되돌리기</button>
          </div>
        </details>
      </li>`);
  }

  for (const card of assetList.querySelectorAll('.asset-card')) {
    const id = card.dataset.id;
    card.querySelector('.asset-remove').addEventListener('click', () => mutate((s) => removeItem(s, id)));
    card.querySelector('.asset-name').addEventListener('change', (e) => mutate((s) => updateItem(s, id, { name: e.target.value })));
    card.querySelector('.asset-type').addEventListener('change', (e) => mutate((s) => updateItem(s, id, { typeId: e.target.value })));
    card.querySelector('.asset-amount').addEventListener('change', (e) => mutate((s) => updateItem(s, id, { amount: e.target.valueAsNumber })));
    card.querySelector('.asset-memo').addEventListener('change', (e) => mutate((s) => updateItem(s, id, { memo: e.target.value })));
    card.querySelector('.asset-vector-reset').addEventListener('click', () => mutate((s) => updateItem(s, id, { vector: null })));
    for (const slider of card.querySelectorAll('input[type="range"][data-el]')) {
      slider.addEventListener('input', () => {
        slider.closest('.vec-row').querySelector('output').textContent = slider.value;
      });
      slider.addEventListener('change', () => {
        const vector = {};
        for (const s2 of card.querySelectorAll('input[type="range"][data-el]')) vector[s2.dataset.el] = s2.valueAsNumber;
        mutate((s) => updateItem(s, id, { vector }));
      });
    }
  }
}

/** 상태 변경 공통 진입: {ok,state|error} 계약 → 실패 시 목록 오류 표시, 성공 시 저장·렌더. */
function mutate(fn) {
  const result = fn(state);
  if (!result.ok) {
    showListError(result.error);
    render(); // 거부 → 이전 값 복원
    return;
  }
  showListError('');
  state = result.state;
  persist();
  render();
}

const escapeAttr = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ 레이더(항목 1) */

const radarContainer = $('#radar-container');

function renderRadar() {
  // 실측 지수 오버레이(티켓 ⑤) — 배치의 지수 5종이 모두 있을 때만(부분 부족은 0 다각형 왜곡 방지로 미표시).
  const measured = state.batch ? measuredScores(state.batch) : null;
  radarContainer.innerHTML = buildRadarSVG({ current: computeDistribution(state), measured });
}

/* ------------------------------------------------------------------ EBI(항목 7) */

const ebiValue = $('#ebi-value');
const ebiFill = $('#ebi-bar-fill');
$('#ebi-definition').textContent = EBI_DEFINITION;

function renderEBI() {
  const value = computeEBIValue(state);
  ebiValue.textContent = value === null ? '—' : String(value);
  ebiFill.style.width = value === null ? '0%' : `${value}%`;
}

/* ------------------------------------------------------------------ 경제지표(항목 4) */

const indicatorSliders = [...document.querySelectorAll('input[type="range"][data-ind]')];

for (const slider of indicatorSliders) {
  slider.addEventListener('input', () => {
    $(`#out-${slider.dataset.ind}`).textContent = slider.value;
  });
  slider.addEventListener('change', () => {
    const result = setIndicator(state, slider.dataset.ind, slider.valueAsNumber);
    if (result.ok) {
      state = result.state;
      persist();
    }
  });
}

function renderIndicators() {
  for (const slider of indicatorSliders) {
    const value = state.indicators[slider.dataset.ind];
    slider.value = String(value);
    $(`#out-${slider.dataset.ind}`).textContent = String(Math.round(value));
  }
}

/* ------------------------------------------------------------------ 국면 프리셋(항목 5) */

const regimeSelect = $('#regime-select');
const regimeDesc = $('#regime-desc');
const proposalBody = $('#proposal-body');

regimeSelect.addEventListener('change', () => {
  const result = setRegime(state, regimeSelect.value || null);
  if (result.ok) {
    state = result.state;
    persist();
    renderDerived();
  } else {
    regimeSelect.value = state.regimeId ?? '';
    regimeDesc.textContent = result.error;
  }
});

function renderRegime() {
  regimeSelect.value = state.regimeId ?? '';
  regimeDesc.textContent = state.regimeId
    ? `${REGIME_NOTES[state.regimeId]} — 목표·격차는 검토 후 적용한다.`
    : '국면을 선택하면 그 국면의 목표 배분과 현재 분포의 격차(Δ%p)가 표에 표시된다. — 목표·격차는 검토 후 적용한다.';

  const target = currentTarget(state);
  const dist = computeDistribution(state);
  const gaps = dist === null ? null : elementGaps(dist, target);

  proposalBody.innerHTML = ELEMENTS.map((el) => {
    const current = dist === null ? '—' : `${fmt(dist[el])}%`;
    const goal = `${fmt(target[el])}%`;
    const gap = gaps === null ? '—' : `${fmtSigned(gaps[el])}%p`;
    const direction = gaps === null || gaps[el] === 0 ? '유지' : gaps[el] > 0 ? '증가 검토' : '감소 검토';
    return `<tr><td>${el}</td><td class="num">${current}</td><td class="num">${goal}</td><td class="num">${gap}</td><td>${direction}</td></tr>`;
  }).join('');
}

/* ------------------------------------------------------------------ 리밸런싱(항목 6) */

const rebalanceList = $('#rebalance-list');
const rebalanceEmpty = $('#rebalance-empty');

function renderRebalance() {
  const suggestions = rebalanceSuggestions(state);
  rebalanceList.innerHTML = '';
  if (suggestions.length === 0) {
    rebalanceEmpty.textContent = computeDistribution(state) === null
      ? '자산을 추가하면 |현재−목표| ≥ 5%p 자산군의 이동 제안이 표시된다.'
      : '제안 없음 — 모든 자산군의 |현재−목표| 격차가 5%p 미만이다.';
    return;
  }
  rebalanceEmpty.textContent = '';
  for (const s of suggestions) {
    rebalanceList.insertAdjacentHTML('beforeend', `
      <li><strong class="ind-name-${s.element}">${s.element}</strong>
        ${s.direction === 'increase' ? '증가' : '감소'} 제안 — 목표 비중이 ${fmt(s.gapPct)}%p ${s.direction === 'increase' ? '크다' : '작다'} (|현재−목표| ≥ 5%p 트리거)</li>`);
  }
}

/* ------------------------------------------------------------------ 상생 순환(항목 8) */

$('#circulation-container').innerHTML = buildCirculationSVG();
$('#circuit-notes').innerHTML = CIRCULATION_NOTES.map((note) => `<li>${note}</li>`).join('');

/* ------------------------------------------------------------------ 저장 토글(항목 10) */

const saveToggle = $('#save-toggle');

saveToggle.addEventListener('change', () => {
  const result = setSaveEnabled(state, saveToggle.checked);
  if (result.ok) {
    state = result.state;
    persist();
  }
});

/* ------------------------------------------------------------------ 실측 모드(티켓 ⑤ — req-v2 §4·§5-5) */

const batchBanner = $('#batch-banner');
const batchBannerTextEl = $('#batch-banner-text');
const batchReasonsEl = $('#batch-reasons');
const batchProxyNoteEl = $('#batch-proxy-note');
const batchRebalanceNoteEl = $('#batch-rebalance-note');
const batchRebalanceEl = $('#batch-rebalance');

/** 배치 산출물(engine/data/state.json의 반영물)이 반영돼 있을 때만 배너·근거·고지·제안을 노출한다. */
function renderBatch() {
  const batchMeta = state.batch ?? null;
  const hasBatch = batchMeta !== null;
  batchBanner.hidden = !hasBatch;
  batchRebalanceNoteEl.hidden = !hasBatch || batchMeta.target === null;
  batchRebalanceEl.hidden = !hasBatch || batchMeta.proposals.length === 0;
  if (!hasBatch) return;

  batchBannerTextEl.textContent = batchBannerText(batchMeta);
  batchReasonsEl.innerHTML = batchMeta.reasons
    .map((reason) => `<li>${escapeAttr(reason)}</li>`)
    .join('');
  batchProxyNoteEl.textContent = batchMeta.proxyNote;
  batchRebalanceNoteEl.textContent =
    '배치 제안 리밸런싱 — 기준 배분(engine 기준) → 국면 목표 배분("검토 후 적용" 성격):';
  batchRebalanceEl.innerHTML = batchMeta.proposals
    .map((row) => `<li>${escapeAttr(formatRebalanceRow(row))}</li>`)
    .join('');
}

/**
 * 배치 산출물 로드·적용 — `fetch('data/state.json')`(index.html 상대경로, 정적 fetch 전용 —
 * API 서버 없음 · 자동 배치 서버 없음, req-v2 §4). 부재(404)·네트워크 실패·무결 위반은
 * 전부 배치 없음으로 수렴해 **조용히 포기**한다(콘솔 에러 노출 금지 — 수동 모드가 그대로).
 * 존재 시: 배너·지수 5종·국면·목표 배분·제안 리밸런싱·프록시 고지를 실측 값으로 채우고
 * 기존 수동 모드 UI를 그대로 재사용해 다시 그린다(계산은 state.js→코어 barrel 경유).
 */
async function initStateBatch() {
  const batch = await loadBatch(() => fetch(BATCH_URL));
  if (batch === null) return; // 부재(404)·무결 위반 — 수동 모드 유지(콘솔 노출 없음)
  const result = applyBatch(state, batch);
  if (!result.ok) return;
  state = result.state; // 배치 메타는 세션 스코프 — persist() 직렬화에 오염되지 않는다(tests/batch-mode.test.js)
  persist();
  render();
}

/* ------------------------------------------------------------------ 렌더 파이프라인 */

function renderDerived() {
  renderRadar();
  renderEBI();
  renderRegime();
  renderRebalance();
}

function render() {
  saveToggle.checked = state.saveEnabled;
  renderIndicators();
  renderAssetList();
  renderDerived();
  renderBatch();
}

render();

// 실측 모드 부팅 — 초기 수동 렌더 이후 배치 산출물을 확인해 값만 실측으로 덧씌운다.
initStateBatch();