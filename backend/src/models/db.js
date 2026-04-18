const mysql = require('mysql2/promise');
const logger = require('../middleware/logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'formas_ia',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '-05:00', // Colombia
});

async function testConnection() {
  const conn = await pool.getConnection();
  logger.info('Conexion a MySQL establecida');
  conn.release();
}

module.exports = { pool, testConnection };
