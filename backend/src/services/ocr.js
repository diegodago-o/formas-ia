const OpenAI    = require('openai');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const sharp     = require('sharp');
const logger    = require('../middleware/logger');
const Tesseract = require('node-tesseract-ocr');

const client           = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL     = process.env.OPENAI_MODEL      || 'gpt-4o';
const OPENAI_MODEL_MINI = process.env.OPENAI_MODEL_MINI || 'gpt-4o-mini';

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
// ─────────────────────────────────────────────────────────────
const OCR_MAX_CONCURRENT = parseInt(process.env.OCR_MAX_CONCURRENT || '1', 10);
const OCR_MIN_DELAY_MS   = parseInt(process.env.OCR_MIN_DELAY_MS   || '4000', 10);
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
// detail: 'low' (default, 85 tokens fijos) | 'high' (tiles, ~765–1085 tokens)
// model: override del modelo (gpt-4o-mini o gpt-4o)
// ─────────────────────────────────────────────────────────────
async function llamarModelo(imageBuffer, mediaType, prompt, detail = 'low', model = null) {
  const base64 = imageBuffer.toString('base64');
  const response = await client.chat.completions.create({
    model: model || OPENAI_MODEL,
    max_completion_tokens: 300,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${base64}`, detail },
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
// ─────────────────────────────────────────────────────────────
async function llamarModeloConRetry(imageBuffer, mediaType, prompt, maxRetries = 6, detail = 'low', model = null) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await llamarModelo(imageBuffer, mediaType, prompt, detail, model);
    } catch (err) {
      const msg    = err.message || '';
      const is429  = err.status === 429 || msg.startsWith('429');
      const is500  = err.status === 500 || msg.startsWith('500');
      const isJson = msg === 'Respuesta sin JSON válido';

      const shouldRetry = (is429 || is500 || isJson) && attempt < maxRetries;

      if (!shouldRetry) throw err;

      let waitMs;
      if (is429) {
        const hint    = msg.match(/try again in ([\d.]+)s/i);
        const baseMs  = hint
          ? Math.ceil(parseFloat(hint[1]) * 1000) + 1000
          : Math.min(6000 * (attempt + 1), 60000);
        const jitter  = Math.floor(Math.random() * Math.min(baseMs, 5000));
        waitMs = baseMs + jitter;
      } else {
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
// ─────────────────────────────────────────────────────────────
function validarDigitosVsLectura(json) {
  if (!json.digitos_individuales || !json.lectura) return null;
  try {
    const flat = json.digitos_individuales
      .replace(/\s*\|\s*/g, ',')
      .split(',')
      .map(d => d.trim())
      .filter(d => /^\d$/.test(d))
      .join('');
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
  const lectura   = (calidad === 'mala') ? null : (json.lectura ?? null);
  let confianza   = json.confianza ?? 'baja';
  let nota        = json.nota ?? '';

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
// Bloques de instrucción compartidos por los 3 prompts
// ─────────────────────────────────────────────────────────────
const ES_MEDIDOR_REGLA = `
MEDIDOR VÁLIDO (es_medidor=true): cualquier equipo de medición de servicios públicos domiciliarios en Colombia.
Incluye: medidores de gas (carcasa metálica/blanca, tambores giratorios, G-1/G-1.6/G-2.5/G-4/G-6), agua (carcasa azul/gris, ACTARIS/Itron/Sensus/ISOIL), electricidad (LCD digital o tambores mecánicos, EDMI/Landis+Gyr/ABB/Circutor/ZIV).
Señales clave: display con dígitos rotatorios o LCD, sello de empresa, unidades m³ o kWh, conectores de tubería o cable.
es_medidor=false ÚNICAMENTE si la imagen NO contiene ningún equipo de medición: persona, animal, mueble, pared vacía, vehículo, paisaje.`.trim();

const AUDITORIA_VISUAL = `
AUDITORÍA DE CONFUSIONES — aplica dígito a dígito antes de confirmar:

· 0 vs 6 → Cero: óvalo COMPLETAMENTE cerrado (sin apertura). Seis: arco abierto visible en la parte superior. Sin apertura clara → es 0, no 6.
· 1 vs 7 → Siete tiene trazo horizontal superior. Sin trazo → es 1.
· 2 vs 5 → Dos: curva en la PARTE SUPERIOR + base plana y recta. Cinco: trazo recto horizontal arriba + vientre redondeado en la base. Base plana → 2. Vientre curvo → 5.
· 3 vs 8 → Tres: mitad superior abierta (arco abierto hacia la izquierda). Ocho: dos óvalos completamente cerrados. Ambas mitades cerradas → 8.
· 5 vs 6 → Seis: círculo inferior completamente cerrado. Cinco: base redondeada sin cerrar círculo. Círculo inferior cerrado → 6.

FOTO A TRAVÉS DE VIDRIO: Halos, sombras y contorno doble son artefactos ópticos del reflejo, no parte del dígito. Evalúa solo la forma estructural ignorando los artefactos. Anota "foto a través de vidrio" si aplica.`.trim();

const ORIENTACION_Y_FORMATO = `
ORIENTACIÓN: Los medidores pueden estar en cualquier orientación (horizontal, vertical, diagonal, invertido). Lee en el sentido natural del display, no el de la foto.

CANTIDAD DE TAMBORES: NO asumas un número fijo. Hay medidores de 5, 6, 7, 8 o más tambores. Cuenta exactamente los que ves.

SEPARADOR DECIMAL: Detecta: (1) cambio de color entre tambores (negro→rojo: separador antes del primer tambor rojo), (2) punto físico en el marco, (3) indicación en la etiqueta. Sin señal clara: reporta los dígitos sin punto y anota "separador no visible".`.trim();

const ANTI_ALUCINACION = `
REGLAS ANTI-ALUCINACIÓN — obligatorio:

R1 — SOLO LO QUE VES: Escribe únicamente los dígitos que puedes leer directamente. NUNCA completes ni inferras dígitos no visibles.
R2 — VENTANILLA INCOMPLETA: Si la ventanilla no está completa en el encuadre → lectura=null, calidad="mala", motivo="ventanilla recortada". Indica cuántos dígitos sí se ven.
R3 — IMAGEN ILEGIBLE: Borrosa/muy oscura/reflejo que impide leer → lectura=null, calidad="mala", motivo=descripción del problema real.
R4 — PROHIBIDO: No escribas "los dígitos son nítidos" ni "no hay reflejos" si no es verdad.
R5 — LECTURA PARCIAL: Si solo algunos dígitos son visibles con certeza → lectura=null; en nota indica cuáles se ven.`.trim();

// ─────────────────────────────────────────────────────────────
// PROMPTS — lectura posición a posición
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres experto en lectura de medidores de gas domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display de tambores giratorios con precisión absoluta.
PRINCIPIO RECTOR: Lee SOLO lo que está visible. Jamás inventes ni completes dígitos.

PASO 0 — VALIDACIÓN PREVIA (antes de leer cualquier dígito):
  a) ¿La ventanilla de tambores está completamente dentro del encuadre? Si no → lectura = null, calidad = "mala".
  b) ¿La imagen está lo suficientemente nítida para distinguir los dígitos? Si no → lectura = null, calidad = "mala".
  Si fallas (a) o (b), omite los pasos siguientes y responde directamente con el JSON de error.

ELEMENTOS A IGNORAR: número de serie del cuerpo metálico, stickers de apartamento, placa de la empresa de gas, cualquier número fuera de la ventanilla de tambores.

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla/display de tambores. Confirma que NO estás leyendo el número de serie.

PASO 2 — CONTEO REAL: Cuenta exactamente cuántos tambores hay (5, 6, 7, 8 o más). Anota el conteo real.

PASO 3 — LECTURA POSICIÓN A POSICIÓN:
  Para cada tambor (del más significativo al menos): anota el dígito. Si no es legible → anota "?"

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez, usa SIEMPRE el dígito inferior.

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Con separador: parte entera + "." + decimales. Unidad: m³.
  · Sin separador: dígitos sin punto, anota "separador no visible".

CALIDAD: "buena" (nítido, sin reflejos) / "aceptable" (reflejo leve, pero legible) / "mala" (ilegible). Si no es "buena", añade motivo_calidad.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dígitos dudosos).

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

ELEMENTOS A IGNORAR: número de serie del cuerpo metálico, marca del fabricante, stickers de empresa o apartamento, cualquier número fuera de la ventanilla.

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla/display de tambores. Distingue la ventanilla del número de serie del cuerpo.

PASO 2 — CONTEO REAL: Cuenta exactamente cuántos tambores hay (5, 6, 7, 8 o más). Anota el conteo real.

PASO 3 — LECTURA POSICIÓN A POSICIÓN:
  Para cada tambor (del más significativo al menos): anota el dígito. Si no es legible → anota "?"

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez, usa el dígito INFERIOR.

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Con separador: parte entera + "." + decimales. Unidad: m³.
  · Sin separador: dígitos sin punto, anota "separador no visible".

CALIDAD: "buena" / "aceptable" / "mala". Si no es "buena", añade motivo_calidad breve.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dígitos dudosos).

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

ELEMENTOS A IGNORAR: número de serie del cuerpo, marca/modelo, stickers de empresa eléctrica, números de tarifa o circuito.

${ORIENTACION_Y_FORMATO}

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden:

PASO 1 — TIPO DE DISPLAY: ¿Mecánico (tambores giratorios) o LCD (pantalla digital)?

PASO 2 — LOCALIZACIÓN: Identifica el display. Descarta número de serie.

━━━ SI ES MECÁNICO (tambores) ━━━

PASO 3 — CONTEO REAL: Cuenta los tambores visibles (5, 6, 7, 8 o más). Anota lo que ves.

PASO 4 — LECTURA POSICIÓN A POSICIÓN: Para cada tambor (del más significativo al menos): anota el dígito. Tambor entre dos dígitos → usa el INFERIOR. Ilegible → "?"

${AUDITORIA_VISUAL}

PASO 6 — ENSAMBLAJE:
  · Cambio de color entre tambores o punto físico en el marco → separador.
  · Sin señal: dígitos sin punto, anota "separador no visible".
  · Unidad: kWh.

━━━ SI ES LCD (pantalla digital) ━━━

PASO 3 — Lee los dígitos de izquierda a derecha. Identifica el separador decimal (punto o coma).
PASO 4 — Anota parte entera y parte decimal.
PASO 5 — Audita: ¿0↔8? ¿1↔7? ¿2↔5? ¿3↔8? en pantalla LCD.
ENSAMBLAJE: parte entera + "." + parte decimal. Unidad: kWh.

CALIDAD: "buena" / "aceptable" / "mala". Si no es "buena", añade motivo_calidad breve.
CONFIANZA: "alta" (todos inequívocos) / "baja" (2+ dígitos dudosos).

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
// Comparación de lecturas por secuencia de dígitos
// Ignora separador decimal (coma, punto) y ceros a la izquierda.
// "0082.405", "0082,405" y "0082405" son el mismo medidor.
// ─────────────────────────────────────────────────────────────
function coincidenciaDigitos(l1, l2) {
  if (!l1 || !l2) return false;
  const d1 = l1.replace(/[^0-9]/g, '');
  const d2 = l2.replace(/[^0-9]/g, '');
  if (d1.length < 4 || d2.length < 4) return false;
  const n = Math.min(d1.length, d2.length);
  return d1.substring(0, n) === d2.substring(0, n);
}

// ─────────────────────────────────────────────────────────────
// Lectura con Tesseract — validador local de dígitos (sin costo)
// ─────────────────────────────────────────────────────────────
async function leerConTesseract(imagePath) {
  const tmpPath = path.join(os.tmpdir(), `tess_${Date.now()}.png`);
  try {
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .resize(1600, null, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toFile(tmpPath);

    const text = await Tesseract.recognize(tmpPath, {
      lang: 'eng',
      oem: '1',
      psm: '11',
    });

    if (!text?.trim()) return null;

    const secuencias = (text.match(/\d+/g) || [])
      .filter(s => s.length >= 4 && s.length <= 12);

    if (!secuencias.length) return null;

    return secuencias.reduce((a, b) => a.length >= b.length ? a : b);
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────
// Función principal
//
// Estrategia de costos (de menor a mayor gasto):
//   1. Tesseract (local, gratis) lee primero
//   2. Si Tesseract ≥5 dígitos → gpt-4o-mini + detail:low  (~97% más barato)
//      Si Tesseract falla        → gpt-4o      + detail:low  (~65% más barato)
//   3. Si Tesseract confirma la lectura → terminado (alta confianza)
//   4. Fallback si resultado pobre:
//      a) Si vino de mini → reintentar con gpt-4o/low
//      b) Si sigue pobre  → último recurso: gpt-4o/high
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
    // ── 1. Tesseract primero (local, gratis, ~0.5 s) ──────────────────
    const tessLectura = await leerConTesseract(processedPath || imagePath);
    const tessDigitos = tessLectura ? tessLectura.replace(/\D/g, '').length : 0;

    // ── 2. Elegir modelo según lectura de Tesseract ───────────────────
    // ≥5 dígitos → gpt-4o-mini (15× más barato que gpt-4o)
    const modeloPrimario = tessDigitos >= 5 ? OPENAI_MODEL_MINI : OPENAI_MODEL;
    logger.info(`OCR Tess="${tessLectura || 'null'}" (${tessDigitos}d) → ${modeloPrimario}/low — ${path.basename(imagePath)}`);

    // ── 3. Primera llamada: modelo elegido + detail:low ───────────────
    let resultado = parsearResultado(
      await llamarModeloConRetry(workingBuffer, mediaType, prompt, 6, 'low', modeloPrimario)
    );
    logger.info(`OCR GPT="${resultado.lectura || 'null'}" conf=${resultado.confianza} — ${path.basename(imagePath)}`);

    // ── 4. Tesseract confirma → alta confianza, terminado ─────────────
    if (resultado.lectura && tessLectura && coincidenciaDigitos(resultado.lectura, tessLectura)) {
      logger.info(`OCR Tess+GPT coinciden → alta confianza (${modeloPrimario}/low)`);
      return {
        ...resultado,
        confianza:         'alta',
        requiere_revision: resultado.calidad_foto === 'mala' || !resultado.es_medidor,
        nota:              `[✓ Tess:${tessLectura}] ${resultado.nota || ''}`.trim(),
      };
    }

    // ── 5. Si fue mini y resultado pobre → reintentar con gpt-4o/low ──
    if (modeloPrimario === OPENAI_MODEL_MINI && (!resultado.lectura || resultado.confianza === 'baja')) {
      logger.info(`OCR mini insuficiente → fallback ${OPENAI_MODEL}/low — ${path.basename(imagePath)}`);
      resultado = parsearResultado(
        await llamarModeloConRetry(workingBuffer, mediaType, prompt, 3, 'low', OPENAI_MODEL)
      );
      logger.info(`OCR ${OPENAI_MODEL}/low="${resultado.lectura || 'null'}" — ${path.basename(imagePath)}`);
    }

    // ── 6. Resultado sigue siendo pobre → último recurso: gpt-4o/high ─
    if (!resultado.lectura || resultado.confianza === 'baja') {
      logger.info(`OCR fallback final ${OPENAI_MODEL}/high — ${path.basename(imagePath)}`);
      const resultadoHigh = parsearResultado(
        await llamarModeloConRetry(workingBuffer, mediaType, prompt, 3, 'high', OPENAI_MODEL)
      );
      logger.info(`OCR ${OPENAI_MODEL}/high="${resultadoHigh.lectura || 'null'}" — ${path.basename(imagePath)}`);
      // Tomar high si mejora (tiene lectura donde antes no había, o sube confianza)
      if (resultadoHigh.lectura && (!resultado.lectura || resultado.confianza === 'baja')) {
        resultado = resultadoHigh;
      }
    }

    return resultado;

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
