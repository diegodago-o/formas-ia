const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const ah = require('../middleware/asyncHandler');

const isAdmin = [authMiddleware, requireRole('admin')];

// GET /api/admin/stats  — métricas para el dashboard
router.get('/stats', ...isAdmin, ah(async (req, res) => {
  const [[estados]] = await pool.query(
    `SELECT
       COUNT(*)                                          AS total,
       SUM(estado = 'pendiente')                        AS pendiente,
       SUM(estado = 'aprobada')                         AS aprobada,
       SUM(estado = 'rechazada')                        AS rechazada,
       SUM(estado = 'anulada')                          AS anulada,
       SUM(EXISTS (
         SELECT 1 FROM medidores m
         WHERE m.visita_id = v.id AND m.requiere_revision = 1
       ) AND estado NOT IN ('rechazada','anulada','aprobada')) AS alertas_pendientes,
       SUM(estado IN ('aprobada','rechazada'))           AS revisadas
     FROM visitas v`
  );

  const [porCiudad] = await pool.query(
    `SELECT ci.nombre AS ciudad, COUNT(*) AS total
     FROM visitas v JOIN ciudades ci ON ci.id = v.ciudad_id
     GROUP BY v.ciudad_id, ci.nombre
     ORDER BY total DESC`
  );

  res.json({ ...estados, por_ciudad: porCiudad });
}));

