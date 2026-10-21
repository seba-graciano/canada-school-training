-- Convert known historical labels once; all subsequent writes must be canonical.
begin;

-- Keep validation and conversion on the same stable set of rows.
lock table public.cuotas in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.cuotas
    where estado is null
      or lower(btrim(estado)) not in ('pagado','pagada','pago','ok','pendiente','vencida','vencido')
  ) then
    raise exception 'Cannot normalize unknown or null installment states' using errcode='22023';
  end if;
end;
$$;

alter table public.cuotas
  drop constraint if exists cuotas_estado_check;

-- Do not update amounts, discounts, surcharges, dates or payment records.
update public.cuotas
set estado = case
  when lower(btrim(estado)) in ('pagado','pagada','pago','ok') then 'Pagada'
  when lower(btrim(estado)) = 'pendiente' then 'Pendiente'
  when lower(btrim(estado)) in ('vencida','vencido') then 'Vencida'
end
where estado not in ('Pagada','Pendiente','Vencida');

alter table public.cuotas
  alter column estado set default 'Pendiente',
  alter column estado set not null,
  add constraint cuotas_estado_check
    check (estado in ('Pagada','Pendiente','Vencida'));

create or replace function public.cuota_esta_pagada(p_estado text,p_total bigint,p_pagado bigint)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_estado in ('Pagada','Pendiente','Vencida')
    and (p_estado='Pagada' or (p_total is not null and coalesce(p_pagado,0)>=p_total)),false);
$$;

commit;
