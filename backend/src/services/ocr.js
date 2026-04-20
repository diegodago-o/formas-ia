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
// PROMPTS — Primera pasada: enumeración posición a posición L→R
// ─────────────────────────────────────────────────────────────
const PROMPTS_COT = {

  gas: `Eres experto en lectura de medidores de gas domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display de tambores giratorios con precisión absoluta.

ANATOMÍA DEL DISPLAY:
- Ventanilla rectangular ubicada en la parte frontal superior del medidor
- Exactamente 8 ruedas numeradas visibles de izquierda a derecha
- Ruedas 1–5 (fondo NEGRO): metros cúbicos — parte entera
- Ruedas 6–8 (fondo ROJO): decimales de m³
- Formato de salida: NNNNN.NNN  (ejemplo: 00201.655)

ELEMENTOS A IGNORAR — no forman parte de la lectura:
- Número de serie grabado o estampado en el cuerpo metálico del medidor
- Stickers de apartamento (etiquetas amarillas, blancas o de papel)
- Placa de identificación de la empresa de gas
- Cualquier número impreso fuera de la ventanilla de tambores

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden y documenta:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla rectangular con los 8 tambores. Confirma que NO estás mirando el número de serie del cuerpo.

PASO 2 — CONTEO: Cuenta las ruedas visibles de izquierda a derecha. Confirma que hay exactamente 8 (si ves menos, indica cuántas en la nota).

PASO 3 — LECTURA POSICIÓN A POSICIÓN (L→R):
  · Pos 1 (negro): ¿qué dígito ves? → anota
  · Pos 2 (negro): ¿qué dígito ves? → anota
  · Pos 3 (negro): ¿qué dígito ves? → anota
  · Pos 4 (negro): ¿qué dígito ves? → anota
  · Pos 5 (negro): ¿qué dígito ves? → anota
  · Pos 6 (rojo):  ¿qué dígito ves? → anota
  · Pos 7 (rojo):  ¿qué dígito ves? → anota
  · Pos 8 (rojo):  ¿qué dígito ves? → anota

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez (rueda girando entre posiciones), usa SIEMPRE el dígito inferior. Ejemplo: entre 5 y 6 visibles → escribe 5.

PASO 5 — AUDITORÍA DE CONFUSIONES: Revisa cada dígito anotado contra estos pares comunes de error:
  · ¿Es 0 o es 6? (forma cerrada vs. abierta arriba)
  · ¿Es 1 o es 7? (con o sin trazo horizontal)
  · ¿Es 3 o es 8? (abierto vs. cerrado arriba)
  · ¿Es 5 o es 6? (apertura inferior)
  Corrige si corresponde.

PASO 6 — ENSAMBLAJE: une pos 1–5 + "." + pos 6–8 → lectura final.

CALIDAD DE FOTO:
- "buena": display completamente nítido, sin reflejos, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero dígitos legibles
- "mala": desenfocado, muy oscuro, ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad (frase corta: "reflejo en la ventanilla", "desenfocado", etc.).

CONFIANZA:
- "alta": los 8 dígitos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos tras la auditoría

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,2,0,1 | 6,5,5",
  "lectura": "00201.655",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "descripción breve de lo observado en la ventanilla y los dígitos leídos"
}`,

  agua: `Eres experto en lectura de medidores de agua domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display de tambores giratorios con precisión absoluta.

ANATOMÍA DEL DISPLAY:
- Ventanilla ovalada o rectangular en la parte frontal del medidor (carcasa azul o gris)
- Exactamente 8 ruedas numeradas visibles de izquierda a derecha
- Ruedas 1–4 (fondo NEGRO): metros cúbicos — parte entera
- Ruedas 5–8 (fondo ROJO): decimales de m³
- Formato de salida: NNNN.NNNN  (ejemplo: 0134.8423)

ELEMENTOS A IGNORAR — no forman parte de la lectura:
- Número de serie grabado o troquelado en el metal del cuerpo (puede parecer una lectura pero NO lo es)
- Marca del fabricante (ACTARIS, Itron, Sensus, ISOIL, etc.)
- Stickers de apartamento o de empresa de acueducto
- Cualquier número impreso fuera de la ventanilla de tambores

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden y documenta:

PASO 1 — LOCALIZACIÓN: Identifica la ventanilla con los 8 tambores en el frente del medidor. Distingue la ventanilla del número de serie del cuerpo.

PASO 2 — CONTEO: Cuenta las ruedas de izquierda a derecha. Confirma exactamente 8.

PASO 3 — LECTURA POSICIÓN A POSICIÓN (L→R):
  · Pos 1 (negro): ¿qué dígito ves? → anota
  · Pos 2 (negro): ¿qué dígito ves? → anota
  · Pos 3 (negro): ¿qué dígito ves? → anota
  · Pos 4 (negro): ¿qué dígito ves? → anota
  · Pos 5 (rojo):  ¿qué dígito ves? → anota
  · Pos 6 (rojo):  ¿qué dígito ves? → anota
  · Pos 7 (rojo):  ¿qué dígito ves? → anota
  · Pos 8 (rojo):  ¿qué dígito ves? → anota

PASO 4 — TAMBORES EN TRANSICIÓN: Si un tambor muestra dos dígitos a la vez, usa el dígito INFERIOR. Si hay duda entre rojo y negro por reflejo, trátalo como NEGRO.

PASO 5 — AUDITORÍA DE CONFUSIONES: Revisa cada dígito anotado:
  · ¿Es 0 o es 6?  ·  ¿Es 1 o es 7?  ·  ¿Es 3 o es 8?  ·  ¿Es 5 o es 6?
  Corrige si corresponde.

PASO 6 — ENSAMBLAJE: une pos 1–4 + "." + pos 5–8 → lectura final.

CALIDAD DE FOTO:
- "buena": display completamente nítido, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero legible
- "mala": ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad breve.

CONFIANZA:
- "alta": los 8 dígitos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,1,3,4 | 8,4,2,3",
  "lectura": "0134.8423",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "descripción breve de lo observado en la ventanilla y los dígitos leídos"
}`,

  luz: `Eres experto en lectura de medidores de energía eléctrica domiciliario en Colombia.

OBJETIVO: Extraer la lectura del display del medidor (tambores mecánicos o pantalla LCD) con precisión absoluta.

ANATOMÍA DEL DISPLAY — dos tipos posibles:

TIPO A — MECÁNICO (tambores giratorios):
- Ventanilla rectangular con 8 ruedas numeradas de izquierda a derecha
- Ruedas 1–5 (fondo NEGRO): kWh — parte entera
- Ruedas 6–8 (fondo ROJO): decimales de kWh
- Formato: NNNNN.NNN  (ejemplo: 00452.123)

TIPO B — LCD (pantalla digital):
- Pantalla plana con dígitos iluminados
- Los decimales aparecen después de un punto (.) o coma (,) en la pantalla
- Lee exactamente los dígitos que muestra la pantalla; no inventes posiciones
- Formato: NNNNN.NNN

ELEMENTOS A IGNORAR en ambos tipos:
- Número de serie grabado o impreso en el cuerpo del medidor
- Marca/modelo (EDMI, Landis+Gyr, ABB, Circutor, ZIV, etc.)
- Stickers de empresa eléctrica, sellos de calibración
- Números de tarifa o de circuito impresos alrededor del display

PROTOCOLO OBLIGATORIO — ejecuta cada paso en orden y documenta:

PASO 1 — TIPO DE DISPLAY: ¿Mecánico (tambores) o LCD (pantalla)?

PASO 2 — LOCALIZACIÓN: Identifica la ventanilla (mecánico) o la pantalla (LCD). Descarta número de serie.

PASO 3 — CONTEO: Confirma 8 posiciones (mecánico) o cuenta los dígitos visibles antes y después del separador (LCD).

PASO 4 — LECTURA POSICIÓN A POSICIÓN (L→R):
  Mecánico:
    · Pos 1 (negro) · Pos 2 (negro) · Pos 3 (negro) · Pos 4 (negro) · Pos 5 (negro)
    · Pos 6 (rojo)  · Pos 7 (rojo)  · Pos 8 (rojo)
  LCD:
    · Lee los dígitos de izquierda a derecha, identifica el separador decimal

PASO 5 — TAMBORES EN TRANSICIÓN (mecánico): Si un tambor muestra dos dígitos → usa el INFERIOR.

PASO 6 — AUDITORÍA DE CONFUSIONES (ambos tipos):
  · ¿Es 0 o es 6?  ·  ¿Es 1 o es 7?  ·  ¿Es 3 o es 8?  ·  ¿Es 5 o es 6?
  En LCD además: ¿Es 1 o es 7? ¿Es 0 o es 8?

PASO 7 — ENSAMBLAJE: une parte entera + "." + decimales → lectura final NNNNN.NNN.

CALIDAD DE FOTO:
- "buena": display completamente nítido, dígitos inequívocos
- "aceptable": reflejo leve, poca luz o ángulo oblicuo, pero legible
- "mala": ilegible — lectura imposible o muy dudosa
Si no es "buena", añade motivo_calidad breve.

CONFIANZA:
- "alta": todos los dígitos son inequívocos después de la auditoría
- "baja": 2 o más dígitos siguen siendo dudosos

${ES_MEDIDOR_REGLA}

Responde SOLO con este JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "0,0,4,5,2 | 1,2,3",
  "lectura": "00452.123",
  "confianza": "alta",
  "calidad_foto": "buena",
  "motivo_calidad": null,
  "nota": "tipo de display y descripción breve de los dígitos leídos"
}`,
};

