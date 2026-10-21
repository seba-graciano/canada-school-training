import test, { before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL = 'https://local-fixture.invalid'
process.env.VITE_SUPABASE_ANON_KEY = 'local-fixture-key'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
let server
let browser
let baseUrl
let page

before(async () => {
  server = await createServer({
    root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    plugins: [{
      name: 'account-directory-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__account_directory_fixture', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__account_directory_fixture',
            '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/account-directory-harness.tsx"></script></body></html>'))
        })
      },
    }],
  })
  await server.listen()
  const address = server.httpServer.address()
  baseUrl = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
})

after(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.route('**/functions/v1/**', async route => {
    const url = new URL(route.request().url())
    const name = url.pathname.split('/').at(-1)
    const body = route.request().postDataJSON()
    await page.evaluate(({ name, body }) => {
      window.accountDirectory.functionCalls.push({ name, body })
      if (name === 'delete-account') window.accountDirectory.deleteCalls.push({ name, body })
    }, { name, body })
    const delay = name === 'delete-account' && await page.evaluate(() => window.accountDirectory.delayDelete)
    if (delay) await new Promise(resolve => setTimeout(resolve, 350))
    const error = await page.evaluate(() => window.accountDirectory.deleteError)
    if (name === 'delete-account' && error) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error }) })
      return
    }
    if (name === 'delete-account') {
      await page.evaluate(userId => { window.accountDirectory.accounts = window.accountDirectory.accounts.filter(account => account.id !== userId) }, body.user_id)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  await page.goto(`${baseUrl}/__account_directory_fixture`)
  await page.getByRole('heading', { name: 'Administración de cuentas' }).waitFor()
  await page.getByRole('table', { name: 'Cuentas registradas' }).waitFor()
})

afterEach(async () => page?.close())

test('shows real accounts, email roles, explicit missing values, and hides self deletion', async () => {
  const table = page.getByRole('table', { name: 'Cuentas registradas' })
  await page.getByRole('cell', { name: 'admin@example.com', exact: true }).waitFor()
  await page.getByText('Sin rol asignado').waitFor()
  await page.getByText('Sin correo').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Acciones para admin@example.com' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Acciones para person01@example.com' }).count(), 1)
  const ellipsis = page.locator('img[src="/design/accounts/ellipsis.svg"]').first()
  assert.deepEqual(await ellipsis.evaluate(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })), { complete: true, width: 18, height: 18 })
  assert.equal(await table.getByRole('row').count(), 21)
})

test('searches email and returns pagination to the first page', async () => {
  await page.getByRole('button', { name: 'Página siguiente' }).click()
  await page.getByRole('cell', { name: 'person20@example.com', exact: true }).waitFor()
  const input = page.getByRole('searchbox', { name: 'Buscar por correo electrónico' })
  await input.fill('person03@EXAMPLE.com')
  await page.getByRole('cell', { name: 'person03@example.com', exact: true }).waitFor()
  assert.equal(await page.getByText('Página 1 de 1').count(), 1)
  const calls = await page.evaluate(() => window.accountDirectory.rpcCalls)
  assert.ok(calls.some(call => call.args.p_search === 'person03@EXAMPLE.com' && call.args.p_page === 1))
})

test('ignores an older search response after a newer query completes', async () => {
  await page.evaluate(() => { window.accountDirectory.delaySearch = 'person01' })
  const input = page.getByRole('searchbox', { name: 'Buscar por correo electrónico' })
  await input.fill('person01')
  await page.waitForFunction(() => window.accountDirectory.rpcCalls.some(call => call.args.p_search === 'person01'))
  await input.fill('person03')
  await page.getByRole('cell', { name: 'person03@example.com', exact: true }).waitFor()
  await page.waitForTimeout(400)
  assert.equal(await page.getByRole('cell', { name: 'person03@example.com', exact: true }).count(), 1)
  assert.equal(await page.getByRole('cell', { name: 'person01@example.com', exact: true }).count(), 0)
})

test('canceling confirmation makes no deletion request', async () => {
  const email = 'person01@example.com'
  const before = await page.evaluate(() => window.accountDirectory.accounts)
  await page.getByRole('button', { name: `Acciones para ${email}` }).click()
  await page.getByRole('menuitem', { name: `Eliminar cuenta ${email}` }).click()
  await page.getByRole('alertdialog').getByText(email).waitFor()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.accountDirectory.deleteCalls), [])
  await page.getByRole('cell', { name: email, exact: true }).waitFor()
  await page.getByRole('button', { name: `Acciones para ${email}` }).click()
  await page.getByRole('menuitem', { name: `Eliminar cuenta ${email}` }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.accountDirectory.deleteCalls), [])
  assert.deepEqual(await page.evaluate(() => window.accountDirectory.accounts), before)
})

test('keeps the account and confirmation open after a deletion failure', async () => {
  const email = 'person01@example.com'
  await page.evaluate(() => { window.accountDirectory.deleteError = 'No se puede eliminar la última cuenta administradora.' })
  await page.getByRole('button', { name: `Acciones para ${email}` }).click()
  await page.getByRole('menuitem', { name: `Eliminar cuenta ${email}` }).click()
  await page.getByRole('button', { name: 'Eliminar cuenta' }).last().click()
  await page.getByRole('alert').filter({ hasText: 'No se puede eliminar la última cuenta administradora.' }).waitFor({ timeout: 3000 })
  await page.getByRole('alertdialog').getByText(email).waitFor()
  await page.getByRole('cell', { name: email, exact: true }).waitFor()
})

