/**
 * yadonghaja sync 워커 — Syncular 클라이언트 (OPFS + 아웃박스)
 */
import { startSyncWorker } from '@syncular/client/worker';
// wasm-database 는 external — dist 에서 직접 로드
let sqlite3InitModule = null;

// HTTP transport 인라인 구현
function httpSyncTransport(url, { headers } = {}) {
  return {
    url,
    async execute(body) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/cbor' },
        body,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return new Uint8Array(await resp.arrayBuffer());
    },
  };
}

function httpSegmentDownloader({ headers } = {}) {
  return async (url) => {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  };
}

function httpBlobStore(url, { headers } = {}) {
  return {
    async put(key, data) {
      const fullUrl = `${url}/${key}`;
      const resp = await fetch(fullUrl, {
        method: 'PUT',
        headers,
        body: data,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return fullUrl;
    },
    async get(key) {
      const fullUrl = `${url}/${key}`;
      const resp = await fetch(fullUrl, { headers });
      if (!resp.ok) return null;
      return new Uint8Array(await resp.arrayBuffer());
    },
  };
}

let handle = null;

self.onmessage = async (event) => {
  const { type, config } = event.data;
  
  if (type === 'worker-init') {
    const { actorId, baseUrl } = config;
    
    // sqlite-wasm 초기화
    await sqlite3InitModule({ print: console.log, printErr: console.error });
    
    // Syncular 클라이언트 핸들 생성
    handle = await startSyncWorker({
      sqlite3js: '/vendor/sqlite-wasm/index.mjs',
      sqlite3Wasm: '/vendor/sqlite-wasm/sqlite3.wasm',
      sqlite3WasmAsyncProxy: '/vendor/sqlite-wasm/sqlite3-opfs-async-proxy.js',
      createTransport: (syncUrl) => httpSyncTransport(syncUrl, {
        headers: { 'x-user': actorId },
      }),
      createSegmentDownloader: () => httpSegmentDownloader({
        headers: { 'x-user': actorId },
      }),
      createBlobStore: (blobsUrl) => httpBlobStore(blobsUrl, {
        headers: { 'x-user': actorId },
      }),
    });
    
    // Sync 시작
    await handle.startSync({
      syncUrl: `${baseUrl}/sync`,
      segmentsUrl: `${baseUrl}/segments`,
      blobsUrl: `${baseUrl}/blobs`,
      scopes: {
        public_id: ['main'],
        group_id: [],
        user_id: [actorId],
        apply_scope: ['open'],
        verify_scope: ['live'],
      },
    });
    
    console.log('[worker] Sync started for', actorId);
  } else if (type === 'mutate' && handle) {
    const { table, row } = config;
    await handle.mutate(table, row);
    event.source.postMessage({ type: 'mutate-ok' });
  } else if (type === 'query' && handle) {
    const { sql, params } = config;
    const rows = await handle.query(sql, params);
    event.source.postMessage({ type: 'query-result', rows });
  } else if (type === 'subscribe' && handle) {
    const { subscriptionId, spec } = config;
    handle.subscribe(subscriptionId, spec);
  } else if (type === 'get-sync-state' && handle) {
    const state = await handle.getSyncState();
    event.source.postMessage({ type: 'sync-state', state });
  }
};
