import * as db from '../db';
import { errorValidacion, validarEntero, validarTexto } from '../validacion';
import type { Comentario } from '../tipos';

/** Datos de una resena nueva, tal como llegan en el cuerpo de la peticion. */
export interface NuevoComentario {
  autor: string;
  texto: string;
  calificacion: number;
}

export const MAX_LONGITUD_AUTOR = 40;
export const MAX_LONGITUD_TEXTO = 500;

/**
 * Servicio de comentarios / resenas.
 *
 * El texto se valida (largo y calificacion de 1 a 5) antes de guardarlo.
 * El XSS almacenado se corrige del lado del cliente: las resenas se pintan
 * con textContent y no con innerHTML, y ademas hay CSP.
 */

/** Lista todos los comentarios, del más nuevo al más viejo. */
export async function listar(): Promise<Comentario[]> {
  const { rows } = await db.query<Comentario>(
    'SELECT * FROM comentarios ORDER BY id DESC'
  );
  return rows;
}

/** Crea un comentario. */
export async function crear(datos: Partial<NuevoComentario>): Promise<Comentario> {
  const autor = validarTexto(datos.autor, 'autor', MAX_LONGITUD_AUTOR);
  const texto = validarTexto(datos.texto, 'texto', MAX_LONGITUD_TEXTO);
  const calificacion = validarEntero(datos.calificacion, 1, 5);
  if (!calificacion) {
    throw errorValidacion('La calificacion tiene que ser un numero del 1 al 5.');
  }

  const { rows } = await db.query<Comentario>(
    `INSERT INTO comentarios (autor, texto, calificacion)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [autor, texto, calificacion]
  );
  return rows[0];
}

/** Elimina un comentario. */
export async function eliminar(id: number | string): Promise<Comentario | null> {
  const { rows } = await db.query<Comentario>(
    'DELETE FROM comentarios WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
}
