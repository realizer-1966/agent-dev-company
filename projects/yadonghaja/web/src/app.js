/**
 * yadonghaja v2 — 메인 앱 (UI 렌더 + 인메모리 스토어)
 */
import { createInMemoryAdapter } from './sync-inmem.js';

// ============ 상태 ============
let sync = null;
let currentUser = null;
let currentTab = 'home';
let selectedAvatar = '💪';

// ============ DOM ============
const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const sheet = $('#sheet');
const sheetMask = $('#sheetMask');
const sheetTitle = $('#sheetTitle');
const sheetBody = $('#sheetBody');
const toastEl = $('#toast');
const fab = $('#fab');
const connDot = $('#connDot');
const connLabel = $('#connLabel');

// ============ 유틸 ============
function uuid() {
  return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function ms() {
  return Date.now();
}
function showToast(msg, duration = 2000) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), duration);
}
function showPointsFly(x, y, text) {
  const el = document.createElement('div');
  el.className = 'points-float text-amber-300';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
function openSheet(title, html) {
  sheetTitle.textContent = title;
  sheetBody.innerHTML = html;
  sheetMask.style.display = 'block';
  sheet.classList.add('open');
}
function closeSheet() {
  sheet.classList.remove('open');
  setTimeout(() => { sheetMask.style.display = 'none'; sheetBody.innerHTML = ''; }, 280);
}

// ============ 초기화 ============
async function init() {
  const saved = localStorage.getItem('yadong_actor');
  if (saved) {
    currentUser = JSON.parse(saved);
    await startSync(currentUser.actorId);
    renderApp();
  } else {
    showOnboarding();
  }
}

function showOnboarding() {
  $('#onboard').style.display = 'flex';
  const avatars = ['💪', '🏃', '🚴', '🧘', '🏋️', '🥊', '⚽️', '🏀'];
  const container = $('#obAvatars');
  container.innerHTML = avatars.map(a =>
    `<button class="avatar-chip chip bg-slate-800 border border-slate-600 text-2xl ${a === selectedAvatar ? 'ring-2 ring-orange-400' : ''}" data-a="${a}">${a}</button>`
  ).join('');
  container.querySelectorAll('.avatar-chip').forEach(btn => {
    btn.onclick = () => {
      selectedAvatar = btn.dataset.a;
      container.querySelectorAll('.avatar-chip').forEach(b => b.classList.remove('ring-2', 'ring-orange-400'));
      btn.classList.add('ring-2', 'ring-orange-400');
    };
  });
  $('#obName').focus();
  $('#obStart').onclick = async () => {
    const name = $('#obName').value.trim();
    if (name.length < 2) { showToast('이름을 2 자 이상 입력해줘요'); return; }
    const actorId = 'u_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    currentUser = { actorId, name, avatar: selectedAvatar };
    localStorage.setItem('yadong_actor', JSON.stringify(currentUser));
    $('#onboard').style.display = 'none';
    await startSync(actorId);
    await seedUserProfile();
    renderApp();
  };
}

async function startSync(actorId) {
  console.log('[app] startSync for', actorId);
  sync = createInMemoryAdapter(actorId);
  sync.subscribe('publicPosts', { table: 'posts', scopes: { public_id: ['main'] } });
  sync.subscribe('publicFeed', { table: 'feed_items', scopes: { public_id: ['main'] } });
  sync.subscribe('publicCheers', { table: 'cheers', scopes: { public_id: ['main'] } });
  sync.subscribe('allApplies', { table: 'applications', scopes: { apply_scope: ['open'] } });
  sync.subscribe('allVerifs', { table: 'verifications', scopes: { verify_scope: ['live'] } });
  sync.subscribe('myMissions', { table: 'missions', scopes: { user_id: [actorId] } });
  sync.subscribe('myLedger', { table: 'point_ledger', scopes: { user_id: [actorId] } });
  sync.subscribe('myStreak', { table: 'streaks', scopes: { user_id: [actorId] } });
  sync.subscribe('myBadges', { table: 'badges', scopes: { user_id: [actorId] } });
  
  sync.onSyncStateChange((st) => {
    const phase = st?.phase || 'connected';
    connDot.className = `w-2 h-2 rounded-full ${phase === 'connected' ? 'bg-emerald-400' : 'bg-slate-500'}`;
    connLabel.textContent = phase === 'connected' ? '실시간 동기화' : '오프라인';
  });
  console.log('[app] sync initialized');
}

async function seedUserProfile() {
  const { actorId, name, avatar } = currentUser;
  await sync.mutate('user_profiles', {
    id: actorId, public_id: 'main', display_name: name, avatar,
    interests: '["홈트"]', created_at_ms: ms(), updated_at_ms: ms(),
  });
  await sync.mutate('streaks', {
    id: actorId, user_id: actorId, current: 0, best: 0, last_date: null, updated_at_ms: ms(),
  });
  await sync.mutate('missions', {
    id: `${actorId}:${todayStr()}:0`, user_id: actorId, kind: 'daily', date: todayStr(),
    title: '첫 운동 인증!', goal: 1, status: 'pending', updated_at_ms: ms(),
  });
}

// ============ 렌더 ============
function renderApp() {
  updateHeader();
  renderTab(currentTab);
  setupTabs();
  fab.style.display = currentTab === 'recruit' || currentTab === 'mission' ? 'block' : 'none';
  fab.onclick = () => {
    if (currentTab === 'recruit') openRecruitSheet();
    else if (currentTab === 'mission') openMissionSheet();
  };
}

function updateHeader() {
  $('#headerPoints').textContent = getPoints() + ' P';
  const st = getStreak();
  $('#headerStreak').textContent = `🔥 ${st?.current || 0}일`;
}

function getPoints() {
  const rows = sync.query("SELECT balance_after FROM point_ledger WHERE user_id = ?1 ORDER BY created_at_ms DESC LIMIT 1", [currentUser.actorId]);
  return rows.length > 0 ? rows[0].balance_after : 0;
}
function getStreak() {
  const rows = sync.query("SELECT * FROM streaks WHERE user_id = ?1", [currentUser.actorId]);
  return rows[0] || null;
}

function setupTabs() {
  document.querySelectorAll('.tabbtn').forEach(btn => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      renderTab(currentTab);
      fab.style.display = currentTab === 'recruit' || currentTab === 'mission' ? 'block' : 'none';
    };
  });
}

