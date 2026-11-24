import { PRECIO_POR_GRAMO } from './catalogo';
import type { ErrorHttp } from './tipos';

// Listas blancas: solo se aceptan estos valores
export const TIPOS_PERMITIDOS = ['espresso', 'filtrado', 'pasteleria'];
export const VARIEDADES_PERMITIDAS = Object.keys(PRECIO_POR_GRAMO);
export const ESTADOS_PERMITIDOS = ['abierto', 'preparando', 'listo', 'entregado'];
export const ROLES_PERMITIDOS = ['admin', 'barista', 'mozo', 'cliente'];

export const MAX_ITEMS_PEDIDO = 50;
export const MAX_CANTIDAD_ITEM = 100;

// Error que se puede mostrar al cliente tal cual (lo usa el manejador de errores)
export function errorValidacion(mensaje: string, status = 400): ErrorHttp {
  const err: ErrorHttp = new Error(mensaje);
  err.status = status;
  err.publico = true;
  return err;
}

// Devuelve el id como numero o null si no es un entero positivo
export function validarId(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function validarEntero(valor: unknown, min: number, max: number): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  if (typeof valor === 'string' && !/^-?\d+$/.test(valor.trim())) return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// Valida un texto: lo recorta y controla la longitud
export function validarTexto(valor: unknown, campo: string, max: number, obligatorio = true): string | null {
  if (valor === undefined || valor === null || valor === '') {
    if (obligatorio) throw errorValidacion(`Falta el campo ${campo}.`);
    return null;
  }
  if (typeof valor !== 'string' && typeof valor !== 'number') {
    throw errorValidacion(`El campo ${campo} no es valido.`);
  }
  const texto = String(valor).trim();
  if (obligatorio && texto.length === 0) {
    throw errorValidacion(`Falta el campo ${campo}.`);
  }
  if (texto.length > max) {
    throw errorValidacion(`El campo ${campo} supera los ${max} caracteres.`);
  }
  return texto;
}

export function enLista(valor: unknown, lista: string[]): boolean {
  return typeof valor === 'string' && lista.includes(valor);
}
