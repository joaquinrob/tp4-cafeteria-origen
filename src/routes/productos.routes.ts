import express from 'express';
import * as catalogo from '../services/catalogo.service';
import { validarId } from '../validacion';

const router = express.Router();

/**
 * GET /api/productos?tipo=&variedad=&q=
 * Lista el catálogo con filtros opcionales.
 *
 * Los filtros se pasan como parámetros en el servicio (ya no hay SQL
 * concatenado). El eco de los filtros se sigue devolviendo pero el sitio lo
 * pinta con textContent, así que no se ejecuta como HTML.
 */
function textoQuery(valor: unknown, max: number): string {
  return typeof valor === 'string' ? valor.slice(0, max) : '';
}

router.get('/', async (req, res, next) => {
  try {
    const filtros = {
      tipo: textoQuery(req.query.tipo, 20),
      variedad: textoQuery(req.query.variedad, 20),
      q: textoQuery(req.query.q, 50),
    };
    const productos = await catalogo.listar(filtros);
    res.json({ productos, filtros, total: productos.length });
  } catch (err) {
    next(err);
  }
});

/** GET /api/productos/variedades */
router.get('/variedades', async (req, res, next) => {
  try {
    res.json({ variedades: await catalogo.variedades() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/productos/:id
 * Devuelve un producto.
 *
 * El id se valida como entero y el mensaje de error ya no repite lo que
 * mandó el cliente (antes eso era un XSS reflejado).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    const producto = id ? await catalogo.obtener(id) : null;
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

export default router;
