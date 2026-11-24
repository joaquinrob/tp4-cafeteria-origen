import path from 'path';

/**
 * Configuracion de la aplicacion.
 *
 * Todo sale de variables de entorno (ver .env.example). Ya no hay
 * contrasenas ni secretos escritos en el codigo, y el usuario por defecto
 * de la base es origen_app (sin permisos de superusuario).
 */
export default {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'origen',
    user: process.env.DB_USER || 'origen_app',
    password: process.env.DB_PASSWORD,
  },

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};
