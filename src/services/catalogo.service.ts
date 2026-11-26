import * as db from '../db';
import { calcularPrecio } from '../catalogo';
import { enLista, TIPOS_PERMITIDOS, VARIEDADES_PERMITIDAS } from '../validacion';
import type { DatosProducto, Producto, ProductoConPrecio } from '../tipos';

/** Filtros del menú, tal como llegan en la query string. */
export interface FiltrosCatalogo {
  tipo?: string;
  variedad?: string;
  q?: string;
}

/** Datos que manda el panel de administracion al crear o editar. */
export type DatosProductoEntrada = Partial<DatosProducto> & { activo?: boolean };

/** Id tal como llega en la URL (texto) o ya convertido. */
type Id = number | string;

/**
 * Servicio de catalogo.
 *
 * Los filtros ahora van como parametros ($1, $2...) y tipo/variedad se
 * controlan contra una lista blanca. Antes se concatenaban en el SQL y con
 * algo como  Colombia' OR '1'='1  se traia todo el catalogo.
 */

/** Lista productos aplicando los filtros del menu. */
export async function listar(filtros: FiltrosCatalogo = {}): Promise<ProductoConPrecio[]> {
  const { tipo, variedad, q } = filtros;

  // Si el filtro no es uno de los valores conocidos no hay nada que mostrar
  if (tipo && !enLista(tipo, TIPOS_PERMITIDOS)) return [];
  if (variedad && !enLista(variedad, VARIEDADES_PERMITIDAS)) return [];

  const params: unknown[] = [];
  let sql = 'SELECT * FROM productos WHERE activo = true';

  if (tipo) {
    params.push(tipo);
    sql += ' AND tipo = $' + params.length;
  }
  if (variedad) {
    params.push(variedad);
    sql += ' AND variedad = $' + params.length;
  }
  if (q && typeof q === 'string') {
    // se escapan los comodines del LIKE para que se busquen literalmente
    const busqueda = q.slice(0, 50).replace(/[\\%_]/g, '\\$&');
    params.push('%' + busqueda + '%');
    sql += ' AND (nombre ILIKE $' + params.length + ' OR descripcion ILIKE $' + params.length + ')';
  }
  sql += ' ORDER BY tipo, variedad NULLS FIRST, id';

  const { rows } = await db.query<Producto>(sql, params);

  return rows.map((p) => ({ ...p, precio: calcularPrecio(p) }));
}

/** Obtiene un producto por id (el id ya viene validado como entero). */
export async function obtener(id: number): Promise<ProductoConPrecio | null> {
  const { rows } = await db.query<Producto>('SELECT * FROM productos WHERE id = $1', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], precio: calcularPrecio(rows[0]) };
}

/** Crea un producto nuevo. */
export async function crear(datos: DatosProductoEntrada): Promise<Producto> {
  const { rows } = await db.query<Producto>(
    `INSERT INTO productos (nombre, tipo, variedad, tamano, gramos, precio_base, precio_por_gramo, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      datos.nombre,
      datos.tipo,
      datos.variedad || null,
      datos.tamano || null,
      datos.gramos ?? null,
      datos.precio_base ?? 0,
      datos.precio_por_gramo ?? 0,
      datos.descripcion || '',
    ]
  );
  return rows[0];
}

/** Actualiza un producto. */
export async function actualizar(id: Id, datos: DatosProductoEntrada): Promise<Producto | null> {
  const { rows } = await db.query<Producto>(
    `UPDATE productos
        SET nombre = $1, tipo = $2, variedad = $3, tamano = $4, gramos = $5,
            precio_base = $6, precio_por_gramo = $7, descripcion = $8, activo = $9
      WHERE id = $10
      RETURNING *`,
    [
      datos.nombre,
      datos.tipo,
      datos.variedad || null,
      datos.tamano || null,
      datos.gramos ?? null,
      datos.precio_base ?? 0,
      datos.precio_por_gramo ?? 0,
      datos.descripcion || '',
      datos.activo !== false,
      id,
    ]
  );
  return rows[0] || null;
}

/** Elimina (desactiva) un producto. */
export async function eliminar(id: Id): Promise<Producto | null> {
  const { rows } = await db.query<Producto>(
    'UPDATE productos SET activo = false WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
}

/** Lista las variedades disponibles en el catálogo. */
export async function variedades(): Promise<string[]> {
  const { rows } = await db.query<{ variedad: string }>(
    "SELECT DISTINCT variedad FROM productos WHERE variedad IS NOT NULL ORDER BY variedad"
  );
  return rows.map((r) => r.variedad);
}
