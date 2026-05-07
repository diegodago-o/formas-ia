/**
 * Migración: agrega columna motivo_rechazo_admin a la tabla medidores.
 * Ejecutar una sola vez en el servidor:
 *   node backend/scripts/migrate-motivo-rechazo-medidor.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'medidores'
         AND COLUMN_NAME  = 'motivo_rechazo_admin'`
    );
    if (cols.length > 0) {
      console.log('✅ Columna motivo_rechazo_admin ya existe — nada que hacer.');
      return;
    }
    await conn.query(
      `ALTER TABLE medidores ADD COLUMN motivo_rechazo_admin TEXT NULL`
    );
    console.log('✅ Columna motivo_rechazo_admin agregada a la tabla medidores.');
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('❌ Error en migración:', e.message); process.exit(1); });
