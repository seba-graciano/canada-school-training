import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

// Inscripciones 2027 data foundations (odd/tasks/inscripciones-2027.md, T3-T6).
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migrations = new URL('../migrations/', import.meta.url)
const FEATURE_PREFIX = '20261124'
const adminId = '00000000-0000-4000-8000-000000000001'
const accountId = '00000000-0000-4000-8000-000000000009'

const OFFICIAL_COURSES = [
  ['Inicial', 'Inicial'],
  ...[1, 2, 3, 4, 5, 6].map(n => ['Primario', `${n}º Primaria`]),
  ...[1, 2, 3, 4, 5, 6].map(n => ['Secundario', `${n}º Secundaria`]),
]

// Applies every migration; `legacy` runs right before the first feature migration,
// so tests can load the dirty data that exists in production today.
async function database(legacy = async () => {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin;
    create schema auth;
    create table auth.users(id uuid primary key,email text unique,
      raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated,supabase_auth_admin;
  `)
  let legacyLoaded = false
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (name.startsWith(FEATURE_PREFIX) && !legacyLoaded) { await legacy(db); legacyLoaded = true }
    await db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  if (!legacyLoaded) await legacy(db)
  await db.exec(`insert into auth.users(id,email) values ('${adminId}','admin@example.test');
    insert into perfiles(id,user_role,tutor_id) values ('${adminId}','admin',null);`)
  return db
}

async function asAdmin(db) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: adminId, user_role: 'admin' })])
  await db.exec('set role authenticated')
}

async function provisionTutor(db, dni) {
  return db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ($1,$2,$3,$4)',
    [accountId, 'Family@Example.test', { provision_account_by: adminId, provision_account_role: 'tutor' },
      { nombre: 'Laura', apellido: 'Pérez', dni, telefono: '1144445555' }])
}

const legacyFamily = async db => {
  await db.exec(`
    insert into tutores(nombre,apellido,dni,email) values ('Ana','Ruiz','28.111.333','ana@example.test');
    insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base) values
      ('Mateo','Ruiz','40 123 456','Secundario','Curso 5',1,21000000),
      ('Mia','Ruiz','49555666','Inicial','Curso 3',1,15000000),
      ('Sofia','Ruiz','45111222','Primario','Curso 1',1,18500000);
    insert into cuotas(alumno_id,monto,descuento,recargo,estado,fecha_vencimiento)
      values (1,21000000,0,0,'Pendiente',current_date),(3,18500000,0,0,'Pagada',current_date);
    insert into pagos(cuota_id,monto_abonado,medio_pago) values (2,18500000,'efectivo');
  `)
}

test('cleanup normalizes legacy DNIs and maps "Curso N" to the official course of its level', async () => {
  const db = await database(legacyFamily)
  try {
    const { rows } = await db.query('select dni,nivel,curso from alumnos order by id')
    assert.deepEqual(rows, [
      { dni: '40123456', nivel: 'Secundario', curso: '5º Secundaria' },
      { dni: '49555666', nivel: 'Inicial', curso: 'Inicial' },
      { dni: '45111222', nivel: 'Primario', curso: '1º Primaria' },
    ])
    assert.equal((await db.query('select dni from tutores')).rows[0].dni, '28111333')
  } finally { await db.close() }
})

test('cleanup and constraints leave existing cuotas and pagos untouched', async () => {
  let before
  const db = await database(async db => {
    await legacyFamily(db)
    before = {
      cuotas: (await db.query('select * from cuotas order by id')).rows,
      pagos: (await db.query('select * from pagos order by id')).rows,
    }
  })
  try {
    assert.deepEqual((await db.query('select * from cuotas order by id')).rows, before.cuotas)
    assert.deepEqual((await db.query('select * from pagos order by id')).rows, before.pagos)
  } finally { await db.close() }
})

test('the courses catalog holds exactly the official level/course pairs', async () => {
  const db = await database()
  try {
    const { rows } = await db.query('select nivel,curso from cursos order by orden')
    assert.deepEqual(rows.map(row => [row.nivel, row.curso]), OFFICIAL_COURSES)
  } finally { await db.close() }
})

test('a student course must belong to its level', async () => {
  const db = await database(legacyFamily)
  try {
    await asAdmin(db)
    await assert.rejects(db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Olivia','Ortiz','49222333','Primario','4º Secundaria',1,18500000)`), error => error.code === '23503')
    await db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Olivia','Ortiz','49222333','Primario','4º Primaria',1,18500000)`)
  } finally { await db.close() }
})

