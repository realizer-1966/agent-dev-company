// qa/run-sync.js
// 동기화 검증: index.html의 실제 앱 코드를 vm 샌드박스에서 구동하고
// 렌더링된 HTML/함수 결과를 추출 모듈(qa/lib/calc.js)의 기대값과 비교한다.
//
// 목적: calc.js가 실제 앱과 드리프트(불일치) 없는지 검증.
//  - 골든 마스터 시나리오(S1~S8) 데이터를 실제 앱에 주입
//  - 렌더링된 HTML에서 표시 숫자를 파싱
//  - calc.js가 계산한 기대값과 일치하는지 확인
//  - calc.js와 앱의 순수 계산 함수 결과를 직접 비교
//
// 사용법: node qa/run-sync.js [시나리오ID...]  (생략 시 전체)
// 종료코드: 0=전체 통과, 1=실패 존재

'use strict';

const path = require('path');
const calc = require('./lib/calc.js');
const { createAppVM } = require('./lib/app-vm.js');
const { scenarios } = require('./data/scenarios.js');

const APP_HTML = path.join(__dirname, '..', 'index.html');

let passCount = 0, failCount = 0;
const failures = [];

function check(label, actual, expected, ctx) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passCount++; return true; }
  failCount++;
  failures.push({ scenario: ctx, label, expected: e, actual: a });
  return false;
}

// 렌더링된 HTML에서 "N만원" 형태 숫자를 파싱 (Math.round 적용된 표시값)
function parseManwon(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)만원/);
  return m ? Math.round(Number(m[1])) : null;
}

// ---- 1) 순수 계산 함수 직접 비교: 앱 함수 vs calc.js ----
function runPureFunctionSync(app) {
  const cases = [];

  // calcContractEnd: 입주일 + 2년 (윤년 2/29 포함)
  const moveInDates = ['2026-01-10', '2026-02-29', '2025-12-31', '2024-02-29', '', null];
  moveInDates.forEach(mi => {
    cases.push({
      label: `calcContractEnd(${JSON.stringify(mi)})`,
      appFn: () => app.eval(`calcContractEnd(${JSON.stringify(mi)})`),
      calcFn: () => calc.calcContractEnd(mi),
    });
  });

  // dayBefore: 연/월 경계
  const dayCases = ['2026-01-01', '2026-03-01', '2026-03-30', '2027-01-01', '2024-03-01', '', null];
  dayCases.forEach(d => {
    cases.push({
      label: `dayBefore(${JSON.stringify(d)})`,
      appFn: () => app.eval(`dayBefore(${JSON.stringify(d)})`),
      calcFn: () => calc.dayBefore(d),
    });
  });

  // getTenantStatus: 전 상태 조합
  const now = new Date('2026-09-15T12:00:00');
  const statusTenants = [
    { name: 'upcoming', moveIn: '2026-10-01' },
    { name: 'active-no-moveout', moveIn: '2026-01-01', moveOut: '' },
    { name: 'midterm', moveIn: '2026-01-01', contractEnd: '2027-01-01', moveOut: '2026-06-01' },
    { name: 'full', moveIn: '2025-01-01', contractEnd: '2026-01-01', moveOut: '2026-01-15' },
    { name: 'active-future-moveout', moveIn: '2026-01-01', contractEnd: '2026-12-01', moveOut: '2026-12-15' },
  ];
  statusTenants.forEach(t => {
    const tJson = JSON.stringify(t);
    cases.push({
      label: `getTenantStatus(${t.name})`,
      appFn: () => app.eval(`getTenantStatus(${tJson})`),
      calcFn: () => calc.getTenantStatus(t, now),
    });
  });

  // isRentPaidFor / isMgmtPaidFor
  const paidTenant = {
    name: 'paid-check', rentPaid: [{ month: '2026-09', paid: true }, { month: '2026-08', paid: false }],
    mgmtPaid: [{ month: '2026-09', paid: false }],
  };
  ['2026-09', '2026-08', '2026-07'].forEach(mo => {
    cases.push({
      label: `isRentPaidFor(${mo})`,
      appFn: () => app.eval(`isRentPaidFor(${JSON.stringify(paidTenant)}, '${mo}')`),
      calcFn: () => calc.isRentPaidFor(paidTenant, mo),
    });
    cases.push({
      label: `isMgmtPaidFor(${mo})`,
      appFn: () => app.eval(`isMgmtPaidFor(${JSON.stringify(paidTenant)}, '${mo}')`),
      calcFn: () => calc.isMgmtPaidFor(paidTenant, mo),
    });
  });

  // todayMonth (고정 Date)
  cases.push({
    label: 'todayMonth()',
    appFn: () => app.eval('todayMonth()'),
    calcFn: () => calc.todayMonth(now),
  });

  // next3MonthsYM: 연도 경계 포함 (앱은 Date 고정 필요 → eval로 컨텍스트 내 호출)
  cases.push({
    label: 'next3MonthsYM()',
    appFn: () => app.evalJson('next3MonthsYM()'),
    calcFn: () => calc.next3MonthsYM(now),
  });

  cases.forEach(c => {
    let appRes, calcRes, err = null;
    try { appRes = c.appFn(); } catch (e) { err = 'app threw: ' + e.message; }
    if (!err) {
      try { calcRes = c.calcFn(); } catch (e) { err = 'calc threw: ' + e.message; }
    }
    if (err) { failCount++; failures.push({ scenario: 'pure-sync', label: c.label, expected: 'both run', actual: err }); return; }
    check(c.label, appRes, calcRes, 'pure-sync');
  });
}

