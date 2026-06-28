const CACHE_NAME = 'shenma-v3.8.0'; // 与 data.js APP_VERSION 保持同步

const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './data.js',
    './worker.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // 仅缓存 GET 请求
    if (e.request.method !== 'GET') return;
    
    e.respondWith(
        caches.match(e.request).then((cached) => {
            // 网络优先策略，适用于频繁更新的数据
            return fetch(e.request).then((res) => {
                // 克隆响应流以便缓存
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                return res;
            }).catch(() => {
                // 网络失败回退缓存
                return cached || caches.match('./index.html');
            });
        })
    );
});
