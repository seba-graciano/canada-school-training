import test from 'node:test'
import assert from 'node:assert/strict'
import { formatearFecha, normalizarCurso, normalizarDni, normalizarNivel, textoCelda } from './celdas.ts'

const CATALOGO = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Secundario', curso: `${n}º Secundaria` })),
]

test('textoCelda trims and collapses extra spaces; numbers and dates become text', () => {
  assert.equal(textoCelda('  Martín  '), 'Martín')
  assert.equal(textoCelda(' María   José '), 'María José')
  assert.equal(textoCelda(41222333), '41222333')
  assert.equal(textoCelda(new Date(Date.UTC(2026, 2, 1))), '01/03/2026')
  assert.equal(textoCelda(null), '')
})

test('formatearFecha renders the Excel date as dd/mm/yyyy', () => {
  assert.equal(formatearFecha(new Date(Date.UTC(2026, 2, 1))), '01/03/2026')
  assert.equal(formatearFecha(new Date(Date.UTC(2027, 11, 31))), '31/12/2027')
})

test('normalizarDni removes dots and spaces and requires 7 or 8 digits', () => {
  assert.equal(normalizarDni('40.123.456'), '40123456')
  assert.equal(normalizarDni(' 30 111 222 '), '30111222')
  assert.equal(normalizarDni(41222333), '41222333')
  assert.equal(normalizarDni('1234567'), '1234567')
  assert.equal(normalizarDni('1234'), null)
  assert.equal(normalizarDni('abc'), null)
  assert.equal(normalizarDni('40-123-456'), null)
  assert.equal(normalizarDni('123456789'), null)
  assert.equal(normalizarDni(null), null)
})

test('normalizarNivel ignores case, accents and surrounding spaces', () => {
  assert.equal(normalizarNivel('primario', CATALOGO), 'Primario')
  assert.equal(normalizarNivel(' SECUNDARIO ', CATALOGO), 'Secundario')
  assert.equal(normalizarNivel('Inicíal', CATALOGO), 'Inicial')
  assert.equal(normalizarNivel('Terciario', CATALOGO), null)
  assert.equal(normalizarNivel('', CATALOGO), null)
})

test('normalizarCurso accepts reasonable variants and stores the official form (R-03)', () => {
  for (const variante of ['3º Primaria', '3o primaria', '3 PRIMARIA', '3° Primaria', ' 3º  primaria ']) {
    assert.equal(normalizarCurso(variante, 'Primario', CATALOGO), '3º Primaria', variante)
  }
  assert.equal(normalizarCurso('3o Secundaria', 'Secundario', CATALOGO), '3º Secundaria')
  assert.equal(normalizarCurso('inicial', 'Inicial', CATALOGO), 'Inicial')
})

test('normalizarCurso rejects a course that does not belong to the level', () => {
  assert.equal(normalizarCurso('4º Secundaria', 'Primario', CATALOGO), null)
  assert.equal(normalizarCurso('7º Primaria', 'Primario', CATALOGO), null)
  assert.equal(normalizarCurso('1º Terciario', 'Primario', CATALOGO), null)
  assert.equal(normalizarCurso('Inicial', 'Primario', CATALOGO), null)
})
