import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RADAR_SIZE,
  computeScaleMax,
  radarPoint,
  polygonPoints,
  bandPolygon,
  buildRadarSVG,
  buildCirculationSVG,
} from '../ui/radar.js';
import * as core from '../src/index.js';

/**
 * SVG 렌더 빌더 테스트(티켓 ③): DOM 없이 순수 문자열/좌표 수준만 검증한다.
 * - 좌표 투영은 "오행 순서 = 코어 ELEMENTS(" + ELEMENTS + ")"
 *   각도 -90°(상단 木)에서 시작, 시계 방향 72° 간격.
 * - 레이더의 실제 갱신은 QA 티켓 ④(수용기준 2번) 브라우저 실측이 담당한다.
 */

test('radarPoint — %p → 좌표 투영(0은 정확히 중심, 상단 木은 12시 방향)', () => {
  const center = radarPoint(0, 0, 40);
  assert.equal(center.x, 160);
  assert.equal(center.y, 160);
  // 상단 12시(木, -90°): 40%(scale 40)는 정점 — x는 중심과 같고 y는 위쪽
  const top = radarPoint(0, 40, 40);
  assert.ok(Math.abs(top.x - 160) < 1e-9, 'x = 중심');
  assert.equal(top.y, 160 - 118, 'y = 중심 − 반경(정점)');
});

test('radarPoint — 오행 5축은 코어 ELEMENTS 순서로 72° 간격, 반경은 scale 비례', () => {
  const scale = computeScaleMax(null); // 기본 40
  assert.equal(scale, 40);
  for (let i = 0; i < core.ELEMENTS.length; i++) {
    const p = radarPoint(i, 40, scale);
    const r = Math.hypot(p.x - 160, p.y - 160);
    assert.ok(Math.abs(r - 118) < 1e-6, `${core.ELEMENTS[i]} 40%p(scale 40)는 최외곽(${118}) ` + r);
  }
  // 5축 반경 동일(레이더는 등각 다각형)
  const radii = core.ELEMENTS.map((_, i) => Math.hypot(radarPoint(i, 20, 40).x - 160, radarPoint(i, 20, 40).y - 160));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-6);
});

test('polygonPoints — 현재 분포 오각형은 5좌표 쌍 문자열', () => {
  const dist = { 木: 30, 火: 10, 土: 20, 金: 25, 水: 15 };
  const s = polygonPoints(dist, 40);
  const pairs = s.trim().split(/\s+/);
  assert.equal(pairs.length, 5);
  for (const pair of pairs) {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
});

test('bandPolygon — 허용 범위 밴드는 외곽(최대)+내곽(최소) 10좌표 폴리곤', () => {
  const s = bandPolygon(core.ALLOWED_RANGES, 40);
  const pairs = s.trim().split(/\s+/);
  assert.equal(pairs.length, 10);
  // 외곽 반경 > 내곽 반경(순서: 외곽 5 → 내곽 5)
  const radii = pairs.map((p) => {
    const [x, y] = p.split(',').map(Number);
    return Math.hypot(x - 160, y - 160);
  });
  const rMax = (i) => (core.ALLOWED_RANGES[core.ELEMENTS[i % 5]][1] / 40) * 118;
  const rMin = (i) => (core.ALLOWED_RANGES[core.ELEMENTS[i % 5]][0] / 40) * 118;
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(radii[i] - rMax(i)) < 0.05, `외곽 ${core.ELEMENTS[i]}: ${radii[i]} ≈ ${rMax(i)}`);
    assert.ok(Math.abs(radii[i + 5] - rMin(4 - i)) < 0.05, `내곽(역순) ${i}: ${radii[i + 5]} ≈ ${rMin(4 - i)}`);
  }
});

test('computeScaleMax — 기본 40, 현재 분포가 크면 10 단위로 확장(최대 100)', () => {
  assert.equal(computeScaleMax(null), 40);
  assert.equal(computeScaleMax({ 木: 30, 火: 10, 土: 20, 金: 25, 水: 15 }), 40);
  assert.equal(computeScaleMax({ 木: 41, 火: 0, 土: 0, 金: 0, 水: 0 }), 50, '기본 40을 살짝 넘으면 한 칸 확장');
  const cashOnly = { 木: 0, 火: 0, 土: 0, 金: 17.391304347826086, 水: 82.6086956521739 };
  assert.equal(computeScaleMax(cashOnly), 90, '82.6% → 10 단위 상방(×1.05 헤드룸)');
  assert.ok(computeScaleMax({ 木: 100, 火: 0, 土: 0, 金: 0, 水: 0 }) <= 100, '상한 100');
});

// ------------------------------------------------------------------ 레이더 SVG
test('buildRadarSVG — 기준 배분·밴드·현재(자산 있음) 요소가 모두 그려진다', () => {
  const dist = { 木: 56.25, 火: 25, 土: 0, 金: 0, 水: 18.75 };
  const svg = buildRadarSVG({ current: dist });
  assert.ok(svg.startsWith('<svg'), '완결 svg 문자열');
  assert.ok(svg.includes(`viewBox="0 0 ${RADAR_SIZE} ${RADAR_SIZE}"`), 'viewBox 고정(반응형 width 100%)');

  const n = (id) => svg.split(`data-role="${id}"`).length - 1;
  assert.equal(n('allowed-band'), 1, '허용 범위 밴드 1개');
  assert.equal(n('basis-polygon'), 1, '기준 배분 오버레이 1개');
  assert.equal(n('current-polygon'), 1, '현재 포트폴리오 다각형 1개');
  assert.ok(svg.includes('dashed'), '기준 배분은 점선(오버레이 구분)');

  // 기준 배분 수치는 코어 상수 기반 — SVG에 그 값이 들어간다
  for (const el of core.ELEMENTS) {
    assert.ok(svg.includes(`${el} `) || svg.includes(`${el}</tspan>`) || svg.includes(`>${el}<`), `축 라벨 ${el}`);
  }
});

test('buildRadarSVG — 자산 없음(empty): 현재 다각형 없이 빈 상태 안내가 보인다', () => {
  const svg = buildRadarSVG({ current: null });
  assert.ok(svg.startsWith('<svg'));
  assert.equal(svg.split('data-role="current-polygon"').length - 1, 0, '현재 다각형 없음');
  assert.ok(svg.includes('자산을 추가하면'), '빈 상태 안내 텍스트');
  assert.equal(svg.split('data-role="basis-polygon"').length - 1, 1, '기준 배분·밴드는 그대로 표시');
});

test('buildRadarSVG — 눈금 원은 scaleMax를 4분할해 라벨로 노출한다', () => {
  const svg = buildRadarSVG({ current: null, scaleMax: 100 });
  for (const tick of [25, 50, 75, 100]) {
    assert.ok(svg.includes(`${tick}`), `눈금 ${tick}`);
  }
});

// --------------------------------------------------------------- 상생 순환 SVG
test('buildCirculationSVG — 5노드 순환(코어 CIRCULATION 그대로) + 개념도 고지 문구 포함', () => {
  const svg = buildCirculationSVG();
  assert.ok(svg.startsWith('<svg'), '완결 svg 문자열');
  for (const el of core.ELEMENTS) {
    assert.ok(svg.includes(`>${el}<`), `노드 라벨 ${el}`);
  }
  // 간선 5개(닫힌 순환) — 코어 CIRCULATION 매핑 기반
  assert.equal(svg.split('data-edge').length - 1, 5);
  assert.ok(svg.includes('개념도'), '5장 고지: 개념도임이 다이어그램 안에도 함께 보인다');
});