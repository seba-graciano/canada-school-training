import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { ExcelJsLectorPlanilla } from './ExcelJsLectorPlanilla.ts'
import { COLUMNAS, validarPlanilla } from '../../domain/inscripciones/validarPlanilla.ts'

const FIXTURE = new URL('../../../tests/fixtures/inscripciones-2027-ejemplo.xlsx', import.meta.url)
const CATALOGO = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Secundario', curso: `${n}º Secundaria` })),
]
const lector = new ExcelJsLectorPlanilla()
const asArrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

async function libro(hojas) {
  const workbook = new ExcelJS.Workbook()
  for (const [nombre, filas] of Object.entries(hojas)) workbook.addWorksheet(nombre).addRows(filas)
  return asArrayBuffer(Buffer.from(await workbook.xlsx.writeBuffer()))
}

test('reading the client file returns 30 rows with the cell types the file holds', async () => {
  const contenido = await readFile(FIXTURE)
  const lectura = await lector.leer({ nombre: 'inscripciones-2027-ejemplo.xlsx', contenido: asArrayBuffer(contenido) })
  assert.equal(lectura.ok, true)
  assert.equal(lectura.hash, createHash('sha256').update(contenido).digest('hex'))
  assert.deepEqual(lectura.filas.map(f => f.fila), Array.from({ length: 30 }, (_, i) => i + 2))
  const fila = n => lectura.filas.find(f => f.fila === n).celdas
  assert.equal(fila(2)['DNI alumno'], '45111222')
  assert.equal(fila(9)['Arancel mensual'], 185000.555)
  assert.equal(fila(8)['Arancel mensual'], '185.000,50')
  assert.deepEqual(COLUMNAS.map(c => fila(24)[c]), COLUMNAS.map(() => null))
  assert.equal(fila(25)['Nombre tutor'], '=HYPERLINK("http://example.com","Ver")')
  assert.deepEqual(fila(27)['Arancel mensual'], new Date(Date.UTC(2026, 2, 1)))
  assert.equal(fila(28)['DNI alumno'], 41222333)
  assert.equal(fila(29)['Nombre tutor'], '  Martín  ')
})

test('the client file, read and validated, gives the FUN summary 11 / 1 / 17 / 1 / 30', async () => {
  const lectura = await lector.leer({ nombre: 'inscripciones-2027-ejemplo.xlsx', contenido: asArrayBuffer(await readFile(FIXTURE)) })
  assert.deepEqual(validarPlanilla(lectura.filas, CATALOGO).resumen,
    { validas: 11, validasConAviso: 1, conError: 17, ignoradas: 1, total: 30 })
})

test('columns are found by header text, so a reordered sheet still works', async () => {
  const encabezado = [...COLUMNAS].reverse()
  const datos = ['45111222', 'Sofía', 'Gómez', 'Primario', '3º Primaria', 185000, '23456789', 'Carlos', 'Gómez', 'c@g.com', ''].reverse()
  const lectura = await lector.leer({ nombre: 'x.XLSX', contenido: await libro({ Inscripciones: [encabezado, datos] }) })
  assert.equal(lectura.ok, true)
  assert.equal(lectura.filas[0].celdas['DNI alumno'], '45111222')
  assert.equal(lectura.filas[0].celdas['Arancel mensual'], 185000)
})

test('F01: only .xlsx files that really are workbooks', async () => {
  const valido = await libro({ Inscripciones: [COLUMNAS] })
  assert.deepEqual(await lector.leer({ nombre: 'inscripciones.csv', contenido: valido }), { ok: false, codigo: 'F01' })
  assert.deepEqual(await lector.leer({ nombre: 'inscripciones.xls', contenido: valido }), { ok: false, codigo: 'F01' })
  const texto = new TextEncoder().encode('no soy un excel').buffer
  assert.deepEqual(await lector.leer({ nombre: 'trucho.xlsx', contenido: texto }), { ok: false, codigo: 'F01' })
})

test('F02: more than 2 MB or more than 2.000 data rows', async () => {
  assert.deepEqual(await lector.leer({ nombre: 'grande.xlsx', contenido: new ArrayBuffer(2 * 1024 * 1024 + 1) }), { ok: false, codigo: 'F02' })
  const fila = ['45111222', 'A', 'B', 'Inicial', 'Inicial', 1, '23456789', 'C', 'D', '', '']
  const muchas = await libro({ Inscripciones: [COLUMNAS, ...Array.from({ length: 2001 }, () => fila)] })
  assert.deepEqual(await lector.leer({ nombre: 'muchas.xlsx', contenido: muchas }), { ok: false, codigo: 'F02' })
  const justas = await libro({ Inscripciones: [COLUMNAS, ...Array.from({ length: 2000 }, () => fila)] })
  assert.equal((await lector.leer({ nombre: 'justas.xlsx', contenido: justas })).ok, true)
})

test('F03, F04 and F05 reject the whole file', async () => {
  assert.deepEqual(await lector.leer({ nombre: 'a.xlsx', contenido: await libro({ Hoja1: [COLUMNAS] }) }), { ok: false, codigo: 'F03' })
  const sinColumnas = await libro({ Inscripciones: [COLUMNAS.filter(c => c !== 'Nivel' && c !== 'DNI tutor' && c !== 'Email tutor')] })
  assert.deepEqual(await lector.leer({ nombre: 'b.xlsx', contenido: sinColumnas }),
    { ok: false, codigo: 'F04', columnasFaltantes: ['Nivel', 'DNI tutor'] })
  assert.deepEqual(await lector.leer({ nombre: 'c.xlsx', contenido: await libro({ Inscripciones: [COLUMNAS, [], ['  ']] }) }),
    { ok: false, codigo: 'F05' })
})
