import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

// Use a temporary tool installation, without changing application dependencies.
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migrations = new URL('../migrations/', import.meta.url)
const adminId = '00000000-0000-4000-8000-000000000001'
const secretaryId = '00000000-0000-4000-8000-000000000002'
const tutorId = '00000000-0000-4000-8000-000000000003'
const newId = '00000000-0000-4000-8000-000000000004'

async function database(baseline = Boolean(process.env.BASELINE_ONLY)) {
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
  for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    if (baseline && !/^00\d\d_/.test(name)) continue
    await db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  await db.exec(`
    insert into auth.users(id,email) values
      ('${adminId}','admin@example.test'), ('${secretaryId}','staff@example.test'),
      ('${tutorId}','tutor@example.test');
    insert into tutores(nombre,email) values ('Own','tutor@example.test'), ('Other','other@example.test');
    insert into perfiles(id,user_role,tutor_id) values
      ('${adminId}','admin',null), ('${secretaryId}','secretaria',null), ('${tutorId}','tutor',1);
    insert into alumnos(nombre,apellido,tutor_id,arancel_base) values
      ('Own','Student',1,10000), ('Other','Student',2,10000);
    insert into cuotas(alumno_id,monto,descuento,recargo,estado,fecha_vencimiento) values
      (1,10000,0,0,'pendiente',current_date), (2,10000,0,0,'pendiente',current_date);
    insert into pagos(cuota_id,monto_abonado) values (1,100),(2,100);
  `)
  return db
}

async function asUser(db, id, role, tutor = null) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({sub:id,user_role:role,tutor_id:tutor})])
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`)
}

test('tutor and anonymous callers cannot increase fees; rejection leaves data unchanged', async () => {
  const db = await database()
  try {
    const before = (await db.query('select * from cuotas order by id')).rows
    for (const [id, role, tutor] of [[tutorId,'tutor',1],[null,'anon',null]]) {
      await asUser(db,id,role,tutor)
      await assert.rejects(db.query('select aumentar_cuotas_pendientes_15()'), e => e.code === '42501')
      await db.exec('reset role')
      assert.deepEqual((await db.query('select * from cuotas order by id')).rows, before)
    }
  } finally { await db.close() }
})

test('tutor sees only own family through tables/search/dashboard and cannot mutate staff data', async () => {
  const db = await database()
  try {
    await asUser(db,tutorId,'tutor',1)
    for (const sql of ['select id from alumnos','select id from tutores','select id from cuotas','select id from pagos',"select id from buscar_alumnos('')",'select id from dashboard_alumnos()']) {
      assert.deepEqual((await db.query(sql)).rows, [{id:1}], sql)
    }
    assert.equal((await db.query('select cobrar_cuota(2) as result')).rows[0].result.code, 'FORBIDDEN')
    for (const sql of ["insert into alumnos(nombre,tutor_id) values ('Forbidden',1)","insert into pagos(cuota_id,monto_abonado) values (1,100)","insert into perfiles(id,user_role) values ('00000000-0000-4000-8000-000000000099','admin')",'select * from perfiles']) {
      await assert.rejects(db.query(sql), e => e.code === '42501')
    }
    assert.equal((await db.query("update cuotas set monto=1 returning id")).rows.length,0)
  } finally { await db.close() }
})

test('admin and secretary retain dashboard, fee increase and collection behavior', async () => {
  for (const [id,role] of [[adminId,'admin'],[secretaryId,'secretaria']]) {
    const db = await database()
    try {
      await asUser(db,id,role)
      assert.equal((await db.query('select * from dashboard_alumnos()')).rows.length,2)
      assert.equal((await db.query('select aumentar_cuotas_pendientes_15() as n')).rows[0].n,2)
      assert.equal((await db.query('select monto from cuotas where id=1')).rows[0].monto,11500)
      assert.equal((await db.query('select cobrar_cuota(1) as result')).rows[0].result.success,true)
    } finally { await db.close() }
  }
})

async function provision(db, actor = adminId, metadata = {}) {
  return db.query(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ($1,$2,$3,$4)`,
    [newId,'new@example.test',{provision_tutor_by:actor},{nombre:'New',apellido:'Tutor',dni:'30123456',telefono:'1144445555',...metadata}])
}

