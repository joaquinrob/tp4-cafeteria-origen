import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import rateLimit from 'express-rate-limit';

import config from '../config';
import * as catalogo from '../services/catalogo.service';
import * as usuarios from '../services/usuarios.service';
import { requiereSesion, requiereRol } from '../middleware/auth';
import { sesiones } from '../middleware/sesion';
import {
  enLista,
  errorValidacion,
  validarId,
  validarTexto,
  ROLES_PERMITIDOS,
  TIPOS_PERMITIDOS,
  VARIEDADES_PERMITIDAS,
} from '../validacion';
import type { Sesion, Usuario } from '../tipos';

const router = express.Router();

/**
 * Rutas del panel de administración.
 *
 * Antes solo se pedía estar logueado, y cualquier usuario (incluso un
 * cliente) podía borrar productos, cambiar roles o ejecutar comandos.
 * Ahora todo el router exige sesión y rol admin.
 */
router.use(requiereSesion, requiereRol('admin'));

/**
 * Cierra las sesiones abiertas de un usuario. La sesión guarda una copia del
 * usuario (con su rol), así que si cambian el rol o la contraseña hay que
 * descartarlas: si no, siguen valiendo con los datos viejos hasta que venzan.
 * `conservar` es la sesión de la petición actual, para no sacar del panel a
 * quien está haciendo el cambio sobre su propia cuenta.
 */
function cerrarSesionesDe(idUsuario: number, conservar?: Sesion): void {
  for (const [sid, sesion] of sesiones) {
    if (sesion.usuario.id === idUsuario && sesion !== conservar) sesiones.delete(sid);
  }
}

/** GET /api/admin/usuarios */
router.get('/usuarios', async (req, res, next) => {
  try {
    res.json({ usuarios: await usuarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id
 * Solo se toman los campos conocidos y se valida cada uno. El rol solo lo
 * puede cambiar un admin y tiene que ser uno de la lista. Si cambia el rol,
 * la contraseña o el nombre de usuario, se cierran las sesiones abiertas de
 * esa cuenta.
 */
router.put('/usuarios/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const { username, nombre, rol, password } = req.body || {};
    const cambios: Partial<Usuario> = {};

    if (username !== undefined) {
      const valor = validarTexto(username, 'username', 50);
      if (!valor || !/^[a-zA-Z0-9_.-]+$/.test(valor)) throw errorValidacion('Nombre de usuario inválido.');
      cambios.username = valor;
    }
    if (nombre !== undefined) {
      cambios.nombre = validarTexto(nombre, 'nombre', 60, false);
    }
    if (rol !== undefined) {
      if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({ error: 'No tenés permisos para cambiar roles.' });
      }
      if (!enLista(rol, ROLES_PERMITIDOS)) throw errorValidacion('Rol inválido.');
      if (id === req.usuario.id && rol !== 'admin') {
        throw errorValidacion('No te podés sacar el rol de admin a vos mismo.');
      }
      cambios.rol = rol;
    }
    if (password !== undefined) {
      cambios.password = validarPasswordNueva(password);
    }

    const usuario = await usuarios.actualizar(id, cambios);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (cambios.rol !== undefined || cambios.password !== undefined || cambios.username !== undefined) {
      const esMiCuenta = id === req.usuario!.id;
      cerrarSesionesDe(id, esMiCuenta ? req.sesion : undefined);
      // Si el admin se cambió el usuario a sí mismo, su sesión sigue abierta
      // y tiene que quedar con el nombre nuevo
      if (esMiCuenta && req.sesion) req.sesion.usuario.username = usuario.username;
    }

    res.json(usuario);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
    }
    next(err);
  }
});

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 72; // bcrypt no usa más de 72 caracteres

/**
 * Política de contraseñas: al menos 10 caracteres, con mayúscula, minúscula,
 * número y símbolo. Si no se cumple, el mensaje dice qué es lo que falta.
 */
function validarPasswordNueva(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw errorValidacion('Falta la contraseña nueva.');
  }
  if (valor.length > PASSWORD_MAX) {
    throw errorValidacion('La contraseña no puede superar los ' + PASSWORD_MAX + ' caracteres.');
  }

  const faltan: string[] = [];
  if (valor.length < PASSWORD_MIN) faltan.push('al menos ' + PASSWORD_MIN + ' caracteres');
  if (!/\p{Lu}/u.test(valor)) faltan.push('una mayúscula');
  if (!/\p{Ll}/u.test(valor)) faltan.push('una minúscula');
  if (!/\d/.test(valor)) faltan.push('un número');
  if (!/[^\p{L}\p{N}]/u.test(valor)) faltan.push('un símbolo');

  if (faltan.length > 0) {
    throw errorValidacion('La contraseña no cumple los requisitos. Falta: ' + faltan.join(', ') + '.');
  }
  return valor;
}

