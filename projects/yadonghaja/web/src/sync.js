/**
 * yadonghaja Syncular 어댑터 — 로컬에서는 인메모리, 프로덕션에서는 Syncular OPFS
 */
import { createSyncClientHandle } from '@syncular/client';
import { schema } from './schema.ts';

export async function createSyncAdapter(actorId, baseUrl = 'http://127.0.0.1:8788') {
  console.log('[sync] Syncular 연결 시도...', { actorId, baseUrl });

  // 로컬 테스트 환경에서는 즉시 인메모리 모드
  const isLocal = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');
  if (isLocal) {
    console.log('[sync] 로컬 환경 감지 — 인메모리 모드 사용');
    return createInMemoryAdapter(actorId);
  }

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

    console.log('[sync] Syncular 연결 성공 (role:', handle.role + ')');

    return {
      async mutate(table, row) {
        await handle.mutate([{ table, values: row }]);
      },
      async query(sql, params = []) {
        return await handle.query(sql, params);
      },
      subscribe() {},
      async getSyncState() {
        return await handle.syncState?.() || { phase: 'connected' };
      },
      onSyncStateChange() {
        return () => {};
      },
    };
  } catch (e) {
    console.warn('[sync] Syncular 실패 — 인메모리 모드:', e.message);
    return createInMemoryAdapter(actorId);
  }
}

function createInMemoryAdapter(actorId) {
  const store = {
    posts: [], feed_items: [], cheers: [], user_profiles: [],
    applications: [], verifications: [], missions: [], badges: [],
    streaks: [], point_ledger: [], rankings: [],
  };

  return {
    async mutate(table, row) {
      if (!store[table]) store[table] = [];
      const idx = store[table].findIndex(r => r.id === row.id);
      if (idx >= 0) store[table][idx] = row;
      else store[table].push(row);
    },
    async query(sql, params = []) {
      const match = sql.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+))?(?:\s+ORDER BY.+)?(?:\s+LIMIT.+)?/i);
      if (!match) return [];
      const tableName = match[1];
      let rows = [...(store[tableName] || [])];

      // WHERE 절 처리
      if (params.length > 0) {
        const param = params[0];
        if (sql.includes('user_id = ?')) rows = rows.filter(r => r.user_id === param);
        if (sql.includes('group_id = ?')) rows = rows.filter(r => r.group_id === param);
      }

      // ORDER BY 처리
      const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
      if (orderMatch) {
        const col = orderMatch[1];
        const desc = orderMatch[2]?.toUpperCase() === 'DESC';
        rows.sort((a, b) => desc ? (b[col]||0) - (a[col]||0) : (a[col]||0) - (b[col]||0));
      }

      // LIMIT 처리
      const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) rows = rows.slice(0, parseInt(limitMatch[1]));

      return rows;
    },
    subscribe() {},
    async getSyncState() { return { phase: 'local-only' }; },
    onSyncStateChange() { return () => {}; },
  };
}
