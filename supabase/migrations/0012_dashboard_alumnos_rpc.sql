drop function if exists public.dashboard_alumnos();

create or replace function public.dashboard_alumnos()
returns table (
  id int,
  nombre varchar,
  apellido varchar,
  dni varchar,
  nivel varchar,
  curso varchar,
  tutor_id int,
  tutor_email varchar,
  arancel_base numeric,
  hermanos int,
  descuento_hermano numeric,
  cuotas_saldadas int,
  mora numeric,
  deuda numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with cuotas_con_pagos as (
    select c.*, coalesce(sum(p.monto_abonado), 0) as total_pagado
    from cuotas c
    left join pagos p on p.cuota_id = c.id
    group by c.id
  ),
  cuotas_estado as (
    select *,
      case
        when total_pagado >= monto then true
        when lower(estado) in ('pagado', 'pago', 'ok') then true
        else false
      end as esta_pagada,
      case
        when (coalesce(fecha_vencimiento_2, fecha_vencimiento))::date < current_date
         and not (total_pagado >= monto or lower(estado) in ('pagado', 'pago', 'ok'))
        then (current_date - coalesce(fecha_vencimiento_2, fecha_vencimiento)::date) * 5000
        else 0
      end as mora_cents
    from cuotas_con_pagos
  ),
  hermanos_por_tutor as (
    select a.tutor_id, count(*)::int as total_hermanos
    from alumnos a
    where a.tutor_id is not null
    group by a.tutor_id
  ),
  alumnos_base as (
    select
      a.id,
      a.nombre,
      a.apellido,
      a.dni,
      a.nivel,
      a.curso,
      a.tutor_id,
      a.arancel_base,
      coalesce(h.total_hermanos, 1) as hermanos
    from alumnos a
    left join hermanos_por_tutor h on h.tutor_id = a.tutor_id
  ),
  alumnos_calculado as (
    select
      a.id,
      a.nombre,
      a.apellido,
      a.dni,
      a.nivel,
      a.curso,
      a.tutor_id,
      a.arancel_base,
      a.hermanos,
      case
        when a.hermanos = 2 then 0.10
        when a.hermanos >= 3 then 0.20
        else 0
      end as descuento_hermano,
      count(c.id) filter (where c.esta_pagada)::int as cuotas_saldadas,
      coalesce(sum(case when not c.esta_pagada then c.monto + c.recargo - c.descuento else 0 end), 0) as deuda_cents,
      coalesce(sum(c.mora_cents), 0) as mora_cents
    from alumnos_base a
    left join cuotas_estado c on c.alumno_id = a.id
    where current_user_role() = 'admin'
       or current_user_role() = 'secretaria'
       or (current_user_role() = 'tutor' and a.tutor_id = (auth.jwt() ->> 'tutor_id')::int)
    group by a.id, a.nombre, a.apellido, a.dni, a.nivel, a.curso, a.tutor_id, a.arancel_base, a.hermanos
  )
  select
    a.id,
    a.nombre,
    a.apellido,
    a.dni,
    a.nivel,
    a.curso,
    a.tutor_id,
    t.email as tutor_email,
    (a.arancel_base / 100.0)::numeric as arancel_base,
    a.hermanos,
    a.descuento_hermano,
    a.cuotas_saldadas,
    (a.mora_cents / 100.0)::numeric as mora,
    (a.deuda_cents / 100.0)::numeric as deuda
  from alumnos_calculado a
  left join tutores t on t.id = a.tutor_id
  order by a.apellido, a.nombre;
end;
$$;

grant execute on function public.dashboard_alumnos() to authenticated;
revoke execute on function public.dashboard_alumnos() from anon;