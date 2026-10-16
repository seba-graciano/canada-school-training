import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'

// Use an existing Playwright installation; these tests never install dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const appRoot = fileURLToPath(new URL('../', import.meta.url))
const sessionKey = 'sb-audit-auth-token'
let browser, server, origin, cacheDir

before(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), 'canada-audit-ui-'))
  server = await createServer({
    root: appRoot, cacheDir: path.join(cacheDir, 'node_modules', '.vite'),
    css: { postcss: { plugins: [] } },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://audit.example.invalid'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fake-public-key'),
    },
    plugins: [{
      name: 'local-audit-harness',
      configureServer(vite) {
        vite.middlewares.use('/__audit', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__audit',
            '<div id="root"></div><script type="module" src="/tests/frontend-harness.tsx"></script>'))
        })
      },
    }],
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
  if (cacheDir && path.dirname(cacheDir) === tmpdir() && path.basename(cacheDir).startsWith('canada-audit-ui-')) {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

function row(id, nombre, debt = 1000) {
  return { id, nombre, apellido: `Family${id}`, dni: `${id}11`, nivel: 'Primario', curso: '1',
    hermanos: 1, descuento_hermano: 0, arancel_base: 1000, cuotas_saldadas: 0, mora: 0, deuda: debt }
}

async function open(t, { strict = false } = {}) {
  const context = await browser.newContext()
  t.after(() => context.close())
  const requests = [], waiters = [], errors = []
  let logoutStatus = 204, logoutCalls = 0, dashboardCalls = 0
  await context.addInitScript(({ key }) => {
    const payload = btoa(JSON.stringify({ user_role: 'admin', tutor_id: 7 }))
    localStorage.setItem(key, JSON.stringify({
      access_token: `header.${payload}.signature`, refresh_token: 'fake-refresh', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
      user: { id: 'fake-admin', email: 'admin@example.invalid', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
    }))
  }, { key: sessionKey })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.origin !== 'https://audit.example.invalid') throw new Error(`Unexpected external request: ${url.origin}`)
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/rest/v1/rpc/dashboard_alumnos') {
      const index = dashboardCalls++
      const request = {
        async fulfill(data, status = 200) {
          await route.fulfill({ status, headers, body: JSON.stringify(data) })
          await page.waitForFunction(index => window.audit.completed[index], index)
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        },
      }
      if (waiters.length) waiters.shift()(request)
      else requests.push(request)
      return
    }
    if (url.pathname === '/auth/v1/logout') {
      logoutCalls++
      return route.fulfill({ status: logoutStatus, headers,
        ...(logoutStatus === 204 ? {} : { body: JSON.stringify({ message: 'Simulated auth outage' }) }) })
    }
    if (url.pathname === '/rest/v1/tutores') return route.fulfill({ status: 200, headers, body: '[]' })
    throw new Error(`Unexpected mocked endpoint: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${origin}/__audit${strict ? '?strict' : ''}`)
  const next = () => requests.length ? Promise.resolve(requests.shift()) : new Promise(resolve => waiters.push(resolve))
  const refresh = () => page.evaluate(() => window.audit.refresh())
  return { page, next, refresh, errors, failLogout: () => { logoutStatus = 503 },
    allowLogout: () => { logoutStatus = 204 }, logoutCalls: () => logoutCalls }
}

async function initial(t) {
  const harness = await open(t)
  await (await harness.next()).fulfill([row(1, 'Ana'), row(2, 'Beto')])
  await harness.page.getByRole('button', { name: 'Buscar', exact: true }).waitFor()
  return harness
}

