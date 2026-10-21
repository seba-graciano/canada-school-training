-- One monetary representation: integer cents. Existing receipts are immutable.
create or replace function public.cuota_total_centavos(p_monto integer, p_recargo integer, p_descuento integer)
returns bigint language sql immutable set search_path = '' as $$
  select case when p_monto >= 0 and p_recargo >= 0 and p_descuento >= 0
    and p_descuento::bigint <= p_monto::bigint + p_recargo
    then p_monto::bigint + p_recargo - p_descuento end;
$$;

create or replace function public.cuota_esta_pagada(p_estado text, p_total bigint, p_pagado bigint)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_estado,''))) in ('pagada','pagado','pago','ok')
    or (p_total is not null and coalesce(p_pagado,0) >= p_total);
$$;

create or replace function public.descuento_hermano_tasa(p_alumno_id integer)
returns numeric language sql stable set search_path = '' as $$
  select case when a.tutor_id is null then 0
    when (select count(*) from public.alumnos sibling
      where sibling.tutor_id = a.tutor_id
      and (coalesce(sibling.created_at,'infinity'::timestamp),sibling.id)
        < (coalesce(a.created_at,'infinity'::timestamp),a.id)) = 0 then 0
    when (select count(*) from public.alumnos sibling
      where sibling.tutor_id = a.tutor_id
      and (coalesce(sibling.created_at,'infinity'::timestamp),sibling.id)
        < (coalesce(a.created_at,'infinity'::timestamp),a.id)) = 1 then .10
    else .20 end
  from public.alumnos a where a.id = p_alumno_id;
$$;

create or replace function private.aplicar_descuento_hermano()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Do not reinterpret settled history or installments with an existing receipt.
  if public.cuota_esta_pagada(new.estado,null,0)
    or exists(select 1 from public.pagos where cuota_id = new.id)
    or new.monto is null or new.monto < 0 or new.descuento is null or new.descuento < 0 then
    return new;
  end if;
  new.descuento := greatest(new.descuento,
    round(new.monto::numeric * coalesce(public.descuento_hermano_tasa(new.alumno_id),0))::integer);
  return new;
end;
$$;
revoke all on function private.aplicar_descuento_hermano() from public,anon,authenticated;
create trigger cuotas_descuento_hermano before insert or update of monto,descuento,alumno_id on public.cuotas
  for each row execute function private.aplicar_descuento_hermano();
alter table public.cuotas alter column descuento set default 0, alter column recargo set default 0;

-- Reconcile only valid, unreceipted, unpaid invoices. Never rewrite payment rows.
update public.cuotas c set descuento = greatest(c.descuento,
  round(c.monto::numeric * coalesce(public.descuento_hermano_tasa(c.alumno_id),0))::integer)
where not public.cuota_esta_pagada(c.estado,public.cuota_total_centavos(c.monto,c.recargo,c.descuento),0)
  and public.cuota_total_centavos(c.monto,c.recargo,c.descuento) is not null
  and not exists(select 1 from public.pagos p where p.cuota_id=c.id);

create or replace function public.dashboard_alumnos()
returns table(id int,nombre varchar,apellido varchar,dni varchar,nivel varchar,curso varchar,tutor_id int,
  tutor_email varchar,arancel_base numeric,hermanos int,descuento_hermano numeric,
  cuotas_saldadas int,mora numeric,deuda numeric)
language sql stable security definer set search_path = '' as $$
  with balances as (
    select c.*, coalesce(sum(p.monto_abonado),0) as abonado,
      public.cuota_total_centavos(c.monto,c.recargo,c.descuento) as total
    from public.cuotas c left join public.pagos p on p.cuota_id=c.id group by c.id
  ), installments as (
    select b.*,public.cuota_esta_pagada(b.estado,b.total,b.abonado) as pagada from balances b
  ), families as (
    select a.*,case when a.tutor_id is null then 1 else count(*) over(partition by a.tutor_id) end::int as familia
    from public.alumnos a
  )
  select a.id,a.nombre,a.apellido,a.dni,a.nivel,a.curso,a.tutor_id,t.email,
    (a.arancel_base/100.0)::numeric,a.familia,public.descuento_hermano_tasa(a.id),
    count(c.id) filter(where c.pagada)::int,
    (coalesce(sum(case when not c.pagada and coalesce(c.fecha_vencimiento_2,c.fecha_vencimiento)<current_date
      then (current_date-coalesce(c.fecha_vencimiento_2,c.fecha_vencimiento))*5000::bigint else 0 end),0)/100.0)::numeric,
    (coalesce(sum(case when not c.pagada then greatest(c.total-c.abonado,0) else 0 end),0)/100.0)::numeric
  from families a left join installments c on c.alumno_id=a.id left join public.tutores t on t.id=a.tutor_id
  where public.current_user_role() in ('admin','secretaria')
    or (public.current_user_role()='tutor' and a.tutor_id=(auth.jwt()->>'tutor_id')::int)
  group by a.id,a.nombre,a.apellido,a.dni,a.nivel,a.curso,a.tutor_id,t.email,a.arancel_base,a.familia
  order by a.apellido,a.nombre,a.id;
