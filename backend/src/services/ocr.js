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
    .rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 1.0 })
    .modulate({ saturation: 1.4, brightness: 1.05 })
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
    max_completion_tokens: 600,
    temperature: 0,
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
  const calidad   = json.calidad_foto || 'buena';
  const esMedidor = json.es_medidor !== false;
  const lectura   = json.lectura ?? null;
  const confianza = json.confianza ?? 'baja';
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
// Descripción común de medidores válidos en Colombia
// ─────────────────────────────────────────────────────────────
const ES_MEDIDOR_REGLA = `
MEDIDOR VÁLIDO (es_medidor=true): cualquier equipo de medición de servicios públicos domiciliarios.
Incluye sin excepción: medidores de gas (IMUSA, Elster, Actaris, Samsung Jeil, Sensus, carcasa metálica plateada o blanca, marcados G-1/G-1.6/G-2.5/G-4/G-6, con ventanilla de tambores en la parte superior), medidores de agua (carcasa azul o gris, ACTARIS, Itron, Sensus, ISOIL), medidores de electricidad (LCD digital, tambores mecánicos, EDMI, Landis+Gyr, ABB, Circutor, ZIV).
Señales clave: display con números rotatorios o LCD, sello de empresa de servicios, unidades m³ o kWh, sticker de calibración, cuerpo de metal o plástico robusto con conectores de tubería o cable.
es_medidor=false ÚNICAMENTE si la imagen claramente NO contiene ningún equipo de medición: persona, animal, comida, mueble, pared vacía, vehículo, paisaje.`.trim();

// ─────────────────────────────────────────────────────────────
// PROMPTS — Primera pasada con enumeración dígito a dígito
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres un experto en lectura de medidores de gas domiciliario en Colombia.

TAREA: Lee el display de tambores giratorios y extrae la lectura.

DISPLAY: ventanilla rectangular con 8 posiciones totales.
- Posiciones 1-5 dígitos NEGROS = metros cúbicos (parte entera)
- Posiciones 6-8 dígitos ROJOS = decimales
- Formato obligatorio: NNNNN.NNN  (ej: 00201.655)

MÉTODO — sigue estos pasos en orden:
1. Localiza la ventanilla (ignora número de serie en el cuerpo, stickers, etiqueta amarilla de apartamento)
2. Cuenta las 8 posiciones de izquierda a derecha
3. Anota cada dígito individualmente en "digitos_individuales" (ej: "0,0,2,0,1 | 6,5,5")
4. Si un tambor queda entre dos dígitos → usa el INFERIOR (entre 5 y 6 → escribe 5)
5. Confusiones frecuentes: examina con cuidado 0↔6, 1↔7, 3↔8, 5↔6 antes de decidir
6. Combina: los 5 primeros + punto + los 3 últimos

CONFIANZA: "alta" si los 8 dígitos son claros. "baja" si 2 o más son dudosos.
CALIDAD: "buena" / "aceptable" (reflejo, poca luz) / "mala" (ilegible).
Si calidad es "aceptable" o "mala", incluye "motivo_calidad" con frase corta.

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,2,0,1 | 6,5,5",
  "lectura": "00201.655",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "frase describiendo el display y los dígitos vistos"
}`,

  agua: `Eres un experto en lectura de medidores de agua domiciliario en Colombia.

TAREA: Lee el display de tambores giratorios y extrae la lectura.

DISPLAY: ventanilla ovalada o rectangular con 8 posiciones totales.
- Posiciones 1-4 dígitos NEGROS = metros cúbicos (parte entera)
- Posiciones 5-8 dígitos ROJOS = decimales
- Formato obligatorio: NNNN.NNNN  (ej: 0134.8423)

MÉTODO — sigue estos pasos en orden:
1. Localiza la ventanilla del frente (carcasa generalmente azul o gris)
2. Ignora el número de serie grabado en el metal del cuerpo — NO es la lectura
3. Cuenta las 8 posiciones de izquierda a derecha
4. Anota cada dígito individualmente en "digitos_individuales" (ej: "0,1,3,4 | 8,4,2,3")
5. Si un tambor queda entre dos dígitos → usa el INFERIOR
6. Si hay duda entre rojo y negro por reflejo → trátalo como NEGRO
7. Confusiones frecuentes: examina 0↔6, 1↔7, 3↔8, 5↔6 antes de decidir

CONFIANZA: "alta" si los 8 dígitos son claros. "baja" si 2 o más son dudosos.
CALIDAD: "buena" / "aceptable" / "mala".
Si calidad es "aceptable" o "mala", incluye "motivo_calidad" con frase corta.

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "digitos_individuales": "0,1,3,4 | 8,4,2,3",
  "lectura": "0134.8423",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "frase describiendo el display y los dígitos vistos"
}`,

  luz: `Eres un experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

TAREA: Lee el display del medidor (tambores mecánicos o LCD digital) y extrae la lectura.

DISPLAY: 8 posiciones totales.
- Posiciones 1-5 = parte entera (kWh)
- Posiciones 6-8 = decimales (rojos en mecánico, o después del separador en LCD)
- Formato obligatorio: NNNNN.NNN  (ej: 00452.123)