test('deletes the last page account once and reloads within page bounds', async () => {
  await page.getByRole('button', { name: 'Página siguiente' }).click()
  const email = 'person20@example.com'
  await page.getByRole('cell', { name: email, exact: true }).waitFor()
  await page.getByRole('button', { name: `Acciones para ${email}` }).click()
  await page.getByRole('menuitem', { name: `Eliminar cuenta ${email}` }).click()
  await page.getByRole('button', { name: 'Eliminar cuenta' }).last().click()
  await page.getByText('Página 1 de 1').waitFor()
  assert.equal(await page.getByRole('cell', { name: email, exact: true }).count(), 0)
  const calls = await page.evaluate(() => window.accountDirectory.deleteCalls)
  assert.deepEqual(calls, [{ name: 'delete-account', body: { user_id: 'account-20' } }])
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  assert.ok(dimensions.scroll <= dimensions.client, JSON.stringify(dimensions))
})

test('closes the action menu on Escape and outside click while restoring trigger focus', async () => {
  const trigger = page.getByRole('button', { name: 'Acciones para person01@example.com' })
  await trigger.click()
  const action = page.getByRole('menuitem', { name: 'Eliminar cuenta person01@example.com' })
  await action.waitFor()
  assert.equal(await action.evaluate(element => element === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true)
  await trigger.click()
  await page.getByRole('heading', { name: 'Crear cuenta' }).click()
  assert.equal(await page.getByRole('menu').count(), 0)
})

test('clicking an open action trigger toggles its menu closed', async () => {
  const trigger = page.getByRole('button', { name: 'Acciones para person01@example.com' })
  await trigger.click()
  await page.getByRole('menu').waitFor()
  await trigger.click()
  assert.equal(await page.getByRole('menu').count(), 0)
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
})

test('prevents duplicate deletion calls while the confirmation request is pending', async () => {
  await page.evaluate(() => { window.accountDirectory.delayDelete = true })
  const email = 'person01@example.com'
  await page.getByRole('button', { name: `Acciones para ${email}` }).click()
  await page.getByRole('menuitem', { name: `Eliminar cuenta ${email}` }).click()
  const confirm = page.getByRole('button', { name: 'Eliminar cuenta' }).last()
  await confirm.click()
  await page.getByRole('button', { name: 'Eliminando...' }).waitFor()
  assert.notEqual(await page.locator('.account-app-background').getAttribute('inert'), null)
  await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('alertdialog').evaluate(dialog => dialog.contains(document.activeElement)), true)
  await page.locator('.account-delete-confirm').evaluate(button => button.click())
  await page.getByRole('status').filter({ hasText: 'Se eliminó la cuenta' }).waitFor()
  assert.equal(await page.evaluate(() => window.accountDirectory.deleteCalls.length), 1)
})

test('clears account authorization when an auth session has no role claim', async () => {
  await page.evaluate(() => window.accountDirectory.authHandler?.('SIGNED_IN', {
    access_token: `e30.${btoa(JSON.stringify({})).replace(/=/g, '')}.signature`,
    user: { id: 'roleless-user', email: 'roleless@example.com' },
  }))
  await page.getByRole('alert').getByText('No tiene permiso para crear cuentas.').waitFor()
})

test('keeps the requested screen within common viewport widths', async () => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      table: document.querySelector('.account-directory-table')?.getBoundingClientRect().width ?? 0,
      panel: document.querySelector('.account-roles')?.getBoundingClientRect().width ?? 0,
      tableLayout: getComputedStyle(document.querySelector('.account-directory-table')).tableLayout,
    }))
    assert.equal(geometry.tableLayout, 'fixed', 'account fixture must load the actual screen stylesheet')
    assert.ok(geometry.page <= geometry.viewport, `${width}px: ${JSON.stringify(geometry)}`)
    assert.ok(geometry.table <= geometry.panel, `${width}px: ${JSON.stringify(geometry)}`)
  }
})

test('reloads the real directory after creating a tutor and preserves the callback', async () => {
  const before = await page.evaluate(() => window.accountDirectory.rpcCalls.length)
  await page.getByLabel('Nombre', { exact: true }).fill('Marina')
  await page.getByLabel('Apellido', { exact: true }).fill('Pérez')
  await page.getByLabel('Correo electrónico', { exact: true }).fill('marina@example.com')
  await page.getByLabel('DNI', { exact: true }).fill('12345678')
  await page.getByLabel('Contraseña inicial').fill('long-secure-password')
  await page.getByLabel('Confirmar contraseña').fill('long-secure-password')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.getByRole('status').filter({ hasText: 'Cuenta creada correctamente' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.accountDirectory.createdRoles), ['tutor'])
  assert.ok(await page.evaluate(() => window.accountDirectory.rpcCalls.length) > before)
})
