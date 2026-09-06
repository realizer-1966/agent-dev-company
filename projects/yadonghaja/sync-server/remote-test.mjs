/**
 * 원격 배포된 yadonghaja-sync 수렴 테스트
 * @syncular/client 로 실제 SSP2 프로토콜 요청을 만들어 검증한다.
 */
import { createSyncularClient } from '@syncular/client';

const ENDPOINT = 'https://yadonghaja-sync.dydtnsp.workers.dev';
const HMAC_KEY = process.env.SYNC_HMAC_KEY;

if (!HMAC_KEY) {
  console.error('SYNC_HMAC_KEY 환경변수 필요');
  process.exit(1);
}

// 서버의 authenticate 와 동일한 HMAC 토큰 생성
async function makeToken(uid) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = b64url(JSON.stringify({ uid, iat: Date.now() }));
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return payload + '.' + b64url(String.fromCharCode(...new Uint8Array(sig)));
}
function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const results = [];
  const log = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 1. 토큰 발급
  const token = await makeToken('remote-test-user');
  log('HMAC 토큰 생성', !!token);

  // 2. 클라이언트 생성 및 부트스트랩
  try {
    const client = await createSyncularClient({
      serverUrl: ENDPOINT,
      auth: { getAccessToken: async () => token },
      clientId: 'remote-test-' + Date.now(),
      actorId: 'remote-test-user',
    });
    log('클라이언트 생성', true);

    // 3. 스키마 테이블 확인 (동기화 시작)
    const start = await client.startSync({}).catch(e => ({ error: e }));
    if (start && !start.error) {
      log('동기화 시작', true);
    } else {
      log('동기화 시작', false, String(start.error || start).slice(0, 150));
    }
  } catch (e) {
    log('클라이언트 접속', false, String(e).slice(0, 200));
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} 통과`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
