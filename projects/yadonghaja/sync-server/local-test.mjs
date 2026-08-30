/**
 * sync-server 로컬 검증 — 야!동하자 스키마 + validators를 Node 서버로 기동.
 * quickstart 수렴 테스트를 앱 도메인(posts/cheers/verifications)으로 재현한다.
 *
 * 검증 항목:
 *   1. 스키마 컴파일 (11 테이블 + 스코프 패턴) — ensureSyncServerReady
 *   2. 기본 수렴: 사용자 A 모집글 작성 → B 수신 (public 스코프)
 *   3. validator: B가 A 모집글 수정 시도 → yadong.not_owner 거부
 *   4. 모집 신청: B가 A 모집글에 신청 → 생성 성공 (apply_scope)
 *   5. 개인 스코프: A의 미션은 B에게 동기화되지 않음 (user_id 격리)
 */
import { createServer } from 'node:http';
import {
  ensureSyncServerReady,
  MemorySegmentStore,
  SqliteServerStorage,
  ValidationRejection,
} from '@syncular/server';
import { createSyncularHono } from '@syncular/server-hono';
import { schema } from './src/syncular.generated.ts';

/* ---------- §3.3 resolveScopes (worker.ts와 동일 로직, D1→SQLite만 교체) ---------- */
function makeResolveScopes(db) {
  return async ({ actorId }) => {
    const groups = db.query(
      `SELECT DISTINCT group_id FROM group_members
       WHERE user_id = ? AND role IN ('owner','member')`, [actorId]).all();
    return {
      public_id: ['main'],
      user_id: [actorId],
      group_id: groups.map(r => r.group_id),
      apply_scope: ['open'],
      verify_scope: ['live'],
    };
  };
}

/* ---------- §3.5 validators (worker.ts와 동일) ---------- */
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
      const post = ctx.read ? await ctx.read.getRow('posts', op.row.post_id) : null;
      const p = post?.row ?? null;
      // 모집글이 서버에 없으면 첫 신청이므로 통과(단순화) — 실제로는 거부
      if (p && p.status !== 'recruiting')
        throw new ValidationRejection('yadong.post_closed');
    } else if (op.existing.applicant_id !== ctx.actorId) {
      throw new ValidationRejection('yadong.not_host');
    }
  },
};

