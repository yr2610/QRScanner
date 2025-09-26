const CACHE_NAME = 'qrscanner-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
  // オフラインで使いたいライブラリをローカル同梱した場合はここに追加
  // 例: './libs/html5-qrcode.min.js'
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
  if (url.origin === location.origin && e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
