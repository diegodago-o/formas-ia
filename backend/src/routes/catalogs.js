const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const ah = require('../middleware/asyncHandler');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const isAdmin   = [authMiddleware, requireRole('admin')];

// ── Ciudades ──────────────────────────────────────────────────────────────────

router.get('/ciudades', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre FROM ciudades WHERE activo = 1 ORDER BY nombre');
  res.json(rows);
}));

router.post('/ciudades', ...isAdmin, ah(async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const nom = nombre.trim();
  // Si existe (incluso inactiva), reactivar
  const [existing] = await pool.query('SELECT id FROM ciudades WHERE nombre = ?', [nom]);
  if (existing.length) {
    await pool.query('UPDATE ciudades SET activo = 1 WHERE id = ?', [existing[0].id]);
    return res.status(201).json({ id: existing[0].id, nombre: nom, reactivada: true });
  }
  const [result] = await pool.query('INSERT INTO ciudades (nombre) VALUES (?)', [nom]);
  res.status(201).json({ id: result.insertId, nombre: nom });
}));

router.delete('/ciudades/:id', ...isAdmin, ah(async (req, res) => {
  const [conj] = await pool.query('SELECT COUNT(*) AS n FROM conjuntos WHERE ciudad_id = ? AND activo = 1', [req.params.id]);
  if (conj[0].n > 0) return res.status(400).json({ error: 'La ciudad tiene conjuntos activos. Elimínalos primero.' });
  await pool.query('UPDATE ciudades SET activo = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ── Conjuntos ─────────────────────────────────────────────────────────────────

router.get('/conjuntos/all', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT c.id, c.nombre, c.ciudad_id, c.direccion FROM conjuntos c WHERE c.activo = 1 ORDER BY c.nombre'
  );
  res.json(rows);
}));

router.get('/conjuntos', authMiddleware, ah(async (req, res) => {
  const { ciudad_id } = req.query;
  const where  = ciudad_id ? 'WHERE c.ciudad_id = ? AND c.activo = 1' : 'WHERE c.activo = 1';
  const params = ciudad_id ? [ciudad_id] : [];
  const [rows] = await pool.query(
    `SELECT c.id, c.nombre, c.ciudad_id, c.direccion, ci.nombre AS ciudad
     FROM conjuntos c JOIN ciudades ci ON ci.id = c.ciudad_id ${where} ORDER BY c.nombre`,
    params
  );
  res.json(rows);
}));

router.post('/conjuntos', ...isAdmin, ah(async (req, res) => {
  const { nombre, ciudad_id, direccion, torres = [] } = req.body;
  if (!nombre || !ciudad_id) return res.status(400).json({ error: 'Nombre y ciudad_id requeridos' });
  const nom = nombre.trim();
  // Si existe (incluso inactivo), reactivar
  const [existing] = await pool.query(
    'SELECT id FROM conjuntos WHERE nombre = ? AND ciudad_id = ?', [nom, ciudad_id]
  );
  let conjId;
  if (existing.length) {
    conjId = existing[0].id;
    await pool.query(
      'UPDATE conjuntos SET activo = 1, direccion = COALESCE(?, direccion) WHERE id = ?',
      [direccion || null, conjId]
    );
  } else {
    const [result] = await pool.query(
      'INSERT INTO conjuntos (nombre, ciudad_id, direccion) VALUES (?, ?, ?)',
      [nom, ciudad_id, direccion || null]
    );
    conjId = result.insertId;
  }
  // Torres: insertar solo las que no existan ya
  for (const t of torres.filter(n => n?.trim())) {
    const [et] = await pool.query(
      'SELECT id FROM torres WHERE nombre = ? AND conjunto_id = ?', [t.trim(), conjId]
    );
    if (et.length) {
      await pool.query('UPDATE torres SET activo = 1 WHERE id = ?', [et[0].id]);
    } else {
      await pool.query('INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)', [t.trim(), conjId]);
    }
  }
  res.status(201).json({ id: conjId, nombre: nom, ciudad_id, direccion });
}));

router.delete('/conjuntos/:id', ...isAdmin, ah(async (req, res) => {
  const [vis] = await pool.query(
    'SELECT COUNT(*) AS n FROM visitas WHERE conjunto_id = ? AND estado != "anulada"', [req.params.id]
  );
  if (vis[0].n > 0) return res.status(400).json({ error: 'El conjunto tiene visitas registradas. No se puede eliminar.' });
  await pool.query('UPDATE torres    SET activo = 0 WHERE conjunto_id = ?', [req.params.id]);
  await pool.query('UPDATE conjuntos SET activo = 0 WHERE id = ?',          [req.params.id]);
  res.json({ ok: true });
}));

// ── Torres ────────────────────────────────────────────────────────────────────

router.get('/torres/all', authMiddleware, ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, nombre, conjunto_id FROM torres WHERE activo = 1 ORDER BY nombre'
  );
  res.json(rows);
}));

