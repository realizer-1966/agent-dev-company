/**
 * yadonghaja sync 워커 — Syncular 클라이언트 (OPFS + 아웃박스)
 * startSyncWorker()가 표준 {t:'init'}/{t:'call'} 프로토콜로 초기화·RPC 처리.
 * 이 파일은 startSyncWorker()를 호출하기만 하면 된다.
 */
import { startSyncWorker } from '@syncular/client/worker';

// HTTP transport 인라인 구현 (x-user 헤더로 actor 식별)
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

// startSyncWorker()가 표준 프로토콜로 초기화·RPC 처리
startSyncWorker({
  createTransport: (config) => {
    const actorId = config.clientId;
    return httpSyncTransport(config.endpoints.syncUrl, {
      headers: { 'x-user': actorId },
    });
  },
  createSegments: (config) => {
    const actorId = config.clientId;
    return httpSegmentDownloader({
      headers: { 'x-user': actorId },
    });
  },
  createBlobStore: (config) => {
    const actorId = config.clientId;
    return httpBlobStore(config.endpoints.blobsUrl, {
      headers: { 'x-user': actorId },
    });
  },
});
