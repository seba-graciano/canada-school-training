import test from 'node:test'
import assert from 'node:assert/strict'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { deleteAccount, listAccounts } from './accountDirectory.ts'

const account = { id: 'f9b9d5b7-3202-45ee-9b1d-740515a0e010', email: 'ana@example.com', user_role: 'tutor' }

test('lists the requested page and literal email search through the administrator RPC', async () => {
  let request
  const result = await listAccounts({ search: 'ana@example.com', page: 3 }, async (...args) => {
    request = args
    return { data: { accounts: [account], total: 41, page: 3, page_size: 20 }, error: null }
  })
  assert.deepEqual(request, ['admin_list_accounts', { p_search: 'ana@example.com', p_page: 3, p_page_size: 20 }])
  assert.deepEqual(result, { accounts: [account], total: 41, page: 3, page_size: 20 })
})

test('rejects malformed directory responses and returns a safe error on RPC failure', async () => {
  for (const data of [null, {}, { accounts: [{ ...account, user_role: 'owner' }], total: 1, page: 1, page_size: 20 }]) {
    assert.equal('error' in await listAccounts({ search: '', page: 1 }, async () => ({ data, error: null })), true)
  }
  const result = await listAccounts({ search: '', page: 1 }, async () => ({ data: null, error: new Error('private details') }))
  assert.deepEqual(result, { error: 'No se pudo cargar el listado de cuentas. Intente nuevamente.' })
})

test('deletes only the selected Auth user and requires explicit success', async () => {
  let request
  const result = await deleteAccount(account.id, async (...args) => {
    request = args
    return { data: { success: true }, error: null }
  })
  assert.deepEqual(request, ['delete-account', { body: { user_id: account.id } }])
  assert.deepEqual(result, { success: true })
  for (const data of [null, {}, { success: false }]) {
    assert.equal('error' in await deleteAccount(account.id, async () => ({ data, error: null })), true)
  }
})

test('surfaces safe deletion HTTP errors and hides transport details', async () => {
  const httpError = new FunctionsHttpError(new Response(JSON.stringify({ error: 'No se puede eliminar la última cuenta administradora.' }), { status: 409 }))
  assert.deepEqual(await deleteAccount(account.id, async () => ({ data: null, error: httpError })), { error: 'No se puede eliminar la última cuenta administradora.' })
  assert.equal('error' in await deleteAccount(account.id, async () => { throw new Error('private details') }), true)
})
