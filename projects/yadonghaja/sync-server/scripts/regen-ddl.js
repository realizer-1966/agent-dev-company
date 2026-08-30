// Syncular 서버 테이블 DDL 재생성 스크립트
// @syncular/server 버전 업그레이드 시 실행: node scripts/regen-ddl.js
const fs = require('node:fs');
const path = require('node:path');
const m = require('@syncular/server');
const { schema } = require('../src/syncular.generated.ts');

const ddl = m.sqliteDdlStatements(schema);
const out = path.join(__dirname, '..', 'migrations', '0001_syncular_server.sql');
fs.writeFileSync(out,
  '-- Syncular 서버 스토리지 테이블 (sqliteDdlStatements() 자동 생성)\n' +
  `-- 재생성: node scripts/regen-ddl.js  (${new Date().toISOString().slice(0,10)})\n\n` +
  ddl.join('\n\n') + '\n');
console.log('재생성 완료:', out, '-', ddl.length, '문');