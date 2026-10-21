import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeJwtPayload } from './session.ts'

function createToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `header.${encoded}.signature`
}

test('decodes Base64URL JWT payloads as UTF-8 JSON', () => {
  const payload = { user_role: 'tutor', display_name: 'José', note: 'mañana' }
  assert.deepEqual(decodeJwtPayload(createToken(payload)), payload)

  const hyphenToken = createToken({ user_role: 'tutor', display_name: '¾' })
  const underscoreToken = createToken({ user_role: 'tutor', display_name: '¿' })
  assert.ok(hyphenToken.split('.')[1].includes('-'))
  assert.ok(underscoreToken.split('.')[1].includes('_'))
  assert.deepEqual(decodeJwtPayload(hyphenToken)?.display_name, '¾')
  assert.deepEqual(decodeJwtPayload(underscoreToken)?.display_name, '¿')
})

test('returns null for malformed JWT payloads', () => {
  assert.equal(decodeJwtPayload('header.%%%%.signature'), null)
  assert.equal(decodeJwtPayload('header.payload'), null)
})