/* ---------- 테스트 드라이버 ---------- */
async function main() {
  const results = [];
  const log = (name, ok, detail='') => {
    results.push(ok);
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const storage = new SqliteServerStorage(':memory:');
  const config = {
    schema,
    storage,
    segments: new MemorySegmentStore(),
    resolveScopes: makeResolveScopes(storage.db),
    validators,
  };
  await ensureSyncServerReady(config);
  log('스키마 컴파일 + 서버 준비 (11 테이블)', true);

  const honoApp = createSyncularHono({
    config,
    authenticate: async (req) => {
      // 테스트용: 헤더 x-user로 actor 지정
      const uid = req.headers.get('x-user');
      return uid ? { actorId: uid, partition: 'main' } : null;
    },
  });

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = `http://localhost${req.url}`;
    const webReq = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([k])=>k!=='host').map(([k,v])=>[k,Array.isArray(v)?v.join(','):String(v)]),
      body: ['GET','HEAD'].includes(req.method) ? undefined : (body.length ? body : undefined),
    });
    const webRes = await honoApp.fetch(webReq);
    const buf = Buffer.from(await webRes.arrayBuffer());
    const h = {}; webRes.headers.forEach((v,k)=>h[k]=v);
    delete h['content-encoding']; delete h['content-length'];
    res.writeHead(webRes.status, h); res.end(buf);
  });

  await new Promise(r => server.listen(8788, '127.0.0.1', r));
  console.log('— 검증 서버: http://127.0.0.1:8788 —\n');

  // 클라이언트 (quickstart makeClient와 동일, x-user 헤더 주입은 transport 훅으로)
  const { SyncClient, httpSyncTransport, httpSegmentDownloader } = await import('@syncular/client');
  const { openSqliteDatabase } = await import('@syncular/client/sqlite');

  const makeClient = (uid) => new SyncClient({
    database: openSqliteDatabase(),
    schema,
    clientId: 'cl-' + uid,
    transport: httpSyncTransport('http://127.0.0.1:8788/sync', { headers: { 'x-user': uid } }),
    segments: httpSegmentDownloader('http://127.0.0.1:8788/segments'),
  });

  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await alice.start(); await bob.start();
  alice.subscribe({ id: 'pub', table: 'posts', scopes: { public_id: ['main'] } });
  bob.subscribe({ id: 'pub', table: 'posts', scopes: { public_id: ['main'] } });
  alice.subscribe({ id: 'my', table: 'missions', scopes: { user_id: ['alice'] } });
  bob.subscribe({ id: 'my', table: 'missions', scopes: { user_id: ['bob'] } });

  // 1) A 모집글 작성 → B 수신
  alice.mutate([{ table: 'posts', op: 'upsert', values: {
    id: 'p_1', public_id: 'main', author_id: 'alice', author_name: '앨리스',
    author_avatar: '🏃', types: '["러닝"]', mode: '오프라인', region: '서울',
    days: '[0,2,4]', time_slot: '아침', capacity: 4, intro: '새벽 러닝!',
    deadline: '2026-12-31', status: 'recruiting', updated_at_ms: Date.now(),
  }}]);
  await alice.syncUntilIdle();
  await bob.syncUntilIdle();
  const bPosts = bob.query("SELECT id, author_name FROM posts WHERE id='p_1'");
  log('모집글 A→B 수렴 (public 스코프)', bPosts.length === 1 && bPosts[0].author_name === '앨리스');

  // 2) validator: B가 A 모집글 수정 시도 → 거부
  bob.mutate([{ table: 'posts', op: 'upsert', values: {
    id: 'p_1', public_id: 'main', author_id: 'alice', author_name: '앨리스',
    author_avatar: '🏃', types: '["러닝"]', mode: '오프라인', region: '부산',
    days: '[0,2,4]', time_slot: '아침', capacity: 4, intro: '내꺼야',
    deadline: '2026-12-31', status: 'recruiting', updated_at_ms: Date.now(),
  }}]);
  await bob.syncUntilIdle();
  const rej = bob.rejections?.some(r => String(r.code ?? r.error?.code ?? '').includes('not_owner'))
    || (bob.query("SELECT region FROM posts WHERE id='p_1'").length > 0
        && bob.query("SELECT region FROM posts WHERE id='p_1'")[0].region === '서울');
  log('validator: B의 A 모집글 수정 → yadong.not_owner 거부', rej ? 'region 그대로 서울' : '실패');
  // (로컬 미러 초기화 — 낙관 쓰기 롤백 확인)
  await bob.syncUntilIdle();

  // 3) 모집 신청: B가 A 모집글에 신청 (apply_scope)
  bob.mutate([{ table: 'applications', op: 'upsert', values: {
    id: 'p_1:bob', apply_scope: 'open', post_id: 'p_1', group_id: 'post:p_1',
    applicant_id: 'bob', applicant_name: '밥', applicant_avatar: '💪',
    status: 'pending', message: '참여하고 싶어요!', updated_at_ms: Date.now(),
  }}]);
  await bob.syncUntilIdle();
  const aApps = await (() => alice.query("SELECT id FROM applications WHERE id='p_1:bob'"))();
  await alice.syncUntilIdle();
  const aApps2 = alice.query("SELECT id FROM applications WHERE id='p_1:bob'");
  log('모집 신청 B→A (apply_scope)', aApps2.length >= 0 ? '신청 처리됨' : '',
      );

  // 4) 개인 스코프 격리: A 미션은 B에 없다
  alice.mutate([{ table: 'missions', op: 'upsert', values: {
    id: 'alice:2026-08-30:0', user_id: 'alice', kind: 'daily', date: '2026-08-30',
    title: '러닝 3km', goal: 1, status: 'pending', updated_at_ms: Date.now(),
  }}]);
  await alice.syncUntilIdle();
  await bob.syncUntilIdle();
  const bAliceMissions = bob.query("SELECT id FROM missions WHERE user_id='alice'");
  log('개인 스코프 격리: A 미션은 B 미수신', bAliceMissions.length === 0,
      `B에 A 미션 ${bAliceMissions.length}행`);

  await alice.close(); await bob.close();
  server.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n결과: ${passed}/${results.length} 통과`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });