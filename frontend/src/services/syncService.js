/**
 * syncService.js
 * Sube al servidor las visitas guardadas localmente mientras no había conexión.
 *
 * Soporta visitas mixtas (fotos tomadas online + offline en la misma visita):
 *
 * CASO A — foto_path existe: foto ya subida al servidor en sesión online.
 *   → Reutilizar directamente. NO re-subir (el archivo ya existe en uploads/).
 *   → Los metadatos OCR ya están en el objeto (vienen del ocr_meta spread).
 *
 * CASO B — sin foto_path pero con foto_base64 / foto_file: foto tomada offline.
 *   → Subir ahora, correr OCR y obtener foto_path nuevo.
 *
 * CASO C — sin foto_path ni archivo local: entrada manual o sin_acceso.
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

        // ── Paso 1: resolver cada medidor según su origen ──────────────
        const medidoresResueltos = {};

        for (const tipo of ['luz', 'agua', 'gas']) {
          const m = visit.medidores?.[tipo];
          if (!m) continue;

          // ── CASO A: foto ya subida en sesión online ────────────────────
          if (m.foto_path) {
            // El archivo ya existe en el servidor — reutilizar path y metadatos OCR
            medidoresResueltos[tipo] = {
              foto_path:         m.foto_path,
              lectura:           m.lectura           || null,
              lectura_ocr:       m.lectura_ocr       || null,
              confianza_ocr:     m.confianza_ocr     || null,
              calidad_foto:      m.calidad_foto       || 'buena',
              motivo_calidad:    m.motivo_calidad     || null,
              nota_ocr:          m.nota_ocr           || null,
              es_medidor:        m.es_medidor         !== undefined ? m.es_medidor : true,
              sin_acceso:        m.sin_acceso         || false,
              motivo_sin_acceso: m.motivo_sin_acceso  || null,
            };
            continue;
          }

          // ── CASO B: foto tomada offline → subir y correr OCR ──────────
          const tieneArchivoLocal = m.foto_file || m.foto_base64;

          if (tieneArchivoLocal) {
            let uploadedOcr = null;
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
              formData.append('tipo', tipo);

              const { data: ocrResult } = await api.post('/visits/ocr-preview', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              uploadedOcr = ocrResult;
            } catch (photoErr) {
              console.warn(`[sync] No se pudo subir foto de ${tipo}:`, photoErr.message);
            }

            if (uploadedOcr) {
              const discrepancia = uploadedOcr.lectura && m.lectura && uploadedOcr.lectura !== m.lectura;
              const noEsMedidor  = uploadedOcr.es_medidor === false;

              medidoresResueltos[tipo] = {
                foto_path:         uploadedOcr.foto_path,
                lectura:           m.lectura || uploadedOcr.lectura || null,
                lectura_ocr:       uploadedOcr.lectura,
                confianza_ocr:     uploadedOcr.confianza,
                calidad_foto:      uploadedOcr.calidad_foto,
                motivo_calidad:    uploadedOcr.motivo_calidad,
                nota_ocr:          uploadedOcr.nota,
                es_medidor:        uploadedOcr.es_medidor,
                sin_acceso:        m.sin_acceso        || false,
                motivo_sin_acceso: m.motivo_sin_acceso || null,
                requiere_revision: noEsMedidor || !m.lectura || uploadedOcr.calidad_foto === 'mala' || discrepancia,
              };
            } else {
              // Foto no subible — conservar lectura manual si la hay
              medidoresResueltos[tipo] = {
                foto_path:         null,
                lectura:           m.lectura           || null,
                sin_acceso:        m.sin_acceso        || false,
                motivo_sin_acceso: m.motivo_sin_acceso || null,
                requiere_revision: !m.lectura && !m.sin_acceso,
              };
            }
          } else {
            // ── CASO C: entrada manual o sin_acceso, sin foto ─────────────
            medidoresResueltos[tipo] = {
              foto_path:         null,
              lectura:           m.lectura           || null,
              sin_acceso:        m.sin_acceso        || false,
              motivo_sin_acceso: m.motivo_sin_acceso || null,
              requiere_revision: !m.lectura && !m.sin_acceso,
            };
          }
        }

        // ── Paso 2: crear la visita en el servidor ──────────────────────
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

        // ── Paso 3: eliminar de cola local ─────────────────────────────
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