// ---- 2) 렌더링 동기화: 시나리오 데이터 → 실제 앱 렌더 → HTML 파싱 → calc.js 기대값 비교 ----
function runRenderSync(app, s) {
  // 앱에 시나리오 데이터 주입
  app.setBuildings(s.buildings);

  // (a) 건물 카드: renderBuildings → HTML에서 금액 파싱
  if (s.expected.buildingCard) {
    app.eval('renderBuildings()');
    const html = app.getEl('buildingsGrid').innerHTML;
    const exp = s.expected.buildingCard;
    // 카드 첫 줄: "2/2실" 세입자/호실
    const oc = html.match(/>(\d+)<span[^>]*>(\/)(\d+)실/);
    check('render.buildingCard tenantCount/roomCount',
      oc ? { tenantCount: Number(oc[1]), roomCount: Number(oc[3]) } : null,
      { tenantCount: exp.tenantCount, roomCount: exp.roomCount }, s.id);
    // 보증금: "보증금 N만원"
    const dp = html.match(/보증금\s+([\d,]+)만원/);
    check('render.buildingCard totalDeposit',
      dp ? Number(dp[1].replace(/,/g, '')) : null, exp.totalDeposit, s.id);
    // 총액/납부/수익: "총 N만원" "납부 N만원" "수익 N만원"
    const tot = html.match(/총\s*<span[^>]*>([\d,]+)만원/);
    check('render.buildingCard totalAmount',
      tot ? Number(tot[1].replace(/,/g, '')) : null, exp.totalAmount, s.id);
    const pd = html.match(/납부\s*<span[^>]*>([\d,]+)만원/);
    check('render.buildingCard paidAmount',
      pd ? Number(pd[1].replace(/,/g, '')) : null, exp.paidAmount, s.id);
    const pf = html.match(/수익\s*<span[^>]*>([\d,]+)만원/);
    check('render.buildingCard profitAmount',
      pf ? Number(pf[1].replace(/,/g, '')) : null, exp.profitAmount, s.id);
  }

  // (b) 상태 판정: 앱 getTenantStatus 결과를 calc.js와 비교 (렌더 전 데이터 주입 상태)
  if (s.expected.statuses) {
    const appStatuses = app.evalJson(`(function(){
      const out = {};
      buildings[0].tenants.forEach(t => { out[t.name] = getTenantStatus(t); });
      return out;
    })()`);
    check('render.statuses(app vs calc)', appStatuses, s.expected.statuses, s.id);
  }

  // (c) 월별 수입/비용/순이익: renderYearlyProfit → 표 파싱
  if (s.expected.yearlyProfit) {
    // 스텁 DOM에서는 populateYearSelect의 option selected가 value에 반영되지
    // 않으므로 연도 선택값을 직접 주입 (localStorage rentalProfitYear=2026과 동일 효과)
    app.getEl('yearlyProfitYearSelect').value = '2026';
    app.eval('renderYearlyProfit()');
    const html = app.getEl('yearlyProfitTable').innerHTML;
    const exp = s.expected.yearlyProfit;
    // 각 월 행: "N월" 뒤에 수입/비용/순이익 순
    const rows = [...html.matchAll(/>(\d+)월(?:\s*\(현재\))?<\/span>\s*<span[^>]*>([^<]*)<\/span>\s*<span[^>]*>([^<]*)<\/span>\s*<span[^>]*>([^<]*)<\/span>/g)];
    rows.forEach(r => {
      const ym = `2026-${String(r[1]).padStart(2, '0')}`;
      const e = exp[ym];
      if (!e) return;
      const parse = x => { const v = parseManwon(x); return v; };
      // 앱 렌더 규칙: income > 0 / cost > 0 / profit !== 0 일 때만 표시, 아니면 '-'
      // (음수 비용(환급 초과)은 '-'로 표시됨 — 발견 사항 참조)
      check(`render.yearlyProfit.${ym}.income`, parse(r[2]), e.income > 0 ? e.income : null, s.id);
      check(`render.yearlyProfit.${ym}.cost`, parse(r[3]), e.cost > 0 ? e.cost : null, s.id);
      check(`render.yearlyProfit.${ym}.profit`, parse(r[4]), e.profit !== 0 ? e.profit : null, s.id);
    });
    // 합계 행: "합계" 뒤 3개
    const sums = html.match(/합계<\/span>\s*<span[^>]*>([\d,]+)만원<\/span>\s*<span[^>]*>([\d,]+)만원<\/span>\s*<span[^>]*>([\d,]+)만원/);
    check('render.yearlyProfit.totalIncome',
      sums ? Number(sums[1].replace(/,/g, '')) : null, exp.totalIncome, s.id);
    check('render.yearlyProfit.totalCost',
      sums ? Number(sums[2].replace(/,/g, '')) : null, exp.totalCost, s.id);
    check('render.yearlyProfit.totalProfit',
      sums ? Number(sums[3].replace(/,/g, '')) : null, exp.totalProfit, s.id);
  }

  // (d) 3개월 퇴거 보증금 준비금: renderNext3Months → 카드 파싱
  if (s.expected.next3Months) {
    app.eval('renderNext3Months()');
    const html = app.getEl('next3Months').innerHTML;
    const totalEl = app.getEl('next3MonthsTotal').textContent;
    const exp = s.expected.next3Months;
    // 각 월 카드: "2026-10 (10월)" 뒤 금액
    const cards = [...html.matchAll(/(\d{4}-\d{2})\s*\((\d+)월\)<\/span>[\s\S]*?<p[^>]*>([^<]*)<\/p>/g)];
    let monthMap = {};
    cards.forEach(c => { monthMap[c[1]] = parseManwon(c[3]) ?? 0; });
    Object.keys(exp).forEach(ym => {
      check(`render.next3Months.${ym}`, monthMap[ym], exp[ym].total, s.id);
    });
    // 총합
    const totalNum = parseManwon(totalEl) ?? 0;
    const expTotal = Object.values(exp).reduce((s2, v) => s2 + v.total, 0);
    check('render.next3Months.total', totalNum, expTotal, s.id);
  }

  // (e) 보증금 기준 초과: renderHighDepositTenants → 카드 파싱
  if (s.expected.highDeposit) {
    app.eval('renderHighDepositTenants()');
    const html = app.getEl('highDepositTenants').innerHTML;
    const exp = s.expected.highDeposit;
    // 카드: "건물명 호번호호" + 이름 + "N만원"
    const cards = [...html.matchAll(/<p class="text-xs text-slate-500 truncate">([^<]+)<\/p>[\s\S]*?<span[^>]*>([\d,]+)만원/g)];
    check('render.highDeposit.names',
      cards.map(c => c[1].trim()), exp.names, s.id);
    check('render.highDeposit.deposits',
      cards.map(c => Number(c[2].replace(/,/g, ''))), exp.deposits, s.id);
    // 임계값 표시: "보증금 2000만원 초과"
    const title = app.getEl('highDepositTitle').textContent;
    check('render.highDeposit.title', /보증금\s*2000만원\s*초과/.test(title || ''), true, s.id);
  }

  // (f) 당해년도 신규 입주: renderStatsNewTenants → 카드 파싱
  if (s.expected.newTenants) {
    app.eval('renderStatsNewTenants()');
    const html = app.getEl('statsNewTenantsList').innerHTML;
    const exp = s.expected.newTenants;
    // 카드: 입주일 "YYYY-MM-DD" 추출
    const dates = [...html.matchAll(/입주일<\/p>\s*<p[^>]*>([^<]+)<\/p>/g)].map(m => m[1].trim());
    check('render.newTenants.moveIns', dates, exp.moveIns, s.id);
    // 이름: 첫 줄 "건물명 · 호번호호 · 이름"
    const names = [...html.matchAll(/<span class="text-sm text-white truncate">([^<]+)<\/span>/g)].map(m => m[1].trim());
    check('render.newTenants.names', names, exp.names, s.id);
    // 제목에 연도
    const title = app.getEl('statsNewTenantsTitle').textContent;
    check('render.newTenants.title', /2026년 신규 입주/.test(title || ''), true, s.id);
  }

  // (g) 계약 변동: renderContractChanges → 카드 파싱
  if (s.expected.contractChanges) {
    app.eval('renderContractChanges()');
    const html = app.getEl('contractChanges').innerHTML;
    const exp = s.expected.contractChanges;
    // 변동 카드 수
    const count = (html.match(/월세<\/p>/g) || []).length;
    check('render.contractChanges.count', count, exp.count, s.id);
    if (exp.count > 0 && count > 0) {
      // 첫 카드: 건물/호실 "H빌딩 101호"
      const room = html.match(/text-sm font-bold text-white">([^<]+?)\s+(\d+)호/);
      check('render.contractChanges.room', room ? room[2] : null, exp.room, s.id);
      // prev → curr 이름
      const names = html.match(/text-slate-400 truncate">([^<]+)<\/span>\s*<span class="text-slate-500">→<\/span>\s*<span class="text-white font-bold truncate">([^<]+)</);
      check('render.contractChanges.prevName', names ? names[1].trim() : null, exp.prevName, s.id);
      check('render.contractChanges.currName', names ? names[2].trim() : null, exp.currName, s.id);
      // 월세 증감: "↑ +10만원"
      const rentDiff = html.match(/월세<\/p>[\s\S]*?<span[^>]*>[↑↓→]\s*([+-]?[\d,]+만원|변동없음)/);
      check('render.contractChanges.rentDiff',
        rentDiff ? (rentDiff[1] === '변동없음' ? 0 : Number(rentDiff[1].replace(/[+,만원]/g, ''))) : null,
        exp.rentDiff, s.id);
      // 관리비 증감: "↑ +1만원"
      const mgmtDiff = html.match(/관리비<\/p>[\s\S]*?<span[^>]*>[↑↓→]\s*([+-]?[\d,]+만원|변동없음)/);
      check('render.contractChanges.mgmtDiff',
        mgmtDiff ? (mgmtDiff[1] === '변동없음' ? 0 : Number(mgmtDiff[1].replace(/[+,만원]/g, ''))) : null,
        exp.mgmtDiff, s.id);
    }
  }
}

// ---- 메인 ----
const filter = process.argv.slice(2);
const targets = filter.length ? scenarios.filter(s => filter.includes(s.id)) : scenarios;

console.log('==============================================');
console.log('rental-web 동기화 검증 (실제 앱 vs calc.js)');
console.log('==============================================\n');

// 1) 순수 함수 직접 비교 — 앱 VM 하나로 전 케이스 실행
const appVM = createAppVM(APP_HTML);
console.log('--- 1) 순수 계산 함수 직접 비교 ---');
const before1 = passCount + failCount;
runPureFunctionSync(appVM);
const fails1 = failCount; // 이 시점까지 누적 실패
console.log(`순수 함수 비교: ${passCount - before1} 통과 / ${fails1} 실패 (누적 실패 기준)\n`);

// 2) 렌더링 동기화 — 시나리오별 앱 VM 생성 (상태 오염 방지: 시나리오마다 새 VM)
console.log('--- 2) 렌더링 동기화 (시나리오별) ---');
targets.forEach(s => {
  const app = createAppVM(APP_HTML);
  const before = passCount + failCount;
  try {
    runRenderSync(app, s);
  } catch (e) {
    failCount++;
    failures.push({ scenario: s.id, label: 'scenario-crashed', expected: 'runs', actual: e.message });
  }
  const sFails = failures.filter(f => f.scenario === s.id).length;
  console.log(`${sFails === 0 ? '✅' : '❌'} [${s.id}] ${s.desc}`);
  failures.filter(f => f.scenario === s.id).forEach(f => {
    console.log(`   ✗ ${f.label}`);
    console.log(`     기대: ${f.expected}`);
    console.log(`     실제: ${f.actual}`);
  });
});

console.log('\n==============================================');
console.log(`결과: ${passCount} 통과 / ${failCount} 실패`);
console.log('==============================================');
process.exit(failCount > 0 ? 1 : 0);