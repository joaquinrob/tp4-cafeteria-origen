import * as db from '../db';
import { calcularPrecio } from '../catalogo';
import {
  errorValidacion,
  validarEntero,
  validarId,
  validarTexto,
  MAX_CANTIDAD_ITEM,
  MAX_ITEMS_PEDIDO,
} from '../validacion';
import type { Pedido, PedidoConItems, PedidoItem, Producto } from '../tipos';

/** Un renglón del pedido, tal como llega en el cuerpo de la petición. */
export interface ItemPedido {
  productoId: number;
  cantidad: number;
}

/** Pedido nuevo, tal como llega en el cuerpo de la petición. */
export interface NuevoPedido {
  mesa: string;
  cliente: string;
  items: ItemPedido[];
}

/** Id tal como llega en la URL (texto) o ya convertido. */
type Id = number | string;

/**
 * Servicio de pedidos.
 *
 * Antes no se validaba nada del cuerpo: se podia mandar cantidad -5 y el
 * pedido quedaba con total negativo, o un texto y el total quedaba NaN.
 * Ahora se controla tipo, rango y longitud de cada campo en el servidor.
 */

interface FilaPedido {
  productoId: number;
  cantidad: number;
  precioUnitario: number;
}

function validarPedido(datos: Partial<NuevoPedido>) {
  const mesa = validarTexto(datos.mesa, 'mesa', 10);
  const cliente = validarTexto(datos.cliente, 'cliente', 60, false);
  const items = datos.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw errorValidacion('El pedido tiene que tener al menos un producto.');
  }
  if (items.length > MAX_ITEMS_PEDIDO) {
    throw errorValidacion('El pedido tiene demasiados productos.');
  }

  const itemsValidos = items.map((item) => {
    const productoId = validarId(item && item.productoId);
    const cantidad = validarEntero(item && item.cantidad, 1, MAX_CANTIDAD_ITEM);
    if (!productoId) throw errorValidacion('Hay un producto invalido en el pedido.');
    if (!cantidad) {
      throw errorValidacion('La cantidad tiene que ser un entero entre 1 y ' + MAX_CANTIDAD_ITEM + '.');
    }
    return { productoId, cantidad };
  });

  return { mesa, cliente, items: itemsValidos };
}

/**
 * Crea un pedido a partir de una lista de items { productoId, cantidad }.
 * Total = suma de calcularPrecio(producto) x cantidad
 */
export async function crear(datos: Partial<NuevoPedido>): Promise<PedidoConItems | null> {
  const { mesa, cliente, items } = validarPedido(datos || {});
  const filas: FilaPedido[] = [];

  for (const item of items) {
    const producto = await buscarProducto(item.productoId);
    if (!producto) throw errorValidacion('Uno de los productos no existe.');
    filas.push({
      productoId: producto.id,
      cantidad: item.cantidad,
      precioUnitario: calcularPrecio(producto),
    });
  }

  const total = filas.reduce((acc, f) => acc + f.precioUnitario * f.cantidad, 0);

  const { rows } = await db.query<Pedido>(
    `INSERT INTO pedidos (mesa, cliente, estado, total)
     VALUES ($1, $2, 'abierto', $3)
     RETURNING *`,
    [mesa, cliente, total]
  );
  const pedido = rows[0];

  for (const fila of filas) {
    await db.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)`,
      [pedido.id, fila.productoId, fila.cantidad, fila.precioUnitario]
    );
  }

  return obtenerConItems(pedido.id);
}

/** Busca un producto activo por id. */
async function buscarProducto(productoId: number): Promise<Producto | null> {
  const { rows } = await db.query<Producto>(
    'SELECT * FROM productos WHERE id = $1 AND activo = true',
    [productoId]
  );
  return rows[0] || null;
}

/** Lista pedidos (con filtro opcional por mesa). */
export async function listar(mesa?: unknown): Promise<Pedido[]> {
  if (mesa !== undefined && mesa !== '') {
    if (typeof mesa !== 'string' || mesa.length > 10) return [];
    const { rows } = await db.query<Pedido>(
      'SELECT * FROM pedidos WHERE mesa = $1 ORDER BY id DESC',
      [mesa]
    );
    return rows;
  }
  const { rows } = await db.query<Pedido>('SELECT * FROM pedidos ORDER BY id DESC');
  return rows;
}

/** Devuelve un pedido con sus items. */
export async function obtenerConItems(id: Id): Promise<PedidoConItems | null> {
  const { rows: pedidos } = await db.query<Pedido>(
    'SELECT * FROM pedidos WHERE id = $1',
    [id]
  );
  const pedido = pedidos[0];
  if (!pedido) return null;

  const { rows: items } = await db.query<PedidoItem>(
    `SELECT pi.*, pr.nombre AS producto_nombre
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = $1`,
    [id]
  );

  return { ...pedido, items };
}

/** Cambia el estado de un pedido. */
export async function cambiarEstado(id: Id, estado: string): Promise<Pedido | null> {
  const { rows } = await db.query<Pedido>(
    'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
    [estado, id]
  );
  return rows[0] || null;
}
