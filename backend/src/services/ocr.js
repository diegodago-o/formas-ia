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
    motivo_calidad:    json.motivo_calidad || null,
    nota:              json.nota ?? '',
    requiere_revision: !esMedidor || lectura === null || calidad === 'mala' || confianza === 'baja',
  };
}

// ─────────────────────────────────────────────────────────────
// PROMPTS — Primera pasada (Chain-of-Thought)
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres un experto en lectura de medidores de gas domiciliario en Colombia.

TAREA: Extraer la lectura del contador de gas con máxima precisión.

Sigue estos pasos antes de dar tu respuesta:

PASO 1 — LOCALIZA EL DISPLAY:
Busca la ventanilla pequeña rectangular con tambores giratorios (como odómetro de carro).
IGNORA: el número de serie grabado en el cuerpo metálico del medidor, stickers, códigos de barras.

PASO 2 — ANALIZA CADA DÍGITO de izquierda a derecha dentro de la ventanilla:
• ¿Qué número ves en esa posición? (0–9)
• Si el tambor está entre dos números, usa SIEMPRE el inferior (ej: entre 3 y 4 → usa 3)
• ¿Es negro o rojo?

PASO 3 — SEPARA:
• Dígitos negros = metros cúbicos (parte entera)
• Dígitos rojos = decimales (después del punto)

PASO 4 — VERIFICA:
¿La lectura tiene sentido para un medidor doméstico colombiano? (rango típico 0–99999 m³)

CONFIANZA:
• "alta": todos los dígitos se ven con claridad, lectura definitiva sin ambigüedad
• "baja": 2 o más dígitos son inciertos, o el display es parcialmente ilegible

CALIDAD DE FOTO:
• "buena": display visible, dígitos legibles
• "aceptable": mayoría legibles, algo de reflejo o leve desenfoque
• "mala": display ilegible, muy oscuro, fuera de encuadre
• "es_medidor": false SOLO si la imagen NO contiene ningún medidor de gas

Responde ÚNICAMENTE con este JSON (sin texto adicional antes o después):
{
  "es_medidor": true,
  "lectura": "01348.42",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": "omitir si es buena",
  "nota": "dígitos vistos de izquierda a derecha: 0,1,3,4,8 negros · 4,2 rojos"
}`,

  agua: `Eres un experto en lectura de medidores de agua domiciliario en Colombia.

TAREA: Extraer la lectura del contador de agua con máxima precisión.

Sigue estos pasos antes de dar tu respuesta:

PASO 1 — LOCALIZA EL DISPLAY:
Busca la ventanilla ovalada o rectangular en el frente del medidor (generalmente carcasa azul o negra).
Contiene tambores giratorios con dígitos 0–9.
IGNORA: número de serie grabado en el metal (ej: "22016683"), stickers, marcas de la empresa.

PASO 2 — ANALIZA CADA DÍGITO de izquierda a derecha dentro de la ventanilla:
• ¿Qué número ves en esa posición? (0–9)
• Si el tambor está entre dos números, usa SIEMPRE el inferior
• ¿Es negro o rojo? (si hay reflejo que hace dudar sobre el color, trátalo como negro)

PASO 3 — SEPARA:
• Los primeros 5 dígitos negros = metros cúbicos (parte entera)
• Los últimos 1 o 2 dígitos rojos = decimales

PASO 4 — VERIFICA:
¿La lectura tiene sentido? (rango típico 0–99999 m³)
¿Estás leyendo la ventanilla de los tambores, NO el número de serie del cuerpo?

CONFIANZA:
• "alta": todos los dígitos se ven con claridad, lectura definitiva
• "baja": 2 o más dígitos son inciertos

CALIDAD DE FOTO:
• "buena": display visible, dígitos legibles
• "aceptable": mayoría legibles, algo de reflejo o leve desenfoque
• "mala": display ilegible, muy oscuro, fuera de encuadre
• "es_medidor": false SOLO si la imagen NO contiene ningún medidor de agua

Responde ÚNICAMENTE con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "lectura": "01348.42",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": "omitir si es buena",
  "nota": "dígitos vistos de izquierda a derecha: 0,1,3,4,8 negros · 4,2 rojos"
}`,

  luz: `Eres un experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

TAREA: Extraer la lectura del medidor de luz con máxima precisión.

Sigue estos pasos antes de dar tu respuesta:

PASO 1 — IDENTIFICA EL TIPO DE DISPLAY:
• Tambores mecánicos giratorios (como odómetro) → cada rueda muestra un dígito
• LCD digital → pantalla electrónica con segmentos

PASO 2 — ANALIZA CADA DÍGITO de izquierda a derecha:
• Tambores: si el dígito está entre dos números, usa el INFERIOR
• LCD: lee cada segmento con cuidado (el 1 puede confundirse con 7, el 6 con 8)
• ¿Es negro/blanco o rojo? Los rojos o separados por coma son decimales

PASO 3 — SEPARA:
• Dígitos principales = kWh
• Dígitos rojos o después del separador = decimales
• Ignora: número de serie, stickers de la empresa, texto de marca

PASO 4 — VERIFICA:
¿La lectura es coherente para un medidor doméstico? (rango típico 0–99999 kWh)

CONFIANZA:
• "alta": todos los dígitos claros, lectura definitiva
• "baja": 2 o más dígitos inciertos

CALIDAD DE FOTO:
• "buena": display visible, dígitos legibles
• "aceptable": mayoría legibles, leve reflejo o desenfoque
• "mala": display ilegible
• "es_medidor": false SOLO si la imagen claramente NO es un medidor eléctrico

Responde ÚNICAMENTE con este JSON:
{
  "es_medidor": true,
  "lectura": "004521",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": "omitir si es buena",
  "nota": "tipo display y dígitos vistos: ej 'LCD · 0,0,4,5,2,1'"
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
