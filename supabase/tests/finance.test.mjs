import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createHash } from 'node:crypto'

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migrations = new URL('../migrations/', import.meta.url)
const admin = '00000000-0000-4000-8000-000000000001'
const tutor = '00000000-0000-4000-8000-000000000002'

async function database(beforeAudit) {
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
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (name.endsWith('_audit_financial_integrity.sql') && beforeAudit) await beforeAudit(db)
    await db.exec(await readFile(new URL(name,migrations),'utf8'))
  }
  await db.exec(`
    insert into auth.users(id,email) values ('${admin}','admin@example.test'),('${tutor}','tutor@example.test');
    insert into tutores(nombre) values ('Family'),('Other family');
    insert into perfiles(id,user_role,tutor_id) values ('${admin}','admin',null),('${tutor}','tutor',1);
    insert into alumnos(nombre,apellido,tutor_id,arancel_base) values ('First','Student',1,10000);
  `)
  return db
}

async function staff(db, id = admin, role = 'admin') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id,user_role:role,tutor_id:1})])
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`)
}

async function invoice(db, { amount=10000, discount=0, surcharge=0, state='Pendiente', paid=0 } = {}) {
  const { rows } = await db.query(`insert into cuotas(alumno_id,monto,descuento,recargo,estado,fecha_vencimiento)
    values(1,$1,$2,$3,$4,current_date-1) returning id`, [amount,discount,surcharge,state])
  if (paid) await db.query('insert into pagos(cuota_id,monto_abonado) values($1,$2)',[rows[0].id,paid])
  return rows[0].id
}

test('hosted states normalize to one canonical spelling while preserving financial history', async () => {
  const db=await database()
  try {
    await db.exec(`alter table public.cuotas drop constraint cuotas_estado_check,
      add constraint cuotas_estado_check check (estado in ('pagado','pendiente','vencida'));
      alter table public.cuotas alter column estado set default 'pendiente';
      insert into cuotas(alumno_id,monto,recargo,descuento,estado) values
        (1,10000,0,0,'pagado'),(1,10000,0,0,'pendiente'),(1,10000,0,0,'vencida');
      insert into pagos(cuota_id,monto_abonado) values(1,10000);`)
    const invoices=(await db.query('select * from cuotas order by id')).rows
    const receipts=(await db.query('select * from pagos order by id')).rows
    await staff(db)
    const rejected=(await db.query('select cobrar_cuota_confirmada(2,10000) as result')).rows[0].result
    assert.equal(rejected.code,'DB_ERROR')
    assert.match(rejected.error,/cuotas_estado_check/)
    assert.deepEqual((await db.query('select * from cuotas order by id')).rows,invoices)
    assert.deepEqual((await db.query('select * from pagos order by id')).rows,receipts)
    await db.exec('reset role')
    await db.exec(await readFile(new URL('../patches/support_legacy_installment_states.sql',import.meta.url),'utf8'))
    const canonical=invoices.map((row,index)=>({...row,estado:['Pagada','Pendiente','Vencida'][index]}))
    assert.deepEqual((await db.query('select * from cuotas order by id')).rows,canonical)
    assert.deepEqual((await db.query('select * from pagos order by id')).rows,receipts)
    for(const invalid of ['pagado','pendiente','vencida','Pagado','pago','ok',' Pagada ','unknown']) {
      await assert.rejects(db.query('update cuotas set estado=$1 where id=2',[invalid]),error=>error.code==='23514')
      assert.deepEqual((await db.query('select * from cuotas order by id')).rows,canonical)
    }
    await assert.rejects(db.query('update cuotas set estado=null where id=2'),error=>error.code==='23502')
    const generated=await db.query('insert into cuotas(alumno_id,monto,recargo,descuento) values(1,10000,0,0) returning estado')
    assert.equal(generated.rows[0].estado,'Pendiente')
    assert.equal((await db.query("select cuota_esta_pagada('pagado',10000,0) as paid")).rows[0].paid,false)
    await staff(db)
    assert.equal((await db.query('select cobrar_cuota_confirmada(2,10000) as result')).rows[0].result.success,true)
    assert.deepEqual((await db.query('select estado from cuotas order by id')).rows.map(row=>row.estado),
      ['Pagada','Pagada','Vencida','Pendiente'])
    assert.deepEqual((await db.query('select cuota_id,monto_abonado from pagos order by id')).rows,
      [{cuota_id:1,monto_abonado:10000},{cuota_id:2,monto_abonado:10000}])
    const paid=(await db.query('select * from cuotas order by id')).rows
    assert.equal((await db.query('select cobrar_cuota_confirmada(2,10000) as result')).rows[0].result.code,'ALREADY_PAID')
    assert.deepEqual((await db.query('select * from cuotas order by id')).rows,paid)
    assert.equal((await db.query('select count(*)::int as n from pagos')).rows[0].n,2)
  } finally { await db.close() }
})

test('seed commits only canonical states and preserves all generated financial records', async () => {
  const labels={pagado:'Pagada',PAGO:'Pagada',Ok:'Pagada',PENDIENTE:'Pendiente',
    pendiente:'Pendiente',vencida:'Vencida',Vencida:'Vencida',VENCIDA:'Vencida'}
  async function snapshot(filename) {
    const db=new PGlite()
    try {
      await db.exec(`create role anon; create role authenticated; create schema auth;
        create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`)
      await db.exec(await readFile(new URL('0001_schema.sql',migrations),'utf8'))
      await db.exec(await readFile(new URL(filename,import.meta.url),'utf8'))
      const hashes={}
      for(const table of ['tutores','alumnos','cuotas','pagos']) {
        // Ignore wall-clock timestamps; retain IDs, payment assignments and all monetary fields.
        const records=(await db.query(`select to_jsonb(t)-'created_at' as record from public.${table} t order by id`)).rows.map(row=>row.record)
        if(table==='cuotas') for(const row of records) row.estado=labels[row.estado]??row.estado
        hashes[table]=createHash('sha256').update(JSON.stringify(records)).digest('hex')
      }
      return {hashes,states:(await db.query('select distinct estado from cuotas order by estado')).rows.map(row=>row.estado),
        count:(await db.query('select count(*)::int as n from cuotas')).rows[0].n,
        invalidPayments:(await db.query("select count(*)::int as n from pagos p join cuotas c on c.id=p.cuota_id where c.estado<>'Pagada'")).rows[0].n}
    } finally { await db.close() }
  }
  const baseline=await snapshot('./fixtures/legacy-seed.sql')
  const current=await snapshot('../seed.sql')
  assert.deepEqual(current.states,['Pagada','Pendiente','Vencida'])
  assert.equal(current.count,5600)
  assert.equal(current.invalidPayments,0)
  assert.deepEqual(current.hashes,baseline.hashes)
})

test('normalization rejects unknown or null existing states without partial changes', async () => {
  for(const invalid of ['unknown',null]) {
    const db=await database()
    try {
      await db.exec('alter table cuotas drop constraint cuotas_estado_check; alter table cuotas alter column estado drop not null')
      await db.query('insert into cuotas(alumno_id,monto,descuento,recargo,estado) values(1,10000,0,0,$1)',[invalid])
      const before=(await db.query('select * from cuotas order by id')).rows
      const patch=await readFile(new URL('../patches/support_legacy_installment_states.sql',import.meta.url),'utf8')
      await assert.rejects(db.exec(patch),error=>error.code==='22023')
      await db.exec('rollback')
      assert.deepEqual((await db.query('select * from cuotas order by id')).rows,before)
      assert.deepEqual((await db.query('select * from pagos')).rows,[])
      assert.deepEqual((await db.query("select conname from pg_constraint where conrelid='public.cuotas'::regclass and conname='cuotas_estado_check'")).rows,[])
    } finally { await db.close() }
  }
})

test('AUD-01: settlement uses net total and canonical paid state without changing paid history', async () => {
  const db=await database()
  try {
    await invoice(db,{discount:1000,paid:9000})
    await invoice(db,{surcharge:2000,paid:10000})
    const historical=await invoice(db,{state:'Pagada'})
    await staff(db)
    const result=(await db.query('select cuotas_saldadas,deuda from dashboard_alumnos()')).rows[0]
    assert.equal(result.cuotas_saldadas,2)
    assert.equal(Number(result.deuda),20)
    await db.query('select aumentar_cuotas_pendientes_15()')
    assert.deepEqual((await db.query('select monto,estado from cuotas where id=$1',[historical])).rows,
      [{monto:10000,estado:'Pagada'}])
  } finally { await db.close() }
})

test('AUD-02/03: partial balance is reported and collected once; partial invoices are not increased', async () => {
  const db=await database()
  try {
    const id=await invoice(db,{paid:3000})
    await staff(db)
    assert.equal(Number((await db.query('select deuda from dashboard_alumnos()')).rows[0].deuda),70)
    assert.equal((await db.query('select aumentar_cuotas_pendientes_15() as n')).rows[0].n,0)
    const result=(await db.query('select cobrar_cuota($1) as result',[id])).rows[0].result
    assert.equal(result.success,true)
    assert.equal(result.monto_pagado,7000)
    assert.equal(result.nuevo_pagado_total,10000)
    const before=(await db.query('select * from pagos order by id')).rows
    assert.equal((await db.query('select cobrar_cuota($1) as result',[id])).rows[0].result.code,'ALREADY_PAID')
    assert.deepEqual((await db.query('select * from pagos order by id')).rows,before)
  } finally { await db.close() }
})

test('AUD-04: changed reviewed amount rejects atomically; matching amount preserves collection', async () => {
  const db=await database()
  try {
    const id=await invoice(db)
    await staff(db)
    await db.query('select aumentar_cuotas_pendientes_15()')
    const before=(await db.query('select * from cuotas order by id')).rows
    const result=(await db.query('select cobrar_cuota_confirmada($1,$2) as result',[id,10000])).rows[0].result
    assert.equal(result.code,'AMOUNT_CHANGED')
    assert.deepEqual((await db.query('select * from cuotas order by id')).rows,before)
    assert.deepEqual((await db.query('select * from pagos')).rows,[])
    assert.equal((await db.query('select cobrar_cuota_confirmada($1,$2) as result',[id,11500])).rows[0].result.monto_pagado,11500)
  } finally { await db.close() }
})

test('AUD-05: ten children receive 0/10/20 percent by creation order, persisted in new unpaid quotas', async () => {
  const db=await database()
  try {
    await db.exec("update alumnos set created_at='2020-01-01' where id=1")
    for(let position=2;position<=10;position++) {
      await db.query("insert into alumnos(nombre,apellido,tutor_id,arancel_base,created_at) values($1,'Student',1,10000,$2)",
        [`Child${position}`,`2020-01-${String(position).padStart(2,'0')}`])
    }
    await db.exec("insert into cuotas(alumno_id,monto,descuento,recargo,estado) select id,10000,0,0,'Pendiente' from alumnos")
    await staff(db)
    const rows=(await db.query('select id,descuento_hermano from dashboard_alumnos() order by id')).rows
    assert.deepEqual(rows.map(row=>Number(row.descuento_hermano)),[0,.1,.2,.2,.2,.2,.2,.2,.2,.2])
    assert.deepEqual((await db.query('select descuento from cuotas order by alumno_id')).rows.map(row=>row.descuento),
      [0,1000,2000,2000,2000,2000,2000,2000,2000,2000])
  } finally { await db.close() }
})

test('AUD-06: invalid financial data cannot create successful null or negative payment', async () => {
  const db=await database()
  try {
    for(const invalid of [{surcharge:null},{discount:null},{amount:-100}]) {
      const id=await invoice(db,invalid)
      await staff(db)
      const before=(await db.query('select * from cuotas where id=$1',[id])).rows
      const result=(await db.query('select cobrar_cuota($1) as result',[id])).rows[0].result
      assert.equal(result.success,false)
      assert.equal(result.code,'INVALID_AMOUNT')
      assert.deepEqual((await db.query('select * from cuotas where id=$1',[id])).rows,before)
      assert.deepEqual((await db.query('select * from pagos where cuota_id=$1',[id])).rows,[])
      await db.exec('reset role')
    }
  } finally { await db.close() }
})

test('existing collection and bulk endpoints still allow staff and deny tutors without writes', async () => {
  const db=await database()
  try {
    const id=await invoice(db)
    await staff(db,tutor,'tutor')
    assert.equal((await db.query('select cobrar_cuota($1) as result',[id])).rows[0].result.code,'FORBIDDEN')
    await assert.rejects(db.query('select aumentar_cuotas_pendientes_15()'),error=>error.code==='42501')
    await staff(db)
    assert.equal((await db.query('select aumentar_cuotas_pendientes_15() as n')).rows[0].n,1)
    assert.equal((await db.query('select cobrar_cuota($1) as result',[id])).rows[0].result.success,true)
  } finally { await db.close() }
})

test('AUD-09: staff student writes validate identity and cents while preserving a valid registration', async () => {
  const db=await database()
  try {
    await staff(db)
    for(const values of [['','Student','DNI',1000],['Name',' ','DNI',1000],['Name','Student','',1000],
      ['Name','Student','DNI',null],['Name','Student','DNI',-1]]) {
      await assert.rejects(db.query('insert into alumnos(nombre,apellido,dni,arancel_base,tutor_id) values($1,$2,$3,$4,1)',values),
        error=>error.code==='22023')
    }
    assert.equal((await db.query('select count(*)::int as n from alumnos')).rows[0].n,1)
    await db.query("insert into alumnos(nombre,apellido,dni,arancel_base,tutor_id) values(' New ',' Student ',' DNI ',10000,1)")
    assert.deepEqual((await db.query('select nombre,apellido,dni,arancel_base from alumnos where id<>1')).rows,
      [{nombre:'New',apellido:'Student',dni:'DNI',arancel_base:10000}])
  } finally { await db.close() }
})

test('AUD-05 migration reconciles unpaid discounts without rewriting settled or partial history', async () => {
  let receipts
  const db=await database(async before => {
    await before.exec(`
      insert into tutores(nombre) values('Existing family');
      insert into alumnos(nombre,apellido,tutor_id,arancel_base) values
        ('First','Existing',1,10000),('Second','Existing',1,10000),('Third','Existing',1,10000);
      insert into cuotas(alumno_id,monto,descuento,recargo,estado) values
        (3,10000,0,0,'Pagada'),(3,10000,0,0,'Pendiente'),(3,10000,0,0,'Pendiente');
      insert into pagos(cuota_id,monto_abonado) values(3,1000);
    `)
    receipts=(await before.query('select * from pagos order by id')).rows
  })
  try {
    assert.deepEqual((await db.query('select monto,descuento,estado from cuotas order by id')).rows,
      [{monto:10000,descuento:0,estado:'Pagada'},
        {monto:10000,descuento:2000,estado:'Pendiente'},
        {monto:10000,descuento:0,estado:'Pendiente'}])
    assert.deepEqual((await db.query('select * from pagos order by id')).rows,receipts)
  } finally { await db.close() }
})