function renderTab(tab) {
  if (tab === 'home') renderHome();
  else if (tab === 'recruit') renderRecruit();
  else if (tab === 'mission') renderMission();
  else if (tab === 'feed') renderFeed();
  else if (tab === 'profile') renderProfile();
}

// ============ 탭: 홈 ============
function renderHome() {
  const posts = sync.query("SELECT * FROM posts WHERE public_id = 'main' ORDER BY created_at_ms DESC LIMIT 10");
  const st = getStreak();
  const pts = getPoints();
  main.innerHTML = `
    <div class="fade-in">
      <div class="bg-gradient-to-br from-orange-500/20 to-rose-500/20 border border-orange-500/30 rounded-3xl p-5 mb-4">
        <div class="text-sm text-slate-300 mb-1">오늘의 미션</div>
        <div class="text-lg font-black text-white mb-3">첫 운동 인증!</div>
        <button onclick="window.openMissionSheet()" class="btn bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm">인증하기</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">스트릭</div>
          <div class="text-2xl font-black text-orange-300">${st?.current || 0}일</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <div class="text-[10px] text-slate-400">포인트</div>
          <div class="text-2xl font-black text-amber-300">${pts} P</div>
        </div>
      </div>
      <h3 class="text-lg font-extrabold mb-3 text-slate-200">📋 최근 모집글</h3>
      ${posts.length ? posts.map(p => cardRecruit(p)).join('') : '<p class="text-slate-400 text-sm text-center py-8">아직 모집글이 없어요</p>'}
    </div>
  `;
}

// ============ 탭: 모집 ============
function renderRecruit() {
  const posts = sync.query("SELECT * FROM posts WHERE public_id = 'main' ORDER BY created_at_ms DESC LIMIT 20");
  main.innerHTML = posts.length ? posts.map(p => cardRecruit(p)).join('') : `
    <div class="text-center py-16">
      <div class="text-6xl mb-4">👋</div>
      <p class="text-slate-400 text-sm">아직 모집글이 없어요</p>
      <button onclick="window.openRecruitSheet()" class="btn mt-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold px-6 py-3 rounded-2xl text-sm">첫 모집글 쓰기</button>
    </div>
  `;
}

