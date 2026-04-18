/**
 * Wrapper para rutas async en Express 4.
 * Express 4 no captura errores de promesas rechazadas automáticamente.
 * Este wrapper las pasa al error handler global via next(err).
 */
module.exports = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
