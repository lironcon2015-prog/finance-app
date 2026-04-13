const CACHE_VERSION = 'finance-v1'
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/dashboard.js',
  './js/transactions.js',
  './js/import.js',
  './js/analysis.js',
  './js/settings.js',
  './manifest.json',
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.url.includes('generativelanguage.googleapis.com')) return
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})