// ─────────────────────────────────────────────────────────────
// PROMPTS — Segunda pasada: enfoque por grupos de color (ángulo independiente)
// Misma metodología, distinto punto de entrada → sin sesgo de la primera pasada
// ─────────────────────────────────────────────────────────────
const PROMPTS_VERIFICACION = {

  gas: `Analiza esta imagen de un medidor de gas domiciliario colombiano.

CONTEXTO: La lectura se extrae de la ventanilla de tambores giratorios, NO del número de serie del cuerpo metálico ni de stickers o etiquetas.

MÉTODO — lee por grupos de color (no de izquierda a derecha):

GRUPO NEGRO — metros cúbicos (parte entera):
1. Localiza las 5 ruedas con fondo negro en la ventanilla
2. Para cada rueda, de izquierda a derecha, anota el dígito visible
3. Si una rueda está girando entre dos dígitos → escribe el dígito INFERIOR
4. Revisa cada uno: ¿confundes 0↔6? ¿1↔7? ¿3↔8? ¿5↔6? Corrige si aplica
5. Resultado negro: d1 d2 d3 d4 d5

GRUPO ROJO — decimales de m³:
6. Localiza las 3 ruedas con fondo rojo en la ventanilla (a la derecha de las negras)
7. Para cada rueda, de izquierda a derecha, anota el dígito visible
8. Si una rueda está girando entre dos dígitos → escribe el dígito INFERIOR
9. Revisa cada uno: ¿confundes 0↔6? ¿1↔7? ¿3↔8? ¿5↔6? Corrige si aplica
10. Resultado rojo: d6 d7 d8

ENSAMBLAJE:
11. Une: d1d2d3d4d5 + "." + d6d7d8 → formato NNNNN.NNN

CALIDAD:
- "buena" / "aceptable" / "mala"
- Si no es "buena", añade motivo_calidad breve

CONFIANZA:
- "alta": todos los dígitos son inequívocos
- "baja": 2 o más dígitos son dudosos

${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "qué viste en el grupo negro y qué en el grupo rojo"
}`,

  agua: `Analiza esta imagen de un medidor de agua domiciliario colombiano (carcasa azul o gris).

CONTEXTO: La lectura se extrae de la ventanilla de tambores giratorios del frente del medidor. El número de serie grabado en el metal del cuerpo NO es la lectura — ignóralo por completo.

MÉTODO — lee por grupos de color (no de izquierda a derecha):

GRUPO ROJO — decimales de m³ (léelos PRIMERO para anclar la posición):
1. Localiza las 4 ruedas con fondo rojo en la ventanilla (lado derecho)
2. Para cada rueda, de izquierda a derecha, anota el dígito visible
3. Si una rueda está girando entre dos dígitos → escribe el dígito INFERIOR
4. Revisa cada uno: ¿confundes 0↔6? ¿1↔7? ¿3↔8? ¿5↔6? Corrige si aplica
5. Resultado rojo: d5 d6 d7 d8

GRUPO NEGRO — metros cúbicos (parte entera):
6. Localiza las 4 ruedas con fondo negro (a la izquierda de las rojas)
7. Para cada rueda, de izquierda a derecha, anota el dígito visible
8. Si una rueda está girando entre dos dígitos → escribe el dígito INFERIOR
9. Si hay duda entre rojo y negro por reflejo → trátalo como NEGRO
10. Revisa: ¿confundes 0↔6? ¿1↔7? ¿3↔8? ¿5↔6? Corrige si aplica
11. Resultado negro: d1 d2 d3 d4

ENSAMBLAJE:
12. Une: d1d2d3d4 + "." + d5d6d7d8 → formato NNNN.NNNN

CALIDAD:
- "buena" / "aceptable" / "mala"
- Si no es "buena", añade motivo_calidad breve

CONFIANZA:
- "alta": todos los dígitos son inequívocos
- "baja": 2 o más dígitos son dudosos

${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4 | d5,d6,d7,d8",
  "lectura": "NNNN.NNNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "qué viste en el grupo rojo y qué en el grupo negro"
}`,

  luz: `Analiza esta imagen de un medidor de electricidad domiciliario colombiano.

CONTEXTO: Lee el display del medidor (tambores mecánicos o pantalla LCD). Ignora el número de serie del cuerpo, la marca y los stickers de la empresa eléctrica.

PASO PREVIO — IDENTIFICA EL TIPO DE DISPLAY:
- MECÁNICO: ruedas numeradas con fondos de color (negro y rojo)
- LCD: pantalla digital plana con números iluminados

━━━ SI ES MECÁNICO — lee por grupos de color ━━━

GRUPO ROJO — decimales de kWh (léelos PRIMERO):
1. Localiza las 3 ruedas con fondo rojo (lado derecho de la ventanilla)
2. Lee cada una de izquierda a derecha
3. Tambor entre dos dígitos → usa el INFERIOR
4. Audita: ¿0↔6? ¿1↔7? ¿3↔8? ¿5↔6?
5. Resultado rojo: d6 d7 d8

GRUPO NEGRO — kWh enteros:
6. Localiza las 5 ruedas con fondo negro (lado izquierdo)
7. Lee cada una de izquierda a derecha
8. Tambor entre dos dígitos → usa el INFERIOR
9. Audita: ¿0↔6? ¿1↔7? ¿3↔8? ¿5↔6?
10. Resultado negro: d1 d2 d3 d4 d5

ENSAMBLAJE: d1d2d3d4d5 + "." + d6d7d8 → NNNNN.NNN

━━━ SI ES LCD — lee por secciones del separador ━━━

1. Localiza el separador decimal (punto o coma en la pantalla)
2. Lee los dígitos a la DERECHA del separador (decimales): anótalos → parte decimal
3. Lee los dígitos a la IZQUIERDA del separador (enteros): anótalos → parte entera
4. Ajusta con ceros a la izquierda si la parte entera tiene menos de 5 dígitos
5. Audita: ¿0↔8? ¿1↔7? ¿3↔8? en display LCD

ENSAMBLAJE: parte entera (5 dígitos) + "." + parte decimal (3 dígitos) → NNNNN.NNN

CALIDAD:
- "buena" / "aceptable" / "mala"
- Si no es "buena", añade motivo_calidad breve

CONFIANZA:
- "alta": todos los dígitos son inequívocos
- "baja": 2 o más dígitos son dudosos

${ES_MEDIDOR_REGLA}

Responde ÚNICAMENTE con JSON (sin texto previo ni posterior):
{
  "es_medidor": true,
  "digitos_individuales": "d1,d2,d3,d4,d5 | d6,d7,d8",
  "lectura": "NNNNN.NNN o null si ilegible",
  "confianza": "alta | baja",
  "calidad_foto": "buena | aceptable | mala",
  "motivo_calidad": null,
  "nota": "tipo de display y qué viste en cada grupo"
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
