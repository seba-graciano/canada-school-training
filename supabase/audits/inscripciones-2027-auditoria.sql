-- Read-only data audit for Inscripciones 2027 (OC-2026-0147, TEC section 6.1).
-- Run it before adding UNIQUE(dni), CHECK(dni) or the courses catalog.
-- It changes nothing: paste it in the Supabase SQL Editor and attach the result to the PR.
-- Each row is one check: table, check name, detail (when useful) and how many rows match.
with
alumno as (
  select a.id, a.dni, a.nivel, a.curso, a.activo, a.tutor_id,
         regexp_replace(coalesce(a.dni, ''), '[.[:space:]]', '', 'g') as dni_normalizado,
         (select count(*) from public.cuotas c where c.alumno_id = a.id) as cuotas
  from public.alumnos a
),
tutor as (
  select t.id, t.dni,
         regexp_replace(coalesce(t.dni, ''), '[.[:space:]]', '', 'g') as dni_normalizado,
         (select count(*) from public.alumnos a where a.tutor_id = t.id) as hijos,
         exists (select 1 from public.perfiles p where p.tutor_id = t.id) as tiene_cuenta
  from public.tutores t
),
checks(tabla, chequeo, detalle, cantidad) as (
  select 'alumnos', '01 total', null::text, count(*) from alumno
  union all
  select 'alumnos', '02 dni nulo o vacio', string_agg(id::text, ', ' order by id), count(*)
  from alumno where dni_normalizado = ''
  union all
  select 'alumnos', '03 dni con puntos o espacios', null, count(*)
  from alumno where dni ~ '[.[:space:]]'
  union all
  select 'alumnos', '04 dni invalido aun normalizado', string_agg(id || '=' || dni, ', ' order by id), count(*)
  from alumno where dni_normalizado <> '' and dni_normalizado !~ '^[0-9]{7,8}$'
  union all
  -- Deleting a duplicate cascades to its cuotas and pagos: the detail shows how many cuotas each one has.
  select 'alumnos', '05 dni repetido (normalizado)',
         dni_normalizado || ': ' || string_agg('id ' || id || ' (cuotas ' || cuotas || ', activo ' || coalesce(activo::text, 'null') || ')', ', ' order by id),
         count(*)
  from alumno where dni_normalizado <> '' group by dni_normalizado having count(*) > 1
  union all
  select 'alumnos', '06 sin tutor', string_agg(id::text, ', ' order by id), count(*)
  from alumno where tutor_id is null
  union all
  select 'alumnos', '07 nivel | curso', coalesce(nivel, '<null>') || ' | ' || coalesce(curso, '<null>'), count(*)
  from alumno group by nivel, curso
  union all
  select 'tutores', '01 total', null, count(*) from tutor
  union all
  select 'tutores', '02 dni nulo o vacio', string_agg(id::text, ', ' order by id), count(*)
  from tutor where dni_normalizado = ''
  union all
  select 'tutores', '03 dni con puntos o espacios', null, count(*)
  from tutor where dni ~ '[.[:space:]]'
  union all
  select 'tutores', '04 dni invalido aun normalizado', string_agg(id || '=' || dni, ', ' order by id), count(*)
  from tutor where dni_normalizado <> '' and dni_normalizado !~ '^[0-9]{7,8}$'
  union all
  select 'tutores', '05 dni repetido (normalizado)',
         dni_normalizado || ': ' || string_agg('id ' || id || ' (hijos ' || hijos || ', cuenta ' || tiene_cuenta || ')', ', ' order by id),
         count(*)
  from tutor where dni_normalizado <> '' group by dni_normalizado having count(*) > 1
  union all
  select 'tutores', '06 con cuenta de acceso', null, count(*) from tutor where tiene_cuenta
)
select tabla, chequeo, detalle, cantidad
from checks
order by tabla, chequeo, detalle;
