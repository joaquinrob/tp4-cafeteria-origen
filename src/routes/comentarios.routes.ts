import express from 'express';
import * as comentarios from '../services/comentarios.service';
import { requiereSesion, requiereRol } from '../middleware/auth';
import { validarId } from '../validacion';

const router = express.Router();

/** GET /api/comentarios — reseñas públicas de la cafetería. */
router.get('/', async (req, res, next) => {
  try {
    res.json({ comentarios: await comentarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comentarios
 * El servicio valida el largo del texto y la calificación. El texto se
 * guarda como texto y el sitio lo muestra con textContent.
 */
router.post('/', async (req, res, next) => {
  try {
    const { autor, texto, calificacion } = req.body || {};
    const comentario = await comentarios.crear({ autor, texto, calificacion });
    res.status(201).json(comentario);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/comentarios/:id — solo un admin puede borrar reseñas. */
router.delete('/:id', requiereSesion, requiereRol('admin'), async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    const comentario = id ? await comentarios.eliminar(id) : null;
    if (!comentario) {
      return res.status(404).json({ error: 'Comentario no encontrado.' });
    }
    res.json(comentario);
  } catch (err) {
    next(err);
  }
});

export default router;
