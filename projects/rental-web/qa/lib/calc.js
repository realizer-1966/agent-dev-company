// qa/lib/calc.js
// rental-web(index.html)의 계산 로직을 순수 JS 모듈로 추출한 것.
// DOM 의존을 제거하고 'now'(Date)를 주입받아 결정적으로 테스트할 수 있게 함.
// index.html의 로직과 1:1 대응하도록 유지한다.

'use strict';

// ---- 날짜/포맷 헬퍼 (index.html 450~504 대응) ----

// fmtMoney: 만원 단위 포맷 (반올림)
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '-';
  return Math.round(Number(v)).toLocaleString('ko-KR') + '만원';
}

// 입주일 기준 계약만료일 = 입주일 + 2년 (YYYY-MM-DD)
function calcContractEnd(moveIn) {
  if (!moveIn) return '';
  const [y, m, d] = moveIn.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setFullYear(date.getFullYear() + 2);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 주어진 날짜(YYYY-MM-DD)의 하루 전 날짜 (연/월 경계 처리)
function dayBefore(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 현재 월 (YYYY-MM) — now 주입
function todayMonth(now) {
  const d = now || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 특정 세입자의 특정 월 입금 여부 (rentPaid에서 조회)
function isRentPaidFor(t, month) {
  const rec = (t.rentPaid || []).find(r => r.month === month);
  return !!(rec && rec.paid);
}
function isMgmtPaidFor(t, month) {
  const rec = (t.mgmtPaid || []).find(r => r.month === month);
  return !!(rec && rec.paid);
}

// ---- 상태 판정 (index.html 1328~1339 대응) ----
// 입주중(active) / 입주예정(upcoming) / 중도퇴거(midterm) / 만기퇴거(full)
function getTenantStatus(t, now) {
  const today = (now || new Date()).toISOString().slice(0, 10); // YYYY-MM-DD
  if (t.moveIn && t.moveIn > today) return 'upcoming';
  if (!t.moveOut) return 'active';
  if (t.contractEnd && t.moveOut < t.contractEnd) return 'midterm';
  if (t.moveOut >= today) return 'active';
  return 'full';
}

// ---- 건물 카드 금액 (index.html 544~579 대응) ----
// now: Date (기본 오늘). cardMonth: 이번 달 YYYY-MM
function buildingCard(b, now) {
  const cardMonth = todayMonth(now);
  const active = (b.tenants || []).filter(t => getTenantStatus(t, now) === 'active');
  // 보증금 합계: 입주 중(active)만
  const totalDeposit = active.reduce((s, t) => s + (Number(t.deposit) || 0), 0);
  // 호실 수: 전체 세입자의 고유 호실
  const roomCount = new Set((b.tenants || []).map(t => t.room).filter(Boolean)).size;
  // 세입자 수: 입주 중(active)만
  const tenantCount = active.length;
  // 총액 = 입주중 (rent + mgmt) 합계 (만원)
  const totalAmount = active.reduce((s, t) => s + (Number(t.rent) || 0) + (Number(t.mgmt) || 0), 0);
  // 납부액 = 이번 달 입주중 세입자가 실제 납부(paid=true)한 금액 합계
  const paidAmount = active.reduce((s, t) =>
    s
    + (isRentPaidFor(t, cardMonth) ? (Number(t.rent) || 0) : 0)
    + (isMgmtPaidFor(t, cardMonth) ? (Number(t.mgmt) || 0) : 0), 0);
  const unpaidAmount = totalAmount - paidAmount;
  // 공용비용 합계 (만원) — 환급 항목은 차감
  const commonCostTotal = (b.commonCosts || []).reduce((s, c) => {
    if (c.isRefund) return s - (Number(c.cost) || 0) / 10000;
    return s + (Number(c.cost) || 0) / 10000;
  }, 0);
  // 수익 = 납부액 - 공용비용 (만원)
  const profitAmount = paidAmount - commonCostTotal;
  return { cardMonth, totalDeposit, roomCount, tenantCount, totalAmount, paidAmount, unpaidAmount, commonCostTotal, profitAmount };
}

// ---- 월별 수입/비용/순이익 (index.html 2048~2124 대응) ----
// year: 조회 연도. 전 건물 집계.
function yearlyProfit(buildings, year, now) {
  const months = [];
  let totalIncome = 0, totalCost = 0;
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    let income = 0;
    (buildings || []).forEach(b => {
      (b.tenants || []).forEach(t => {
        if (getTenantStatus(t, now) === 'active') {
          if ((t.rentPaid || []).some(r => r.month === ym && r.paid)) income += Number(t.rent) || 0;
          if ((t.mgmtPaid || []).some(r => r.month === ym && r.paid)) income += Number(t.mgmt) || 0;
        }
      });
    });
    let cost = 0;
    (buildings || []).forEach(b => {
      (b.commonCosts || []).forEach(c => {
        const dateStr = c.date || (c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '');
        if (dateStr) {
          const [cy, cm] = dateStr.split('-').map(Number);
          if (cy === year && cm === m) {
            if (c.isRefund) cost -= (Number(c.cost) || 0) / 10000;
            else cost += (Number(c.cost) || 0) / 10000;
          }
        }
      });
    });
    const profit = income - cost;
    totalIncome += income;
    totalCost += cost;
    months.push({ m, ym, income, cost, profit });
  }
  const totalProfit = totalIncome - totalCost;
  return { months, totalIncome, totalCost, totalProfit };
}

// ---- 앞으로 3개월 퇴거 예정 보증금 준비금 (index.html 1963~1991 대응) ----
function next3MonthsYM(now) {
  const d = now || new Date();
  const y = d.getFullYear(), m = d.getMonth(); // m: 0-based
  const list = [];
  for (let i = 0; i < 3; i++) {
    const ny = y + Math.floor((m + i) / 12);
    const nm = (m + i) % 12 + 1;
    list.push({ ym: `${ny}-${String(nm).padStart(2, '0')}`, year: ny, month: nm });
  }
  return list;
}
function computeNext3MonthsAll(buildings, now) {
  return next3MonthsYM(now).map(mm => {
    let total = 0; const tenants = [];
    (buildings || []).forEach(b => (b.tenants || []).forEach(t => {
      if (t.moveOut && String(t.moveOut).slice(0, 7) === mm.ym) {
        const status = getTenantStatus(t, now);
        if (status === 'active' || status === 'midterm') {
          total += Number(t.deposit) || 0;
          tenants.push({ building: b.name, room: t.room, name: t.name, deposit: Number(t.deposit) || 0 });
        }
      }
    }));
    return { ...mm, total, tenants };
  });
}

// ---- 보증금 기준 초과 (index.html 2443~2472 대응) ----
// threshold: 만원 기준값 (기본 2000)
function highDepositTenants(buildings, threshold, now) {
  const th = (Number.isFinite(Number(threshold)) && Number(threshold) > 0) ? Number(threshold) : 2000;
  const list = [];
  (buildings || []).forEach(b => (b.tenants || []).forEach(t => {
    if (getTenantStatus(t, now) === 'active' && Number(t.deposit) > th) {
      list.push({ building: b.name, room: t.room || '', name: t.name || '', deposit: Number(t.deposit) || 0 });
    }
  }));
  list.sort((a, b) => b.deposit - a.deposit);
  return list;
}

// ---- 당해년도 신규 입주 세대 (전 건물) (index.html 2374~2430 대응) ----
function newTenantsAll(buildings, now) {
  const year = (now || new Date()).getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const list = [];
  (buildings || []).forEach(b => {
    (b.tenants || []).forEach(t => {
      if (t.moveIn && t.moveIn >= yearStart && t.moveIn <= yearEnd) {
        list.push({ building: b.name, room: t.room || '', name: t.name || '', moveIn: t.moveIn, deposit: t.deposit, rent: t.rent, mgmt: t.mgmt, status: getTenantStatus(t, now) });
      }
    });
  });
  list.sort((a, c) => String(a.moveIn || '').localeCompare(String(c.moveIn || '')));
  return list;
}

// ---- 계약 변동 (전 건물, 당해년도) (index.html 2274~ 대응) ----
// 호실별로 입주일 순 정렬 후, 이전 세입자 대비 월세/관리비 변동이 있는 경우만.
function contractChangesAll(buildings, now) {
  const year = (now || new Date()).getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const changes = [];
  (buildings || []).forEach(b => {
    const roomGroups = {};
    (b.tenants || []).forEach(t => {
      const room = (t.room || '').trim();
      if (!room) return;
      (roomGroups[room] = roomGroups[room] || []).push(t);
    });
    Object.keys(roomGroups).sort((a, c) => {
      const na = parseInt(a, 10), nc = parseInt(c, 10);
      return (isNaN(na) ? Infinity : na) - (isNaN(nc) ? Infinity : nc);
    }).forEach(room => {
      const tenants = roomGroups[room].sort((a, c) =>
        String(a.moveIn || '').localeCompare(String(c.moveIn || ''))
      );
      for (let i = 1; i < tenants.length; i++) {
        const prev = tenants[i - 1];
        const curr = tenants[i];
        if (!curr.moveIn || curr.moveIn < yearStart || curr.moveIn > yearEnd) continue;
        const prevRent = Number(prev.rent) || 0;
        const currRent = Number(curr.rent) || 0;
        const prevMgmt = Number(prev.mgmt) || 0;
        const currMgmt = Number(curr.mgmt) || 0;
        const rentDiff = currRent - prevRent;
        const mgmtDiff = currMgmt - prevMgmt;
        if (rentDiff !== 0 || mgmtDiff !== 0) {
          changes.push({
            building: b.name, room,
            prevName: prev.name || '?', currName: curr.name || '?',
            prevRent, currRent, rentDiff,
            prevMgmt, currMgmt, mgmtDiff,
            prevMoveIn: prev.moveIn || '', currMoveIn: curr.moveIn || '',
            prevMoveOut: prev.moveOut || '',
          });
        }
      }
    });
  });
  return changes;
}

module.exports = {
  fmtMoney, calcContractEnd, dayBefore, todayMonth,
  isRentPaidFor, isMgmtPaidFor, getTenantStatus,
  buildingCard, yearlyProfit, next3MonthsYM, computeNext3MonthsAll,
  highDepositTenants, newTenantsAll, contractChangesAll,
};
