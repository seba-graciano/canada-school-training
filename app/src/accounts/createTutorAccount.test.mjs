import test from 'node:test'
import assert from 'node:assert/strict'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createTutorAccount } from './createTutorAccount.ts'

const account = {
  nombre: 'Ana', apellido: 'García', dni: '12345678',
  email: 'ana@example.com', telefono: '', password: 'initial-password',
}

test('invokes the tutor endpoint with only account data and preserves the caller session', async () => {
  let calls = 0
  const result = await createTutorAccount(account, async (name, options) => {
    calls += 1
    assert.equal(name, 'create-tutor-account')
    assert.deepEqual(options, { body: account })
    return { data: { success: true }, error: null }
  })
  assert.deepEqual(result, { success: true })
  assert.equal(calls, 1)
})

for (const status of [400, 401, 403, 409, 500]) {
  test(`shows the Spanish function error for HTTP ${status}`, async () => {
    const message = `No se pudo crear la cuenta (${status}).`
    const result = await createTutorAccount(account, async () => ({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: message }), { status })),
    }))
    assert.deepEqual(result, { error: message })
  })
}

test('handles a structured failure response without accepting it as success', async () => {
  const result = await createTutorAccount(account, async () => ({
    data: { error: 'El correo ya está registrado.' }, error: null,
  }))
  assert.deepEqual(result, { error: 'El correo ya está registrado.' })
})

test('uses a safe message for malformed function errors and transport failures', async () => {
  const failures = [
    new FunctionsHttpError(new Response('invalid JSON', { status: 500 })),
    new Error('private transport details'),
  ]
  for (const error of failures) {
    const result = await createTutorAccount(account, async () => ({ data: null, error }))
    assert.deepEqual(result, { error: 'No se pudo crear la cuenta. Verifique la conexión e intente nuevamente.' })
  }
  const thrown = await createTutorAccount(account, async () => { throw new Error('private details') })
  assert.deepEqual(thrown, { error: 'No se pudo crear la cuenta. Verifique la conexión e intente nuevamente.' })
})

test('requires explicit confirmation of successful account creation', async () => {
  for (const data of [null, {}, { success: false }, { success: 'true' }]) {
    const result = await createTutorAccount(account, async () => ({ data, error: null }))
    assert.equal(typeof result.error, 'string')
  }
})
