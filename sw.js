const CACHE_VERSION = 'finance-v1.0.3'
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './dashboard.js',
  './transactions.js',
  './import.js',
  './analysis.js',
  './settings.js',
  './manifest.json',
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS)))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.url.includes('generativelanguage.googleapis.com')) return

  if (e.request.url.endsWith('version.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
    return
  }

  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
