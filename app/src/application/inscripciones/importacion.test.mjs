import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmarImportacion, previsualizarImportacion, ERROR_SIN_PERMISO } from './importacion.ts'

const CATALOGO = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
]
const HASH = 'ab'.repeat(32)
const ARCHIVO = { nombre: 'inscripciones.xlsx', contenido: new ArrayBuffer(8) }
const RESUMEN = { alumnosCreados: 1, alumnosActualizados: 0, tutoresCreados: 1, tutoresActualizados: 0 }
const celdas = (dni, extra = {}) => ({ 'DNI alumno': dni, 'Nombre alumno': 'Sofía', 'Apellido alumno': 'Gómez', Nivel: 'Primario',
  Curso: '3º Primaria', 'Arancel mensual': 185000, 'DNI tutor': '23456789', 'Nombre tutor': 'Carlos', 'Apellido tutor': 'Gómez',
  'Email tutor': 'c@g.com', ...extra })

function deps({ lectura, respuesta, falla } = {}) {
  const llamadas = []
  return {
    llamadas,
    lector: { leer: async () => lectura ?? { ok: true, hash: HASH, filas: [{ fila: 2, celdas: celdas('45111222') }] } },
    repositorio: {
      cursos: async () => CATALOGO,
      importar: async (payload, simular) => {
        llamadas.push({ payload, simular })
        if (falla) throw new Error('No se pudo conectar con el servidor. Intente nuevamente.')
        return respuesta ?? { code: simular ? 'SIMULADO' : 'IMPORTADO', importacionPrevia: null, filas: [{ fila: 2, alumno: 'CREAR', tutor: 'CREAR' }], resumen: RESUMEN }
      },
    },
  }
}

test('a file problem becomes errorArchivo with the exact FUN message', async () => {
  assert.deepEqual(await previsualizarImportacion(ARCHIVO, deps({ lectura: { ok: false, codigo: 'F04', columnasFaltantes: ['Nivel', 'DNI tutor'] } })),
    { tipo: 'errorArchivo', codigo: 'F04', mensaje: 'Faltan columnas obligatorias: Nivel, DNI tutor.' })
  assert.deepEqual(await previsualizarImportacion(ARCHIVO, deps({ lectura: { ok: false, codigo: 'F03' } })),
    { tipo: 'errorArchivo', codigo: 'F03', mensaje: 'No se encontró la hoja "Inscripciones".' })
})

test('the preview simulates the valid rows and can be confirmed when nothing has errors', async () => {
  const d = deps()
  const estado = await previsualizarImportacion(ARCHIVO, d)
  assert.equal(estado.tipo, 'vistaPrevia')
  assert.deepEqual(d.llamadas.map(l => l.simular), [true])
  assert.equal(d.llamadas[0].payload.nombreArchivo, 'inscripciones.xlsx')
  assert.equal(d.llamadas[0].payload.hashArchivo, HASH)
  assert.equal(d.llamadas[0].payload.filas[0].alumno.dni, '45111222')
  assert.equal(estado.vista.puedeConfirmar, true)
  assert.deepEqual(estado.vista.acciones[2], { alumno: 'CREAR', tutor: 'CREAR' })
  assert.deepEqual(estado.vista.simulacion, RESUMEN)
})

test('a row with errors disables confirmation but valid rows are still simulated', async () => {
  const lectura = { ok: true, hash: HASH, filas: [{ fila: 2, celdas: celdas('45111222') }, { fila: 3, celdas: celdas('1234') }] }
  const d = deps({ lectura })
  const estado = await previsualizarImportacion(ARCHIVO, d)
  assert.equal(estado.vista.puedeConfirmar, false)
  assert.deepEqual(estado.vista.resultado.resumen, { validas: 1, validasConAviso: 0, conError: 1, ignoradas: 0, total: 2 })
  assert.deepEqual(d.llamadas[0].payload.filas.map(f => f.fila), [2])
})

test('a previous import of the same file shows the R-09 notice', async () => {
  const respuesta = { code: 'SIMULADO', importacionPrevia: { fecha: '2026-11-24T18:04:00Z', usuario: 'secretaria@canadaschool.edu.ar' },
    filas: [{ fila: 2, alumno: 'ACTUALIZAR', tutor: 'ACTUALIZAR' }], resumen: RESUMEN }
  const estado = await previsualizarImportacion(ARCHIVO, deps({ respuesta }))
  assert.equal(estado.vista.avisoImportacionPrevia,
    'Este archivo ya fue importado el 24/11/2026 15:04 por secretaria@canadaschool.edu.ar. Si lo confirmás de nuevo no se va a duplicar nada.')
})

test('server-side row errors are merged into their rows and block confirmation', async () => {
  const respuesta = { code: 'FILAS_INVALIDAS', importacionPrevia: null, errores: [{ fila: 2, codigo: 'E02', mensaje: 'El DNI del alumno "x" no es válido: debe tener 7 u 8 dígitos.' }] }
  const estado = await previsualizarImportacion(ARCHIVO, deps({ respuesta }))
  assert.equal(estado.vista.puedeConfirmar, false)
  assert.equal(estado.vista.resultado.filas[0].estado, 'conError')
  assert.deepEqual(estado.vista.resultado.filas[0].errores.map(e => e.codigo), ['E02'])
  assert.equal(estado.vista.resultado.resumen.conError, 1)
})

test('permission and connection problems become errorServidor', async () => {
  assert.deepEqual(await previsualizarImportacion(ARCHIVO, deps({ respuesta: { code: 'SIN_PERMISO' } })),
    { tipo: 'errorServidor', mensaje: ERROR_SIN_PERMISO })
  assert.deepEqual(await previsualizarImportacion(ARCHIVO, deps({ falla: true })),
    { tipo: 'errorServidor', mensaje: 'No se pudo conectar con el servidor. Intente nuevamente.' })
})

test('confirming sends the same payload without simulation and reports the result', async () => {
  const d = deps()
  const { vista } = await previsualizarImportacion(ARCHIVO, d)
  assert.deepEqual(await confirmarImportacion(vista, d), { tipo: 'importado', resumen: RESUMEN })
  assert.deepEqual(d.llamadas[1], { payload: d.llamadas[0].payload, simular: false })
})

test('confirming a preview with errors never calls the server', async () => {
  const lectura = { ok: true, hash: HASH, filas: [{ fila: 2, celdas: celdas('1234') }] }
  const d = deps({ lectura })
  const { vista } = await previsualizarImportacion(ARCHIVO, d)
  assert.equal(d.llamadas.length, 0)
  assert.equal((await confirmarImportacion(vista, d)).tipo, 'errorServidor')
  assert.equal(d.llamadas.length, 0)
})
