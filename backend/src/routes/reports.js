const router = require('express').Router();
const ExcelJS = require('exceljs');
const { pool } = require('../models/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const ah = require('../middleware/asyncHandler');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4005';

// ── Helpers de formato ────────────────────────────────────────
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

const fmtFecha = (d) => d
  ? new Date(d).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '';

const fmtHora = (d) => d
  ? new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '';

const fmtFechaCorta = (d) => d
  ? new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' })
  : '';

const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function fmtDelta(delta, primeraLectura) {
  if (primeraLectura) return '1ª lectura';
  if (delta === null || delta === undefined) return '';
  const n = parseFloat(delta);
  if (isNaN(n)) return '';
  return n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3);
}

// ── Diseño de secciones ───────────────────────────────────────
// Cada sección: [etiqueta, col_desde, col_hasta, argb_fila1, argb_fila2]
// Cada medidor tiene 10 columnas (+ 2 de fecha/hora foto respecto a antes)
const SECCIONES = [
  ['IDENTIFICACIÓN DE LA VISITA',       1,  12, 'FF1E3A5F', 'FF2D5080'],
  ['MEDIDOR DE ELECTRICIDAD (kWh)',     13,  22, 'FF78350F', 'FF92400E'],
  ['MEDIDOR DE AGUA (m³)',              23,  32, 'FF1E3A8A', 'FF1D4ED8'],
  ['MEDIDOR DE GAS (m³)',               33,  42, 'FF7F1D1D', 'FF991B1B'],
  ['REVISIÓN Y ESTADO',                 43,  46, 'FF1F2937', 'FF374151'],
];

// Índice sección por columna (para fila 2)
const seccionDeColumna = (col) => SECCIONES.find(([, f, t]) => col >= f && col <= t);

// Encabezados de columna (fila 2) — 46 columnas
const COL_HEADERS = [
  // IDENTIFICACIÓN (1-12)
  '#', 'Fecha y Hora', 'Hora Inicio', 'Hora Fin', 'Duración',
  'Auditor', 'Ciudad', 'Conjunto', 'Torre', 'Apartamento',
  'Latitud', 'Longitud',
  // LUZ (13-22)
  'Lectura kWh', 'Ant. kWh', 'Consumo Δ', 'Lectura OCR',
  'Confianza IA', 'Sin Acceso', 'Motivo', 'Fecha Foto', 'Hora Foto', 'Foto',
  // AGUA (23-32)
  'Lectura m³', 'Ant. m³', 'Consumo Δ', 'Lectura OCR',
  'Confianza IA', 'Sin Acceso', 'Motivo', 'Fecha Foto', 'Hora Foto', 'Foto',
  // GAS (33-42)
  'Lectura m³', 'Ant. m³', 'Consumo Δ', 'Lectura OCR',
  'Confianza IA', 'Sin Acceso', 'Motivo', 'Fecha Foto', 'Hora Foto', 'Foto',
  // REVISIÓN (43-46)
  'Estado', 'Alerta OCR', 'Observaciones', 'Mot. Rechazo',
];

// ── Colores de datos ──────────────────────────────────────────
const ESTADO_COLOR = {
  aprobada:  'FFD1FAE5',
  rechazada: 'FFFEE2E2',
  pendiente: 'FFFEF3C7',
  anulada:   'FFF3F4F6',
};
const CONF_COLOR = { alta: 'FFD1FAE5', baja: 'FFFEE2E2' };

