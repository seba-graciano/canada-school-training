-- Inscripciones 2027 (OC-2026-0147, TEC 6.3): one RPC to simulate and to confirm an enrollment import.
-- Contract: docs/inscripciones-contrato.md. Rule and message codes are those of FUN-2026-0147.

-- Cents to the pesos text shown in messages: 18500055.5 -> '185000.555', 0 -> '0', -1 -> '-0.01'.
create or replace function private.inscripciones_pesos(p_centavos numeric)
returns text language sql immutable set search_path = '' as $$
  select rtrim(rtrim((p_centavos / 100)::numeric(24, 4)::text, '0'), '.');
$$;

-- Validates every row again with the FUN codes and exact messages. The front already did it,
-- but the payload can be forged from the browser console. Returns [] when every row is valid.
-- Errors are ordered by row, then by code.
create or replace function private.inscripciones_errores(p_filas jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with f as (
    select
      (e.value->>'fila')::int as fila,
      btrim(coalesce(e.value#>>'{alumno,dni}', '')) as a_dni,
      btrim(coalesce(e.value#>>'{alumno,nombre}', '')) as a_nombre,
      btrim(coalesce(e.value#>>'{alumno,apellido}', '')) as a_apellido,
      btrim(coalesce(e.value#>>'{alumno,nivel}', '')) as nivel,
      btrim(coalesce(e.value#>>'{alumno,curso}', '')) as curso,
      jsonb_typeof(e.value#>'{alumno,arancelCentavos}') as arancel_tipo,
      coalesce(e.value#>>'{alumno,arancelCentavos}', '') as arancel_texto,
      -- CASE keeps the cast from running on strings or nulls.
      case when jsonb_typeof(e.value#>'{alumno,arancelCentavos}') = 'number'
        then (e.value#>'{alumno,arancelCentavos}')::numeric end as arancel,
      btrim(coalesce(e.value#>>'{tutor,dni}', '')) as t_dni,
      btrim(coalesce(e.value#>>'{tutor,nombre}', '')) as t_nombre,
      btrim(coalesce(e.value#>>'{tutor,apellido}', '')) as t_apellido,
      lower(btrim(coalesce(e.value#>>'{tutor,email}', ''))) as t_email
    from jsonb_array_elements(p_filas) as e
  ),
  campos(fila, campo, valor) as (
    select fila, 'Nombre alumno', a_nombre from f
    union all select fila, 'Apellido alumno', a_apellido from f
    union all select fila, 'Nombre tutor', t_nombre from f
    union all select fila, 'Apellido tutor', t_apellido from f
  ),
  alumnos_repetidos as (
    select a_dni, string_agg(fila::text, ', ' order by fila) as filas
    from f where a_dni <> '' group by a_dni having count(*) > 1
  ),
  tutores_inconsistentes as (
    select t_dni, string_agg(fila::text, ', ' order by fila) as filas
    from f where t_dni <> '' group by t_dni
    having count(distinct (t_nombre, t_apellido, t_email)) > 1
  ),
  errores(fila, codigo, mensaje) as (
    select fila, 'E01', 'Falta el DNI del alumno.' from f where a_dni = ''
    union all
    select fila, 'E02', format('El DNI del alumno "%s" no es válido: debe tener 7 u 8 dígitos.', a_dni)
    from f where a_dni <> '' and a_dni !~ '^[0-9]{7,8}$'
    union all
    select fila, 'E03', 'Falta el nombre del alumno.' from f where a_nombre = ''
    union all
    select fila, 'E04', 'Falta el apellido del alumno.' from f where a_apellido = ''
    union all
    select fila, 'E05', 'Falta el nivel.' from f where nivel = ''
    union all
    select fila, 'E06', format('El nivel "%s" no existe. Valores posibles: Inicial, Primario, Secundario.', nivel)
    from f where nivel <> '' and not exists (select 1 from public.cursos c where c.nivel = f.nivel)
    union all
    select fila, 'E07', 'Falta el curso.' from f where curso = ''
    union all
    -- The course is checked only when the level exists (FUN row 16 shows E06 alone).
    select fila, 'E08', format('El curso "%s" no corresponde al nivel %s.', curso, nivel)
    from f where curso <> ''
      and exists (select 1 from public.cursos c where c.nivel = f.nivel)
      and not exists (select 1 from public.cursos c where c.nivel = f.nivel and c.curso = f.curso)
    union all
    -- 2147483647 is the integer limit of alumnos.arancel_base.
    select fila, 'E09', format('El arancel "%s" no es válido: debe ser un número mayor a cero.',
      case when arancel is null then arancel_texto else private.inscripciones_pesos(arancel) end)
    from f where arancel is null or arancel <= 0 or arancel > 2147483647
    union all
    select fila, 'E10', format('El arancel "%s" tiene más de dos decimales.', private.inscripciones_pesos(arancel))
    from f where arancel > 0 and arancel <= 2147483647 and arancel <> trunc(arancel)
    union all
    select f.fila, 'E11', format('El DNI %s está repetido en las filas %s.', r.a_dni, r.filas)
    from f join alumnos_repetidos r using (a_dni)
    union all
    select fila, 'E12', 'Falta el DNI del tutor.' from f where t_dni = ''
    union all
    select fila, 'E13', format('El DNI del tutor "%s" no es válido: debe tener 7 u 8 dígitos.', t_dni)
    from f where t_dni <> '' and t_dni !~ '^[0-9]{7,8}$'
    union all
    select fila, 'E14', 'Falta el nombre o el apellido del tutor.' from f where t_nombre = '' or t_apellido = ''
    union all
    select f.fila, 'E15', format('El tutor con DNI %s tiene datos distintos en las filas %s.', i.t_dni, i.filas)
    from f join tutores_inconsistentes i using (t_dni)
    union all
    select fila, 'E16', format('El email "%s" no es válido.', t_email)
    from f where t_email <> '' and t_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    union all
    select fila, 'E17', format('El campo %s no puede empezar con =, +, - o @.', campo)
    from campos where valor ~ '^[=+@-]'
  )
  select coalesce(jsonb_agg(jsonb_build_object('fila', fila, 'codigo', codigo, 'mensaje', mensaje)
    order by fila, codigo, mensaje), '[]'::jsonb)
  from errores;
$$;

revoke all on function private.inscripciones_pesos(numeric) from public, anon, authenticated;
revoke all on function private.inscripciones_errores(jsonb) from public, anon, authenticated;

create or replace function public.importar_inscripciones(p_payload jsonb, p_solo_simular boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_simular boolean := coalesce(p_solo_simular, true);
  v_filas jsonb := p_payload->'filas';
  v_archivo text := p_payload->>'nombreArchivo';
  v_hash text := p_payload->>'hashArchivo';
  v_errores jsonb;
  v_previa jsonb;
  v_tutores jsonb := '{}'::jsonb;
  v_resultado jsonb := '[]'::jsonb;
  v_tutor jsonb;
  v_id integer;
  v_creado boolean;
  v_alumnos_creados integer := 0;
  v_alumnos_actualizados integer := 0;
  v_tutores_creados integer := 0;
  v_tutores_actualizados integer := 0;
  r record;
begin
  -- SECURITY DEFINER runs as the owner and RLS does not apply: this check is what protects the data.
  if auth.uid() is null or public.current_user_role() not in ('admin', 'secretaria') then
    return jsonb_build_object('success', false, 'code', 'SIN_PERMISO');
  end if;

  -- Structural problems are programming errors, not spreadsheet errors.
  if jsonb_typeof(v_filas) is distinct from 'array'
    or coalesce(length(v_archivo), 0) not between 1 and 255
    or coalesce(v_hash, '') !~ '^[0-9a-f]{64}$'
    or exists (select 1 from jsonb_array_elements(v_filas) e
      where coalesce(e->>'fila', '') !~ '^[0-9]{1,7}$' or e->>'fila' in ('0', '1'))
    or (select count(distinct e->>'fila') from jsonb_array_elements(v_filas) e) <> jsonb_array_length(v_filas) then
    raise exception 'Payload de importación inválido' using errcode = '22023';
  end if;

  -- Serializes imports until this transaction ends ("xact"): two confirmations never interleave.
  perform pg_advisory_xact_lock(hashtext('public.importar_inscripciones'));

  select jsonb_build_object('fecha', i.fecha, 'usuario', i.usuario_email)
    into v_previa
    from public.importaciones i
    where i.hash_archivo = v_hash
    order by i.fecha desc, i.id desc
    limit 1;

  if jsonb_array_length(v_filas) = 0 then
    v_errores := jsonb_build_array(jsonb_build_object('fila', null, 'codigo', 'F05',
      'mensaje', 'El archivo no tiene filas para importar.'));
  elsif jsonb_array_length(v_filas) > 2000 then
    v_errores := jsonb_build_array(jsonb_build_object('fila', null, 'codigo', 'F02',
      'mensaje', 'El archivo supera el máximo de 2 MB o 2.000 filas.'));
  else
    v_errores := private.inscripciones_errores(v_filas);
  end if;

  if v_errores <> '[]'::jsonb then
    return jsonb_build_object('success', false, 'code', 'FILAS_INVALIDAS', 'importacionPrevia', v_previa,
      'filas', '[]'::jsonb, 'errores', v_errores,
      'resumen', jsonb_build_object('alumnosCreados', 0, 'alumnosActualizados', 0,
        'tutoresCreados', 0, 'tutoresActualizados', 0));
  end if;

  -- The block is an implicit savepoint. A simulation raises IN001 at the end, so Postgres undoes
  -- every write of the block while the PL/pgSQL variables keep what would have happened.
  begin
    -- Guardians first, in order of first appearance, so siblings reuse the same row (R-07).
    for r in
      select x.dni, x.tutor
      from (
        select distinct on (btrim(e.value#>>'{tutor,dni}'))
          btrim(e.value#>>'{tutor,dni}') as dni, e.value->'tutor' as tutor, e.ord
        from jsonb_array_elements(v_filas) with ordinality as e(value, ord)
        order by btrim(e.value#>>'{tutor,dni}'), e.ord
      ) x
      order by x.ord
    loop
      -- A blank email or phone keeps the stored value instead of erasing it.
      insert into public.tutores as t (nombre, apellido, dni, email, telefono)
        values (btrim(r.tutor->>'nombre'), btrim(r.tutor->>'apellido'), r.dni,
          nullif(lower(btrim(coalesce(r.tutor->>'email', ''))), ''),
          nullif(btrim(coalesce(r.tutor->>'telefono', '')), ''))
        on conflict (dni) do update set
          nombre = excluded.nombre,
          apellido = excluded.apellido,
          email = coalesce(excluded.email, t.email),
          telefono = coalesce(excluded.telefono, t.telefono)
        -- xmax is 0 only for a row this statement inserted; an updated row carries our transaction id.
        returning t.id, t.xmax::text = '0' into v_id, v_creado;
      v_tutores := v_tutores || jsonb_build_object(r.dni, jsonb_build_object('id', v_id,
        'accion', case when v_creado then 'CREAR' else 'ACTUALIZAR' end));
      if v_creado then v_tutores_creados := v_tutores_creados + 1;
      else v_tutores_actualizados := v_tutores_actualizados + 1; end if;
    end loop;

    -- Students in sheet order: the sibling discount depends on insertion order (R-10).
    for r in
      select e.value as fila_json, (e.value->>'fila')::int as fila
      from jsonb_array_elements(v_filas) with ordinality as e(value, ord)
      order by e.ord
    loop
      v_tutor := v_tutores -> btrim(r.fila_json#>>'{tutor,dni}');
      -- activo is left as it is for existing students; new ones start active.
      insert into public.alumnos as a (nombre, apellido, dni, nivel, curso, tutor_id, arancel_base, activo)
        values (btrim(r.fila_json#>>'{alumno,nombre}'), btrim(r.fila_json#>>'{alumno,apellido}'),
          btrim(r.fila_json#>>'{alumno,dni}'), btrim(r.fila_json#>>'{alumno,nivel}'),
          btrim(r.fila_json#>>'{alumno,curso}'), (v_tutor->>'id')::int,
          (r.fila_json#>>'{alumno,arancelCentavos}')::numeric::int, true)
        on conflict (dni) do update set
          nombre = excluded.nombre,
          apellido = excluded.apellido,
          nivel = excluded.nivel,
          curso = excluded.curso,
          tutor_id = excluded.tutor_id,
          arancel_base = excluded.arancel_base
        returning a.xmax::text = '0' into v_creado;
      if v_creado then v_alumnos_creados := v_alumnos_creados + 1;
      else v_alumnos_actualizados := v_alumnos_actualizados + 1; end if;
      v_resultado := v_resultado || jsonb_build_array(jsonb_build_object('fila', r.fila,
        'alumno', case when v_creado then 'CREAR' else 'ACTUALIZAR' end, 'tutor', v_tutor->>'accion'));
    end loop;

    if v_simular then
      raise exception 'Import simulation rollback' using errcode = 'IN001';
    end if;
  exception when sqlstate 'IN001' then
    null;
  end;

  if not v_simular then
    insert into public.importaciones (usuario_id, usuario_email, nombre_archivo, hash_archivo,
      alumnos_creados, alumnos_actualizados, tutores_creados, tutores_actualizados)
    select auth.uid(), coalesce(u.email, auth.uid()::text), v_archivo, v_hash,
      v_alumnos_creados, v_alumnos_actualizados, v_tutores_creados, v_tutores_actualizados
    from (select 1) one
    left join auth.users u on u.id = auth.uid();
  end if;

  return jsonb_build_object(
    'success', true,
    'code', case when v_simular then 'SIMULADO' else 'IMPORTADO' end,
    'importacionPrevia', v_previa,
    'filas', v_resultado,
    'errores', '[]'::jsonb,
    'resumen', jsonb_build_object('alumnosCreados', v_alumnos_creados, 'alumnosActualizados', v_alumnos_actualizados,
      'tutoresCreados', v_tutores_creados, 'tutoresActualizados', v_tutores_actualizados));
end;
$$;

revoke all on function public.importar_inscripciones(jsonb, boolean) from public, anon;
grant execute on function public.importar_inscripciones(jsonb, boolean) to authenticated;
