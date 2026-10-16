const historicalMigrations = new Set([
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
])

export function selectMigrationNames(names, baseline = false) {
  return names.filter(name => name.endsWith('.sql'))
    .filter(name => !baseline || historicalMigrations.has(name))
    .sort()
}