// ── GET /api/reports/excel ────────────────────────────────────
router.get('/excel', authMiddleware, requireRole('admin'), ah(async (req, res) => {
  const { desde, hasta, ciudad_id, conjunto_id } = req.query;
  const conditions = [];
  const params     = [];
  if (desde)       { conditions.push('DATE(v.fecha) >= ?'); params.push(desde); }
  if (hasta)       { conditions.push('DATE(v.fecha) <= ?'); params.push(hasta); }
  if (ciudad_id)   { conditions.push('v.ciudad_id = ?');   params.push(ciudad_id); }
  if (conjunto_id) { conditions.push('v.conjunto_id = ?'); params.push(conjunto_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [visitas] = await pool.query(
    `SELECT v.id, v.fecha, v.hora_inicio, v.hora_fin,
            v.apartamento, v.observaciones, v.latitud, v.longitud,
            v.estado, v.motivo_rechazo,
            ci.nombre AS ciudad, c.nombre AS conjunto,
            t.nombre AS torre, u.nombre AS auditor
     FROM visitas v
     JOIN ciudades ci ON ci.id = v.ciudad_id
     JOIN conjuntos c  ON c.id  = v.conjunto_id
     LEFT JOIN torres t ON t.id = v.torre_id
     JOIN usuarios u ON u.id = v.auditor_id
     ${where}
     ORDER BY v.fecha DESC`,
    params
  );

  let medidoresMap = {};
  if (visitas.length) {
    const ids = visitas.map(v => v.id);
    const [meds] = await pool.query(
      `SELECT visita_id, tipo,
              foto_path, hora_foto, lectura_confirmada, lectura_ocr, lectura_anterior,
              delta, primera_lectura, confianza_ocr, calidad_foto,
              requiere_revision, sin_acceso, motivo_sin_acceso
       FROM medidores WHERE visita_id IN (?)`,
      [ids]
    );
    meds.forEach(m => {
      if (!medidoresMap[m.visita_id]) medidoresMap[m.visita_id] = {};
      medidoresMap[m.visita_id][m.tipo] = m;
    });
  }

  // ── Workbook ──────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'LecturIA';
  wb.created  = new Date();

  const ws = wb.addWorksheet('Visitas', {
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
    properties: { defaultRowHeight: 17 },
  });

  // Definir anchos y keys (sin header — lo añadimos manual)
  ws.columns = [
    // IDENTIFICACIÓN
    { key: 'id',              width: 6  },
    { key: 'fecha',           width: 19 },
    { key: 'hora_inicio',     width: 10 },
    { key: 'hora_fin',        width: 10 },
    { key: 'duracion',        width: 10 },
    { key: 'auditor',         width: 20 },
    { key: 'ciudad',          width: 16 },
    { key: 'conjunto',        width: 22 },
    { key: 'torre',           width: 10 },
    { key: 'apartamento',     width: 12 },
    { key: 'latitud',         width: 13 },
    { key: 'longitud',        width: 13 },
    // LUZ (10 cols)
    { key: 'lectura_luz',     width: 14 },
    { key: 'ant_luz',         width: 13 },
    { key: 'delta_luz',       width: 13 },
    { key: 'ocr_luz',         width: 13 },
    { key: 'conf_luz',        width: 12 },
    { key: 'acc_luz',         width: 10 },
    { key: 'motivo_luz',      width: 26 },
    { key: 'fecha_foto_luz',  width: 12 },
    { key: 'hora_foto_luz',   width: 11 },
    { key: 'foto_luz',        width: 9  },
    // AGUA (10 cols)
    { key: 'lectura_agua',    width: 14 },
    { key: 'ant_agua',        width: 13 },
    { key: 'delta_agua',      width: 13 },
    { key: 'ocr_agua',        width: 13 },
    { key: 'conf_agua',       width: 12 },
    { key: 'acc_agua',        width: 10 },
    { key: 'motivo_agua',     width: 26 },
    { key: 'fecha_foto_agua', width: 12 },
    { key: 'hora_foto_agua',  width: 11 },
    { key: 'foto_agua',       width: 9  },
    // GAS (10 cols)
    { key: 'lectura_gas',     width: 14 },
    { key: 'ant_gas',         width: 13 },
    { key: 'delta_gas',       width: 13 },
    { key: 'ocr_gas',         width: 13 },
    { key: 'conf_gas',        width: 12 },
    { key: 'acc_gas',         width: 10 },
    { key: 'motivo_gas',      width: 26 },
    { key: 'fecha_foto_gas',  width: 12 },
    { key: 'hora_foto_gas',   width: 11 },
    { key: 'foto_gas',        width: 9  },
    // REVISIÓN (4 cols)
    { key: 'estado',          width: 12 },
    { key: 'alerta_ocr',      width: 12 },
    { key: 'observaciones',   width: 35 },
    { key: 'motivo_rechazo',  width: 26 },
  ];

  // ── FILA 1: Encabezados de sección (celdas combinadas) ────
  const row1 = ws.getRow(1);
  row1.height = 22;
  SECCIONES.forEach(([label, from, to, argb]) => {
    if (from < to) ws.mergeCells(1, from, 1, to);
    for (let c = from; c <= to; c++) {
      const cell = row1.getCell(c);
      if (c === from) cell.value = label;
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });

  // ── FILA 2: Nombres de columna ────────────────────────────
  const row2 = ws.getRow(2);
  row2.height = 20;
  COL_HEADERS.forEach((label, i) => {
    const col  = i + 1;
    const sec  = seccionDeColumna(col);
    const argb = sec ? sec[4] : 'FF374151';
    const cell = row2.getCell(col);
    cell.value     = label;
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = { bottom: { style: 'medium', color: { argb: 'FFE5E7EB' } } };
  });

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 46 } };

  // ── FILAS DE DATOS ────────────────────────────────────────
  visitas.forEach((v, i) => {
    const med     = medidoresMap[v.id] || {};
    const fotoUrl = (t) => med[t]?.foto_path ? `${BASE_URL}/uploads/${med[t].foto_path}` : '';
    const fotoVal = (t) => fotoUrl(t) ? { text: 'Ver foto', hyperlink: fotoUrl(t) } : '';
    const tieneAlerta = !!(
      med.luz?.requiere_revision  ||
      med.agua?.requiere_revision ||
      med.gas?.requiere_revision
    );

    const r = ws.addRow({
      // IDENTIFICACIÓN
      id:           v.id,
      fecha:        fmtFecha(v.fecha),
      hora_inicio:  fmtHora(v.hora_inicio),
      hora_fin:     fmtHora(v.hora_fin),
      duracion:     calcDuracion(v.hora_inicio, v.hora_fin),
      auditor:      v.auditor,
      ciudad:       v.ciudad,
      conjunto:     v.conjunto,
      torre:        v.torre || '–',
      apartamento:  v.apartamento,
      latitud:      v.latitud  ?? '',
      longitud:     v.longitud ?? '',
      // LUZ
      lectura_luz:     med.luz?.lectura_confirmada ?? '',
      ant_luz:         med.luz?.lectura_anterior   ?? '',
      delta_luz:       fmtDelta(med.luz?.delta, med.luz?.primera_lectura),
      ocr_luz:         med.luz?.lectura_ocr        ?? '',
      conf_luz:        capFirst(med.luz?.confianza_ocr),
      acc_luz:         med.luz?.sin_acceso  ? 'Sí' : '',
      motivo_luz:      med.luz?.motivo_sin_acceso  ?? '',
      fecha_foto_luz:  fmtFechaCorta(med.luz?.hora_foto),
      hora_foto_luz:   fmtHora(med.luz?.hora_foto),
      foto_luz:        fotoVal('luz'),
      // AGUA
      lectura_agua:    med.agua?.lectura_confirmada ?? '',
      ant_agua:        med.agua?.lectura_anterior   ?? '',
      delta_agua:      fmtDelta(med.agua?.delta, med.agua?.primera_lectura),
      ocr_agua:        med.agua?.lectura_ocr        ?? '',
      conf_agua:       capFirst(med.agua?.confianza_ocr),
      acc_agua:        med.agua?.sin_acceso ? 'Sí' : '',
      motivo_agua:     med.agua?.motivo_sin_acceso  ?? '',
      fecha_foto_agua: fmtFechaCorta(med.agua?.hora_foto),
      hora_foto_agua:  fmtHora(med.agua?.hora_foto),
      foto_agua:       fotoVal('agua'),
      // GAS
      lectura_gas:     med.gas?.lectura_confirmada ?? '',
      ant_gas:         med.gas?.lectura_anterior   ?? '',
      delta_gas:       fmtDelta(med.gas?.delta, med.gas?.primera_lectura),
      ocr_gas:         med.gas?.lectura_ocr        ?? '',
      conf_gas:        capFirst(med.gas?.confianza_ocr),
      acc_gas:         med.gas?.sin_acceso  ? 'Sí' : '',
      motivo_gas:      med.gas?.motivo_sin_acceso  ?? '',
      fecha_foto_gas:  fmtFechaCorta(med.gas?.hora_foto),
      hora_foto_gas:   fmtHora(med.gas?.hora_foto),
      foto_gas:        fotoVal('gas'),
      // REVISIÓN
      estado:          capFirst(v.estado ?? 'pendiente'),
      alerta_ocr:      tieneAlerta ? 'Revisar' : '',
      observaciones:   v.observaciones  ?? '',
      motivo_rechazo:  v.motivo_rechazo ?? '',
    });

    r.height = 17;

    // Zebra
    const zebraArgb = i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    r.eachCell({ includeEmpty: true }, cell => {
      cell.font      = cell.font || {};
      cell.alignment = { vertical: 'middle' };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraArgb } };
    });

    // Estado
    const estadoArgb = ESTADO_COLOR[v.estado ?? 'pendiente'];
    if (estadoArgb) {
      const ec = r.getCell('estado');
      ec.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: estadoArgb } };
      ec.alignment = { vertical: 'middle', horizontal: 'center' };
      ec.font      = { bold: true, size: 10 };
    }

    // Alerta OCR
    if (tieneAlerta) {
      const ac = r.getCell('alerta_ocr');
      ac.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      ac.font      = { bold: true, color: { argb: 'FFB45309' }, size: 10 };
      ac.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    // Estilos por tipo de medidor
    ['luz', 'agua', 'gas'].forEach(tipo => {
      const m = med[tipo];
      if (!m) return;

      // Confianza
      const confArgb = CONF_COLOR[m.confianza_ocr];
      if (confArgb) {
        const cc = r.getCell(`conf_${tipo}`);
        cc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: confArgb } };
        cc.alignment = { vertical: 'middle', horizontal: 'center' };
        cc.font      = { bold: true, size: 10 };
      }

      // Delta: verde positivo, rojo negativo, gris primera lectura
      const dc = r.getCell(`delta_${tipo}`);
      dc.alignment = { vertical: 'middle', horizontal: 'center' };
      if (m.primera_lectura) {
        dc.font = { italic: true, color: { argb: 'FF9CA3AF' }, size: 10 };
      } else if (m.delta !== null && m.delta !== undefined) {
        const d = parseFloat(m.delta);
        if (!isNaN(d)) {
          const color = d < 0 ? 'FFDC2626' : (d === 0 ? 'FFB45309' : 'FF059669');
          dc.font = { bold: true, color: { argb: color }, size: 10 };
        }
      }

      // Sin acceso
      if (m.sin_acceso) {
        const ac = r.getCell(`acc_${tipo}`);
        ac.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        ac.font      = { bold: true, color: { argb: 'FFB91C1C' }, size: 10 };
        ac.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      // Foto (hyperlink)
      const fc = r.getCell(`foto_${tipo}`);
      if (fc.value && typeof fc.value === 'object' && fc.value.hyperlink) {
        fc.font      = { color: { argb: 'FF3B82F6' }, underline: true, size: 10 };
        fc.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  });

  // Congelar filas 1 y 2
  ws.views = [{ state: 'frozen', ySplit: 2, xSplit: 0 }];

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="LecturaIA_Visitas_${dateStr}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
