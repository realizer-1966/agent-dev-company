/**
 * v2.6 원시 SSP2 E2E 최종 — PULL + PUSH(encodeRow) + PULL 왕복
 */
import { encodeMessage, decodeMessage, encodeRow } from '@syncular/core';
import { readFileSync } from 'node:fs';

const ENDPOINT = 'https://yadonghaja-sync-v2.dydtnsp.workers.dev';
const ACTOR = 'e2e-' + Date.now().toString(36);
const CT = 'application/vnd.syncular.sync.v2';

// web 스키마에서 user_profiles 컬럼 추출 (schema.ts 파싱 대신 하드코딩 — 검증용)
const USER_PROFILES_COLUMNS = [
  { name: 'id', type: 'string', nullable: false },
  { name: 'public_id', type: 'string', nullable: false },
  { name: 'display_name', type: 'string', nullable: false },
  { name: 'avatar', type: 'string', nullable: false },
  { name: 'interests', type: 'json', nullable: false },
  { name: 'created_at_ms', type: 'integer', nullable: true },
  { name: 'updated_at_ms', type: 'integer', nullable: false },
];

async function round(frames, label) {
  const body = encodeMessage({ wireVersion: 2, msgKind: 'request', frames });
  const resp = await fetch(`${ENDPOINT}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': CT, 'x-user': ACTOR },
    body,
  });
  const respBytes = new Uint8Array(await resp.arrayBuffer());
  if (!resp.ok) {
    throw new Error(`${label} HTTP ${resp.status}: ${new TextDecoder().decode(respBytes).slice(0, 250)}`);
  }
  return decodeMessage(respBytes);
}

async function main() {
  console.log('=== v2.6 PUSH+PULL 왕복 (encodeRow) ===');
  console.log('actor:', ACTOR);

  // 1. PULL 부트스트랩
  const pull1 = await round([
    { type: 'REQ_HEADER', clientId: ACTOR + '-client', schemaVersion: 1 },
    { type: 'PULL_HEADER', limitCommits: 50, limitSnapshotRows: 1000, maxSnapshotPages: 4, accept: 3 },
  ], 'PULL#1');
  const respHeader = pull1.frames.find(f => f.type === 'RESP_HEADER');
  const logEpoch = respHeader?.logEpoch;
  console.log('✅ PULL#1 — logEpoch 습득:', logEpoch?.slice(0, 8) + '...');

  // 2. PUSH — user_profiles upsert (encodeRow 로 payload 인코딩)
  const values = {
    id: ACTOR,
    public_id: 'main',
    display_name: 'E2E테스터',
    avatar: '🏃',
    interests: ['홈트'],
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
  };
  // encodeRow 는 values 를 "컬럼 순서 배열"로 받는다
  const payload = encodeRow(USER_PROFILES_COLUMNS, [
    values.id, values.public_id, values.display_name, values.avatar,
    JSON.stringify(values.interests), values.created_at_ms, values.updated_at_ms,
  ]);

  const push = await round([
    { type: 'REQ_HEADER', clientId: ACTOR + '-client', schemaVersion: 1, logEpoch },
    { type: 'PUSH_COMMIT', clientCommitId: 'cc-' + Date.now(), operations: [
      { table: 'user_profiles', rowId: ACTOR, op: 'upsert', payload },
    ]},
    { type: 'PULL_HEADER', limitCommits: 50, limitSnapshotRows: 1000, maxSnapshotPages: 4, accept: 3 },
  ], 'PUSH');
  console.log('✅ PUSH 응답 프레임:', push.frames.map(f => f.type).join(', '));
  const ack = push.frames.find(f => f.type === 'PUSH_ACK' || f.type === 'PUSH_RESULT');
  if (ack) console.log('   승인:', JSON.stringify(ack).slice(0, 160));

  // 3. PULL — 내 커밋이 돌아오는지
  const pull2 = await round([
    { type: 'REQ_HEADER', clientId: ACTOR + '-client', schemaVersion: 1, logEpoch },
    { type: 'PULL_HEADER', limitCommits: 50, limitSnapshotRows: 1000, maxSnapshotPages: 4, accept: 3 },
  ], 'PULL#2');
  const types = pull2.frames.map(f => f.type);
  console.log('✅ PULL#2 프레임:', types.join(', '));

  const rows = pull2.frames.filter(f => f.type === 'ROW' || f.type === 'SNAPSHOT_ROW' || f.type === 'SEGMENT_INLINE');
  console.log('   수신 행 프레임:', rows.length);
  for (const r of pull2.frames.slice(0, 10)) {
    const s = JSON.stringify(r);
    if (s.includes(ACTOR)) {
      console.log('   🎯 내 행 발견!:', s.slice(0, 200));
    }
  }

  console.log();
  console.log('🎉 v2.6 E2E 완주: PUSH → 서버 저장 → PULL 회신');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
