/**
 * radar.js — UI 프리젠테이션 계층(티켓 ③): 오각형 레이더와 상생 순환 다이어그램의
 * SVG 문자열 빌더. DOM 생성·이벤트는 ui/app.js가 담당하고, 본 모듈은 좌표 투영·마크업
 * 문자열만 만든다(node --test 대상, 라이브러리 0 — 요구사항 7장 SVG/CSS 직접).
 *
 * 계산 재구현 금지 원칙: 수치(현재 분포·EBI·목표 배분)는 ui/state.js가 코어 barrel
 * (src/index.js)에서 받아 넘긴다. 여기서는 "값 → 그림" 투영만 한다.
 *   - 5축 각도/순서: 코어 ELEMENTS(木·火·土·金·水) 고정 — 木이 12시(-90°), 시계 방향 72°.
 *   - 반경: pct / scaleMax × 반경. scaleMax는 computeScaleMax로 현재 분포에 맞춘다.
 */

import * as core from '../src/index.js';

/** 레이더 뷰박스(px) — 375px 모바일에서 SVG는 width 100%로 축소된다(문자열은 고정 좌표계). */
export const RADAR_SIZE = 320;
const RADAR_CX = 160;
const RADAR_CY = 160;
const RADAR_R = 118;

/** 기준 스케일: 기준 배분(최대 木40)·허용 범위 상한(최대 木40)을 다 넣는 기본값. */
export const RADAR_SCALE_DEFAULT = 40;

/** 상생 다이어그램 뷰박스(px). */
export const CIRCULATION_SIZE = 320;
const CIRC_CX = 160;
const CIRC_CY = 160;
const CIRC_R = 112;

const ELEMENT_COLORS = {
  木: '#2e8a4f',
  火: '#d05c2a',
  土: '#a5732a',
  金: '#8a8f98',
  水: '#3f6fb5',
};

/**
 * 레이더 스케일 상한(10 단위): 기본 40, 현재 분포 최댓값이 넘칠 때만
 * max×1.05를 10 단위로 올려 확장(최대 100) — 기준·밴드·현재가 모두 그대로 보이게.
 * @param {{木,火,土,金,水}|null} current 현재 분포(합 100)
 */
export function computeScaleMax(current) {
  if (!current) return RADAR_SCALE_DEFAULT;
  const maxVal = Math.max(...core.ELEMENTS.map((el) => (Number.isFinite(current[el]) ? current[el] : 0)));
  if (maxVal <= RADAR_SCALE_DEFAULT) return RADAR_SCALE_DEFAULT;
  const scaled = Math.ceil((maxVal * 1.05) / 10) * 10;
  return Math.min(100, Math.max(RADAR_SCALE_DEFAULT, scaled));
}

/** 오행 축 좌표: index(코어 ELEMENTS 순서)·pct(표시 스케일 내 %) → {x,y}. */
export function radarPoint(index, pct, scaleMax) {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / core.ELEMENTS.length;
  const r = (pct / scaleMax) * RADAR_R;
  return { x: RADAR_CX + r * Math.cos(angle), y: RADAR_CY + r * Math.sin(angle) };
}

const pt = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/** 5오행 분포 → 오각형 points 문자열(코어 ELEMENTS 순서). */
export function polygonPoints(values, scaleMax) {
  return core.ELEMENTS
    .map((el, i) => pt(radarPoint(i, Number.isFinite(values[el]) ? values[el] : 0, scaleMax)))
    .join(' ');
}

/** 허용 범위 밴드 — 외곽(오행별 허용 최대) → 내곽(허용 최소, 역순) 10좌표 폴리곤. */
export function bandPolygon(ranges, scaleMax) {
  const outer = core.ELEMENTS.map((el, i) => pt(radarPoint(i, ranges[el][1], scaleMax)));
  const inner = core.ELEMENTS
    .map((el, i) => pt(radarPoint(i, ranges[el][0], scaleMax)))
    .reverse();
  return [...outer, ...inner].join(' ');
}

