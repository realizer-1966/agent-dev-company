// qa/lib/app-vm.js
// index.html의 인라인 <script>를 Node vm 샌드박스에서 실제 구동시키는 로더.
// DOM/IndexedDB/localStorage를 최소 스텁으로 대체하고 Date를 고정해
// 결정적으로 렌더링까지 검증한다 (동기화 검증용).
//
// 주의: 이 파일은 index.html을 수정하지 않는다. 앱 코드를 있는 그대로 구동해
// 추출 모듈(qa/lib/calc.js)과 실제 앱의 결과 불일치(드리프트)를 감지하는 게 목적이다.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 고정 기준 시각: 2026-09-15T12:00:00Z
// (UTC 기준 정오 — UTC-11~UTC+12 환경에서 로컬 날짜도 2026-09-15가 되어
//  getTenantStatus(toISOString 기준)와 todayMonth(로컬 기준)가 모두 일치)
const FIXED_NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);

// new Date() (인자 없음) → 고정 시각. 인자가 있으면 실제 Date 동작 (날짜 연산용).
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW_MS);
    else super(...args);
  }
  static now() { return FIXED_NOW_MS; }
}

// 최소 DOM 엘리먼트 스텁 — innerHTML/textContent/value를 저장만 하고
// 이벤트/쿼리는 no-op. 렌더 함수들이 작성한 HTML을 나중에 읽어 파싱한다.
function makeElement() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, selected: false,
    style: {}, dataset: {}, files: [],
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, click() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    focus() {}, blur() {},
  };
}
function extractAppScript(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  if (!m) throw new Error(`inline <script> block not found: ${htmlPath}`);
  return m[1];
}

// 앱 VM 생성: index.html 스크립트를 구동한 vm 컨텍스트 + 조작 헬퍼를 반환
function createAppVM(htmlPath) {
  const script = extractAppScript(htmlPath);
  const elements = {};
  // localStorage 스텁 — 연도 선택기가 2026을 고르도록 사전 설정
  const store = new Map([['rentalProfitYear', '2026']]);

  const documentStub = {
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElement();
      return elements[id];
    },
    createElement() { return makeElement(); },
    get activeElement() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    body: makeElement(),
    documentElement: makeElement(),
  };

  const sandbox = {
    Date: FakeDate, // 인자 없는 new Date() 를 고정 시각으로
    document: documentStub,
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
    },
    // openDB가 즉시 실패하도록 해 init()이 조용히 catch로 빠지게 함.
    // (init 후속 microtask는 본 검증이 모두 끝난 뒤에야 실행되어 간섭 없음)
    indexedDB: { open() { throw new Error('QA sandbox: indexedDB disabled'); } },
    alert() {}, confirm() { return true; },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Blob: class Blob {},
    URL: { createObjectURL() { return 'blob:qa'; }, revokeObjectURL() {} },
    FileReader: class FileReader { readAsText() {} },
    window: { scrollTo() {} },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(script, ctx, { filename: path.basename(htmlPath) + '#inline' });

  return {
    ctx,
    // 스텁 엘리먼트 조회 (렌더 후 innerHTML 읽기용)
    getEl(id) { return documentStub.getElementById(id); },
    // 앱의 전역 let buildings 에 데이터 주입
    setBuildings(data) {
      vm.runInContext('buildings = ' + JSON.stringify(data), ctx, { filename: 'qa#setBuildings' });
    },
    // 앱 코드/함수를 컨텍스트 안에서 실행
    eval(code) { return vm.runInContext(code, ctx, { filename: 'qa#eval' }); },
    // 실행 결과를 JSON으로 받기
    evalJson(code) {
      return JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', ctx, { filename: 'qa#evalJson' }));
    },
  };
}

module.exports = { createAppVM, FIXED_NOW_MS };