/**
 * migrate-timestamps.js
 * Agrega hora_inicio y hora_fin a la tabla visitas para registrar
 * cuándo empezó y terminó cada registro de visita.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('Iniciando migración de timestamps...\n');

    const newColumns = [
      {
        table: 'visitas', col: 'hora_inicio',
        sql: 'ALTER TABLE visitas ADD COLUMN hora_inicio DATETIME NULL AFTER fecha',
      },
      {
        table: 'visitas', col: 'hora_fin',
        sql: 'ALTER TABLE visitas ADD COLUMN hora_fin DATETIME NULL AFTER hora_inicio',
      },
    ];

    for (const { table, col, sql } of newColumns) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, col]
      );
      if (rows[0].cnt === 0) {
        await conn.query(sql);
        console.log(`  ✓ Agregada ${table}.${col}`);
      } else {
        console.log(`  - ${table}.${col} ya existe`);
      }
    }

    console.log('\nMigración de timestamps completada.');
  } catch (err) {
    console.error('Error en migración:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