function cardRecruit(p) {
  const types = JSON.parse(p.types || '[]');
  return `
    <div class="card bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xl">${p.author_avatar}</span>
        <span class="font-bold text-slate-200 text-sm">${p.author_name}</span>
        <span class="text-[10px] text-slate-500 ml-auto">${new Date(p.created_at_ms).toLocaleDateString()}</span>
      </div>
      <div class="flex flex-wrap gap-1.5 mb-2">
        ${types.map(t => `<span class="chip bg-slate-900 border border-slate-600 text-[10px]">${t}</span>`).join('')}
      </div>
      <div class="text-sm text-slate-300 mb-2">${p.mode} · ${p.region} · ${p.time_slot}</div>
      <div class="text-slate-400 text-sm mb-3 line-clamp-2">${p.intro}</div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-slate-500">정원 ${p.capacity}명</span>
        <span class="text-[10px] text-slate-500">마감 ${p.deadline}</span>
      </div>
      <button onclick="openApply('${p.id}')" class="btn w-full mt-3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-sm">신청하기</button>
    </div>
  `;
}

function openApply(postId) {
  openSheet('모집 신청', `
    <form id="applyForm" class="space-y-3">
      <textarea id="applyMsg" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="신청 이유를 적어주세요"></textarea>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">신청하기</button>
    </form>
  `);
  $('#applyForm').onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#applyMsg').value.trim();
    await sync.mutate('applications', {
      id: `${postId}:${currentUser.actorId}`,
      post_id: postId,
      applicant_id: currentUser.actorId,
      applicant_name: currentUser.name,
      applicant_avatar: currentUser.avatar,
      message: msg,
      status: 'pending',
      created_at_ms: ms(),
    });
    closeSheet();
    showToast('신청 완료!');
  };
}

// ============ 탭: 미션 ============
function renderMission() {
  const missions = sync.query("SELECT * FROM missions WHERE user_id = ?1 ORDER BY date DESC LIMIT 10", [currentUser.actorId]);
  main.innerHTML = missions.length ? missions.map(m => cardMission(m)).join('') : `
    <div class="text-center py-16">
      <div class="text-6xl mb-4">✅</div>
      <p class="text-slate-400 text-sm">미션이 없어요</p>
    </div>
  `;
}