function validarNumero(valor: unknown, campo: string, max: number): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > max) throw errorValidacion('El campo ' + campo + ' no es válido.');
  return n;
}

// Tamaños de la carta (los mismos que ofrece el selector del panel)
const TAMANOS_PERMITIDOS = ['Pocillo', 'Mediano', 'Taza grande'];

/** Valida los datos de un producto que llegan del panel. */
function validarProducto(body: Record<string, unknown>): catalogo.DatosProductoEntrada {
  const nombre = validarTexto(body.nombre, 'nombre', 80) as string;
  if (!enLista(body.tipo, TIPOS_PERMITIDOS)) throw errorValidacion('Tipo de producto inválido.');
  if (body.variedad && !enLista(body.variedad, VARIEDADES_PERMITIDAS)) {
    throw errorValidacion('Origen inválido.');
  }
  const tamano = validarTexto(body.tamano, 'tamano', 30, false);
  if (tamano !== null && !enLista(tamano, TAMANOS_PERMITIDOS)) {
    throw errorValidacion('Tamaño inválido.');
  }
  const gramos = validarNumero(body.gramos, 'gramos', 1000);
  if (gramos !== null && !Number.isInteger(gramos)) throw errorValidacion('Los gramos tienen que ser enteros.');

  return {
    nombre,
    tipo: body.tipo as catalogo.DatosProductoEntrada['tipo'],
    variedad: (body.variedad || null) as catalogo.DatosProductoEntrada['variedad'],
    tamano,
    gramos,
    precio_base: validarNumero(body.precio_base, 'precio base', 1000000) ?? 0,
    precio_por_gramo: validarNumero(body.precio_por_gramo, 'precio por gramo', 100000) ?? 0,
    descripcion: validarTexto(body.descripcion, 'descripcion', 300, false) || '',
    activo: body.activo !== false,
  };
}

/** POST /api/admin/productos — alta de producto. */
router.post('/productos', async (req, res, next) => {
  try {
    const producto = await catalogo.crear(validarProducto(req.body || {}));
    res.status(201).json(producto);
  } catch (err) {
    // El nombre del producto es único en la base.
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ya existe un producto con ese nombre.' });
    }
    next(err);
  }
});

/** PUT /api/admin/productos/:id */
router.put('/productos/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Producto no encontrado.' });

    const producto = await catalogo.actualizar(id, validarProducto(req.body || {}));
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ya existe un producto con ese nombre.' });
    }
    next(err);
  }
});

/** DELETE /api/admin/productos/:id (el token CSRF lo controla verificarCsrf) */
router.delete('/productos/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Producto no encontrado.' });

    const producto = await catalogo.eliminar(id);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/cambiar-contrasena
 *
 * Pide la contraseña actual además de la nueva: con una sesión robada (o una
 * computadora que quedó abierta) no alcanza para cambiarla. Los intentos con
 * la contraseña actual equivocada tienen límite, y al cambiarla se cierran
 * las otras sesiones abiertas de la cuenta.
 */
const validarCambioPassword: express.RequestHandler = (req, _res, next) => {
  try {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== 'string' || !actual) throw errorValidacion('Falta la contraseña actual.');
    validarPasswordNueva(nueva);
    next();
  } catch (err) {
    next(err);
  }
};

// 5 intentos fallidos cada 15 minutos por usuario. Los cambios correctos no
// cuentan, y los errores de validación se cortan antes de llegar acá.
const limiteCambioPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'usuario-' + (req.usuario ? req.usuario.id : ''),
  message: { error: 'Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.' },
});

