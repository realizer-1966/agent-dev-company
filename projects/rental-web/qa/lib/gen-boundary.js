// qa/lib/gen-boundary.js
// 경계값 시나리오 자동 생성기.
// 손계산 기대값(골든 마스터) 대신, 경계값에서 로직이 항상 성립해야 하는
// '불변식(invariant)'을 자동으로 검증한다. 시나리오를 코드로 생성하므로
// 커버리지를 쉽게 확장할 수 있다.

'use strict';

const calc = require('./calc.js');

// 세입자 헬퍼 (scenarios.js와 동일 구조)
function tenant({ name, room, deposit, rent, mgmt, moveIn, contractEnd, moveOut = '', rentPaid = [], mgmtPaid = [] }) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    name, room, deposit, rent, mgmt, moveIn, contractEnd, moveOut,
    notes: [], rentPaid, mgmtPaid, createdAt: Date.now(),
  };
}

// ---- 경계값 시나리오 정의 ----
// 각 시나리오는 { id, desc, run(now) -> {checks: [{label, pass, detail}]} } 형태.
// run은 calc.js를 호출해 불변식을 검증하고 통과/실패를 반환한다.

const boundaryScenarios = [
  // ============ B1: 30명 제한 경계 ============
  {
    id: 'B1-max-tenants-boundary',
    desc: '입주중 30명 제한: 29명은 등록 가능, 30명은 등록 불가',
    run(now) {
      const checks = [];
      // 29명 입주중 → 등록 가능
      const b29 = { id: 'b', name: 'B', addr: '', tenants: [], commonCosts: [] };
      for (let i = 0; i < 29; i++) {
        b29.tenants.push(tenant({ name: 't' + i, room: String(100 + i), deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01' }));
      }
      checks.push({
        label: '29명 입주중 → 등록 가능',
        pass: calc.canAddTenant(b29, now) === true,
        detail: `active=${calc.activeTenantCount(b29, now)}, canAdd=${calc.canAddTenant(b29, now)}`,
      });
      // 30명 입주중 → 등록 불가
      const b30 = { id: 'b', name: 'B', addr: '', tenants: [], commonCosts: [] };
      for (let i = 0; i < 30; i++) {
        b30.tenants.push(tenant({ name: 't' + i, room: String(100 + i), deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01' }));
      }
      checks.push({
        label: '30명 입주중 → 등록 불가',
        pass: calc.canAddTenant(b30, now) === false,
        detail: `active=${calc.activeTenantCount(b30, now)}, canAdd=${calc.canAddTenant(b30, now)}`,
      });
      // 30명 중 1명이 퇴거(full)면 active는 29 → 등록 가능
      const b30m = { id: 'b', name: 'B', addr: '', tenants: [], commonCosts: [] };
      for (let i = 0; i < 30; i++) {
        const moveOut = i === 0 ? '2026-01-15' : ''; // 1명은 과거 퇴거
        const contractEnd = i === 0 ? '2026-01-01' : '2028-01-01';
        b30m.tenants.push(tenant({ name: 't' + i, room: String(100 + i), deposit: 1000, rent: 30, mgmt: 3, moveIn: '2025-01-01', contractEnd, moveOut }));
      }
      checks.push({
        label: '30명 중 1명 퇴거(full) → active 29 → 등록 가능',
        pass: calc.canAddTenant(b30m, now) === true,
        detail: `active=${calc.activeTenantCount(b30m, now)}, canAdd=${calc.canAddTenant(b30m, now)}`,
      });
      return checks;
    },
  },

  // ============ B2: 연/월 경계 (dayBefore) ============
  {
    id: 'B2-day-before-boundary',
    desc: 'dayBefore: 연초/월초/윤년 경계에서 하루 전 날짜 정확성',
    run(now) {
      const cases = [
        ['2026-01-01', '2025-12-31'], // 연초
        ['2026-03-01', '2026-02-28'], // 월초 (평년 2월)
        ['2024-03-01', '2024-02-29'], // 윤년 2월 29일
        ['2026-05-01', '2026-04-30'], // 30일 달
        ['2026-08-01', '2026-07-31'], // 31일 달
        ['2026-12-01', '2026-11-30'], // 연말 전달
      ];
      return cases.map(([input, expected]) => ({
        label: `dayBefore(${input}) = ${expected}`,
        pass: calc.dayBefore(input) === expected,
        detail: `실제: ${calc.dayBefore(input)}`,
      }));
    },
  },

  // ============ B3: 계약만료일 (입주일 + 2년) ============
  {
    id: 'B3-contract-end-boundary',
    desc: 'calcContractEnd: 입주일 + 2년 (윤년 포함)',
    run(now) {
      const cases = [
        ['2026-01-10', '2028-01-10'], // 일반
        // JS Date는 윤년 2/29 + 2년을 2026-03-01로 처리 (index.html 로직과 동일)
        ['2024-02-29', '2026-03-01'],
        ['2026-12-31', '2028-12-31'], // 연말
        ['2026-03-01', '2028-03-01'],
      ];
      return cases.map(([input, expected]) => ({
        label: `calcContractEnd(${input}) = ${expected}`,
        pass: calc.calcContractEnd(input) === expected,
        detail: `실제: ${calc.calcContractEnd(input)}`,
      }));
    },
  },

  // ============ B4: 상태 판정 경계 (오늘 기준) ============
  {
    id: 'B4-status-boundary',
    desc: '상태 판정: moveIn/moveOut이 오늘과 같은 날짜일 때',
    run(now) {
      const today = now.toISOString().slice(0, 10); // 2026-09-15
      const checks = [];
      // moveIn == 오늘 → upcoming (moveIn > today가 아니므로 false → active로)
      // 실제 로직: moveIn > today 만 upcoming. moveIn == today는 upcoming 아님.
      const tMoveInToday = tenant({ name: 'x', room: '1', deposit: 1000, rent: 30, mgmt: 3, moveIn: today, contractEnd: '2028-01-01' });
      checks.push({
        label: `moveIn == 오늘(${today}) → active (upcoming 아님)`,
        pass: calc.getTenantStatus(tMoveInToday, now) === 'active',
        detail: `실제: ${calc.getTenantStatus(tMoveInToday, now)}`,
      });
      // moveIn == 내일 → upcoming
      const tmr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
      const tMoveInTomorrow = tenant({ name: 'x', room: '1', deposit: 1000, rent: 30, mgmt: 3, moveIn: tmr, contractEnd: '2028-01-01' });
      checks.push({
        label: `moveIn == 내일(${tmr}) → upcoming`,
        pass: calc.getTenantStatus(tMoveInTomorrow, now) === 'upcoming',
        detail: `실제: ${calc.getTenantStatus(tMoveInTomorrow, now)}`,
      });
      // moveOut == 오늘, contractEnd가 미래 → moveOut < contractEnd 이므로 midterm
      // (실제 로직: moveOut < contractEnd면 무조건 midterm, moveOut >= today 여부와 무관)
      const tMoveOutToday = tenant({ name: 'x', room: '1', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01', moveOut: today });
      checks.push({
        label: `moveOut == 오늘(${today}), 만기 미래 → midterm`,
        pass: calc.getTenantStatus(tMoveOutToday, now) === 'midterm',
        detail: `실제: ${calc.getTenantStatus(tMoveOutToday, now)}`,
      });
      // moveOut == 어제, contractEnd 미래 → midterm (moveOut < contractEnd)
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      const tMoveOutYesterday = tenant({ name: 'x', room: '1', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01', moveOut: yesterday });
      checks.push({
        label: `moveOut == 어제(${yesterday}), 만기 미래 → midterm`,
        pass: calc.getTenantStatus(tMoveOutYesterday, now) === 'midterm',
        detail: `실제: ${calc.getTenantStatus(tMoveOutYesterday, now)}`,
      });
      return checks;
    },
  },

  // ============ B5: 보증금 기준 경계 ============
  {
    id: 'B5-deposit-threshold-boundary',
    desc: '보증금 초과: 기준값과 정확히 같으면 초과 아님, +1이면 초과',
    run(now) {
      const checks = [];
      const mk = (deposit) => [{ id: 'b', name: 'B', addr: '', tenants: [tenant({ name: 'x', room: '1', deposit, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01' })], commonCosts: [] }];
      // 기준 2000, deposit 2000 → 초과 아님
      checks.push({
        label: 'deposit == 2000 → 초과 아님',
        pass: calc.highDepositTenants(mk(2000), 2000, now).length === 0,
        detail: `실제: ${calc.highDepositTenants(mk(2000), 2000, now).length}명`,
      });
      // deposit 2001 → 초과
      checks.push({
        label: 'deposit == 2001 → 초과',
        pass: calc.highDepositTenants(mk(2001), 2000, now).length === 1,
        detail: `실제: ${calc.highDepositTenants(mk(2001), 2000, now).length}명`,
      });
      // 기준 0 → 기본 2000으로 폴백
      checks.push({
        label: 'threshold 0 → 기본 2000 폴백',
        pass: calc.highDepositTenants(mk(2001), 0, now).length === 1,
        detail: `실제: ${calc.highDepositTenants(mk(2001), 0, now).length}명`,
      });
      return checks;
    },
  },

  // ============ B6: 3개월 범위 경계 ============
  {
    id: 'B6-next3months-boundary',
    desc: '3개월 준비금: 12월→1월 연도 경계, 퇴거일이 범위 밖이면 제외',
    run(now) {
      // 12월 기준으로 연도 경계 검증
      const decNow = new Date('2026-12-15T12:00:00');
      const checks = [];
      // 12월 기준 3개월 = 2026-12, 2027-01, 2027-02
      const yms = calc.next3MonthsYM(decNow).map(m => m.ym);
      checks.push({
        label: '12월 기준 3개월 = 2026-12, 2027-01, 2027-02',
        pass: JSON.stringify(yms) === JSON.stringify(['2026-12', '2027-01', '2027-02']),
        detail: `실제: ${JSON.stringify(yms)}`,
      });
      // 1월 퇴거 세입자가 2027-01에 포함되는지
      const b = { id: 'b', name: 'B', addr: '', tenants: [
        tenant({ name: '1월퇴거', room: '1', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2027-12-01', moveOut: '2027-01-15' }),
      ], commonCosts: [] };
      const n3 = calc.computeNext3MonthsAll([b], decNow);
      const jan = n3.find(m => m.ym === '2027-01');
      checks.push({
        label: '2027-01 퇴거 보증금 2000 포함',
        pass: jan && jan.total === 2000,
        detail: `실제: ${jan ? jan.total : '없음'}`,
      });
      return checks;
    },
  },
];

module.exports = { boundaryScenarios };
