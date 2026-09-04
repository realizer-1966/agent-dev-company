/**
 * yadonghaja Syncular 어댑터 — 표준 createSyncClientHandle API 사용
 */
import { createSyncClientHandle } from '@syncular/client';
import { schema } from './schema.ts';

let inMemoryStore = null;

export async function createSyncAdapter(actorId, baseUrl = 'http://127.0.0.1:8788') {
  // 인메모리 스토어 초기화 (fallback 용)
  inMemoryStore = {
    posts: [], feed_items: [], cheers: [], user_profiles: [],
    applications: [], verifications: [], missions: [], badges: [],
    streaks: [], point_ledger: [], rankings: [],
  };

  console.log('[sync] Syncular 연결 시도...', { actorId, baseUrl });

  try {
    const handle = await createSyncClientHandle({
      worker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
      schema,
      database: { mode: 'persistent', name: 'yadonghaja' },
      clientId: actorId,
      endpoints: {
        syncUrl: `${baseUrl}/sync`,
        segmentsUrl: `${baseUrl}/segments`,
        blobsUrl: `${baseUrl}/blobs`,
      },
      multiTab: false,
      autoSync: true,
    });

    console.log('[sync] handle 생성됨:', {
      hasHandle: !!handle,
      role: handle?.role,
      clientId: handle?.clientId,
      methods: Object.keys(handle || {}),
    });

    if (!handle || typeof handle.mutate !== 'function') {
      throw new Error('handle 이 유효하지 않음');
    }

    console.log('[sync] Syncular 연결 성공 (leader:', handle.role + ')');

    return {
      async mutate(table, row) {
        console.log('[sync] mutate:', table, row.id);
        // Syncular 는 { table, values } 형식을 사용
        await handle.mutate([{ table, values: row }]);
      },
      async query(sql, params = []) {
        console.log('[sync] query:', sql, params);
        const result = await handle.query(sql, params);
        console.log('[sync] query result:', result?.length, 'rows');
        return result;
      },
      subscribe() {},
      async getSyncState() { 
        const state = await handle.syncState?.() || { phase: 'connected' };
        return state; 
      },
      onSyncStateChange() { return () => {}; },
    };
  } catch (e) {
    console.error('[sync] Syncular 실패:', e.message, e.stack);
    console.warn('[sync] 인메모리 모드로 fallback');
  }

  // 인메모리 fallback
  return {
    async mutate(table, row) {
      if (!inMemoryStore[table]) inMemoryStore[table] = [];
      const idx = inMemoryStore[table].findIndex(r => r.id === row.id);
      if (idx >= 0) inMemoryStore[table][idx] = row;
      else inMemoryStore[table].push(row);
    },
    async query(sql, params = []) {
      const match = sql.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
      if (!match) return [];
      const table = match[1];
      let rows = inMemoryStore[table] || [];
      if (match[2] && params.length > 0) {
        const cond = match[2].match(/(\w+)\s*=\s*\?(\d+)/i);
        if (cond) {
          const col = cond[1], idx = parseInt(cond[2]) - 1;
          rows = rows.filter(r => r[col] === params[idx]);
        }
      }
      return rows;
    },
    subscribe() {},
    async getSyncState() { return { phase: 'connected' }; },
    onSyncStateChange() { return () => {}; },
  };
}