router.post('/cambiar-contrasena', validarCambioPassword, limiteCambioPassword, async (req, res, next) => {
  try {
    const { actual, nueva } = req.body;
    const verificado = await usuarios.autenticar(req.usuario!.username, actual);
    if (!verificado || verificado.id !== req.usuario!.id) {
      return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
    }

    const usuario = await usuarios.cambiarPassword(req.usuario!.id, nueva);
    cerrarSesionesDe(req.usuario!.id, req.sesion);
    res.json({ mensaje: 'Contraseña actualizada.', usuario });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/probar-conexion
 *
 * Antes se armaba el comando "ping -c 3 " + host y se ejecutaba con exec,
 * que pasa por /bin/sh. Con "127.0.0.1; cat /etc/passwd" se ejecutaba lo que
 * uno quisiera. Ahora:
 *  - el host tiene que estar en la lista blanca (el panel lo elige de un selector)
 *  - si no está, el error no dice cuáles son los permitidos y el intento queda en el log
 *  - se usa spawn con los argumentos separados y sin shell
 */
const HOSTS_PERMITIDOS = ['proveedor.origen.com', 'localhost'];

router.post('/probar-conexion', (req, res) => {
  const { host } = req.body || {};

  if (!enLista(host, HOSTS_PERMITIDOS)) {
    // JSON.stringify escapa los saltos de línea: no se pueden inventar líneas en el log
    console.warn(
      '[probar-conexion] host rechazado:',
      JSON.stringify(String(host).slice(0, 100)),
      'usuario:',
      req.usuario!.username
    );
    return res.status(400).json({ error: 'Host no permitido.' });
  }

  const proceso = spawn('ping', ['-c', '3', '-W', '2', host], { shell: false, timeout: 10000 });
  let salida = '';
  let errores = '';

  proceso.stdout.on('data', (d) => { salida += d; });
  proceso.stderr.on('data', (d) => { errores += d; });
  proceso.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo ejecutar el ping.' });
  });
  proceso.on('close', () => {
    if (res.headersSent) return;
    res.json({ comando: 'ping -c 3 ' + host, salida, error: errores || null });
  });
});

/**
 * POST /api/admin/subir-archivo
 *
 * Antes se guardaba cualquier archivo, de cualquier tamaño y con el nombre
 * que mandaba el cliente (se podía subir un .html con scripts o usar ../
 * para escribir fuera de uploads). Ahora:
 *  - solo imágenes png, jpg, gif o webp (lista blanca de extensiones)
 *  - se revisa el tipo MIME real mirando los primeros bytes del archivo
 *  - máximo 2 MB
 *  - el nombre lo genera el servidor, el del cliente solo se usa para la extensión
 */
const TAMANO_MAX = 2 * 1024 * 1024;

const EXTENSIONES_PERMITIDAS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Detecta el tipo MIME real por la firma del archivo (magic numbers)
function detectarMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

router.post('/subir-archivo', (req, res, next) => {
  try {
    const { nombre, contenidoBase64 } = req.body || {};

    if (typeof nombre !== 'string' || typeof contenidoBase64 !== 'string' || !nombre || !contenidoBase64) {
      return res.status(400).json({ error: 'Falta el archivo.' });
    }

    const extension = path.extname(nombre).toLowerCase();
    const mimeEsperado = EXTENSIONES_PERMITIDAS[extension];
    if (!mimeEsperado) {
      return res.status(400).json({ error: 'Solo se permiten imágenes PNG, JPG, GIF o WEBP.' });
    }

    const buffer = Buffer.from(contenidoBase64, 'base64');
    if (buffer.length === 0 || buffer.length > TAMANO_MAX) {
      return res.status(400).json({ error: 'El archivo tiene que pesar menos de 2 MB.' });
    }

    if (detectarMime(buffer) !== mimeEsperado) {
      return res.status(400).json({ error: 'El contenido del archivo no coincide con su extensión.' });
    }

    const nombreFinal = crypto.randomBytes(16).toString('hex') + extension;
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, nombreFinal), buffer, { flag: 'wx' });

    res.json({
      mensaje: 'Archivo subido.',
      url: '/uploads/' + nombreFinal,
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
