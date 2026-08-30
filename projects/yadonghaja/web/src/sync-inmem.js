/**
 * yadonghaja v2 — 인메모리 스토어 (E2E 테스트용)
 * Syncular 대신 간단한 인메모리 저장소로 동작.
 */

const store = {
  posts: [],
  feed_items: [],
  cheers: [],
  user_profiles: [],
  applications: [],
  group_members: [],
  verifications: [],
  missions: [],
  point_ledger: [],
  streaks: [],
  badges: [],
};

export function createInMemoryAdapter(actorId) {
  console.log('[inmem] adapter created for', actorId);
  
  return {
    subscribe(id, { table, scopes }) {
      console.log('[inmem] subscribe:', id, table);
    },
    onSyncStateChange(cb) {
      cb({ phase: 'connected' });
    },
    query(sql, params = []) {
      // 간단한 SELECT * FROM table WHERE user_id = ? 지원
      const match = sql.match(/FROM\s+(\w+)/i);
      if (!match) return [];
      const table = match[1];
      const rows = store[table] || [];
      if (params.length > 0 && sql.includes('user_id = ?1')) {
        return rows.filter(r => r.user_id === params[0]);
      }
      if (params.length > 0 && sql.includes('id = ?1')) {
        return rows.filter(r => r.id === params[0]);
      }
      return rows;
    },
    async mutate(table, row) {
      const rows = store[table] || (store[table] = []);
      const idx = rows.findIndex(r => r.id === row.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      console.log('[inmem] mutate:', table, row.id);
    },
    async syncUntilIdle() {
      console.log('[inmem] syncUntilIdle');
    },
    handle: {
      async syncUntilIdle() {
        console.log('[inmem] handle.syncUntilIdle');
      }
    }
  };
}