const exifr = require('exifr');
const logger = require('../middleware/logger');

/**
 * leerHoraFoto — extrae la fecha/hora de captura del EXIF de una imagen.
 *
 * Prioridad de campos:
 *   1. DateTimeOriginal  — momento real del disparo (más confiable)
 *   2. DateTimeDigitized — cuándo fue digitalizada
 *   3. DateTime          — fecha de última modificación del archivo
 *
 * Retorna un Date en hora Colombia (el archivo EXIF guarda hora local del dispositivo)
 * o null si no hay metadatos disponibles.
 */
async function leerHoraFoto(filePath) {
  try {
    const data = await exifr.parse(filePath, {
      pick: ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'],
    });
    if (!data) return null;

    const fecha = data.DateTimeOriginal || data.DateTimeDigitized || data.DateTime;
    if (fecha instanceof Date && !isNaN(fecha.getTime())) return fecha;
    return null;
  } catch (err) {
    logger.warn(`EXIF: no se pudo leer ${filePath}: ${err.message}`);
    return null;
  }
}

module.exports = { leerHoraFoto };
