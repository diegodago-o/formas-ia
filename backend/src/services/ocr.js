const OpenAI    = require('openai');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const sharp     = require('sharp');
const logger    = require('../middleware/logger');
const Tesseract = require('node-tesseract-ocr');

const client      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ─────────────────────────────────────────────────────────────
// Preprocesamiento de imagen con Sharp
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Detección de blur — varianza del Laplaciano sobre imagen original
// Umbral configurable: OCR_BLUR_THRESHOLD (default 30)
// Imágenes muy borrosas nunca llegan a la IA
// ─────────────────────────────────────────────────────────────
const BLUR_THRESHOLD = parseInt(process.env.OCR_BLUR_THRESHOLD || '30', 10);

async function calcularNitidez(imagePath) {
  try {
    const { data } = await sharp(imagePath)
      .grayscale()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8Array(data);
    const n = pixels.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += pixels[i];
    const mean = sum / n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (pixels[i] - mean) ** 2;
    return variance / n;
  } catch (e) {
    return 999; // si falla el cálculo, dejar pasar a la IA
  }
}

// ─────────────────────────────────────────────────────────────
// Medir luminancia promedio (0–255) para ajustar brillo adaptativo
// ─────────────────────────────────────────────────────────────
async function medirBrillo(imagePath) {
  try {
    const { data } = await sharp(imagePath)
      .grayscale()
      .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(data);
    return pixels.reduce((s, p) => s + p, 0) / pixels.length;
  } catch {
    return 128; // valor neutro si falla
  }
}

async function preprocessImage(inputPath) {
  const tmpPath = path.join(
    os.tmpdir(),
    `ocr_${Date.now()}_${path.basename(inputPath)}.jpg`
  );

  // Brillo adaptativo según luminancia de la imagen original
  const brillo = await medirBrillo(inputPath);
  let brightnessBoost;
  if      (brillo < 60)  brightnessBoost = 1.55;  // muy oscura
  else if (brillo < 80)  brightnessBoost = 1.40;  // oscura
  else if (brillo < 110) brightnessBoost = 1.25;  // algo oscura
  else if (brillo < 140) brightnessBoost = 1.10;  // normal
  else                   brightnessBoost = 1.00;  // clara — sin boost

  logger.info(`OCR brillo ${path.basename(inputPath)}: ${brillo.toFixed(1)} → boost ${brightnessBoost}`);

  await sharp(inputPath)
    .rotate()                                          // corrige rotación EXIF
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 1.0 })
    .modulate({ saturation: 1.4, brightness: brightnessBoost })
    .jpeg({ quality: 93 })
    .toFile(tmpPath);
  return tmpPath;
}

// ─────────────────────────────────────────────────────────────
// Cola de concurrencia — evita saturar el límite de tokens/minuto
// Configurable: OCR_MAX_CONCURRENT (default 1)
// Con 30 000 TPM y ~2 600 tokens/imagen (1 pasada) → máx ~11 imágenes/min
// ─────────────────────────────────────────────────────────────
// Límite de concurrencia — 1 por defecto para no superar 30 000 TPM.
// Con 1 pasada (~2 600 tokens/imagen) y 4 s de pausa ≈ 7,5 imágenes/min ≈ 19 500 TPM → margen seguro.
// Si el plan de OpenAI tiene más TPM, aumentar OCR_MAX_CONCURRENT en .env.
const OCR_MAX_CONCURRENT = parseInt(process.env.OCR_MAX_CONCURRENT || '1', 10);
// Pausa mínima DESPUÉS de cada llamada antes de liberar el slot.
// Con 1 pasada única: API ~4 s + 4 s pausa = 8 s/imagen → 7,5 imágenes/min → ~19 500 TPM.
// (Antes con 2 pasadas se necesitaban 6 s; ahora 4 s son suficientes con margen.)
const OCR_MIN_DELAY_MS = parseInt(process.env.OCR_MIN_DELAY_MS || '4000', 10);
let _ocrActive = 0;
const _ocrQueue = [];

