# LecturIA — Documento de Handoff para Desarrolladores

> **Versión del sistema:** 1.3.0  
> **Desarrollado por:** Tecnofactory SAS  
> **Fecha de documento:** 2026-05-21  
> **URL producción:** https://cturaia.tecnofactory.net.co

---

## Tabla de Contenidos

1. [Resumen del sistema](#1-resumen-del-sistema)
2. [Repositorio y ramas](#2-repositorio-y-ramas)
3. [Arquitectura general](#3-arquitectura-general)
4. [Setup local (paso a paso)](#4-setup-local-paso-a-paso)
5. [Frontend](#5-frontend)
6. [Backend](#6-backend)
7. [Base de datos](#7-base-de-datos)
8. [Sistema OCR / IA](#8-sistema-ocr--ia)
9. [Sistema offline y PWA](#9-sistema-offline-y-pwa)
10. [Variables de entorno](#10-variables-de-entorno)
11. [Infraestructura y despliegue](#11-infraestructura-y-despliegue)
12. [Scripts de migración](#12-scripts-de-migración)
13. [Seguridad — acciones requeridas antes del handoff](#13-seguridad--acciones-requeridas-antes-del-handoff)

---

## 1. Resumen del sistema

**LecturIA** es una Progressive Web App (PWA) para auditoría de medidores de servicios públicos (luz, agua, gas) en conjuntos residenciales.

**Flujo principal:**
1. El **auditor** visita un apartamento con su celular, toma fotos de los 3 medidores e ingresa la lectura.
2. La app funciona **sin conexión** (IndexedDB + Service Worker). Al recuperar señal, sincroniza automáticamente.
3. El **backend** corre OCR con IA (OpenAI GPT) sobre cada foto y compara con la lectura del auditor.
4. Si hay discrepancia o problema, la visita queda en **revisión**; el **admin** la aprueba, rechaza o corrige.
5. El **admin** exporta reportes en Excel con toda la data.

**Roles:**
| Rol | Descripción |
|-----|-------------|
| `auditor` | Crea visitas, ve sus propias visitas, subsana rechazadas |
| `admin` | Ve todo, aprueba/rechaza, gestiona catálogos y usuarios, exporta Excel |
| `consulta` | Solo ve el dashboard de stats (sin acceso a visitas individuales) |

---

## 2. Repositorio y ramas

```
Repo:    https://github.com/diegodago-o/formas-ia.git
Rama:    master  (única rama — no hay develop ni release branches)
Tags:    (ninguno configurado)
```

**Convención de commits:**
```
feat:  nueva funcionalidad
fix:   corrección de bug
chore: cambio de config/build
```

**Historial reciente:**
```
6250cb4 feat(dashboard): agregar etiquetas (Hogares)/(Medidores) en cards de stats
017b739 chore: bump version to 1.3.0
292c19a fix(new-visit): crear borrador al confirmar visita duplicada
7cfb3e7 feat(reports): agregar revisor y fecha de revisión al Excel
0a10b79 fix: propagar corrección de lectura admin a visita siguiente (cascada delta)
```

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────────────────┐
│                    PRODUCCIÓN (nube)                     │
│                                                          │
│  cturaia.tecnofactory.net.co                            │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │    Nginx      │───▶│   Node.js (PM2)              │   │
│  │  (reverse     │    │   lecturaia-api              │   │
│  │   proxy)      │    │   puerto 4005                │   │
│  └──────────────┘    └──────────────┬───────────────┘   │
│        │                            │                    │
│        ▼                            ▼                    │
│  /var/www/lecturaia/          MySQL (lecturaia)          │
│  frontend/build/              /var/www/lecturaia/        │
│  (archivos estáticos)         backend/uploads/           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   CELULAR (auditor)                      │
│                                                          │
│  Chrome / Safari (PWA instalable)                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │  React 18 (CRA)                                  │    │
│  │  ├── IndexedDB (offline: pending, drafts, cache) │    │
│  │  ├── Service Worker v6 (cache-first static)      │    │
│  │  └── Axios → /api/* → Backend                   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   SERVICIOS EXTERNOS                     │
│                                                          │
│  OpenAI API (gpt-5.2 / gpt-4o)  ◀── OCR de medidores  │
│  Tesseract (local)               ◀── validación cruzada │
└─────────────────────────────────────────────────────────┘
```

**Stack tecnológico:**

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend | React + CRA | 18.3.1 / react-scripts 5 |
| Routing | React Router DOM | 6.23.1 |
| HTTP client | Axios | 1.7.2 |
| Offline | IndexedDB (v3) + Service Worker | — |
| Backend | Node.js + Express | ^4.19.2 |
| Base de datos | MySQL | 5.7+ |
| ORM/driver | mysql2 (pool) | ^3.9.7 |
| OCR IA | OpenAI SDK | ^4.68.0 |
| OCR local | node-tesseract-ocr | ^2.2.1 |
| Imágenes | Sharp | ^0.34.5 |
| Excel | ExcelJS | ^4.4.0 |
| Auth | JWT (jsonwebtoken) | ^9.0.2 |
| Hashing | bcryptjs | ^2.4.3 |
| Uploads | Multer | ^1.4.5-lts.1 |
| Logging | Winston | ^3.13.0 |
| Proceso | PM2 | (instalado en servidor) |

---

## 4. Setup local (paso a paso)

### Prerequisitos
- Node.js 16+
- MySQL 5.7+ corriendo en localhost:3306
- Tesseract instalado (`tesseract --version`)
- Cuenta OpenAI con API key

### Instalación

```bash
# 1. Clonar
git clone https://github.com/diegodago-o/formas-ia.git
cd formas-ia

# 2. Instalar dependencias de ambos proyectos
npm run install:all

# 3. Configurar variables de entorno del backend
cp backend/.env.example backend/.env
# Editar backend/.env con tus credenciales (ver sección 10)

# 4. Crear base de datos e insertar datos iniciales
npm run db:init
# Crea BD formas_ia + tablas + usuario admin + 5 ciudades de ejemplo

# 5. Correr en paralelo (backend + frontend)
npm run dev
# Backend: http://localhost:4005
# Frontend: https://localhost:3005 (HTTPS requerido para cámara)
```

### Scripts raíz disponibles

```bash
npm run install:all   # Instala dependencias frontend + backend
npm run dev           # Levanta ambos en paralelo (concurrently)
npm run dev:backend   # Solo backend (nodemon)
npm run dev:frontend  # Solo frontend (react-scripts)
npm run db:init       # Inicializa base de datos
```

### Credenciales iniciales (después de db:init)
```
Email:     admin@formas-ia.com
Password:  Admin1234!
Rol:       admin
```

---

## 5. Frontend

### Estructura de directorios

```
frontend/
├── public/
│   ├── index.html          # Shell HTML, meta PWA
│   ├── manifest.json       # PWA config (standalone, portrait, theme #1E3A5F)
│   └── sw.js               # Service Worker v6 (estrategias por recurso)
│
└── src/
    ├── App.js              # Router principal + PrivateRoute + ErrorBoundary
    ├── index.js            # Entry point (registra SW, escucha sync)
    ├── index.css           # CSS variables globales, reset
    │
    ├── context/
    │   └── AuthContext.js  # useAuth hook, login/logout, token en localStorage
    │
    ├── hooks/
    │   └── useOnlineStatus.js  # Ping /api/health cada 12s
    │
    ├── services/
    │   ├── api.js              # Axios instance (Bearer token interceptor)
    │   ├── localDB.js          # IndexedDB v3 wrapper (5 stores)
    │   ├── syncService.js      # Sync offline → servidor
    │   ├── compressImage.js    # Resize + JPEG 0.82 (máx 1920px)
    │   └── installPrompt.js    # PWA install prompt (Android/iOS)
    │
    ├── components/
    │   ├── Layout.js           # Header, footer (versión), nav bottom auditor
    │   ├── MeterField.js       # Captura foto + lectura por medidor
    │   ├── CameraCapture.js    # Visor cámara (getUserMedia, torch Android)
    │   └── InstallBanner.js    # PWA install chip / bottom sheet
    │
    └── pages/
        ├── auth/
        │   └── LoginPage.js
        │
        ├── auditor/
        │   ├── AuditorHome.js       # Inicio: caché status, badges
        │   ├── NewVisit.js          # Formulario 3 pasos (ubicación/medidores/obs)
        │   ├── MyVisits.js          # Historial + offline queue + borradores
        │   └── AuditorVisitModal.js # Detalle + subsanación
        │
        └── admin/
            ├── AdminLayout.js       # Sidebar + topbar
            ├── AdminDashboard.js    # Stats + filtro fechas + desglose ciudad
            ├── AdminVisits.js       # Tabla paginada + filtros + Excel
            ├── AdminAlerts.js       # Acordeón alertas OCR
            ├── AdminCatalogs.js     # CRUD ciudades/conjuntos/torres + CSV
            ├── AdminUsers.js        # CRUD usuarios + roles
            └── VisitModal.js        # Detalle visita (vista admin)
```

### Rutas y roles

```
/login                              → LoginPage (sin auth)
/                                   → AuditorHome        (auditor)
/nueva-visita                       → NewVisit           (auditor)
/nueva-visita?draft=<id>            → NewVisit (borrador) (auditor)
/mis-visitas                        → MyVisits           (auditor)
/admin                              → AdminDashboard     (admin + consulta)
/admin/visitas                      → AdminVisits        (admin only)
/admin/alertas                      → AdminAlerts        (admin only)
/admin/catalogos                    → AdminCatalogs      (admin only)
/admin/usuarios                     → AdminUsers         (admin only)
```

### Variables de entorno frontend

```bash
# .env (desarrollo)
PORT=3005
HTTPS=true

# El proxy en package.json redirige /api → http://localhost:4005
# No se usa REACT_APP_API_URL (api.js usa baseURL: '/api')
```

### Build y deploy frontend

```bash
cd frontend
npm run build        # Genera frontend/build/
# Copiar build/ al servidor en /var/www/lecturaia/frontend/build/
```

### Versión

La versión que muestra el footer viene de `frontend/package.json → version`. Actualmente: **1.3.0**.

---

## 6. Backend

### Estructura de directorios

```
backend/
├── src/
│   ├── server.js           # Express app, middlewares globales, rutas, health
│   ├── middleware/
│   │   ├── auth.js         # JWT verify + requireRole(...)
│   │   ├── asyncHandler.js # Promise error wrapper para Express 4
│   │   ├── logger.js       # Winston (console + logs/error.log + logs/combined.log)
│   │   └── upload.js       # Multer (disk, timestamp-hash naming, 10MB max)
│   ├── models/
│   │   └── db.js           # MySQL2 pool (10 conexiones, timezone -05:00)
│   ├── services/
│   │   ├── ocr.js          # Pipeline OCR: blur detect → preprocess → Tesseract → GPT
│   │   └── exif.js         # Extrae DateTimeOriginal de fotos
│   └── routes/
│       ├── auth.js         # POST /login, GET /me
│       ├── visits.js       # Visitas auditor (crear, subir foto, subsanar)
│       ├── catalogs.js     # CRUD ciudades/conjuntos/torres + import CSV
│       ├── admin.js        # Admin: stats, visitas, medidores, usuarios
│       └── reports.js      # GET /excel (exportación con filtros)
│
├── scripts/
│   ├── init-db.js          # Crea BD + tablas + admin + ciudades seed
│   ├── clear-data.js       # Borra datos (mantiene estructura)
│   ├── migrate-*.js        # Migraciones históricas de columnas
│   └── backfill-*.js       # Relleno de datos existentes
│
├── uploads/                # Fotos de medidores (no en git)
│   └── _deleted/           # Papelera por visita al eliminar
│       └── visita_{id}/
│
└── logs/
    ├── error.log
    └── combined.log
```

### Todos los endpoints

#### Auth (`/api/auth`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/login` | ❌ | `{email, password}` → `{token, user}` |
| GET | `/me` | ✅ | Devuelve usuario autenticado |

#### Visitas (`/api/visits`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/check-duplicate` | ✅ | Busca visitas del mes actual para ese apto |
| POST | `/upload-photo` | ✅ | Sube foto → `{foto_path}` |
| POST | `/` | ✅ | Crea visita + dispara OCR en background |
| GET | `/mine` | ✅ | Mis visitas (del auditor autenticado) |
| GET | `/:id` | ✅ | Detalle visita + medidores |
| PATCH | `/:id/anular` | ✅ Auditor | Anula visita pendiente |
| POST | `/:id/subsanar` | ✅ Auditor | Corrige medidores rechazados + re-OCR |

#### Catálogos (`/api/catalogs`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/ciudades` | ✅ | Lista ciudades activas |
| POST | `/ciudades` | ✅ Admin | Crea ciudad |
| DELETE | `/ciudades/:id` | ✅ Admin | Elimina ciudad (falla si tiene conjuntos) |
| GET | `/conjuntos/all` | ✅ | Todos los conjuntos |
| GET | `/conjuntos` | ✅ | Conjuntos (filtro: `?ciudad_id=`) |
| POST | `/conjuntos` | ✅ Admin | Crea conjunto (+torres) |
| DELETE | `/conjuntos/:id` | ✅ Admin | Elimina conjunto |
| GET | `/torres/all` | ✅ | Todas las torres |
| GET | `/torres` | ✅ | Torres (filtro: `?conjunto_id=`) |
| POST | `/torres` | ✅ Admin | Crea torre |
| DELETE | `/torres/:id` | ✅ Admin | Elimina torre |
| POST | `/import` | ✅ Admin | Importa CSV/XLSX (ciudad, conjunto, torre) |

#### Admin (`/api/admin`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/stats` | ✅ Admin/Consulta | Dashboard: totales + breakdown ciudad |
| GET | `/visits` | ✅ Admin | Todas las visitas (filtros, paginación, orden) |
| GET | `/visits/:id` | ✅ Admin | Detalle completo |
| PATCH | `/visits/:id/ubicacion` | ✅ Admin | Corrige ciudad/conjunto/apto |
| PATCH | `/visits/:id/estado` | ✅ Admin | Aprueba o rechaza visita |
| DELETE | `/visits/:id` | ✅ Admin | Elimina visita (fotos → papelera) |
| GET | `/alerts` | ✅ Admin | Medidores con `requiere_revision=1` |
| PATCH | `/medidores/:id` | ✅ Admin | Corrige lectura + propaga delta a siguiente visita |
| GET | `/users` | ✅ Admin | Lista usuarios |
| POST | `/users` | ✅ Admin | Crea usuario |
| PATCH | `/users/:id` | ✅ Admin | Actualiza usuario |

#### Reportes (`/api/reports`)
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/excel` | ✅ Admin | Exporta XLSX con 49 columnas (filtros disponibles) |

#### Health
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | `{status: "ok", timestamp}` (ping para offline detection) |

### Rate limiting
```
/api/auth  → 20 req / 15 min
/api       → 200 req / 1 min
```

### Uploads
- **Directorio:** `backend/uploads/`
- **Naming:** `{timestamp}-{md5hash}.{ext}`
- **Tipos:** JPG, PNG, WEBP, HEIC (máx 10 MB)
- **Servidos:** como estáticos en `/uploads/*`
- **Papelera:** al eliminar visita → `uploads/_deleted/visita_{id}/`
- **No están en git** (en .gitignore, solo `.gitkeep`)

---

## 7. Base de datos

### Información de conexión

```
Motor:     MySQL 5.7+
Charset:   utf8mb4 (utf8mb4_unicode_ci)
Timezone:  -05:00 (Colombia) — forzado en cada conexión del pool
Pool:      10 conexiones máx
```

### Esquema completo

```sql
-- usuarios
CREATE TABLE usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('admin','auditor','consulta') NOT NULL DEFAULT 'auditor',
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ciudades
CREATE TABLE ciudades (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
);

-- conjuntos
CREATE TABLE conjuntos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(120) NOT NULL,
  ciudad_id  INT NOT NULL,
  direccion  VARCHAR(200),
  activo     TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (ciudad_id) REFERENCES ciudades(id)
);

-- torres
CREATE TABLE torres (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL,
  conjunto_id INT NOT NULL,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (conjunto_id) REFERENCES conjuntos(id)
);

-- visitas
CREATE TABLE visitas (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  auditor_id          INT NOT NULL,
  fecha               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  latitud             DECIMAL(10,8),
  longitud            DECIMAL(11,8),
  ciudad_id           INT NOT NULL,
  conjunto_id         INT NOT NULL,
  torre_id            INT,
  apartamento         VARCHAR(20) NOT NULL,
  observaciones       TEXT,
  hora_inicio         DATETIME,
  hora_fin            DATETIME,
  hora_sincronizacion DATETIME,
  client_ref          VARCHAR(255),          -- idempotencia offline
  estado              ENUM('pendiente','aprobada','rechazada','anulada') DEFAULT 'pendiente',
  motivo_rechazo      TEXT,
  revisado_por        INT,                   -- usuario que aprobó/rechazó
  revisado_en         DATETIME,
  FOREIGN KEY (auditor_id)   REFERENCES usuarios(id),
  FOREIGN KEY (ciudad_id)    REFERENCES ciudades(id),
  FOREIGN KEY (conjunto_id)  REFERENCES conjuntos(id),
  FOREIGN KEY (torre_id)     REFERENCES torres(id),
  FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
);

-- medidores
CREATE TABLE medidores (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  visita_id           INT NOT NULL,
  tipo                ENUM('luz','agua','gas') NOT NULL,
  foto_path           VARCHAR(255),
  hora_foto           DATETIME,
  lectura_ocr         VARCHAR(30),
  confianza_ocr       ENUM('alta','media','baja'),
  calidad_foto        VARCHAR(20),           -- 'buena' | 'aceptable' | 'mala'
  motivo_calidad      TEXT,
  nota_ocr            TEXT,
  lectura_confirmada  VARCHAR(30),           -- lectura final (auditor o admin)
  lectura_anterior    VARCHAR(30),           -- snapshot de la visita anterior
  delta               DECIMAL(10,3),         -- lectura_confirmada - lectura_anterior
  primera_lectura     TINYINT(1) DEFAULT 0,
  requiere_revision   TINYINT(1) NOT NULL DEFAULT 0,
  estado_revision_ocr ENUM('pendiente','aprobado','rechazado','corregido'),
  es_medidor          TINYINT(1) DEFAULT 1,  -- IA confirmó que es un medidor
  sin_acceso          TINYINT(1) DEFAULT 0,
  motivo_sin_acceso   TEXT,
  ocr_diff_pct        DECIMAL(5,2),          -- diferencia % entre OCR y auditor
  revisado_por        INT,
  revisado_en         DATETIME,
  FOREIGN KEY (visita_id)   REFERENCES visitas(id),
  FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
);
```

### Relaciones

```
usuarios (1) ──── (N) visitas         [auditor_id, revisado_por]
usuarios (1) ──── (N) medidores       [revisado_por]
ciudades (1) ──── (N) conjuntos
ciudades (1) ──── (N) visitas
conjuntos (1) ─── (N) torres
conjuntos (1) ─── (N) visitas
torres    (1) ─── (N) visitas         [nullable]
visitas   (1) ─── (N) medidores
```

### Lógica de lectura_anterior y delta

Al crear la visita del mes siguiente para el mismo apto+tipo de medidor, el backend busca la `lectura_confirmada` de la visita anterior más reciente y la copia en `lectura_anterior`. El `delta = lectura_confirmada - lectura_anterior` se calcula al momento de confirmar la lectura.

**Importante:** Si el admin corrige una lectura con `PATCH /admin/medidores/:id`, el sistema propaga el cambio a la visita siguiente del mismo medidor (actualiza su `lectura_anterior` y `delta`).

### Seed data inicial

```sql
-- Usuario admin por defecto (generado por scripts/init-db.js)
INSERT INTO usuarios (nombre, email, password_hash, rol)
VALUES ('Administrador', 'admin@formas-ia.com', '<bcrypt de Admin1234!>', 'admin');

-- Ciudades de ejemplo
INSERT INTO ciudades (nombre) VALUES
('Bogotá'), ('Medellín'), ('Cali'), ('Barranquilla'), ('Bucaramanga');
```

---

## 8. Sistema OCR / IA

### Pipeline completo

```
Foto recibida
    │
    ▼
1. Detección de blur (Sharp Laplacian)
   │  score < 30 → rechaza sin gastar tokens
    │
    ▼
2. Preprocesamiento (Sharp)
   - Rotación EXIF automática
   - Resize a máx 2048×2048
   - Sharpen (sigma 1.0)
   - Brillo adaptativo (1.0x–1.55x según luminancia)
   - Saturación +40%
   - JPEG quality 93%
    │
    ▼
3. Tesseract (OCR local, gratis)
   - ¿Detectó ≥5 dígitos?
    │      │
    │  SÍ  │  NO
    │      │
    ▼      ▼
4a. gpt-4o-mini  4b. gpt-4o
    (económico)       (preciso)
    detail: low       detail: low
    ~85 tokens        ~85 tokens
    │
    ▼
5. ¿Resultado pobre?
   - gpt-mini → reintenta con gpt-4o/low
   - Sigue mal → último recurso: gpt-4o/high (~1000 tokens)
    │
    ▼
6. Validación cruzada Tesseract ↔ GPT
   - Coinciden → confianza "alta"
   - Difieren → confianza "baja"
    │
    ▼
7. Guarda en BD: lectura_ocr, confianza_ocr, calidad_foto,
                 es_medidor, nota_ocr, ocr_diff_pct
    │
    ▼
8. Flags automáticos (requiere_revision = 1 si):
   - Delta negativo (consumo negativo)
   - sin_acceso = 1
   - calidad_foto = 'mala'
   - es_medidor = false
   - ocr_diff_pct > 15%
   - Sin lectura registrada
    │
    ▼
9. checkAutoCloseVisita()
   - Si todos los medidores tienen requiere_revision = 0 → visita aprobada
   - Si alguno tiene requiere_revision = 1 → visita queda pendiente
```

### Variables de control OCR

```bash
OPENAI_MODEL=gpt-5.2          # Modelo principal
OPENAI_MODEL_MINI=gpt-4o-mini # Modelo económico
OCR_MAX_CONCURRENT=1          # Llamadas en paralelo (default 1)
OCR_MIN_DELAY_MS=4000         # Pausa entre llamadas (evita rate limit)
OCR_BLUR_THRESHOLD=30         # Umbral nitidez (menor = más permisivo)
```

### Prompts especializados

Hay 3 prompts Chain-of-Thought en `backend/src/services/ocr.js`, uno por tipo de medidor (luz, agua, gas). Cada prompt incluye:
- Validación previa de encuadre
- Lectura posición a posición
- Reglas anti-alucinación (nunca completar dígitos no visibles)
- Salida JSON estructurada: `{es_medidor, lectura, confianza, calidad_foto, nota}`

---

## 9. Sistema offline y PWA

### Service Worker (`frontend/public/sw.js`) — versión 6

| Recurso | Estrategia |
|---------|-----------|
| `/static/*` (JS, CSS con hash) | Cache-first (inmutables) |
| Navegación HTML | Network-first → fallback a `/index.html` |
| `/api/*`, `/uploads/*` | Sin cacheo (red directa) |
| Fuentes, íconos | Network-first → fallback a runtime cache |

**Para actualizar el SW:** incrementar `CACHE_VERSION` en `sw.js`. El activate event limpia caches viejos.

### IndexedDB v3 (5 stores)

| Store | Propósito |
|-------|-----------|
| `catalogs` | Ciudades, conjuntos, torres (TTL 6h) |
| `pending_visits` | Visitas guardadas offline (`status: pending/syncing/done/error`) |
| `drafts` | Borradores en progreso |
| `visit_detail_cache` | Detalle visita rechazada (para subsanar offline) |
| `pending_subsanaciones` | Subsanaciones offline |

### Sincronización automática

Al recuperar conexión (evento `online` + verificación ping `/api/health`):
1. Espera 5 segundos (para que WiFi se estabilice)
2. Para cada `pending_visit`:
   - Si tiene `foto_base64`/`foto_file` → sube foto primero
   - Si tiene `foto_path` → reutiliza (ya está en servidor)
   - POST `/api/visits`
3. Para cada `pending_subsanacion`:
   - Similar, luego POST `/api/visits/:id/subsanar`
4. Elimina de IndexedDB tras éxito

**Idempotencia:** `client_ref` evita duplicados si el sync falla a medias.

---

## 10. Variables de entorno

### Backend (`backend/.env`)

```bash
# Servidor
PORT=4005
NODE_ENV=development          # Cambiar a 'production' en prod

# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root              # ⚠️ CAMBIAR en producción
DB_NAME=formas_ia             # en prod: lecturaia (verificar)

# JWT
JWT_SECRET=cambia_este_secreto_muy_seguro   # ⚠️ CAMBIAR — mínimo 32 chars aleatorios
JWT_EXPIRES_IN=8h

# OpenAI (OCR)
OPENAI_API_KEY=sk-proj-...    # ⚠️ ROTAR — ver sección 13
OPENAI_MODEL=gpt-5.2          # Modelo principal

# Archivos
UPLOADS_DIR=uploads
MAX_FILE_SIZE_MB=10

# URL pública del servidor (para links en Excel y CORS)
BASE_URL=http://192.168.1.12:4005  # Cambiar a URL de producción
FRONTEND_URL=*                      # Restringir en producción

# OCR tuning (opcional)
OCR_MAX_CONCURRENT=1
OCR_MIN_DELAY_MS=4000
OCR_BLUR_THRESHOLD=30
OPENAI_MODEL_MINI=gpt-4o-mini
```

### Frontend (`frontend/.env`)

```bash
PORT=3005
HTTPS=true
# REACT_APP_API_URL no se usa; el proxy en package.json redirige /api → :4005
```

---

## 11. Infraestructura y despliegue

### Producción

```
Servidor:     VPS (Linux)
Dominio:      cturaia.tecnofactory.net.co
Ruta código:  /var/www/lecturaia/
DB nombre:    lecturaia (puede diferir del local 'formas_ia')
Proceso:      PM2 → lecturaia-api
```

### Comandos de despliegue

Conectarse al servidor por SSH y ejecutar el comando según lo que cambió:

---

#### Deploy completo (frontend + backend + pm2) — comando de referencia

```bash
cd /var/www/lecturaia && git pull origin master && npm install --prefix frontend && npm run build --prefix frontend && pm2 restart lecturaia-api --update-env
```

---

#### Deploy solo backend (cambios en `backend/src/`)

```bash
cd /var/www/lecturaia && git pull origin master && pm2 restart lecturaia-api --update-env
```

> Usar cuando solo cambiaron archivos de Node.js (rutas, servicios, middlewares).  
> NO incluye build del frontend.

---

#### Deploy solo frontend (cambios en `frontend/src/`)

```bash
cd /var/www/lecturaia && git pull origin master && npm install --prefix frontend && npm run build --prefix frontend
```

> El backend no se reinicia. Nginx sirve los nuevos archivos estáticos inmediatamente.

---

#### Deploy completo paso a paso (con verificación)

```bash
# 1. Ir al directorio del proyecto
cd /var/www/lecturaia

# 2. Bajar cambios del repositorio
git pull origin master

# 3. Instalar dependencias si cambiaron (package.json)
npm install --prefix backend
npm install --prefix frontend

# 4. Construir el frontend (genera /frontend/build/)
npm run build --prefix frontend

# 5. Reiniciar el backend con las nuevas env vars
pm2 restart lecturaia-api --update-env

# 6. Verificar que el proceso arrancó correctamente
pm2 status
pm2 logs lecturaia-api --lines 30
```

---

#### Resumen de cuándo usar cada uno

| Cambió | Comando |
|--------|---------|
| Solo `backend/src/**` | Deploy solo backend |
| Solo `frontend/src/**` | Deploy solo frontend |
| Ambos (o dudas) | Deploy completo |
| Solo `.env` del servidor | `pm2 restart lecturaia-api --update-env` |
| Cambió `backend/package.json` | Deploy completo + `npm install --prefix backend` |

### Nginx (reverse proxy)

El frontend (build estático) y el backend (API en :4005) se sirven a través de Nginx. Configuración típica:

```nginx
server {
    listen 443 ssl;
    server_name cturaia.tecnofactory.net.co;

    # Frontend (archivos estáticos)
    root /var/www/lecturaia/frontend/build;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:4005;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Fotos (uploads)
    location /uploads/ {
        alias /var/www/lecturaia/backend/uploads/;
    }
}
```

### PM2

```bash
pm2 list                                    # Ver procesos
pm2 logs lecturaia-api                     # Ver logs en tiempo real
pm2 restart lecturaia-api --update-env     # Reiniciar con nuevas env vars
pm2 save                                   # Guardar configuración
pm2 startup                                # Auto-start al reiniciar servidor
```

### Local (desarrollo)

```
Backend:   http://localhost:4005
Frontend:  https://localhost:3005
           (HTTPS requerido para acceso a cámara en Chrome)
MySQL:     localhost:3306 / DB: formas_ia
Uploads:   backend/uploads/
```

---

## 12. Scripts de migración

Todos en `backend/scripts/`. Se ejecutan una sola vez directamente con Node:

```bash
node backend/scripts/<nombre>.js
```

| Script | Propósito |
|--------|-----------|
| `init-db.js` | **Crear** BD + tablas + seed inicial. Solo para instalación nueva. |
| `clear-data.js` | Borrar datos manteniendo estructura (útil en dev) |
| `migrate-estado.js` | Agrega columna `estado` a visitas |
| `migrate-hora-foto.js` | Agrega columna `hora_foto` a medidores |
| `migrate-hora-sincronizacion.js` | Agrega `hora_sincronizacion` a visitas |
| `migrate-motivo-rechazo-medidor.js` | Agrega `motivo_rechazo_admin` a medidores |
| `migrate-rol-consulta.js` | Amplía ENUM rol para incluir 'consulta' |
| `migrate-timestamps.js` | Migra timestamps a datetime con timezone |
| `migrate-v2.js` | Migración general a v2 (campos OCR avanzados) |
| `backfill-hora-foto.js` | Rellena `hora_foto` desde EXIF de fotos existentes |
| `backfill-hora-foto-visita.js` | Backfill de hora_foto a nivel de visita |

> **Nota:** En un servidor limpio basta con `init-db.js`. Los scripts `migrate-*` son para bases de datos existentes que se actualizaron incremetalmente.

---

## 13. Seguridad — acciones requeridas antes del handoff

### ⚠️ CRÍTICO — Rotar antes de entregar

| Secreto | Estado actual | Acción requerida |
|---------|--------------|------------------|
| `OPENAI_API_KEY` | Expuesta en .env local | **Rotar en OpenAI dashboard** y actualizar en servidor |
| `JWT_SECRET` | `cambia_este_secreto_muy_seguro` | **Generar secreto fuerte** (`openssl rand -base64 32`) |
| `DB_PASSWORD` | `root` en local | Verificar que producción tiene contraseña segura |

### Generar nuevo JWT_SECRET

```bash
openssl rand -base64 32
# Pegar el resultado en JWT_SECRET del servidor
# Luego: pm2 restart lecturaia-api --update-env
# NOTA: Todos los usuarios deberán volver a hacer login
```

### Rotar OpenAI API Key

1. Ir a https://platform.openai.com/api-keys
2. Crear nueva key
3. Actualizar `OPENAI_API_KEY` en el archivo `.env` del servidor
4. Revocar la key anterior
5. `pm2 restart lecturaia-api --update-env`

### Otras recomendaciones

- Cambiar contraseña del admin inicial (`admin@formas-ia.com` / `Admin1234!`) en producción
- Restringir `FRONTEND_URL` al dominio real en lugar de `*`
- Configurar rotación de logs en PM2 o logrotate
- Revisar que el directorio `uploads/` no sea listable por Nginx
- El `.env` nunca debe commitearse a git (ya está en `.gitignore`)

---

## 14. Migración de GitHub a Azure DevOps

El repositorio actual está en GitHub (`github.com/diegodago-o/formas-ia`). Para importarlo a Azure Repos:

### Paso 1 — Crear proyecto en Azure DevOps

1. Ir a [dev.azure.com](https://dev.azure.com)
2. Crear organización (si no existe): `Tecnofactory` o similar
3. Crear proyecto: `LecturIA` → visibilidad **Private** → Version control: **Git**

### Paso 2 — Importar el repositorio

1. Dentro del proyecto ir a **Repos → Files**
2. Clic en **Import repository**
3. Completar el formulario:
   ```
   Clone URL:  https://github.com/diegodago-o/formas-ia.git
   Name:       formas-ia
   ```
4. Si el repo de GitHub es privado → marcar **"Requires authorization"** e ingresar un GitHub Personal Access Token (PAT) con permiso `repo`
5. Clic en **Import** → Azure DevOps copia todo el historial, commits y rama `master`

### Paso 3 — Actualizar el remote en tu máquina local

```bash
# Ver remote actual
git remote -v
# origin  https://github.com/diegodago-o/formas-ia.git

# Reemplazar por la URL de Azure DevOps
git remote set-url origin https://dev.azure.com/{organizacion}/LecturIA/_git/formas-ia

# Verificar
git remote -v

# Primer push al nuevo remote
git push origin master
```

### Paso 4 — Actualizar el servidor de producción

```bash
# En el servidor SSH:
cd /var/www/lecturaia

# Ver remote actual
git remote -v

# Cambiar al nuevo remote de ADO
git remote set-url origin https://dev.azure.com/{organizacion}/LecturIA/_git/formas-ia

# Para autenticarse desde el servidor usar un Personal Access Token de ADO:
# git config credential.helper store
# git pull  → pide usuario/PAT la primera vez, luego queda guardado

# O usar SSH key de ADO (más seguro para servidores)
```

### Paso 5 — (Opcional) Crear pipeline CI/CD en ADO

Si quieres que el deploy se haga automáticamente al hacer push, crear el archivo `azure-pipelines.yml` en la raíz del repo:

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - master

pool:
  vmImage: ubuntu-latest

steps:
  - task: SSH@0
    displayName: 'Deploy a producción'
    inputs:
      sshEndpoint: 'lecturaia-server'   # Service connection configurado en ADO
      runOptions: 'inline'
      inline: |
        cd /var/www/lecturaia
        git pull origin master
        npm install --prefix frontend
        npm run build --prefix frontend
        pm2 restart lecturaia-api --update-env
```

Para configurar el `sshEndpoint`:
1. ADO → **Project Settings → Service connections → New → SSH**
2. Ingresar IP/host del servidor, usuario y clave privada SSH

### Resumen de URLs después de la migración

| Recurso | URL |
|---------|-----|
| Código (ADO) | `https://dev.azure.com/{org}/LecturIA/_git/formas-ia` |
| Pipeline CI/CD | `https://dev.azure.com/{org}/LecturIA/_build` |
| GitHub (puede archivarse) | `https://github.com/diegodago-o/formas-ia` |

---

## Notas adicionales

- Las lecturas de medidores se almacenan como `VARCHAR(30)` (no numérico) para soportar tanto coma como punto decimal según el teclado del dispositivo. La conversión a número ocurre en lógica de negocio con `.replace(',', '.')`.
- El campo `fecha` en visitas es el timestamp de sincronización con el servidor, no la hora real. Para la hora real usar `hora_fin` (con fallback a `fecha`).
- Si Tesseract no está instalado, el OCR sigue funcionando con OpenAI solamente (Tesseract es validador, no requerido).
- La PWA se puede instalar en Android (Chrome) e iOS (Safari → Compartir → Agregar a inicio).
