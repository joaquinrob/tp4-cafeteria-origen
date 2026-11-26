/**
 * Manejo de errores.
 *
 * Antes se mandaba al cliente el mensaje original y el stack trace (rutas
 * del servidor, nombres de tablas, partes del SQL). Ahora el detalle queda
 * solo en el log y al cliente le llega un mensaje generico. Solo se muestran
 * los mensajes de validacion que armamos nosotros (err.publico).
 */

import type { NextFunction, Request, Response } from 'express';

import type { ErrorHttp } from '../tipos';

export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

// Express reconoce al manejador de errores por sus 4 parametros, por eso
// next tiene que estar aunque no se use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function manejadorErrores(err: ErrorHttp, req: Request, res: Response, next: NextFunction): void {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;

  if (status === 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'Error interno del servidor.' });
    return;
  }

  res.status(status).json({ error: err.publico ? err.message : 'Solicitud invalida.' });
}
