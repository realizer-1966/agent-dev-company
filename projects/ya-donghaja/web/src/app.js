import { createSyncClientHandle } from "@syncular/client";
import { schema } from "./schema.ts";

const SYNC_URL = "https://ya-donghaja-sync.dydtnsp.workers.dev";

// actorId 고정 (localStorage)
let actorId = localStorage.getItem("ya_actor_id");
if (!actorId) {
  actorId = "user_" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem("ya_actor_id", actorId);
}
let userName = localStorage.getItem("ya_user_name") || "운동러";
let userAvatar = localStorage.getItem("ya_user_avatar") || "💪";

const status = document.getElementById("status");
const main = document.getElementById("main");
const streakBadge = document.getElementById("streakBadge");

let sync = null;
let currentTab = "today";

function setStatus(msg, ok) {
  const color = ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-slate-400";
  status.innerHTML = `<span class="${color}">${msg}</span>`;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function ms() { return Date.now(); }

// ============ Syncular 연결 ============
async function init() {
  try {
    setStatus("연결 중...");
    const handle = await createSyncClientHandle({
      worker: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
      schema,
      database: { mode: "persistent", name: "ya-donghaja-db-v4" },
      clientId: actorId,
      endpoints: {
        syncUrl: `${SYNC_URL}/sync`,
        segmentsUrl: `${SYNC_URL}/segments`,
        blobsUrl: `${SYNC_URL}/blobs`,
        realtimeUrl: `${SYNC_URL.replace(/^http/, "ws")}/realtime`,
      },
      multiTab: false,
      autoSync: true,
    });

    sync = {
      handle,
      async mutate(table, row) { await handle.mutate([{ table, values: row }]); },
      async remove(table, rowId) { await handle.mutate([{ table, op: "delete", rowId }]); },
      async query(sql, params = []) { return await handle.query(sql, params); },
      async subscribe(input) { await handle.subscribe(input); },
    };

    // 9개 테이블 구독
    await sync.subscribe({ id: "s-workouts", table: "workouts", scopes: { user_id: [actorId] } });
    await sync.subscribe({ id: "s-habits", table: "habits", scopes: { user_id: [actorId] } });
    await sync.subscribe({ id: "s-habit-logs", table: "habit_logs", scopes: { user_id: [actorId] } });
    await sync.subscribe({ id: "s-streaks", table: "streaks", scopes: { user_id: [actorId] } });
    await sync.subscribe({ id: "s-posts", table: "posts", scopes: { public_id: ["main"] } });
    await sync.subscribe({ id: "s-applications", table: "applications", scopes: { public_id: ["main"] } });
    await sync.subscribe({ id: "s-missions", table: "missions", scopes: { public_id: ["main"] } });
    await sync.subscribe({ id: "s-cheers", table: "cheers", scopes: { public_id: ["main"] } });
    await sync.subscribe({ id: "s-points", table: "point_ledger", scopes: { user_id: [actorId] } });

    handle.onChange?.(() => renderTab(currentTab));
    setStatus("연결됨", true);
    await renderTab(currentTab);
  } catch (e) {
    console.error("[init]", e);
    setStatus("연결 실패: " + (e.message || e), false);
  }
}

// ============ 탭 라우팅 ============
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderTab(currentTab);
  };
});

async function renderTab(tab) {
  if (!sync) return;
  if (tab === "today") await renderToday();
  else if (tab === "history") await renderHistory();
  else if (tab === "mate") await renderMate();
  else if (tab === "mission") await renderMission();
  else if (tab === "achieve") await renderAchieve();
  else if (tab === "profile") await renderProfile();
}

// ============ 공통 헬퍼 ============
async function getStreak() {
  const rows = await sync.query("SELECT * FROM streaks WHERE user_id = ?", [actorId]);
  return rows[0] || { current: 0, best: 0, last_date: null };
}

