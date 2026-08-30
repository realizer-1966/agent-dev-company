/**
 * yadonghaja v2 로컬 테스트 서버
 *   - POST /sync, GET /segments/*, PUT/GET /blobs/* → Syncular 서버 (in-memory SQLite)
 *   - 그 외 정적 파일 → dist/ 서빙
 *
 * 용도:
 *   1. 프론트 로컬 개발 (http://127.0.0.1:8788)
 *   2. Playwright E2E — 두 브라우저 탭 (사용자 A, B) 실제 동기화 검증
 *
 * 실행: node test-server.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  ensureSyncServerReady,
  MemorySegmentStore,
  SqliteServerStorage,
  ValidationRejection,
} from '@syncular/server';
import { createSyncularHono } from '@syncular/server-hono';
import { schema } from '../sync-server/src/syncular.generated.ts';

/* ---------- resolveScopes & validators (sync-server 와 동일) ---------- */
function makeResolveScopes(db) {
  return async ({ actorId }) => {
    const groups = db.query(
      `SELECT DISTINCT group_id FROM group_members WHERE user_id = ? AND role IN ('owner','member')`,
      [actorId]
    ).all();
    return {
      public_id: ['main'],
      user_id: [actorId],
      group_id: groups.map(r => r.group_id),
      apply_scope: ['open'],
      verify_scope: ['live'],
    };
  };
}

const validators = {
  posts: (op, ctx) => {
    if (op.op !== 'upsert') return;
    if (!op.existing && op.row.author_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
    if (op.existing && op.existing.author_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  feed_items: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  cheers: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  user_profiles: (op, ctx) => {
    if (op.op === 'upsert' && op.row.id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  verifications: (op, ctx) => {
    if (op.op === 'upsert' && op.row.user_id !== ctx.actorId)
      throw new ValidationRejection('yadong.not_owner');
  },
  applications: async (op, ctx) => {
    if (op.op !== 'upsert') return;
    if (!op.existing) {
      if (op.row.applicant_id !== ctx.actorId)
        throw new ValidationRejection('yadong.not_applicant');
    } else if (op.existing.applicant_id !== ctx.actorId) {
      throw new ValidationRejection('yadong.not_host');
    }
  },
};

/* ---------- Hono 앱 ---------- */
const storage = new SqliteServerStorage(':memory:');
const config = {
  schema,
  storage,
  segments: new MemorySegmentStore(),
  resolveScopes: makeResolveScopes(storage.db),
  validators,
};
await ensureSyncServerReady(config);

const honoApp = createSyncularHono({
  config,
  authenticate: async (req) => {
    const uid = req.headers.get('x-user');
    return uid ? { actorId: uid, partition: 'main' } : null;
  },
});

/* ---------- 정적 파일 서빙 + HTTP 라우팅 ---------- */
const distDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Syncular 엔드포인트
  if (url.pathname.startsWith('/sync') || url.pathname.startsWith('/segments') || url.pathname.startsWith('/blobs')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const webReq = new Request(`http://localhost${url.pathname}${url.search}`, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([k]) => k !== 'host').map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : (body.length ? body : undefined),
    });
    const webRes = await honoApp.fetch(webReq);
    const buf = Buffer.from(await webRes.arrayBuffer());
    const h = {}; webRes.headers.forEach((v, k) => h[k] = v);
    delete h['content-encoding']; delete h['content-length'];
    res.writeHead(webRes.status, h);
    res.end(buf);
    return;
  }

  // 정적 파일
  let filePath = path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
  res.end(content);
});

await new Promise(resolve => server.listen(8788, '127.0.0.1', () => {
  console.log('✅ yadonghaja v2 테스트 서버: http://127.0.0.1:8788');
  console.log('   - dist/ 정적 파일 서빙');
  console.log('   - /sync, /segments, /blobs → in-memory Syncular 서버');
  console.log('   - x-user 헤더로 actor 식별');
  resolve();
}));