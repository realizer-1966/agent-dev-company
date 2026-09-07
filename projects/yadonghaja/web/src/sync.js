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
      database: { mode: 'persistent', name: 'yadonghaja-v2' },  // 구 스키마 DB 회피 — 신규 이름
      clientId: actorId,
      endpoints: {
        syncUrl: `${baseUrl}/sync`,
        segmentsUrl: `${baseUrl}/segments`,
        blobsUrl: `${baseUrl}/blobs`,
        realtimeUrl: `${baseUrl.replace(/^http/, 'ws')}/realtime`,
      },
      multiTab: false,
      autoSync: true,
    });

    console.log('[sync] Syncular 연결 성공 (role:', handle.role + ')');

    // 구독 상태 — 테이블별 스코프 (앱 전체에서 사용)
    let onChangeCb = null;

    return {
      handle,  // 원격 blob 업로드 등 직접 접근용
      async mutate(table, row) {
        await handle.mutate([{ table, values: row }]);
      },
      async query(sql, params = []) {
        return await handle.query(sql, params);
      },
      async subscribe(input) {
        await handle.subscribe(input);
      },
      async unsubscribe(id) {
        await handle.unsubscribe(id);
      },
      // 로컬 DB 변경 통지 (실시간 델타 → UI 갱신)
      onLocalChange(cb) {
        onChangeCb = cb;
        handle.onChange?.((batch) => cb(batch));
      },
      // blob 바이트 업로드 → canonical blob_ref JSON 문자열 (§5.9.1) 반환
      async putBlob(bytes, mediaType) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        const blobId = `sha256:${hex}`;
        const url = `${baseUrl}/blobs/${encodeURIComponent(blobId)}`;
        const resp = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': mediaType || 'image/jpeg', 'x-user': actorId },
          body: bytes,
        });
        if (!resp.ok) throw new Error(`blob upload 실패: HTTP ${resp.status}`);
        // §5.9.1 canonical: {"blobId","byteLength","mediaType"} 키 순서 고정
        const ref = { blobId, byteLength: bytes.length };
        if (mediaType) ref.mediaType = mediaType;
        return JSON.stringify(ref);
      },
      async fetchBlob(blobIdOrRef) {
        return await handle.fetchBlob(blobIdOrRef);
      },
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
