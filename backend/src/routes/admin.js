const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const isAdmin = [authMiddleware, requireRole('admin')];

// GET /api/admin/visits  — todas las visitas con filtros
router.get('/visits', ...isAdmin, async (req, res) => {
  const { ciudad_id, conjunto_id, auditor_id, desde, hasta, requiere_revision, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (ciudad_id)        { conditions.push('v.ciudad_id = ?');    params.push(ciudad_id); }
  if (conjunto_id)      { conditions.push('v.conjunto_id = ?');  params.push(conjunto_id); }
  if (auditor_id)       { conditions.push('v.auditor_id = ?');   params.push(auditor_id); }
  if (desde)            { conditions.push('DATE(v.fecha) >= ?'); params.push(desde); }
  if (hasta)            { conditions.push('DATE(v.fecha) <= ?'); params.push(hasta); }
  if (requiere_revision === '1') {
    conditions.push('EXISTS (SELECT 1 FROM medidores m WHERE m.visita_id = v.id AND m.requiere_revision = 1)');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM visitas v ${where}`, params
  );
  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.apartamento,
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
});

// PATCH /api/admin/medidores/:id  — corregir lectura de un medidor
router.patch('/medidores/:id', ...isAdmin, async (req, res) => {
  const { lectura_confirmada } = req.body;
  if (!lectura_confirmada) return res.status(400).json({ error: 'lectura_confirmada requerida' });

  await pool.query(
    `UPDATE medidores
     SET lectura_confirmada = ?, requiere_revision = 0, revisado_por = ?, revisado_en = NOW()
     WHERE id = ?`,
    [lectura_confirmada, req.user.id, req.params.id]
  );
  res.json({ ok: true });
});

// GET /api/admin/alerts  — medidores que requieren revisión
router.get('/alerts', ...isAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.id AS medidor_id, m.tipo, m.foto_path, m.lectura_ocr, m.confianza_ocr, m.nota_ocr,
            m.lectura_manual, m.lectura_confirmada,
            v.id AS visita_id, v.fecha, v.apartamento,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            u.nombre AS auditor
     FROM medidores m
     JOIN visitas v ON v.id = m.visita_id
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id = v.auditor_id
     WHERE m.requiere_revision = 1
     ORDER BY v.fecha DESC`
  );
  res.json(rows);
});

// GET /api/admin/users
router.get('/users', ...isAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY nombre');
  res.json(rows);
});

// POST /api/admin/users
router.post('/users', ...isAdmin, async (req, res) => {
  const { nombre, email, password, rol = 'auditor' } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
    [nombre, email, hash, rol]
  );
  res.status(201).json({ id: result.insertId, nombre, email, rol });
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', ...isAdmin, async (req, res) => {
  const { nombre, activo } = req.body;
  await pool.query(
    'UPDATE usuarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?',
    [nombre, activo, req.params.id]
  );
  res.json({ ok: true });
});

module.exports = router;
