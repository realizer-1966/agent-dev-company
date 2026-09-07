// Syncular 서버 DDL 재생성 (ESM) — sync_* 관리 테이블 + 앱 테이블 물리 DDL
import fs from 'node:fs';
import path from 'node:path';
import * as server from '@syncular/server';
import { schema } from '../src/syncular.generated.ts';

const { sqliteDdlStatements, createTableDdl, createIndexDdl, compileSchema } = server;

const compiled = compileSchema(schema);
const statements = [...sqliteDdlStatements(schema)];

// 앱 테이블: _sync_* 컬럼 포함 물리 DDL (tables 는 Map)
const tables = [...compiled.tables.values()];
for (const table of tables) {
  statements.push(createTableDdl(table, 'sqlite'));
  statements.push(...createIndexDdl(table));
}

const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', '0001_syncular_server.sql');
fs.writeFileSync(out,
  '-- Syncular 서버 스토리지 테이블 (sqliteDdlStatements + createTableDdl 자동 생성)\n' +
  `-- 재생성: node scripts/regen-ddl.mjs  (${new Date().toISOString().slice(0,10)})\n\n` +
  statements.join(';\n\n') + ';\n');
console.log('재생성 완료:', out, '-', statements.length, '문');
console.log('앱 테이블:', tables.map(t => t.name).join(', '));
