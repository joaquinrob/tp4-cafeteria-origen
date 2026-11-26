/**
 * Proteccion CSRF con el patron "double submit cookie".
 *
 * GET /api/csrf-token genera un token aleatorio, lo guarda en la cookie
 * "csrf" y lo devuelve en el JSON. En cada POST/PUT/PATCH/DELETE el cliente
 * tiene que mandar el mismo token en la cabecera X-CSRF-Token (o en _csrf).
 * Una pagina de otro sitio puede hacer que el navegador mande la cookie,
 * pero no puede leer el token, asi que no puede armar la peticion valida.
 *
 * Tambien se revisa la cabecera Origin cuando viene.
 */

import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import config from '../config';
import { leerCookies } from './sesion';

const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

// El login no tiene sesion previa que robar y ya tiene rate limiting
const RUTAS_EXCLUIDAS = ['/api/auth/login'];

export function entregarTokenCsrf(req: Request, res: Response): void {
  let token = leerCookies(req).csrf;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
  }
  res.cookie('csrf', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
  });
  res.json({ token });
}

function sonIguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function origenValido(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function verificarCsrf(req: Request, res: Response, next: NextFunction) {
  if (METODOS_SEGUROS.includes(req.method)) return next();
  if (RUTAS_EXCLUIDAS.includes(req.originalUrl.split('?')[0])) return next();

  if (!origenValido(req)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }

  const tokenCookie = leerCookies(req).csrf;
  const enviado = req.get('x-csrf-token') || (req.body && req.body._csrf) || req.query._csrf;

  if (!tokenCookie || typeof enviado !== 'string' || !sonIguales(tokenCookie, enviado)) {
    return res.status(403).json({ error: 'Token CSRF invalido o ausente.' });
  }
  next();
}
