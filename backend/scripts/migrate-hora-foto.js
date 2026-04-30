/**
 * migrate-hora-foto.js
 * Agrega la columna hora_foto a la tabla medidores para registrar
 * la fecha y hora exacta de captura de cada foto de medidor.
 *
 * Ejecutar: node scripts/migrate-hora-foto.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('Iniciando migración hora_foto...\n');

    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'medidores'
         AND COLUMN_NAME  = 'hora_foto'`
    );

    if (rows[0].cnt === 0) {
      await conn.query(
        `ALTER TABLE medidores
         ADD COLUMN hora_foto DATETIME NULL AFTER foto_path`
      );
      console.log('  ✓ Columna medidores.hora_foto agregada.');
    } else {
      console.log('  - medidores.hora_foto ya existe, sin cambios.');
    }

    console.log('\nMigración completada.');
  } catch (err) {
    console.error('Error en migración:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
