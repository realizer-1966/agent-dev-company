/**
 * yadonghaja sync 워커 — Syncular 클라이언트 코어 전체가 이 안에서 돈다.
 * (sqlite-wasm OPFS + 아웃박스 + fetch transport)
 *
 * 인증: worker-init 메시지로 전달받은 actorId 를 config.actorId 로 받아
 *       x-user 헤더로 주입한다 (로컬 테스트용).
 *  - 프로덕션 (Workers 배포본): HMAC Bearer 토큰으로 교체
 */
import { startSyncWorker } from '@syncular/client/worker';

const SSP2_CONTENT_TYPE = 'application/vnd.syncular.sp-patch+json';

/** 간단한 httpSyncTransport 인라인 — headers 지원 */
function httpSyncTransport(syncUrl, options) {
  const doFetch = options?.fetch ?? fetch;
  return async (request) => {
    const response = await doFetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': SSP2_CONTENT_TYPE,
        ...options?.headers,
      },
      body: request.slice().buffer,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}

/** 세그먼트 다운로더 — signed URL 직접 fetch */
function httpSegmentDownloader(segmentsBaseUrl, options) {
  const doFetch = options?.fetch ?? fetch;
  return async (segmentId) => {
    const url = `${segmentsBaseUrl}/${segmentId}`;
    const res = await doFetch(url, {
      headers: options?.headers || {},
    });
    if (!res.ok) throw new Error(`Segment HTTP ${res.status}`);
    return await res.arrayBuffer();
  };
}

startSyncWorker({
  createTransport: (config) => {
    const actorId = config?.actorId ?? '';
    return httpSyncTransport(config.endpoints.syncUrl, {
      headers: actorId ? { 'x-user': actorId } : {},
    });
  },
  createSegments: (config) => {
    const actorId = config?.actorId ?? '';
    return httpSegmentDownloader(config.endpoints.segmentsUrl, {
      headers: actorId ? { 'x-user': actorId } : {},
    });
  },
});