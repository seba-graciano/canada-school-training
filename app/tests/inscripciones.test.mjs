import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import ExcelJS from 'exceljs'

// FUN-2026-0147 section 10, end to end in a real browser. Supabase is replaced by an in-memory fake
// that follows docs/inscripciones-contrato.md; the database side is covered by supabase/tests.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const appRoot = fileURLToPath(new URL('../', import.meta.url))
const FIXTURE = new URL('./fixtures/inscripciones-2027-ejemplo.xlsx', import.meta.url)
const sessionKey = 'sb-audit-auth-token'
const CURSOS = [
  { nivel: 'Inicial', curso: 'Inicial' },
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Primario', curso: `${n}º Primaria` })),
  ...[1, 2, 3, 4, 5, 6].map(n => ({ nivel: 'Secundario', curso: `${n}º Secundaria` })),
]
let browser, server, origin, cacheDir

before(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), 'canada-inscripciones-ui-'))
  server = await createServer({
    root: appRoot, cacheDir: path.join(cacheDir, 'node_modules', '.vite'),
    css: { postcss: { plugins: [] } },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://audit.example.invalid'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fake-public-key'),
    },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' })
})

after(async () => {
  await browser?.close()
  await server?.close()
  if (cacheDir && path.dirname(cacheDir) === tmpdir() && path.basename(cacheDir).startsWith('canada-inscripciones-ui-')) {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

// In-memory importar_inscripciones: CREAR/ACTUALIZAR by DNI, previous import by hash.
function fakeBackend() {
  const state = { alumnos: new Map(), tutores: new Set(), importaciones: [], calls: [] }
  state.importar = ({ p_payload: payload, p_solo_simular: simular }) => {
    state.calls.push({ simular, filas: payload.filas.length })
    const previa = state.importaciones.findLast(i => i.hash === payload.hashArchivo) ?? null
    const tutoresVistos = new Map()
    const resumen = { alumnosCreados: 0, alumnosActualizados: 0, tutoresCreados: 0, tutoresActualizados: 0 }
    const filas = payload.filas.map(fila => {
      if (!tutoresVistos.has(fila.tutor.dni)) {
        const accion = state.tutores.has(fila.tutor.dni) ? 'ACTUALIZAR' : 'CREAR'
        tutoresVistos.set(fila.tutor.dni, accion)
        resumen[accion === 'CREAR' ? 'tutoresCreados' : 'tutoresActualizados']++
      }
      const alumno = state.alumnos.has(fila.alumno.dni) ? 'ACTUALIZAR' : 'CREAR'
      resumen[alumno === 'CREAR' ? 'alumnosCreados' : 'alumnosActualizados']++
      return { fila: fila.fila, alumno, tutor: tutoresVistos.get(fila.tutor.dni) }
    })
    if (!simular) {
      for (const fila of payload.filas) { state.alumnos.set(fila.alumno.dni, fila.tutor.dni); state.tutores.add(fila.tutor.dni) }
      state.importaciones.push({ hash: payload.hashArchivo, fecha: '2026-11-24T18:04:00Z', usuario: 'admin@example.invalid' })
    }
    return { success: true, code: simular ? 'SIMULADO' : 'IMPORTADO', importacionPrevia: previa && { fecha: previa.fecha, usuario: previa.usuario },
      filas, errores: [], resumen }
  }
  return state
}

async function open(t, { role = 'admin', backend = fakeBackend() } = {}) {
  const context = await browser.newContext({ acceptDownloads: true })
  t.after(() => context.close())
  await context.addInitScript(({ key, role }) => {
    const payload = btoa(JSON.stringify({ user_role: role, tutor_id: 7 })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    localStorage.setItem(key, JSON.stringify({
      access_token: `header.${payload}.signature`, refresh_token: 'fake-refresh', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
      user: { id: 'fake-admin', email: 'admin@example.invalid', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
    }))
  }, { key: sessionKey, role })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.origin !== 'https://audit.example.invalid') throw new Error(`Unexpected external request: ${url.origin}`)
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'access-control-expose-headers': 'content-range' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, headers: { ...headers, ...extra }, body: JSON.stringify(body) })
    if (url.pathname === '/rest/v1/rpc/dashboard_alumnos' || url.pathname === '/rest/v1/tutores') return json([], 200, { 'content-range': '*/0' })
    if (url.pathname === '/rest/v1/cursos') return json(CURSOS)
    if (url.pathname === '/rest/v1/rpc/importar_inscripciones') return json(backend.importar(route.request().postDataJSON()))
    return json({})
  })
  const page = await context.newPage()
  await page.goto(origin)
  return { page, backend }
}

