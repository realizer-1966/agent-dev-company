/**
 * yadonghaja-web 빌드 — esbuild 번들 + sqlite-wasm 벤더 복사
 *
 * 산출물 (전부 dist/ 로 정적 호스팅 가능 — OnDev에 그대로 ZIP):
 *   dist/index.html   — 페이지 셸
 *   dist/app.js       — 메인 번들 (UI + sync 어댑터)
 *   dist/worker.js    — sync 워커 번들 (sqlite-wasm + OPFS)
 *   dist/vendor/sqlite-wasm/sqlite3.wasm — wasm 바이너리 (경로 치환됨)
 *
 * 실행: node build.mjs   (esbuild 필요: npm install)
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const require = createRequire(import.meta.url);

// dist 초기화
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'vendor', 'sqlite-wasm'), { recursive: true });

// sqlite-wasm 벤더: index.mjs + wasm + OPFS 프록시
const sqlitePkg = require.resolve('@sqlite.org/sqlite-wasm/package.json');
const sqliteDir = path.dirname(sqlitePkg);
for (const f of ['dist/index.mjs', 'dist/sqlite3.wasm', 'dist/sqlite3-opfs-async-proxy.js']) {
  fs.copyFileSync(path.join(sqliteDir, f), path.join(dist, 'vendor', 'sqlite-wasm', path.basename(f)));
}

// esbuild: sqlite-wasm의 import.meta.url 참조를 벤더 경로로 치환하는 플러그인
// (create-app 템플릿의 vendor 재작성 패턴 — Module workers는 import map을 안 물려받는다)
const vendorRewrite = {
  name: 'vendor-rewrite',
  setup(b) {
    // dist에서 wasm을 찾도록 sqlite-wasm의 URL 해석을 고정
    b.onLoad({ filter: /sqlite-wasm[\\/]dist[\\/]index\.mjs$/ }, async (args) => {
      let code = fs.readFileSync(args.path, 'utf8');
      // 번들 안에서 'sqlite3.wasm' 상대 URL이 node_modules 깊이를 가리키지 않게
      // 절대 벤더 경로로 바꾼다. import.meta.url은 esbuild 번들에서 유지된다.
      code = code.replace(
        /new URL\((['"`])sqlite3\.wasm\1,\s*import\.meta\.url\)/g,
        '"/vendor/sqlite-wasm/sqlite3.wasm"',
      );
      return { contents: code, loader: 'js' };
    });
  },
};

// 워커 번들
await build({
  entryPoints: [path.join(root, 'src', 'worker.js')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outfile: path.join(dist, 'worker.js'),
  plugins: [vendorRewrite],
  minify: true,
  legalComments: 'none',
  external: ['@syncular/client/wasm-database'],
});

// 앱 번들
await build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outfile: path.join(dist, 'app.js'),
  minify: true,
  legalComments: 'none',
});

// index.html 복사
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
// PWA 에셋 유지 (아이콘·매니페스트)
for (const f of ['icon.png', 'site.webmanifest']) {
  const src = path.join(path.dirname(root), f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
}

const out = fs.readdirSync(dist, { recursive: true }).map(f => `  ${f} (${fs.statSync(path.join(dist, f)).size}B)`);
console.log('빌드 완료:\n' + out.join('\n'));