test('provisioning creates a new linked tutor/profile and the auth hook assigns tutor claims', async () => {
  const db = await database()
  try {
    await provision(db)
    const profile = (await db.query('select user_role,tutor_id from perfiles where id=$1',[newId])).rows[0]
    assert.deepEqual(profile,{user_role:'tutor',tutor_id:3})
    assert.deepEqual((await db.query('select nombre,apellido,dni,email,telefono from tutores where id=3')).rows[0],
      {nombre:'New',apellido:'Tutor',dni:'30123456',email:'new@example.test',telefono:'1144445555'})
    const hook = (await db.query('select custom_access_token_hook($1) as result',[{user_id:newId,claims:{}}])).rows[0].result
    assert.equal(hook.claims.user_role,'tutor')
    assert.equal(hook.claims.tutor_id,3)
    await asUser(db,newId,'tutor',3)
    assert.equal((await db.query('select * from dashboard_alumnos()')).rows.length,0)
  } finally { await db.close() }
})

test('invalid creator or data rolls back identity, guardian and profile; editable metadata cannot provision', async () => {
  const db = await database()
  try {
    for (const [actor,data] of [[secretaryId,{}],[tutorId,{}],[adminId,{nombre:''}]]) {
      await assert.rejects(provision(db,actor,data))
      assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3)
      assert.equal((await db.query('select count(*)::int n from tutores')).rows[0].n,2)
      assert.equal((await db.query('select count(*)::int n from perfiles')).rows[0].n,3)
    }
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',
      [newId,'new@example.test',{provision_tutor_by:adminId,user_role:'admin'}])
    assert.equal((await db.query('select * from perfiles where id=$1',[newId])).rows.length,0)
  } finally { await db.close() }
})

async function snapshot(db, tables) {
  const rows = {}
  for (const table of tables) rows[table] = (await db.query(`select * from ${table} order by id`)).rows
  return rows
}

test('a late profile failure rolls back the Auth identity and guardian insert', async () => {
  const db = await database()
  try {
    const tables = ['auth.users', 'tutores', 'perfiles']
    const before = await snapshot(db, tables)
    await db.exec(`
      create function fail_profile() returns trigger language plpgsql as
        $$ begin raise exception 'late failure'; end $$;
      create trigger fail_profile before insert on perfiles
        for each row execute function fail_profile();
    `)
    await assert.rejects(provision(db), /late failure/)
    assert.deepEqual(await snapshot(db, tables), before)
  } finally { await db.close() }
})

test('a profile downgrade denies stale administrator claims on guarded operations', async () => {
  const db = await database()
  try {
    await db.query('update perfiles set user_role=$1,tutor_id=2 where id=$2', ['tutor',adminId])
    const before = await snapshot(db, ['cuotas'])
    await asUser(db,adminId,'admin')
    await assert.rejects(db.query('select aumentar_cuotas_pendientes_15()'), e => e.code === '42501')
    await db.exec('reset role')
    assert.deepEqual(await snapshot(db, ['cuotas']), before)
    await assert.rejects(provision(db), e => e.code === '42501')
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3)
  } finally { await db.close() }
})

test('all tutor write attempts preserve existing family and billing records', async () => {
  const db = await database()
  try {
    const tables = ['alumnos', 'tutores', 'cuotas', 'pagos']
    const before = await snapshot(db, tables)
    await asUser(db,tutorId,'tutor',1)
    for (const [table, assignment] of [['alumnos',"nombre='attack'"], ['tutores',"nombre='attack'"], ['cuotas','monto=1'], ['pagos','monto_abonado=1']]) {
      for (const sql of [`update ${table} set ${assignment} returning id`, `delete from ${table} returning id`]) {
        try {
          assert.equal((await db.query(sql)).rows.length,0,sql)
        } catch (error) {
          assert.equal(error.code,'42501',sql)
        }
      }
    }
    assert.equal((await db.query('select cobrar_cuota(1) as result')).rows[0].result.code,'FORBIDDEN')
    assert.equal((await db.query("select id from buscar_alumnos('Other')")).rows.length,0)
    await db.exec('reset role')
    assert.deepEqual(await snapshot(db, tables), before)
  } finally { await db.close() }
})

