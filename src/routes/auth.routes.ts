import express from 'express';
import rateLimit from 'express-rate-limit';

import * as usuarios from '../services/usuarios.service';
import { borrarCookieSesion, crearSesion, destruirSesion, obtenerSesion } from '../middleware/sesion';

const router = express.Router();

const MENSAJE_LOGIN_FALLIDO = 'Usuario o contrasena incorrectos.';
const MENSAJE_BLOQUEO = 'Demasiados intentos fallidos. Espera unos minutos y volve a probar.';

// Limite por IP + usuario: 5 intentos fallidos cada 15 minutos.
// Los logins correctos no cuentan (skipSuccessfulRequests).
const limitePorCuenta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = req.body && typeof req.body.username === 'string' ? req.body.username : '';
    return req.ip + '|' + username.toLowerCase();
  },
  message: { error: MENSAJE_BLOQUEO },
});

// Limite general por IP, para el que prueba muchos usuarios distintos
const limitePorIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: MENSAJE_BLOQUEO },
});

/**
 * Inicio de sesion.
 * El mensaje de error es siempre el mismo, exista o no el usuario, para que
 * no se pueda averiguar que cuentas hay.
 */
router.post('/login', limitePorIp, limitePorCuenta, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Falta usuario o contrasena.' });
    }
    if (username.length > 50 || password.length > 72) {
      return res.status(401).json({ error: MENSAJE_LOGIN_FALLIDO });
    }

    const usuario = await usuarios.autenticar(username, password);
    if (!usuario) {
      return res.status(401).json({ error: MENSAJE_LOGIN_FALLIDO });
    }

    const datosSesion = {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol,
      nombre: usuario.nombre,
    };
    crearSesion(req, res, datosSesion);

    res.json({ mensaje: 'Bienvenido, ' + usuario.nombre, usuario: datosSesion });
  } catch (err) {
    next(err);
  }
});

/** Cierre de sesion: se borra en el servidor y tambien la cookie. */
router.post('/logout', (req, res) => {
  destruirSesion(req);
  borrarCookieSesion(res);
  res.json({ mensaje: 'Sesion cerrada.' });
});

/** Devuelve el usuario de la sesion actual. */
router.get('/yo', (req, res) => {
  const sesion = obtenerSesion(req);
  if (!sesion) {
    return res.status(401).json({ error: 'Necesitas iniciar sesion.' });
  }
  res.json({ usuario: sesion.usuario });
});

export default router;
