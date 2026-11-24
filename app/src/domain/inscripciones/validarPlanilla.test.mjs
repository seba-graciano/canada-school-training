import test from 'node:test'
import assert from 'node:assert/strict'
import { COLUMNAS, filasImportables, validarPlanilla } from './validarPlanilla.ts'

const CATALOGO = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Secundario', curso: `${n}º Secundaria` })),
]

// inscripciones-2027-ejemplo.xlsx, cell by cell, with the cell types the file holds:
// row 24 is absent from the sheet, row 27 holds an Excel date, row 28 holds numeric DNIs.
const EJEMPLO = [
  [2, '45111222', 'Sofía', 'Gómez', 'Primario', '3º Primaria', 185000, '23456789', 'Carlos', 'Gómez', 'cgomez@gmail.com', '+54 9 11 5555-1234'],
  [3, '47222333', 'Tomás', 'Gómez', 'Secundario', '1º Secundaria', 210000, '23456789', 'Carlos', 'Gómez', 'cgomez@gmail.com', '+54 9 11 5555-1234'],
  [4, '52333444', 'Lucía', 'Gómez', 'Inicial', 'Inicial', 150000, '23456789', 'Carlos', 'Gómez', 'cgomez@gmail.com', '+54 9 11 5555-1234'],
  [5, '40.123.456', 'Mateo', 'Fernández', 'Secundario', '5º Secundaria', 210000, '28111333', 'Ana', 'Ruiz', 'ana.ruiz@hotmail.com', '11 4444-5555'],
  [6, '46555666', 'Valentina', 'López', 'primario', '2° Primaria', 185000, '29222444', 'Diego', 'López', 'dlopez@yahoo.com.ar', ''],
  [7, '44666777', 'Benjamín', 'Torres', ' SECUNDARIO ', '3o Secundaria', 210000, '30333555', 'Paula', 'Torres', 'ptorres@gmail.com', ''],
  [8, '45777888', 'Martina', 'Sosa', 'Primario', '6º Primaria', '185.000,50', '31444666', 'Jorge', 'Sosa', 'jsosa@gmail.com', ''],
  [9, '46888999', 'Simón', 'Díaz', 'Primario', '4º Primaria', 185000.555, '32555777', 'Elena', 'Díaz', 'ediaz@gmail.com', ''],
  [10, '47999000', 'Emma', 'Romero', 'Primario', '1º Primaria', 0, '33666888', 'Raúl', 'Romero', 'rromero@gmail.com', ''],
  [11, '48000111', 'Thiago', 'Álvarez', 'Secundario', '2º Secundaria', '-150000', '34777999', 'Silvia', 'Álvarez', 'salvarez@gmail.com', ''],
  [12, '', 'Isabella', 'Ruiz', 'Primario', '5º Primaria', 185000, '35888000', 'Hugo', 'Ruiz', 'hruiz@gmail.com', ''],
  [13, '1234', 'Santino', 'Medina', 'Primario', '2º Primaria', 185000, '36999111', 'Clara', 'Medina', 'cmedina@gmail.com', ''],
  [14, '43123123', 'Catalina', 'Herrera', 'Secundario', '4º Secundaria', 210000, '37000222', 'Pablo', 'Herrera', 'pherrera@gmail.com', ''],
  [15, '43123123', 'Catalina', 'Herrera', 'Secundario', '4º Secundaria', 210000, '37000222', 'Pablo', 'Herrera', 'pherrera@gmail.com', ''],
  [16, '49111222', 'Felipe', 'Castro', 'Terciario', '1º Terciario', 230000, '38111333', 'Mónica', 'Castro', 'mcastro@gmail.com', ''],
  [17, '49222333', 'Olivia', 'Ortiz', 'Primario', '4º Secundaria', 185000, '39222444', 'Andrés', 'Ortiz', 'aortiz@gmail.com', ''],
  [18, '49333444', '', 'Molina', 'Primario', '3º Primaria', 185000, '40333555', 'Lorena', 'Molina', 'lmolina@gmail.com', ''],
  [19, '49444555', 'Bautista', 'Silva', 'Primario', '3º Primaria', 185000, '41444666', 'Gustavo', 'Silva', 'gsilva@gmail', ''],
  [20, '49555666', 'Mía', 'Rojas', 'Inicial', 'Inicial', 150000, '42555777', 'Natalia', 'Rojas', '', '11 3333-2222'],
  [21, '49666777', 'Lautaro', 'Pérez', 'Primario', '1º Primaria', 185000, '30111222', 'Laura', 'Pérez', 'lperez@gmail.com', ''],
  [22, '49777888', 'Julieta', 'Pérez', 'Primario', '5º Primaria', 185000, '30111222', 'Laura', 'Peres', 'lperez@gmail.com', ''],
  [23, '49888999', 'Nicolás', 'Vega', 'Secundario', '6º Secundaria', 210000, '', 'Gabriela', 'Vega', 'gvega@gmail.com', ''],
  [24, null, null, null, null, null, null, null, null, null, null, null],
  [25, '50111222', 'Agustina', 'Navarro', 'Primario', '2º Primaria', 185000, '43666888', '=HYPERLINK("http://example.com","Ver")', 'Navarro', 'nav@gmail.com', ''],
  [26, 'abc', 'Bruno', 'Ramos', '', '', 'mucho', '44777999', 'Irene', 'Ramos', 'iramos@gmail.com', ''],
  [27, '50222333', 'Renata', 'Acosta', 'Primario', '3º Primaria', new Date(Date.UTC(2026, 2, 1)), '45888000', 'Fernando', 'Acosta', 'facosta@gmail.com', ''],
  [28, 41222333, 'Lorenzo', 'Benítez', 'Secundario', '1º Secundaria', 210000, 46999111, 'Marcela', 'Benítez', 'mbenitez@gmail.com', ''],
  [29, '50333444', 'Alma', 'Quiroga', 'Primario', '4º Primaria', 185000, '47000222', '  Martín  ', ' Quiroga', 'MQuiroga@Gmail.com ', ''],
  [30, '50444555', 'Ian', 'Giménez', 'Primario', '6º Primaria', 185000, '48111333', 'Sergio', 'Giménez', 'sgimenez@gmail.com', ''],
  [31, '50555666', 'Zoe', 'Giménez', 'Inicial', 'Inicial', 150000, '48111333', 'Sergio', 'Giménez', 'sgimenez@gmail.com', ''],
].map(([fila, ...valores]) => ({ fila, celdas: Object.fromEntries(COLUMNAS.map((columna, i) => [columna, valores[i]])) }))

