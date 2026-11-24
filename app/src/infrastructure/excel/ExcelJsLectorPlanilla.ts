// LectorPlanilla adapter on exceljs (docs/adr/001-libreria-excel.md). The only reader that knows the library.
import type { CellValue, Worksheet } from 'exceljs'
import type { ArchivoSubido, LectorPlanilla, LecturaPlanilla } from '../../application/ports/LectorPlanilla.ts'
import type { Celda } from '../../domain/inscripciones/celdas.ts'
import { COLUMNAS, COLUMNAS_OBLIGATORIAS, type Columna, type FilaCruda } from '../../domain/inscripciones/validarPlanilla.ts'

const MAXIMO_BYTES = 2 * 1024 * 1024
const MAXIMO_FILAS = 2000
const HOJA = 'Inscripciones'

const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** exceljs cell value to a raw cell. Formulas give their cached result; rich text and links give their text. */
function celda(valor: CellValue): Celda {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'string' || typeof valor === 'number' || valor instanceof Date) return valor
  if (typeof valor === 'boolean') return String(valor)
  if ('richText' in valor) return valor.richText.map(parte => parte.text).join('')
  if ('formula' in valor || 'sharedFormula' in valor) return celda((valor.result ?? null) as CellValue)
  if ('text' in valor) return typeof valor.text === 'string' ? valor.text : celda(valor.text as CellValue)
  if ('error' in valor) return valor.error
  return null
}

const vacia = (valor: Celda) => valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '')

async function sha256(contenido: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', contenido)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export class ExcelJsLectorPlanilla implements LectorPlanilla {
  async leer({ nombre, contenido }: ArchivoSubido): Promise<LecturaPlanilla> {
    // Cheap checks before parsing an untrusted file.
    if (!/\.xlsx$/i.test(nombre)) return { ok: false, codigo: 'F01' }
    if (contenido.byteLength > MAXIMO_BYTES) return { ok: false, codigo: 'F02' }

    // Loaded on demand so it never weighs on the initial bundle.
    const { default: ExcelJS } = await import('exceljs')
    const libro = new ExcelJS.Workbook()
    try {
      await libro.xlsx.load(contenido)
    } catch {
      return { ok: false, codigo: 'F01' }
    }

    const hoja = libro.getWorksheet(HOJA)
    if (!hoja) return { ok: false, codigo: 'F03' }

    const posiciones = this.columnas(hoja)
    const faltantes = COLUMNAS_OBLIGATORIAS.filter(columna => !posiciones.has(columna))
    if (faltantes.length) return { ok: false, codigo: 'F04', columnasFaltantes: [...faltantes] }

    const leerFila = (numero: number): FilaCruda => {
      const fila = hoja.getRow(numero)
      const celdas: FilaCruda['celdas'] = {}
      for (const columna of COLUMNAS) {
        const posicion = posiciones.get(columna)
        celdas[columna] = posicion ? celda(fila.getCell(posicion).value) : null
      }
      return { fila: numero, celdas }
    }

    // Data rows run from row 2 to the last row with any value; empty rows in between are kept.
    let ultima = 1
    for (let numero = hoja.rowCount; numero > 1; numero--) {
      if (Object.values(leerFila(numero).celdas).some(valor => !vacia(valor))) { ultima = numero; break }
    }
    if (ultima === 1) return { ok: false, codigo: 'F05' }
    if (ultima - 1 > MAXIMO_FILAS) return { ok: false, codigo: 'F02' }

    const filas = Array.from({ length: ultima - 1 }, (_, i) => leerFila(i + 2))
    return { ok: true, filas, hash: await sha256(contenido) }
  }

  /** Column positions found by header text, ignoring case, accents and spaces. */
  private columnas(hoja: Worksheet): Map<Columna, number> {
    const porTexto = new Map(COLUMNAS.map(columna => [plegar(columna), columna]))
    const posiciones = new Map<Columna, number>()
    hoja.getRow(1).eachCell((cell, posicion) => {
      const columna = porTexto.get(plegar(String(celda(cell.value) ?? '')))
      if (columna && !posiciones.has(columna)) posiciones.set(columna, posicion)
    })
    return posiciones
  }
}
