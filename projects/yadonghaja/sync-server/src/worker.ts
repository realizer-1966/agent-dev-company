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
   익명 auth — Authorization: Bearer <HMAC 서명 토큰>
   v2.0: HMAC 토큰 (v2.5에서 소셜 auth로 교체)
   ============================================================ */
async function authenticate(request: Request, env: Env) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;                          // → 401
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot), sigB64 = token.slice(dot + 1);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SYNC_HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'HMAC', key, b64urlDecode(sigB64),
    new TextEncoder().encode(payloadB64));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  if (typeof payload.uid !== 'string') return null;
  return { actorId: payload.uid, partition: 'main' };   // 앱 전체 단일 파티션
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ============================================================
   서버 설정 조립 — 패키지 README "Usage" 구조 그대로
   ============================================================ */
function syncConfig(env: Env): SyncServerConfig {
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const r2 = {
    endpoint,
    region: 'auto' as const,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
  const segments = new S3SegmentStore({ ...r2, bucket: 'yadonghaja-blobs' });
  const blobs = new S3BlobStore({ ...r2, bucket: 'yadonghaja-blobs' });
  return {
    schema,
    storage: new D1ServerStorage(env.DB),
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
    syncConfig: () => syncConfig(this.env),
  });
  fetch(request: Request) { return this.#host.fetch(request); }
  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    return this.#host.webSocketMessage(ws, msg);
  }
  webSocketClose(ws: WebSocket) { return this.#host.webSocketClose(ws); }
  webSocketError(ws: WebSocket) { return this.#host.webSocketError(ws); }
}

export default {
  fetch: createWorkersFetchHandler<Env>({
    config: (env) => ({
      config: syncConfig(env),
      authenticate: (request) => authenticate(request, env),
    }),
    // HTTP-only: /sync를 파티션 DO로 포워드해 쓰기 직렬화 (WebSocket은 v2.5)
    coordinator: (env) => ({ namespace: env.SYNC_COORDINATOR }),
  }),
};