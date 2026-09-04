/**
 * yadonghaja-web 빌드 — esbuild 번들 + sqlite-wasm 벤더 복사
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

// sqlite-wasm 벤더 복사
const sqlitePkg = require.resolve('@sqlite.org/sqlite-wasm/package.json');
const sqliteDir = path.dirname(sqlitePkg);
for (const f of ['dist/index.mjs', 'dist/sqlite3.wasm', 'dist/sqlite3-opfs-async-proxy.js', 'dist/sqlite3-worker1.mjs']) {
  fs.copyFileSync(path.join(sqliteDir, f), path.join(dist, 'vendor', 'sqlite-wasm', path.basename(f)));
}
fs.copyFileSync(path.join(sqliteDir, 'dist', 'sqlite3-worker1.mjs'), path.join(dist, 'sqlite3-worker1.mjs'));
fs.copyFileSync(path.join(sqliteDir, 'dist', 'sqlite3.wasm'), path.join(dist, 'sqlite3.wasm'));

// esbuild 플러그인: wasm 경로 치환
const vendorRewrite = {
  name: 'vendor-rewrite',
  setup(b) {
    // index.mjs: new URL("sqlite3.wasm", import.meta.url) → new URL("/vendor/sqlite-wasm/sqlite3.wasm", import.meta.url)
    b.onLoad({ filter: /sqlite-wasm[\\/]dist[\\/]index\.mjs$/ }, async (args) => {
      let code = fs.readFileSync(args.path, 'utf8');
      code = code.replace(
        /new URL\(["']sqlite3\.wasm["'],\s*import\.meta\.url\)/g,
        'new URL("/vendor/sqlite-wasm/sqlite3.wasm", import.meta.url)'
      );
      return { contents: code, loader: 'js' };
    });
    
    // sqlite3-worker1.mjs: new URL("sqlite3.wasm", import.meta.url) → new URL("/sqlite3.wasm", import.meta.url)
    b.onLoad({ filter: /sqlite3-worker1\.mjs$/ }, async (args) => {
      let code = fs.readFileSync(args.path, 'utf8');
      code = code.replace(
        /new URL\(["']sqlite3\.wasm["'],\s*import\.meta\.url\)/g,
        'new URL("/sqlite3.wasm", import.meta.url)'
      );
      return { contents: code, loader: 'js' };
    });
    
    // wasm-database.js: same as index.mjs
    b.onLoad({ filter: /syncular[\\/]client[\\/]dist[\\/]wasm-database\.js$/ }, async (args) => {
      let code = fs.readFileSync(args.path, 'utf8');
      code = code.replace(
        /new URL\(["']sqlite3\.wasm["'],\s*import\.meta\.url\)/g,
        'new URL("/vendor/sqlite-wasm/sqlite3.wasm", import.meta.url)'
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
for (const f of ['icon.png', 'site.webmanifest']) {
  const src = path.join(path.dirname(root), f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
}

const out = fs.readdirSync(dist, { recursive: true }).map(f => `  ${f} (${fs.statSync(path.join(dist, f)).size}B)`);
console.log('빌드 완료:\n' + out.join('\n'));
