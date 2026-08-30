/**
 * yadonghaja Syncular 어댑터 — Syncular 클라이언트 + 인메모리 fallback
 */

let useInMemory = true;  // Syncular 실패 시 fallback
let inMemoryStore = null;

export async function createSyncAdapter(actorId, baseUrl = 'http://127.0.0.1:8788') {
  // 인메모리 스토어 초기화
  inMemoryStore = {
    posts: [], feed_items: [], cheers: [], user_profiles: [],
    applications: [], verifications: [], missions: [], badges: [],
    streaks: [], point_ledger: [], rankings: [],
  };
  
  // Syncular 시도 (실패하면 인메모리로)
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    let handle = null;
    let messageId = 0;
    const pending = new Map();
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Syncular timeout')), 5000);
      
      worker.onmessage = (event) => {
        const { type, id, rows, state } = event.data;
        if (type === 'worker-ready') {
          handle = { worker, pending, nextId: () => `m_${++messageId}` };
          clearTimeout(timeout);
          resolve();
        }
      };
      
      worker.postMessage({
        type: 'worker-init',
        config: { actorId, baseUrl },
      });
    });
    
    console.log('[sync] Syncular 연결됨');
    useInMemory = false;
    
    return {
      async mutate(table, row) {
        const id = handle.nextId();
        return new Promise((resolve, reject) => {
          handle.pending.set(id, resolve);
          handle.worker.postMessage({ type: 'mutate', id, config: { table, row } });
          setTimeout(() => { handle.pending.delete(id); reject(new Error('timeout')); }, 5000);
        });
      },
      async query(sql, params = []) {
        const id = handle.nextId();
        return new Promise((resolve, reject) => {
          handle.pending.set(id, resolve);
          handle.worker.postMessage({ type: 'query', id, config: { sql, params } });
          setTimeout(() => { handle.pending.delete(id); reject(new Error('timeout')); }, 5000);
        });
      },
      subscribe(subscriptionId, spec) {
        handle.worker.postMessage({ type: 'subscribe', config: { subscriptionId, spec } });
      },
      async getSyncState() {
        const id = handle.nextId();
        return new Promise((resolve, reject) => {
          handle.pending.set(id, resolve);
          handle.worker.postMessage({ type: 'get-sync-state', id });
          setTimeout(() => { handle.pending.delete(id); resolve({ phase: 'connected' }); }, 5000);
        });
      },
      onSyncStateChange(callback) {
        const interval = setInterval(async () => {
          try { callback(await this.getSyncState()); } catch (e) {}
        }, 5000);
        return () => clearInterval(interval);
      },
    };
  } catch (e) {
    console.warn('[sync] Syncular 실패 — 인메모리 모드:', e.message);
  }
  
  // 인메모리 fallback
  console.log('[sync] 인메모리 스토어 사용');
  return {
    async mutate(table, row) {
      if (!inMemoryStore[table]) inMemoryStore[table] = [];
      const idx = inMemoryStore[table].findIndex(r => r.id === row.id);
      if (idx >= 0) inMemoryStore[table][idx] = row;
      else inMemoryStore[table].push(row);
    },
    async query(sql, params = []) {
      // 간단한 SELECT * FROM table WHERE ... 처리
      const match = sql.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
      if (!match) return [];
      const table = match[1];
      const where = match[2];
      let rows = inMemoryStore[table] || [];
      
      if (where) {
        const cond = where.match(/(\w+)\s*=\s*\?(\d+)/i);
        if (cond) {
          const col = cond[1];
          const idx = parseInt(cond[2]) - 1;
          const val = params[idx];
          rows = rows.filter(r => r[col] === val);
        }
      }
      
      return rows;
    },
    subscribe() {},
    async getSyncState() { return { phase: 'connected' }; },
    onSyncStateChange() { return () => {}; },
  };
}