router.get('/torres', authMiddleware, ah(async (req, res) => {
  const { conjunto_id } = req.query;
  if (!conjunto_id) return res.status(400).json({ error: 'conjunto_id requerido' });
  const [rows] = await pool.query(
    'SELECT id, nombre FROM torres WHERE conjunto_id = ? AND activo = 1 ORDER BY nombre',
    [conjunto_id]
  );
  res.json(rows);
}));

router.post('/torres', ...isAdmin, ah(async (req, res) => {
  const { nombre, conjunto_id } = req.body;
  if (!nombre || !conjunto_id) return res.status(400).json({ error: 'Nombre y conjunto_id requeridos' });
  const nom = nombre.trim();
  // Si existe (incluso inactiva), reactivar
  const [existing] = await pool.query(
    'SELECT id FROM torres WHERE nombre = ? AND conjunto_id = ?', [nom, conjunto_id]
  );
  if (existing.length) {
    await pool.query('UPDATE torres SET activo = 1 WHERE id = ?', [existing[0].id]);
    return res.status(201).json({ id: existing[0].id, nombre: nom, conjunto_id, reactivada: true });
  }
  const [result] = await pool.query(
    'INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)', [nom, conjunto_id]
  );
  res.status(201).json({ id: result.insertId, nombre: nom, conjunto_id });
}));

router.delete('/torres/:id', ...isAdmin, ah(async (req, res) => {
  const [vis] = await pool.query(
    'SELECT COUNT(*) AS n FROM visitas WHERE torre_id = ? AND estado != "anulada"', [req.params.id]
  );
  if (vis[0].n > 0) return res.status(400).json({ error: 'La torre tiene visitas registradas. No se puede eliminar.' });
  await pool.query('UPDATE torres SET activo = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ── Importar ──────────────────────────────────────────────────────────────────

router.post('/import', ...isAdmin, memUpload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

  const ext  = req.file.originalname.split('.').pop().toLowerCase();
  const rows = [];

  if (ext === 'csv') {
    const text  = req.file.buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      rows.push({ ciudad: cols[0] || '', conjunto: cols[1] || '', torre: cols[2] || '' });
    }
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    sheet.eachRow((row, idx) => {
      if (idx === 1) return;
      rows.push({
        ciudad:   row.getCell(1).text?.trim() || '',
        conjunto: row.getCell(2).text?.trim() || '',
        torre:    row.getCell(3).text?.trim() || '',
      });
    });
  }

  const created       = { ciudades: 0, conjuntos: 0, torres: 0 };
  const errors        = [];
  const ciudadCache   = {};
  const conjuntoCache = {};

  for (let i = 0; i < rows.length; i++) {
    const { ciudad: ciudadNombre, conjunto: conjNombre, torre: torreNombre } = rows[i];
    if (!ciudadNombre || !conjNombre) {
      if (ciudadNombre || conjNombre || torreNombre)
        errors.push(`Fila ${i + 2}: ciudad y conjunto son obligatorios`);
      continue;
    }
    try {
      if (!ciudadCache[ciudadNombre]) {
        const [r] = await pool.query('SELECT id FROM ciudades WHERE nombre = ?', [ciudadNombre]);
        ciudadCache[ciudadNombre] = r.length
          ? r[0].id
          : (await pool.query('INSERT INTO ciudades (nombre) VALUES (?)', [ciudadNombre]))[0].insertId;
        if (!r.length) created.ciudades++;
      }
      const ciudadId = ciudadCache[ciudadNombre];

      const conjKey = `${ciudadId}:${conjNombre}`;
      if (!conjuntoCache[conjKey]) {
        const [r] = await pool.query('SELECT id FROM conjuntos WHERE nombre = ? AND ciudad_id = ?', [conjNombre, ciudadId]);
        conjuntoCache[conjKey] = r.length
          ? r[0].id
          : (await pool.query('INSERT INTO conjuntos (nombre, ciudad_id) VALUES (?, ?)', [conjNombre, ciudadId]))[0].insertId;
        if (!r.length) created.conjuntos++;
      }
      const conjId = conjuntoCache[conjKey];

      if (torreNombre) {
        const [r] = await pool.query('SELECT id FROM torres WHERE nombre = ? AND conjunto_id = ?', [torreNombre, conjId]);
        if (!r.length) {
          await pool.query('INSERT INTO torres (nombre, conjunto_id) VALUES (?, ?)', [torreNombre, conjId]);
          created.torres++;
        }
      }
    } catch (err) {
      errors.push(`Fila ${i + 2}: ${err.message}`);
    }
  }

  res.json({ created, errors, total_filas: rows.length });
}));

module.exports = router;
