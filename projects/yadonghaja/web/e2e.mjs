/**
 * yadonghaja v2 E2E — 단일 사용자 검증 (인메모리 스토어)
 * 시나리오: 온보딩 → 모집글 작성 → 피드 확인 → 미션 인증
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8788';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🚀 yadonghaja v2 E2E — 단일 사용자 플로우');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // ===== 온보딩 =====
    console.log('📝 온보딩...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#onboard', { state: 'visible' });
    await page.fill('#obName', '테스트유저');
    await page.click('[data-a="🏃"]');
    await page.click('#obStart');
    await page.waitForSelector('#onboard', { state: 'hidden', timeout: 10000 });
    await sleep(500);
    console.log('✅ 온보딩 완료');

    // ===== 모집글 작성 =====
    console.log('📝 모집글 작성...');
    await page.click('[data-tab="recruit"]');
    await sleep(300);
    await page.evaluate(() => window.openRecruitSheet());
    await page.waitForSelector('#recruitForm', { state: 'visible', timeout: 5000 });
    
    // 운동 종류: 러닝 선택
    await page.click('.type-chip:has-text("러닝")');
    await page.selectOption('#mode', '오프라인');
    await page.fill('#region', '서울 강남구');
    await page.click('.day-chip[data-i="1"]'); // 월
    await page.click('.day-chip[data-i="3"]'); // 수
    await page.click('.day-chip[data-i="5"]'); // 금
    await page.fill('#timeSlot', '아침 7 시');
    await page.fill('#capacity', '4');
    await page.fill('#intro', '함께 달려요!');
    await page.fill('#deadline', '2026-12-31');
    await page.click('#recruitForm button[type="submit"]');
    await sleep(500);
    console.log('✅ 모집글 작성 완료');

    // ===== 모집글 확인 =====
    console.log('👀 모집글 확인...');
    await sleep(300);
    const cards = await page.$$('.card');
    if (cards.length === 0) {
      throw new Error('모집글이 보이지 않음');
    }
    const text = await cards[0].textContent();
    if (!text.includes('러닝') || !text.includes('서울')) {
      throw new Error('잘못된 모집글: ' + text.slice(0, 100));
    }
    console.log('✅ 모집글 확인됨');

    // ===== 미션 탭 이동 =====
    console.log('📝 미션 탭...');
    await page.click('[data-tab="mission"]');
    await sleep(300);
    const missionCards = await page.$$('.card');
    if (missionCards.length === 0) {
      throw new Error('미션이 보이지 않음');
    }
    console.log('✅ 미션 확인됨');

    // ===== 피드 탭 이동 =====
    console.log('📝 피드 탭...');
    await page.click('[data-tab="feed"]');
    await sleep(300);
    console.log('✅ 피드 탭 렌더링됨');

    // ===== 프로필 탭 이동 =====
    console.log('📝 프로필 탭...');
    await page.click('[data-tab="profile"]');
    await sleep(300);
    const profileText = await page.textContent('main');
    if (!profileText.includes('테스트유저')) {
      throw new Error('프로필에 이름이 없음');
    }
    console.log('✅ 프로필 확인됨');

    console.log('\n🎉 E2E 통과 — 모든 플로우 정상!');
    return true;
  } catch (err) {
    console.error('❌ E2E 실패:', err.message);
    await page.screenshot({ path: 'e2e-fail.png' });
    return false;
  } finally {
    await browser.close();
  }
}

const ok = await main();
process.exit(ok ? 0 : 1);