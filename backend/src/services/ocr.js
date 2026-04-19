const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const sharp  = require('sharp');
const logger = require('../middleware/logger');

const client      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ─────────────────────────────────────────────────────────────
// Preprocesamiento de imagen con Sharp
// ─────────────────────────────────────────────────────────────
async function preprocessImage(inputPath) {
  const tmpPath = path.join(
    os.tmpdir(),
    `ocr_${Date.now()}_${path.basename(inputPath)}.jpg`
  );
  await sharp(inputPath)
    .rotate()                                              // auto-rotar por EXIF
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 1.0 })                              // nitidez suave
    .modulate({ saturation: 1.4, brightness: 1.05 })     // realza colores (rojo vs negro más distinguibles)
    .jpeg({ quality: 93 })
    .toFile(tmpPath);
  return tmpPath;
}

// ─────────────────────────────────────────────────────────────
// Llamada al modelo — retorna JSON parseado
// ─────────────────────────────────────────────────────────────
async function llamarModelo(imageBuffer, mediaType, prompt) {
  const base64 = imageBuffer.toString('base64');
  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: 500,
    temperature: 0,          // máxima determinismo — misma imagen, misma respuesta
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' },
        },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const text = response.choices[0].message.content.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Respuesta sin JSON válido');
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────────────────────
// Parsear resultado del modelo a formato estándar
// ─────────────────────────────────────────────────────────────
function parsearResultado(json) {
  const calidad    = json.calidad_foto || 'buena';
  const esMedidor  = json.es_medidor !== false;
  const lectura    = json.lectura ?? null;
  const confianza  = json.confianza ?? 'baja';
  return {
    es_medidor:        esMedidor,
    lectura,
    confianza,
    calidad_foto:      calidad,
    motivo_calidad:    (json.motivo_calidad && !json.motivo_calidad.toLowerCase().includes('omitir'))
                         ? json.motivo_calidad : null,
    nota:              json.nota ?? '',
    requiere_revision: !esMedidor || lectura === null || calidad === 'mala' || confianza === 'baja',
  };
}

// ─────────────────────────────────────────────────────────────
// PROMPTS — Primera pasada
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres un experto en lectura de medidores de gas domiciliario en Colombia.

TAREA: Extrae la lectura del medidor de gas en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Busca la ventanilla rectangular pequeña con tambores giratorios (como odómetro)
- Dígitos NEGROS = metros cúbicos (parte entera). Dígitos ROJOS = decimales
- Si un tambor está entre dos números, usa SIEMPRE el inferior (entre 3 y 4 → usa 3)
- IGNORA el número de serie grabado en el cuerpo metálico del medidor, stickers y códigos de barras

EJEMPLO: 5 tambores negros "00201" y 1 rojo "2" → lectura "00201.2"

CONFIANZA: "alta" si todos los dígitos son claros. "baja" si 2 o más son inciertos.
CALIDAD: "buena" / "aceptable" (algo de reflejo) / "mala" (ilegible o muy oscuro).
Si calidad es "aceptable" o "mala", agrega el campo "motivo_calidad" con una frase corta. Si es "buena", NO incluyas ese campo.
"es_medidor": false SOLO si la imagen claramente NO contiene ningún medidor de servicios (mueble, pared, persona, etc.). Un medidor de cualquier tipo (gas, agua, luz) cuenta como true.

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "00201.2",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "una oración describiendo los dígitos que viste en la ventanilla"
}`,

  agua: `Eres un experto en lectura de medidores de agua domiciliario en Colombia.

TAREA: Extrae la lectura del medidor de agua en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Busca la ventanilla ovalada o rectangular del frente del medidor (carcasa generalmente azul)
- Contiene tambores giratorios con dígitos 0-9
- Los primeros 5 dígitos NEGROS = metros cúbicos. Los últimos 1-2 dígitos ROJOS = decimales
- Si un tambor está entre dos números, usa SIEMPRE el inferior
- Si hay duda sobre si un dígito es rojo o negro por reflejo, trátalo como NEGRO
- IGNORA el número de serie grabado en el metal del cuerpo (ej: "22016683"), stickers

EJEMPLO: tambores negros "01348" y rojos "42" → lectura "01348.42"

CONFIANZA: "alta" si todos los dígitos son claros. "baja" si 2 o más son inciertos.
CALIDAD: "buena" / "aceptable" / "mala".
Si calidad es "aceptable" o "mala", agrega el campo "motivo_calidad" con una frase corta. Si es "buena", NO incluyas ese campo.
"es_medidor": false SOLO si la imagen claramente NO contiene ningún medidor de servicios (mueble, pared, persona, etc.). Un medidor de cualquier tipo cuenta como true.

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "01348.42",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "una oración describiendo los dígitos que viste en la ventanilla (no el número de serie)"
}`,

  luz: `Eres un experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

TAREA: Extrae la lectura del medidor de luz en esta imagen.

CÓMO IDENTIFICAR EL DISPLAY:
- Puede ser LCD digital (pantalla electrónica) o tambores mecánicos giratorios
- Unidad: kWh. Dígitos rojos o después del separador = decimales
- Si es mecánico y un tambor está entre dos números, usa SIEMPRE el inferior
- IGNORA número de serie, stickers de empresa y texto de marca

EJEMPLO LCD: pantalla muestra "004521" → lectura "004521"
EJEMPLO mecánico: "0045" negro y "21" rojo → lectura "0045.21"

