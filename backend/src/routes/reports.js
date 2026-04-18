const router = require('express').Router();
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const ah = require('../middleware/asyncHandler');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4005';

function calcDuracion(inicio, fin) {
  if (!inicio || !fin) return '';
  const ms = new Date(fin) - new Date(inicio);
  if (ms <= 0) return '';
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg} seg`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// GET /api/reports/excel
router.get('/excel', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { desde, hasta, ciudad_id, conjunto_id } = req.query;
  const conditions = [];
  const params = [];

  if (desde)       { conditions.push('DATE(v.fecha) >= ?'); params.push(desde); }
  if (hasta)       { conditions.push('DATE(v.fecha) <= ?'); params.push(hasta); }
  if (ciudad_id)   { conditions.push('v.ciudad_id = ?');   params.push(ciudad_id); }
  if (conjunto_id) { conditions.push('v.conjunto_id = ?'); params.push(conjunto_id); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [visitas] = await pool.query(
    `SELECT v.id, v.fecha, v.hora_inicio, v.hora_fin, v.apartamento, v.observaciones,
            v.latitud, v.longitud, v.estado, v.motivo_rechazo,
            ci.nombre AS ciudad, c.nombre AS conjunto, t.nombre AS torre,
            u.nombre AS auditor
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c ON c.id = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id = v.auditor_id
     ${where}
     ORDER BY v.fecha DESC`,
    params
  );

  // Cargar medidores de todas las visitas en una sola query
  const visitaIds = visitas.map(v => v.id);
  let medidoresMap = {};
  if (visitaIds.length) {
    const [medidores] = await pool.query(
      `SELECT visita_id, tipo, foto_path, lectura_confirmada, confianza_ocr, requiere_revision, sin_acceso, motivo_sin_acceso
       FROM medidores WHERE visita_id IN (?)`,
      [visitaIds]
    );
    medidores.forEach(m => {
      if (!medidoresMap[m.visita_id]) medidoresMap[m.visita_id] = {};
      medidoresMap[m.visita_id][m.tipo] = m;
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LecturIA';
  const sheet = workbook.addWorksheet('Visitas');

  sheet.columns = [
    { header: 'ID',               key: 'id',                width: 6  },
    { header: 'Fecha',            key: 'fecha',             width: 20 },
    { header: 'Hora Inicio',      key: 'hora_inicio',       width: 11 },
    { header: 'Hora Fin',         key: 'hora_fin',          width: 11 },
    { header: 'Duración',         key: 'duracion',          width: 10 },
    { header: 'Ciudad',           key: 'ciudad',            width: 16 },
    { header: 'Conjunto',         key: 'conjunto',          width: 20 },
    { header: 'Torre',            key: 'torre',             width: 10 },
    { header: 'Apartamento',      key: 'apartamento',       width: 12 },
    { header: 'Auditor',          key: 'auditor',           width: 18 },
    { header: 'Latitud',          key: 'latitud',           width: 13 },
    { header: 'Longitud',         key: 'longitud',          width: 13 },
    { header: 'Lect. Luz',        key: 'lectura_luz',       width: 13 },
    { header: 'Sin Acceso Luz',   key: 'sin_acceso_luz',    width: 14 },
    { header: 'Motivo Luz',       key: 'motivo_luz',        width: 30 },
    { header: 'Foto Luz',         key: 'foto_luz_nombre',   width: 34 },
    { header: 'Link Foto Luz',    key: 'foto_luz_link',     width: 50 },
    { header: 'Confianza Luz',    key: 'conf_luz',          width: 13 },
    { header: 'Lect. Agua',       key: 'lectura_agua',      width: 13 },
    { header: 'Sin Acceso Agua',  key: 'sin_acceso_agua',   width: 14 },
    { header: 'Motivo Agua',      key: 'motivo_agua',       width: 30 },
    { header: 'Foto Agua',        key: 'foto_agua_nombre',  width: 34 },
    { header: 'Link Foto Agua',   key: 'foto_agua_link',    width: 50 },
    { header: 'Confianza Agua',   key: 'conf_agua',         width: 13 },
    { header: 'Lect. Gas',        key: 'lectura_gas',       width: 13 },
    { header: 'Sin Acceso Gas',   key: 'sin_acceso_gas',    width: 14 },
    { header: 'Motivo Gas',       key: 'motivo_gas',        width: 30 },
    { header: 'Foto Gas',         key: 'foto_gas_nombre',   width: 34 },
    { header: 'Link Foto Gas',    key: 'foto_gas_link',     width: 50 },
    { header: 'Confianza Gas',    key: 'conf_gas',          width: 13 },
    { header: 'Observaciones',    key: 'observaciones',     width: 35 },
    { header: 'Estado',           key: 'estado',            width: 12 },
    { header: 'Motivo Rechazo',   key: 'motivo_rechazo',    width: 30 },
  ];

  // Estilo encabezado
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF3B82F6' } } };
  });

  const ESTADO_COLOR = { aprobada: 'FFD1FAE5', rechazada: 'FFFEE2E2', pendiente: 'FFFEF3C7' };
  const CONF_COLOR   = { alta: 'FFD1FAE5', media: 'FFFEF3C7', baja: 'FFFEE2E2' };

  visitas.forEach((v, i) => {
    const med = medidoresMap[v.id] || {};
    const fotoLink = (tipo) => med[tipo]?.foto_path
      ? `${BASE_URL}/uploads/${med[tipo].foto_path}` : '';

    const rowData = {
      id:              v.id,
      fecha:           new Date(v.fecha).toLocaleString('es-CO'),
      hora_inicio:     v.hora_inicio ? new Date(v.hora_inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '',
      hora_fin:        v.hora_fin    ? new Date(v.hora_fin).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '',
      duracion:        calcDuracion(v.hora_inicio, v.hora_fin),
      ciudad:          v.ciudad,
      conjunto:        v.conjunto,
      torre:           v.torre || '–',
      apartamento:     v.apartamento,
      auditor:         v.auditor,
      latitud:         v.latitud  ?? '',
      longitud:        v.longitud ?? '',
      lectura_luz:     med.luz?.lectura_confirmada   ?? '',
      sin_acceso_luz:  med.luz?.sin_acceso ? 'Sí' : '',
      motivo_luz:      med.luz?.motivo_sin_acceso   ?? '',
      foto_luz_nombre: med.luz?.foto_path            ?? '',
      foto_luz_link:   fotoLink('luz'),
      conf_luz:        med.luz?.confianza_ocr         ?? '',
      lectura_agua:    med.agua?.lectura_confirmada  ?? '',
      sin_acceso_agua: med.agua?.sin_acceso ? 'Sí' : '',
      motivo_agua:     med.agua?.motivo_sin_acceso   ?? '',
      foto_agua_nombre:med.agua?.foto_path           ?? '',
      foto_agua_link:  fotoLink('agua'),
      conf_agua:       med.agua?.confianza_ocr        ?? '',
      lectura_gas:     med.gas?.lectura_confirmada   ?? '',
      sin_acceso_gas:  med.gas?.sin_acceso ? 'Sí' : '',
      motivo_gas:      med.gas?.motivo_sin_acceso    ?? '',
      foto_gas_nombre: med.gas?.foto_path            ?? '',
      foto_gas_link:   fotoLink('gas'),
      conf_gas:        med.gas?.confianza_ocr         ?? '',
      observaciones:   v.observaciones ?? '',
      estado:          v.estado ?? 'pendiente',
      motivo_rechazo:  v.motivo_rechazo ?? '',
    };

    const r = sheet.addRow(rowData);
    r.height = 18;

    // Zebra
    if (i % 2 === 1) {
      r.eachCell(cell => {
        if (!cell.fill?.fgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }

    // Color estado
    const estadoColor = ESTADO_COLOR[rowData.estado];
    if (estadoColor) r.getCell('estado').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: estadoColor } };

    // Color confianza
    ['luz','agua','gas'].forEach(t => {
      const conf = med[t]?.confianza_ocr;
      if (conf && CONF_COLOR[conf]) {
        r.getCell(`conf_${t}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONF_COLOR[conf] } };
      }
      // Hacer link clickeable
      const linkCell = r.getCell(`foto_${t}_link`);
      if (linkCell.value) {
        linkCell.value = { text: 'Ver foto', hyperlink: linkCell.value };
        linkCell.font  = { color: { argb: 'FF3B82F6' }, underline: true };
      }
    });
  });

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="lectura-ia-${Date.now()}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = router;
