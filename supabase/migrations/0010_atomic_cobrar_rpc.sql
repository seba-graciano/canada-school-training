-- Migration 0010: Atomic cobrar RPC to prevent race conditions
-- Creates a server-side function that atomically registers a payment and updates the quota state
-- Only admin and secretaria roles can execute this function (tutors are explicitly rejected)

create or replace function cobrar_cuota(p_cuota_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota record;
  v_pagado_total integer;
  v_monto_a_pagar integer;
  v_ya_pagada boolean;
  v_caller_role text;
begin
  -- Authorization check: only admin and secretaria can register payments
  v_caller_role := current_user_role();
  if v_caller_role not in ('admin', 'secretaria') then
    return jsonb_build_object(
      'success', false,
      'error', 'No autorizado: solo admin y secretaria pueden registrar pagos',
      'code', 'FORBIDDEN'
    );
  end if;

  -- Lock the cuota row to serialize concurrent access
  select *
  into v_cuota
  from cuotas
  where id = p_cuota_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Cuota no encontrada',
      'code', 'NOT_FOUND'
    );
  end if;

  -- Calculate total already paid for this cuota
  select coalesce(sum(monto_abonado), 0)
  into v_pagado_total
  from pagos
  where cuota_id = p_cuota_id;

  -- Amount to pay for this installment (including recargo/descuento)
  v_monto_a_pagar := v_cuota.monto + v_cuota.recargo - v_cuota.descuento;

  -- Check if already fully paid (using >= to handle any edge cases)
  v_ya_pagada := v_pagado_total >= v_monto_a_pagar;

  if v_ya_pagada then
    return jsonb_build_object(
      'success', false,
      'error', 'Esta cuota ya está pagada',
      'code', 'ALREADY_PAID',
      'pagado_total', v_pagado_total,
      'monto_total', v_monto_a_pagar
    );
  end if;

  -- Insert the payment
  insert into pagos (cuota_id, monto_abonado, medio_pago, fecha_pago)
  values (p_cuota_id, v_monto_a_pagar, 'efectivo', now()::date);

  -- Update cuota estado
  update cuotas
  set estado = 'pagado'
  where id = p_cuota_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Pago registrado',
    'monto_pagado', v_monto_a_pagar,
    'nuevo_pagado_total', v_pagado_total + v_monto_a_pagar
  );

exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', 'Error al registrar el pago: ' || sqlerrm,
      'code', 'DB_ERROR'
    );
end;
$$;

-- Grant execute permission to authenticated users (RLS + function auth check enforce admin/secretaria only)
grant execute on function cobrar_cuota(integer) to authenticated;