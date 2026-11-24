import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

// importar_inscripciones RPC (odd/tasks/inscripciones-2027.md, T8; contract: docs/inscripciones-contrato.md).
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const migrations = new URL('../migrations/', import.meta.url)
const adminId = '00000000-0000-4000-8000-000000000001'
const secretaryId = '00000000-0000-4000-8000-000000000002'
const tutorUserId = '00000000-0000-4000-8000-000000000003'
const HASH = 'ab'.repeat(32)
const TABLES = ['alumnos', 'tutores', 'cuotas', 'pagos', 'importaciones']

async function database() {
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
    await db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  await db.exec(`
    insert into auth.users(id,email) values ('${adminId}','admin@example.test'),
      ('${secretaryId}','staff@example.test'),('${tutorUserId}','tutor@example.test');
    insert into tutores(nombre,apellido,dni) values ('Own','Family','37000222');
    insert into perfiles(id,user_role,tutor_id) values ('${adminId}','admin',null),
      ('${secretaryId}','secretaria',null),('${tutorUserId}','tutor',1);
  `)
  return db
}

async function as(db, id, role) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, user_role: role, tutor_id: 1 })])
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`)
}

async function importar(db, payload, simulate) {
  return (await db.query('select importar_inscripciones($1::jsonb,$2) as r', [JSON.stringify(payload), simulate])).rows[0].r
}

async function snapshot(db, tables = TABLES) {
  await db.exec('reset role')
  const result = {}
  for (const table of tables) result[table] = (await db.query(`select * from ${table} order by id`)).rows
  return result
}

const tutor = (dni, nombre, apellido, email = null, telefono = null) => ({ dni, nombre, apellido, email, telefono })
const fila = (n, dni, nombre, apellido, nivel, curso, arancelCentavos, guardian) =>
  ({ fila: n, alumno: { dni, nombre, apellido, nivel, curso, arancelCentavos }, tutor: guardian })

// The valid rows of inscripciones-2027-ejemplo.xlsx, already normalized by the front.
const gomez = tutor('23456789', 'Carlos', 'Gómez', 'cgomez@gmail.com', '+54 9 11 5555-1234')
const gimenez = tutor('48111333', 'Sergio', 'Giménez', 'sgimenez@gmail.com')
const VALID_ROWS = [
  fila(2, '45111222', 'Sofía', 'Gómez', 'Primario', '3º Primaria', 18500000, gomez),
  fila(3, '47222333', 'Tomás', 'Gómez', 'Secundario', '1º Secundaria', 21000000, gomez),
  fila(4, '52333444', 'Lucía', 'Gómez', 'Inicial', 'Inicial', 15000000, gomez),
  fila(5, '40123456', 'Mateo', 'Fernández', 'Secundario', '5º Secundaria', 21000000, tutor('28111333', 'Ana', 'Ruiz', 'ana.ruiz@hotmail.com', '11 4444-5555')),
  fila(6, '46555666', 'Valentina', 'López', 'Primario', '2º Primaria', 18500000, tutor('29222444', 'Diego', 'López', 'dlopez@yahoo.com.ar')),
  fila(7, '44666777', 'Benjamín', 'Torres', 'Secundario', '3º Secundaria', 21000000, tutor('30333555', 'Paula', 'Torres', 'ptorres@gmail.com')),
  fila(8, '45777888', 'Martina', 'Sosa', 'Primario', '6º Primaria', 18500050, tutor('31444666', 'Jorge', 'Sosa', 'jsosa@gmail.com')),
  fila(20, '49555666', 'Mía', 'Rojas', 'Inicial', 'Inicial', 15000000, tutor('42555777', 'Natalia', 'Rojas', null, '11 3333-2222')),
  fila(28, '41222333', 'Lorenzo', 'Benítez', 'Secundario', '1º Secundaria', 21000000, tutor('46999111', 'Marcela', 'Benítez', 'mbenitez@gmail.com')),
  fila(29, '50333444', 'Alma', 'Quiroga', 'Primario', '4º Primaria', 18500000, tutor('47000222', 'Martín', 'Quiroga', 'mquiroga@gmail.com')),
  fila(30, '50444555', 'Ian', 'Giménez', 'Primario', '6º Primaria', 18500000, gimenez),
  fila(31, '50555666', 'Zoe', 'Giménez', 'Inicial', 'Inicial', 15000000, gimenez),
]
const payload = (filas = VALID_ROWS) => ({ nombreArchivo: 'inscripciones-2027.xlsx', hashArchivo: HASH, filas })
const ALL_NEW = { alumnosCreados: 12, alumnosActualizados: 0, tutoresCreados: 9, tutoresActualizados: 0 }

test('a confirmed import creates students and guardians in sheet order; siblings share one guardian', async () => {
  const db = await database()
  try {
    await as(db, adminId, 'admin')
    const result = await importar(db, payload(), false)
    assert.equal(result.success, true)
    assert.equal(result.code, 'IMPORTADO')
    assert.equal(result.importacionPrevia, null)
    assert.deepEqual(result.errores, [])
    assert.deepEqual(result.resumen, ALL_NEW)
    assert.deepEqual(result.filas[0], { fila: 2, alumno: 'CREAR', tutor: 'CREAR' })
    assert.deepEqual(result.filas[1], { fila: 3, alumno: 'CREAR', tutor: 'CREAR' })
    await db.exec('reset role')
    const students = (await db.query(`select a.dni,a.arancel_base,a.activo,t.dni as tutor_dni
      from alumnos a join tutores t on t.id=a.tutor_id order by a.id`)).rows
    assert.deepEqual(students.map(row => row.dni), VALID_ROWS.map(row => row.alumno.dni))
    assert.deepEqual(students.slice(0, 3).map(row => row.tutor_dni), ['23456789', '23456789', '23456789'])
    assert.equal(students[6].arancel_base, 18500050)
    assert.ok(students.every(row => row.activo === true))
    const log = (await db.query(`select usuario_id,usuario_email,nombre_archivo,hash_archivo,alumnos_creados,
      alumnos_actualizados,tutores_creados,tutores_actualizados from importaciones`)).rows
    assert.deepEqual(log, [{ usuario_id: adminId, usuario_email: 'admin@example.test', nombre_archivo: 'inscripciones-2027.xlsx',
      hash_archivo: HASH, alumnos_creados: 12, alumnos_actualizados: 0, tutores_creados: 9, tutores_actualizados: 0 }])
  } finally { await db.close() }
})

test('a simulation reports what a confirmation would do and changes no table', async () => {
  const db = await database()
  try {
    const before = await snapshot(db)
    await as(db, secretaryId, 'secretaria')
    const result = await importar(db, payload(), true)
    assert.equal(result.success, true)
    assert.equal(result.code, 'SIMULADO')
    assert.deepEqual(result.resumen, ALL_NEW)
    assert.equal(result.filas.length, 12)
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})

test('importing the same file twice leaves students and guardians equal and reports the previous import', async () => {
  const db = await database()
  try {
    await as(db, adminId, 'admin')
    await importar(db, payload(), false)
    const once = await snapshot(db, ['alumnos', 'tutores', 'cuotas', 'pagos'])
    await as(db, secretaryId, 'secretaria')
    const preview = await importar(db, payload(), true)
    assert.equal(preview.importacionPrevia.usuario, 'admin@example.test')
    assert.ok(!Number.isNaN(Date.parse(preview.importacionPrevia.fecha)))
    const again = await importar(db, payload(), false)
    assert.deepEqual(again.resumen, { alumnosCreados: 0, alumnosActualizados: 12, tutoresCreados: 0, tutoresActualizados: 9 })
    assert.deepEqual(again.filas[0], { fila: 2, alumno: 'ACTUALIZAR', tutor: 'ACTUALIZAR' })
    assert.deepEqual(await snapshot(db, ['alumnos', 'tutores', 'cuotas', 'pagos']), once)
    assert.equal((await db.query('select count(*)::int as n from importaciones')).rows[0].n, 2)
  } finally { await db.close() }
})

test('a tutor gets SIN_PERMISO, anonymous callers cannot execute it, and nothing changes', async () => {
  const db = await database()
  try {
    const before = await snapshot(db)
    await as(db, tutorUserId, 'tutor')
    assert.deepEqual(await importar(db, payload(), false), { success: false, code: 'SIN_PERMISO' })
    await as(db, null, 'anon')
    await assert.rejects(importar(db, payload(), false), error => error.code === '42501')
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})

test('importing existing students updates them and never touches cuotas or pagos', async () => {
  const db = await database()
  try {
    await db.exec(`insert into tutores(nombre,apellido,dni,email,telefono) values ('Carlos','Gomez','23456789','old@example.test','1100000000');
      insert into alumnos(nombre,apellido,dni,nivel,curso,tutor_id,arancel_base,activo)
        values ('Sofia','Gomez','45111222','Primario','2º Primaria',2,15000000,false);
      insert into cuotas(alumno_id,monto,descuento,recargo,estado,fecha_vencimiento) values (1,15000000,0,0,'Pagada',current_date);
      insert into pagos(cuota_id,monto_abonado,medio_pago) values (1,15000000,'efectivo');`)
    const before = await snapshot(db, ['cuotas', 'pagos'])
    await as(db, adminId, 'admin')
    const result = await importar(db, payload([VALID_ROWS[0]]), false)
    assert.deepEqual(result.resumen, { alumnosCreados: 0, alumnosActualizados: 1, tutoresCreados: 0, tutoresActualizados: 1 })
    await db.exec('reset role')
    assert.deepEqual((await db.query('select nombre,apellido,curso,arancel_base,tutor_id,activo from alumnos')).rows,
      [{ nombre: 'Sofía', apellido: 'Gómez', curso: '3º Primaria', arancel_base: 18500000, tutor_id: 2, activo: false }])
    assert.deepEqual((await db.query('select apellido,email,telefono from tutores where id=2')).rows,
      [{ apellido: 'Gómez', email: 'cgomez@gmail.com', telefono: '+54 9 11 5555-1234' }])
    assert.deepEqual(await snapshot(db, ['cuotas', 'pagos']), before)
  } finally { await db.close() }
})

test('a blank guardian email or phone keeps the stored value', async () => {
  const db = await database()
  try {
    await db.exec("insert into tutores(nombre,apellido,dni,email,telefono) values ('Nati','Rojas','42555777','nrojas@example.test','1199990000')")
    await as(db, adminId, 'admin')
    await importar(db, payload([fila(20, '49555666', 'Mía', 'Rojas', 'Inicial', 'Inicial', 15000000,
      tutor('42555777', 'Natalia', 'Rojas', null, null))]), false)
    await db.exec('reset role')
    assert.deepEqual((await db.query("select nombre,email,telefono from tutores where dni='42555777'")).rows,
      [{ nombre: 'Natalia', email: 'nrojas@example.test', telefono: '1199990000' }])
  } finally { await db.close() }
})

test('one invalid row rejects the whole payload and lists every error with the exact FUN text', async () => {
  const db = await database()
  try {
    const before = await snapshot(db)
    const ok = tutor('32555777', 'Elena', 'Díaz', 'ediaz@gmail.com')
    const rows = [
      ...VALID_ROWS.slice(0, 2),
      fila(9, '46888999', 'Simón', 'Díaz', 'Primario', '4º Primaria', 18500055.5, ok),
      fila(10, '47999000', 'Emma', 'Romero', 'Primario', '1º Primaria', 0, tutor('33666888', 'Raúl', 'Romero', 'rromero@gmail.com')),
      fila(12, '', 'Isabella', 'Ruiz', 'Primario', '5º Primaria', 18500000, tutor('35888000', 'Hugo', 'Ruiz', 'hruiz@gmail.com')),
      fila(14, '43123123', 'Catalina', 'Herrera', 'Secundario', '4º Secundaria', 21000000, tutor('37000223', 'Pablo', 'Herrera')),
      fila(15, '43123123', 'Catalina', 'Herrera', 'Secundario', '4º Secundaria', 21000000, tutor('37000223', 'Pablo', 'Herrera')),
      fila(16, '49111222', 'Felipe', 'Castro', 'Terciario', '1º Terciario', 23000000, tutor('38111333', 'Mónica', 'Castro')),
      fila(17, '49222333', 'Olivia', 'Ortiz', 'Primario', '4º Secundaria', 18500000, tutor('39222444', 'Andrés', 'Ortiz')),
      fila(18, '49333444', '', 'Molina', 'Primario', '3º Primaria', 18500000, tutor('40333555', 'Lorena', 'Molina')),
      fila(19, '49444555', 'Bautista', 'Silva', 'Primario', '3º Primaria', 18500000, tutor('41444666', 'Gustavo', 'Silva', 'gsilva@gmail')),
      fila(21, '49666777', 'Lautaro', 'Pérez', 'Primario', '1º Primaria', 18500000, tutor('30111222', 'Laura', 'Pérez', 'lperez@gmail.com')),
      fila(22, '49777888', 'Julieta', 'Pérez', 'Primario', '5º Primaria', 18500000, tutor('30111222', 'Laura', 'Peres', 'lperez@gmail.com')),
      fila(23, '49888999', 'Nicolás', 'Vega', 'Secundario', '6º Secundaria', 21000000, tutor('', 'Gabriela', 'Vega')),
      fila(25, '50111222', 'Agustina', 'Navarro', 'Primario', '2º Primaria', 18500000, tutor('43666888', '=HYPERLINK("http://example.com","Ver")', 'Navarro')),
      fila(26, 'abc', 'Bruno', 'Ramos', null, '', 'mucho', tutor('44777999', 'Irene', 'Ramos')),
      fila(32, '1234', '+Ana', '', 'Inicial', 'Inicial', -1, tutor('123', '', 'Paz', null, '+54 11')),
    ]
    await as(db, adminId, 'admin')
    const result = await importar(db, payload(rows), false)
    assert.equal(result.success, false)
    assert.equal(result.code, 'FILAS_INVALIDAS')
    assert.deepEqual(result.filas, [])
    assert.deepEqual(result.resumen, { alumnosCreados: 0, alumnosActualizados: 0, tutoresCreados: 0, tutoresActualizados: 0 })
    assert.deepEqual(result.errores, [
      { fila: 9, codigo: 'E10', mensaje: 'El arancel "185000.555" tiene más de dos decimales.' },
      { fila: 10, codigo: 'E09', mensaje: 'El arancel "0" no es válido: debe ser un número mayor a cero.' },
      { fila: 12, codigo: 'E01', mensaje: 'Falta el DNI del alumno.' },
      { fila: 14, codigo: 'E11', mensaje: 'El DNI 43123123 está repetido en las filas 14, 15.' },
      { fila: 15, codigo: 'E11', mensaje: 'El DNI 43123123 está repetido en las filas 14, 15.' },
      { fila: 16, codigo: 'E06', mensaje: 'El nivel "Terciario" no existe. Valores posibles: Inicial, Primario, Secundario.' },
      { fila: 17, codigo: 'E08', mensaje: 'El curso "4º Secundaria" no corresponde al nivel Primario.' },
      { fila: 18, codigo: 'E03', mensaje: 'Falta el nombre del alumno.' },
      { fila: 19, codigo: 'E16', mensaje: 'El email "gsilva@gmail" no es válido.' },
      { fila: 21, codigo: 'E15', mensaje: 'El tutor con DNI 30111222 tiene datos distintos en las filas 21, 22.' },
      { fila: 22, codigo: 'E15', mensaje: 'El tutor con DNI 30111222 tiene datos distintos en las filas 21, 22.' },
      { fila: 23, codigo: 'E12', mensaje: 'Falta el DNI del tutor.' },
      { fila: 25, codigo: 'E17', mensaje: 'El campo Nombre tutor no puede empezar con =, +, - o @.' },
      { fila: 26, codigo: 'E02', mensaje: 'El DNI del alumno "abc" no es válido: debe tener 7 u 8 dígitos.' },
      { fila: 26, codigo: 'E05', mensaje: 'Falta el nivel.' },
      { fila: 26, codigo: 'E07', mensaje: 'Falta el curso.' },
      { fila: 26, codigo: 'E09', mensaje: 'El arancel "mucho" no es válido: debe ser un número mayor a cero.' },
      { fila: 32, codigo: 'E02', mensaje: 'El DNI del alumno "1234" no es válido: debe tener 7 u 8 dígitos.' },
      { fila: 32, codigo: 'E04', mensaje: 'Falta el apellido del alumno.' },
      { fila: 32, codigo: 'E09', mensaje: 'El arancel "-0.01" no es válido: debe ser un número mayor a cero.' },
      { fila: 32, codigo: 'E13', mensaje: 'El DNI del tutor "123" no es válido: debe tener 7 u 8 dígitos.' },
      { fila: 32, codigo: 'E14', mensaje: 'Falta el nombre o el apellido del tutor.' },
      { fila: 32, codigo: 'E17', mensaje: 'El campo Nombre alumno no puede empezar con =, +, - o @.' },
    ])
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})

test('payloads without rows or above 2.000 rows are rejected as a whole', async () => {
  const db = await database()
  try {
    await as(db, adminId, 'admin')
    assert.deepEqual((await importar(db, payload([]), true)).errores,
      [{ fila: null, codigo: 'F05', mensaje: 'El archivo no tiene filas para importar.' }])
    const many = Array.from({ length: 2001 }, (_, i) =>
      fila(i + 2, String(40000000 + i), 'N', 'A', 'Inicial', 'Inicial', 100, tutor(String(30000000 + i), 'T', 'U')))
    const result = await importar(db, payload(many), true)
    assert.equal(result.code, 'FILAS_INVALIDAS')
    assert.deepEqual(result.errores, [{ fila: null, codigo: 'F02', mensaje: 'El archivo supera el máximo de 2 MB o 2.000 filas.' }])
  } finally { await db.close() }
})

test('a failure in the middle of a confirmation rolls back every row', async () => {
  const db = await database()
  try {
    await db.exec(`create function public.fail_on_third() returns trigger language plpgsql as $$
      begin if new.dni = '52333444' then raise exception 'connection lost'; end if; return new; end $$;
      create trigger fail_on_third before insert on public.alumnos for each row execute function public.fail_on_third();`)
    const before = await snapshot(db)
    await as(db, adminId, 'admin')
    await assert.rejects(importar(db, payload(), false), /connection lost/)
    assert.deepEqual(await snapshot(db), before)
  } finally { await db.close() }
})
