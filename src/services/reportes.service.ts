import * as db from '../db';
import { enLista, VARIEDADES_PERMITIDAS } from '../validacion';
import type { Numerico } from '../tipos';

export interface Facturacion {
  facturado: Numerico;
  pedidos: Numerico;
}

export interface ProductoMasVendido {
  id: number;
  nombre: string;
  tipo: string;
  unidades: Numerico;
}

export interface VentaPorVariedad {
  variedad: string | null;
  nombre: string;
  unidades: Numerico;
  total: Numerico;
}

/**
 * Servicio de reportes.
 *
 * El reporte por origen concatenaba la variedad en el SQL y con un UNION se
 * podian leer otras tablas (por ejemplo usuarios). Ahora la variedad se
 * controla con una lista blanca y va como parametro.
 */

/** Facturación total: suma de los totales de todos los pedidos. */
export async function facturacion(): Promise<Facturacion> {
  const { rows } = await db.query<Facturacion>(
    'SELECT COALESCE(SUM(total), 0) AS facturado, COUNT(*) AS pedidos FROM pedidos'
  );
  return rows[0];
}

/** Cantidad vendida por producto, agrupada por tipo. */
export async function cantidadVendidaPorTipo(): Promise<Record<string, number>> {
  const { rows } = await db.query<{ tipo: string; unidades: Numerico }>(
    `SELECT pr.tipo, SUM(pi.cantidad) AS unidades
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      GROUP BY pr.tipo
      ORDER BY unidades DESC`
  );
  const resultado: Record<string, number> = {};
  for (const fila of rows) {
    resultado[fila.tipo] = Number(fila.unidades);
  }
  return resultado;
}

/** Producto más vendido. */
export async function masVendido(): Promise<ProductoMasVendido | null> {
  const { rows } = await db.query<ProductoMasVendido>(
    `SELECT pr.id, pr.nombre, pr.tipo, SUM(pi.cantidad) AS unidades
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      GROUP BY pr.id, pr.nombre, pr.tipo
      ORDER BY unidades DESC
      LIMIT 1`
  );
  return rows[0] || null;
}

/** Ventas por origen (variedad). */
export async function ventasPorVariedad(variedad: string): Promise<VentaPorVariedad[]> {
  if (!enLista(variedad, VARIEDADES_PERMITIDAS)) return [];

  const { rows } = await db.query<VentaPorVariedad>(
    `SELECT pr.variedad, pr.nombre, SUM(pi.cantidad) AS unidades,
            SUM(pi.cantidad * pi.precio_unitario) AS total
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pr.variedad = $1
      GROUP BY pr.variedad, pr.nombre`,
    [variedad]
  );
  return rows;
}

/** Ticket promedio por pedido. */
export async function ticketPromedio(): Promise<{ promedio: Numerico }> {
  const { rows } = await db.query<{ promedio: Numerico }>(
    'SELECT COALESCE(AVG(total), 0) AS promedio FROM pedidos'
  );
  return rows[0];
}
