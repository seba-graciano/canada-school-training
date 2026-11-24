import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { ExcelJsEscritorPlanilla } from './ExcelJsEscritorPlanilla.ts'

const escritor = new ExcelJsEscritorPlanilla()

async function releer(blob) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  return workbook
}

const LIBRO = {
  hojas: [
    {
      nombre: 'Datos',
      columnas: [
        { titulo: 'DNI', formato: 'texto' },
        { titulo: 'Nivel', lista: ['Inicial', 'Primario', 'Secundario'] },
        { titulo: 'Arancel', formato: 'moneda' },
        { titulo: 'Notas', ajustarTexto: true },
      ],
      filas: [
        [45111222, 'Primario', 185000.5, 'línea 1\nlínea 2'],
        ['40123456', null, 210000, '=HYPERLINK("http://example.com","Ver")'],
      ],
      filasConListas: 5,
    },
    { nombre: 'Otra', columnas: [{ titulo: 'A' }], filas: [['x']] },
  ],
}

test('writes every sheet with a bold, frozen header row', async () => {
  const workbook = await releer(await escritor.escribir(LIBRO))
  assert.deepEqual(workbook.worksheets.map(ws => ws.name), ['Datos', 'Otra'])
  const hoja = workbook.getWorksheet('Datos')
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['DNI', 'Nivel', 'Arancel', 'Notas'])
  assert.equal(hoja.getRow(1).getCell(1).font.bold, true)
  assert.equal(hoja.views[0].state, 'frozen')
  assert.equal(hoja.views[0].ySplit, 1)
})

test('texto columns store text, so a DNI never becomes 4,51E+07 (R-16)', async () => {
  const hoja = (await releer(await escritor.escribir(LIBRO))).getWorksheet('Datos')
  assert.equal(hoja.getCell('A2').value, '45111222')
  assert.equal(hoja.getCell('A2').numFmt, '@')
  assert.equal(hoja.getCell('A3').value, '40123456')
})

test('moneda columns store summable numbers with a currency format (R-15)', async () => {
  const hoja = (await releer(await escritor.escribir(LIBRO))).getWorksheet('Datos')
  assert.equal(hoja.getCell('C2').value, 185000.5)
  assert.equal(typeof hoja.getCell('C3').value, 'number')
  assert.match(hoja.getCell('C2').numFmt, /\$/)
})

test('lists become drop-downs on data rows, including empty ones (R-02)', async () => {
  const hoja = (await releer(await escritor.escribir(LIBRO))).getWorksheet('Datos')
  for (const ref of ['B2', 'B4', 'B6']) {
    assert.deepEqual(hoja.getCell(ref).dataValidation,
      { type: 'list', allowBlank: true, formulae: ['"Inicial,Primario,Secundario"'], showErrorMessage: true }, ref)
  }
  assert.equal(hoja.getCell('B7').dataValidation, undefined)
  assert.equal(hoja.getCell('A2').dataValidation, undefined)
})

test('text that starts with = is written as plain text, never as a formula', async () => {
  const hoja = (await releer(await escritor.escribir(LIBRO))).getWorksheet('Datos')
  assert.equal(hoja.getCell('D3').value, '=HYPERLINK("http://example.com","Ver")')
  assert.equal(hoja.getCell('D3').formula, undefined)
  assert.equal(hoja.getCell('D2').alignment.wrapText, true)
})

test('the blob is an .xlsx', async () => {
  const blob = await escritor.escribir(LIBRO)
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
})
