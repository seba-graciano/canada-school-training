-- Migration 0013: RPC aumentar_cuotas_pendientes_15
-- Aplica aumento 15% a todas las cuotas NO saldadas en una sola query SQL
-- Evita límite 1000 de PostgREST y 1500 requests secuenciales

create or replace function public.aumentar_cuotas_pendientes_15()
returns int  -- cantidad de cuotas actualizadas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update cuotas
  set monto = round(monto * 1.15)::bigint
  where not (
    -- MISMA lógica de "saldada" que dashboard_alumnos():
    -- 1. Pagos cubren el monto
    exists (
      select 1 from pagos p where p.cuota_id = cuotas.id
      having sum(p.monto_abonado) >= cuotas.monto
    )
    -- 2. O estado marcado como pagado
    or lower(estado) in ('pagado','pago','ok')
  );
  
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.aumentar_cuotas_pendientes_15() to authenticated;
revoke execute on function public.aumentar_cuotas_pendientes_15() from anon;