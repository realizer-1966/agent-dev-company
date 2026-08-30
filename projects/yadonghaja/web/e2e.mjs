/**
 * yadonghaja v2.1 E2E — Syncular 연동 + 사진 인증 + 보상 시스템
 * 단순 플로우: 온보딩 → 홈 탭 렌더링 → 탭 전환
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8788';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🚀 yadonghaja v2.1 E2E — Syncular + 보상 시스템');

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
    await sleep(3000);  // Syncular 초기화 대기
    console.log('✅ 온보딩 완료');

    // ===== 홈 탭 확인 =====
    console.log('🏠 홈 탭...');
    await sleep(1000);
    const homeText = await page.textContent('main');
    if (!homeText.includes('오늘의 미션')) {
      throw new Error('홈 탭에 미션이 없음');
    }
    console.log('✅ 홈 탭 렌더링됨');

    // ===== 모집 탭 =====
    console.log('📋 모집 탭...');
    await page.click('[data-tab="recruit"]');
    await sleep(500);
    const recruitText = await page.textContent('main');
    if (!recruitText.includes('아직 모집글이 없어요')) {
      throw new Error('모집 탭 이상함');
    }
    console.log('✅ 모집 탭 렌더링됨');

    // ===== 미션 탭 =====
    console.log('🎯 미션 탭...');
    await page.click('[data-tab="mission"]');
    await sleep(500);
    const missionText = await page.textContent('main');
    if (!missionText.includes('첫 운동 인증')) {
      throw new Error('미션 탭에 첫 미션이 없음');
    }
    console.log('✅ 미션 탭 렌더링됨');

    // ===== 피드 탭 =====
    console.log('📰 피드 탭...');
    await page.click('[data-tab="feed"]');
    await sleep(500);
    console.log('✅ 피드 탭 렌더링됨');

    // ===== 프로필 탭 =====
    console.log('👤 프로필 탭...');
    await page.click('[data-tab="profile"]');
    await sleep(500);
    const profileText = await page.textContent('main');
    if (!profileText.includes('테스트유저')) {
      throw new Error('프로필에 이름이 없음');
    }
    console.log('✅ 프로필 탭 렌더링됨');

    console.log('\n🎉 E2E 통과 — 모든 탭 정상!');
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