$$;
revoke all on function public.dashboard_alumnos() from public,anon;
grant execute on function public.dashboard_alumnos() to authenticated;

create or replace function private.cobrar_cuota_segura(p_id integer,p_esperado integer,p_confirmado boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cuota public.cuotas%rowtype;
  total bigint;
  abonado bigint;
  restante bigint;
  invalidos bigint;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','secretaria') then
    return jsonb_build_object('success',false,'code','FORBIDDEN','error','No autorizado: solo admin y secretaria pueden registrar pagos');
  end if;
  select * into cuota from public.cuotas where id=p_id for update;
  if not found then
    return jsonb_build_object('success',false,'code','NOT_FOUND','error','Cuota no encontrada');
  end if;
  select coalesce(sum(monto_abonado),0),count(*) filter(where monto_abonado is null or monto_abonado<0)
    into abonado,invalidos from public.pagos where cuota_id=p_id;
  total := public.cuota_total_centavos(cuota.monto,cuota.recargo,cuota.descuento);
  if total is null or invalidos>0 then
    return jsonb_build_object('success',false,'code','INVALID_AMOUNT','error','La cuota requiere revisión de importes');
  end if;
  if public.cuota_esta_pagada(cuota.estado,total,abonado) then
    return jsonb_build_object('success',false,'code','ALREADY_PAID','error','Esta cuota ya está pagada',
      'pagado_total',abonado,'monto_total',total);
  end if;
  restante := total-abonado;
  if restante<=0 or restante>2147483647 or (p_confirmado and (p_esperado is null or p_esperado<=0)) then
    return jsonb_build_object('success',false,'code','INVALID_AMOUNT','error','La cuota requiere revisión de importes');
  end if;
  if p_confirmado and restante<>p_esperado then
    return jsonb_build_object('success',false,'code','AMOUNT_CHANGED','error','El importe cambió. Revise la cuota antes de confirmar.');
  end if;
  insert into public.pagos(cuota_id,monto_abonado,medio_pago,fecha_pago)
    values(p_id,restante::integer,'efectivo',current_date);
  update public.cuotas set estado='Pagada' where id=p_id;
  return jsonb_build_object('success',true,'message','Pago registrado',
    'monto_pagado',restante,'nuevo_pagado_total',abonado+restante);
exception when others then
  return jsonb_build_object('success',false,'code','DB_ERROR','error','Error al registrar el pago: ' || sqlerrm);
end;
$$;
revoke all on function private.cobrar_cuota_segura(integer,integer,boolean) from public,anon,authenticated;

create or replace function public.cobrar_cuota(p_cuota_id integer)
returns jsonb language sql security definer set search_path = '' as $$
  select private.cobrar_cuota_segura(p_cuota_id,null,false);
$$;
create or replace function public.cobrar_cuota_confirmada(p_cuota_id integer,p_monto_esperado integer)
returns jsonb language sql security definer set search_path = '' as $$
  select private.cobrar_cuota_segura(p_cuota_id,p_monto_esperado,true);
$$;
revoke all on function public.cobrar_cuota(integer),public.cobrar_cuota_confirmada(integer,integer) from public,anon;
grant execute on function public.cobrar_cuota(integer),public.cobrar_cuota_confirmada(integer,integer) to authenticated;

create or replace function public.aumentar_cuotas_pendientes_15()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','secretaria') then
    raise exception 'No autorizado: solo administración y secretaría pueden aumentar cuotas' using errcode='42501';
  end if;
  update public.cuotas c set monto=round(c.monto::numeric*1.15)::integer
  where not public.cuota_esta_pagada(c.estado,public.cuota_total_centavos(c.monto,c.recargo,c.descuento),0)
    and public.cuota_total_centavos(c.monto,c.recargo,c.descuento) is not null
    and not exists(select 1 from public.pagos p where p.cuota_id=c.id);
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.aumentar_cuotas_pendientes_15() from public,anon;
grant execute on function public.aumentar_cuotas_pendientes_15() to authenticated;

-- Preserve the alternate RPC while sharing the same authorization/invariants.
create or replace function public.aumentar_cuotas_impagas()
returns integer language sql security invoker set search_path = '' as $$
  select public.aumentar_cuotas_pendientes_15();
$$;
revoke all on function public.aumentar_cuotas_impagas() from public,anon;
grant execute on function public.aumentar_cuotas_impagas() to authenticated;

-- Enforce the same registration boundary for direct staff Data API writes.
-- Owner/service imports retain historical nullable records for explicit review.
create or replace function private.validar_alumno()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user='authenticated' and public.current_user_role() in ('admin','secretaria') then
    new.nombre := btrim(new.nombre);
    new.apellido := btrim(new.apellido);
    new.dni := btrim(new.dni);
    if coalesce(new.nombre,'')='' or coalesce(new.apellido,'')='' or coalesce(new.dni,'')=''
      or new.arancel_base is null or new.arancel_base<0 or new.tutor_id is null then
      raise exception 'Complete los datos del alumno y un arancel válido' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validar_alumno() from public,anon,authenticated;
create trigger alumnos_validar_registro before insert or update of nombre,apellido,dni,arancel_base,tutor_id
  on public.alumnos for each row execute function private.validar_alumno();
notify pgrst,'reload schema';
