/**
 * migrate-hora-sincronizacion.js
 *
 * Agrega la columna hora_sincronizacion a la tabla visitas.
 * Ejecutar UNA SOLA VEZ: node scripts/migrate-hora-sincronizacion.js
 *
 * Propósito:
 *   - Para visitas online:    hora_sincronizacion = NULL (se registró en tiempo real)
 *   - Para visitas offline:   hora_sincronizacion = momento en que el sync la subió
 *
 * Esto permite distinguir el tiempo real de la visita (hora_fin) del momento
 * en que llegó al servidor (hora_sincronizacion / fecha).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('=== Migración: hora_sincronizacion ===\n');

    // Verificar si ya existe la columna
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'visitas'
         AND COLUMN_NAME  = 'hora_sincronizacion'`
    );

    if (cols.length > 0) {
      console.log('✓ La columna hora_sincronizacion ya existe. Nada que hacer.');
      return;
    }

    await conn.query(
      `ALTER TABLE visitas
       ADD COLUMN hora_sincronizacion DATETIME NULL
       AFTER hora_fin`
    );
    console.log('✓ Columna hora_sincronizacion agregada a visitas.');
    console.log('\nNota: Los registros existentes quedan con NULL.');
    console.log('      Las nuevas visitas offline llenarán este campo al sincronizar.');

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
