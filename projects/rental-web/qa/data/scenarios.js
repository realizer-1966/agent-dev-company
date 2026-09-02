// qa/data/scenarios.js
// rental-web 계산 로직 검증용 테스트 시나리오 데이터셋.
// 각 시나리오는 실제 데이터(buildings) + 손으로 계산한 기대값(expected)을 담는다.
// 'now'를 고정 주입해 결정적으로 검증한다.

'use strict';

// 고정 기준 시각 (2026-09-15). getTenantStatus는 toISOString(UTC) 사용,
// todayMonth는 로컬 사용 — UTC+9 이하 환경에서 둘 다 2026-09-15로 일치.
const NOW = new Date('2026-09-15T12:00:00');

// 공용비용 헬퍼: cost는 '원' 단위, date는 YYYY-MM-DD
const cost = (원, date, isRefund = false) => ({ id: 'c_' + Math.random().toString(36).slice(2, 8), cost: 원, date, isRefund });

// 세입자 헬퍼
function tenant({ name, room, deposit, rent, mgmt, moveIn, contractEnd, moveOut = '', rentPaid = [], mgmtPaid = [] }) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    name, room, deposit, rent, mgmt, moveIn, contractEnd, moveOut,
    notes: [], rentPaid, mgmtPaid, createdAt: Date.now(),
  };
}
// 납부 기록 헬퍼: month 'YYYY-MM', paid boolean
const paid = (month, paidFlag = true) => ({ id: 'r_' + Math.random().toString(36).slice(2, 8), month, paid: paidFlag });

