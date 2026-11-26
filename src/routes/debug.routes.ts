import express from 'express';

import { requiereSesion, requiereRol } from '../middleware/auth';

const router = express.Router();

/**
 * Endpoint de diagnóstico.
 *
 * Antes devolvía todo process.env (con la clave de la base incluida) y no
 * pedía login. Ahora solo lo ve un admin y devuelve datos que no sirven
 * para atacar el sistema.
 */
router.get('/', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json({
    mensaje: 'Diagnóstico del servidor',
    estado: 'ok',
    uptimeSegundos: Math.round(process.uptime()),
    hora: new Date().toISOString(),
  });
});

export default router;
