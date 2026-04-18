require('dotenv').config();
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

async function clearData() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'formas_ia',
    multipleStatements: true,
  });

  try {
    console.log('Limpiando registros operativos...');

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE medidores');
    await conn.query('TRUNCATE TABLE visitas');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('✓ Tablas medidores y visitas vaciadas');

    // Eliminar fotos subidas
    const uploadsDir = path.join(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter(f => /\.(jpg|jpeg|png|webp|heic)$/i.test(f));
      for (const file of files) {
        fs.unlinkSync(path.join(uploadsDir, file));
      }
      console.log(`✓ ${files.length} foto(s) eliminada(s) de uploads/`);
    }

    console.log('\nListo. La BD quedó limpia. Usuarios y catálogos intactos.');
  } finally {
    await conn.end();
  }
}

clearData().catch(err => { console.error(err); process.exit(1); });
