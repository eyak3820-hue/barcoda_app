/*
 * Service Worker for Order Barcode App
 *
 * This service worker caches the core assets of the app so it can work offline.
 */

const CACHE_NAME = 'barcode-app-cache-v1';
// Files to cache. If you add more assets to your app you should add them here.
const FILES_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'main.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (evt) => {
  // Pre-cache static resources
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  // Remove old caches
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then((response) => {
      return response || fetch(evt.request);
    })
  );
});