async function getPoints() {
  const rows = await sync.query("SELECT * FROM point_ledger WHERE user_id = ?", [actorId]);
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

async function addPoints(amount, reason) {
  const pts = await getPoints();
  await sync.mutate("point_ledger", {
    id: "pt_" + ms() + "_" + Math.random().toString(36).slice(2,6),
    user_id: actorId, amount, reason, balance_after: pts + amount, created_at_ms: ms(),
  });
}

// ============ 탭: 오늘 ============
async function renderToday() {
  const st = await getStreak();
  const pts = await getPoints();
  const today = todayStr();
  const workouts = await sync.query("SELECT * FROM workouts WHERE user_id = ? AND date = ?", [actorId, today]);
  const cheers = await sync.query("SELECT * FROM cheers WHERE target_user_id = ?", [actorId]);

  streakBadge.textContent = "🔥 " + (st.current || 0) + "일";

  main.innerHTML = `
    <div class="space-y-4">
      <div class="bg-gradient-to-br from-orange-500/20 to-rose-500/20 border border-orange-500/30 rounded-3xl p-5">
        <div class="text-sm text-slate-300 mb-1">오늘의 운동</div>
        <div class="text-2xl font-black mb-3">${workouts.length}회 기록</div>
        <button onclick="window.openWorkoutSheet()" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">+ 운동 기록하기</button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">스트릭</div>
          <div class="text-2xl font-black text-orange-300">${st.current || 0}일</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">포인트</div>
          <div class="text-2xl font-black text-amber-300">${pts} P</div>
        </div>
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-bold">오늘 받은 응원</div>
          <button onclick="window.openCheerSheet()" class="text-xs bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold px-3 py-1 rounded-full">+ 응원하기</button>
        </div>
        ${cheers.length ? cheers.map(c => `<span class="text-xl mr-1">${cheerEmoji(c.cheer_type)}</span>`).join("") : '<span class="text-slate-500 text-sm">아직 없어요</span>'}
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">오늘의 운동 기록</div>
        ${workouts.length ? workouts.map(w => `
          <div class="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
            <span class="text-lg">${typeEmoji(w.type)}</span>
            <span class="text-sm">${w.type}</span>
            <span class="text-xs text-slate-400">${w.duration_min}분 · ${w.intensity}</span>
            <button onclick="window.deleteWorkout('${w.id}')" class="ml-auto text-slate-500 text-xs">🗑️</button>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">아직 기록이 없어요</p>'}
      </div>
    </div>
  `;
}

// ============ 탭: 기록 ============
async function renderHistory() {
  const workouts = await sync.query("SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at_ms DESC LIMIT 50", [actorId]);
  const total = workouts.length;
  const totalMin = workouts.reduce((s, w) => s + w.duration_min, 0);

  // 종류별 집계
  const byType = {};
  workouts.forEach(w => { byType[w.type] = (byType[w.type] || 0) + 1; });

  main.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">총 운동</div>
          <div class="text-2xl font-black">${total}회</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">총 시간</div>
          <div class="text-2xl font-black">${totalMin}분</div>
        </div>
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">종류별 통계</div>
        ${Object.entries(byType).map(([t, c]) => `
          <div class="flex items-center gap-2 py-1.5">
            <span class="text-lg">${typeEmoji(t)}</span>
            <span class="text-sm flex-1">${t}</span>
            <span class="text-sm text-slate-400">${c}회</span>
          </div>
        `).join("") || '<p class="text-slate-500 text-sm">기록 없음</p>'}
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">최근 기록</div>
        ${workouts.slice(0, 20).map(w => `
          <div class="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
            <span class="text-lg">${typeEmoji(w.type)}</span>
            <div class="flex-1">
              <div class="text-sm">${w.type} · ${w.duration_min}분</div>
              <div class="text-[10px] text-slate-500">${w.date} · ${w.intensity}${w.memo ? " · " + w.memo : ""}</div>
            </div>
          </div>
        `).join("") || '<p class="text-slate-500 text-sm">기록 없음</p>'}
      </div>
    </div>
  `;
}

// ============ 탭: 메이트 ============
async function renderMate() {
  const posts = await sync.query("SELECT * FROM posts WHERE public_id = 'main' ORDER BY updated_at_ms DESC LIMIT 20", []);
  const myApps = await sync.query("SELECT * FROM applications WHERE user_id = ? ORDER BY created_at_ms DESC", [actorId]);
  const myAppliedPostIds = myApps.map(a => a.post_id);
  const myPosts = await sync.query("SELECT * FROM posts WHERE author_id = ?", [actorId]);
  const myPostIds = myPosts.map(p => p.id);
  const incomingApps = await sync.query("SELECT * FROM applications WHERE public_id = 'main'", []);
  const myIncoming = incomingApps.filter(a => myPostIds.includes(a.post_id) && a.status === "pending");

  main.innerHTML = `
    <div class="space-y-3">
      <button onclick="window.openPostSheet()" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">+ 메이트 모집하기</button>

      ${myIncoming.length ? `
      <div class="bg-slate-800/80 border border-amber-500/30 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2 text-amber-300">받은 신청 (${myIncoming.length})</div>
        ${myIncoming.map(a => `
          <div class="flex items-center gap-2 py-2 border-b border-slate-700/50 last:border-0">
            <span class="text-lg">${a.applicant_avatar}</span>
            <span class="text-sm flex-1">${a.applicant_name}</span>
            <button onclick="window.respondApplication('${a.id}', 'accepted')" class="bg-green-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg">수락</button>
            <button onclick="window.respondApplication('${a.id}', 'rejected')" class="bg-red-500 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg">거절</button>
          </div>
        `).join("")}
      </div>
      ` : ""}

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">내가 신청한 메이트 (${myApps.length})</div>
        ${myApps.length ? myApps.map(a => `
          <div class="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
            <span class="text-sm flex-1">${a.applicant_name}</span>
            <span class="text-xs ${a.status === "accepted" ? "text-green-400" : a.status === "rejected" ? "text-red-400" : "text-yellow-400"}">${a.status === "accepted" ? "수락됨" : a.status === "rejected" ? "거절됨" : "대기중"}</span>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">신청한 메이트가 없어요</p>'}
      </div>

      ${posts.length ? posts.map(p => {
        const types = JSON.parse(p.types || "[]");
        return `
          <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xl">${p.author_avatar}</span>
              <span class="font-bold text-sm">${p.author_name}</span>
              <span class="text-[10px] text-slate-500 ml-auto">${p.region}</span>
            </div>
            <div class="flex flex-wrap gap-1.5 mb-2">
              ${types.map(t => `<span class="chip bg-slate-900 border border-slate-600 text-[10px] px-2 py-0.5 rounded-full">${t}</span>`).join("")}
              <span class="chip bg-slate-900 border border-slate-600 text-[10px] px-2 py-0.5 rounded-full">${p.mode === "online" ? "온라인" : "오프라인"}</span>
            </div>
            <p class="text-sm text-slate-300 mb-2">${p.intro}</p>
            <div class="text-[10px] text-slate-500 mb-2">${p.time_slot} · 최대 ${p.capacity}명 · ${p.status === "recruiting" ? "모집중" : "마감"}</div>
            ${myAppliedPostIds.includes(p.id) ? `<div class="w-full bg-slate-700/50 text-slate-400 text-sm font-bold py-2 rounded-xl text-center">신청 완료</div>` : `<button onclick="window.applyPost('${p.id}', '${p.author_id}')" class="w-full bg-slate-700 text-white text-sm font-bold py-2 rounded-xl">신청하기</button>`}
          </div>
        `;
      }).join("") : '<p class="text-slate-500 text-sm text-center py-8">아직 모집글이 없어요</p>'}
      
      <button onclick="window.openCheerSheet()" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">+ 메이트에게 응원하기</button>
    </div>
  `;
}

// 응원 보내기 - 시트에서 대상 선택
window.openCheerSheet = async () => {
  // 모든 사용자 목록 가져오기 (posts 에서 저자 목록 추출)
  const posts = await sync.query("SELECT DISTINCT author_id, author_name, author_avatar FROM posts WHERE public_id = 'main'", []);
  const applications = await sync.query("SELECT DISTINCT user_id, applicant_name, applicant_avatar FROM applications WHERE public_id = 'main'", []);
  
  // 중복 제거하면서 병합
  const userMap = new Map();
  posts.forEach(p => {
    if (p.author_id !== actorId) userMap.set(p.author_id, { id: p.author_id, name: p.author_name, avatar: p.author_avatar });
  });
  applications.forEach(a => {
    if (a.user_id !== actorId && !userMap.has(a.user_id)) userMap.set(a.user_id, { id: a.user_id, name: a.applicant_name, avatar: a.applicant_avatar });
  });
  
  const users = Array.from(userMap.values());
  
  openSheet("응원하기", `
    <div class="space-y-3">
      <div class="text-sm text-slate-400">응원할 메이트를 선택해주세요</div>
      ${users.length ? users.map(u => `
        <button onclick="window.selectCheerTarget('${u.id}', '${u.name}', '${u.avatar}')" class="w-full flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-xl p-3 hover:bg-slate-700">
          <span class="text-2xl">${u.avatar}</span>
          <span class="font-bold">${u.name}</span>
        </button>
      `).join("") : '<p class="text-slate-500 text-center py-4">아직 메이트가 없어요</p>'}
    </div>
  `);
};

// 응원 대상 선택 후 이모지 선택 시트
window.selectCheerTarget = (targetId, targetName, targetAvatar) => {
  closeSheet();
  openSheet(`${targetAvatar} ${targetName} 님께 응원하기`, `
    <div class="space-y-3">
      <div class="text-sm text-slate-400 text-center">응원 이모지를 선택해주세요</div>
      <button onclick="window.sendCheer('${targetId}', 'fire')" class="w-full bg-orange-500/20 border border-orange-500/30 text-orange-300 font-bold py-4 rounded-2xl text-2xl hover:bg-orange-500/30">🔥 불꽃 응원</button>
      <button onclick="window.sendCheer('${targetId}', 'good')" class="w-full bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold py-4 rounded-2xl text-2xl hover:bg-blue-500/30">👍 좋아요</button>
      <button onclick="window.sendCheer('${targetId}', 'strong')" class="w-full bg-green-500/20 border border-green-500/30 text-green-300 font-bold py-4 rounded-2xl text-2xl hover:bg-green-500/30">💪 힘내요</button>
    </div>
  `);
};

// 응원 보내기
window.sendCheer = (targetUserId, cheerType) => {
  if (targetUserId === actorId) return alert("자신에게는 응원을 보낼 수 없어요");
  const confirmMsg = { "fire":"🔥 불꽃 응원", "good":"👍 좋아요", "strong":"💪 힘내요" }[cheerType];
  
  (async () => {
    await sync.mutate("cheers", {
      id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2,6),
      public_id: "main",
      target_user_id: targetUserId,
      from_user_id: actorId,
      cheer_type: cheerType,
      created_at_ms: Date.now(),
    });
    await sync.handle.syncUntilIdle();
    closeSheet();
    alert(`${confirmMsg}을 (를) 보냈어요!`);
    await renderTab(currentTab);
  })();
};

// ============ 탭: 미션 ============
async function renderMission() {
  const missions = await sync.query("SELECT * FROM missions WHERE public_id = 'main' ORDER BY updated_at_ms DESC", []);
  const myMissions = missions.filter(m => m.user_id === actorId);
  const myAssigned = missions.filter(m => m.assigner_id === actorId);
  const pending = myMissions.filter(m => m.status === "pending");
  const done = myMissions.filter(m => m.status === "done");

  main.innerHTML = `
    <div class="space-y-4">
      <button onclick="window.openAssignMissionSheet()" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">+ 메이트에게 미션 부여</button>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">내가 받은 미션 (${pending.length})</div>
        ${pending.length ? pending.map(m => `
          <div class="flex items-center gap-2 py-2 border-b border-slate-700/50 last:border-0">
            <div class="flex-1">
              <div class="text-sm font-bold">${m.title}</div>
              <div class="text-[10px] text-slate-500">목표 ${m.goal}회 · ${m.due_date || "기한없음"}</div>
            </div>
            <button onclick="window.completeMission('${m.id}')" class="bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">달성</button>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">받은 미션이 없어요</p>'}
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">내가 부여한 미션 (${myAssigned.length})</div>
        ${myAssigned.length ? myAssigned.map(m => `
          <div class="flex items-center gap-2 py-2 border-b border-slate-700/50 last:border-0">
            <div class="flex-1">
              <div class="text-sm">${m.title}</div>
              <div class="text-[10px] text-slate-500">목표 ${m.goal}회</div>
            </div>
            <span class="text-xs ${m.status === "done" ? "text-green-400" : "text-yellow-400"}">${m.status === "done" ? "달성" : "진행중"}</span>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">부여한 미션이 없어요</p>'}
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">완료한 미션 (${done.length})</div>
        ${done.length ? done.map(m => `
          <div class="flex items-center gap-2 py-2 border-b border-slate-700/50 last:border-0">
            <span class="text-lg">✅</span>
            <div class="flex-1">
              <div class="text-sm">${m.title}</div>
              <div class="text-[10px] text-slate-500">목표 ${m.goal}회 달성</div>
            </div>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">완료한 미션이 없어요</p>'}
      </div>
    </div>
  `;
}

// ============ 탭: 달성 ============
async function renderAchieve() {
  const doneMissions = await sync.query("SELECT * FROM missions WHERE user_id = ? AND status = 'done' ORDER BY updated_at_ms DESC", [actorId]);
  const points = await sync.query("SELECT * FROM point_ledger WHERE user_id = ? ORDER BY created_at_ms DESC LIMIT 30", [actorId]);

  main.innerHTML = `
    <div class="space-y-4">
      <div class="bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-3xl p-5">
        <div class="text-sm text-slate-300 mb-1">미션 달성</div>
        <div class="text-3xl font-black text-amber-300">${doneMissions.length}개</div>
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">달성한 미션</div>
        ${doneMissions.length ? doneMissions.map(m => `
          <div class="flex items-center gap-2 py-2 border-b border-slate-700/50 last:border-0">
            <span class="text-lg">🏆</span>
            <div class="flex-1">
              <div class="text-sm font-bold">${m.title}</div>
              <div class="text-[10px] text-slate-500">${new Date(m.updated_at_ms).toLocaleDateString()}</div>
            </div>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">아직 달성한 미션이 없어요</p>'}
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">포인트 내역</div>
        ${points.length ? points.map(p => `
          <div class="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
            <span class="text-sm font-bold ${p.amount > 0 ? "text-green-400" : "text-red-400"}">${p.amount > 0 ? "+" : ""}${p.amount}P</span>
            <span class="text-xs text-slate-400 flex-1">${p.reason}</span>
            <span class="text-[10px] text-slate-500">${new Date(p.created_at_ms).toLocaleDateString()}</span>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">포인트 내역이 없어요</p>'}
      </div>
    </div>
  `;
}

// ============ 탭: 프로필 ============
async function renderProfile() {
  const pts = await getPoints();
  const st = await getStreak();
  const habits = await sync.query("SELECT * FROM habits WHERE user_id = ?", [actorId]);
  const level = pts >= 2000 ? 5 : pts >= 900 ? 4 : pts >= 400 ? 3 : pts >= 150 ? 2 : 1;
  const levelName = ["", "🌱 새싹", "🔥 주니어", "⚡ 시니어", "🏅 에이스", "👑 레전드"][level];

  main.innerHTML = `
    <div class="space-y-4">
      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 text-center">
        <div class="text-5xl mb-2">${userAvatar}</div>
        <div class="text-lg font-black">${userName}</div>
        <div class="text-sm text-slate-400">LV.${level} ${levelName}</div>
        <div class="text-2xl font-black text-amber-300 mt-2">${pts} P</div>
        <div class="text-xs text-slate-500">최고 스트릭 ${st.best || 0}일</div>
      </div>

      <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <div class="text-sm font-bold mb-2">내 습관 (${habits.length})</div>
        ${habits.length ? habits.map(h => `
          <div class="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
            <span class="text-sm flex-1">${h.title}</span>
            <span class="text-xs text-slate-400">주 ${h.target_days}일</span>
          </div>
        `).join("") : '<p class="text-slate-500 text-sm">습관을 추가해보세요</p>'}
        <button onclick="window.openHabitSheet()" class="w-full mt-2 bg-slate-700 text-white text-sm font-bold py-2 rounded-xl">+ 습관 추가</button>
      </div>

      <button onclick="window.editProfile()" class="w-full bg-slate-700 text-white text-sm font-bold py-3 rounded-2xl">프로필 수정</button>
    </div>
  `;
}

// ============ 시트 (모달) ============
let sheetMask = null;
function openSheet(title, bodyHtml) {
  closeSheet();
  sheetMask = document.createElement("div");
  sheetMask.className = "fixed inset-0 bg-black/60 z-40 flex items-end";
  sheetMask.innerHTML = `
    <div class="w-full max-w-md mx-auto bg-slate-900 border-t border-slate-700 rounded-t-3xl p-5 pb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-black">${title}</h2>
        <button onclick="closeSheet()" class="text-slate-400 text-xl">✕</button>
      </div>
      ${bodyHtml}
    </div>
  `;
  sheetMask.onclick = (e) => { if (e.target === sheetMask) closeSheet(); };
  document.body.appendChild(sheetMask);
}
function closeSheet() { if (sheetMask) { sheetMask.remove(); sheetMask = null; } }

// 운동 기록 시트
window.openWorkoutSheet = () => {
  openSheet("운동 기록", `
    <form id="workoutForm" class="space-y-3">
      <select id="wType" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
        <option>헬스</option><option>러닝</option><option>홈트</option><option>자전거</option><option>요가</option><option>등산</option><option>걷기</option>
      </select>
      <input id="wDuration" type="number" min="1" placeholder="운동 시간(분)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <select id="wIntensity" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
        <option>가벼움</option><option>보통</option><option>강함</option>
      </select>
      <input id="wMemo" placeholder="메모 (선택)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">기록하기</button>
    </form>
  `);
  document.getElementById("workoutForm").onsubmit = async (e) => {
    e.preventDefault();
    const type = document.getElementById("wType").value;
    const duration = parseInt(document.getElementById("wDuration").value);
    const intensity = document.getElementById("wIntensity").value;
    const memo = document.getElementById("wMemo").value.trim();
    if (!duration) return alert("시간을 입력해주세요");
    await sync.mutate("workouts", {
      id: "w_" + ms() + "_" + Math.random().toString(36).slice(2,6),
      user_id: actorId, type, duration_min: duration, intensity, memo: memo || null,
      date: todayStr(), created_at_ms: ms(),
    });
    await addPoints(10, "운동 기록");
    await sync.handle.syncUntilIdle();
    closeSheet();
    await renderTab(currentTab);
  };
};

// 메이트 모집 시트
window.openPostSheet = () => {
  openSheet("메이트 모집", `
    <form id="postForm" class="space-y-3">
      <div class="flex flex-wrap gap-1.5" id="typeChips">
        ${["헬스","러닝","홈트","자전거","요가","등산","걷기"].map(t => `<button type="button" class="type-chip bg-slate-800 border border-slate-600 text-xs px-3 py-1.5 rounded-full" data-type="${t}">${t}</button>`).join("")}
      </div>
      <select id="pMode" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
        <option value="offline">오프라인</option><option value="online">온라인</option>
      </select>
      <input id="pRegion" placeholder="지역 (예: 서울 강남)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="pTimeSlot" placeholder="시간대 (예: 아침)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="pCapacity" type="number" min="1" max="6" value="4" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="pIntro" placeholder="한 줄 소개" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">모집하기</button>
    </form>
  `);
  let selectedTypes = [];
  document.querySelectorAll(".type-chip").forEach(chip => {
    chip.onclick = () => {
      const t = chip.dataset.type;
      if (selectedTypes.includes(t)) { selectedTypes = selectedTypes.filter(x => x !== t); chip.classList.remove("bg-orange-500"); }
      else { selectedTypes.push(t); chip.classList.add("bg-orange-500"); }
    };
  });
  document.getElementById("postForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedTypes.length) return alert("운동 종류를 선택해주세요");
    const region = document.getElementById("pRegion").value.trim() || "미정";
    const timeSlot = document.getElementById("pTimeSlot").value.trim() || "미정";
    const capacity = parseInt(document.getElementById("pCapacity").value);
    const intro = document.getElementById("pIntro").value.trim();
    const mode = document.getElementById("pMode").value;
    await sync.mutate("posts", {
      id: "post_" + ms() + "_" + Math.random().toString(36).slice(2,6),
      public_id: "main", author_id: actorId, author_name: userName, author_avatar: userAvatar,
      types: JSON.stringify(selectedTypes), mode, region, days: JSON.stringify([]),
      time_slot: timeSlot, capacity, intro, deadline: "2026-12-31", status: "recruiting",
      created_at_ms: ms(), updated_at_ms: ms(),
    });
    await sync.handle.syncUntilIdle();
    closeSheet();
    await renderTab(currentTab);
  };
};

// 운동 기록 삭제
window.deleteWorkout = async (workoutId) => {
  if (!confirm("이 운동 기록을 삭제할까요?")) return;
  try {
    await sync.remove("workouts", workoutId);
    console.log("[delete] remove ok");
  } catch (e) {
    console.error("[delete] remove error:", e);
    alert("remove 실패: " + (e && e.message ? e.message : String(e)));
    return;
  }
  try {
    await sync.handle.syncUntilIdle();
    console.log("[delete] sync ok");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error("[delete] sync error:", e);
    setStatus("삭제 sync 실패: " + msg, false);
    return;
  }
  await renderTab(currentTab);
};

// 모집 신청 (중복 신청 방지)
window.applyPost = async (postId, postAuthorId) => {
  const existing = await sync.query("SELECT * FROM applications WHERE user_id = ? AND post_id = ?", [actorId, postId]);
  if (existing.length) {
    alert("이미 신청한 모집글입니다");
    return;
  }
  await sync.mutate("applications", {
    id: "app_" + ms() + "_" + Math.random().toString(36).slice(2,6),
    public_id: "main", user_id: actorId, post_id: postId, post_author_id: postAuthorId,
    applicant_name: userName, applicant_avatar: userAvatar,
    status: "pending", message: null, created_at_ms: ms(),
  });
  await sync.handle.syncUntilIdle();
  alert("신청 완료!");
};

// 방장: 신청 수락/거절
window.respondApplication = async (appId, decision) => {
  const rows = await sync.query("SELECT * FROM applications WHERE id = ?", [appId]);
  if (!rows.length) return;
  const a = rows[0];
  await sync.mutate("applications", { ...a, status: decision });
  await sync.handle.syncUntilIdle();
  await renderTab(currentTab);
};

// 미션 달성
window.completeMission = async (missionId) => {
  const rows = await sync.query("SELECT * FROM missions WHERE id = ?", [missionId]);
  if (!rows.length) return;
  const m = rows[0];
  await sync.mutate("missions", { ...m, status: "done", updated_at_ms: ms() });
  await addPoints(50, "미션 달성");
  await sync.handle.syncUntilIdle();
  await renderTab(currentTab);
};

// 메이트에게 미션 부여 시트
window.openAssignMissionSheet = () => {
  openSheet("메이트에게 미션 부여", `
    <form id="assignForm" class="space-y-3">
      <input id="mTargetId" placeholder="메이트 ID (상대방)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="mTitle" placeholder="미션 제목 (예: 이번 주 러닝 3회)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="mGoal" type="number" min="1" value="3" placeholder="목표 횟수" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="mDue" type="date" placeholder="기한 (선택)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">부여하기</button>
    </form>
  `);
  document.getElementById("assignForm").onsubmit = async (e) => {
    e.preventDefault();
    const targetId = document.getElementById("mTargetId").value.trim();
    const title = document.getElementById("mTitle").value.trim();
    const goal = parseInt(document.getElementById("mGoal").value);
    const due = document.getElementById("mDue").value || null;
    if (!targetId) return alert("메이트 ID를 입력해주세요");
    if (!title) return alert("미션 제목을 입력해주세요");
    await sync.mutate("missions", {
      id: "m_" + ms() + "_" + Math.random().toString(36).slice(2,6),
      public_id: "main", user_id: targetId, assigner_id: actorId,
      title, goal, status: "pending", due_date: due,
      created_at_ms: ms(), updated_at_ms: ms(),
    });
    await sync.handle.syncUntilIdle();
    closeSheet();
    await renderTab(currentTab);
  };
};

// 습관 추가 시트
window.openHabitSheet = () => {
  openSheet("습관 추가", `
    <form id="habitForm" class="space-y-3">
      <input id="hTitle" placeholder="습관 이름 (예: 매일 30분 운동)" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="hTarget" type="number" min="1" max="7" value="3" placeholder="주당 목표 일수" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">추가</button>
    </form>
  `);
  document.getElementById("habitForm").onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById("hTitle").value.trim();
    const target = parseInt(document.getElementById("hTarget").value);
    if (!title) return alert("습관 이름을 입력해주세요");
    await sync.mutate("habits", {
      id: "h_" + ms() + "_" + Math.random().toString(36).slice(2,6),
      user_id: actorId, title, target_days: target, created_at_ms: ms(),
    });
    await sync.handle.syncUntilIdle();
    closeSheet();
    await renderTab(currentTab);
  };
};

// 프로필 수정
window.editProfile = () => {
  openSheet("프로필 수정", `
    <form id="profileForm" class="space-y-3">
      <input id="pfName" value="${userName}" placeholder="이름" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <input id="pfAvatar" value="${userAvatar}" placeholder="아바타 이모지" class="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white">
      <button type="submit" class="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-3 rounded-2xl">저장</button>
    </form>
  `);
  document.getElementById("profileForm").onsubmit = (e) => {
    e.preventDefault();
    userName = document.getElementById("pfName").value.trim() || "운동러";
    userAvatar = document.getElementById("pfAvatar").value.trim() || "💪";
    localStorage.setItem("ya_user_name", userName);
    localStorage.setItem("ya_user_avatar", userAvatar);
    closeSheet();
    renderTab(currentTab);
  };
};

// ============ 유틸 ============
function typeEmoji(t) {
  return { "헬스":"🏋️","러닝":"🏃","홈트":"🏠","자전거":"🚴","요가":"🧘","등산":"⛰️","걷기":"🚶" }[t] || "💪";
}
function cheerEmoji(t) {
  return { "fire":"🔥","good":"👍","strong":"💪" }[t] || "👏";
}

// 전역 노출 (esbuild DCE 방지)
window.openWorkoutSheet = window.openWorkoutSheet;
window.deleteWorkout = window.deleteWorkout;
window.respondApplication = window.respondApplication;
window.openAssignMissionSheet = window.openAssignMissionSheet;
window.openPostSheet = window.openPostSheet;
window.applyPost = window.applyPost;
window.completeMission = window.completeMission;
window.openHabitSheet = window.openHabitSheet;
window.editProfile = window.editProfile;
window.closeSheet = closeSheet;

init();
