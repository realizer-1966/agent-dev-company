/**
 * yadonghaja v2.1 — Syncular 동기화 (OPFS + 서버)
 * - 사진 인증 + 포인트/배지/랭킹 시스템 완성
 * - Syncular 어댑터(sync.js) 사용 — 연결 실패 시 인메모리로 fallback
 */
import { createSyncAdapter } from './sync.js';

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
function uuid() { return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function ms() { return Date.now(); }
function showToast(msg, duration = 2000) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), duration);
}
function showPointsFly(x, y, text) {
  const el = document.createElement('div');
  el.className = 'points-float text-amber-300';
  el.style.left = x + 'px'; el.style.top = y + 'px';
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
    // 본계정 Workers 연동 (v2.5)
    sync = await createSyncAdapter(currentUser.actorId, 'https://yadonghaja-sync-v2.dydtnsp.workers.dev');
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
    // 본계정 Workers 연동 (v2.5)
    sync = await createSyncAdapter(actorId, 'https://yadonghaja-sync-v2.dydtnsp.workers.dev');
    await seedUserProfile();
    renderApp();
  };
}

async function seedUserProfile() {
  const { actorId, name, avatar } = currentUser;
  const now = ms();
  await sync.mutate('user_profiles', { id: actorId, public_id: 'main', display_name: name, avatar, interests: '["홈트"]', created_at_ms: now, updated_at_ms: now });
  await sync.mutate('streaks', { id: actorId, user_id: actorId, current: 0, best: 0, last_date: null, updated_at_ms: now });
  await sync.mutate('missions', { id: `${actorId}:${todayStr()}:0`, user_id: actorId, kind: 'daily', date: todayStr(), title: '첫 운동 인증!', goal: 1, status: 'pending', updated_at_ms: now });
}

// ============ 보상 시스템 ============
async function awardPoints(amount, reason) {
  const cur = await getPoints();
  const newBalance = cur + amount;
  await sync.mutate('point_ledger', { id: 'pt_'+crypto.randomUUID().slice(0,8), user_id: currentUser.actorId, amount, reason, balance_after: newBalance, updated_at_ms: ms() });
  await checkBadges(newBalance);
  return newBalance;
}

async function checkBadges(points) {
  const badges = await sync.query('SELECT badge_id FROM badges WHERE user_id = ?1', [currentUser.actorId]);
  const has = badges.map(b => b.badge_id);
  const candidates = [
    { id: 'first_step', name: '첫 걸음', condition: (p) => p >= 10 && !has.includes('first_step') },
    { id: 'week_warrior', name: '1 주 전사', condition: (p) => p >= 100 && !has.includes('week_warrior') },
    { id: 'month_master', name: '1 달 마스터', condition: (p) => p >= 500 && !has.includes('month_master') },
  ];
  for (const b of candidates) {
    if (b.condition(points)) {
      const now = ms(); await sync.mutate('badges', { id: `${currentUser.actorId}:${b.id}`, user_id: currentUser.actorId, badge_id: b.id, badge_name: b.name, earned_at_ms: now, updated_at_ms: now });
      showToast(`🏆 새로운 배지: ${b.name}!`);
    }
  }
}

async function updateStreak() {
  const st = await getStreak();
  const last = st?.last_date;
  const today = todayStr();
  const diff = last ? (new Date(today) - new Date(last)) / 86400000 : 999;
  const newCur = diff === 1 ? (st.current + 1) : diff > 1 ? 1 : st.current;
  const newBest = Math.max(st.best, newCur);
  await sync.mutate('streaks', { id: currentUser.actorId, user_id: currentUser.actorId, current: newCur, best: newBest, last_date: today, updated_at_ms: ms() });
  if (newCur === 7) await awardPoints(50, '7 일 연속');
  if (newCur === 30) await awardPoints(200, '30 일 연속');
  return { current: newCur, best: newBest };
}

async function getPoints() {
  const rows = await sync.query('SELECT balance_after FROM point_ledger WHERE user_id = ?1 ORDER BY created_at_ms DESC LIMIT 1', [currentUser.actorId]);
  return rows.length > 0 ? rows[0].balance_after : 0;
}
async function getStreak() {
  const rows = await sync.query('SELECT * FROM streaks WHERE user_id = ?1', [currentUser.actorId]);
  return rows[0] || null;
}
async function getRank() {
  const rows = await sync.query('SELECT user_id, total_points, RANK() OVER (ORDER BY total_points DESC) as rank FROM rankings WHERE group_id = ?1', ['main']);
  const my = rows.find(r => r.user_id === currentUser.actorId);
  return my?.rank || rows.length + 1;
}
async function updateRanking() {
  const pts = await getPoints();
  const now = ms(); await sync.mutate('rankings', { id: currentUser.actorId, group_id: 'main', user_id: currentUser.actorId, total_points: pts, created_at_ms: now, updated_at_ms: now });
}

