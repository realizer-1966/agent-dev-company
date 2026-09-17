const C='audio-cpp-pwa-v1';
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json','/icon-192.png','/icon-512.png']))));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'){return;}
  e.respondWith(caches.match(e.request).then(h=>h||fetch(e.request)));
});