import bcrypt from 'bcryptjs';
import * as db from '../db';
import type { Usuario } from '../tipos';

/**
 * Servicio de usuarios.
 *
 * Cambios de seguridad:
 *  - el login usa una consulta parametrizada (antes se concatenaba el usuario
 *    y la contrasena en el SQL y se podia entrar con ' OR 1=1 --)
 *  - las contrasenas se guardan con bcrypt y se comparan con bcrypt.compare
 *  - nunca se devuelve la columna password hacia afuera
 */

export const RONDAS_BCRYPT = 10;

// Columnas que se pueden devolver (sin el hash de la contrasena)
const COLUMNAS_PUBLICAS = 'id, username, rol, nombre, creado_en';

// Hash de relleno para que el login tarde lo mismo exista o no el usuario
const HASH_FALSO = bcrypt.hashSync('no-es-una-clave-real', RONDAS_BCRYPT);

export function hashear(password: string): Promise<string> {
  return bcrypt.hash(password, RONDAS_BCRYPT);
}

export function esHash(valor: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(valor);
}

/** Busca un usuario por nombre de usuario exacto. */
export async function buscarPorUsername(username: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

/**
 * Autentica a un usuario. Devuelve el usuario (sin password) o null.
 */
export async function autenticar(username: string, password: string): Promise<Usuario | null> {
  if (typeof username !== 'string' || typeof password !== 'string') return null;

  const usuario = await buscarPorUsername(username);
  const hash = usuario && esHash(usuario.password) ? usuario.password : HASH_FALSO;
  const coincide = await bcrypt.compare(password, hash);

  if (!usuario || !coincide || hash === HASH_FALSO) return null;

  const { password: _omitida, ...sinPassword } = usuario;
  return sinPassword as Usuario;
}

/** Lista todos los usuarios (para el panel de administracion). */
export async function listar(): Promise<Omit<Usuario, 'password'>[]> {
  const { rows } = await db.query<Usuario>(
    'SELECT ' + COLUMNAS_PUBLICAS + ' FROM usuarios ORDER BY id'
  );
  return rows;
}

// Solo estas columnas se pueden modificar desde el panel
const CAMPOS_EDITABLES = ['username', 'nombre', 'rol', 'password'];

/**
 * Actualiza un usuario. Los nombres de columna salen de CAMPOS_EDITABLES
 * (lista blanca) y los valores van como parametros.
 */
export async function actualizar(id: number, cambios: Partial<Usuario>): Promise<Omit<Usuario, 'password'> | null> {
  const campos: string[] = [];
  const valores: unknown[] = [];

  for (const [campo, valor] of Object.entries(cambios)) {
    if (!CAMPOS_EDITABLES.includes(campo)) continue;
    let valorFinal = valor;
    if (campo === 'password') valorFinal = await hashear(String(valor));
    valores.push(valorFinal);
    campos.push(`${campo} = $${valores.length}`);
  }
  if (campos.length === 0) return null;

  valores.push(id);
  const { rows } = await db.query<Usuario>(
    `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${valores.length} RETURNING ` + COLUMNAS_PUBLICAS,
    valores
  );
  return rows[0] || null;
}

/** Cambia la contrasena de un usuario (se guarda hasheada). */
export async function cambiarPassword(id: number, nuevaPassword: string): Promise<Omit<Usuario, 'password'> | null> {
  const hash = await hashear(nuevaPassword);
  const { rows } = await db.query<Usuario>(
    'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING ' + COLUMNAS_PUBLICAS,
    [hash, id]
  );
  return rows[0] || null;
}
