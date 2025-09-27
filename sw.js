const CACHE_NAME = 'qrscanner-v3';
const ASSETS = [
  './',
  './index.html?v=3',
  './manifest.webmanifest?v=3'
  // './libs/html5-qrcode.min.js?v=3'  // 置いた場合は必要に応じて追加
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request, { cache: 'no-store' }))
    );
  }
});
