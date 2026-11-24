import test from 'node:test'
import assert from 'node:assert/strict'
import { armarPlantilla, armarReporteErrores, NOMBRE_PLANTILLA, nombreReporteErrores } from './libros.ts'
import { COLUMNAS, validarPlanilla } from '../../domain/inscripciones/validarPlanilla.ts'

const CATALOGO = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Secundario', curso: `${n}º Secundaria` })),
]

test('the template has an Inscripciones sheet with the FUN columns and an Instrucciones sheet', () => {
  const libro = armarPlantilla(CATALOGO)
  assert.deepEqual(libro.hojas.map(h => h.nombre), ['Inscripciones', 'Instrucciones'])
  const [inscripciones, instrucciones] = libro.hojas
  assert.deepEqual(inscripciones.columnas.map(c => c.titulo), [...COLUMNAS])
  assert.deepEqual(inscripciones.filas, [])
  assert.equal(inscripciones.filasConListas, 1999)
  assert.deepEqual(instrucciones.columnas.map(c => c.titulo), ['Columna', 'Obligatoria', 'Ejemplo', 'Regla'])
  assert.deepEqual(instrucciones.filas[0], ['DNI alumno', 'Sí', '45111222', '7 u 8 dígitos. Se aceptan puntos y espacios, que se quitan.'])
  assert.deepEqual(instrucciones.filas[10], ['Teléfono tutor', 'No', '+54 9 11 5555-1234', 'Texto libre. Puede empezar con +.'])
})

test('Nivel and Curso get drop-down lists from the courses catalog (R-02); DNIs are text', () => {
  const columnas = Object.fromEntries(armarPlantilla(CATALOGO).hojas[0].columnas.map(c => [c.titulo, c]))
  assert.deepEqual(columnas.Nivel.lista, ['Inicial', 'Primario', 'Secundario'])
  assert.deepEqual(columnas.Curso.lista, CATALOGO.map(c => c.curso))
  assert.equal(columnas['DNI alumno'].formato, 'texto')
  assert.equal(columnas['DNI tutor'].formato, 'texto')
})

test('the instructions list the valid courses of each level', () => {
  const filas = armarPlantilla(CATALOGO).hojas[1].filas
  assert.ok(filas.some(f => f[0] === 'Primario' && f[3] === '1º Primaria, 2º Primaria, 3º Primaria, 4º Primaria, 5º Primaria, 6º Primaria'))
  assert.ok(filas.some(f => f[0] === 'Inicial' && f[3] === 'Inicial'))
})

test('the error report has "Fila original" and "Errores" first and only the rows with errors (FUN section 8)', () => {
  const crudas = [
    { fila: 2, celdas: { 'DNI alumno': '45111222', 'Nombre alumno': 'Sofía', 'Apellido alumno': 'Gómez', Nivel: 'Primario',
      Curso: '3º Primaria', 'Arancel mensual': 185000, 'DNI tutor': '23456789', 'Nombre tutor': 'Carlos', 'Apellido tutor': 'Gómez',
      'Email tutor': 'c@g.com' } },
    { fila: 26, celdas: { 'DNI alumno': 'abc', 'Nombre alumno': 'Bruno', 'Apellido alumno': 'Ramos', Nivel: '', Curso: '',
      'Arancel mensual': 'mucho', 'DNI tutor': 44777999, 'Nombre tutor': 'Irene', 'Apellido tutor': 'Ramos', 'Email tutor': 'i@r.com' } },
    { fila: 27, celdas: { 'DNI alumno': '50222333', 'Nombre alumno': 'Renata', 'Apellido alumno': 'Acosta', Nivel: 'Primario',
      Curso: '3º Primaria', 'Arancel mensual': new Date(Date.UTC(2026, 2, 1)), 'DNI tutor': '45888000', 'Nombre tutor': 'Fernando',
      'Apellido tutor': 'Acosta', 'Email tutor': '', 'Teléfono tutor': null } },
  ]
  const [hoja] = armarReporteErrores(crudas, validarPlanilla(crudas, CATALOGO)).hojas
  assert.equal(hoja.nombre, 'Inscripciones')
  assert.deepEqual(hoja.columnas.map(c => c.titulo), ['Fila original', 'Errores', ...COLUMNAS])
  assert.equal(hoja.filas.length, 2)
  assert.deepEqual(hoja.filas[0], [26,
    'El DNI del alumno "abc" no es válido: debe tener 7 u 8 dígitos.\nFalta el nivel.\nFalta el curso.\nEl arancel "mucho" no es válido: debe ser un número mayor a cero.',
    'abc', 'Bruno', 'Ramos', '', '', 'mucho', 44777999, 'Irene', 'Ramos', 'i@r.com', null])
  assert.equal(hoja.filas[1][7], '01/03/2026')
  // "todos los mensajes de la fila": the A01 warning travels with the errors of that row.
  assert.equal(hoja.filas[1][1],
    'El arancel "01/03/2026" no es válido: debe ser un número mayor a cero.\nEl tutor no tiene email: no va a poder recibir avisos por correo.')
})

test('file names', () => {
  assert.equal(NOMBRE_PLANTILLA, 'plantilla-inscripciones-2027.xlsx')
  assert.equal(nombreReporteErrores('inscripciones 2027.xlsx'), 'errores-inscripciones 2027.xlsx')
})