// ============ 렌더 ============
async function renderApp() {
  await updateHeader();
  await renderTab(currentTab);
  setupTabs();
  fab.style.display = currentTab === 'recruit' || currentTab === 'mission' ? 'block' : 'none';
  fab.onclick = () => {
    if (currentTab === 'recruit') openRecruitSheet();
    else if (currentTab === 'mission') openMissionSheet();
  };
}

async function updateHeader() {
  const p = await getPoints();
  const st = await getStreak();
  $('#headerPoints').textContent = p + ' P';
  $('#headerStreak').textContent = `🔥 ${st?.current || 0}일`;
}

function setupTabs() {
  document.querySelectorAll('.tabbtn').forEach(btn => {
    btn.onclick = async () => {
      currentTab = btn.dataset.tab;
      await renderTab(currentTab);
      fab.style.display = currentTab === 'recruit' || currentTab === 'mission' ? 'block' : 'none';
    };
  });
}

async function renderTab(tab) {
  if (tab === 'home') await renderHome();
  else if (tab === 'recruit') await renderRecruit();
  else if (tab === 'mission') await renderMission();
  else if (tab === 'feed') await renderFeed();
  else if (tab === 'profile') await renderProfile();
  else if (tab === 'rank') await renderRank();
}

// ============ 탭: 홈 ============
async function renderHome() {
  const posts = await sync.query("SELECT * FROM posts WHERE public_id = 'main' ORDER BY updated_at_ms DESC LIMIT 10");
  const st = await getStreak();
  const pts = await getPoints();
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
async function renderRecruit() {
  const posts = await sync.query("SELECT * FROM posts WHERE public_id = 'main' ORDER BY updated_at_ms DESC LIMIT 20");
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
        <span class="text-[10px] text-slate-500 ml-auto">${new Date(p.updated_at_ms).toLocaleDateString()}</span>
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

async function openApply(postId) {
  openSheet('모집 신청', `
    <form id="applyForm" class="space-y-3">
      <textarea id="applyMsg" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="신청 이유를 적어주세요"></textarea>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">신청하기</button>
    </form>
  `);
  $('#applyForm').onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#applyMsg').value.trim();
    await sync.mutate('applications', { id: `${postId}:${currentUser.actorId}`, post_id: postId, applicant_id: currentUser.actorId, applicant_name: currentUser.name, applicant_avatar: currentUser.avatar, message: msg, status: 'pending', updated_at_ms: ms() });
    closeSheet();
    showToast('신청 완료!');
  };
}

// ============ 탭: 미션 ============
async function renderMission() {
  const missions = await sync.query("SELECT * FROM missions WHERE user_id = ?1 ORDER BY date DESC LIMIT 10", [currentUser.actorId]);
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

async function verifyMission(missionId, title) {
  openSheet('운동 인증', `
    <div class="space-y-4">
      <div class="flex gap-2">
        <button id="takePhoto" class="btn flex-1 bg-slate-700 text-white font-bold py-3 rounded-xl">📷 사진 찍기</button>
        <button id="skipPhoto" class="btn flex-1 bg-slate-800 text-white font-bold py-3 rounded-xl">건너뛰기</button>
      </div>
      <div id="photoPreview" class="hidden">
        <img id="previewImg" class="w-full rounded-xl border border-slate-600" />
      </div>
      <textarea id="vMemo" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="오늘의 운동을 기록해주세요"></textarea>
      <button id="vSubmit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">인증 완료!</button>
    </div>
  `);
  
  let photoDataUrl = null;
  $('#takePhoto').onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream; video.play();
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      setTimeout(() => {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 640, 480);
        stream.getTracks().forEach(t => t.stop());
        photoDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        $('#previewImg').src = photoDataUrl;
        $('#photoPreview').classList.remove('hidden');
        showToast('사진 촬영 완료!');
      }, 500);
    } catch (e) { showToast('카메라 오류: ' + e.message); }
  };
  $('#skipPhoto').onclick = () => { photoDataUrl = null; $('#photoPreview').classList.add('hidden'); };
  $('#vSubmit').onclick = async () => {
    const memo = $('#vMemo').value.trim() || '';
    const date = todayStr();
    await sync.mutate('missions', { id: missionId, status: 'done', verified_at_ms: ms(), updated_at_ms: ms() });
    await sync.mutate('verifications', { id: `${currentUser.actorId}:${missionId}`, verify_scope: 'live', group_id: 'main', user_id: currentUser.actorId, mission_id, mission_title: title, mission_kind: 'daily', date, memo, photo: photoDataUrl, updated_at_ms: ms() });
    await sync.mutate('feed_items', { id: `feed_${missionId}`, public_id: 'main', user_id: currentUser.actorId, user_name: currentUser.name, avatar: currentUser.avatar, mission_title: title, memo, photo: photoDataUrl, updated_at_ms: ms() });
    const newPts = await awardPoints(10, 'daily_mission');
    const st = await updateStreak();
    await updateRanking();
    closeSheet();
    showPointsFly(window.innerWidth/2, window.innerHeight/2, `+10 P 🔥`);
    showToast(`인증 완료! ${newPts} P (스트릭: ${st.current}일)`);
    await renderMission();
    await updateHeader();
  };
}

