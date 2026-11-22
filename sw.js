// VeeVee service worker - makes the site installable (PWA) and opens it even on a bad connection.
// When you change index.html you do NOT need to touch this file: the page is always loaded fresh
// from the network first. Only bump CACHE_VERSION if you change the icons or the manifest.
const CACHE_VERSION = 'veevee-v2';

// The app shell: everything VeeVee needs from your own GitHub Pages site
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

// Libraries VeeVee loads from CDNs (styles, icons, P2P, ZIP) - cached so the app still opens offline
const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            // Each file is cached on its own: one missing file (e.g. an icon not uploaded yet)
            // must never stop the whole service worker from installing.
            .then((cache) => Promise.all(APP_SHELL.map((url) =>
                cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    // 1) Opening the page (also invite links like ?room=veevee-abc123): network first, cached copy if offline
    if (request.mode === 'navigate' && sameOrigin) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
                    }
                    return response;
                })
                .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
        );
        return;
    }

    // 2) Icons, manifest and CDN libraries: answer from cache, refresh in the background
    if (sameOrigin || CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(
            caches.open(CACHE_VERSION).then((cache) =>
                cache.match(request).then((cached) => {
                    const network = fetch(request)
                        .then((response) => {
                            if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
                            return response;
                        })
                        .catch(() => cached || Response.error());
                    return cached || network;
                })
            )
        );
    }
    // 3) Everything else (P2P signalling server, YouTube, streaming sites) goes straight to the network
});
