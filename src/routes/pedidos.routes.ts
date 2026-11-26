import express from 'express';
import * as pedidos from '../services/pedidos.service';
import { enLista, validarId, ESTADOS_PERMITIDOS } from '../validacion';

const router = express.Router();

/**
 * POST /api/pedidos
 * Crea un pedido y devuelve su total calculado. La validación de mesa,
 * cliente, items y cantidades está en pedidos.service. El token CSRF lo
 * controla el middleware verificarCsrf.
 */
router.post('/', async (req, res, next) => {
  try {
    const { mesa, cliente, items } = req.body || {};
    const pedido = await pedidos.crear({ mesa, cliente, items });
    res.status(201).json(pedido);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pedidos?mesa=
 * Lista los pedidos de todas las mesas (el filtro va como parámetro en el servicio).
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ pedidos: await pedidos.listar(req.query.mesa) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/pedidos/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    const pedido = id ? await pedidos.obtenerConItems(id) : null;
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/pedidos/:id/estado (solo estados de la lista blanca) */
router.patch('/:id/estado', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const { estado } = req.body || {};
    if (!enLista(estado, ESTADOS_PERMITIDOS)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }
    const pedido = await pedidos.cambiarEstado(id, estado);
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    next(err);
  }
});

export default router;
