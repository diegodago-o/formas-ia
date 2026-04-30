/**
 * backfill-hora-foto-visita.js
 *
 * Rellena hora_foto en medidores históricos que no tienen EXIF real,
 * usando como aproximación la hora de fin de la visita (hora_fin),
 * o la fecha de creación de la visita (v.fecha) como fallback.
 *
 * Precisión: el valor asignado es el momento en que el auditor
 * presionó "Guardar visita" — típicamente 5–15 min después de la
 * captura real. Suficiente para cumplimiento contractual de fecha/hora.
 *
 * Ejecutar UNA SOLA VEZ:
 *   node scripts/backfill-hora-foto-visita.js
 *
 * Flags opcionales:
 *   --dry-run   Muestra cuántos registros se afectarían sin tocar nada
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

const DRY_RUN = process.argv.includes('--dry-run');

async function backfill() {
  const conn = await pool.getConnection();
  try {
    console.log('=== Backfill hora_foto (aproximación por hora de visita) ===\n');
    if (DRY_RUN) console.log('  [DRY RUN — no se modificará nada]\n');

    // ── Conteo previo ──────────────────────────────────────────────
    const [[{ total, con_hora_fin, solo_fecha }]] = await conn.query(`
      SELECT
        COUNT(*)                          AS total,
        SUM(v.hora_fin IS NOT NULL)       AS con_hora_fin,
        SUM(v.hora_fin IS NULL)           AS solo_fecha
      FROM medidores m
      JOIN visitas v ON v.id = m.visita_id
      WHERE m.foto_path  IS NOT NULL
        AND m.hora_foto  IS NULL
    `);

    console.log(`Medidores a actualizar : ${total}`);
    console.log(`  → con hora_fin       : ${con_hora_fin}  (precisión ~5-15 min)`);
    console.log(`  → solo fecha visita  : ${solo_fecha}    (precisión ~mismo día)`);
    console.log('');

    if (total === 0) {
      console.log('Nada que hacer. Todos los medidores con foto ya tienen hora_foto.');
      return;
    }

    if (DRY_RUN) {
      console.log('Dry-run completado. Vuelve a ejecutar sin --dry-run para aplicar.');
      return;
    }

    // ── UPDATE ─────────────────────────────────────────────────────
    const [result] = await conn.query(`
      UPDATE medidores m
      JOIN visitas v ON v.id = m.visita_id
      SET m.hora_foto = COALESCE(v.hora_fin, v.fecha)
      WHERE m.foto_path IS NOT NULL
        AND m.hora_foto IS NULL
    `);

    console.log(`✓ Registros actualizados: ${result.affectedRows}`);

    // ── Verificación post-update ───────────────────────────────────
    const [[{ pendientes }]] = await conn.query(`
      SELECT COUNT(*) AS pendientes
      FROM medidores
      WHERE foto_path IS NOT NULL
        AND hora_foto IS NULL
    `);

    console.log(`  Quedan sin hora_foto : ${pendientes}`);
    console.log('\n=== Listo ===');

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

backfill();
