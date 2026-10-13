import test from 'node:test'
import assert from 'node:assert/strict'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createAccount } from './createAccount.ts'

const common = {
  nombre: 'Ana', apellido: 'García', email: 'ana@example.com', password: 'initial-password',
}

for (const user_role of ['tutor', 'admin', 'secretaria']) {
  test(`sends the requested ${user_role} role to create-account with only applicable fields`, async () => {
    const account = user_role === 'tutor'
      ? { ...common, user_role, dni: '12345678', telefono: '' }
      : { ...common, user_role }
    let calls = 0
    const result = await createAccount(account, async (name, options) => {
      calls += 1
      assert.equal(name, 'create-account')
      assert.deepEqual(options, { body: account })
      if (user_role !== 'tutor') {
        assert.equal('dni' in options.body, false)
        assert.equal('telefono' in options.body, false)
      }
      return { data: { success: true }, error: null }
    })
    assert.deepEqual(result, { success: true })
    assert.equal(calls, 1)
  })
}

for (const status of [400, 401, 403, 409, 500]) {
  test(`preserves the generic endpoint's Spanish HTTP ${status} error`, async () => {
    const message = `No se pudo crear la cuenta (${status}).`
    const result = await createAccount({ ...common, user_role: 'admin' }, async () => ({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: message }), { status })),
    }))
    assert.deepEqual(result, { error: message })
  })
}

test('generic account requests require explicit success and hide transport details', async () => {
  const account = { ...common, user_role: 'secretaria' }
  for (const data of [null, {}, { success: false }, { success: 'true' }]) {
    assert.equal(typeof (await createAccount(account, async () => ({ data, error: null }))).error, 'string')
  }
  const result = await createAccount(account, async () => { throw new Error('private transport details') })
  assert.deepEqual(result, { error: 'No se pudo crear la cuenta. Verifique la conexión e intente nuevamente.' })
})
