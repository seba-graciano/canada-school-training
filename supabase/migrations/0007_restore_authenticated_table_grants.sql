-- Migration 0007: Restore minimum table grants for authenticated role
-- RLS policies require corresponding table privileges to be usable
-- Grants are minimal based on actual frontend operations

-- alumnos: SELECT (list, search), INSERT (create alumno)
grant select, insert on table public.alumnos to authenticated;

-- tutores: SELECT (contact info, tutor data)
grant select on table public.tutores to authenticated;

-- cuotas: UPDATE (apply 15% increase, mark as pagado)
grant update on table public.cuotas to authenticated;

-- pagos: SELECT (list, realtime), INSERT (register payment)
grant select, insert on table public.pagos to authenticated;

-- perfiles: NOT granted to authenticated
-- Frontend does not query perfiles directly
-- Only the Custom Access Token Hook (as supabase_auth_admin) reads perfiles

-- buscar_alumnos RPC: EXECUTE
grant execute on function public.buscar_alumnos(text) to authenticated;

-- Sequence access for inserts (serial/identity columns)
grant usage, select on all sequences in schema public to authenticated;