/**
 * Service Worker — Formas IA
 *
 * Estrategia por tipo de recurso:
 *   - Install:  pre-cachea el app shell (index.html, manifest)
 *   - /static/: cache-first (archivos con hash → nunca cambian)
 *   - Navegar:  network-first → fallback a index.html cacheado
 *   - Resto:    network-first → fallback a caché
 *   - /api/ y /uploads/: siempre por red, sin cacheo
 *
 * NOTA: usamos un solo nombre de caché con versión explícita.
 * Al cambiar CACHE_VERSION se limpian los caches viejos en activate.
 */

const CACHE_VERSION  = 'v3';
const SHELL_CACHE    = `lectura-ia-shell-${CACHE_VERSION}`;
const STATIC_CACHE   = `lectura-ia-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `lectura-ia-runtime-${CACHE_VERSION}`;
const ALL_CACHES     = [SHELL_CACHE, STATIC_CACHE, RUNTIME_CACHE];

// ─── INSTALL: pre-cachear el app shell ───────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache =>
        // addAll falla si algún recurso retorna no-2xx.
        // Usamos add() individual con catch para no bloquear el install.
        Promise.allSettled([
          cache.add('/'),
          cache.add('/index.html'),
          cache.add('/manifest.json'),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: limpiar caches de versiones anteriores ────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => !ALL_CACHES.includes(k))
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Solo interceptar requests HTTP/HTTPS
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // 1. API y uploads → red directa, sin caché
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // 2. Solo GET
  if (request.method !== 'GET') return;

  // 3. Archivos estáticos con hash → CACHE-FIRST
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Navegación HTML → NETWORK-FIRST, fallback a index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Red no disponible — servir index.html desde caché
          const cached = await caches.match('/index.html')
                      || await caches.match('/');
          // Si tampoco hay caché, devolver respuesta de error legible
          return cached || new Response(
            '<h2>Sin conexión</h2><p>Abre la app instalada para trabajar offline.</p>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // 5. Otros recursos (fuentes, íconos…) → NETWORK-FIRST con fallback
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(cache =>
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cache.match(request))
    )
  );
});
