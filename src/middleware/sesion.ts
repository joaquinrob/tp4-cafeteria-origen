/**
 * Gestion de sesiones.
 *
 * Cambios:
 *  - el id de sesion es aleatorio (crypto.randomBytes), antes era sesion_1,
 *    sesion_2... y se podia adivinar la sesion de otro
 *  - la cookie va con httpOnly, sameSite y secure (secure solo en produccion
 *    porque en local se usa http)
 *  - las sesiones vencen por inactividad y por tiempo maximo
 *  - al hacer login se borra la sesion anterior (se regenera el id)
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';

import config from '../config';
import type { Sesion, UsuarioSesion } from '../tipos';

export const sesiones = new Map<string, Sesion>();

// Tiempo maximo de una sesion y tiempo maximo sin usarla
const TTL_SESION = 8 * 60 * 60 * 1000;
const TTL_INACTIVIDAD = 30 * 60 * 1000;

const opcionesCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
};

/** Lee las cookies de la peticion (parser minimo, sin dependencias). */
export function leerCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const parte of header.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const nombre = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    try {
      if (nombre) cookies[nombre] = decodeURIComponent(valor);
    } catch {
      // cookie mal codificada, se ignora
    }
  }
  return cookies;
}

/** Crea una sesion nueva para el usuario y setea la cookie. */
export function crearSesion(req: Request, res: Response, usuario: UsuarioSesion): string {
  // si ya venia con una sesion se descarta, asi el id cambia despues del login
  destruirSesion(req);

  const id = crypto.randomBytes(32).toString('hex');
  const ahora = Date.now();

  sesiones.set(id, {
    usuario,
    creadaEn: ahora,
    expiraEn: ahora + TTL_SESION,
    ultimoUso: ahora,
  });

  res.cookie('sid', id, { ...opcionesCookie, maxAge: TTL_SESION });

  return id;
}

/** Devuelve la sesion de la peticion, si existe y no esta vencida. */
export function obtenerSesion(req: Request): Sesion | null {
  const id = leerCookies(req).sid;
  if (!id) return null;

  const sesion = sesiones.get(id);
  if (!sesion) return null;

  const ahora = Date.now();
  if (ahora > sesion.expiraEn || ahora - sesion.ultimoUso > TTL_INACTIVIDAD) {
    sesiones.delete(id);
    return null;
  }

  sesion.ultimoUso = ahora;
  return sesion;
}

/** Borra la sesion del servidor. */
export function destruirSesion(req: Request): void {
  const id = leerCookies(req).sid;
  if (id) sesiones.delete(id);
}

export function borrarCookieSesion(res: Response): void {
  res.clearCookie('sid', opcionesCookie);
}

// Limpieza de sesiones vencidas cada 10 minutos
setInterval(() => {
  const ahora = Date.now();
  for (const [id, sesion] of sesiones) {
    if (ahora > sesion.expiraEn || ahora - sesion.ultimoUso > TTL_INACTIVIDAD) {
      sesiones.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();