test('failed logout reports failure, preserves authentication, and supports a successful retry', { timeout: 20000 }, async t => {
  const h = await initial(t)
  h.failLogout()
  await h.page.getByRole('button', { name: 'Salir', exact: true }).click()
  await h.page.waitForFunction(() => document.querySelector('[role="alert"]') || document.body.textContent.includes('Ingresar'))
  assert.equal(await h.page.getByRole('button', { name: 'Salir', exact: true }).count(), 1)
  assert.match(await h.page.getByRole('alert').innerText(), /No se pudo cerrar la sesión/)
  assert.equal(await h.page.evaluate(key => !!localStorage.getItem(key), sessionKey), true)
  assert.equal(await h.page.evaluate(() => window.audit.context.userRole), 'admin')
  assert.equal(await h.page.evaluate(() => window.audit.context.tutorId), 7)
  await h.page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await h.page.getByRole('button', { name: 'Salir', exact: true }).click()
  await h.page.getByRole('alert').waitFor()
  assert.equal(await h.page.getByRole('heading', { name: 'Crear cuenta', exact: true }).count(), 1)
  h.allowLogout()
  await h.page.getByRole('button', { name: 'Salir', exact: true }).click()
  await h.page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor()
  assert.equal(await h.page.getByRole('textbox').first().inputValue(), '')
  assert.equal(await h.page.evaluate(key => localStorage.getItem(key), sessionKey), null)
  assert.deepEqual(await h.page.evaluate(() => {
    const { user, userRole, tutorId } = window.audit.context
    return { user, userRole, tutorId }
  }), { user: null, userRole: null, tutorId: null })
  assert.equal(h.logoutCalls(), 3)
})

test('refresh preserves the submitted filter while unsubmitted search edits remain unapplied', { timeout: 20000 }, async t => {
  const h = await initial(t)
  const input = h.page.getByPlaceholder('Buscar alumno...')
  await input.fill('111')
  await h.page.getByRole('button', { name: 'Buscar', exact: true }).click()
  assert.equal(await h.page.locator('tbody tr').count(), 1)
  await input.fill('211')
  assert.equal(await h.page.locator('tbody tr').count(), 1)
  await h.refresh()
  await (await h.next()).fulfill([row(1, 'Ana', 0), row(2, 'Beto')])
  await input.waitFor()
  assert.equal(await h.page.locator('tbody tr').count(), 1)
  assert.match(await h.page.locator('tbody').innerText(), /Ana/)
  assert.doesNotMatch(await h.page.locator('tbody').innerText(), /Beto/)
  assert.equal(await input.inputValue(), '211')
  await h.page.getByRole('button', { name: 'Buscar', exact: true }).click()
  assert.match(await h.page.locator('tbody').innerText(), /Beto/)
  await input.fill('')
  await h.page.getByRole('button', { name: 'Buscar', exact: true }).click()
  assert.equal(await h.page.locator('tbody tr').count(), 2)
})

test('an older success cannot overwrite a newer dashboard response', { timeout: 20000 }, async t => {
  const h = await initial(t)
  await h.refresh(); const older = await h.next()
  await h.refresh(); const newer = await h.next()
  await newer.fulfill([row(1, 'Current', 0)])
  await h.page.getByText('Current Family1', { exact: true }).waitFor()
  await older.fulfill([row(1, 'Obsolete', 1000)])
  assert.match(await h.page.locator('tbody').innerText(), /Current/)
  assert.doesNotMatch(await h.page.locator('tbody').innerText(), /Obsolete/)
})

for (const status of [200, 500]) {
  test(`superseded HTTP ${status} cannot finish the newest loading state or report an error`, { timeout: 20000 }, async t => {
    const h = await initial(t)
    await h.refresh(); const older = await h.next()
    await h.refresh(); const newer = await h.next()
    await older.fulfill(status === 200 ? [row(1, 'Obsolete')] : { message: 'obsolete failure' }, status)
    assert.equal(await h.page.getByText('Cargando alumnos...', { exact: true }).count(), 1)
    assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
    await newer.fulfill([row(1, 'Current')])
    await h.page.getByText('Current Family1', { exact: true }).waitFor()
  })
}

test('unmount invalidates outstanding errors and a StrictMode remount still loads', { timeout: 20000 }, async t => {
  const h = await open(t, { strict: true })
  const first = await h.next(), second = await h.next()
  await second.fulfill([row(1, 'Current')])
  await h.page.getByText('Current Family1', { exact: true }).waitFor()
  await first.fulfill({ message: 'strict cleanup failure' }, 500)
  assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
  await h.refresh(); const outstanding = await h.next()
  await h.page.evaluate(() => window.audit.showDashboard(false))
  await outstanding.fulfill({ message: 'unmounted failure' }, 500)
  assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
  await h.page.evaluate(() => window.audit.showDashboard(true))
  const remountFirst = await h.next(), remountSecond = await h.next()
  await remountSecond.fulfill([row(1, 'Remounted')])
  await h.page.getByText('Remounted Family1', { exact: true }).waitFor()
  await remountFirst.fulfill([row(1, 'Obsolete')])
  assert.match(await h.page.locator('tbody').innerText(), /Remounted/)
})
