// qa/run-qa.js
// rental-web 계산 로직 QA 파이프라인 실행기.
// 시나리오 데이터를 주입 → calc.js로 연산 → 손계산 기대값(골든 마스터)과 비교.
// 사용법: node qa/run-qa.js [시나리오ID...]  (생략 시 전체)
// 종료코드: 0=전체 통과, 1=실패 존재

'use strict';

const calc = require('./lib/calc.js');
const { scenarios } = require('./data/scenarios.js');
const { boundaryScenarios } = require('./lib/gen-boundary.js');

let passCount = 0, failCount = 0;
const failures = [];

function check(label, actual, expected, ctx) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passCount++;
    return true;
  }
  failCount++;
  failures.push({ scenario: ctx, label, expected: e, actual: a });
  return false;
}

function runScenario(s) {
  const now = s.now;
  const b = s.buildings;
  const results = {};

  // S1/S2/S3: 건물 카드 (첫 건물 기준)
  if (s.expected.buildingCard) {
    results.buildingCard = calc.buildingCard(b[0], now);
    check('buildingCard', results.buildingCard, s.expected.buildingCard, s.id);
  }

  // '이번 달 입금내역 없음' 목록 (카드 하단 영역)
  if (s.expected.unpaidList) {
    const list = calc.unpaidThisMonthTenants(b[0], now);
    check('unpaidList.names', list.map(t => t.name), s.expected.unpaidList.names, s.id);
  }

  // S3: 상태 판정
  if (s.expected.statuses) {
    const statuses = {};
    b[0].tenants.forEach(t => { statuses[t.name] = calc.getTenantStatus(t, now); });
    check('statuses', statuses, s.expected.statuses, s.id);
  }

  // S4: 월별 수입/비용/순이익
  if (s.expected.yearlyProfit) {
    const yp = calc.yearlyProfit(b, 2026, now);
    const monthMap = {};
    yp.months.forEach(mo => {
      monthMap[mo.ym] = { income: mo.income, cost: mo.cost, profit: mo.profit };
    });
    const exp = s.expected.yearlyProfit;
    // 월별 비교
    for (const ym of Object.keys(exp)) {
      if (ym.startsWith('total')) continue;
      check(`yearlyProfit.${ym}`, monthMap[ym], exp[ym], s.id);
    }
    check('yearlyProfit.totalIncome', yp.totalIncome, exp.totalIncome, s.id);
    check('yearlyProfit.totalCost', yp.totalCost, exp.totalCost, s.id);
    check('yearlyProfit.totalProfit', yp.totalProfit, exp.totalProfit, s.id);
  }

  // S5: 3개월 퇴거 보증금 준비금
  if (s.expected.next3Months) {
    const n3 = calc.computeNext3MonthsAll(b, now);
    const map = {};
    n3.forEach(m => { map[m.ym] = { total: m.total, count: m.tenants.length }; });
    check('next3Months', map, s.expected.next3Months, s.id);
  }

  // S6: 보증금 기준 초과
  if (s.expected.highDeposit) {
    const hd = calc.highDepositTenants(b, s.expected.highDeposit.threshold, now);
    check('highDeposit.names', hd.map(x => x.name), s.expected.highDeposit.names, s.id);
    check('highDeposit.deposits', hd.map(x => x.deposit), s.expected.highDeposit.deposits, s.id);
  }

  // S7: 당해년도 신규 입주
  if (s.expected.newTenants) {
    const nt = calc.newTenantsAll(b, now);
    check('newTenants.names', nt.map(x => x.name), s.expected.newTenants.names, s.id);
    check('newTenants.moveIns', nt.map(x => x.moveIn), s.expected.newTenants.moveIns, s.id);
  }

  // S8: 계약 변동
  if (s.expected.contractChanges) {
    const cc = calc.contractChangesAll(b, now);
    const exp = s.expected.contractChanges;
    check('contractChanges.count', cc.length, exp.count, s.id);
    if (cc.length > 0) {
      check('contractChanges.room', cc[0].room, exp.room, s.id);
      check('contractChanges.rentDiff', cc[0].rentDiff, exp.rentDiff, s.id);
      check('contractChanges.mgmtDiff', cc[0].mgmtDiff, exp.mgmtDiff, s.id);
      check('contractChanges.prevName', cc[0].prevName, exp.prevName, s.id);
      check('contractChanges.currName', cc[0].currName, exp.currName, s.id);
    }
  }

  return results;
}

// ---- 메인 ----
const filter = process.argv.slice(2);
const targets = filter.length ? scenarios.filter(s => filter.includes(s.id)) : scenarios;
const boundaryTargets = filter.length
  ? boundaryScenarios.filter(s => filter.includes(s.id))
  : boundaryScenarios;

console.log('==============================================');
console.log('rental-web 계산 로직 QA 파이프라인');
console.log(`골든마스터 시나리오: ${targets.length}개 / 경계값 시나리오: ${boundaryTargets.length}개`);
console.log('==============================================\n');

targets.forEach(s => {
  runScenario(s);
  const sFails = failures.filter(f => f.scenario === s.id).length;
  console.log(`${sFails === 0 ? '✅' : '❌'} [${s.id}] ${s.desc}`);
  if (sFails > 0) {
    failures.filter(f => f.scenario === s.id).forEach(f => {
      console.log(`   ✗ ${f.label}`);
      console.log(`     기대: ${f.expected}`);
      console.log(`     실제: ${f.actual}`);
    });
  }
});

// 경계값 시나리오 실행
boundaryTargets.forEach(s => {
  const before = passCount + failCount;
  const checks = s.run(new Date('2026-09-15T12:00:00'));
  const sFails = checks.filter(c => !c.pass).length;
  console.log(`${sFails === 0 ? '✅' : '❌'} [${s.id}] ${s.desc}`);
  checks.forEach(c => {
    if (c.pass) { passCount++; }
    else {
      failCount++;
      failures.push({ scenario: s.id, label: c.label, expected: 'pass', actual: c.detail });
      console.log(`   ✗ ${c.label}`);
      console.log(`     ${c.detail}`);
    }
  });
});

console.log('\n==============================================');
console.log(`결과: ${passCount} 통과 / ${failCount} 실패`);
console.log('==============================================');
process.exit(failCount > 0 ? 1 : 0);
