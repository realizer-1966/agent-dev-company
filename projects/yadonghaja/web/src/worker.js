/**
 * yadonghaja sync 워커 — Syncular 클라이언트 (OPFS + 아웃박스 + 실시간)
 * startSyncWorker()가 표준 {t:'init'}/{t:'call'} 프로토콜로 초기화·RPC 처리.
 */
import { startSyncWorker } from '@syncular/client/worker';
import {
  httpSyncTransport,
  httpSegmentDownloader,
  httpBlobTransport,
  webSocketRealtimeConnector,
} from '@syncular/client';

startSyncWorker({
  // SSP2 HTTP 전송 (x-user 헤더로 actor 식별)
  createTransport: (config) =>
    httpSyncTransport(config.endpoints.syncUrl, {
      headers: { 'x-user': config.clientId },
    }),
  createSegments: (config) =>
    httpSegmentDownloader(config.endpoints.segmentsUrl, {
      headers: { 'x-user': config.clientId },
    }),
  // §5.9 blob — PUT/GET {blobsUrl}/{blobId} (서버가 R2 로 저장)
  createBlobStore: undefined, // 기본 httpBlobTransport 사용 (endpoints.blobsUrl 있으면 자동)
  // §8 realtime — WebSocket 커넥터 (실시간 델타 수신)
  createRealtime: (config, clientId) => {
    let url = config.endpoints.realtimeUrl
      ? config.endpoints.realtimeUrl.replace('{clientId}', clientId)
      : null;
    // WS 업그레이드에 커스텀 헤더를 못 붙이므로 actor(clientId) 를 쿼리로 전달
    if (url && clientId) {
      url += (url.includes('?') ? '&' : '?') + 'user=' + encodeURIComponent(clientId);
    }
    if (!url) return undefined;
    // x-user 헤더는 WebSocket 에 못 붙이므로 쿼리로 전달 (서버 authenticate 가 읽음)
    return webSocketRealtimeConnector(url);
  },
});