const scenarios = [
  // ============ S1: 기본 건물 카드 계산 ============
  {
    id: 'S1-building-card-basic',
    desc: '건물 카드: 보증금/호실/세입자수/총액/납부액/미납/공용비용/수익',
    now: NOW,
    buildings: [
      {
        id: 'b1', name: 'A빌딩', addr: '서울', tenants: [
          tenant({ name: '김철수', room: '101', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-10', contractEnd: '2028-01-10', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '이영희', room: '102', deposit: 3000, rent: 60, mgmt: 6, moveIn: '2026-03-01', contractEnd: '2028-03-01', rentPaid: [paid('2026-09', false)], mgmtPaid: [paid('2026-09')] }),
        ],
        commonCosts: [cost(100000, '2026-09-05')], // 10만원
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 5000,   // 2000+3000
        roomCount: 2,
        tenantCount: 2,
        totalAmount: 121,     // (50+5)+(60+6)
        paidAmount: 61,       // 김철수 55 + 이영희 관리비만 6
        unpaidAmount: 60,     // 121-61
        commonCostTotal: 10,  // 100000/10000
        profitAmount: 51,     // 61-10
      },
      // 입주기념일(각 10일, 1일) 경과 + 이번 달 기록 유무:
      // 김철수: 월세·관리비 9월 기록 모두 있음 → 제외
      // 이영희: 관리비 9월 기록 있지만 월세 9월 기록(paid=false) 있음 → 기록 존재 → 제외
      unpaidList: { names: [] },
    },
  },

  // ============ S2: 환급 항목 차감 ============
  {
    id: 'S2-refund-deduction',
    desc: '공용비용 환급(isRefund) 항목은 차감되어 수익에 반영',
    now: NOW,
    buildings: [
      {
        id: 'b2', name: 'B빌딩', addr: '부산', tenants: [
          tenant({ name: '박민수', room: '201', deposit: 1000, rent: 40, mgmt: 4, moveIn: '2026-02-01', contractEnd: '2028-02-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
        ],
        commonCosts: [
          cost(50000, '2026-09-01', false), // 5만원 비용
          cost(20000, '2026-09-10', true),  // 2만원 환급 → 차감
        ],
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 1000,
        roomCount: 1,
        tenantCount: 1,
        totalAmount: 44,      // 40+4
        paidAmount: 44,
        unpaidAmount: 0,
        commonCostTotal: 3,   // 5 - 2
        profitAmount: 41,     // 44 - 3
      },
    },
  },

  // ============ S3: 상태 판정 ============
  {
    id: 'S3-status-classification',
    desc: '입주예정/입주중/중도퇴거/만기퇴거 판정 (now=2026-09-15)',
    now: NOW,
    buildings: [
      {
        id: 'b3', name: 'C빌딩', addr: '대구', tenants: [
          tenant({ name: '입주예정자', room: '301', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-10-01', contractEnd: '2028-10-01' }), // upcoming
          tenant({ name: '입주중자', room: '302', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2028-01-01' }), // active (moveOut 없음)
          tenant({ name: '중도퇴거자', room: '303', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2027-01-01', moveOut: '2026-06-01' }), // midterm
          tenant({ name: '만기퇴거자', room: '304', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2025-01-01', contractEnd: '2026-01-01', moveOut: '2026-01-15' }), // full
          tenant({ name: '퇴거예정자', room: '305', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-01-01', contractEnd: '2026-12-01', moveOut: '2026-12-15' }), // active (미래, 만기 이후)
        ],
        commonCosts: [],
      },
    ],
    expected: {
      statuses: {
        '입주예정자': 'upcoming',
        '입주중자': 'active',
        '중도퇴거자': 'midterm',
        '만기퇴거자': 'full',
        '퇴거예정자': 'active',
      },
      // 건물 카드는 active만 집계: 입주중자(30+3) + 퇴거예정자(30+3) = 66
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 2000,   // 입주중자 1000 + 퇴거예정자 1000
        roomCount: 5,         // 전체 고유 호실
        tenantCount: 2,       // active만
        totalAmount: 66,
        paidAmount: 0,        // 납부 기록 없음
        unpaidAmount: 66,
        commonCostTotal: 0,
        profitAmount: 0,
      },
    },
  },

  // ============ S4: 월별 수입/비용/순이익 (연도 집계) ============
  {
    id: 'S4-yearly-profit',
    desc: '2026년 월별 수입/비용/순이익 집계 (납부월·비용월 기준)',
    now: NOW,
    buildings: [
      {
        id: 'b4', name: 'D빌딩', addr: '인천', tenants: [
          // 1월~9월 납부 (rent 50, mgmt 5) → 9개월치
          tenant({ name: '홍길동', room: '401', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01',
            rentPaid: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map(m => paid(m)),
            mgmtPaid: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map(m => paid(m)) }),
          // 3월~9월 납부 (rent 60, mgmt 6) → 7개월치
          tenant({ name: '김영수', room: '402', deposit: 3000, rent: 60, mgmt: 6, moveIn: '2026-03-01', contractEnd: '2028-03-01',
            rentPaid: ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map(m => paid(m)),
            mgmtPaid: ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map(m => paid(m)) }),
        ],
        commonCosts: [
          cost(100000, '2026-03-10'),  // 3월 10만원
          cost(50000, '2026-06-15'),   // 6월 5만원
          cost(20000, '2026-09-01', true), // 9월 2만원 환급 → 차감
        ],
      },
    ],
    expected: {
      yearlyProfit: {
        // 1월: 홍길동 55
        '2026-01': { income: 55, cost: 0, profit: 55 },
        // 2월: 홍길동 55
        '2026-02': { income: 55, cost: 0, profit: 55 },
        // 3월: 홍길동 55 + 김영수 66 = 121, cost 10
        '2026-03': { income: 121, cost: 10, profit: 111 },
        // 4월: 121, cost 0
        '2026-04': { income: 121, cost: 0, profit: 121 },
        // 5월: 121
        '2026-05': { income: 121, cost: 0, profit: 121 },
        // 6월: 121, cost 5
        '2026-06': { income: 121, cost: 5, profit: 116 },
        // 7월: 121
        '2026-07': { income: 121, cost: 0, profit: 121 },
        // 8월: 121
        '2026-08': { income: 121, cost: 0, profit: 121 },
        // 9월: 121, cost -2 (환급) → profit 123
        '2026-09': { income: 121, cost: -2, profit: 123 },
        // 10~12월: 0
        '2026-10': { income: 0, cost: 0, profit: 0 },
        '2026-11': { income: 0, cost: 0, profit: 0 },
        '2026-12': { income: 0, cost: 0, profit: 0 },
        totalIncome: 55+55+121+121+121+121+121+121+121, // = 957
        totalCost: 10+5-2, // = 13
        totalProfit: 957-13, // = 944
      },
    },
  },

  // ============ S5: 3개월 퇴거 보증금 준비금 ============
  {
    id: 'S5-next3months-deposit',
    desc: '앞으로 3개월(2026-09~11) 퇴거 예정 보증금 준비금 (active/midterm만 포함)',
    now: NOW,
    buildings: [
      {
        id: 'b5', name: 'E빌딩', addr: '광주', tenants: [
          // 10월 퇴거, active (미래, 만기 이후) → 포함
          tenant({ name: '10월퇴거', room: '501', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2026-12-01', moveOut: '2026-10-05' }),
          // 10월 퇴거, midterm (만기 이전) → 포함
          tenant({ name: '10월중도', room: '502', deposit: 1500, rent: 40, mgmt: 4, moveIn: '2026-01-01', contractEnd: '2027-01-01', moveOut: '2026-10-20' }),
          // 과거에 이미 만기 퇴거(full) → 3개월 범위(9~11월)에 moveOut이 없어 제외
          tenant({ name: '과거만기퇴거', room: '503', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2025-01-01', contractEnd: '2026-01-01', moveOut: '2026-08-01' }),
          // 11월 퇴거, active → 포함
          tenant({ name: '11월퇴거', room: '504', deposit: 3000, rent: 60, mgmt: 6, moveIn: '2026-01-01', contractEnd: '2026-12-01', moveOut: '2026-11-15' }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      next3Months: {
        '2026-09': { total: 0, count: 0 },
        '2026-10': { total: 3500, count: 2 }, // 2000+1500 (만기 제외)
        '2026-11': { total: 3000, count: 1 },
      },
    },
  },

  // ============ S6: 보증금 기준 초과 ============
  {
    id: 'S6-high-deposit',
    desc: '보증금 2000만원 초과 (입주중 active만, 내림차순)',
    now: NOW,
    buildings: [
      {
        id: 'b6', name: 'F빌딩', addr: '대전', tenants: [
          tenant({ name: '고액1', room: '601', deposit: 5000, rent: 100, mgmt: 10, moveIn: '2026-01-01', contractEnd: '2028-01-01' }),
          tenant({ name: '고액2', room: '602', deposit: 2500, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01' }),
          tenant({ name: '기준이하', room: '603', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01' }), // 2000은 초과 아님
          tenant({ name: '퇴거고액', room: '604', deposit: 9000, rent: 100, mgmt: 10, moveIn: '2025-01-01', contractEnd: '2026-01-01', moveOut: '2026-01-15' }), // full → 제외
        ],
        commonCosts: [],
      },
    ],
    expected: {
      highDeposit: {
        threshold: 2000,
        // active만, deposit > 2000, 내림차순
        names: ['고액1', '고액2'],
        deposits: [5000, 2500],
      },
    },
  },

  // ============ S7: 당해년도 신규 입주 ============
  {
    id: 'S7-new-tenants',
    desc: '2026년 신규 입주 세대 (전 건물, 입주일 오름차순)',
    now: NOW,
    buildings: [
      {
        id: 'b7', name: 'G빌딩', addr: '울산', tenants: [
          tenant({ name: '올해입주', room: '701', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-05-01', contractEnd: '2028-05-01' }),
          tenant({ name: '작년입주', room: '702', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2025-11-01', contractEnd: '2027-11-01' }), // 제외
          tenant({ name: '올해초입주', room: '703', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-02-01', contractEnd: '2028-02-01' }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      newTenants: {
        // 입주일 오름차순: 올해초입주(02) → 올해입주(05)
        names: ['올해초입주', '올해입주'],
        moveIns: ['2026-02-01', '2026-05-01'],
      },
    },
  },

  // ============ S8: 계약 변동 (같은 호실) ============
  {
    id: 'S8-contract-change',
    desc: '같은 호실 이전 세입자 대비 월세/관리비 변동 (당해년도 입주 기준)',
    now: NOW,
    buildings: [
      {
        id: 'b8', name: 'H빌딩', addr: '세종', tenants: [
          // 101호: 이전(50/5) → 현재(60/6) 변동
          tenant({ name: '이전세입자', room: '101', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2025-06-01', contractEnd: '2027-06-01', moveOut: '2026-08-01' }),
          tenant({ name: '현재세입자', room: '101', deposit: 2000, rent: 60, mgmt: 6, moveIn: '2026-08-10', contractEnd: '2028-08-10' }),
          // 102호: 변동 없음 (50/5 → 50/5) → 제외
          tenant({ name: '이전2', room: '102', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2025-06-01', contractEnd: '2027-06-01', moveOut: '2026-08-01' }),
          tenant({ name: '현재2', room: '102', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2026-08-10', contractEnd: '2028-08-10' }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      contractChanges: {
        // 101호만 변동 감지
        count: 1,
        room: '101',
        rentDiff: 10,   // 60-50
        mgmtDiff: 1,    // 6-5
        prevName: '이전세입자',
        currName: '현재세입자',
      },
    },
  },
  // ============ S9: 다중 건물 집계 ============
  {
    id: 'S9-multi-building-aggregation',
    desc: '3개 건물: 월별 수입/비용, 3개월 준비금, 보증금 초과, 신규 입주 전 건물 합산',
    now: NOW,
    buildings: [
      {
        id: 'bA', name: '서울빌딩', addr: '서울', tenants: [
          tenant({ name: '김철수', room: '101', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-10', contractEnd: '2028-01-10', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '이영희', room: '102', deposit: 3000, rent: 60, mgmt: 6, moveIn: '2026-03-01', contractEnd: '2028-03-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '입주예정', room: '103', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2026-10-01', contractEnd: '2028-10-01' }),
          tenant({ name: '만기퇴거', room: '104', deposit: 1000, rent: 30, mgmt: 3, moveIn: '2025-01-01', contractEnd: '2026-01-01', moveOut: '2026-01-15' }),
        ],
        commonCosts: [cost(200000, '2026-09-05')],
      },
      {
        id: 'bB', name: '부산빌딩', addr: '부산', tenants: [
          tenant({ name: '박민수', room: '201', deposit: 1000, rent: 40, mgmt: 4, moveIn: '2026-02-01', contractEnd: '2028-02-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '11월퇴거', room: '202', deposit: 2000, rent: 50, mgmt: 5, moveIn: '2026-01-05', contractEnd: '2026-12-01', moveOut: '2026-11-15' }),
        ],
        commonCosts: [cost(100000, '2026-09-01', true)],
      },
      {
        id: 'bC', name: '대구빌딩', addr: '대구', tenants: [
          tenant({ name: '최수민', room: '301', deposit: 5000, rent: 70, mgmt: 7, moveIn: '2026-06-01', contractEnd: '2028-06-01' }),
          tenant({ name: '정퇴거', room: '302', deposit: 3000, rent: 50, mgmt: 5, moveIn: '2026-01-02', contractEnd: '2027-01-01', moveOut: '2026-10-20' }),
        ],
        commonCosts: [cost(50000, '2026-08-15')],
      },
    ],
    expected: {
      // 첫 건물(서울빌딩) 카드 — run-qa/run-sync 모두 b[0] 기준
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 5000,   // 김철수 2000 + 이영희 3000 (active만)
        roomCount: 4,         // 101~104 전체 고유 호실
        tenantCount: 2,       // active만
        totalAmount: 121,     // 55 + 66
        paidAmount: 121,      // 둘 다 9월 납부
        unpaidAmount: 0,
        commonCostTotal: 20,  // 9월 20만원
        profitAmount: 101,
      },
      yearlyProfit: {
        // 8월: 대구빌딩 공용비용 5만원만 존재 (수입 없음)
        '2026-08': { income: 0, cost: 5, profit: -5 },
        // 9월: 수입 = 김철수 55 + 이영희 66 + 박민수 44 = 165 (최수민 미납)
        //      비용 = 서울 20 - 부산 환급 10 = 10 (대구 8월 비용은 제외)
        '2026-09': { income: 165, cost: 10, profit: 155 },
        totalIncome: 165,
        totalCost: 15,
        totalProfit: 150,
      },
      next3Months: {
        '2026-09': { total: 0, count: 0 },
        '2026-10': { total: 3000, count: 1 }, // 정퇴거 (midterm)
        '2026-11': { total: 2000, count: 1 }, // 11월퇴거 (midterm)
      },
      highDeposit: {
        threshold: 2000,
        // active만: 김철수(2000, 기준과 같아 제외) · 이영희 3000 · 최수민 5000
        names: ['최수민', '이영희'],
        deposits: [5000, 3000],
      },
      newTenants: {
        // 2026년 입주 전 건물, 입주일 오름차순 (만기퇴거 2025 입주는 제외)
        names: ['정퇴거', '11월퇴거', '김철수', '박민수', '이영희', '최수민', '입주예정'],
        moveIns: ['2026-01-02', '2026-01-05', '2026-01-10', '2026-02-01', '2026-03-01', '2026-06-01', '2026-10-01'],
      },
    },
  },

  // ============ S10: 부분 납부 ============
  {
    id: 'S10-partial-payment',
    desc: '부분 납부: 월세만/관리비만/둘다/미납 조합의 카드·통계 집계',
    now: NOW,
    buildings: [
      {
        id: 'b10', name: 'J빌딩', addr: '제주', tenants: [
          tenant({ name: '월세만납부', room: '101', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09')], mgmtPaid: [] }),
          tenant({ name: '관리비만납부', room: '102', deposit: 1000, rent: 60, mgmt: 6, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '둘다납부', room: '103', deposit: 1000, rent: 70, mgmt: 7, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
          tenant({ name: '미납', room: '104', deposit: 1000, rent: 40, mgmt: 4, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09', false)], mgmtPaid: [paid('2026-09', false)] }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 4000,
        roomCount: 4,
        tenantCount: 4,
        totalAmount: 242,     // 55+66+77+44
        paidAmount: 133,      // 월세 50 + 관리비 6 + 둘다 77 + 미납 0
        unpaidAmount: 109,
        commonCostTotal: 0,
        profitAmount: 133,
      },
      // 모두 입주일 1일(기념일 경과). 이번 달 기록이 하나라도 없는 세입자만:
      // 월세만납부(관리비 기록 없음) → 포함, 관리비만납부(월세 기록 없음) → 포함,
      // 둘다납부(둘 다 있음) → 제외, 미납(둘 다 기록 존재, paid=false) → 제외
      unpaidList: { names: ['월세만납부', '관리비만납부'] },
      yearlyProfit: {
        // 카드 납부액과 같은 some() 규칙으로 월별 통계에도 동일하게 반영
        '2026-09': { income: 133, cost: 0, profit: 133 },
        totalIncome: 133,
        totalCost: 0,
        totalProfit: 133,
      },
    },
  },

  // ============ S11: 중복 납부 기록 ============
  {
    id: 'S11-duplicate-payment-records',
    desc: '중복 납부 기록: 같은 월에 기록이 여러 개일 때 some() 판정 (카드·통계 일관성)',
    now: NOW,
    buildings: [
      {
        id: 'b11', name: 'K빌딩', addr: '강릉', tenants: [
          // 첫 기록 paid:false, 둘째 기록 paid:true → some()은 납부로 판정
          tenant({ name: '중복역순', room: '101', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09', false), paid('2026-09', true)], mgmtPaid: [] }),
          // 첫 기록 paid:true → some() 납부
          tenant({ name: '중복정순', room: '102', deposit: 1000, rent: 60, mgmt: 6, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09', true), paid('2026-09', false)], mgmtPaid: [] }),
          // 관리비 중복 기록 역순
          tenant({ name: '관리중복', room: '103', deposit: 1000, rent: 70, mgmt: 7, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [], mgmtPaid: [paid('2026-09', false), paid('2026-09', true)] }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 3000,
        roomCount: 3,
        tenantCount: 3,
        totalAmount: 198,     // 55+66+77
        paidAmount: 117,      // 중복역순 50 + 중복정순 60 + 관리중복 7
        unpaidAmount: 81,
        commonCostTotal: 0,
        profitAmount: 117,
      },
      yearlyProfit: {
        // 월별 통계도 동일한 some() 규칙 — 중복 기록이 있어도 한 번만 집계
        '2026-09': { income: 117, cost: 0, profit: 117 },
        totalIncome: 117,
        totalCost: 0,
        totalProfit: 117,
      },
    },
  },

  // ============ S12: 공용비용 집계 범위 (카드 vs 월별 통계) ============
  {
    id: 'S12-common-cost-scope',
    desc: '공용비용 범위: 카드는 이번 달 것만 차감, 월별 통계는 해당 월·연도만',
    now: NOW,
    buildings: [
      {
        id: 'b12', name: 'L빌딩', addr: '춘천', tenants: [
          tenant({ name: '하나', room: '101', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
        ],
        commonCosts: [
          cost(100000, '2026-05-10'),      // 5월 10만원
          cost(200000, '2026-09-01'),      // 9월 20만원
          cost(300000, '2025-12-15'),      // 2025년 12월 30만원 — 카드에는 포함, 2026 통계에는 제외
          cost(50000, '2026-09-20', true), // 9월 환급 5만원
        ],
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 1000,
        roomCount: 1,
        tenantCount: 1,
        totalAmount: 55,
        paidAmount: 55,
        unpaidAmount: 0,
        commonCostTotal: 15,  // 이번 달(9월)만: 20 - 환급 5 (5월·2025년 12월은 제외)
        profitAmount: 40,    // 55 - 15
      },
      yearlyProfit: {
        // 5월: 비용 10만원만 (수입 없음)
        '2026-05': { income: 0, cost: 10, profit: -10 },
        // 9월: 비용 20 - 환급 5 = 15. 2025년 12월 비용은 2026 통계에 미포함
        '2026-09': { income: 55, cost: 15, profit: 40 },
        totalIncome: 55,
        totalCost: 25,
        totalProfit: 30,
      },
    },
  },

  // ============ S13: 퇴거자 납부 이력 ============
  {
    id: 'S13-movedout-payment-history',
    desc: '퇴거자 납부 이력: 월 시점 판정으로 퇴거자의 과거 납부도 통계에 포함됨',
    now: NOW,
    buildings: [
      {
        id: 'b13', name: 'M빌딩', addr: '전주', tenants: [
          // 2026년 1~6월 실납부(월 55)가 있지만 full 상태 → 월별 통계에서 제외
          tenant({ name: '퇴거자', room: '101', deposit: 1000, rent: 50, mgmt: 5, moveIn: '2025-06-01', contractEnd: '2026-06-01', moveOut: '2026-06-10',
            rentPaid: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map(m => paid(m)),
            mgmtPaid: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map(m => paid(m)) }),
          tenant({ name: '입주중', room: '102', deposit: 1000, rent: 40, mgmt: 4, moveIn: '2026-01-01', contractEnd: '2028-01-01', rentPaid: [paid('2026-09')], mgmtPaid: [paid('2026-09')] }),
        ],
        commonCosts: [],
      },
    ],
    expected: {
      buildingCard: {
        cardMonth: '2026-09',
        totalDeposit: 1000,  // 입주중만
        roomCount: 2,
        tenantCount: 1,
        totalAmount: 44,
        paidAmount: 44,
        unpaidAmount: 0,
        commonCostTotal: 0,
        profitAmount: 44,
      },
      yearlyProfit: {
        // A1 수정 반영: 퇴거자의 1~6월 실납부(월 55)가 이제 통계에 포함된다
        // 1~5월: 퇴거자 55
        '2026-01': { income: 55, cost: 0, profit: 55 },
        '2026-02': { income: 55, cost: 0, profit: 55 },
        '2026-03': { income: 55, cost: 0, profit: 55 },
        '2026-04': { income: 55, cost: 0, profit: 55 },
        '2026-05': { income: 55, cost: 0, profit: 55 },
        // 6월: 퇴거자 55 (6월에 퇴거 — 해당 월 포함) + 입주중은 9월부터 기록
        '2026-06': { income: 55, cost: 0, profit: 55 },
        // 9월: 입주중 44 (퇴거자는 6월 퇴거 후 제외)
        '2026-09': { income: 44, cost: 0, profit: 44 },
        // 합계: 55*6 + 44 = 374
        totalIncome: 374,
        totalCost: 0,
        totalProfit: 374,
      },
    },
  },
];

module.exports = { scenarios, NOW };
