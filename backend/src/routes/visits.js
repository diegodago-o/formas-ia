const router = require('express').Router();
const path = require('path');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { analizarMedidor, coincidenciaDigitos } = require('../services/ocr');
const logger = require('../middleware/logger');
const ah = require('../middleware/asyncHandler');

// ─────────────────────────────────────────────
// GET /api/visits/check-duplicate
// ─────────────────────────────────────────────
router.get('/check-duplicate', authMiddleware, ah(async (req, res) => {
  const { conjunto_id, torre_id, apartamento } = req.query;
  if (!conjunto_id || !apartamento) {
    return res.status(400).json({ error: 'conjunto_id y apartamento requeridos' });
  }

  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.estado,
            u.nombre AS auditor
     FROM visitas v
     JOIN usuarios u ON u.id = v.auditor_id
     WHERE v.conjunto_id = ?
       AND v.apartamento = ?
       AND (v.torre_id = ? OR (v.torre_id IS NULL AND ? IS NULL))
       AND MONTH(v.fecha) = MONTH(CURDATE())
       AND YEAR(v.fecha)  = YEAR(CURDATE())
       AND v.estado != 'anulada'
     ORDER BY v.fecha DESC`,
    [conjunto_id, apartamento.trim(), torre_id || null, torre_id || null]
  );

  res.json({ count: rows.length, visitas: rows });
}));

// ─────────────────────────────────────────────
// POST /api/visits/upload-photo
// Sube la foto y devuelve foto_path. Sin OCR.
// ─────────────────────────────────────────────
router.post(
  '/upload-photo',
  authMiddleware,
  upload.single('foto'),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'foto requerida' });
    res.json({ foto_path: req.file.filename });
  })
);

// ─────────────────────────────────────────────
// OCR asíncrono post-guardado
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Auto-cierre compartido (subsanar + admin)
// Cierra la visita automáticamente cuando todos
// sus medidores dejan de tener requiere_revision=1
// ─────────────────────────────────────────────
async function checkAutoCloseVisita(visita_id, userId) {
  try {
    const [[{ pendientes }]] = await pool.query(
      'SELECT COUNT(*) AS pendientes FROM medidores WHERE visita_id = ? AND requiere_revision = 1',
      [visita_id]
    );
    if (pendientes > 0) return;

    const [[visita]] = await pool.query('SELECT id, estado FROM visitas WHERE id = ?', [visita_id]);
    if (!visita || visita.estado !== 'pendiente') return;

    const [meds] = await pool.query(
      'SELECT tipo, estado_revision_ocr FROM medidores WHERE visita_id = ?',
      [visita_id]
    );
    const rechazados = meds.filter(m => m.estado_revision_ocr === 'rechazado');
    const nuevoEstado   = rechazados.length > 0 ? 'rechazada' : 'aprobada';
    const motivoRechazo = rechazados.length > 0
      ? `Medidor(es) rechazado(s) automáticamente: ${rechazados.map(m => m.tipo).join(', ')}`
      : null;

    await pool.query(
      `UPDATE visitas SET estado = ?, motivo_rechazo = ?, revisado_por = ?, revisado_en = NOW() WHERE id = ?`,
      [nuevoEstado, motivoRechazo, userId, visita_id]
    );
  } catch (err) {
    logger.error(`checkAutoCloseVisita failed for visita ${visita_id}: ${err.message}`);
  }
}

async function runOcrForMedidor(medidorId, absoluteFotoPath, tipo, lecturaAuditor, auditorId = null) {
  try {
    // ── Caché: si ya tiene resultado OCR no reprocesar la misma foto ──
    const [[medCache]] = await pool.query(
      'SELECT confianza_ocr FROM medidores WHERE id = ?',
      [medidorId]
    );
    if (medCache?.confianza_ocr) {
      logger.info(`OCR cache hit medidor ${medidorId} (confianza=${medCache.confianza_ocr}) — skip`);
      return;
    }

    const result = await analizarMedidor(absoluteFotoPath, tipo, { modo: 'preciso' });

    const [rows] = await pool.query(
      'SELECT delta, sin_acceso, visita_id FROM medidores WHERE id = ?',
      [medidorId]
    );
    if (!rows.length) return;

    const { delta, sin_acceso, visita_id } = rows[0];

    const flagDelta      = delta !== null && delta <= 0;
    const flagAcceso     = !!sin_acceso;
    const flagCalidad    = result.calidad_foto === 'mala';
    const flagNoMedidor  = result.es_medidor === false;
    const lecturaAuditorNorm = lecturaAuditor ? lecturaAuditor.replace(',', '.') : lecturaAuditor;
    // Discrepancia REAL: dígitos difieren Y la IA tiene ALTA confianza en su lectura.
    //
    // Con confianza='baja' el OCR mismo es incierto → el auditor que vio
    // físicamente el medidor tiene mayor autoridad → NO generar alerta.
    // Con confianza='alta': IA segura + dígitos distintos → revisar.
    //
    // Además se ignora el separador decimal (. vs ,) y diferencias en
    // cantidad de decimales: "0082.405" y "0082,4" son el mismo medidor.
    const flagDiscrep    = !!(
      result.lectura &&
      lecturaAuditorNorm &&
      !coincidenciaDigitos(result.lectura, lecturaAuditorNorm) &&
      result.confianza === 'alta'
    );
    const flagSinLectura = !result.lectura && !lecturaAuditor && !flagAcceso;

    const requiereRevision = (
      flagDelta || flagAcceso || flagCalidad || flagNoMedidor ||
      flagDiscrep || flagSinLectura
    ) ? 1 : 0;

    await pool.query(
      `UPDATE medidores SET
         lectura_ocr    = ?, confianza_ocr  = ?, calidad_foto   = ?,
         motivo_calidad = ?, nota_ocr       = ?, es_medidor     = ?,
         requiere_revision = ?
       WHERE id = ?`,
      [
        result.lectura || null, result.confianza, result.calidad_foto,
        result.motivo_calidad || null, result.nota || null,
        result.es_medidor ? 1 : 0,
        requiereRevision,
        medidorId,
      ]
    );

    // En flujo de subsanación: si OCR sale limpio, verificar cierre automático de visita
    if (requiereRevision === 0 && auditorId) {
      await checkAutoCloseVisita(visita_id, auditorId);
    }
  } catch (err) {
    logger.error(`OCR async failed for medidor ${medidorId}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// POST /api/visits
// Crear visita. OCR corre en background tras guardar.
// ─────────────────────────────────────────────
router.post('/', authMiddleware, ah(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      latitud, longitud, ciudad_id, conjunto_id, torre_id,
      apartamento, observaciones, medidores: medidoresBody = {},
      hora_inicio, hora_fin,
    } = req.body;

    if (!ciudad_id || !conjunto_id || !apartamento) {
      return res.status(400).json({ error: 'ciudad_id, conjunto_id y apartamento son obligatorios' });
    }

    const [visitResult] = await conn.query(
      `INSERT INTO visitas
        (auditor_id, latitud, longitud, ciudad_id, conjunto_id, torre_id, apartamento, observaciones, hora_inicio, hora_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        latitud || null, longitud || null,
        ciudad_id, conjunto_id,
        torre_id || null,
        apartamento.trim(),
        observaciones || null,
        hora_inicio ? new Date(hora_inicio) : null,
        hora_fin    ? new Date(hora_fin)    : null,
      ]
    );
    const visitaId = visitResult.insertId;

    // medidores que necesitarán OCR tras el commit
    const ocrQueue = [];

    for (const tipo of ['luz', 'agua', 'gas']) {
      const m = medidoresBody[tipo];
      if (!m) continue;

      const { foto_path, sin_acceso, motivo_sin_acceso } = m;
      // Normalizar separador decimal: coma → punto (teclado móvil)
      const lectura = m.lectura ? m.lectura.replace(',', '.') : m.lectura;

      if (!foto_path && !lectura && !sin_acceso) continue;

      // Delta histórico
      let lecturaAnterior = null;
      let delta = null;
      let primeraLectura = false;

      const [prevRows] = await conn.query(
        `SELECT m.lectura_confirmada
         FROM medidores m
         JOIN visitas v ON v.id = m.visita_id
         WHERE v.conjunto_id = ?
           AND v.apartamento = ?
           AND (v.torre_id = ? OR (v.torre_id IS NULL AND ? IS NULL))
           AND m.tipo = ?
           AND v.id != ?
           AND v.estado != 'anulada'
           AND m.lectura_confirmada IS NOT NULL
         ORDER BY v.fecha DESC
         LIMIT 1`,
        [conjunto_id, apartamento.trim(), torre_id || null, torre_id || null, tipo, visitaId]
      );

      if (prevRows.length === 0) {
        primeraLectura = true;
      } else {
        lecturaAnterior = prevRows[0].lectura_confirmada;
        const numAnterior = parseFloat(lecturaAnterior);
        const numActual   = parseFloat(lectura);
        if (!isNaN(numAnterior) && !isNaN(numActual)) {
          delta = parseFloat((numActual - numAnterior).toFixed(3));
        }
      }

      const flagDelta   = delta !== null && delta <= 0;
      const flagAcceso  = !!sin_acceso;
      const flagFoto    = !!foto_path; // OCR pending
      const flagManual  = !lectura && !sin_acceso && !foto_path;

      const requiereRevision = (flagDelta || flagAcceso || flagFoto || flagManual) ? 1 : 0;

      const [insertResult] = await conn.query(
        `INSERT INTO medidores
          (visita_id, tipo, foto_path,
           lectura_ocr, confianza_ocr, calidad_foto, motivo_calidad, nota_ocr,
           lectura_confirmada, requiere_revision,
           sin_acceso, motivo_sin_acceso,
           es_medidor,
           lectura_anterior, delta, primera_lectura)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          visitaId, tipo, foto_path || null,
          null, null, 'buena', null, null,
          lectura || null, requiereRevision,
          sin_acceso ? 1 : 0, motivo_sin_acceso || null,
          1,
          lecturaAnterior, delta, primeraLectura ? 1 : 0,
        ]
      );

      if (foto_path) {
        ocrQueue.push({ medidorId: insertResult.insertId, foto_path, tipo, lectura: lectura || null });
      }
    }

    await conn.commit();
    res.status(201).json({ id: visitaId, message: 'Visita registrada correctamente' });

    // OCR en background — no bloquea la respuesta
    if (ocrQueue.length > 0) {
      setImmediate(() => {
        const uploadsDir = path.join(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads');
        for (const { medidorId, foto_path, tipo, lectura } of ocrQueue) {
          const absolutePath = path.join(uploadsDir, foto_path);
          runOcrForMedidor(medidorId, absolutePath, tipo, lectura);
        }
      });
    }

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// ─────────────────────────────────────────────
// GET /api/visits/mine
// ─────────────────────────────────────────────
router.get('/mine', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.apartamento, v.observaciones, v.estado,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            v.latitud, v.longitud
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c  ON c.id  = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     WHERE v.auditor_id = ?
     ORDER BY v.fecha DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// ─────────────────────────────────────────────
// PATCH /api/visits/:id/anular
// ─────────────────────────────────────────────
router.patch('/:id/anular', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, estado FROM visitas WHERE id = ? AND auditor_id = ?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Visita no encontrada' });
  if (rows[0].estado !== 'pendiente') {
    return res.status(400).json({ error: `No se puede anular una visita en estado "${rows[0].estado}"` });
  }
  await pool.query('UPDATE visitas SET estado = ? WHERE id = ?', ['anulada', req.params.id]);
  res.json({ ok: true });
}));

// ─────────────────────────────────────────────
// POST /api/visits/:id/subsanar
// Auditor corrige medidores rechazados y re-envía
// ─────────────────────────────────────────────
router.post('/:id/subsanar', authMiddleware, ah(async (req, res) => {
  // 1. Validar visita
  const [[visita]] = await pool.query(
    'SELECT id, estado, auditor_id FROM visitas WHERE id = ?',
    [req.params.id]
  );
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  if (visita.auditor_id !== req.user.id) return res.status(403).json({ error: 'No autorizado' });
  if (visita.estado !== 'rechazada') {
    return res.status(400).json({ error: 'Solo se pueden subsanar visitas rechazadas' });
  }

  // 2. Obtener medidores rechazados
  const [rechazados] = await pool.query(
    "SELECT id, tipo FROM medidores WHERE visita_id = ? AND estado_revision_ocr = 'rechazado'",
    [req.params.id]
  );
  if (!rechazados.length) {
    return res.status(400).json({ error: 'No hay medidores rechazados para subsanar' });
  }

  const { medidores: medBody = {} } = req.body;
  const ocrQueue = [];

  for (const med of rechazados) {
    const datos = medBody[med.id];
    if (!datos) continue;

    const lectura = datos.lectura ? datos.lectura.replace(',', '.') : null;

    if (datos.foto_path) {
      // Nueva foto → reset completo + OCR pendiente
      await pool.query(
        `UPDATE medidores SET
           foto_path           = ?,
           lectura_confirmada  = COALESCE(?, lectura_confirmada),
           lectura_ocr         = NULL,
           confianza_ocr       = NULL,
           calidad_foto        = 'buena',
           motivo_calidad      = NULL,
           nota_ocr            = NULL,
           es_medidor          = 1,
           requiere_revision   = 1,
           estado_revision_ocr = NULL,
           revisado_por        = NULL,
           revisado_en         = NULL
         WHERE id = ?`,
        [datos.foto_path, lectura, med.id]
      );
      ocrQueue.push({ medidorId: med.id, foto_path: datos.foto_path, tipo: med.tipo, lectura });
    } else if (lectura) {
      // Solo lectura nueva (sin foto) → corrección manual, sin OCR
      await pool.query(
        `UPDATE medidores SET
           lectura_confirmada  = ?,
           requiere_revision   = 0,
           estado_revision_ocr = 'corregido',
           revisado_por        = NULL,
           revisado_en         = NULL
         WHERE id = ?`,
        [lectura, med.id]
      );
    }
  }

  // 3. Resetear visita a pendiente
  await pool.query(
    "UPDATE visitas SET estado = 'pendiente', motivo_rechazo = NULL WHERE id = ?",
    [req.params.id]
  );

  // 4. Si no hay fotos nuevas (todo fue corrección manual), verificar cierre inmediato
  if (ocrQueue.length === 0) {
    await checkAutoCloseVisita(req.params.id, req.user.id);
  }

  res.json({ ok: true });

  // 5. OCR en background para las fotos nuevas
  if (ocrQueue.length > 0) {
    const auditorId = req.user.id;
    setImmediate(() => {
      const uploadsDir = path.join(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads');
      for (const { medidorId, foto_path, tipo, lectura } of ocrQueue) {
        const absolutePath = path.join(uploadsDir, foto_path);
        runOcrForMedidor(medidorId, absolutePath, tipo, lectura, auditorId);
      }
    });
  }
}));

// ─────────────────────────────────────────────
// GET /api/visits/:id
// ─────────────────────────────────────────────
router.get('/:id', authMiddleware, ah(async (req, res) => {
  const [visits] = await pool.query(
    `SELECT v.*, u.nombre AS auditor,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre
     FROM visitas v
     JOIN usuarios u  ON u.id  = v.auditor_id
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c  ON c.id  = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     WHERE v.id = ?`,
    [req.params.id]
  );
  if (!visits.length) return res.status(404).json({ error: 'Visita no encontrada' });

  const [medidores] = await pool.query(
    'SELECT * FROM medidores WHERE visita_id = ?',
    [req.params.id]
  );

  res.json({ ...visits[0], medidores });
}));

module.exports = router;
