/**
 * sync-server 빌드 스크립트 — worker.ts 를 esbuild 로 번들.
 * @syncular/server 가 로컬 파일 SQLite 용 'bun:sqlite' 를 import 하는 것을
 * 빈 스텁으로 대체한다 (D1 을 쓰므로 이 드라이버는 불필요).
 * wrangler 는 번들 결과물(main)을 그대로 배포한다.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 빈 sqlite 스텁 — bun:sqlite Database 를 참조하는 코드 경로를 무력화
const stub = `
export class Database {
  constructor() { throw new Error('bun:sqlite is not supported on Cloudflare Workers'); }
}
`;

mkdirSync(`${__dirname}/dist`, { recursive: true });
writeFileSync(`${__dirname}/dist/sqlite-stub.js`, stub);

await build({
  entryPoints: [`${__dirname}/src/worker.ts`],
  outfile: `${__dirname}/dist/worker.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: false,
  minify: false,
  // Worker 플랫폼 builtin — 외부 유지
  external: ['cloudflare:workers'],
  // bun:sqlite → 빈 스텁
  alias: {
    'bun:sqlite': `${__dirname}/dist/sqlite-stub.js`,
  },
  logLevel: 'error',
  // .ts 확장자 import 해석
  resolveExtensions: ['.ts', '.js', '.mjs'],
});

console.log('✅ worker 번들 완료: dist/worker.mjs');
