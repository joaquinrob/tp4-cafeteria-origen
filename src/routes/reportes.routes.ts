import express from 'express';
import * as reportes from '../services/reportes.service';

const router = express.Router();

/** GET /api/reportes/facturacion — cuánto se facturó. */
router.get('/facturacion', async (req, res, next) => {
  try {
    res.json(await reportes.facturacion());
  } catch (err) {
    next(err);
  }
});

/** GET /api/reportes/cantidad-vendida — unidades por tipo de producto. */
router.get('/cantidad-vendida', async (req, res, next) => {
  try {
    res.json({ cantidadVendida: await reportes.cantidadVendidaPorTipo() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reportes/mas-vendido — producto más vendido. */
router.get('/mas-vendido', async (req, res, next) => {
  try {
    res.json({ producto: await reportes.masVendido() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reportes/ticket-promedio */
router.get('/ticket-promedio', async (req, res, next) => {
  try {
    res.json(await reportes.ticketPromedio());
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reportes/ventas-por-variedad?variedad=
 * La variedad se valida con lista blanca y va como parámetro (ver servicio).
 */
router.get('/ventas-por-variedad', async (req, res, next) => {
  try {
    const variedad = typeof req.query.variedad === 'string' ? req.query.variedad : '';
    res.json({ ventas: await reportes.ventasPorVariedad(variedad) });
  } catch (err) {
    next(err);
  }
});

export default router;
