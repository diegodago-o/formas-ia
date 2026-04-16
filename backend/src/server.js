require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./middleware/logger');
const { testConnection } = require('./models/db');

const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalogs');
const visitRoutes = require('./routes/visits');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 4000;

// Seguridad y utilidades
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api', rateLimit({ windowMs: 1 * 60 * 1000, max: 200 }));

// Archivos estáticos (fotos subidas)
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOADS_DIR || 'uploads')));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Manejo de errores global
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

// Arrancar
testConnection().then(() => {
  app.listen(PORT, () => {
    logger.info(`Formas IA backend corriendo en puerto ${PORT}`);
  });
}).catch(err => {
  logger.error('No se pudo conectar a la base de datos:', err);
  process.exit(1);
});
