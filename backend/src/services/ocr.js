const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const logger = require('../middleware/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const METER_TYPES = {
  luz: 'medidor de energía eléctrica',
  agua: 'medidor de agua',
  gas: 'medidor de gas',
};

/**
 * Analiza la foto de un medidor y extrae la lectura numérica.
 * @param {string} imagePath  Ruta absoluta a la imagen
 * @param {string} tipo       'luz' | 'agua' | 'gas'
 * @returns {{ lectura: string|null, confianza: 'alta'|'media'|'baja', requiere_revision: boolean, nota: string }}
 */
async function analizarMedidor(imagePath, tipo) {
  const tipoLabel = METER_TYPES[tipo] || 'medidor';
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

  const prompt = `Analiza esta imagen de un ${tipoLabel}.

Extrae el número de lectura que aparece en el display o en los diales del medidor.

Responde ÚNICAMENTE en este formato JSON (sin texto adicional):
{
  "lectura": "12345.67",
  "confianza": "alta|media|baja",
  "nota": "descripción breve de por qué tienes esa confianza"
}

Reglas:
- "lectura": solo los dígitos y punto decimal que aparecen en el medidor. Si no puedes leerlo, usa null.
- "confianza":
  - "alta" = número claramente visible y legible
  - "media" = número visible pero con algo de ambigüedad (dígito dudoso, reflexión de luz, etc.)
  - "baja" = imagen borrosa, medidor tapado, muy oscura, o no se puede leer
- "nota": máximo una oración explicando el nivel de confianza.`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();
    const json = JSON.parse(text);

    return {
      lectura: json.lectura ?? null,
      confianza: json.confianza ?? 'baja',
      requiere_revision: json.confianza !== 'alta' || json.lectura === null,
      nota: json.nota ?? '',
    };
  } catch (err) {
    logger.error(`OCR error para ${imagePath}: ${err.message}`);
    return {
      lectura: null,
      confianza: 'baja',
      requiere_revision: true,
      nota: 'Error al procesar la imagen con IA',
    };
  }
}

module.exports = { analizarMedidor };
