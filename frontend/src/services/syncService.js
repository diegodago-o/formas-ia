/**
 * syncService.js
 * Sube al servidor las visitas guardadas localmente mientras no había conexión.
 *
 * Flujo por visita pendiente:
 *  1. Por cada medidor con foto_base64 o foto_file: POST /visits/ocr-preview
 *     → sube la foto, corre OCR, devuelve foto_path + resultado
 *  2. Si OCR difiere del valor ingresado manualmente → requiere_revision = true
 *  3. POST /visits con todos los datos → visita creada en servidor
 *  4. Eliminar de IndexedDB
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

        // ── Paso 1: subir fotos y correr OCR por cada medidor ──────────
        const medidoresResueltos = {};

        for (const tipo of ['luz', 'agua', 'gas']) {
          const m = visit.medidores?.[tipo];
          if (!m) continue;

          const tieneReferencia = m.foto_file || m.foto_base64;

          if (tieneReferencia) {
            // Intentar reconstruir el Blob y subir; si falla, guardar sin foto
            let uploadedOcr = null;
            try {
              const formData = new FormData();
              if (m.foto_base64) {
                // data URL string → Blob (almacenado como string para sobrevivir IDB en móviles)
                const res  = await fetch(m.foto_base64);
                const blob = await res.blob();
                if (blob.size === 0) throw new Error('blob vacío al reconstruir desde base64');
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
              // Continúa sin foto — el medidor se guarda con lectura manual si la hay
            }

            if (uploadedOcr) {
              const discrepancia =
                uploadedOcr.lectura &&
                m.lectura &&
                uploadedOcr.lectura !== m.lectura;

              medidoresResueltos[tipo] = {
                foto_path:         uploadedOcr.foto_path,
                lectura:           m.lectura || uploadedOcr.lectura || null,
                lectura_ocr:       uploadedOcr.lectura,
                confianza_ocr:     uploadedOcr.confianza,
                calidad_foto:      uploadedOcr.calidad_foto,
                motivo_calidad:    uploadedOcr.motivo_calidad,
                nota_ocr:          uploadedOcr.nota,
                sin_acceso:        m.sin_acceso || false,
                motivo_sin_acceso: m.motivo_sin_acceso || null,
                requiere_revision: !m.lectura || uploadedOcr.calidad_foto === 'mala' || discrepancia,
              };
            } else {
              // Foto no subible — guardar lectura manual si existe
              medidoresResueltos[tipo] = {
                foto_path:         null,
                lectura:           m.lectura || null,
                sin_acceso:        m.sin_acceso || false,
                motivo_sin_acceso: m.motivo_sin_acceso || null,
                requiere_revision: true,
              };
            }
          } else {
            // Sin foto (manual o sin_acceso)
            medidoresResueltos[tipo] = {
              foto_path:         null,
              lectura:           m.lectura   || null,
              sin_acceso:        m.sin_acceso || false,
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
