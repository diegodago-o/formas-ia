const router = require('express').Router();
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ── Ciudades ──────────────────────────────────────────────────────────────────

// GET /api/catalogs/ciudades
router.get('/ciudades', authMiddleware, async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre FROM ciudades WHERE activo = 1 ORDER BY nombre');
  res.json(rows);
});

// POST /api/catalogs/ciudades  (solo admin)
router.post('/ciudades', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const [result] = await pool.query('INSERT INTO ciudades (nombre) VALUES (?)', [nombre.trim()]);
  res.status(201).json({ id: result.insertId, nombre });
});

// ── Conjuntos ─────────────────────────────────────────────────────────────────

// GET /api/catalogs/conjuntos?ciudad_id=1
router.get('/conjuntos', authMiddleware, async (req, res) => {
  const { ciudad_id } = req.query;
  const where = ciudad_id ? 'WHERE c.ciudad_id = ? AND c.activo = 1' : 'WHERE c.activo = 1';
  const params = ciudad_id ? [ciudad_id] : [];
  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.direccion, ci.nombre AS ciudad
     FROM conjuntos c JOIN ciudades ci ON ci.id = c.ciudad_id ${where} ORDER BY c.nombre`,
    params
  );
  res.json(rows);
});

// POST /api/catalogs/conjuntos  (solo admin)
router.post('/conjuntos', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nombre, ciudad_id, direccion } = req.body;
  if (!nombre || !ciudad_id) return res.status(400).json({ error: 'Nombre y ciudad_id requeridos' });
  const [result] = await pool.query(
    'INSERT INTO conjuntos (nombre, ciudad_id, direccion) VALUES (?, ?, ?)',
    [nombre.trim(), ciudad_id, direccion || null]
  );
  res.status(201).json({ id: result.insertId, nombre, ciudad_id, direccion });
});

// PATCH /api/catalogs/conjuntos/:id  (solo admin)
router.patch('/conjuntos/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nombre, direccion, activo } = req.body;
  await pool.query(
    'UPDATE conjuntos SET nombre = COALESCE(?, nombre), direccion = COALESCE(?, direccion), activo = COALESCE(?, activo) WHERE id = ?',
    [nombre, direccion, activo, req.params.id]
  );
  res.json({ ok: true });
});

// ── Torres ────────────────────────────────────────────────────────────────────

// GET /api/catalogs/torres?conjunto_id=1
router.get('/torres', authMiddleware, async (req, res) => {
  const { conjunto_id } = req.query;
  if (!conjunto_id) return res.status(400).json({ error: 'conjunto_id requerido' });
  const [rows] = await pool.query(
    'SELECT id, nombre FROM torres WHERE conjunto_id = ? AND activo = 1 ORDER BY nombre',
    [conjunto_id]
  );
  res.json(rows);
});

// POST /api/catalogs/torres  (solo admin)
router.post('/torres', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nombre, conjunto_id } = req.body;
  if (!nombre || !conjunto_id) return res.status(400).json({ error: 'Nombre y conjunto_id requeridos' });
  const [result] = await pool.query(
    'INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)',
    [nombre.trim(), conjunto_id]
  );
  res.status(201).json({ id: result.insertId, nombre, conjunto_id });
});

module.exports = router;
