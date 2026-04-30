/**
 * backfill-hora-foto.js
 * Rellena hora_foto en medidores existentes leyendo los metadatos EXIF
 * de cada foto almacenada en el servidor.
 *
 * Ejecutar UNA SOLA VEZ: node scripts/backfill-hora-foto.js
 *
 * Resultados posibles por medidor:
 *   ✓ EXIF  — fecha/hora real de captura leída del dispositivo
 *   - sin EXIF — archivo sin metadatos (foto pasada por WhatsApp, editada, etc.)
 *   ✗ error — archivo no encontrado o corrupto
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path  = require('path');
const { pool }       = require('../src/models/db');
const { leerHoraFoto } = require('../src/services/exif');

const UPLOADS_DIR = path.join(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');

async function backfill() {
  const conn = await pool.getConnection();
  try {
    console.log('=== Backfill hora_foto ===\n');

    // Todos los medidores con foto pero sin hora_foto
    const [medidores] = await conn.query(
      `SELECT id, foto_path
       FROM medidores
       WHERE foto_path IS NOT NULL
         AND hora_foto IS NULL
       ORDER BY id`
    );

    console.log(`Medidores a procesar: ${medidores.length}\n`);
    if (!medidores.length) {
      console.log('Nada que hacer. Todos los medidores con foto ya tienen hora_foto.');
      return;
    }

    let okExif = 0, sinExif = 0, errores = 0;

    for (const med of medidores) {
      const filePath = path.join(UPLOADS_DIR, med.foto_path);
      try {
        const horaFoto = await leerHoraFoto(filePath);

        if (horaFoto) {
          await conn.query(
            'UPDATE medidores SET hora_foto = ? WHERE id = ?',
            [horaFoto, med.id]
          );
          console.log(`  ✓ EXIF  [${med.id}] ${med.foto_path} → ${horaFoto.toLocaleString('es-CO')}`);
          okExif++;
        } else {
          console.log(`  - sin EXIF [${med.id}] ${med.foto_path}`);
          sinExif++;
        }
      } catch (err) {
        console.log(`  ✗ error  [${med.id}] ${med.foto_path}: ${err.message}`);
        errores++;
      }
    }

    console.log('\n=== Resumen ===');
    console.log(`  ✓ Con EXIF (hora_foto guardada): ${okExif}`);
    console.log(`  - Sin EXIF (quedan en NULL):     ${sinExif}`);
    console.log(`  ✗ Errores (archivo no encontrado o corrupto): ${errores}`);
    console.log(`  Total procesados: ${medidores.length}`);

  } catch (err) {
    console.error('Error general:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

backfill();
