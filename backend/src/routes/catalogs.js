const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const ah = require('../middleware/asyncHandler');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Ciudades ──────────────────────────────────────────────────────────────────

// GET /api/catalogs/ciudades
router.get('/ciudades', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre FROM ciudades WHERE activo = 1 ORDER BY nombre');
  res.json(rows);
}));

// POST /api/catalogs/ciudades  (solo admin)
router.post('/ciudades', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const [result] = await pool.query('INSERT INTO ciudades (nombre) VALUES (?)', [nombre.trim()]);
  res.status(201).json({ id: result.insertId, nombre });
}));

// ── Conjuntos ─────────────────────────────────────────────────────────────────

// GET /api/catalogs/conjuntos/all  — todos para caché offline
router.get('/conjuntos/all', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.ciudad_id, c.direccion
     FROM conjuntos c WHERE c.activo = 1 ORDER BY c.nombre`
  );
  res.json(rows);
}));

// GET /api/catalogs/conjuntos?ciudad_id=1
router.get('/conjuntos', authMiddleware, ah(async (req, res) => {
  const { ciudad_id } = req.query;
  const where = ciudad_id ? 'WHERE c.ciudad_id = ? AND c.activo = 1' : 'WHERE c.activo = 1';
  const params = ciudad_id ? [ciudad_id] : [];
  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.direccion, ci.nombre AS ciudad
     FROM conjuntos c JOIN ciudades ci ON ci.id = c.ciudad_id ${where} ORDER BY c.nombre`,
    params
  );
  res.json(rows);
}));

// POST /api/catalogs/conjuntos  (solo admin)
router.post('/conjuntos', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { nombre, ciudad_id, direccion } = req.body;
  if (!nombre || !ciudad_id) return res.status(400).json({ error: 'Nombre y ciudad_id requeridos' });
  const [result] = await pool.query(
    'INSERT INTO conjuntos (nombre, ciudad_id, direccion) VALUES (?, ?, ?)',
    [nombre.trim(), ciudad_id, direccion || null]
  );
  res.status(201).json({ id: result.insertId, nombre, ciudad_id, direccion });
}));

// PATCH /api/catalogs/conjuntos/:id  (solo admin)
router.patch('/conjuntos/:id', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { nombre, direccion, activo } = req.body;
  await pool.query(
    'UPDATE conjuntos SET nombre = COALESCE(?, nombre), direccion = COALESCE(?, direccion), activo = COALESCE(?, activo) WHERE id = ?',
    [nombre, direccion, activo, req.params.id]
  );
  res.json({ ok: true });
}));

// ── Torres ────────────────────────────────────────────────────────────────────

// GET /api/catalogs/torres/all  — todas para caché offline
router.get('/torres/all', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, nombre, conjunto_id FROM torres WHERE activo = 1 ORDER BY nombre'
  );
  res.json(rows);
}));

// GET /api/catalogs/torres?conjunto_id=1
router.get('/torres', authMiddleware, ah(async (req, res) => {
  const { conjunto_id } = req.query;
  if (!conjunto_id) return res.status(400).json({ error: 'conjunto_id requerido' });
  const [rows] = await pool.query(
    'SELECT id, nombre FROM torres WHERE conjunto_id = ? AND activo = 1 ORDER BY nombre',
    [conjunto_id]
  );
  res.json(rows);
}));

// POST /api/catalogs/torres  (solo admin)
router.post('/torres', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { nombre, conjunto_id } = req.body;
  if (!nombre || !conjunto_id) return res.status(400).json({ error: 'Nombre y conjunto_id requeridos' });
  const [result] = await pool.query(
    'INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)',
    [nombre.trim(), conjunto_id]
  );
  res.status(201).json({ id: result.insertId, nombre, conjunto_id });
}));

// POST /api/catalogs/import  — importar desde Excel (ciudad | conjunto | torre)
router.post('/import', authMiddleware, requireRole('admin'), memUpload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  const sheet = workbook.worksheets[0];

  const created = { ciudades: 0, conjuntos: 0, torres: 0 };
  const errors  = [];

  // Cache local para evitar N+1 queries
  const ciudadCache   = {};
  const conjuntoCache = {};

  let rowNum = 0;
  for (const row of sheet) {
    rowNum++;
    if (rowNum === 1) continue; // encabezado

    const ciudadNombre  = row.getCell(1).text?.trim();
    const conjNombre    = row.getCell(2).text?.trim();
    const torreNombre   = row.getCell(3).text?.trim();

    if (!ciudadNombre || !conjNombre) {
      if (ciudadNombre || conjNombre || torreNombre)
        errors.push(`Fila ${rowNum}: ciudad y conjunto son obligatorios`);
      continue;
    }

    try {
      // Ciudad — get or create
      if (!ciudadCache[ciudadNombre]) {
        const [rows] = await pool.query('SELECT id FROM ciudades WHERE nombre = ?', [ciudadNombre]);
        if (rows.length) {
          ciudadCache[ciudadNombre] = rows[0].id;
        } else {
          const [r] = await pool.query('INSERT INTO ciudades (nombre) VALUES (?)', [ciudadNombre]);
          ciudadCache[ciudadNombre] = r.insertId;
          created.ciudades++;
        }
      }
      const ciudadId = ciudadCache[ciudadNombre];

      // Conjunto — get or create
      const conjKey = `${ciudadId}:${conjNombre}`;
      if (!conjuntoCache[conjKey]) {
        const [rows] = await pool.query(
          'SELECT id FROM conjuntos WHERE nombre = ? AND ciudad_id = ?',
          [conjNombre, ciudadId]
        );
        if (rows.length) {
          conjuntoCache[conjKey] = rows[0].id;
        } else {
          const [r] = await pool.query(
            'INSERT INTO conjuntos (nombre, ciudad_id) VALUES (?, ?)',
            [conjNombre, ciudadId]
          );
          conjuntoCache[conjKey] = r.insertId;
          created.conjuntos++;
        }
      }
      const conjId = conjuntoCache[conjKey];

      // Torre — get or create (opcional)
      if (torreNombre) {
        const [rows] = await pool.query(
          'SELECT id FROM torres WHERE nombre = ? AND conjunto_id = ?',
          [torreNombre, conjId]
        );
        if (!rows.length) {
          await pool.query('INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)', [torreNombre, conjId]);
          created.torres++;
        }
      }
    } catch (err) {
      errors.push(`Fila ${rowNum}: ${err.message}`);
    }
  }

  res.json({ created, errors, total_filas: rowNum - 1 });
}));

module.exports = router;
