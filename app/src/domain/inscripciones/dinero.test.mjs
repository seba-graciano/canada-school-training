import test from 'node:test'
import assert from 'node:assert/strict'
import { parsearArancel } from './dinero.ts'

test('an Excel number becomes integer cents', () => {
  assert.deepEqual(parsearArancel(185000), { ok: true, centavos: 18500000 })
  assert.deepEqual(parsearArancel(185000.5), { ok: true, centavos: 18500050 })
  assert.deepEqual(parsearArancel(0.1), { ok: true, centavos: 10 })
})

test('Argentine text uses dots for thousands and a comma for decimals (R-04)', () => {
  assert.deepEqual(parsearArancel('185.000,50'), { ok: true, centavos: 18500050 })
  assert.deepEqual(parsearArancel('185.000'), { ok: true, centavos: 18500000 })
  assert.deepEqual(parsearArancel('185000'), { ok: true, centavos: 18500000 })
  assert.deepEqual(parsearArancel(' 1.250.000,5 '), { ok: true, centavos: 125000050 })
  assert.deepEqual(parsearArancel('185000,05'), { ok: true, centavos: 18500005 })
})

test('more than two decimals is E10 with the original value', () => {
  assert.deepEqual(parsearArancel(185000.555), { ok: false, codigo: 'E10', valor: '185000.555' })
  assert.deepEqual(parsearArancel('185.000,555'), { ok: false, codigo: 'E10', valor: '185.000,555' })
  assert.deepEqual(parsearArancel('0,001'), { ok: false, codigo: 'E10', valor: '0,001' })
})

test('zero, negatives, words, blanks and dates are E09 with the shown value', () => {
  assert.deepEqual(parsearArancel(0), { ok: false, codigo: 'E09', valor: '0' })
  assert.deepEqual(parsearArancel('-150000'), { ok: false, codigo: 'E09', valor: '-150000' })
  assert.deepEqual(parsearArancel(-150000), { ok: false, codigo: 'E09', valor: '-150000' })
  assert.deepEqual(parsearArancel('mucho'), { ok: false, codigo: 'E09', valor: 'mucho' })
  assert.deepEqual(parsearArancel(null), { ok: false, codigo: 'E09', valor: '' })
  assert.deepEqual(parsearArancel(new Date(Date.UTC(2026, 2, 1))), { ok: false, codigo: 'E09', valor: '01/03/2026' })
  assert.deepEqual(parsearArancel('18.50.00'), { ok: false, codigo: 'E09', valor: '18.50.00' })
  assert.deepEqual(parsearArancel('185000.5'), { ok: false, codigo: 'E09', valor: '185000.5' })
})

test('amounts that do not fit the stored integer cents are E09', () => {
  assert.deepEqual(parsearArancel(21474836.47), { ok: true, centavos: 2147483647 })
  assert.deepEqual(parsearArancel(21474836.48), { ok: false, codigo: 'E09', valor: '21474836.48' })
  assert.deepEqual(parsearArancel(Number.POSITIVE_INFINITY), { ok: false, codigo: 'E09', valor: 'Infinity' })
})
