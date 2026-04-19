/**
 * syncService.js
 * Sube al servidor las visitas guardadas localmente mientras no había conexión.
 *
 * CASO A — foto_path existe: foto ya subida al servidor en sesión online.
 *   → Reutilizar directamente.
 *
 * CASO B — sin foto_path pero con foto_base64 / foto_file: foto tomada offline.
 *   → Subir ahora vía /visits/upload-photo, obtener foto_path.
 *   → El OCR correrá en background en el servidor tras guardar la visita.
 *
 * CASO C — sin foto ni archivo local: entrada manual o sin_acceso.
 *   → Guardar lectura/sin_acceso sin foto.
 */

import api from './api';
import { getPendingVisits, updatePendingVisit, deletePendingVisit } from './localDB';

let syncing = false;

export async function syncPendingVisits(onProgress) {
  if (syncing || !navigator.onLine) return;
  syncing = true;

  try {
    const pending = await getPendingVisits();
    const toSync  = pending.filter(v => v.status !== 'syncing');

    for (const visit of toSync) {
      try {
        await updatePendingVisit(visit.localId, { status: 'syncing' });
        onProgress?.({ type: 'start', localId: visit.localId });

        const medidoresResueltos = {};

        for (const tipo of ['luz', 'agua', 'gas']) {
          const m = visit.medidores?.[tipo];
          if (!m) continue;

          // ── CASO A: foto ya subida en sesión online ────────────────────
          if (m.foto_path) {
            medidoresResueltos[tipo] = {
              foto_path:         m.foto_path,
              lectura:           m.lectura           || null,
              sin_acceso:        m.sin_acceso        || false,
              motivo_sin_acceso: m.motivo_sin_acceso || null,
            };
            continue;
          }

          // ── CASO B: foto tomada offline → subir ahora ──────────────────
          const tieneArchivoLocal = m.foto_file || m.foto_base64;

          if (tieneArchivoLocal) {
            let fotoPath = null;
            try {
              const formData = new FormData();
              if (m.foto_base64) {
                const res  = await fetch(m.foto_base64);
                const blob = await res.blob();
                if (blob.size === 0) throw new Error('blob vacío');
                formData.append('foto', blob, `${tipo}_${Date.now()}.jpg`);
              } else {
                formData.append('foto', m.foto_file, `${tipo}_${Date.now()}.jpg`);
              }
              const { data: uploadResult } = await api.post('/visits/upload-photo', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              fotoPath = uploadResult.foto_path;
            } catch (photoErr) {
              console.warn(`[sync] No se pudo subir foto de ${tipo}:`, photoErr.message);
            }

            medidoresResueltos[tipo] = {
              foto_path:         fotoPath || null,
              lectura:           m.lectura           || null,
              sin_acceso:        m.sin_acceso        || false,
              motivo_sin_acceso: m.motivo_sin_acceso || null,
            };
          } else {
            // ── CASO C: entrada manual o sin_acceso, sin foto ─────────────
            medidoresResueltos[tipo] = {
              foto_path:         null,
              lectura:           m.lectura           || null,
              sin_acceso:        m.sin_acceso        || false,
              motivo_sin_acceso: m.motivo_sin_acceso || null,
            };
          }
        }

        // ── Crear la visita en el servidor ──────────────────────────────
        const body = {
          latitud:       visit.latitud,
          longitud:      visit.longitud,
          ciudad_id:     visit.ciudad_id,
          conjunto_id:   visit.conjunto_id,
          torre_id:      visit.torre_id      || null,
          apartamento:   visit.apartamento,
          observaciones: visit.observaciones || null,
          medidores:     medidoresResueltos,
          hora_inicio:   visit.hora_inicio   || null,
          hora_fin:      visit.hora_fin      || null,
        };

        await api.post('/visits', body);

        await deletePendingVisit(visit.localId);
        onProgress?.({ type: 'done', localId: visit.localId });

      } catch (err) {
        await updatePendingVisit(visit.localId, {
          status:    'error',
          syncError: err.response?.data?.error || err.message,
        });
        onProgress?.({ type: 'error', localId: visit.localId, error: err.message });
      }
    }

  } finally {
    syncing = false;
  }
}

/**
 * Registrar listener: sincronizar automáticamente al recuperar conexión.
 * Llamar una vez al arrancar la app.
 */
export function registerSyncListener(onProgress) {
  window.addEventListener('online', () => {
    setTimeout(() => syncPendingVisits(onProgress), 1500);
  });
}
