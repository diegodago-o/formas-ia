/**
 * migrate-v2.js
 * Agrega columnas de calidad foto, sin acceso, delta histórico a medidores
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('Iniciando migración v2...\n');

    const newColumns = [
      // Calidad de foto
      {
        table: 'medidores', col: 'calidad_foto',
        sql: "ALTER TABLE medidores ADD COLUMN calidad_foto VARCHAR(20) DEFAULT 'buena'",
      },
      {
        table: 'medidores', col: 'motivo_calidad',
        sql: 'ALTER TABLE medidores ADD COLUMN motivo_calidad VARCHAR(255) NULL',
      },
      // Sin acceso al medidor
      {
        table: 'medidores', col: 'sin_acceso',
        sql: 'ALTER TABLE medidores ADD COLUMN sin_acceso TINYINT(1) DEFAULT 0',
      },
      {
        table: 'medidores', col: 'motivo_sin_acceso',
        sql: 'ALTER TABLE medidores ADD COLUMN motivo_sin_acceso VARCHAR(255) NULL',
      },
      // Delta histórico
      {
        table: 'medidores', col: 'lectura_anterior',
        sql: 'ALTER TABLE medidores ADD COLUMN lectura_anterior VARCHAR(50) NULL',
      },
      {
        table: 'medidores', col: 'delta',
        sql: 'ALTER TABLE medidores ADD COLUMN delta DECIMAL(10,3) NULL',
      },
      {
        table: 'medidores', col: 'primera_lectura',
        sql: 'ALTER TABLE medidores ADD COLUMN primera_lectura TINYINT(1) DEFAULT 0',
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

    console.log('\nMigración v2 completada.');
  } catch (err) {
    console.error('Error en migración:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