// ============ 탭: 피드 ============
async function renderFeed() {
  const feed = await sync.query("SELECT * FROM feed_items ORDER BY updated_at_ms DESC LIMIT 30");
  main.innerHTML = feed.length ? feed.map(f => cardFeed(f)).join('') : '<p class="text-slate-400 text-sm mt-8 text-center">아직 피드가 없어요</p>';
}

function cardFeed(f) {
  return `
    <div class="card bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xl">${f.avatar}</span>
        <span class="font-bold text-slate-200 text-sm">${f.user_name}</span>
        <span class="text-[10px] text-slate-500 ml-auto">${new Date(f.updated_at_ms).toLocaleDateString()}</span>
      </div>
      <div class="font-extrabold text-slate-100 mb-1">${f.mission_title}</div>
      ${f.memo ? `<p class="text-sm text-slate-300 mb-2">${f.memo}</p>` : ''}
      ${f.photo ? `<img src="${f.photo}" class="w-full rounded-xl mb-2 border border-slate-600" />` : ''}
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
  const exists = await sync.query("SELECT 1 FROM cheers WHERE id = ?1", [id]);
  if (exists.length > 0) return showToast('이미 응원했어요');
  await sync.mutate('cheers', { id, public_id: 'main', feed_id: feedId, user_id: currentUser.actorId, cheer_type: type, updated_at_ms: ms() });
  await awardPoints(1, 'cheer');
  await updateHeader();
  showToast('응원 완료! +1 P');
}

// ============ 탭: 프로필 ============
async function renderProfile() {
  const badges = await sync.query("SELECT * FROM badges WHERE user_id = ?1", [currentUser.actorId]);
  const st = await getStreak();
  const pts = await getPoints();
  const rank = await getRank();
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
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl px-4 py-3">
          <div class="text-[10px] text-slate-400">랭킹</div>
          <div class="text-lg font-black text-emerald-300">${rank}위</div>
        </div>
      </div>
      <h3 class="text-lg font-extrabold mt-6 mb-3 text-slate-200">🏆 배지</h3>
      ${badges.length ? `<div class="flex flex-wrap justify-center gap-2">${badges.map(b => `<span class="chip bg-slate-800 border border-slate-600">${b.badge_name}</span>`).join('')}</div>` : '<p class="text-slate-400 text-sm">아직 획득한 배지가 없어요</p>'}
    </div>
  `;
}

