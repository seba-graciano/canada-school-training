import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { selectMigrationNames } from './migrations.mjs'

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migrations = new URL('../migrations/', import.meta.url)
const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  admin2: '00000000-0000-4000-8000-000000000002',
  tutor: '00000000-0000-4000-8000-000000000003',
  missing: '00000000-0000-4000-8000-000000000004',
}

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique,
      raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated, anon, supabase_auth_admin;
  `)
  for (const name of selectMigrationNames(await readdir(migrations))) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  await db.exec(`
    insert into auth.users(id,email) values
      ('${ids.admin}','Admin@example.test'), ('${ids.admin2}','second.admin@example.test'),
      ('${ids.tutor}','literal_m_%@example.test'), ('${ids.missing}','wildcard@example.test');
    insert into tutores(nombre,email) values ('Account owner','literal_m_%@example.test');
    insert into perfiles(id,user_role,tutor_id) values
      ('${ids.admin}','admin',null), ('${ids.admin2}','admin',null), ('${ids.tutor}','tutor',1);
    insert into alumnos(nombre,apellido,tutor_id,arancel_base) values ('Student','One',1,10000);
    insert into cuotas(alumno_id,monto,descuento,recargo,estado,fecha_vencimiento)
      values (1,10000,0,0,'Pendiente',current_date);
    insert into pagos(cuota_id,monto_abonado) values (1,100);
  `)
  return db
}

async function asUser(db, id, role) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, user_role: role })])
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`)
}

test('admin directory returns only Auth identity fields, includes missing profiles, literal search and stable pages', async () => {
  const db = await database()
  try {
    await asUser(db, ids.admin, 'admin')
    const first = (await db.query('select admin_list_accounts($1,$2,$3) as result', ['', 1, 2])).rows[0].result
    assert.equal(first.total, 4)
    assert.equal(first.page, 1)
    assert.equal(first.page_size, 2)
    assert.deepEqual(Object.keys(first.accounts[0]).sort(), ['email', 'id', 'user_role'])
    assert.deepEqual(first.accounts.map(row => row.email), ['Admin@example.test', 'literal_m_%@example.test'])
    const second = (await db.query('select admin_list_accounts($1,$2,$3) as result', ['', 2, 2])).rows[0].result
    assert.deepEqual(second.accounts.map(row => row.email), ['second.admin@example.test', 'wildcard@example.test'])
    assert.equal(second.accounts.find(row => row.id === ids.missing).user_role, null)
    const literal = (await db.query('select admin_list_accounts($1,$2,$3) as result', ['m_%', 1, 20])).rows[0].result
    assert.deepEqual(literal.accounts.map(row => row.email), ['literal_m_%@example.test'])
    for (const args of [['', 0, 20], ['', 1, 101], ['x'.repeat(255), 1, 20]]) {
      await assert.rejects(db.query('select admin_list_accounts($1,$2,$3)', args), e => e.code === '22023')
    }
  } finally { await db.close() }
})

test('non-admin and anonymous callers cannot list Auth identities', async () => {
  const db = await database()
  try {
    for (const [id, role] of [[ids.tutor, 'tutor'], [null, 'anon']]) {
      await asUser(db, id, role)
      await assert.rejects(db.query("select admin_list_accounts('',1,20)"), e => e.code === '42501')
    }
  } finally { await db.close() }
})

test('deleted or demoted administrator JWTs lose table and RPC privileges while staff roles remain live', async () => {
  const db = await database()
  try {
    await db.query('update perfiles set user_role=$1 where id=$2', ['tutor', ids.admin])
    await asUser(db, ids.admin, 'admin')
    assert.deepEqual((await db.query('select id from tutores')).rows, [])
    await assert.rejects(db.query("select admin_list_accounts('',1,20)"), e => e.code === '42501')
    await db.exec('reset role')
    await db.query('delete from auth.users where id=$1', [ids.admin])
    await asUser(db, ids.admin, 'admin')
    assert.deepEqual((await db.query('select id from tutores')).rows, [])
    await assert.rejects(db.query("select admin_list_accounts('',1,20)"), e => e.code === '42501')
    await asUser(db, ids.admin2, 'admin')
    assert.equal((await db.query('select aumentar_cuotas_pendientes_15() as count')).rows[0].count, 1)
  } finally { await db.close() }
})

test('Auth deletion removes profile only and final-admin refusal preserves identity and educational data', async () => {
  const db = await database()
  try {
    await db.query('delete from auth.users where id=$1', [ids.tutor])
    assert.equal((await db.query('select count(*)::int as n from perfiles where id=$1', [ids.tutor])).rows[0].n, 0)
    for (const table of ['tutores', 'alumnos', 'cuotas', 'pagos']) {
      assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n, 1, table)
    }
    await db.query('delete from auth.users where id=$1', [ids.admin2])
    const before = (await db.query('select id,email from auth.users order by id')).rows
    await assert.rejects(db.query('delete from auth.users where id=$1', [ids.admin]), /ACCOUNT_DIRECTORY_LAST_ADMIN/)
    assert.deepEqual((await db.query('select id,email from auth.users order by id')).rows, before)
  } finally { await db.close() }
})

test('rejected directory and deletion operations preserve all fixture data and deleted tutor tokens lose access', async () => {
  const db = await database()
  async function snapshot() {
    await db.exec('reset role')
    const data = {}
    for (const table of ['auth.users', 'perfiles', 'tutores', 'alumnos', 'cuotas', 'pagos']) {
      data[table] = (await db.query(`select row_to_json(t) as row from ${table} t`)).rows
        .map(result => JSON.stringify(result.row)).sort()
    }
    return JSON.stringify(data)
  }
  try {
    await db.query('delete from auth.users where id=$1', [ids.admin2])
    const original = await snapshot()
    await assert.rejects(db.query('delete from auth.users where id=$1', [ids.admin]), /ACCOUNT_DIRECTORY_LAST_ADMIN/)
    assert.equal(await snapshot(), original)
    await asUser(db, ids.tutor, 'admin')
    await assert.rejects(db.query("select admin_list_accounts('',1,20)"), error => error.code === '42501')
    assert.equal(await snapshot(), original)
    await asUser(db, ids.admin, 'admin')
    await assert.rejects(db.query("select admin_list_accounts('',0,20)"), error => error.code === '22023')
    assert.equal(await snapshot(), original)
    await db.query('delete from auth.users where id=$1', [ids.tutor])
    await asUser(db, ids.tutor, 'tutor')
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: ids.tutor, user_role: 'tutor', tutor_id: 1 }),
    ])
    for (const table of ['alumnos', 'cuotas', 'pagos']) {
      assert.deepEqual((await db.query(`select id from ${table}`)).rows, [])
    }
  } finally { await db.close() }
})