// FUN-2026-0147 section 10, verbatim.
const ESPERADO = {
  2: ['valida'], 3: ['valida'], 4: ['valida'], 5: ['valida'], 6: ['valida'], 7: ['valida'], 8: ['valida'],
  9: ['conError', 'E10: El arancel "185000.555" tiene más de dos decimales.'],
  10: ['conError', 'E09: El arancel "0" no es válido: debe ser un número mayor a cero.'],
  11: ['conError', 'E09: El arancel "-150000" no es válido: debe ser un número mayor a cero.'],
  12: ['conError', 'E01: Falta el DNI del alumno.'],
  13: ['conError', 'E02: El DNI del alumno "1234" no es válido: debe tener 7 u 8 dígitos.'],
  14: ['conError', 'E11: El DNI 43123123 está repetido en las filas 14, 15.'],
  15: ['conError', 'E11: El DNI 43123123 está repetido en las filas 14, 15.'],
  16: ['conError', 'E06: El nivel "Terciario" no existe. Valores posibles: Inicial, Primario, Secundario.'],
  17: ['conError', 'E08: El curso "4º Secundaria" no corresponde al nivel Primario.'],
  18: ['conError', 'E03: Falta el nombre del alumno.'],
  19: ['conError', 'E16: El email "gsilva@gmail" no es válido.'],
  20: ['validaConAviso', 'A01: El tutor no tiene email: no va a poder recibir avisos por correo.'],
  21: ['conError', 'E15: El tutor con DNI 30111222 tiene datos distintos en las filas 21, 22.'],
  22: ['conError', 'E15: El tutor con DNI 30111222 tiene datos distintos en las filas 21, 22.'],
  23: ['conError', 'E12: Falta el DNI del tutor.'],
  24: ['ignorada'],
  25: ['conError', 'E17: El campo Nombre tutor no puede empezar con =, +, - o @.'],
  26: ['conError', 'E02: El DNI del alumno "abc" no es válido: debe tener 7 u 8 dígitos.', 'E05: Falta el nivel.',
    'E07: Falta el curso.', 'E09: El arancel "mucho" no es válido: debe ser un número mayor a cero.'],
  27: ['conError', 'E09: El arancel "01/03/2026" no es válido: debe ser un número mayor a cero.'],
  28: ['valida'], 29: ['valida'], 30: ['valida'], 31: ['valida'],
}

test('the client example produces exactly the FUN section 10 preview, row by row', () => {
  const { filas } = validarPlanilla(EJEMPLO, CATALOGO)
  const observado = Object.fromEntries(filas.map(r =>
    [r.fila, [r.estado, ...[...r.errores, ...r.avisos].map(m => `${m.codigo}: ${m.mensaje}`)]]))
  assert.deepEqual(observado, Object.fromEntries(Object.entries(ESPERADO).map(([k, v]) => [Number(k), v])))
})

test('the client example summary is 11 valid, 1 with warning, 17 with errors, 1 ignored, 30 total', () => {
  assert.deepEqual(validarPlanilla(EJEMPLO, CATALOGO).resumen,
    { validas: 11, validasConAviso: 1, conError: 17, ignoradas: 1, total: 30 })
})

