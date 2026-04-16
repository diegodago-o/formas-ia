require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const SQL = `
CREATE DATABASE IF NOT EXISTS formas_ia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE formas_ia;

CREATE TABLE IF NOT EXISTS usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('admin','auditor') NOT NULL DEFAULT 'auditor',
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ciudades (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS conjuntos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(120) NOT NULL,
  ciudad_id  INT NOT NULL,
  direccion  VARCHAR(200),
  activo     TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (ciudad_id) REFERENCES ciudades(id)
);

CREATE TABLE IF NOT EXISTS torres (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL,
  conjunto_id INT NOT NULL,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (conjunto_id) REFERENCES conjuntos(id)
);

CREATE TABLE IF NOT EXISTS visitas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  auditor_id  INT NOT NULL,
  fecha       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  latitud     DECIMAL(10,8),
  longitud    DECIMAL(11,8),
  ciudad_id   INT NOT NULL,
  conjunto_id INT NOT NULL,
  torre_id    INT,
  apartamento VARCHAR(20) NOT NULL,
  observaciones TEXT,
  FOREIGN KEY (auditor_id)  REFERENCES usuarios(id),
  FOREIGN KEY (ciudad_id)   REFERENCES ciudades(id),
  FOREIGN KEY (conjunto_id) REFERENCES conjuntos(id),
  FOREIGN KEY (torre_id)    REFERENCES torres(id)
);

CREATE TABLE IF NOT EXISTS medidores (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  visita_id           INT NOT NULL,
  tipo                ENUM('luz','agua','gas') NOT NULL,
  foto_path           VARCHAR(255),
  lectura_ocr         VARCHAR(30),
  confianza_ocr       ENUM('alta','media','baja'),
  nota_ocr            TEXT,
  lectura_manual      VARCHAR(30),
  lectura_confirmada  VARCHAR(30),
  requiere_revision   TINYINT(1) NOT NULL DEFAULT 0,
  revisado_por        INT,
  revisado_en         DATETIME,
  FOREIGN KEY (visita_id)    REFERENCES visitas(id),
  FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
);
`;

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log('Creando base de datos y tablas...');
  await conn.query(SQL);
  console.log('Tablas creadas OK');

  // Admin por defecto
  const hash = await bcrypt.hash('Admin1234!', 12);
  await conn.query(
    `INSERT IGNORE INTO usuarios (nombre, email, password_hash, rol)
     VALUES ('Administrador', 'admin@formas-ia.com', ?, 'admin')`,
    [hash]
  );
  console.log('Usuario admin creado: admin@formas-ia.com / Admin1234!');

  // Datos de ejemplo
  await conn.query(`
    INSERT IGNORE INTO ciudades (nombre) VALUES ('Bogotá'), ('Medellín'), ('Cali'), ('Barranquilla'), ('Bucaramanga');
  `);
  console.log('Ciudades de ejemplo insertadas');

  await conn.end();
  console.log('Init DB completado.');
}

init().catch(err => { console.error(err); process.exit(1); });