async function subir(page, buffer, nombre = 'inscripciones-2027.xlsx') {
  await page.locator('input[type=file]').setInputFiles({ name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  await page.getByRole('heading', { name: 'Vista previa' }).waitFor()
}

async function resumen(page) {
  return page.locator('.inscripciones-tarjeta').evaluateAll(cards =>
    Object.fromEntries(cards.map(card => [card.querySelector('dt').textContent, Number(card.querySelector('dd').textContent)])))
}

async function corregido() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await readFile(FIXTURE))
  const hoja = workbook.getWorksheet('Inscripciones')
  const fixes = { 9: { F: 185000.55 }, 10: { F: 185000 }, 11: { F: 150000 }, 12: { A: '49999001' }, 13: { A: '41234567' },
    15: { A: '43123124' }, 16: { D: 'Secundario', E: '1º Secundaria' }, 17: { E: '4º Primaria' }, 18: { B: 'Lola' },
    19: { J: 'gsilva@gmail.com' }, 22: { I: 'Pérez' }, 23: { G: '49888000' }, 25: { H: 'Diego' },
    26: { A: '50000026', D: 'Primario', E: '1º Primaria', F: 185000 }, 27: { F: 185000 } }
  for (const [fila, cambios] of Object.entries(fixes)) {
    for (const [columna, valor] of Object.entries(cambios)) hoja.getCell(`${columna}${fila}`).value = valor
  }
  // Row 27 keeps a date format: a number typed there is still a date (E09) until the format is cleared.
  hoja.getCell('F27').numFmt = 'General'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test('FUN section 10: preview, error report, corrected import, re-import and roll counts', { timeout: 120000 }, async t => {
  const { page, backend } = await open(t)
  await page.getByRole('button', { name: 'Inscripciones', exact: true }).click()
  await page.getByRole('heading', { name: 'Inscripciones 2027' }).waitFor()

  // 1. The client file: the preview matches the FUN table and Confirm is disabled.
  await subir(page, await readFile(FIXTURE))
  assert.deepEqual(await resumen(page), { Válidas: 11, 'Válidas con aviso': 1, 'Con error': 17, Ignoradas: 1, Total: 30 })
  assert.equal(await page.getByRole('button', { name: 'Confirmar importación' }).isDisabled(), true)
  await page.getByText('E10: El arancel "185000.555" tiene más de dos decimales.').waitFor()
  await page.getByText('A01: El tutor no tiene email: no va a poder recibir avisos por correo.').waitFor()
  await page.getByLabel('Solo filas con error').check()
  assert.equal(await page.locator('.inscripciones-tabla tbody tr').count(), 17)

  // 2. The error report has 17 rows with "Fila original" and "Errores" first.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar reporte de errores' }).click()])
  assert.equal(download.suggestedFilename(), 'errores-inscripciones-2027.xlsx')
  const reporte = new ExcelJS.Workbook()
  await reporte.xlsx.readFile(await download.path())
  const hoja = reporte.getWorksheet('Inscripciones')
  assert.equal(hoja.actualRowCount - 1, 17)
  assert.deepEqual(hoja.getRow(1).values.slice(1, 4), ['Fila original', 'Errores', 'DNI alumno'])

  // 3. The corrected file has no errors and can be confirmed.
  const archivo = await corregido()
  await page.getByRole('button', { name: 'Subir otra planilla' }).click()
  await subir(page, archivo)
  assert.deepEqual(await resumen(page), { Válidas: 28, 'Válidas con aviso': 1, 'Con error': 0, Ignoradas: 1, Total: 30 })
  await page.getByRole('button', { name: 'Confirmar importación' }).click()

  // 4. The result reports what was created; the three Gómez siblings share one guardian.
  await page.getByText(/Importación confirmada: 29 alumnos creados y 0 actualizados; 24 tutores creados y 0 actualizados\./).waitFor()
  assert.deepEqual(['45111222', '47222333', '52333444'].map(dni => backend.alumnos.get(dni)), ['23456789', '23456789', '23456789'])

  // 5. Uploading the same corrected file shows the R-09 notice and confirming creates nothing.
  await page.getByRole('button', { name: 'Subir otra planilla' }).click()
  await subir(page, archivo)
  await page.getByText('Este archivo ya fue importado el 24/11/2026 15:04 por admin@example.invalid. Si lo confirmás de nuevo no se va a duplicar nada.').waitFor()
  await page.getByRole('button', { name: 'Confirmar importación' }).click()
  await page.getByText(/Importación confirmada: 0 alumnos creados y 29 actualizados; 0 tutores creados y 24 actualizados\./).waitFor()
  assert.equal(backend.alumnos.size, 29)
  assert.deepEqual(backend.calls.map(c => c.simular), [true, true, false, true, false])
})

test('the template downloads with both sheets and drop-downs for Nivel and Curso', { timeout: 60000 }, async t => {
  const { page } = await open(t, { role: 'secretaria' })
  await page.getByRole('button', { name: 'Inscripciones', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar plantilla' }).click()])
  assert.equal(download.suggestedFilename(), 'plantilla-inscripciones-2027.xlsx')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(await download.path())
  assert.deepEqual(libro.worksheets.map(h => h.name), ['Inscripciones', 'Instrucciones'])
  assert.equal(libro.getWorksheet('Inscripciones').getCell('D2').dataValidation.formulae[0], '"Inicial,Primario,Secundario"')
  assert.match(libro.getWorksheet('Inscripciones').getCell('E2').dataValidation.formulae[0], /3º Primaria/)
})

test('file problems reject the whole file with the FUN message', { timeout: 60000 }, async t => {
  const { page, backend } = await open(t)
  await page.getByRole('button', { name: 'Inscripciones', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'inscripciones.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') })
  await page.getByRole('alert').filter({ hasText: 'El archivo debe ser un Excel .xlsx.' }).waitFor()
  assert.equal(backend.calls.length, 0)
})

test('a tutor never sees the Inscripciones option (R-01)', { timeout: 60000 }, async t => {
  const { page } = await open(t, { role: 'tutor' })
  await page.getByRole('heading', { name: 'Mis alumnos' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Inscripciones', exact: true }).count(), 0)
})
