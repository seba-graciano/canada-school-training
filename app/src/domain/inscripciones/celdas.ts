// Pure cell normalization for the enrollment sheet (FUN-2026-0147 section 5).
// Normalizing is not correcting: spaces, dots, case and accents are cleaned; nothing is guessed.

/** A raw spreadsheet cell as the reader adapter returns it. Excel dates arrive as UTC midnight. */
export type Celda = string | number | Date | null | undefined

export type CursoCatalogo = { nivel: string, curso: string }

const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** dd/mm/yyyy, the way the secretary sees an Excel date. */
export function formatearFecha(fecha: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(fecha.getUTCDate())}/${dos(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()}`
}

/** The cell as text, without leading, trailing or repeated spaces. */
export function textoCelda(celda: Celda): string {
  if (celda === null || celda === undefined) return ''
  if (celda instanceof Date) return formatearFecha(celda)
  return String(celda).replace(/\s+/g, ' ').trim()
}

/** 7 or 8 digits once dots and spaces are removed; null otherwise. */
export function normalizarDni(celda: Celda): string | null {
  if (celda instanceof Date) return null
  const digitos = textoCelda(celda).replace(/[.\s]/g, '')
  return /^\d{7,8}$/.test(digitos) ? digitos : null
}

/** The catalog level matching the cell, ignoring case, accents and spaces. */
export function normalizarNivel(celda: Celda, catalogo: readonly CursoCatalogo[]): string | null {
  const clave = plegar(textoCelda(celda))
  if (!clave) return null
  return catalogo.find(item => plegar(item.nivel) === clave)?.nivel ?? null
}

// '3º Primaria', '3o primaria', '3 PRIMARIA' and '3° Primaria' share the key '3 primaria'.
const claveCurso = (texto: string) => plegar(texto)
  .replace(/[º°]/g, ' ')
  .replace(/^(\d)\s*(o|ro|do|er|to|vo)?\.?\s+/, '$1 ')
  .replace(/\s+/g, ' ')
  .trim()

/** The official course of that level matching the cell (R-03), or null when it does not belong. */
export function normalizarCurso(celda: Celda, nivel: string, catalogo: readonly CursoCatalogo[]): string | null {
  const clave = claveCurso(textoCelda(celda))
  if (!clave) return null
  return catalogo.find(item => item.nivel === nivel && claveCurso(item.curso) === clave)?.curso ?? null
}
