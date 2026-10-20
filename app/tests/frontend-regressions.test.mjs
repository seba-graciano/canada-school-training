import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

async function open(t, { strict = false, role = 'admin', installments = [], paymentResults = [] } = {}) {
  const context = await browser.newContext()
  t.after(() => context.close())
  const requests = [], waiters = [], errors = []
  let logoutStatus = 204, logoutCalls = 0, dashboardCalls = 0
  const paymentCalls = []
  await context.addInitScript(({ key, role }) => {
    const payload = btoa(JSON.stringify({ user_role: role, tutor_id: 7 }))
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
    if (url.pathname === '/rest/v1/rpc/admin_list_accounts') return route.fulfill({
      status: 200, headers, body: JSON.stringify({ accounts: [], total: 0, page: 1, page_size: 20 }),
    })
    if (url.pathname === '/rest/v1/cuotas') return route.fulfill({ status: 200, headers, body: JSON.stringify(installments) })
    if (url.pathname === '/rest/v1/rpc/cobrar_cuota') {
      const id = route.request().postDataJSON().p_cuota_id
      paymentCalls.push(id)
      const amount = installments.find(item => item.id === id)
      const result = paymentResults.shift() ?? { success: true, monto_pagado: amount.monto + amount.recargo - amount.descuento }
      if (result.success) {
        const installment = installments.find(item => item.id === id)
        installment.estado = 'Pagada'
        installment.pagos = [{ monto_abonado: installment.monto + installment.recargo - installment.descuento }]
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify(result) })
    }
    throw new Error(`Unexpected mocked endpoint: ${url.pathname}`)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${origin}/__audit${strict ? '?strict' : ''}`)
  const next = () => requests.length ? Promise.resolve(requests.shift()) : new Promise(resolve => waiters.push(resolve))
  const refresh = () => page.evaluate(() => window.audit.refresh())
  return { page, next, refresh, errors, paymentCalls, installments, failLogout: () => { logoutStatus = 503 },
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
  await h.page.getByRole('button', { name: 'Cuentas de acceso', exact: true }).click()
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

const installment = (id, mes, paid = false) => ({ id, alumno_id: 1, concepto: 'Cuota escolar', mes, anio: 2026,
  monto: 100000, recargo: 5000, descuento: 10000, estado: paid ? 'Pagada' : 'Pendiente',
  fecha_vencimiento: `2026-${String(mes).padStart(2, '0')}-10`, pagos: paid ? [{ monto_abonado: 95000 }] : [] })

async function paymentScreen(t, options = {}) {
  const h = await open(t, options)
  await (await h.next()).fulfill([row(1, 'Ana')])
  await h.page.getByRole('button', { name: options.role === 'tutor' ? 'Ver ficha' : 'Cobrar', exact: true }).click()
  await h.page.getByRole('heading', { name: options.role === 'tutor' ? 'Ficha del alumno' : 'Registrar cobro', exact: true }).waitFor()
  return h
}

test('single installment collection requires selection and review and prevents repeat submission', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2), installment(3, 3)] })
  const confirm = h.page.getByRole('button', { name: 'Confirmar cobro', exact: true })
  assert.equal(await confirm.isDisabled(), true)
  await h.page.getByRole('checkbox', { name: 'Marzo 2026' }).check()
  assert.equal(await confirm.isDisabled(), true)
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await confirm.evaluate(button => { button.click(); button.click() })
  await h.page.getByRole('status').filter({ hasText: /1 cuota cobrada/ }).waitFor()
  assert.deepEqual(h.paymentCalls, [3])
  assert.equal(h.installments[0].estado, 'Pendiente')
  await (await h.next()).fulfill([row(1, 'Ana')])
})

test('a failed installment preserves earlier successful payments and does not charge later selections', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2), installment(3, 3), installment(4, 4)],
    paymentResults: [{ success: true, monto_pagado: 95000 }, { success: false, code: 'DB_ERROR' }] })
  await h.page.getByRole('button', { name: 'Seleccionar todas las pendientes' }).click()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('alert').filter({ hasText: /solo para las cuotas confirmadas/ }).waitFor()
  assert.match(await h.page.getByRole('status').innerText(), /1 cuota cobrada/)
  assert.deepEqual(h.paymentCalls, [2, 3])
  assert.equal(h.installments[0].estado, 'Pagada')
  assert.equal(h.installments[1].estado, 'Pendiente')
  assert.equal(h.installments[2].estado, 'Pendiente')
  assert.equal(await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).isDisabled(), true)
  assert.equal(await h.page.getByRole('checkbox', { name: 'Marzo 2026' }).isChecked(), false)
  await (await h.next()).fulfill([row(1, 'Ana')])
})

test('changed server amounts require a new review and never submit the stale selection', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2)] })
  await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).check()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  h.installments[0].monto = 200000
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('alert').filter({ hasText: /cambiaron desde la selección/ }).waitFor()
  assert.deepEqual(h.paymentCalls, [])
  assert.equal(h.installments[0].estado, 'Pendiente')
  assert.equal(await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).isChecked(), false)
})

test('partial balances cannot be overcharged and tutors remain read only', { timeout: 20000 }, async t => {
  const partial = { ...installment(2, 2), pagos: [{ monto_abonado: 30000 }] }
  const h = await paymentScreen(t, { installments: [partial] })
  assert.equal(await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).isDisabled(), true)
  assert.match(await h.page.locator('.installments-panel').innerText(), /Pago parcial: requiere revisión/)
  assert.deepEqual(h.paymentCalls, [])
  const tutor = await paymentScreen(t, { role: 'tutor', installments: [installment(2, 2)] })
  assert.equal(await tutor.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).count(), 0)
  assert.equal(await tutor.page.getByRole('button', { name: 'Cuentas de acceso', exact: true }).count(), 0)
  assert.equal(await tutor.page.getByRole('checkbox').count(), 0)
})

test('redesigned screens fit desktop, tablet and mobile with locally resolved assets', { timeout: 30000 }, async t => {
  const h = await initial(t)
  const screenshotDir = process.env.REDESIGN_SCREENSHOTS
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true })
  async function checkScreen(name) {
    for (const width of [390, 768, 1440]) {
      await h.page.setViewportSize({ width, height: 960 })
      await h.page.evaluate(() => document.fonts.ready)
      await h.page.waitForFunction(() => Array.from(document.images)
        .filter(image => image.getClientRects().length > 0)
        .every(image => image.complete && image.naturalWidth > 0))
      assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow at ${width}`)
      const images = await h.page.locator('img:visible').evaluateAll(images => images.map(image => ({ src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0, width: image.width, naturalWidth: image.naturalWidth })))
      assert.equal(images.every(image => image.loaded && image.width === image.naturalWidth), true, `${name}: SVG slot geometry`)
      if (screenshotDir) await h.page.screenshot({ path: path.join(screenshotDir, `${name}-${width}.png`), fullPage: true })
    }
  }
  await checkScreen('students')
  h.installments.push(installment(1, 1, true), installment(2, 2), installment(3, 3), installment(4, 4))
  await h.page.getByRole('button', { name: 'Cobrar', exact: true }).first().click()
  await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).check()
  await checkScreen('collection')
  await h.page.getByRole('button', { name: 'Cuentas de acceso', exact: true }).click()
  await h.page.getByRole('heading', { name: 'Crear cuenta', exact: true }).waitFor()
  await checkScreen('accounts')
  await h.page.getByRole('button', { name: 'Salir', exact: true }).click()
  await h.page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor()
  await checkScreen('login')
})

