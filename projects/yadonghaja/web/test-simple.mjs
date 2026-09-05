/**
 * yadonghaja v2.2 — 간단한 동기화 확인 테스트
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8788';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 yadonghaja v2.2 — 간단한 동기화 확인\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`[PAGE ERROR] ${err.message}`);
  });
  
  try {
    console.log('📝 온보딩 중...');
    await page.goto(BASE_URL);
    await sleep(2000);
    
    const onboardVisible = await page.isVisible('#onboard');
    console.log(`온보딩 화면 표시 중: ${onboardVisible}`);
    
    if (onboardVisible) {
      console.log('🔘 온보딩 시작 버튼 클릭...');
      await page.click('#obStart');
      
      // 30 초 대기하며 로그 확인
      console.log('⏳ 30 초 대기 중 (Syncular 초기화)...');
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const stillVisible = await page.isVisible('#onboard');
        if (!stillVisible) {
          console.log(`✅ 온보딩 완료 (${i+1}초 후)`);
          break;
        }
        if (i % 5 === 4) {
          console.log(`  ... ${i+1}초 경과`);
        }
      }
    }
    
    console.log('\n📊 현재 상태 확인...');
    const tabs = await page.$$('[data-tab]');
    console.log(`탭 수: ${tabs.length}`);
    
  } catch (e) {
    console.error('❌ 오류:', e.message);
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
