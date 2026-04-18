require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'formas_ia',
  });

  // Agregar columnas solo si no existen (compatible con MySQL 5.7+)
  const columns = [
    { name: 'estado',          def: "ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente'" },
    { name: 'motivo_rechazo',  def: 'TEXT NULL' },
    { name: 'revisado_por',    def: 'INT NULL' },
    { name: 'revisado_en',     def: 'DATETIME NULL' },
  ];

  const [existing] = await conn.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'visitas'
  `, [process.env.DB_NAME || 'formas_ia']);

  const existingNames = existing.map(r => r.COLUMN_NAME);

  for (const col of columns) {
    if (!existingNames.includes(col.name)) {
      await conn.query(`ALTER TABLE visitas ADD COLUMN ${col.name} ${col.def}`);
      console.log(`+ Columna ${col.name} agregada`);
    } else {
      console.log(`= Columna ${col.name} ya existe, omitiendo`);
    }
  }

  console.log('Migración completada.');
  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
