/**
 * migrate-rol-consulta.js
 *
 * Agrega el valor 'consulta' al ENUM de la columna rol en la tabla usuarios.
 * Si la columna es VARCHAR, no necesita cambios (cualquier string ya funciona).
 * Ejecutar UNA SOLA VEZ: node scripts/migrate-rol-consulta.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/models/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('=== Migración: rol consulta ===\n');

    // Verificar tipo de columna
    const [cols] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'usuarios'
         AND COLUMN_NAME  = 'rol'`
    );

    if (!cols.length) {
      console.error('✗ No se encontró la columna rol en usuarios.');
      process.exit(1);
    }

    const colType = cols[0].COLUMN_TYPE.toLowerCase();
    console.log(`Tipo actual: ${cols[0].COLUMN_TYPE}`);

    if (!colType.startsWith('enum')) {
      console.log("✓ La columna rol es VARCHAR — 'consulta' ya es un valor válido sin cambios.");
      return;
    }

    if (colType.includes("'consulta'")) {
      console.log("✓ El valor 'consulta' ya existe en el ENUM. Nada que hacer.");
      return;
    }

    // Agregar 'consulta' al ENUM manteniendo los valores existentes
    // Extraer valores actuales: enum('auditor','admin') → ['auditor','admin']
    const values = colType
      .replace(/^enum\(/, '').replace(/\)$/, '')
      .split(',')
      .map(v => v.trim());

    values.push("'consulta'");

    await conn.query(
      `ALTER TABLE usuarios MODIFY COLUMN rol ENUM(${values.join(',')}) NOT NULL DEFAULT 'auditor'`
    );
    console.log(`✓ ENUM actualizado: ENUM(${values.join(',')})`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
