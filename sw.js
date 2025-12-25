const CACHE_NAME = 'facephys-v1';

const CORE_ASSETS = [
    './',
    './index.html',
    './main.js',
    './inference_worker.js',
    './psd_worker.js',
    './plot_worker.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (!e.request.url.startsWith('http')) {
        return;
    }
    e.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(e.request).then((cachedResponse) => {
                const fetchPromise = fetch(e.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(e.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => {
                });
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetchPromise;
            });
        })
    );
});