// GET /api/admin/visits  — todas las visitas con filtros
router.get('/visits', ...isAdmin, ah(async (req, res) => {
  const { ciudad_id, conjunto_id, auditor_id, desde, hasta, requiere_revision, estado, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (ciudad_id)        { conditions.push('v.ciudad_id = ?');    params.push(ciudad_id); }
  if (conjunto_id)      { conditions.push('v.conjunto_id = ?');  params.push(conjunto_id); }
  if (auditor_id)       { conditions.push('v.auditor_id = ?');   params.push(auditor_id); }
  if (desde)            { conditions.push('DATE(v.fecha) >= ?'); params.push(desde); }
  if (hasta)            { conditions.push('DATE(v.fecha) <= ?'); params.push(hasta); }
  if (estado)           { conditions.push('v.estado = ?');       params.push(estado); }
  if (requiere_revision === '1') {
    conditions.push('EXISTS (SELECT 1 FROM medidores m WHERE m.visita_id = v.id AND m.requiere_revision = 1)');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM visitas v ${where}`, params
  );
  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.hora_inicio, v.hora_fin, v.apartamento, v.estado,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            u.nombre AS auditor,
            (SELECT COUNT(*) FROM medidores m WHERE m.visita_id = v.id AND m.requiere_revision = 1) AS alertas_ocr
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id = v.auditor_id
     ${where}
     ORDER BY v.fecha DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), parseInt(offset)]
  );

  res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
}));

// GET /api/admin/visits/:id  — detalle completo de una visita con medidores
router.get('/visits/:id', ...isAdmin, ah(async (req, res) => {
  const [visits] = await pool.query(
    `SELECT v.*, u.nombre AS auditor,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            rv.nombre AS revisado_por_nombre
     FROM visitas v
     JOIN usuarios u ON u.id = v.auditor_id
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     LEFT JOIN usuarios rv ON rv.id = v.revisado_por
     WHERE v.id = ?`,
    [req.params.id]
  );
  if (!visits.length) return res.status(404).json({ error: 'Visita no encontrada' });

  const [medidores] = await pool.query(
    'SELECT * FROM medidores WHERE visita_id = ? ORDER BY tipo',
    [req.params.id]
  );

  res.json({ ...visits[0], medidores });
}));

// PATCH /api/admin/visits/:id/ubicacion  — corregir ciudad/conjunto/torre/apartamento
router.patch('/visits/:id/ubicacion', ...isAdmin, ah(async (req, res) => {
  const { ciudad_id, conjunto_id, torre_id, apartamento } = req.body;

  if (!ciudad_id || !conjunto_id || !apartamento?.trim()) {
    return res.status(400).json({ error: 'ciudad_id, conjunto_id y apartamento son requeridos' });
  }

  // Validar que el conjunto pertenece a la ciudad
  const [[conj]] = await pool.query(
    'SELECT id FROM conjuntos WHERE id = ? AND ciudad_id = ? AND activo = 1',
    [conjunto_id, ciudad_id]
  );
  if (!conj) return res.status(400).json({ error: 'El conjunto no pertenece a la ciudad indicada' });

  // Validar que la torre pertenece al conjunto (si se envía)
  if (torre_id) {
    const [[torre]] = await pool.query(
      'SELECT id FROM torres WHERE id = ? AND conjunto_id = ? AND activo = 1',
      [torre_id, conjunto_id]
    );
    if (!torre) return res.status(400).json({ error: 'La torre no pertenece al conjunto indicado' });
  }

  // Validar que la visita existe y no está anulada
  const [[visita]] = await pool.query('SELECT id, estado FROM visitas WHERE id = ?', [req.params.id]);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  if (visita.estado === 'anulada') return res.status(400).json({ error: 'No se puede editar una visita anulada' });

  await pool.query(
    `UPDATE visitas
     SET ciudad_id   = ?,
         conjunto_id = ?,
         torre_id    = ?,
         apartamento = ?,
         revisado_por = ?,
         revisado_en  = NOW()
     WHERE id = ?`,
    [ciudad_id, conjunto_id, torre_id || null, apartamento.trim(), req.user.id, req.params.id]
  );

  res.json({ ok: true });
}));

// PATCH /api/admin/visits/:id/estado  — aprobar o rechazar visita
router.patch('/visits/:id/estado', ...isAdmin, ah(async (req, res) => {
  const { estado, motivo_rechazo } = req.body;
  if (!['aprobada', 'rechazada'].includes(estado)) {
    return res.status(400).json({ error: 'estado debe ser aprobada o rechazada' });
  }
  if (estado === 'rechazada' && !motivo_rechazo?.trim()) {
    return res.status(400).json({ error: 'motivo_rechazo requerido al rechazar' });
  }
  await pool.query(
    `UPDATE visitas SET estado = ?, motivo_rechazo = ?, revisado_por = ?, revisado_en = NOW() WHERE id = ?`,
    [estado, motivo_rechazo || null, req.user.id, req.params.id]
  );
  res.json({ ok: true });
}));

// PATCH /api/admin/medidores/:id  — resolver hallazgo OCR de un medidor
router.patch('/medidores/:id', ...isAdmin, ah(async (req, res) => {
  const { lectura_confirmada, estado_revision_ocr } = req.body;

  const estadosValidos = ['aprobado', 'rechazado', 'corregido'];
  if (!lectura_confirmada && !estado_revision_ocr) {
    return res.status(400).json({ error: 'Debes proporcionar lectura_confirmada o estado_revision_ocr' });
  }
  if (estado_revision_ocr && !estadosValidos.includes(estado_revision_ocr)) {
    return res.status(400).json({ error: 'estado_revision_ocr inválido' });
  }

  await pool.query(
    `UPDATE medidores
     SET lectura_confirmada  = COALESCE(?, lectura_confirmada),
         estado_revision_ocr = COALESCE(?, estado_revision_ocr),
         requiere_revision   = 0,
         revisado_por        = ?,
         revisado_en         = NOW()
     WHERE id = ?`,
    [lectura_confirmada || null, estado_revision_ocr || null, req.user.id, req.params.id]
  );
  res.json({ ok: true });
}));

// GET /api/admin/alerts  — medidores que requieren revisión
router.get('/alerts', ...isAdmin, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.id AS medidor_id, m.tipo, m.foto_path,
            m.lectura_ocr, m.confianza_ocr, m.nota_ocr,
            m.lectura_manual, m.lectura_confirmada,
            m.calidad_foto, m.motivo_calidad,
            m.sin_acceso, m.motivo_sin_acceso, m.es_medidor,
            m.estado_revision_ocr,
            v.id AS visita_id, v.fecha, v.apartamento,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            u.nombre AS auditor
     FROM medidores m
     JOIN visitas v  ON v.id  = m.visita_id
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id  = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id  = v.auditor_id
     WHERE m.requiere_revision = 1
       AND v.estado NOT IN ('aprobada', 'rechazada', 'anulada')
     ORDER BY v.fecha DESC`
  );
  res.json(rows);
}));

// GET /api/admin/users
router.get('/users', ...isAdmin, ah(async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY nombre');
  res.json(rows);
}));

// POST /api/admin/users
router.post('/users', ...isAdmin, ah(async (req, res) => {
  const { nombre, email, password, rol = 'auditor' } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
    [nombre, email, hash, rol]
  );
  res.status(201).json({ id: result.insertId, nombre, email, rol });
}));

// PATCH /api/admin/users/:id
router.patch('/users/:id', ...isAdmin, ah(async (req, res) => {
  const { nombre, activo } = req.body;
  await pool.query(
    'UPDATE usuarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?',
    [nombre, activo, req.params.id]
  );
  res.json({ ok: true });
}));

module.exports = router;
