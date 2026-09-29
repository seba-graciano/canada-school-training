-- Migration 0006: Allow supabase_auth_admin to read perfiles for Custom Access Token Hook
-- Required because hook runs as supabase_auth_admin and perfiles has RLS enabled
-- Safe: SELECT only, internal role only, no write access

-- Idempotent: drop if exists then create
drop policy if exists "hook_perfil_read" on public.perfiles;

create policy "hook_perfil_read"
on public.perfiles
for select
to supabase_auth_admin
using (true);