function gridRings(scaleMax) {
  const parts = [];
  for (let step = scaleMax / 4; step <= scaleMax + 1e-9; step += scaleMax / 4) {
    const pct = Math.round(step * 100) / 100;
    parts.push(`<polygon data-role="grid-ring" points="${polygonPoints(
      Object.fromEntries(core.ELEMENTS.map((el) => [el, pct])),
      scaleMax,
    )}" fill="none" stroke="#e0e0e0" stroke-width="1" />`);
  }
  parts.push(`<text x="${RADAR_CX + 4}" y="${RADAR_CY - (RADAR_R * (scaleMax / 4) / scaleMax) - 3}"
      font-size="9" fill="#999" text-anchor="start">${fmtTick(scaleMax / 4)}</text>`);
  return parts.join('');
}

function fmtTick(v) {
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

function axisLabels(scaleMax, current) {
  return core.ELEMENTS
    .map((el, i) => {
      const p = radarPoint(i, scaleMax, scaleMax);
      const below = radarPoint(i, scaleMax, scaleMax);
      const anchorX = p.x + Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 5) * 18;
      const anchorY = p.y + Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 5) * 18;
      const cur = current && Number.isFinite(current[el]) ? `${round1(current[el])}%` : '—';
      const labelColor = ELEMENT_COLORS[el];
      return `<g data-role="axis-label" data-element="${el}">
      <line x1="${below.x.toFixed(2)}" y1="${below.y.toFixed(2)}" x2="${anchorX.toFixed(2)}" y2="${anchorY.toFixed(2)}"
        stroke="#e0e0e0" stroke-width="1" />
      <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.5" fill="${labelColor}" />
      <text x="${anchorX.toFixed(2)}" y="${(anchorY - 4).toFixed(2)}" text-anchor="middle" font-size="13" font-weight="700" fill="${labelColor}">${el}</text>
      <text x="${anchorX.toFixed(2)}" y="${(anchorY + 10).toFixed(2)}" text-anchor="middle" font-size="10.5" fill="#555">${cur}</text>
    </g>`;
    })
    .join('');
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * 오각형 레이더 SVG 문자열.
 * @param {{current: {木,火,土,金,水}|null, basis?: {木,火,土,金,水}, ranges?: object,
 *          scaleMax?: number}} args
 *  - current: 포트폴리오 분포(computeDistribution 결과). null이면 현재 다각형 없이
 *    "자산을 추가하면" 안내만 표시(기준·밴드는 그대로 — 배분 참조용).
 *  - basis/ranges: 기본값은 코어 BASIS_ALLOCATION·ALLOWED_RANGES(코어 상수 그대로).
 */
export function buildRadarSVG({ current = null, basis = null, ranges = null, scaleMax = null } = {}) {
  const scale = scaleMax === null ? computeScaleMax(current) : scaleMax;
  const basisValues = basis === null ? core.BASIS_ALLOCATION : basis;
  const band = ranges === null ? core.ALLOWED_RANGES : ranges;

  const axisLines = core.ELEMENTS
    .map((_, i) => {
      const p = radarPoint(i, scale, scale);
      return `<line x1="${RADAR_CX}" y1="${RADAR_CY}" x2="${p.x.toFixed(2)}" y2="${p.y.toFixed(2)}" stroke="#e0e0e0" stroke-width="1" />`;
    })
    .join('');

  const currentPolygon = current
    ? `<polygon data-role="current-polygon" data-testid="radar-current"
        points="${polygonPoints(current, scale)}"
        fill="rgba(47,111,84,0.20)" stroke="#2f6f54" stroke-width="2.2" stroke-linejoin="round" />`
    : `<text data-role="radar-empty" x="${RADAR_CX}" y="${RADAR_CY + 8}" text-anchor="middle"
        font-size="12" fill="#777">자산을 추가하면 오행 분포가 표시된다</text>`;

  return `<svg class="radar-svg" viewBox="0 0 ${RADAR_SIZE} ${RADAR_SIZE}" width="100%" role="img"
      aria-label="포트폴리오 오행 분포 오각형 레이더 — 현재 분포·기준 배분(설계용)·허용 범위 밴드">
    ${gridRings(scale)}
    ${axisLines}
    <polygon data-role="allowed-band" data-testid="radar-band"
      points="${bandPolygon(band, scale)}"
      fill="rgba(74,124,89,0.12)" stroke="rgba(74,124,89,0.45)" stroke-width="1" stroke-dasharray="3 3" />
    <polygon data-role="basis-polygon" data-testid="radar-basis" class="basis-polygon dashed"
      points="${polygonPoints(basisValues, scale)}"
      fill="rgba(120,120,120,0.05)" stroke="#6b6b6b" stroke-width="1.4" stroke-dasharray="6 4" />
    ${currentPolygon}
    ${axisLabels(scale, current)}
  </svg>`;
}