test('selects nonconsecutive months and charges only those installments', { timeout: 20000 }, async t => {
  const h = await open(t, { installments: [installment(1, 1, true), installment(2, 2), installment(3, 3), installment(4, 4)] })
  await (await h.next()).fulfill([row(1, 'Ana')])
  await h.page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  await h.page.getByRole('heading', { name: 'Registrar cobro', exact: true }).waitFor()
  assert.equal(h.paymentCalls.length, 0)
  assert.equal(await h.page.getByRole('checkbox', { name: /Enero 2026/i }).isDisabled(), true)
  await h.page.getByRole('checkbox', { name: /Febrero 2026/i }).check()
  await h.page.getByRole('checkbox', { name: /Abril 2026/i }).check()
  assert.match(await h.page.getByTestId('collection-total').innerText(), /1\.900,00/)
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('status').filter({ hasText: /2 cuotas cobradas/ }).waitFor()
  assert.deepEqual(h.paymentCalls, [2, 4])
  assert.equal(h.installments[2].estado, 'Pendiente')
  assert.equal(h.installments[0].estado, 'Pagada')
  await (await h.next()).fulfill([row(1, 'Ana', 0)])
})

test('refresh preserves the submitted filter while unsubmitted search edits remain unapplied', { timeout: 20000 }, async t => {
  const h = await initial(t)
  const input = h.page.getByPlaceholder('Apellido, nombre o DNI')
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
  await h.page.locator('tbody').getByText('Current Family1', { exact: true }).waitFor()
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
    assert.equal(await h.page.getByText('Actualizando...', { exact: true }).count(), 1)
    assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
    await newer.fulfill([row(1, 'Current')])
    await h.page.locator('tbody').getByText('Current Family1', { exact: true }).waitFor()
  })
}

