const router = require('express').Router();
const path = require('path');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { analizarMedidor } = require('../services/ocr');
const ah = require('../middleware/asyncHandler');

// ─────────────────────────────────────────────
// GET /api/visits/check-duplicate
// Verifica si ya existe una visita para el mismo apartamento en el mes actual
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
// POST /api/visits/ocr-preview
// OCR inmediato de una foto sin guardar visita aún
// ─────────────────────────────────────────────
router.post(
  '/ocr-preview',
  authMiddleware,
  upload.single('foto'),
  ah(async (req, res) => {
    const { tipo } = req.body;
    if (!req.file) return res.status(400).json({ error: 'foto requerida' });
    if (!['luz', 'agua', 'gas'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });

    const absolutePath = path.join(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads', req.file.filename);
    const result = await analizarMedidor(absolutePath, tipo);
    res.json({ ...result, foto_path: req.file.filename });
  })
);

// ─────────────────────────────────────────────
// POST /api/visits
// Crear visita. Las fotos ya fueron subidas vía /ocr-preview.
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

    // ── Insertar visita ──
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

    // ── Registrar cada medidor ──
    for (const tipo of ['luz', 'agua', 'gas']) {
      const m = medidoresBody[tipo];
      if (!m) continue;

      const {
        foto_path, lectura,
        lectura_ocr, confianza_ocr, calidad_foto, motivo_calidad, nota_ocr,
        sin_acceso, motivo_sin_acceso,
      } = m;

      if (!foto_path && !lectura && !sin_acceso) continue;

      // ── Delta histórico: buscar lectura anterior del mismo apto + tipo ──
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

      // ── Determinar requiere_revision ──
      const flagCalidad = (calidad_foto === 'mala');
      const flagLectura = !lectura && !sin_acceso;             // sin lectura y no es sin_acceso
      const flagDelta   = delta !== null && delta <= 0;        // negativo o igual
      const flagAcceso  = !!sin_acceso;

      const requiereRevision = flagCalidad || flagLectura || flagDelta || flagAcceso ? 1 : 0;

      await conn.query(
        `INSERT INTO medidores
          (visita_id, tipo, foto_path,
           lectura_ocr, confianza_ocr, calidad_foto, motivo_calidad, nota_ocr,
           lectura_confirmada, requiere_revision,
           sin_acceso, motivo_sin_acceso,
           lectura_anterior, delta, primera_lectura)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          visitaId, tipo, foto_path || null,
          lectura_ocr || null, confianza_ocr || null,
          calidad_foto || 'buena', motivo_calidad || null, nota_ocr || null,
          lectura || null, requiereRevision,
          sin_acceso ? 1 : 0, motivo_sin_acceso || null,
          lecturaAnterior, delta, primeraLectura ? 1 : 0,
        ]
      );
    }

    await conn.commit();
    res.status(201).json({ id: visitaId, message: 'Visita registrada correctamente' });
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
