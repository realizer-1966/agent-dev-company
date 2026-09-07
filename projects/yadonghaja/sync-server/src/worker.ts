/**
 * 야!동하자 sync 서버 — Cloudflare Workers 엔트리
 * 설계안(SYNCULAR_DESIGN.md) §3·§8의 실제 구현.
 *
 * 라우팅 (@syncular/server-workers README 기준):
 *   POST /sync       — push+pull, 파티션 DO(SyncularRealtimeDO)에서 직렬화
 *   GET  /segments/* — 부트스트랩 세그먼트 다운로드
 *   PUT  /blobs/*    — 인증 사진 업로드 (콘텐츠 어드레싱 검증)
 *   GET  /blobs/*    — 사진 다운로드 (행 유래 재인가)
 *
 * v2.0 은 HTTP-only(coordinator) — realtime WebSocket은 v2.5에서
 * `coordinator` → `realtime` 팩토리로 교체만 하면 켜진다.
 */
import {
  D1ServerStorage,
  S3BlobStore,
  S3SegmentStore,
  s3PresignedBlobUrls,
  s3PresignedUrls,
  ValidationRejection,
  handleBlobUpload,
  handleBlobDownload,
  handleSegmentDownload,
  type SyncServerConfig,
} from '@syncular/server';
import {
  createWorkersFetchHandler,
  SyncularRealtimeHost,
} from '@syncular/server-workers';
import { DurableObject } from 'cloudflare:workers';
import { schema } from './syncular.generated';

export interface Env {
  DB: D1Database;                                  // wrangler.toml [[d1_databases]]
  SYNC_COORDINATOR: DurableObjectNamespace;        // [[durable_objects.bindings]]
  R2_ACCOUNT_ID: string;                           // wrangler secret put
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SYNC_HMAC_KEY: string;
}


/* ============================================================
   R2BlobStore — Workers R2 바인딩 기반 BlobStore (§5.9.2)
   env.BUCKET 을 직접 사용 — S3 자격증명 불필요
   ============================================================ */
class R2BlobStore {
  constructor(bucket, prefix = 'blobs/') {
    this.bucket = bucket;
    this.prefix = prefix;
  }
  key(partition, blobId) {
    return `${this.prefix}${partition}/${blobId}`;
  }
  async put(partition, blobId, bytes, nowMs, mediaType) {
    await this.bucket.put(this.key(partition, blobId), bytes.slice().buffer, {
      httpMetadata: mediaType ? { contentType: mediaType } : undefined,
      customMetadata: { partition, createdAtMs: String(nowMs), ...(mediaType ? { mediaType } : {}) },
    });
    return {
      blobId, partition,
      byteLength: bytes.length,
      ...(mediaType ? { mediaType } : {}),
      createdAtMs: nowMs,
    };
  }
  async has(partition, blobId) {
    const head = await this.bucket.head(this.key(partition, blobId));
    return head !== null;
  }
  async get(partition, blobId) {
    const obj = await this.bucket.get(this.key(partition, blobId));
    if (!obj) return undefined;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    return {
      record: {
        blobId, partition,
        byteLength: bytes.length,
        ...(obj.httpMetadata?.contentType ? { mediaType: obj.httpMetadata.contentType } : {}),
        createdAtMs: Number(obj.customMetadata?.createdAtMs ?? 0),
      },
      bytes,
    };
  }
  async sweepOrphans(partition, olderThanMs, referencedBlobIds) {
    const deleted = [];
    const list = await this.bucket.list({ prefix: `${this.prefix}${partition}/` });
    for (const item of list.objects ?? []) {
      const blobId = item.key.split('/').pop();
      if (referencedBlobIds.has(blobId)) continue;
      if ((item.uploaded?.getTime() ?? 0) < olderThanMs) {
        await this.bucket.delete(item.key);
        deleted.push(blobId);
      }
    }
    return deleted;
  }
}

/* ============================================================
   §3.3 resolveScopes — 이 서버가 직접 짜는 유일한 인가 함수
   ============================================================ */
async function resolveScopes({ actorId }: { actorId: string }, env: Env) {
  // 내가 속한 그룹(방장 포함) — group_members 행 조회
  const groups = await env.DB.prepare(
    `SELECT DISTINCT group_id FROM group_members
     WHERE user_id = ?1 AND role IN ('owner','member')`,
  ).bind(actorId).all<{ group_id: string }>();

  return {
    public_id:   ['main'],                         // 공개 피드·모집글·프로필
    user_id:     [actorId],                        // 내 미션·포인트·배지·스트릭
    group_id:    (groups.results ?? []).map(g => g.group_id),
    apply_scope: ['open'],                         // 누구나 모집 신청 생성 가능
    verify_scope:['live'],                         // 인증 활동 전체
  };
}

