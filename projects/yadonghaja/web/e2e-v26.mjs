/**
 * yadonghaja v2.6 E2E — 원격 Syncular 서버 동기화 라운드 테스트
 */
import { startSyncWorker } from '@syncular/client/worker';
import { schema } from './src/schema.ts';

const ENDPOINT = 'https://yadonghaja-sync-v2.dydtnsp.workers.dev';
const ACTOR = 'e2e-user-' + Date.now().toString(36);

function httpSyncTransport(url, { headers } = {}) {
  return {
    url,
    async execute(body) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/vnd.syncular.sync.v2' },
        body,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      return new Uint8Array(await resp.arrayBuffer());
    },
  };
}

async function main() {
  console.log('=== v2.6 E2E: Syncular 실동기화 테스트 ===');
  console.log('actor:', ACTOR);
  console.log();

  const worker = await startSyncWorker({
    schema,
    database: { mode: 'memory' },
    clientId: ACTOR,
    endpoints: {
      syncUrl: `${ENDPOINT}/sync`,
      segmentsUrl: `${ENDPOINT}/segments`,
      blobsUrl: `${ENDPOINT}/blobs`,
    },
    createTransport: () => httpSyncTransport(`${ENDPOINT}/sync`, { headers: { 'x-user': ACTOR } }),
    multiTab: false,
    autoSync: true,
  });
  console.log('✅ startSyncWorker 부트 성공');
  const handle = worker;

  // 라운드: mutate → sync
  try {
    await handle.mutate([{ table: 'user_profiles', values: { id: ACTOR, public_id: 'main', display_name: 'E2E테스터', avatar: '🏃', created_at_ms: Date.now(), updated_at_ms: Date.now() } }]);
    console.log('✅ mutate: user_profiles upsert');

    await handle.startSync({});
    console.log('✅ startSync: 서버 라운드 완료 (거부 없음)');
  } catch (e) {
    console.log('❌ 동기화 실패:', e.message);
    process.exit(1);
  }

  // D1 에 실제로 들어갔는지 확인은 서버측에서
  console.log();
  console.log('🎉 E2E 통과 — 실제 Syncular 라운드 성공');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