function _tomarSlotOCR() {
  return new Promise(resolve => {
    if (_ocrActive < OCR_MAX_CONCURRENT) { _ocrActive++; resolve(); }
    else { _ocrQueue.push(resolve); }
  });
}
function _liberarSlotOCR() {
  _ocrActive--;
  if (_ocrQueue.length > 0) { _ocrActive++; _ocrQueue.shift()(); }
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
// Wrapper con reintentos automáticos ante 429, 500 y JSON inválido
//
// PROBLEMA con 429 en ráfaga: si N workers esperan el mismo tiempo
// indicado por OpenAI, todos reintentarán a la vez y volverán a chocar.
// Solución: añadir JITTER (tiempo aleatorio extra) para escalonar reintentos.
//
// También se reintenta en:
//   - 500 Internal Server Error (error temporal de OpenAI)
//   - "Respuesta sin JSON válido" (modelo devuelve texto plano por sobrecarga)
// ─────────────────────────────────────────────────────────────
async function llamarModeloConRetry(imageBuffer, mediaType, prompt, maxRetries = 6) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await llamarModelo(imageBuffer, mediaType, prompt);
    } catch (err) {
      const msg    = err.message || '';
      const is429  = err.status === 429 || msg.startsWith('429');
      const is500  = err.status === 500 || msg.startsWith('500');
      const isJson = msg === 'Respuesta sin JSON válido';

      const shouldRetry = (is429 || is500 || isJson) && attempt < maxRetries;

      if (!shouldRetry) throw err;

      let waitMs;
      if (is429) {
        // Respetar el tiempo que pide OpenAI + margen + jitter aleatorio
        // El jitter evita que múltiples workers reintentos en el mismo instante
        const hint    = msg.match(/try again in ([\d.]+)s/i);
        const baseMs  = hint
          ? Math.ceil(parseFloat(hint[1]) * 1000) + 1000   // sugerido + 1 s
          : Math.min(6000 * (attempt + 1), 60000);          // fallback exponencial
        const jitter  = Math.floor(Math.random() * Math.min(baseMs, 5000)); // hasta 5 s extra
        waitMs = baseMs + jitter;
      } else {
        // 500 o JSON inválido → backoff exponencial con jitter leve
        waitMs = Math.min(3000 * Math.pow(2, attempt), 30000)
               + Math.floor(Math.random() * 2000);
      }

      const tipo = is429 ? '429 rate-limit' : is500 ? '500 server error' : 'JSON inválido';
      logger.warn(`OCR ${tipo} — esperando ${waitMs}ms (intento ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Validación cruzada: digitos_individuales vs lectura ensamblada
// Detecta inconsistencias internas del modelo antes de usar el resultado
// ─────────────────────────────────────────────────────────────
function validarDigitosVsLectura(json) {
  if (!json.digitos_individuales || !json.lectura) return null;
  try {
    // "0,0,2,1,5 | 2,5,9" → "00215259"
    const flat = json.digitos_individuales
      .replace(/\s*\|\s*/g, ',')
      .split(',')
      .map(d => d.trim())
      .filter(d => /^\d$/.test(d))
      .join('');
    // "00215.259" → "00215259"
    const lecturaFlat = json.lectura.replace(/\./g, '');
    if (flat.length > 0 && lecturaFlat.length > 0 && flat !== lecturaFlat) {
      return `digitos_individuales (${flat}) ≠ lectura (${lecturaFlat})`;
    }
  } catch { /* si falla el parse, no bloqueamos */ }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Parsear resultado del modelo a formato estándar
// ─────────────────────────────────────────────────────────────
function parsearResultado(json) {
  const calidad   = json.calidad_foto || 'buena';
  const esMedidor = json.es_medidor !== false;
  // Refuerzo anti-alucinación: si calidad es mala, la lectura no es confiable
  const lectura   = (calidad === 'mala') ? null : (json.lectura ?? null);
  let confianza   = json.confianza ?? 'baja';
  let nota        = json.nota ?? '';

  // Validación cruzada interna: si digitos_individuales difiere de lectura → bajar confianza
  if (lectura) {
    const discrepancia = validarDigitosVsLectura(json);
    if (discrepancia) {
      confianza = 'baja';
      nota = `[DISCREPANCIA INTERNA: ${discrepancia}] ${nota}`.trim();
    }
  }

  return {
    es_medidor:        esMedidor,
    lectura,
    confianza:         (calidad === 'mala') ? 'baja' : confianza,
    calidad_foto:      calidad,
    motivo_calidad:    (json.motivo_calidad && !json.motivo_calidad.toLowerCase().includes('omitir'))
                         ? json.motivo_calidad : null,
    nota,
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
// Reglas de desambiguación visual — compartidas por los 6 prompts
// ─────────────────────────────────────────────────────────────
const AUDITORIA_VISUAL = `
AUDITORÍA DE CONFUSIONES — aplica a cada dígito antes de confirmarlo:

PARES CONFLICTIVOS:
· 0 vs 6 → El CERO es un óvalo completamente cerrado: no tiene ninguna apertura en ningún extremo.
           El SEIS tiene una curva ABIERTA visible en la parte superior (arco que se abre hacia arriba).
           Si no ves una apertura clara en la parte superior → es 0, no 6.
· 1 vs 7 → El SIETE tiene un trazo horizontal en la parte superior. Si no hay trazo horizontal → es 1.
· 2 vs 5 → El DOS tiene la curva en la parte SUPERIOR y la BASE completamente plana y recta.
           El CINCO tiene un trazo recto horizontal en la PARTE SUPERIOR y un VIENTRE REDONDEADO
           en la base (barriga curva cerrada hacia abajo).
           En tambores: base plana → es 2. Vientre curvo inferior → es 5.
           CRÍTICO: confundir 2 con 5 invierte la lectura en ~3 unidades.
· 3 vs 8 → El TRES tiene la parte superior abierta (dos arcos, el de arriba abierto hacia la izquierda).
           El OCHO es completamente cerrado (dos óvalos apilados). Si ambas mitades están cerradas → es 8.
· 5 vs 6 → El CINCO tiene la parte inferior redondeada y la superior con un trazo recto a la izquierda.
           El SEIS cierra en la parte inferior en un círculo completo. Si el círculo inferior está cerrado → es 6.

FOTO A TRAVÉS DE VIDRIO (escenario frecuente en Colombia):
Muchos medidores están detrás de una reja o vidrio y el auditor no puede abrirla.
Síntomas: reflejo de la habitación superpuesto, halo o contorno doble alrededor de los dígitos,
          reducción de contraste entre el fondo y los números.
Regla clave: los efectos ópticos del vidrio (halos, sombras, doble contorno) NO forman parte
             del dígito — son artefactos de la reflexión. Evalúa únicamente la FORMA ESTRUCTURAL
             del dígito ignorando cualquier sombra o halo periférico.
             Un óvalo con halo por reflejo sigue siendo 0. Un arco abierto con halo sigue siendo 6.
Si la foto presenta estos síntomas, anota en la nota: "foto a través de vidrio".`.trim();

// ─────────────────────────────────────────────────────────────
// Orientación y formato variable — inyectado en los 6 prompts
// ─────────────────────────────────────────────────────────────
const ORIENTACION_Y_FORMATO = `
ORIENTACIÓN DEL MEDIDOR:
Los medidores en Colombia pueden estar instalados y fotografiados en CUALQUIER orientación:
horizontal (tambores de izq. a der.), vertical (tambores de arriba a abajo), diagonal o invertido.
· Si los tambores van de IZQUIERDA A DERECHA → lee de izq. a der. (dígito más significativo primero).
· Si los tambores van de ARRIBA A ABAJO → lee de arriba a abajo (el dígito superior es el más significativo).
· Si el medidor está INVERTIDO → ajusta la lectura al sentido natural del display, no al de la foto.
NO asumas que los tambores están siempre horizontales. Identifica su orientación real en la imagen.

CANTIDAD DE TAMBORES — NO ASUMAS UN NÚMERO FIJO:
Colombia tiene medidores de distintos fabricantes con 5, 6, 7, 8 o más tambores.
CUENTA los tambores que realmente ves — no inventes posiciones que no existen.

SEPARADOR DECIMAL — DETECCIÓN SECUNDARIA:
Después de leer todos los dígitos posición a posición, busca el separador decimal:
· Cambio de color de fondo entre tambores (ej. negro → rojo) → separador antes del primer tambor rojo.
· Punto físico (.) marcado en el marco de la ventanilla entre dos tambores.
· Etiqueta o serigrafía del medidor con "m³" o "kWh" que indique cuántos decimales tiene.
El color de los tambores es una PISTA SECUNDARIA del separador, no define la estructura principal.
Si no hay señal clara del separador: reporta los dígitos sin punto y anota "separador no visible".`.trim();

// ─────────────────────────────────────────────────────────────
// Reglas anti-alucinación — inyectadas en los 6 prompts
// ─────────────────────────────────────────────────────────────
const ANTI_ALUCINACION = `
REGLAS ANTI-ALUCINACIÓN — de obligatorio cumplimiento:

REGLA 1 — SOLO LO QUE VES:
Escribe únicamente los dígitos que puedes leer directamente en la imagen.
NUNCA completes, rellenes ni inferras dígitos que no están claramente visibles.
Si un dígito no es distinguible → no puedes afirmar cuál es.

REGLA 2 — VENTANILLA INCOMPLETA (imagen recortada o cortada):
Si la ventanilla de tambores no aparece COMPLETA en el encuadre:
→ lectura = null
→ calidad_foto = "mala"
→ motivo_calidad = "ventanilla recortada — no se ven todos los dígitos"
→ nota: indica cuántos dígitos sí se ven y cuáles son (ej: "se ven 4 dígitos: 1, 2, 6, parcialmente")
NO generes una lectura de 8 dígitos si no ves los 8 dígitos.

REGLA 3 — IMAGEN ILEGIBLE O BORROSA:
Si la imagen está desenfocada, muy oscura, borrosa o con reflejos que impiden leer los dígitos:
→ lectura = null
→ calidad_foto = "mala"
→ motivo_calidad = descripción del problema real (ej: "imagen borrosa", "reflejo total en ventanilla")
NO generes ninguna lectura. NO afirmes que los dígitos son nítidos cuando no lo son.

REGLA 4 — PROHIBICIÓN DE DESCRIPCIONES FALSAS:
NUNCA escribas:
· "Los dígitos son nítidos y claramente visibles" si hay blur, recorte o reflejo
· "La ventanilla muestra claramente todos los dígitos" si la imagen está recortada
· "No hay reflejos" sin evidencia visual
Solo describe lo que realmente observas.

REGLA 5 — LECTURA PARCIAL PERMITIDA:
Si solo algunos dígitos son visibles con certeza y el resto no se puede leer:
→ lectura = null (no inventes los faltantes)
→ en la nota: "se observan parcialmente los dígitos [X, Y, Z]; el resto no es legible"`.trim();

// ─────────────────────────────────────────────────────────────
// PROMPTS — Primera pasada: enumeración posición a posición
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres experto en lectura de medidores de gas domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display de tambores giratorios con precisión absoluta.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

PASO 0 — VALIDACIÓN PREVIA (antes de leer cualquier dígito):
  a) ¿La ventanilla de tambores está completamente dentro del encuadre? Si no → lectura = null, calidad = "mala".
  b) ¿La imagen está lo suficientemente nítida para distinguir los dígitos? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), omite los pasos siguientes y responde directamente con el JSON de error.

ELEMENTOS A IGNORAR — no forman parte de la lectura:
- Número de serie grabado o estampado en el cuerpo metálico del medidor
- Stickers de apartamento (etiquetas amarillas, blancas o de papel)
- Placa de identificación de la empresa de gas
- Cualquier número impreso fuera de la ventanilla de tambores

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla/display de tambores. Confirma que NO estás leyendo el número de serie del cuerpo metálico.

PASO 2 — CONTEO REAL: Cuenta exactamente cuántos tambores hay. Pueden ser 5, 6, 7, 8 o más — NO asumas un número fijo. Anota el conteo real.

PASO 3 — LECTURA POSICIÓN A POSICIÓN:
  Para cada tambor, en el orden del display (del más significativo al menos):
  · Pos 1: ¿qué dígito ves? → anota
  · Pos 2: ¿qué dígito ves? → anota
  · Pos 3: ¿qué dígito ves? → anota
  · ... continúa hasta el último tambor
  Si el tambor no es legible → anota "?"

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez (rueda girando entre posiciones), usa SIEMPRE el dígito inferior.

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Si identificaste el separador decimal: parte entera + "." + decimales.
  · Si NO hay señal clara del separador: escribe los dígitos sin punto y anota "separador no visible".
  · Unidad: m³ (metros cúbicos de gas).

CALIDAD DE FOTO:
- "buena": display completamente nítido, sin reflejos, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero dígitos legibles
- "mala": desenfocado, muy oscuro, ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad (frase corta).

CONFIANZA:
- "alta": todos los dígitos leídos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos tras la auditoría

${ANTI_ALUCINACION}

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,2,0,1 | 6,5,5",
  "lectura": "00201.655",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "N tambores visibles; orientación; separador detectado; dígitos leídos"
}`,

  agua: `Eres experto en lectura de medidores de agua domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display de tambores giratorios con precisión absoluta.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

PASO 0 — VALIDACIÓN PREVIA (antes de leer cualquier dígito):
  a) ¿La ventanilla de tambores está completamente dentro del encuadre? Si no → lectura = null, calidad = "mala".
  b) ¿La imagen está lo suficientemente nítida para distinguir los dígitos? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), omite los pasos siguientes y responde directamente con el JSON de error.

ELEMENTOS A IGNORAR — no forman parte de la lectura:
- Número de serie grabado o troquelado en el metal del cuerpo (puede parecer una lectura pero NO lo es)
- Marca del fabricante (ACTARIS, Itron, Sensus, ISOIL, etc.)
- Stickers de apartamento o de empresa de acueducto
- Cualquier número impreso fuera de la ventanilla de tambores

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla/display de tambores en el frente del medidor. Distingue la ventanilla del número de serie del cuerpo.

PASO 2 — CONTEO REAL: Cuenta exactamente cuántos tambores hay. Pueden ser 5, 6, 7, 8 o más — NO asumas un número fijo. Anota el conteo real.

PASO 3 — LECTURA POSICIÓN A POSICIÓN:
  Para cada tambor, en el orden del display (del más significativo al menos):
  · Pos 1: ¿qué dígito ves? → anota
  · Pos 2: ¿qué dígito ves? → anota
  · ... continúa hasta el último tambor
  Si el tambor no es legible → anota "?"

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez, usa el dígito INFERIOR.

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Si identificaste el separador decimal: parte entera + "." + decimales.
  · Si NO hay señal clara del separador: escribe los dígitos sin punto y anota "separador no visible".
  · Unidad: m³ (metros cúbicos de agua).

CALIDAD DE FOTO:
- "buena": display completamente nítido, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero legible
- "mala": ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad breve.

CONFIANZA:
- "alta": todos los dígitos leídos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos

${ANTI_ALUCINACION}

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,1,3,4 | 8,4,2,3",
  "lectura": "0134.8423",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "N tambores visibles; orientación; separador detectado; dígitos leídos"
}`,

  luz: `Eres experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display del medidor (tambores mecánicos o pantalla LCD) con precisión absoluta.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

PASO 0 — VALIDACIÓN PREVIA (antes de leer cualquier dígito):
  a) ¿El display está completamente dentro del encuadre? Si no → lectura = null, calidad = "mala".
  b) ¿La imagen está lo suficientemente nítida para distinguir los dígitos? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), omite los pasos siguientes y responde directamente con el JSON de error.

ELEMENTOS A IGNORAR:
- Número de serie grabado o impreso en el cuerpo del medidor
- Marca/modelo (EDMI, Landis+Gyr, ABB, Circutor, ZIV, etc.)
- Stickers de empresa eléctrica, sellos de calibración
- Números de tarifa o de circuito impresos alrededor del display

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — TIPO DE DISPLAY: ¿Mecánico (tambores giratorios) o LCD (pantalla digital)?

PASO 2 — LOCALIZACIÓN: Identifica el display. Descarta número de serie.

━━━ SI ES MECÁNICO (tambores) ━━━

PASO 3 — CONTEO REAL: Cuenta los tambores visibles. Pueden ser 5, 6, 7, 8 o más — NO asumas un número. Algunos modelos tienen solo tambores de fondo rojo al final, otros tienen solo negros, otros mezclan. Cuenta lo que ves.

PASO 4 — LECTURA POSICIÓN A POSICIÓN:
  Para cada tambor en el orden natural del display (del más significativo al menos):
  · Anota el dígito de cada posición.
  · Tambor entre dos dígitos → usa el INFERIOR.
  · Tambor ilegible → anota "?"

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Si hay cambio de color entre tambores → el separador está antes del primer tambor de distinto color.
  · Si hay punto físico marcado en el marco → úsalo como separador.
  · Si no hay señal clara: escribe los dígitos sin punto y anota "separador no visible".
  · Unidad: kWh.

━━━ SI ES LCD (pantalla digital) ━━━

PASO 3 — Lee los dígitos de izquierda a derecha. Identifica el separador decimal (punto o coma).
PASO 4 — Anota parte entera y parte decimal.
PASO 5 — Audita: ¿0↔8? ¿1↔7? ¿2↔5? ¿3↔8? en pantalla LCD.
ENSAMBLAJE: parte entera + "." + parte decimal → lectura final.

CALIDAD DE FOTO:
- "buena": display completamente nítido, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero legible
- "mala": ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad breve.

CONFIANZA:
- "alta": todos los dígitos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos

${ANTI_ALUCINACION}

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,4,5,2 | 1,2,3",
  "lectura": "00452.123",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "tipo display; N tambores; orientación; separador; dígitos leídos"
}`,
};

// ─────────────────────────────────────────────────────────────
// PROMPTS_VERIFICACION eliminado — ya no se usa segunda pasada GPT-4o.
// La confianza se eleva solo cuando Tesseract (local, sin costo) confirma
// la lectura de la primera (y única) pasada.
// ─────────────────────────────────────────────────────────────
const PROMPTS_VERIFICACION = { // mantenido por compatibilidad pero no se llama

  gas: `Analiza esta imagen de un medidor de gas domiciliario colombiano.

CONTEXTO: La lectura se extrae de la ventanilla de tambores giratorios, NO del número de serie del cuerpo metálico ni de stickers o etiquetas.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

VALIDACIÓN PREVIA (obligatoria antes de cualquier lectura):
  a) ¿La ventanilla de tambores está completamente visible en la imagen? Si no → lectura = null, calidad = "mala".
  b) ¿Puedes distinguir los dígitos con claridad? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), responde directamente con JSON de error sin proceder al método.

${ORIENTACION_Y_FORMATO}

MÉTODO — lectura posición a posición con verificación por color:

FASE 1 — Identifica la orientación del display (horizontal / vertical / inclinado).

FASE 2 — Lee cada tambor en el orden natural del display (del más significativo al menos):
  · Para cada posición: anota el dígito visible.
  · Tambor en transición → usa el dígito INFERIOR.
  · Tambor ilegible → "?"

FASE 3 — Detecta el separador decimal:
  · Busca cambio de color de fondo entre tambores (negro → rojo).
  · Busca punto físico marcado en el marco de la ventanilla.
  · Si lo encuentras: registra después de qué posición está.
  · Si no hay señal: anota "separador no visible".

${AUDITORIA_VISUAL}

FASE 4 — Aplica la auditoría a cada dígito y corrige si corresponde.

ENSAMBLAJE:
  · Con separador: parte entera + "." + decimales.
  · Sin separador: dígitos sin punto.
  · Unidad: m³.

CALIDAD: "buena" / "aceptable" / "mala". Si no es "buena", añade motivo_calidad breve.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dudosos).

${ANTI_ALUCINACION}
${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "orientación del display; N tambores; separador; dígitos leídos"
}`,

  agua: `Analiza esta imagen de un medidor de agua domiciliario colombiano (carcasa azul o gris).

CONTEXTO: La lectura se extrae de la ventanilla de tambores giratorios del frente del medidor. El número de serie grabado en el metal del cuerpo NO es la lectura — ignóralo por completo.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

VALIDACIÓN PREVIA (obligatoria antes de cualquier lectura):
  a) ¿La ventanilla de tambores está completamente visible en la imagen? Si no → lectura = null, calidad = "mala".
  b) ¿Puedes distinguir los dígitos con claridad? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), responde directamente con JSON de error sin proceder al método.

${ORIENTACION_Y_FORMATO}

MÉTODO — lectura posición a posición con verificación por color:

FASE 1 — Identifica la orientación del display (horizontal / vertical / inclinado).

FASE 2 — Lee cada tambor en el orden natural del display (del más significativo al menos):
  · Para cada posición: anota el dígito visible.
  · Tambor en transición → usa el dígito INFERIOR.
  · Tambor ilegible → "?"

FASE 3 — Detecta el separador decimal:
  · Busca cambio de color de fondo entre tambores.
  · Busca punto físico en el marco.
  · Si no hay señal: anota "separador no visible".

${AUDITORIA_VISUAL}

FASE 4 — Aplica la auditoría a cada dígito y corrige si corresponde.

ENSAMBLAJE:
  · Con separador: parte entera + "." + decimales.
  · Sin separador: dígitos sin punto.
  · Unidad: m³.

CALIDAD: "buena" / "aceptable" / "mala". Si no es "buena", añade motivo_calidad breve.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dudosos).

${ANTI_ALUCINACION}
${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4 | d5,d6,d7,d8",
  "lectura": "NNNN.NNNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "orientación del display; N tambores; separador; dígitos leídos"
}`,

  luz: `Analiza esta imagen de un medidor de electricidad domiciliario colombiano.

CONTEXTO: Lee el display del medidor (tambores mecánicos o pantalla LCD). Ignora el número de serie del cuerpo, la marca y los stickers de la empresa eléctrica.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

VALIDACIÓN PREVIA (obligatoria antes de cualquier lectura):
  a) ¿El display está completamente visible en la imagen? Si no → lectura = null, calidad = "mala".
  b) ¿Puedes distinguir los dígitos con claridad? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), responde directamente con JSON de error sin proceder al método.

${ORIENTACION_Y_FORMATO}

PASO PREVIO — IDENTIFICA EL TIPO DE DISPLAY:
- MECÁNICO: ruedas numeradas con fondos de color (pueden ser todos negros, todos rojos, o mezcla)
- LCD: pantalla digital plana con números iluminados

━━━ SI ES MECÁNICO — lee posición a posición ━━━

FASE 1 — Identifica la orientación (horizontal / vertical / inclinado).
FASE 2 — Cuenta cuántos tambores hay (pueden ser 5, 6, 7, 8 — NO asumas un número).
FASE 3 — Lee cada tambor en el orden natural del display (del más significativo al menos).
  · Tambor en transición → usa el INFERIOR.
FASE 4 — Detecta el separador: cambio de color de fondo, punto físico en el marco, o "separador no visible".

${AUDITORIA_VISUAL}

ENSAMBLAJE: parte entera + "." + decimales (o sin punto si no hay separador). Unidad: kWh.

━━━ SI ES LCD — lee por secciones del separador ━━━

1. Localiza el separador decimal (punto o coma en la pantalla).
2. Lee dígitos a la izquierda (enteros) y a la derecha (decimales).
3. Audita: ¿0↔8? ¿1↔7? ¿2↔5? ¿3↔8? en pantalla LCD.
ENSAMBLAJE: parte entera + "." + parte decimal. Unidad: kWh.

CALIDAD: "buena" / "aceptable" / "mala". Si no es "buena", añade motivo_calidad breve.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dudosos).

${ANTI_ALUCINACION}
${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "tipo display; orientación; N tambores; separador; dígitos leídos"
}`,
};

// ─────────────────────────────────────────────────────────────
// Comparación de lecturas por secuencia de dígitos
// Ignora separador decimal (coma, punto) y ceros a la izquierda.
// "0082.405", "0082,405" y "0082405" son el mismo medidor.
// Compara desde la izquierda hasta el largo de la lectura más corta.
// ─────────────────────────────────────────────────────────────
function coincidenciaDigitos(l1, l2) {
  if (!l1 || !l2) return false;
  const d1 = l1.replace(/[^0-9]/g, ''); // solo dígitos
  const d2 = l2.replace(/[^0-9]/g, '');
  if (d1.length < 4 || d2.length < 4) return false; // secuencia muy corta → no concluyente
  const n = Math.min(d1.length, d2.length);
  return d1.substring(0, n) === d2.substring(0, n);
}

// ─────────────────────────────────────────────────────────────
// Lectura con Tesseract — validador local de dígitos
// Corre en paralelo con GPT-4o para no añadir latencia.
// Si ambos coinciden → alta confianza, se omite la segunda pasada GPT-4o.
// Retorna la secuencia de dígitos más larga encontrada, o null si falla.
// ─────────────────────────────────────────────────────────────
async function leerConTesseract(imagePath) {
  const tmpPath = path.join(os.tmpdir(), `tess_${Date.now()}.png`);
  try {
    // IMPORTANTE — NO usar threshold(128) ni whitelist de solo dígitos:
    // Esa combinación convierte toda la imagen a blanco/negro y fuerza a
    // Tesseract a interpretar CADA mancha como un dígito, produciendo
    // secuencias de 50+ caracteres de ruido puro.
    //
    // Sin whitelist Tesseract usa su modelo LSTM completo y distingue
    // texto real de fondo; luego filtramos solo las secuencias numéricas.
    // PSM 11 (sparse text) busca texto disperso en toda la imagen, ideal
    // cuando no sabemos dónde está la ventanilla del medidor.
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .resize(1600, null, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toFile(tmpPath);

    const text = await Tesseract.recognize(tmpPath, {
      lang: 'eng',
      oem: '1',   // LSTM
      psm: '11',  // sparse text — busca texto disperso en toda la imagen
      // Sin tessedit_char_whitelist: el modelo LSTM trabaja mejor sin
      // la restricción que lo fuerza a convertir cualquier mancha en dígito
    });

    if (!text?.trim()) return null;

    // Filtrar a secuencias de longitud razonable para medidores (4–12 dígitos)
    // Descarta: ruido < 4, números de serie imposiblemente largos > 12
    const secuencias = (text.match(/\d+/g) || [])
      .filter(s => s.length >= 4 && s.length <= 12);

    if (!secuencias.length) return null;

    // De todos los candidatos razonables, devolver el más largo
    return secuencias.reduce((a, b) => a.length >= b.length ? a : b);
  } catch {
    return null; // Tesseract no disponible o falla → no bloquea el flujo principal
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

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

  // ── Blur gate: rechazar imágenes borrosas antes de llamar a la IA ──
  const nitidez = await calcularNitidez(imagePath);
  logger.info(`OCR blur score ${imagePath}: ${nitidez.toFixed(1)} (umbral: ${BLUR_THRESHOLD})`);
  if (nitidez < BLUR_THRESHOLD) {
    logger.warn(`OCR rechazada por blur (score ${nitidez.toFixed(1)}): ${imagePath}`);
    return {
      es_medidor: true,
      lectura: null,
      confianza: 'baja',
      calidad_foto: 'mala',
      motivo_calidad: `Imagen borrosa (nitidez ${nitidez.toFixed(0)}) — retoma la foto con mejor enfoque`,
      requiere_revision: true,
      nota: `Rechazada automáticamente antes de IA: blur score ${nitidez.toFixed(1)} < umbral ${BLUR_THRESHOLD}`,
    };
  }

  // ── Esperar slot de concurrencia antes de preprocesar o llamar a la IA ──
  await _tomarSlotOCR();
  logger.info(`OCR slot tomado (activos: ${_ocrActive}/${OCR_MAX_CONCURRENT}) — ${path.basename(imagePath)}`);

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
    // ── GPT-4o + Tesseract corren en PARALELO ─────────────────────────
    // Tesseract es local (sin costo de tokens). Si confirma la lectura de
    // GPT-4o → sube la confianza a 'alta'. En todos los demás casos se
    // devuelve directamente el resultado de GPT-4o sin segunda pasada.
    // Una sola llamada a la IA por imagen mantiene el consumo bajo 30 000 TPM.
    const [gptSettled, tessSettled] = await Promise.allSettled([
      llamarModeloConRetry(workingBuffer, mediaType, prompt).then(j => parsearResultado(j)),
      leerConTesseract(processedPath || imagePath),
    ]);

    if (gptSettled.status === 'rejected') throw gptSettled.reason;

    const result1          = gptSettled.value;
    const tesseractLectura = tessSettled.status === 'fulfilled' ? tessSettled.value : null;

    logger.info(`OCR Tesseract="${tesseractLectura || 'null'}" GPT-4o="${result1.lectura || 'null'}" — ${path.basename(imagePath)}`);

    // Tesseract confirma GPT-4o → subir confianza a 'alta'
    if (result1.lectura && tesseractLectura && coincidenciaDigitos(result1.lectura, tesseractLectura)) {
      logger.info(`OCR Tess+GPT coinciden → alta confianza`);
      return {
        ...result1,
        confianza:         'alta',
        requiere_revision: result1.calidad_foto === 'mala' || !result1.es_medidor,
        nota:              `[✓ Tess:${tesseractLectura}] ${result1.nota || ''}`.trim(),
      };
    }

    // Sin confirmación → devolver resultado de pasada única
    return result1;

  } catch (err) {
    logger.error(`OCR error para ${imagePath}: ${err.message}`);
    return {
      es_medidor: true, lectura: null, confianza: 'baja',
      calidad_foto: 'mala', motivo_calidad: 'Error al procesar la imagen con IA',
      requiere_revision: true, nota: 'Error al procesar la imagen con IA',
    };
  } finally {
    // 1. Limpiar archivo temporal
    if (processedPath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }
    // 2. Pausa mínima para no superar el límite TPM antes de liberar el slot
    if (OCR_MIN_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, OCR_MIN_DELAY_MS));
    }
    // 3. Liberar slot (puede despertar la siguiente llamada en cola)
    _liberarSlotOCR();
    logger.info(`OCR slot liberado (activos: ${_ocrActive}/${OCR_MAX_CONCURRENT}) — ${path.basename(imagePath)}`);
  }
}

module.exports = { analizarMedidor, coincidenciaDigitos };
