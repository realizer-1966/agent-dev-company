/**
 * yadonghaja v2.2 — 2 사용자 실시간 동기화 테스트
 * 
 * 사용법:
 * 1. npm run build
 * 2. node test-server.mjs (백그라운드)
 * 3. node test-sync-2users.mjs
 * 
 * 기대 동작:
 * - 사용자 A: 모집글 작성
 * - 사용자 B: 모집글 조회 (동기화 확인)
 * - 사용자 B: 응원 보내기
 * - 사용자 A: 응원 확인 (동기화 확인)
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8788';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 yadonghaja v2.2 — 2 사용자 동기화 테스트\n');
  
  const browser = await chromium.launch({ headless: true });
  
  // 사용자 A 컨텍스트
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  pageA.on('console', msg => {
    if (msg.text().includes('[sync]')) {
      console.log(`[A] ${msg.text()}`);
    }
  });
  
  // 사용자 B 컨텍스트
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on('console', msg => {
    if (msg.text().includes('[sync]')) {
      console.log(`[B] ${msg.text()}`);
    }
  });
  
  try {
    // ===== 사용자 A: 온보딩 및 모집글 작성 =====
    console.log('📝 [A] 온보딩 중...');
    await pageA.goto(BASE_URL);
    await pageA.click('#obStart');
    await pageA.waitForSelector('#onboard', { state: 'hidden', timeout: 20000 });
    await sleep(5000);  // Syncular 초기화 대기
    console.log('✅ [A] 온보딩 완료\n');
    
    // 모집글 작성
    console.log('📋 [A] 모집글 작성 중...');
    await pageA.click('[data-tab="recruit"]');
    await sleep(1000);
    await pageA.click('#writePost');
    await pageA.fill('#postTypes', '헬스');
    await pageA.fill('#postMode', '오프라인');
    await pageA.fill('#postRegion', '서울');
    await pageA.fill('#postDays', '["월","수","금"]');
    await pageA.fill('#postTimeSlot', '저녁');
    await pageA.fill('#postCapacity', '4');
    await pageA.fill('#postIntro', '함께 운동할 메이트 구합니다!');
    await pageA.fill('#postDeadline', '2026-12-31');
    await pageA.click('#submitPost');
    await sleep(2000);
    console.log('✅ [A] 모집글 작성 완료\n');
    
    // ===== 사용자 B: 온보딩 및 모집글 조회 =====
    console.log('📝 [B] 온보딩 중...');
    await pageB.goto(BASE_URL);
    await pageB.click('#obStart');
    await pageB.waitForSelector('#onboard', { state: 'hidden', timeout: 20000 });
    await sleep(5000);  // Syncular 초기화 대기
    console.log('✅ [B] 온보딩 완료\n');
    
    console.log('📋 [B] 모집글 조회 중...');
    await pageB.click('[data-tab="recruit"]');
    await sleep(2000);
    
    const postsB = await pageB.$$eval('.post-card', cards => cards.length);
    console.log(`📊 [B] 조회된 모집글 수: ${postsB}`);
    
    if (postsB === 0) {
      console.log('❌ 동기화 실패 — 사용자 B 가 모집글을 볼 수 없습니다');
      return false;
    }
    console.log('✅ [B] 모집글 동기화 성공!\n');
    
    // ===== 사용자 B: 응원 보내기 =====
    console.log('💪 [B] 응원 보내기 중...');
    await pageB.click('.post-card:first-child');
    await sleep(1000);
    await pageB.click('[data-action="cheer"]');
    await sleep(2000);
    console.log('✅ [B] 응원 완료\n');
    
    // ===== 사용자 A: 응원 확인 =====
    console.log('💪 [A] 응원 확인 중...');
    await pageA.click('[data-tab="recruit"]');
    await sleep(2000);
    await pageA.click('.post-card:first-child');
    await sleep(1000);
    
    const cheersA = await pageA.$$eval('.cheer-badge', badges => badges.length);
    console.log(`📊 [A] 확인된 응원 수: ${cheersA}`);
    
    if (cheersA === 0) {
      console.log('❌ 동기화 실패 — 사용자 A 가 응원을 볼 수 없습니다');
      return false;
    }
    console.log('✅ [A] 응원 동기화 성공!\n');
    
    console.log('🎉 2 사용자 동기화 테스트 통과!');
    return true;
    
  } catch (e) {
    console.error('❌ 테스트 실패:', e.message);
    return false;
  } finally {
    await browser.close();
  }
}

runTest()
  .then(success => process.exit(success ? 0 : 1))
  .catch(e => { console.error(e); process.exit(1); });