/* ============================================================
   §3.5 validators (§6.7) — 소유권·비즈니스 규칙, 트랜잭션 내 검증
   ============================================================ */
const validators = {
  // 모집글: 생성/수정은 author만 (author_id 위조 방지)
  posts: (op: any, ctx: any) => {
    if (op.op !== 'upsert') return;
    if (!op.existing && op.row.author_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
    if (op.existing && op.existing.author_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  // 피드: 본인 것만
  feed_items: (op: any, ctx: any) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  // 응원: 본인 것만 (+ 일 5회 제한은 여기에 추가)
  cheers: (op: any, ctx: any) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  // 프로필: 본인 행(id=actor)만
  user_profiles: (op: any, ctx: any) => {
    if (op.op === 'upsert' && op.row.id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  // 인증: 본인만 (group_id는 쿼리용 — 인가는 verify_scope 축이 담당)
  verifications: (op: any, ctx: any) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  // 모집 신청: 신청자 본인만 생성, 승인/거절은 방장만
  applications: async (op: any, ctx: any) => {
    if (op.op !== 'upsert') return;
    if (!op.existing) {
      // 신청 생성 — applicant 위조 방지 + 모집글 상태 검증
      if (op.row.applicant_id !== ctx.actorId)
        throw new ValidationRejection('yadong.not_applicant');
      const post = await ctx.read.getRow('posts', op.row.post_id);
      const p = post?.row as any;
      if (!p || p.status !== 'recruiting')
        throw new ValidationRejection('yadong.post_closed');
    } else if (op.existing.applicant_id !== ctx.actorId) {
      // 상태 변경은 신청자가 아니면 → 방장인지
      const owner = await ctx.read.getRow(
        'group_members', `post:${op.existing.post_id}:${ctx.actorId}`);
      const m = owner?.row as any;
      if (!m || m.role !== 'owner')
        throw new ValidationRejection('yadong.not_host');
    }
  },
} as const;

/* ============================================================
   익명 auth — x-user 헤더 (개발/프로토타입 단계)
   v2.0: x-user 헤더 기반 (local-test.mjs·프론트 worker.js와 일치)
   v2.5에서 HMAC Bearer 토큰 또는 소셜 auth로 교체
   ============================================================ */
async function authenticate(request: Request, env: Env) {
  const actorId = request.headers.get('x-user');
  if (!actorId) return null;                          // → 401
  return { actorId, partition: 'main' };               // 앱 전체 단일 파티션
}

/* ============================================================
   서버 설정 조립 — 패키지 README "Usage" 구조 그대로
   ============================================================ */
function syncConfig(env: Env, storage?: D1ServerStorage): SyncServerConfig {
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const r2 = {
    endpoint,
    region: 'auto' as const,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
  const segments = new S3SegmentStore({ ...r2, bucket: 'yadonghaja-blobs-prod' });
  // R2 바인딩 직접 사용 — S3 자격증명 불필요 (사진 바이트 저장)
  const blobs = env.BUCKET
    ? new R2BlobStore(env.BUCKET)
    : new S3BlobStore({ ...r2, bucket: 'yadonghaja-blobs-prod' });
  return {
    schema,
    // DO(coordinator) 안에서는 DO가 만든 coordinated storage 를 그대로 쓴다.
    // stateless 실행 시에는 자체 storage 를 만든다.
    storage: storage ?? new D1ServerStorage(env.DB),
    segments,
    blobs,
    // §5.4 위임 프리사인 — R2가 세그먼트 URL 직접 발급
    signedUrls: s3PresignedUrls(segments, { ttlSeconds: 900 }),
    // §5.9.5 Blob 다운로드 프리사인 (인가 후 발급)
    blobSignedUrls: s3PresignedBlobUrls(blobs, { ttlSeconds: 900 }),
    resolveScopes: (args: any) => resolveScopes(args, env),
    validators,
  };
}

/* ============================================================
   Durable Object — 파티션('main') 쓰기 직렬화 (+ v2.5 realtime 호스트)
   패키지 README "Wiring" 그대로: 직접 상속 + SyncularRealtimeHost 위임
   ============================================================ */
export class SyncularRealtimeDO extends DurableObject<Env> {
  #host = new SyncularRealtimeHost(this.ctx, this.env.DB, {
    syncConfig: (storage) => syncConfig(this.env, storage),
  });
  fetch(request: Request) { return this.#host.fetch(request); }
  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    return this.#host.webSocketMessage(ws, msg);
  }
  webSocketClose(ws: WebSocket) { return this.#host.webSocketClose(ws); }
  webSocketError(ws: WebSocket) { return this.#host.webSocketError(ws); }
}

// 간단 헬스체크 (v2.5 호환 — 모니터링용)
function healthHandler(request: Request, env: Env): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/health') return null;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-user, Authorization',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: Date.now(),
    actorId: request.headers.get('x-user') || 'anonymous',
    worker: 'yadonghaja-sync v2.6 (Syncular)',
    d1: env.DB ? 'connected' : 'not-configured',
    r2: env.BUCKET ? 'connected' : 'not-configured',
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// x-user 인증 helper (HTTP 라우트 공용)
function httpAuth(request: Request): { actorId: string; partition: string } | null {
  const actorId = request.headers.get('x-user');
  return actorId ? { actorId, partition: 'main' } : null;
}

const HTTP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-user, Authorization, x-syncular-scopes, if-none-match, accept-encoding',
};

// GET /segments/{segmentId} — 부트스트랩 세그먼트 다운로드
async function segmentsHandler(request: Request, env: Env, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/segments\/([^/]+)$/);
  if (!m || request.method !== 'GET') return null;
  const auth = httpAuth(request);
  if (!auth) return json({ code: 'sync.auth_required' }, 401);
  try {
    const result = await handleSegmentDownload(
      { ...syncConfig(env), ...auth },
      { segmentId: m[1], scopesHeader: request.headers.get('x-syncular-scopes') ?? '{}' },
    );
    if (request.headers.get('if-none-match') === result.headers.ETag) {
      return new Response(null, { status: 304, headers: { ...HTTP_CORS, ...result.headers } });
    }
    return new Response(result.bytes.slice().buffer, {
      status: 200, headers: { ...HTTP_CORS, ...result.headers },
    });
  } catch (e: any) {
    return json({ code: e?.code ?? 'sync.error', message: e?.message }, e?.status ?? 500);
  }
}

// PUT/GET /blobs/{blobId} — 사진 업로드(R2 저장)·다운로드 (§5.9)
async function blobsHandler(request: Request, env: Env, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/blobs\/([^/]+)$/);
  if (!m) return null;
  const auth = httpAuth(request);
  if (!auth) return json({ code: 'sync.auth_required' }, 401);
  const ctxCfg = { ...syncConfig(env), ...auth };

  try {
    if (request.method === 'PUT') {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const contentType = request.headers.get('content-type')?.split(';')[0]?.trim();
      await handleBlobUpload(ctxCfg, {
        blobId: m[1],
        bytes,
        ...(contentType && contentType !== 'application/octet-stream' ? { mediaType: contentType } : {}),
      });
      return new Response(null, { status: 200, headers: HTTP_CORS });
    }
    if (request.method === 'GET') {
      const result = await handleBlobDownload(ctxCfg, m[1]);
      if (result.url !== undefined) {
        return json({ url: result.url, urlExpiresAtMs: result.urlExpiresAtMs }, 200, HTTP_CORS);
      }
      if (request.headers.get('if-none-match') === result.headers.ETag) {
        return new Response(null, { status: 304, headers: { ...HTTP_CORS, ...result.headers } });
      }
      return new Response((result.bytes ?? new Uint8Array(0)).slice().buffer, {
        status: 200, headers: { ...HTTP_CORS, ...result.headers },
      });
    }
  } catch (e: any) {
    return json({ code: e?.code ?? 'sync.error', message: e?.message }, e?.status ?? 500);
  }
  return null;
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...HTTP_CORS, ...extra },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: HTTP_CORS });
    }
    const url = new URL(request.url);
    const health = healthHandler(request, env);
    if (health) return health;
    const segments = await segmentsHandler(request, env, url);
    if (segments) return segments;
    const blobs = await blobsHandler(request, env, url);
    if (blobs) return blobs;
    return createWorkersFetchHandler<Env>({
    config: (env) => ({
      config: syncConfig(env),
      authenticate: (request) => authenticate(request, env),
    }),
    // v2.7: realtime — /realtime WebSocket 업그레이드 + 같은 namespace 로 쓰기 직렬화
    realtime: (env2) => ({
      namespace: env2.SYNC_COORDINATOR,
      authenticate: async (req) => {
        // WebSocket 업그레이드는 커스텀 헤더를 못 싣는다 — 쿼리 파라미터로 actor 전달
        const url = new URL(req.url);
        const actorId = req.headers.get('x-user') ?? url.searchParams.get('user') ?? undefined;
        return actorId ? { actorId, partition: 'main' } : undefined;
      },
    }),
  })(request, env, ctx);
  },
};