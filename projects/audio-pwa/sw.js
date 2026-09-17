const C='audio-cpp-pwa-v2';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(['/manifest.json','/icon-192.png','/icon-512.png'])));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 정적 자산(아이콘/manifest)만 캐시 우선, 문서는 항상 네트워크 우선
  const url = new URL(e.request.url);
  const cacheFirst = /\.(png|svg|ico|json)$/.test(url.pathname) || url.pathname === '/sw.js';
  if (cacheFirst) {
    e.respondWith(caches.match(e.request).then(h => h || fetch(e.request)));
  } else {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(C).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  }
});