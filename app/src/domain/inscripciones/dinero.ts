// Monthly fee parsing (FUN-2026-0147 R-04, TEC 7.1). Works on text, never on float arithmetic:
// 185000.555 * 100 is not 18500055.5 in floating point, so digits are split as strings.
import { textoCelda, type Celda } from './celdas.ts'

export type ResultadoArancel =
  | { ok: true, centavos: number }
  | { ok: false, codigo: 'E09' | 'E10', valor: string }

// Largest value alumnos.arancel_base (integer cents) can store.
const MAXIMO_CENTAVOS = 2147483647

// Argentine text: dots group thousands, a comma starts the decimals.
const TEXTO_ARGENTINO = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/
// String(number) in plain notation, e.g. '185000.555'. Exponent notation is rejected.
const NUMERO_EXCEL = /^-?\d+(\.\d+)?$/

export function parsearArancel(celda: Celda): ResultadoArancel {
  const valor = textoCelda(celda)
  const invalido = { ok: false, codigo: 'E09', valor } as const
  if (celda instanceof Date || valor === '') return invalido

  let entero: string
  let decimales: string
  if (typeof celda === 'number') {
    if (!NUMERO_EXCEL.test(valor)) return invalido
    ;[entero, decimales = ''] = valor.split('.')
  } else {
    if (!TEXTO_ARGENTINO.test(valor)) return invalido
    ;[entero, decimales = ''] = valor.split(',')
    entero = entero.replaceAll('.', '')
  }

  const digitos = entero.replace('-', '')
  if (entero.startsWith('-') || /^0*$/.test(digitos + decimales)) return invalido
  if (decimales.length > 2) return { ok: false, codigo: 'E10', valor }
  const centavos = Number(digitos + decimales.padEnd(2, '0'))
  if (centavos > MAXIMO_CENTAVOS) return invalido
  return { ok: true, centavos }
}
