const router = require('express').Router();
const path = require('path');
const { pool } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { analizarMedidor } = require('../services/ocr');

// POST /api/visits  — crear visita con medidores y fotos
// multipart/form-data: campos del formulario + hasta 3 archivos (foto_luz, foto_agua, foto_gas)
router.post(
  '/',
  authMiddleware,
  upload.fields([
    { name: 'foto_luz', maxCount: 1 },
    { name: 'foto_agua', maxCount: 1 },
    { name: 'foto_gas', maxCount: 1 },
  ]),
  async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const {
        latitud, longitud, ciudad_id, conjunto_id, torre_id,
        apartamento, observaciones,
        lectura_luz, lectura_agua, lectura_gas,
      } = req.body;

      if (!ciudad_id || !conjunto_id || !apartamento) {
        return res.status(400).json({ error: 'ciudad_id, conjunto_id y apartamento son obligatorios' });
      }

      // Insertar visita
      const [visitResult] = await conn.query(
        `INSERT INTO visitas
          (auditor_id, latitud, longitud, ciudad_id, conjunto_id, torre_id, apartamento, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          latitud || null, longitud || null,
          ciudad_id, conjunto_id,
          torre_id || null,
          apartamento.trim(),
          observaciones || null,
        ]
      );
      const visitaId = visitResult.insertId;

      // Procesar cada medidor
      const tiposMedidor = ['luz', 'agua', 'gas'];
      for (const tipo of tiposMedidor) {
        const fotoFile = req.files?.[`foto_${tipo}`]?.[0];
        const lecturaManual = req.body[`lectura_${tipo}`] || null;

        if (!fotoFile && !lecturaManual) continue; // este medidor no fue registrado

        let lecturaOcr = null;
        let confianzaOcr = null;
        let requiereRevision = false;
        let notaOcr = null;
        const fotoPath = fotoFile ? fotoFile.filename : null;

        if (fotoFile) {
          const absolutePath = path.join(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads', fotoFile.filename);
          const ocrResult = await analizarMedidor(absolutePath, tipo);
          lecturaOcr = ocrResult.lectura;
          confianzaOcr = ocrResult.confianza;
          requiereRevision = ocrResult.requiere_revision;
          notaOcr = ocrResult.nota;
        }

        await conn.query(
          `INSERT INTO medidores
            (visita_id, tipo, foto_path, lectura_ocr, confianza_ocr, lectura_manual, lectura_confirmada, requiere_revision, nota_ocr)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            visitaId, tipo, fotoPath,
            lecturaOcr, confianzaOcr,
            lecturaManual,
            lecturaOcr || lecturaManual, // confirmada = OCR si existe, si no la manual
            requiereRevision ? 1 : 0,
            notaOcr,
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
  }
);

// GET /api/visits/mine  — visitas del auditor autenticado
router.get('/mine', authMiddleware, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.apartamento, v.observaciones,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            v.latitud, v.longitud
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     WHERE v.auditor_id = ?
     ORDER BY v.fecha DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// GET /api/visits/:id  — detalle de una visita con sus medidores
router.get('/:id', authMiddleware, async (req, res) => {
  const [visits] = await pool.query(
    `SELECT v.*, u.nombre AS auditor,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre
     FROM visitas v
     JOIN usuarios u ON u.id = v.auditor_id
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
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
});

module.exports = router;
