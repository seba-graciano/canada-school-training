import test from 'node:test'
import assert from 'node:assert/strict'
import { SupabaseInscripcionesRepository, ERROR_CONEXION } from './SupabaseInscripcionesRepository.ts'

const PAYLOAD = { nombreArchivo: 'a.xlsx', hashArchivo: 'ab'.repeat(32), filas: [] }
const RESUMEN = { alumnosCreados: 1, alumnosActualizados: 0, tutoresCreados: 1, tutoresActualizados: 0 }

function cliente({ rpc = async () => ({ data: null, error: null }), cursos = { data: [], error: null } } = {}) {
  const calls = []
  return {
    calls,
    rpc: async (...args) => { calls.push(['rpc', ...args]); return rpc(...args) },
    from: tabla => ({
      select: columnas => ({
        order: async columna => { calls.push(['from', tabla, columnas, columna]); return cursos },
      }),
    }),
  }
}

test('reads the courses catalog from public.cursos in catalog order', async () => {
  const fake = cliente({ cursos: { data: [{ nivel: 'Inicial', curso: 'Inicial' }], error: null } })
  assert.deepEqual(await new SupabaseInscripcionesRepository(fake).cursos(), [{ nivel: 'Inicial', curso: 'Inicial' }])
  assert.deepEqual(fake.calls, [['from', 'cursos', 'nivel,curso', 'orden']])
})

test('calls importar_inscripciones with the payload and the simulation flag', async () => {
  const respuesta = { success: true, code: 'SIMULADO', importacionPrevia: null, filas: [{ fila: 2, alumno: 'CREAR', tutor: 'CREAR' }], errores: [], resumen: RESUMEN }
  const fake = cliente({ rpc: async () => ({ data: respuesta, error: null }) })
  const result = await new SupabaseInscripcionesRepository(fake).importar(PAYLOAD, true)
  assert.deepEqual(fake.calls, [['rpc', 'importar_inscripciones', { p_payload: PAYLOAD, p_solo_simular: true }]])
  assert.deepEqual(result, { code: 'SIMULADO', importacionPrevia: null, filas: respuesta.filas, resumen: RESUMEN })
})

test('passes FILAS_INVALIDAS and SIN_PERMISO through', async () => {
  const errores = [{ fila: 9, codigo: 'E10', mensaje: 'x' }]
  const invalidas = cliente({ rpc: async () => ({ data: { success: false, code: 'FILAS_INVALIDAS', importacionPrevia: { fecha: '2026-11-24T10:00:00Z', usuario: 'a@b.c' }, errores, filas: [], resumen: RESUMEN }, error: null }) })
  assert.deepEqual(await new SupabaseInscripcionesRepository(invalidas).importar(PAYLOAD, false),
    { code: 'FILAS_INVALIDAS', importacionPrevia: { fecha: '2026-11-24T10:00:00Z', usuario: 'a@b.c' }, errores })
  const sinPermiso = cliente({ rpc: async () => ({ data: { success: false, code: 'SIN_PERMISO' }, error: null }) })
  assert.deepEqual(await new SupabaseInscripcionesRepository(sinPermiso).importar(PAYLOAD, false), { code: 'SIN_PERMISO' })
})

test('network errors and malformed answers reject with a safe message', async () => {
  for (const rpc of [
    async () => ({ data: null, error: new Error('private details') }),
    async () => ({ data: { success: true, code: 'SIMULADO', filas: 'x' }, error: null }),
    async () => ({ data: { code: 'OTRO' }, error: null }),
    async () => { throw new Error('offline') },
  ]) {
    await assert.rejects(new SupabaseInscripcionesRepository(cliente({ rpc })).importar(PAYLOAD, true), { message: ERROR_CONEXION })
  }
  await assert.rejects(new SupabaseInscripcionesRepository(cliente({ cursos: { data: null, error: new Error('x') } })).cursos(),
    { message: ERROR_CONEXION })
})