MÉTODO — sigue estos pasos en orden:
1. Identifica el tipo de display: mecánico (tambores) o LCD (pantalla digital)
2. Localiza las 8 posiciones (ignora número de serie, marca, stickers de empresa)
3. Anota cada dígito individualmente en "digitos_individuales" (ej: "0,0,4,5,2 | 1,2,3")
4. Si es mecánico y un tambor queda entre dos dígitos → usa el INFERIOR
5. Confusiones frecuentes: examina 0↔6, 1↔7, 3↔8, 5↔6 antes de decidir
6. En LCD: lee exactamente los dígitos visibles sin inventar posiciones

CONFIANZA: "alta" si los 8 dígitos son claros. "baja" si 2 o más son dudosos.
CALIDAD: "buena" / "aceptable" / "mala".
Si calidad es "aceptable" o "mala", incluye "motivo_calidad" con frase corta.

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto adicional):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,4,5,2 | 1,2,3",
  "lectura": "00452.123",
  "confianza": "alta",
  "calidad_foto": "buena",
  "nota": "frase describiendo tipo de display y dígitos vistos"
}`,
};

// ─────────────────────────────────────────────────────────────
// PROMPTS — Segunda pasada independiente (sin sesgo de la primera)
// ─────────────────────────────────────────────────────────────
const PROMPTS_VERIFICACION = {

  gas: `Analiza esta imagen de un medidor de gas. Lee la ventanilla de tambores giratorios.
NO leas el número de serie del cuerpo metálico, stickers ni etiquetas.

Pasos obligatorios:
1. Cuenta las posiciones de la ventanilla (deben ser 8: 5 negras + 3 rojas)
2. Lee cada posición de izquierda a derecha y anótala en "digitos_individuales"
3. Si un tambor está entre dos dígitos → toma el inferior
4. Revisa posibles confusiones: 0↔6, 1↔7, 3↔8, 5↔6
5. Formato final: NNNNN.NNN

Responde ÚNICAMENTE con JSON:
{
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "nota": "qué viste exactamente en cada posición"
}`,

  agua: `Analiza esta imagen de un medidor de agua. Lee la ventanilla de tambores giratorios.
El número de serie en el metal del cuerpo NO es la lectura — ignóralo completamente.

Pasos obligatorios:
1. Cuenta las posiciones de la ventanilla (deben ser 8: 4 negras + 4 rojas)
2. Lee cada posición de izquierda a derecha y anótala en "digitos_individuales"
3. Si un tambor está entre dos dígitos → toma el inferior
4. Revisa posibles confusiones: 0↔6, 1↔7, 3↔8, 5↔6
5. Formato final: NNNN.NNNN

Responde ÚNICAMENTE con JSON:
{
  "lectura": "NNNN.NNNN o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "d1,d2,d3,d4 | d5,d6,d7,d8",
  "nota": "qué viste exactamente en la ventanilla"
}`,

  luz: `Analiza esta imagen de un medidor de electricidad. Lee el display (mecánico o LCD).
Ignora número de serie, stickers y texto de marca.

Pasos obligatorios:
1. Identifica tipo: mecánico (tambores) o LCD (pantalla digital)
2. Cuenta las posiciones (deben ser 8: 5 enteros + 3 decimales)
3. Lee cada posición de izquierda a derecha y anótala en "digitos_individuales"
4. Si es mecánico y tambor entre dos dígitos → toma el inferior
5. Revisa posibles confusiones: 0↔6, 1↔7, 3↔8, 5↔6
6. Formato final: NNNNN.NNN

Responde ÚNICAMENTE con JSON:
{
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "nota": "tipo de display y qué viste en cada posición"
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
    const json1   = await llamarModelo(workingBuffer, mediaType, prompt);
    const result1 = parsearResultado(json1);

    // Segunda pasada solo cuando la primera es genuinamente incierta
    const necesitaVerificacion = result1.confianza === 'baja'
      || result1.calidad_foto !== 'buena'
      || result1.es_medidor === false
      || result1.lectura === null;

    if (necesitaVerificacion) {
      try {
        const prompt2  = PROMPTS_VERIFICACION[tipo] || PROMPTS_VERIFICACION.luz;
        const json2    = await llamarModelo(workingBuffer, mediaType, prompt2);
        const result2  = parsearResultado(json2);

        // Primera dijo no-medidor pero la segunda sí → confiar en la segunda
        if (result1.es_medidor === false && result2.es_medidor !== false) {
          return { ...result2, nota: `[Verificado medidor] ${result2.nota}` };
        }

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
            // Discrepan: si la primera tenía alta confianza → confiar en ella
            // Si ambas eran inciertas → flag para admin
            if (result1.confianza === 'alta') {
              return {
                ...result1,
                nota: `[Confirmado 1ª pasada] ${result1.nota}`,
              };
            }
            return {
              ...result1,
              confianza:         'baja',
              requiere_revision: true,
              nota:              `[Ambiguo] Pasada 1: ${result1.lectura} · Pasada 2: ${result2.lectura}. Verifica la foto.`,
            };
          }
        }

        // Primera no leyó, segunda sí → usar segunda
        if (!result1.lectura && result2.lectura) {
          return { ...result2, nota: `[Recuperado en 2ª pasada] ${result2.nota}` };
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
