/**
 * yadonghaja sync 어댑터 — Syncular 웹클라이언트 핸들을 v1 API(mutate/query/구독)로 래핑.
 *
 * 사용법:
 *   const sync = await createSyncAdapter({ actorId, endpoints });
 *   await sync.mutate('posts', { ... });
 *   const rows = await sync.query('SELECT * FROM posts');
 *   sync.subscribe('public', { table: 'posts', scopes: { public_id: ['main'] } });
 */
import { createSyncClientHandle, installRealtimeSupervisor, browserConnectivitySignal, documentLifecycleSignal } from '@syncular/client';
import { schema } from '../../sync-server/src/syncular.generated.ts';

/**
 * @param {{ actorId: string, endpoints: { syncUrl: string, segmentsUrl: string, blobsUrl?: string } }} opts
 */
export async function createSyncAdapter(opts) {
  const { actorId, endpoints } = opts;

  // 워커 핸들 생성 — persistent OPFS, multi-tab 공유
  const handle = await createSyncClientHandle({
    worker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    schema,
    database: { mode: 'persistent', name: 'yadonghaja' },
    endpoints,
    // actorId 를 worker config 로 전달 (worker.js 가 config.actorId 읽음)
    // createSyncClientHandle 는 임의 필드를 worker 에게 전달한다
    actorId,
    multiTab: true, // 동일 origin 탭은 단일 코어 공유
  });

  // realtime supervisor 설치 — 연결 상태 UI 에 활용
  installRealtimeSupervisor(handle, {
    connectivity: browserConnectivitySignal(),
    lifecycle: documentLifecycleSignal(),
  });

  // 리더십 변화 감지 (UI 에 동기화 상태 표시)
  const onSyncStateChange = (cb) => {
    handle.onLeadershipChange?.(cb);
  };

  return {
    handle,

    /**
     * @param {string} table
     * @param {object} row
     * @param {string} [row.id] — 없으면 자동 생성
     */
    mutate: async (table, row) => {
      const id = row.id ?? (table.slice(0, 1) + '_' + crypto.randomUUID().slice(0, 8));
      const values = { ...row, id, updated_at_ms: Date.now() };
      handle.mutate([{ table, op: 'upsert', values }]);
      await handle.syncUntilIdle();
      return id;
    },

    /**
     * @param {string} table
     * @param {string} id
     * @param {object} patch
     */
    patch: async (table, id, patch) => {
      handle.mutate([{ table, op: 'upsert', values: { id, ...patch, updated_at_ms: Date.now() } }]);
      await handle.syncUntilIdle();
    },

    /**
     * @param {string} sql
     * @param {any[]} [params]
     */
    query: (sql, params = []) => {
      return handle.query(sql, params);
    },

    /**
     * @param {string} subId
     * @param {{ table: string, scopes: Record<string, string[]> }} spec
     */
    subscribe: (subId, spec) => {
      handle.subscribe({ id: subId, table: spec.table, scopes: spec.scopes });
      handle.syncUntilIdle();
    },

    /**
     * @param {string} table
     * @param {string} id
     */
    delete: async (table, id) => {
      handle.mutate([{ table, op: 'delete', values: { id } }]);
      await handle.syncUntilIdle();
    },

    /** 동기화 상태 */
    onSyncStateChange,

    /** 정지 */
    close: async () => {
      await handle.close();
    },
  };
}

/** 브라우저 저장소 영속성 요청 (OPFS 증발 방지) */
export async function requestPersistence() {
  if (navigator.storage?.persisted) {
    const persisted = await navigator.storage.persisted();
    if (persisted) return true;
  }
  if (navigator.storage?.persist) {
    return await navigator.storage.persist();
  }
  return false;
}

/** 현재 영속성 상태 */
export async function checkPersistence() {
  if (navigator.storage?.persisted) {
    return await navigator.storage.persisted();
  }
  return false;
}