test('importable rows are normalized into the RPC contract, siblings under one guardian', () => {
  const filas = filasImportables(validarPlanilla(EJEMPLO, CATALOGO))
  assert.deepEqual(filas.map(f => f.fila), [2, 3, 4, 5, 6, 7, 8, 20, 28, 29, 30, 31])
  assert.deepEqual(filas[0], { fila: 2,
    alumno: { dni: '45111222', nombre: 'Sofía', apellido: 'Gómez', nivel: 'Primario', curso: '3º Primaria', arancelCentavos: 18500000 },
    tutor: { dni: '23456789', nombre: 'Carlos', apellido: 'Gómez', email: 'cgomez@gmail.com', telefono: '+54 9 11 5555-1234' } })
  assert.deepEqual(filas.slice(0, 3).map(f => f.tutor.dni), ['23456789', '23456789', '23456789'])
  assert.equal(filas[3].alumno.dni, '40123456')
  assert.deepEqual([filas[4].alumno.nivel, filas[4].alumno.curso], ['Primario', '2º Primaria'])
  assert.deepEqual([filas[5].alumno.nivel, filas[5].alumno.curso], ['Secundario', '3º Secundaria'])
  assert.equal(filas[6].alumno.arancelCentavos, 18500050)
  assert.deepEqual(filas[7].tutor, { dni: '42555777', nombre: 'Natalia', apellido: 'Rojas', email: null, telefono: '11 3333-2222' })
  assert.deepEqual([filas[8].alumno.dni, filas[8].tutor.dni], ['41222333', '46999111'])
  assert.deepEqual(filas[9].tutor, { dni: '47000222', nombre: 'Martín', apellido: 'Quiroga', email: 'mquiroga@gmail.com', telefono: null })
})

test('a row can carry an error and the A01 warning; errors are listed by code', () => {
  const fila = { fila: 2, celdas: { 'DNI alumno': '1', 'Nombre alumno': '@x', 'Apellido alumno': 'Y', Nivel: 'Inicial',
    Curso: 'Inicial', 'Arancel mensual': 1, 'DNI tutor': '30111222', 'Nombre tutor': 'A', 'Apellido tutor': 'B' } }
  const [resultado] = validarPlanilla([fila], CATALOGO).filas
  assert.equal(resultado.estado, 'conError')
  assert.deepEqual(resultado.errores.map(m => m.codigo), ['E02', 'E17'])
  assert.deepEqual(resultado.avisos.map(m => m.codigo), ['A01'])
  assert.equal(resultado.importable, null)
})

test('E11 lists every repeated row and E14 needs both guardian names', () => {
  const base = { 'Nombre alumno': 'A', 'Apellido alumno': 'B', Nivel: 'Inicial', Curso: 'Inicial', 'Arancel mensual': 1,
    'DNI tutor': '30111222', 'Nombre tutor': 'T', 'Apellido tutor': 'U', 'Email tutor': 't@u.com' }
  const filas = [2, 5, 9].map(n => ({ fila: n, celdas: { ...base, 'DNI alumno': '40.111.222' } }))
  filas.push({ fila: 10, celdas: { ...base, 'DNI alumno': '40111223', 'Apellido tutor': ' ' } })
  const resultado = validarPlanilla(filas, CATALOGO).filas
  // Row 10 has no guardian surname, so that DNI also carries different data in every row (E15).
  assert.deepEqual(resultado[0].errores, [
    { codigo: 'E11', mensaje: 'El DNI 40111222 está repetido en las filas 2, 5, 9.' },
    { codigo: 'E15', mensaje: 'El tutor con DNI 30111222 tiene datos distintos en las filas 2, 5, 9, 10.' },
  ])
  assert.deepEqual(resultado[3].errores.map(m => m.codigo), ['E14', 'E15'])
})

const hermano = (n, dni, tutorExtra = {}) => ({ fila: n, celdas: { 'DNI alumno': dni, 'Nombre alumno': 'A', 'Apellido alumno': 'B',
  Nivel: 'Inicial', Curso: 'Inicial', 'Arancel mensual': 1, 'DNI tutor': '23456789', 'Nombre tutor': 'Martín',
  'Apellido tutor': 'Gómez', 'Email tutor': 'm@g.com', ...tutorExtra } })

test('guardian names that differ only in case are the same data and the capitalized form is used (client P4)', () => {
  const resultado = validarPlanilla([hermano(2, '40111222', { 'Nombre tutor': 'martín', 'Apellido tutor': 'gómez' }), hermano(3, '40111223')], CATALOGO)
  assert.deepEqual(resultado.resumen.conError, 0)
  assert.deepEqual(filasImportables(resultado).map(f => [f.tutor.nombre, f.tutor.apellido]), [['Martín', 'Gómez'], ['Martín', 'Gómez']])
})

test('a guardian email on one sibling row is used for every row and removes the A01 warning (client P5)', () => {
  const resultado = validarPlanilla([hermano(2, '40111222', { 'Email tutor': '' }), hermano(3, '40111223')], CATALOGO)
  assert.deepEqual(resultado.filas.map(f => f.estado), ['valida', 'valida'])
  assert.deepEqual(filasImportables(resultado).map(f => f.tutor.email), ['m@g.com', 'm@g.com'])
})

test('two different non-blank emails for one guardian are still E15', () => {
  const resultado = validarPlanilla([hermano(2, '40111222', { 'Email tutor': 'otro@g.com' }), hermano(3, '40111223')], CATALOGO)
  assert.deepEqual(resultado.filas.map(f => f.errores.map(e => e.codigo)), [['E15'], ['E15']])
})
