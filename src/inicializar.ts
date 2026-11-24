import bcrypt from 'bcryptjs';
import * as db from './db';
import { esHash, RONDAS_BCRYPT } from './services/usuarios.service';
import { CATALOGO } from './catalogo';
import type { Rol } from './tipos';

interface UsuarioInicial {
  username: string;
  password: string;
  rol: Rol;
  nombre: string;
}

/**
 * Carga los datos iniciales (usuarios y catalogo) si la base esta vacia.
 *
 * Las contrasenas se guardan hasheadas con bcrypt. Ademas se cambiaron las
 * claves de ejemplo (antes habia admin/admin, cliente/cliente, etc).
 */

export const USUARIOS_INICIALES: UsuarioInicial[] = [
  {
    username: 'admin',
    password: 'Admin_Origen_24!',
    rol: 'admin',
    nombre: 'Administración',
  },
  {
    username: 'valentina',
    password: 'Vale_Origen_24!',
    rol: 'admin',
    nombre: 'Valentina',
  },
  {
    username: 'barista',
    password: 'Barista_Cafe_24!',
    rol: 'barista',
    nombre: 'Barista',
  },
  {
    username: 'mozo',
    password: 'Mozo_Sala_24!',
    rol: 'mozo',
    nombre: 'Mozo de sala',
  },
  {
    username: 'cliente',
    password: 'Cliente_Web_24!',
    rol: 'cliente',
    nombre: 'Cliente',
  },
];

export async function inicializarBase(): Promise<void> {
  // --- Usuarios -------------------------------------------------------------
  for (const usuario of USUARIOS_INICIALES) {
    const existe = await db.query('SELECT id FROM usuarios WHERE username = $1', [usuario.username]);
    if (existe.rows.length > 0) continue;
    await db.query(
      `INSERT INTO usuarios (username, password, rol, nombre)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      [usuario.username, await bcrypt.hash(usuario.password, RONDAS_BCRYPT), usuario.rol, usuario.nombre]
    );
  }

  await migrarPasswordsEnTextoPlano();

  // --- Catalogo -------------------------------------------------------------
  for (const producto of CATALOGO) {
    await db.query(
      `INSERT INTO productos
         (nombre, tipo, variedad, tamano, gramos, precio_base, precio_por_gramo, descripcion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (nombre) DO NOTHING`,
      [
        producto.nombre,
        producto.tipo,
        producto.variedad,
        producto.tamano,
        producto.gramos,
        producto.precio_base,
        producto.precio_por_gramo,
        producto.descripcion,
      ]
    );
  }
}

/**
 * Si la base se creo con la version vieja quedan contrasenas en texto plano.
 * Las de los usuarios de ejemplo se reemplazan por las nuevas y el resto se
 * hashea con el valor que tenian.
 */
async function migrarPasswordsEnTextoPlano(): Promise<void> {
  const { rows } = await db.query<{ id: number; username: string; password: string }>(
    'SELECT id, username, password FROM usuarios'
  );
  for (const fila of rows) {
    if (esHash(fila.password)) continue;
    const inicial = USUARIOS_INICIALES.find((u) => u.username === fila.username);
    const nueva = inicial ? inicial.password : fila.password;
    await db.query('UPDATE usuarios SET password = $1 WHERE id = $2', [await bcrypt.hash(nueva, RONDAS_BCRYPT), fila.id]);
  }
}