test('staff operations produce the same results and stored amounts as the baseline', async () => {
  for (const [id,role] of [[adminId,'admin'],[secretaryId,'secretaria']]) {
    const candidate = await database()
    const baseline = await database(true)
    try {
      for (const db of [baseline,candidate]) {
        await db.exec("update alumnos set created_at='2026-10-13T00:00:00Z'")
        await asUser(db,id,role)
      }
      for (const sql of ['select * from dashboard_alumnos()', "select * from buscar_alumnos('')", 'select aumentar_cuotas_pendientes_15()', 'select cobrar_cuota(1)']) {
        assert.deepEqual((await candidate.query(sql)).rows,(await baseline.query(sql)).rows,`${role}: ${sql}`)
      }
      for (const db of [baseline,candidate]) await db.exec('reset role')
      for (const table of ['cuotas','pagos']) {
        const stable = rows => rows.map(({created_at, ...rest}) => rest)
        assert.deepEqual(stable((await candidate.query(`select * from ${table} order by id`)).rows),
          stable((await baseline.query(`select * from ${table} order by id`)).rows),`${role}: ${table}`)
      }
    } finally { await baseline.close(); await candidate.close() }
  }
})

async function provisionAccount(db, role, actor = adminId, metadata = {}) {
  return db.query(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ($1,$2,$3,$4)`,
    [newId,'new@example.test',{provision_account_by:actor,provision_account_role:role},
      {nombre:'New',apellido:'Account',...(role === 'tutor' ? {dni:'30123456',telefono:'1144445555'} : {}),...metadata}])
}

test('generic provisioning creates each requested role and guardians only for tutors', async () => {
  for (const role of ['admin','secretaria','tutor']) {
    const db = await database()
    try {
      const previousTutors = (await db.query('select * from tutores order by id')).rows
      await provisionAccount(db,role)
      assert.deepEqual((await db.query('select user_role,tutor_id from perfiles where id=$1',[newId])).rows,
        [{user_role:role,tutor_id:role === 'tutor' ? 3 : null}])
      const tutors = (await db.query('select * from tutores order by id')).rows
      if (role === 'tutor') {
        assert.equal(tutors.length,3)
        assert.deepEqual(tutors.slice(0,2),previousTutors)
      } else assert.deepEqual(tutors,previousTutors)
      const hook = (await db.query('select custom_access_token_hook($1) as result',
        [{user_id:newId,claims:{}}])).rows[0].result
      assert.equal(hook.claims.user_role,role)
      assert.equal(hook.claims.tutor_id,role === 'tutor' ? 3 : undefined)
      await asUser(db,newId,role,role === 'tutor' ? 3 : null)
      assert.equal((await db.query('select * from dashboard_alumnos()')).rows.length,role === 'tutor' ? 0 : 2)
    } finally { await db.close() }
  }
})

test('generic provisioning rejects invalid roles and current nonadmins without writes', async () => {
  const db = await database()
  try {
    const tables = ['auth.users','tutores','perfiles']
    const before = await snapshot(db,tables)
    for (const [role,actor] of [['teacher',adminId],[null,adminId],['ADMIN',adminId],
      ['admin',secretaryId],['secretaria',tutorId],['tutor',secretaryId],['admin',null]]) {
      await assert.rejects(provisionAccount(db,role,actor))
      assert.deepEqual(await snapshot(db,tables),before)
    }
    await db.query('update perfiles set user_role=$1,tutor_id=2 where id=$2',['tutor',adminId])
    const downgraded = await snapshot(db,tables)
    await assert.rejects(provisionAccount(db,'admin'), error => error.code === '42501')
    assert.deepEqual(await snapshot(db,tables),downgraded)
  } finally { await db.close() }
})

test('generic provisioning ignores editable role claims and rolls back late staff failure', async () => {
  const db = await database()
  try {
    await provisionAccount(db,'secretaria',adminId,{user_role:'admin',provision_account_role:'admin'})
    assert.deepEqual((await db.query('select user_role,tutor_id from perfiles where id=$1',[newId])).rows,
      [{user_role:'secretaria',tutor_id:null}])
    await db.exec(`delete from auth.users where id='${newId}';
      create function fail_staff_profile() returns trigger language plpgsql as
        $$ begin raise exception 'late staff failure'; end $$;
      create trigger fail_staff_profile before insert on perfiles
        for each row execute function fail_staff_profile();`)
    const before = await snapshot(db,['auth.users','tutores','perfiles'])
    await assert.rejects(provisionAccount(db,'admin'), /late staff failure/)
    assert.deepEqual(await snapshot(db,['auth.users','tutores','perfiles']),before)
  } finally { await db.close() }
})
