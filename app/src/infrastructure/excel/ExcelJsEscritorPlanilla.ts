// EscritorPlanilla adapter on exceljs (docs/adr/001-libreria-excel.md). The only writer that knows the library.
import type { ColumnaHoja, EscritorPlanilla, LibroPlanilla, ValorCelda } from '../../application/ports/EscritorPlanilla.ts'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const FORMATO_MONEDA = '"$"#,##0.00'

const valor = (columna: ColumnaHoja, dato: ValorCelda) =>
  columna.formato === 'texto' && typeof dato === 'number' ? String(dato) : dato

export class ExcelJsEscritorPlanilla implements EscritorPlanilla {
  async escribir(libro: LibroPlanilla): Promise<Blob> {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()

    for (const definicion of libro.hojas) {
      const hoja = workbook.addWorksheet(definicion.nombre, { views: [{ state: 'frozen', ySplit: 1 }] })
      hoja.columns = definicion.columnas.map(columna => ({ header: columna.titulo, width: columna.ancho ?? Math.max(12, columna.titulo.length + 2) }))
      hoja.getRow(1).font = { bold: true }

      // Strings are assigned as plain values, which exceljs stores as text: never as formulas.
      definicion.filas.forEach(fila => hoja.addRow(definicion.columnas.map((columna, i) => valor(columna, fila[i] ?? null))))

      const ultimaFila = Math.max(definicion.filas.length, definicion.filasConListas ?? 0) + 1
      definicion.columnas.forEach((columna, i) => {
        for (let numero = 2; numero <= ultimaFila; numero++) {
          const cell = hoja.getRow(numero).getCell(i + 1)
          if (columna.formato === 'texto') cell.numFmt = '@'
          if (columna.formato === 'moneda') cell.numFmt = FORMATO_MONEDA
          if (columna.ajustarTexto) cell.alignment = { wrapText: true, vertical: 'top' }
          if (columna.lista) {
            cell.dataValidation = {
              type: 'list', allowBlank: true, showErrorMessage: true,
              formulae: [`"${columna.lista.join(',')}"`],
            }
          }
        }
      })
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return new Blob([buffer], { type: XLSX })
  }
}