function cardMission(m) {
  const isDone = m.status === 'done';
  return `
    <div class="card bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-3 ${isDone ? 'opacity-60' : ''}">
      <div class="flex items-center gap-3 mb-2">
        <span class="text-2xl">${isDone ? '✅' : '⏳'}</span>
        <div class="flex-1">
          <div class="font-bold text-slate-200">${m.title}</div>
          <div class="text-xs text-slate-400">${m.date}</div>
        </div>
      </div>
      ${!isDone ? `<button onclick="verifyMission('${m.id}', '${m.title}')" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold py-2.5 rounded-xl text-sm">인증하기</button>` : '<div class="text-sm text-emerald-400 font-bold">인증 완료!</div>'}
    </div>
  `;
}

function verifyMission(missionId, title) {
  openSheet('운동 인증', `
    <form id="verifyForm" class="space-y-3">
      <textarea id="vMemo" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="오늘의 운동을 기록해주세요"></textarea>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">인증 완료!</button>
    </form>
  `);
  $('#verifyForm').onsubmit = async (e) => {
    e.preventDefault();
    const memo = $('#vMemo').value.trim() || '';
    const date = todayStr();
    await sync.mutate('missions', { id: missionId, status: 'done', verified_at_ms: ms(), updated_at_ms: ms() });
    await sync.mutate('verifications', {
      id: `${currentUser.actorId}:${missionId}`, verify_scope: 'live', group_id: 'solo',
      user_id: currentUser.actorId, mission_id: missionId, mission_title: title,
      mission_kind: 'daily', date, memo, photo: null, created_at_ms: ms(),
    });
    // 포인트 +10
    const cur = getPoints();
    await sync.mutate('point_ledger', {
      id: 'pt_' + crypto.randomUUID().slice(0, 8), user_id: currentUser.actorId,
      amount: 10, reason: 'daily_mission', balance_after: cur + 10, created_at_ms: ms(),
    });
    // 스트릭 업데이트
    const st = getStreak();
    const last = st?.last_date;
    const today = todayStr();
    const diff = last ? (new Date(today) - new Date(last)) / 86400000 : 999;
    const newCur = diff === 1 ? (st.current + 1) : diff > 1 ? 1 : st.current;
    await sync.mutate('streaks', {
      id: currentUser.actorId, user_id: currentUser.actorId, current: newCur,
      best: Math.max(st.best, newCur), last_date: today, updated_at_ms: ms(),
    });
    closeSheet();
    showPointsFly(window.innerWidth / 2, window.innerHeight / 2, '+10 P 🔥');
    showToast('인증 완료! +10 P');
    renderMission();
    updateHeader();
  };
}

// ============ 탭: 피드 ============
function renderFeed() {
  const feed = sync.query("SELECT * FROM feed_items ORDER BY created_at_ms DESC LIMIT 30");
  main.innerHTML = feed.length ? feed.map(f => cardFeed(f)).join('') : '<p class="text-slate-400 text-sm mt-8 text-center">아직 피드가 없어요</p>';
}

function cardFeed(f) {
  return `
    <div class="card bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xl">${f.avatar}</span>
        <span class="font-bold text-slate-200 text-sm">${f.user_name}</span>
        <span class="text-[10px] text-slate-500 ml-auto">${new Date(f.created_at_ms).toLocaleDateString()}</span>
      </div>
      <div class="font-extrabold text-slate-100 mb-1">${f.mission_title}</div>
      ${f.memo ? `<p class="text-sm text-slate-300 mb-2">${f.memo}</p>` : ''}
      ${f.photo ? '<div class="text-xs text-emerald-400 font-bold mb-2">사진 ✅</div>' : ''}
      <div class="flex items-center gap-2 mt-2">
        <button class="cheer-btn text-lg" onclick="sendCheer('${f.id}', 'fire')">🔥</button>
        <button class="cheer-btn text-lg" onclick="sendCheer('${f.id}', 'thumb')">👍</button>
        <button class="cheer-btn text-lg" onclick="sendCheer('${f.id}', 'muscle')">💪</button>
      </div>
    </div>
  `;
}

async function sendCheer(feedId, type) {
  const id = `${feedId}:${currentUser.actorId}:${type}`;
  const exists = sync.query("SELECT 1 FROM cheers WHERE id = ?1", [id]).length > 0;
  if (exists) return showToast('이미 응원했어요');
  await sync.mutate('cheers', {
    id, public_id: 'main', feed_id: feedId, user_id: currentUser.actorId,
    cheer_type: type, created_at_ms: ms(),
  });
  const cur = getPoints();
  await sync.mutate('point_ledger', {
    id: 'pt_' + crypto.randomUUID().slice(0, 8), user_id: currentUser.actorId,
    amount: 1, reason: 'cheer', balance_after: cur + 1, created_at_ms: ms(),
  });
  updateHeader();
  showToast('응원 완료! +1 P');
}

// ============ 탭: 프로필 ============
function renderProfile() {
  const badges = sync.query("SELECT * FROM badges WHERE user_id = ?1", [currentUser.actorId]);
  const st = getStreak();
  const pts = getPoints();
  main.innerHTML = `
    <div class="fade-in text-center">
      <div class="text-6xl mb-2">${currentUser.avatar}</div>
      <h2 class="text-xl font-extrabold">${currentUser.name}</h2>
      <div class="text-sm text-slate-400 mt-1">${currentUser.actorId.slice(0, 12)}</div>
      <div class="flex justify-center gap-4 mt-4">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl px-4 py-3">
          <div class="text-[10px] text-slate-400">포인트</div>
          <div class="text-lg font-black text-amber-300">${pts} P</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl px-4 py-3">
          <div class="text-[10px] text-slate-400">스트릭</div>
          <div class="text-lg font-black text-orange-300">${st?.current || 0}일</div>
        </div>
      </div>
      <h3 class="text-lg font-extrabold mt-6 mb-3 text-slate-200">🏆 배지</h3>
      ${badges.length ? `<div class="flex flex-wrap justify-center gap-2">${badges.map(b => `<span class="chip bg-slate-800 border border-slate-600">${b.badge_id}</span>`).join('')}</div>` : '<p class="text-slate-400 text-sm">아직 획득한 배지가 없어요</p>'}
    </div>
  `;
}

// ============ 모집글 쓰기 ============
function openRecruitSheet() {
  openSheet('메이트 모집글 쓰기', `
    <form id="recruitForm" class="space-y-3">
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">운동 종류 (최대 3 개)</label>
        <div class="flex flex-wrap gap-2" id="typeChips">
          ${['러닝', '걷기', '헬스', '홈트', '자전거', '요가', '수영', '등산'].map(t =>
            `<button type="button" class="chip bg-slate-900 border border-slate-600 type-chip">${t}</button>`
          ).join('')}
        </div>
        <input type="hidden" id="types" name="types" value="[]">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">방식</label>
        <select id="mode" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold">
          <option>온라인</option><option>오프라인</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">지역</label>
        <input id="region" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="예: 서울 강남구">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">요일</label>
        <div class="flex justify-between" id="dayChips">
          ${['일', '월', '화', '수', '목', '금', '토'].map((d, i) =>
            `<button type="button" class="chip bg-slate-900 border border-slate-600 day-chip" data-i="${i}">${d}</button>`
          ).join('')}
        </div>
        <input type="hidden" id="days" name="days" value="[]">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">시간대</label>
        <input id="timeSlot" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="예: 아침 7 시">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">정원</label>
        <input id="capacity" type="number" min="1" max="6" value="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">한마디</label>
        <textarea id="intro" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="어떤 메이트를 찾나요?"></textarea>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">마감일</label>
        <input id="deadline" type="date" value="${todayStr()}" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold">
      </div>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">올리기</button>
    </form>
  `);

  const selectedTypes = [];
  const selectedDays = [];
  sheetBody.querySelectorAll('.type-chip').forEach(btn => {
    btn.onclick = () => {
      const t = btn.textContent;
      const idx = selectedTypes.indexOf(t);
      if (idx >= 0) { selectedTypes.splice(idx, 1); btn.classList.remove('bg-orange-500', 'text-white'); btn.classList.add('bg-slate-900'); }
      else { if (selectedTypes.length >= 3) return showToast('최대 3 개'); selectedTypes.push(t); btn.classList.remove('bg-slate-900'); btn.classList.add('bg-orange-500', 'text-white'); }
      $('#types').value = JSON.stringify(selectedTypes);
    };
  });
  sheetBody.querySelectorAll('.day-chip').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i;
      const idx = selectedDays.indexOf(i);
      if (idx >= 0) { selectedDays.splice(idx, 1); btn.classList.remove('bg-amber-500', 'text-white'); btn.classList.add('bg-slate-900'); }
      else { selectedDays.push(i); btn.classList.remove('bg-slate-900'); btn.classList.add('bg-amber-500', 'text-white'); }
      $('#days').value = JSON.stringify(selectedDays);
    };
  });

  $('#recruitForm').onsubmit = async (e) => {
    e.preventDefault();
    const types = JSON.parse($('#types').value);
    const days = JSON.parse($('#days').value);
    if (!types.length) return showToast('운동 종류를 선택해줘요');
    if (!days.length) return showToast('요일을 선택해줘요');
    const region = $('#region').value.trim();
    const timeSlot = $('#timeSlot').value.trim();
    const capacity = parseInt($('#capacity').value);
    const intro = $('#intro').value.trim();
    const deadline = $('#deadline').value;
    const mode = $('#mode').value;

    const postId = `post_${crypto.randomUUID().slice(0, 8)}`;
    await sync.mutate('posts', {
      id: postId, public_id: 'main',
      author_id: currentUser.actorId,
      author_name: currentUser.name,
      author_avatar: currentUser.avatar,
      types: JSON.stringify(types),
      mode, region, days: JSON.stringify(days), time_slot: timeSlot,
      capacity, intro, deadline,
      created_at_ms: ms(),
    });
    // feed_items 에도 추가
    await sync.mutate('feed_items', {
      id: `feed_${postId}`,
      public_id: 'main',
      user_id: currentUser.actorId,
      user_name: currentUser.name,
      avatar: currentUser.avatar,
      mission_title: `메이트 모집: ${types.join(', ')}`,
      memo: intro,
      photo: null,
      created_at_ms: ms(),
    });
    closeSheet();
    showToast('모집글 등록 완료!');
    renderRecruit();
  };
}

// ============ 미션 추가 ============
function openMissionSheet() {
  openSheet('미션 추가', `
    <form id="missionForm" class="space-y-3">
      <input id="mTitle" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="미션 제목">
      <input id="mGoal" type="number" min="1" value="1" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="목표 횟수">
      <select id="mKind" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold">
        <option value="daily">일일 미션</option>
        <option value="weekly">주간 미션</option>
      </select>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">추가</button>
    </form>
  `);
  $('#missionForm').onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#mTitle').value.trim();
    const goal = parseInt($('#mGoal').value);
    const kind = $('#mKind').value;
    if (!title) return showToast('제목을 입력해줘요');
    await sync.mutate('missions', {
      id: `${currentUser.actorId}:${todayStr()}:${kind}`,
      user_id: currentUser.actorId, kind, date: todayStr(),
      title, goal, status: 'pending', updated_at_ms: ms(),
    });
    closeSheet();
    showToast('미션 추가 완료!');
    renderMission();
  };
}

// ============ 시트 닫기 ============
$('#sheetClose').onclick = closeSheet;
sheetMask.onclick = closeSheet;

// ============ E2E 테스트용 전역 함수 ============
window.openRecruitSheet = openRecruitSheet;
window.openMissionSheet = openMissionSheet;

// ============ 시작 ============
init();