test('unmount invalidates outstanding errors and a StrictMode remount still loads', { timeout: 20000 }, async t => {
  const h = await open(t, { strict: true })
  const first = await h.next(), second = await h.next()
  await second.fulfill([row(1, 'Current')])
  await h.page.locator('tbody').getByText('Current Family1', { exact: true }).waitFor()
  await first.fulfill({ message: 'strict cleanup failure' }, 500)
  assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
  await h.refresh(); const outstanding = await h.next()
  await h.page.evaluate(() => window.audit.showDashboard(false))
  await outstanding.fulfill({ message: 'unmounted failure' }, 500)
  assert.equal(h.errors.some(message => message.includes('Error cargando dashboard')), false)
  await h.page.evaluate(() => window.audit.showDashboard(true))
  const remountFirst = await h.next(), remountSecond = await h.next()
  await remountSecond.fulfill([row(1, 'Remounted')])
  await h.page.locator('tbody').getByText('Remounted Family1', { exact: true }).waitFor()
  await remountFirst.fulfill([row(1, 'Obsolete')])
  assert.match(await h.page.locator('tbody').innerText(), /Remounted/)
})

test('freshly paid selected month sends no RPC and preserves server rows', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2), installment(3, 3)] })
  await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).check()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  h.installments[0].estado = 'Pagada'
  h.installments[0].pagos = [{ monto_abonado: 95000 }]
  const before = JSON.stringify(h.installments)
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('alert').filter({ hasText: /cambiaron desde/ }).waitFor()
  assert.deepEqual(h.paymentCalls, [])
  assert.equal(JSON.stringify(h.installments), before)
  assert.equal(await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).isDisabled(), true)
})

test('duplicate RPC response stops later IDs without mutations', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2), installment(3, 3)], paymentResults: [{success:false,code:'ALREADY_PAID'}] })
  const before = JSON.stringify(h.installments)
  await h.page.getByRole('button', { name: 'Seleccionar todas las pendientes' }).click()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('alert').filter({ hasText: /ya fue cobrada/ }).waitFor()
  assert.deepEqual(h.paymentCalls, [2])
  assert.equal(JSON.stringify(h.installments), before)
  assert.equal(await h.page.getByRole('status').count(), 0)
})

test('success reports amount returned by RPC', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2)], paymentResults: [{success:true,monto_pagado:123456}] })
  await h.page.getByRole('checkbox', { name: 'Febrero 2026' }).check()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await h.page.getByRole('status').filter({ hasText: /1 cuota cobrada/ }).waitFor()
  assert.match(await h.page.getByRole('status').innerText(), /1\.234,56/)
  await (await h.next()).fulfill([row(1, 'Ana')])
})

test('unmount during first payment never starts another ID', { timeout: 20000 }, async t => {
  const h = await paymentScreen(t, { installments: [installment(2, 2), installment(3, 3)] })
  let release, signal
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { signal = resolve })
  const calls = []
  await h.page.route('**/rest/v1/rpc/cobrar_cuota', async route => {
    calls.push(route.request().postDataJSON().p_cuota_id)
    signal()
    await held
    h.installments[0].estado = 'Pagada'
    h.installments[0].pagos = [{monto_abonado:95000}]
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({success:true,monto_pagado:95000})})
  })
  await h.page.getByRole('button', { name: 'Seleccionar todas las pendientes' }).click()
  await h.page.getByRole('checkbox', { name: 'Revisé el alumno, las cuotas y el importe.' }).check()
  await h.page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click()
  await started
  await h.page.evaluate(() => window.audit.showDashboard(false))
  await h.page.getByRole('heading', { name:'Registrar cobro', exact:true }).waitFor({state:'detached'})
  release()
  await h.page.waitForFunction(() => window.audit.completed.every(Boolean))
  assert.deepEqual(calls,[2])
  assert.equal(h.installments[1].estado,'Pendiente')
})