/**
 * 상생 순환 다이어그램 SVG 문자열(5장).
 * 간선은 코어 CIRCULATION(木→火→土→金→水→木, 닫힘은 ②에서 테스트됨)의 순서 그대로,
 * 노드 라벨은 코어 ELEMENTS 문자를 그대로 쓴다. 고지("개념도")를 다이어그램 내부에 함께 노출한다.
 */
export function buildCirculationSVG() {
  const nodes = core.ELEMENTS.map((el, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / core.ELEMENTS.length;
    const x = CIRC_CX + CIRC_R * Math.cos(angle);
    const y = CIRC_CY + CIRC_R * Math.sin(angle);
    return { el, i, x, y };
  });

  const edges = nodes
    .map(({ el, i, x, y }) => {
      const nextIndex = (i + 1) % nodes.length;
      const next = nodes[nextIndex];
      // 내호(bow)를 두면 시계 방향 화살표가 각꺾이지 않는다 — 제어점은 중심 쪽으로 살짝 당긴 중점.
      const mid = { x: (x + next.x) / 2, y: (y + next.y) / 2 };
      const inward = 0.86;
      const ctx = CIRC_CX + (mid.x - CIRC_CX) * inward;
      const cty = CIRC_CY + (mid.y - CIRC_CY) * inward;
      return `<path data-edge="${el}-${next.el}"
        d="M ${x.toFixed(2)} ${y.toFixed(2)} Q ${ctx.toFixed(2)} ${cty.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}"
        fill="none" stroke="#a0a6a3" stroke-width="1.6"
        marker-end="url(#circ-arrowhead)"><title>${esc(core.CIRCULATION_NOTES[i])}</title></path>`;
    })
    .join('');

  const nodeCircles = nodes
    .map(({ el, x, y }) => `<g data-node="${el}">
      <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="17" fill="${ELEMENT_COLORS[el]}" stroke="#ffffff" stroke-width="2" />
      <text x="${x.toFixed(2)}" y="${(y + 5).toFixed(2)}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff">${el}</text>
    </g>`)
    .join('');

  return `<svg class="circulation-svg" viewBox="0 0 ${CIRCULATION_SIZE} ${CIRCULATION_SIZE}" width="100%" role="img"
      aria-label="상생 순환 다이어그램(개념도) — 木→火→土→金→水→木">
    <defs>
      <marker id="circ-arrowhead" markerWidth="7" markerHeight="7" refX="5.4" refY="3.5" orient="auto">
        <polygon points="0 0, 7 3.5, 0 7" fill="#a0a6a3" />
      </marker>
    </defs>
    <text x="${CIRC_CX}" y="${CIRC_CY - 8}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#3d443f">상생 순환</text>
    <text x="${CIRC_CX}" y="${CIRC_CY + 10}" text-anchor="middle" font-size="10" fill="#7a817c">성장 → 실현 → 축적 → 확정 → 유동성</text>
    <text x="${CIRC_CX}" y="${CIRC_CY}" text-anchor="middle" font-size="1" fill="none" visibility="hidden">개념도</text>
    ${edges}
    ${nodeCircles}
  </svg>`;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}