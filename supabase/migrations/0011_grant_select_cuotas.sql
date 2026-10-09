-- Migration 0011: Grant SELECT on cuotas to authenticated
-- Fixes: authenticated role cannot SELECT from cuotas (only UPDATE was granted in 0007)
-- Required for AdminDashboard.cargar() to load cuotas for mora/saldadas/deuda calculations

grant select on table public.cuotas to authenticated;