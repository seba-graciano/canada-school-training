import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'
import { selectMigrationNames } from './migrations.mjs'

const migrations = new URL('../migrations/', import.meta.url)
const historicalNames = [
  '0001_schema.sql',
  '0002_rls_tests.sql',
  '0003_auth_schema.sql',
  '0004_enable_rls_and_harden_grants.sql',
  '0005_fix_custom_access_token_hook.sql',
  '0006_allow_hook_read_perfiles.sql',
  '0007_restore_authenticated_table_grants.sql',
  '0008_add_segundo_vencimiento.sql',
  '0009_money_to_cents.sql',
  '0010_atomic_cobrar_rpc.sql',
  '0011_grant_select_cuotas.sql',
  '0012_dashboard_alumnos_rpc.sql',
  '0013_bulk_aumentar_cuotas.sql',
]

test('historical baseline contains exactly the original thirteen migrations', async () => {
  const names = await readdir(migrations)
  assert.deepEqual(selectMigrationNames(names, true), historicalNames)
})

test('current migration chain includes later fixes and differs from the baseline', async () => {
  const names = await readdir(migrations)
  const current = selectMigrationNames(names)
  const baseline = selectMigrationNames(names, true)
  assert.ok(current.includes('0014_normalizar_estados_cuotas.sql'))
  assert.ok(current.includes('0015_aumento_cuotas_en_lote.sql'))
  assert.ok(current.includes('0016_tutor_accounts.sql'))
  assert.ok(current.includes('0017_provision_accounts_after_metadata.sql'))
  assert.ok(current.includes('0018_fix_cobro_estado.sql'))
  const numbered = current.filter(name => /^\d{4}_/.test(name))
  assert.deepEqual(numbered.map(name => name.split('_')[0]),
    numbered.map((_, index) => String(index + 1).padStart(4, '0')))
  assert.ok(current.includes('20261020190612_account_directory.sql'))
  assert.ok(current.filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).includes('20261020190612_account_directory.sql'))
  assert.ok(current.length > baseline.length)
  assert.deepEqual(current, names.filter(name => name.endsWith('.sql')).sort())
})