// ============ 탭: 랭킹 ============
async function renderRank() {
  const ranks = await sync.query("SELECT r.*, u.display_name, u.avatar FROM rankings r JOIN user_profiles u ON r.user_id = u.id WHERE r.group_id = 'main' ORDER BY r.total_points DESC LIMIT 20");
  main.innerHTML = `
    <div class="fade-in">
      <h3 class="text-lg font-extrabold mb-4 text-slate-200">🏅 전체 랭킹</h3>
      ${ranks.map((r, i) => `
        <div class="card bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-3 flex items-center gap-3">
          <span class="text-2xl font-black ${i < 3 ? 'text-amber-400' : 'text-slate-500'}">${i + 1}</span>
          <span class="text-xl">${r.avatar}</span>
          <span class="font-bold text-slate-200 flex-1">${r.display_name}</span>
          <span class="text-amber-300 font-black">${r.total_points} P</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ============ 모집글 쓰기 ============
async function openRecruitSheet() {
  openSheet('메이트 모집글 쓰기', `
    <form id="recruitForm" class="space-y-3">
      <div><label class="block text-xs font-bold text-slate-400 mb-1">운동 종류 (최대 3 개)</label>
        <div class="flex flex-wrap gap-2" id="typeChips">${['러닝','걷기','헬스','홈트','자전거','요가','수영','등산'].map(t => `<button type="button" class="chip bg-slate-900 border border-slate-600 type-chip">${t}</button>`).join('')}</div>
        <input type="hidden" id="types" value="[]"></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">방식</label><select id="mode" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold"><option>온라인</option><option>오프라인</option></select></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">지역</label><input id="region" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="예: 서울 강남구"></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">요일</label><div class="flex justify-between" id="dayChips">${['일','월','화','수','목','금','토'].map((d,i)=>`<button type="button" class="chip bg-slate-900 border border-slate-600 day-chip" data-i="${i}">${d}</button>`).join('')}</div><input type="hidden" id="days" value="[]"></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">시간대</label><input id="timeSlot" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="예: 아침 7 시"></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">정원</label><input id="capacity" type="number" min="1" max="6" value="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold"></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">한마디</label><textarea id="intro" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="어떤 메이트를 찾나요?"></textarea></div>
      <div><label class="block text-xs font-bold text-slate-400 mb-1">마감일</label><input id="deadline" type="date" value="${todayStr()}" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold"></div>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">올리기</button>
    </form>
  `);
  const selectedTypes = [], selectedDays = [];
  sheetBody.querySelectorAll('.type-chip').forEach(btn => {
    btn.onclick = () => {
      const t = btn.textContent, idx = selectedTypes.indexOf(t);
      if (idx >= 0) { selectedTypes.splice(idx,1); btn.classList.remove('bg-orange-500','text-white'); btn.classList.add('bg-slate-900'); }
      else { if (selectedTypes.length >= 3) return showToast('최대 3 개'); selectedTypes.push(t); btn.classList.remove('bg-slate-900'); btn.classList.add('bg-orange-500','text-white'); }
      $('#types').value = JSON.stringify(selectedTypes);
    };
  });
  sheetBody.querySelectorAll('.day-chip').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i, idx = selectedDays.indexOf(i);
      if (idx >= 0) { selectedDays.splice(idx,1); btn.classList.remove('bg-amber-500','text-white'); btn.classList.add('bg-slate-900'); }
      else { selectedDays.push(i); btn.classList.remove('bg-slate-900'); btn.classList.add('bg-amber-500','text-white'); }
      $('#days').value = JSON.stringify(selectedDays);
    };
  });
  $('#recruitForm').onsubmit = async (e) => {
    e.preventDefault();
    const types = JSON.parse($('#types').value), days = JSON.parse($('#days').value);
    if (!types.length) return showToast('운동 종류를 선택해줘요');
    if (!days.length) return showToast('요일을 선택해줘요');
    const region = $('#region').value.trim(), timeSlot = $('#timeSlot').value.trim(), capacity = parseInt($('#capacity').value), intro = $('#intro').value.trim(), deadline = $('#deadline').value, mode = $('#mode').value;
    const postId = 'post_'+crypto.randomUUID().slice(0,8);
    await sync.mutate('posts', { id: postId, public_id: 'main', author_id: currentUser.actorId, author_name: currentUser.name, author_avatar: currentUser.avatar, types: JSON.stringify(types), mode, region, days: JSON.stringify(days), time_slot: timeSlot, capacity, intro, deadline, updated_at_ms: ms() });
    await sync.mutate('feed_items', { id: 'feed_'+postId, public_id: 'main', user_id: currentUser.actorId, user_name: currentUser.name, avatar: currentUser.avatar, mission_title: `메이트 모집: ${types.join(', ')}`, memo: intro, photo: null, updated_at_ms: ms() });
    closeSheet(); showToast('모집글 등록 완료!'); await renderRecruit();
  };
}

// ============ 미션 추가 ============
async function openMissionSheet() {
  openSheet('미션 추가', `
    <form id="missionForm" class="space-y-3">
      <input id="mTitle" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="미션 제목">
      <input id="mGoal" type="number" min="1" value="1" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold" placeholder="목표 횟수">
      <select id="mKind" class="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white font-bold"><option value="daily">일일 미션</option><option value="weekly">주간 미션</option></select>
      <button type="submit" class="btn w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white font-extrabold py-3.5 rounded-2xl">추가</button>
    </form>
  `);
  $('#missionForm').onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#mTitle').value.trim(), goal = parseInt($('#mGoal').value), kind = $('#mKind').value;
    if (!title) return showToast('제목을 입력해줘요');
    await sync.mutate('missions', { id: `${currentUser.actorId}:${todayStr()}:${kind}`, user_id: currentUser.actorId, kind, date: todayStr(), title, goal, status: 'pending', updated_at_ms: ms() });
    closeSheet(); showToast('미션 추가 완료!'); await renderMission();
  };
}

// ============ 시트 닫기 ============
$('#sheetClose').onclick = closeSheet;
sheetMask.onclick = closeSheet;

// ============ 전역 함수 ============
window.openRecruitSheet = openRecruitSheet;
window.openMissionSheet = openMissionSheet;

// ============ 시작 ============
init();