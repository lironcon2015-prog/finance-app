const CACHE_VERSION = 'finance-v1.12.7'
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core.js',
  './templates.js',
  './wizard.js',
  './budget.js',
  './budgetGen.js',
  './recurring.js',
  './dashboard.js',
  './transactions.js',
  './import.js',
  './analysis.js',
  './settings.js',
  './autocat.js',
  './manifest.json',
]

self.addEventListener('install', e => {
  self.skipWaiting()
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

  // network-first for HTML and version.json
  const url = new URL(e.request.url)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('version.json') || url.pathname.endsWith('/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
    return
  }

  // strip query params for cache matching (cache-busting ?v=)
  const cleanUrl = url.origin + url.pathname
  e.respondWith(
    caches.match(cleanUrl).then(r => r || caches.match(e.request)).then(r => r || fetch(e.request))
  )
})

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
