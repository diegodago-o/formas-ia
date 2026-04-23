/**
 * localDB.js — Wrapper de IndexedDB para soporte offline
 *
 * Stores:
 *  - 'catalogs'       → catálogos cacheados (ciudades, conjuntos, torres)
 *  - 'pending_visits' → visitas guardadas localmente pendientes de sync
 *  - 'drafts'         → borradores de visitas en progreso (multi-piso)
 */

const DB_NAME    = 'lectura-ia-offline';
const DB_VERSION = 3;   // v3: agrega visit_detail_cache + pending_subsanaciones

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('catalogs')) {
        db.createObjectStore('catalogs', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('pending_visits')) {
        const store = db.createObjectStore('pending_visits', { keyPath: 'localId' });
        store.createIndex('status', 'status', { unique: false });
      }
      // v2: borradores de visitas en progreso
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'localId' });
      }
      // v3: caché del detalle de visitas rechazadas (para subsanar offline)
      if (!db.objectStoreNames.contains('visit_detail_cache')) {
        db.createObjectStore('visit_detail_cache', { keyPath: 'id' });
      }
      // v3: subsanaciones guardadas offline pendientes de sync
      if (!db.objectStoreNames.contains('pending_subsanaciones')) {
        db.createObjectStore('pending_subsanaciones', { keyPath: 'localId' });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Catálogos ────────────────────────────────────────────────

export async function saveCatalog(key, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('catalogs', 'readwrite');
    const store = tx.objectStore('catalogs');
    const req   = store.put({ key, data, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getCatalog(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('catalogs', 'readonly');
    const store = tx.objectStore('catalogs');
    const req   = store.get(key);
    req.onsuccess = e => resolve(e.target.result?.data || null);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Visitas pendientes de sync ───────────────────────────────

export async function savePendingVisit(visitData) {
  const db = await openDB();
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const record = { localId, ...visitData, status: 'pending', createdAt: Date.now() };

  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_visits', 'readwrite');
    const store = tx.objectStore('pending_visits');
    const req   = store.add(record);
    req.onsuccess = () => resolve(localId);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getPendingVisits() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_visits', 'readonly');
    const store = tx.objectStore('pending_visits');
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function updatePendingVisit(localId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_visits', 'readwrite');
    const store = tx.objectStore('pending_visits');
    const getReq = store.get(localId);
    getReq.onsuccess = e => {
      const record = e.target.result;
      if (!record) { resolve(); return; }
      const putReq = store.put({ ...record, ...updates });
      putReq.onsuccess = () => resolve();
      putReq.onerror   = err => reject(err.target.error);
    };
    getReq.onerror = e => reject(e.target.error);
  });
}

export async function deletePendingVisit(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_visits', 'readwrite');
    const store = tx.objectStore('pending_visits');
    const req   = store.delete(localId);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Borradores (visitas en progreso) ────────────────────────
//    IndexedDB puede almacenar File/Blob nativamente.
//    Las preview URLs (blob:...) NO se guardan — se recrean al cargar.

export async function saveDraft(draftData) {
  const db = await openDB();
  const localId = `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const record = {
    localId,
    ...draftData,
    status: 'borrador',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    const req   = store.add(record);
    req.onsuccess = () => resolve(localId);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getDrafts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('drafts', 'readonly');
    const store = tx.objectStore('drafts');
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getDraft(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('drafts', 'readonly');
    const store = tx.objectStore('drafts');
    const req   = store.get(localId);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function updateDraft(localId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    const getReq = store.get(localId);
    getReq.onsuccess = e => {
      const record = e.target.result;
      if (!record) { resolve(); return; }
      const putReq = store.put({ ...record, ...updates, updatedAt: Date.now() });
      putReq.onsuccess = () => resolve();
      putReq.onerror   = err => reject(err.target.error);
    };
    getReq.onerror = e => reject(e.target.error);
  });
}

export async function deleteDraft(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    const req   = store.delete(localId);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Caché de lista de visitas del servidor ───────────────────
// Reutiliza el store 'catalogs' con clave fija 'my_visits'

export async function saveVisitsCache(visits) {
  return saveCatalog('my_visits', visits);
}

export async function getVisitsCache() {
  return getCatalog('my_visits');
}

// ── Caché del detalle de visita rechazada ────────────────────
// Permite mostrar el formulario de subsanación sin conexión

export async function saveVisitDetailCache(visit) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('visit_detail_cache', 'readwrite');
    const store = tx.objectStore('visit_detail_cache');
    const req   = store.put({ ...visit, _cachedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getVisitDetailCache(visitId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('visit_detail_cache', 'readonly');
    const store = tx.objectStore('visit_detail_cache');
    const req   = store.get(visitId);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Subsanaciones offline pendientes de sync ─────────────────

export async function savePendingSubsanacion(data) {
  const db      = await openDB();
  const localId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const record  = { localId, ...data, status: 'pending', createdAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_subsanaciones', 'readwrite');
    const store = tx.objectStore('pending_subsanaciones');
    const req   = store.add(record);
    req.onsuccess = () => resolve(localId);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function getPendingSubsanaciones() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_subsanaciones', 'readonly');
    const store = tx.objectStore('pending_subsanaciones');
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function updatePendingSubsanacion(localId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction('pending_subsanaciones', 'readwrite');
    const store  = tx.objectStore('pending_subsanaciones');
    const getReq = store.get(localId);
    getReq.onsuccess = e => {
      const record = e.target.result;
      if (!record) { resolve(); return; }
      const putReq = store.put({ ...record, ...updates });
      putReq.onsuccess = () => resolve();
      putReq.onerror   = err => reject(err.target.error);
    };
    getReq.onerror = e => reject(e.target.error);
  });
}

export async function deletePendingSubsanacion(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_subsanaciones', 'readwrite');
    const store = tx.objectStore('pending_subsanaciones');
    const req   = store.delete(localId);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}
