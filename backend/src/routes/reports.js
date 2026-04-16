const router = require('express').Router();
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/reports/excel?desde=&hasta=&ciudad_id=&conjunto_id=
router.get('/excel', authMiddleware, requireRole('admin'), async (req, res) => {
  const { desde, hasta, ciudad_id, conjunto_id } = req.query;
  const conditions = [];
  const params = [];

  if (desde)      { conditions.push('DATE(v.fecha) >= ?'); params.push(desde); }
  if (hasta)      { conditions.push('DATE(v.fecha) <= ?'); params.push(hasta); }
  if (ciudad_id)  { conditions.push('v.ciudad_id = ?');   params.push(ciudad_id); }
  if (conjunto_id){ conditions.push('v.conjunto_id = ?'); params.push(conjunto_id); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT v.id, v.fecha, v.apartamento, v.observaciones,
            v.latitud, v.longitud,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            u.nombre AS auditor,
            MAX(CASE WHEN m.tipo='luz'  THEN m.lectura_confirmada END) AS lectura_luz,
            MAX(CASE WHEN m.tipo='agua' THEN m.lectura_confirmada END) AS lectura_agua,
            MAX(CASE WHEN m.tipo='gas'  THEN m.lectura_confirmada END) AS lectura_gas,
            SUM(m.requiere_revision) AS alertas_pendientes
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id = v.auditor_id
     LEFT JOIN medidores m ON m.visita_id = v.id
     ${where}
     GROUP BY v.id
     ORDER BY v.fecha DESC`,
    params
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Visitas');

  sheet.columns = [
    { header: 'ID',             key: 'id',                  width: 8  },
    { header: 'Fecha',          key: 'fecha',               width: 20 },
    { header: 'Ciudad',         key: 'ciudad',              width: 18 },
    { header: 'Conjunto',       key: 'conjunto',            width: 22 },
    { header: 'Torre',          key: 'torre',               width: 12 },
    { header: 'Apartamento',    key: 'apartamento',         width: 14 },
    { header: 'Auditor',        key: 'auditor',             width: 20 },
    { header: 'Lect. Luz',      key: 'lectura_luz',         width: 14 },
    { header: 'Lect. Agua',     key: 'lectura_agua',        width: 14 },
    { header: 'Lect. Gas',      key: 'lectura_gas',         width: 14 },
    { header: 'Observaciones',  key: 'observaciones',       width: 30 },
    { header: 'Alertas OCR',    key: 'alertas_pendientes',  width: 14 },
    { header: 'Latitud',        key: 'latitud',             width: 14 },
    { header: 'Longitud',       key: 'longitud',            width: 14 },
  ];

  // Estilo de encabezado
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.getRow(1).height = 22;

  rows.forEach(row => {
    const r = sheet.addRow(row);
    if (row.alertas_pendientes > 0) {
      r.getCell('alertas_pendientes').fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC107' },
      };
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="formas-ia-reporte-${Date.now()}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