CONFIANZA: "alta" si todos los dígitos son claros. "baja" si 2 o más son inciertos.
CALIDAD: "buena" / "aceptable" / "mala".
Si calidad es "aceptable" o "mala", agrega el campo "motivo_calidad" con una frase corta. Si es "buena", NO incluyas ese campo.
"es_medidor": false SOLO si la imagen claramente NO contiene ningún medidor de servicios (mueble, pared, persona, etc.). Un medidor de cualquier tipo cuenta como true.

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "004521",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "una oración describiendo qué viste (tipo display y dígitos)"
}`,
};

// ─────────────────────────────────────────────────────────────
// PROMPTS — Segunda pasada (perspectiva diferente, sin sesgo)
// ─────────────────────────────────────────────────────────────
const PROMPTS_VERIFICACION = {

  gas: `Analiza esta imagen de un medidor de gas domiciliario.

Tu única tarea: leer los dígitos dentro de la ventanilla con tambores giratorios del medidor.
NO leas el número de serie grabado en el cuerpo metálico.

Método:
1. Cuenta cuántas posiciones tiene la ventanilla
2. Lee cada posición de derecha a izquierda (empieza por los rojos/decimales)
3. Si un tambor está entre dos dígitos, toma el inferior
4. Junta todo de izquierda a derecha para dar la lectura

Responde ÚNICAMENTE con JSON:
{
  "lectura": "XXXXX.XX o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "lista de lo que viste en cada posición",
  "nota": "qué viste exactamente"
}`,

  agua: `Analiza esta imagen de un medidor de agua domiciliario.

Tu única tarea: leer los dígitos dentro de la ventanilla ovalada/rectangular del medidor.
El número de serie grabado en el metal del cuerpo NO es la lectura — ignóralo completamente.

Método:
1. Localiza la ventanilla con los tambores (carcasa generalmente azul)
2. Lee cada posición de derecha a izquierda (empieza por los rojos/decimales)
3. Si un tambor está entre dos dígitos, toma el inferior
4. Junta todo de izquierda a derecha

Responde ÚNICAMENTE con JSON:
{
  "lectura": "XXXXX.XX o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "lista de lo que viste en cada posición",
  "nota": "qué viste exactamente en la ventanilla"
}`,

  luz: `Analiza esta imagen de un medidor de energía eléctrica domiciliario.

Tu única tarea: leer los dígitos del display del medidor (tambores o LCD).
Ignora número de serie, stickers y texto de marca.

Método:
1. Identifica el tipo de display (mecánico o digital)
2. Lee cada dígito individualmente de derecha a izquierda
3. Si es mecánico y un tambor está entre dos dígitos, toma el inferior
4. Junta todo de izquierda a derecha

Responde ÚNICAMENTE con JSON:
{
  "lectura": "XXXXXX o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "lista de lo que viste",
  "nota": "qué viste exactamente"
}`,
};

// ─────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────
async function analizarMedidor(imagePath, tipo, { modo = 'rapido' } = {}) {
  const imageBuffer = fs.readFileSync(imagePath);
  if (imageBuffer.length === 0) {
    logger.error(`OCR error para ${imagePath}: archivo vacío`);
    return {
      es_medidor: true, lectura: null, confianza: 'baja',
      calidad_foto: 'mala', motivo_calidad: 'Imagen vacía — retoma la foto',
      requiere_revision: true, nota: 'El archivo de imagen está vacío',
    };
  }

  // Preprocessing
  let processedPath = null;
  let workingBuffer = imageBuffer;
  try {
    processedPath = await preprocessImage(imagePath);
    workingBuffer = fs.readFileSync(processedPath);
  } catch (prepErr) {
    logger.warn(`OCR preprocessing falló, usando imagen original: ${prepErr.message}`);
  }

  const ext       = path.extname(imagePath).toLowerCase().replace('.', '');
  const mediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`;
  const prompt    = PROMPTS_COT[tipo] || PROMPTS_COT.luz;

  try {
    // ── Primera llamada ──────────────────────────────────────
    const json1   = await llamarModelo(workingBuffer, mediaType, prompt);
    const result1 = parsearResultado(json1);

    // ── Segunda llamada (solo modo preciso y si hay incertidumbre) ──
    if (modo === 'preciso' && (result1.confianza === 'baja' || result1.calidad_foto !== 'buena')) {
      try {
        const prompt2  = PROMPTS_VERIFICACION[tipo] || PROMPTS_VERIFICACION.luz;
        const json2    = await llamarModelo(workingBuffer, mediaType, prompt2);
        const result2  = parsearResultado(json2);

        if (result1.lectura && result2.lectura) {
          if (result1.lectura === result2.lectura) {
            // Consenso → confirmar con alta confianza
            return {
              ...result1,
              confianza:         'alta',
              requiere_revision: result1.calidad_foto === 'mala' || !result1.es_medidor,
              nota:              `[Verificado] ${result1.nota}`,
            };
          } else {
            // Discrepancia entre pasadas → flag con ambas lecturas para admin
            return {
              ...result1,
              confianza:         'baja',
              requiere_revision: true,
              nota:              `[IA inconsistente] Pasada 1: ${result1.lectura} · Pasada 2: ${result2.lectura}. Requiere verificación manual.`,
            };
          }
        }

        // Si la segunda logró leer y la primera no → usar segunda
        if (!result1.lectura && result2.lectura) {
          return {
            ...result2,
            nota: `[Recuperado en 2ª pasada] ${result2.nota}`,
          };
        }
      } catch (err2) {
        logger.warn(`OCR segunda pasada falló: ${err2.message}`);
      }
    }

    return result1;

  } catch (err) {
    logger.error(`OCR error para ${imagePath}: ${err.message}`);
    return {
      es_medidor: true, lectura: null, confianza: 'baja',
      calidad_foto: 'mala', motivo_calidad: 'Error al procesar la imagen con IA',
      requiere_revision: true, nota: 'Error al procesar la imagen con IA',
    };
  } finally {
    if (processedPath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }
  }
}

module.exports = { analizarMedidor };