test('student and guardian DNIs are unique', async () => {
  const db = await database(legacyFamily)
  try {
    await assert.rejects(db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Copy','Ruiz','40123456','Primario','1º Primaria',1,1)`), error => error.code === '23505')
    await assert.rejects(db.query("insert into tutores(nombre,apellido,dni) values ('Copy','Ruiz','28111333')"),
      error => error.code === '23505')
  } finally { await db.close() }
})

test('new DNIs must have 7 or 8 digits; legacy invalid guardians survive until reviewed', async () => {
  const db = await database(async db => {
    await db.exec("insert into tutores(nombre,apellido,dni) values ('Legacy','Account','11111111111')")
  })
  try {
    assert.equal((await db.query("select count(*)::int as n from tutores where dni='11111111111'")).rows[0].n, 1)
    await assert.rejects(db.query("insert into tutores(nombre,apellido,dni) values ('New','Tutor','123456789')"),
      error => error.code === '23514')
    await assert.rejects(db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Short','Dni','1234','Inicial','Inicial',1,1)`), error => error.code === '23514')
  } finally { await db.close() }
})

test('staff student creation strips dots and spaces from the DNI and rejects invalid ones clearly', async () => {
  const db = await database(legacyFamily)
  try {
    await asAdmin(db)
    await db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Tomas','Ruiz',' 47.222.333 ','Secundario','1º Secundaria',1,21000000)`)
    await db.exec('reset role')
    assert.equal((await db.query("select dni from alumnos where nombre='Tomas'")).rows[0].dni, '47222333')
    await asAdmin(db)
    await assert.rejects(db.query(`insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base)
      values ('Bad','Dni','abc','Inicial','Inicial',1,1)`),
    error => error.code === '22023' && error.message === 'El DNI debe tener 7 u 8 dígitos')
  } finally { await db.close() }
})

test('creating the account of an imported guardian links the existing row instead of duplicating it', async () => {
  const db = await database(async db => {
    await db.exec("insert into tutores(nombre,apellido,dni,email) values ('Laura','Pérez','30111222',null)")
  })
  try {
    await provisionTutor(db, '30.111.222')
    const tutors = (await db.query('select id,dni,email from tutores order by id')).rows
    assert.deepEqual(tutors, [{ id: 1, dni: '30111222', email: 'family@example.test' }])
    const profile = (await db.query('select user_role,tutor_id from perfiles where id=$1', [accountId])).rows[0]
    assert.deepEqual(profile, { user_role: 'tutor', tutor_id: 1 })
  } finally { await db.close() }
})

test('linking keeps an imported guardian email that already exists', async () => {
  const db = await database(async db => {
    await db.exec("insert into tutores(nombre,apellido,dni,email) values ('Laura','Pérez','30111222','laura@school.test')")
  })
  try {
    await provisionTutor(db, '30111222')
    assert.equal((await db.query('select email from tutores')).rows[0].email, 'laura@school.test')
  } finally { await db.close() }
})

test('creating the account of a new guardian still inserts a normalized guardian row', async () => {
  const db = await database()
  try {
    await provisionTutor(db, '30 111 222')
    const tutors = (await db.query('select dni,email from tutores')).rows
    assert.deepEqual(tutors, [{ dni: '30111222', email: 'family@example.test' }])
  } finally { await db.close() }
})

test('guardian accounts with an invalid DNI are rejected without partial rows', async () => {
  const db = await database()
  try {
    await assert.rejects(provisionTutor(db, '11111111111'),
      error => error.code === '22023' && error.message === 'Invalid account data')
    assert.equal((await db.query('select count(*)::int as n from tutores')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int as n from perfiles where id=$1', [accountId])).rows[0].n, 0)
  } finally { await db.close() }
})
