const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../middleware/logger');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';

// Bloque de evaluación de calidad de foto — igual para los 3 tipos
const CALIDAD_INSTRUCCION = `
EVALUACIÓN DE CALIDAD DE FOTO:
Evalúa si la foto es válida como evidencia contractual:
- "buena": medidor claramente visible, display bien iluminado y enfocado
- "aceptable": display legible aunque con algo de sombra, leve reflejo o ángulo
- "mala": foto borrosa, muy oscura, display fuera de encuadre, o simplemente no se puede ver el medidor
Incluye motivo_calidad solo si es "aceptable" o "mala" (ej: "foto muy oscura", "display con reflejo fuerte").
- "es_medidor": false ÚNICAMENTE si la imagen claramente NO contiene ningún medidor de servicios (ej: muestra un mueble, control remoto, persona, pared vacía, etc.). Si hay aunque sea un medidor parcialmente visible, usa true.`;

const PROMPTS = {
  gas: `Eres un experto en lectura de medidores de gas domiciliario en Colombia.

TAREA: Extrae la lectura del medidor de gas en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Busca una ventanilla rectangular pequeña en la parte superior del medidor
- Contiene tambores giratorios (como un odómetro de carro) con dígitos del 0 al 9
- Los dígitos en NEGRO son la parte entera (m³)
- Los dígitos en ROJO son decimales (después del punto)
- Ignora: códigos de barras, números de serie en stickers, etiquetas adhesivas, números escritos a mano en el cuerpo del medidor

EJEMPLO: Si ves 5 negros "00201" y 1 rojo "2", la lectura es "00201.2"

${CALIDAD_INSTRUCCION}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "00201.2",
  "confianza": "alta|baja",
  "calidad_foto": "buena|aceptable|mala",
  "motivo_calidad": "solo si aceptable o mala, sino omitir",
  "nota": "una sola oración explicando qué viste"
}

Reglas:
- "es_medidor": false solo si la imagen claramente NO es un medidor de gas
- "lectura": null ÚNICAMENTE si el display es totalmente ilegible
- "confianza" alta = puedes leer la mayoría de dígitos y extraes una lectura razonable; baja = imposible leer
- En caso de duda sobre confianza, usa "alta"`,

  agua: `Eres un experto en lectura de medidores de agua domiciliario en Colombia (marca Socorrés y similares).

TAREA: Extrae la lectura del medidor de agua en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Busca la ventanilla ovalada o rectangular en el frente del medidor (generalmente azul)
- Contiene tambores giratorios con dígitos del 0 al 9 (como odómetro de carro)
- REGLA DE COLOR: los primeros 5 dígitos son SIEMPRE negros (metros cúbicos m³). Los últimos 1 o 2 dígitos son rojos (decimales)
- Si un dígito parece entre negro y rojo por reflejo o ángulo, trátalo como NEGRO
- Ignora: número de serie grabado en el metal (ej: "22016683"), stickers, códigos de barras

EJEMPLO: cinco tambores negros "01348" y dos rojos "42" → lectura "01348.42"

${CALIDAD_INSTRUCCION}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "01348.42",
  "confianza": "alta|baja",
  "calidad_foto": "buena|aceptable|mala",
  "motivo_calidad": "solo si aceptable o mala, sino omitir",
  "nota": "una sola oración explicando qué viste en la ventanilla (no el número de serie)"
}

Reglas:
- "es_medidor": false solo si la imagen claramente NO es un medidor de agua
- "lectura": null ÚNICAMENTE si la ventanilla es totalmente ilegible
- "confianza" alta = puedes leer la mayoría de dígitos y extraes una lectura razonable; baja = imposible leer
- En caso de duda sobre confianza, usa "alta"`,

  luz: `Eres un experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

TAREA: Extrae la lectura del medidor de luz en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Puede ser un display LCD digital (números en pantalla electrónica)
- O tambores giratorios mecánicos con dígitos del 0 al 9
- La unidad es kWh
- Los dígitos en ROJO o después de la coma son decimales
- Ignora: número de serie, códigos de barras, stickers de la empresa, texto de marca

EJEMPLO LCD: pantalla muestra "004521" → lectura "004521"
EJEMPLO mecánico: "0045" negro y "21" rojo → lectura "0045.21"

${CALIDAD_INSTRUCCION}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "004521",
  "confianza": "alta|baja",
  "calidad_foto": "buena|aceptable|mala",
  "motivo_calidad": "solo si aceptable o mala, sino omitir",
  "nota": "una sola oración explicando qué viste"
}

Reglas:
- "es_medidor": false solo si la imagen claramente NO es un medidor de luz/energía
- "lectura": null ÚNICAMENTE si el display es totalmente ilegible
- "confianza" alta = puedes leer la mayoría de dígitos y extraes una lectura razonable; baja = imposible leer
- En caso de duda sobre confianza, usa "alta"`,
};

/**
 * Analiza la foto de un medidor y extrae la lectura numérica + calidad de foto.
 * @param {string} imagePath  Ruta absoluta a la imagen
 * @param {string} tipo       'luz' | 'agua' | 'gas'
 * @returns {{ lectura, confianza, calidad_foto, motivo_calidad, requiere_revision, nota }}
 */
async function analizarMedidor(imagePath, tipo) {
  const imageBuffer = fs.readFileSync(imagePath);
  if (imageBuffer.length === 0) {
    logger.error(`OCR error para ${imagePath}: archivo vacío (0 bytes)`);
    return {
      lectura: null, confianza: 'baja', calidad_foto: 'mala',
      motivo_calidad: 'Imagen vacía — retoma la foto', requiere_revision: true,
      nota: 'El archivo de imagen está vacío',
    };
  }
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const prompt = PROMPTS[tipo] || PROMPTS.luz;

  try {
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_completion_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.choices[0].message.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Respuesta sin JSON válido');
    const json = JSON.parse(jsonMatch[0]);

    const calidad = json.calidad_foto || 'buena';

    const esMedidor = json.es_medidor !== false;
    return {
      es_medidor:        esMedidor,
      lectura:           json.lectura   ?? null,
      confianza:         json.confianza ?? 'baja',
      calidad_foto:      calidad,
      motivo_calidad:    json.motivo_calidad || null,
      requiere_revision: json.lectura === null || calidad === 'mala',
      nota:              json.nota ?? '',
    };
  } catch (err) {
    logger.error(`OCR error para ${imagePath}: ${err.message}`);
    return {
      es_medidor:        true,
      lectura:           null,
      confianza:         'baja',
      calidad_foto:      'mala',
      motivo_calidad:    'Error al procesar la imagen con IA',
      requiere_revision: true,
      nota:              'Error al procesar la imagen con IA',
    };
  }
}

module.exports = { analizarMedidor };
