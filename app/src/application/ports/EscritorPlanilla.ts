/**
 * A library-agnostic description of a workbook. Use cases build it; the Excel adapter renders it.
 * The export side (student roll) reuses this port with `moneda` and `texto` columns.
 */
export type FormatoColumna = 'texto' | 'numero' | 'moneda'

export type ColumnaHoja = {
  titulo: string
  ancho?: number
  /** texto: stored as text, so Excel never shows 4,51E+07 (R-16). moneda: a summable number (R-15). */
  formato?: FormatoColumna
  /** Drop-down list offered on every data row of this column (R-02). */
  lista?: readonly string[]
  /** Wrap long text, such as the error list of the error report. */
  ajustarTexto?: boolean
}

export type ValorCelda = string | number | null

export type HojaPlanilla = {
  nombre: string
  columnas: readonly ColumnaHoja[]
  filas: readonly (readonly ValorCelda[])[]
  /** Rows that get the drop-down lists even when they are still empty. */
  filasConListas?: number
}

export type LibroPlanilla = { hojas: readonly HojaPlanilla[] }

/**
 * Renders a workbook as an .xlsx Blob. Text starting with =, +, - or @ is always written
 * as a literal string, never as a formula (R-17, formula injection).
 */
export interface EscritorPlanilla {
  escribir(libro: LibroPlanilla): Promise<Blob>
}
