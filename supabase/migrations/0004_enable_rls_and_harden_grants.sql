-- Migration 0004: Enable RLS on core tables and harden grants
-- Safe to run after 0001, 0002, 0003 are applied
-- Fixes: rowsecurity=false on alumnos/tutores/cuotas/pagos, overly permissive grants

-- 1. Enable RLS on all four core tables (idempotent)
-- Use FORCE ROW LEVEL SECURITY to ensure even table owners are subject to policies
alter table if exists alumnos enable row level security;
alter table if exists tutores enable row level security;
alter table if exists cuotas enable row level security;
alter table if exists pagos enable row level security;

-- Force RLS so policies apply to all roles including table owners
alter table if exists alumnos force row level security;
alter table if exists tutores force row level security;
alter table if exists cuotas force row level security;
alter table if exists pagos force row level security;

-- 2. Verify/preserve policies from 0003 (idempotent drops + recreates)
-- These use current_user_role() which reads custom 'user_role' JWT claim

-- Drop any duplicate/old policies that might have different names
drop policy if exists "admin_all_alumnos" on alumnos;
drop policy if exists "admin_all_tutores" on tutores;
drop policy if exists "admin_all_cuotas" on cuotas;
drop policy if exists "admin_all_pagos" on pagos;
drop policy if exists "secretaria_all_alumnos" on alumnos;
drop policy if exists "secretaria_all_tutores" on tutores;
drop policy if exists "secretaria_all_cuotas" on cuotas;
drop policy if exists "secretaria_all_pagos" on pagos;
drop policy if exists "tutor_own_tutor" on tutores;
drop policy if exists "tutor_own_alumnos" on alumnos;
drop policy if exists "tutor_own_cuotas" on cuotas;
drop policy if exists "tutor_own_pagos" on pagos;

-- ADMIN: full access
create policy "admin_all_alumnos" on alumnos for all to authenticated
using (current_user_role() = 'admin')
with check (current_user_role() = 'admin');

create policy "admin_all_tutores" on tutores for all to authenticated
using (current_user_role() = 'admin')
with check (current_user_role() = 'admin');

create policy "admin_all_cuotas" on cuotas for all to authenticated
using (current_user_role() = 'admin')
with check (current_user_role() = 'admin');

create policy "admin_all_pagos" on pagos for all to authenticated
using (current_user_role() = 'admin')
with check (current_user_role() = 'admin');

-- SECRETARIA: full access
create policy "secretaria_all_alumnos" on alumnos for all to authenticated
using (current_user_role() = 'secretaria')
with check (current_user_role() = 'secretaria');

create policy "secretaria_all_tutores" on tutores for all to authenticated
using (current_user_role() = 'secretaria')
with check (current_user_role() = 'secretaria');

create policy "secretaria_all_cuotas" on cuotas for all to authenticated
using (current_user_role() = 'secretaria')
with check (current_user_role() = 'secretaria');

create policy "secretaria_all_pagos" on pagos for all to authenticated
using (current_user_role() = 'secretaria')
with check (current_user_role() = 'secretaria');

-- TUTOR: SELECT only on own data
create policy "tutor_own_tutor" on tutores for select to authenticated
using (current_user_role() = 'tutor' and id = (auth.jwt() ->> 'tutor_id')::int);

create policy "tutor_own_alumnos" on alumnos for select to authenticated
using (current_user_role() = 'tutor' and tutor_id = (auth.jwt() ->> 'tutor_id')::int);

create policy "tutor_own_cuotas" on cuotas for select to authenticated
using (current_user_role() = 'tutor' and alumno_id in (
  select id from alumnos where tutor_id = (auth.jwt() ->> 'tutor_id')::int
));

create policy "tutor_own_pagos" on pagos for select to authenticated
using (current_user_role() = 'tutor' and cuota_id in (
  select id from cuotas where alumno_id in (
    select id from alumnos where tutor_id = (auth.jwt() ->> 'tutor_id')::int
  )
));

-- 3. Harden grants: revoke excessive direct table grants from anon/authenticated
-- RLS policies control all access; direct grants bypass RLS
revoke all on alumnos, tutores, cuotas, pagos, perfiles from anon, authenticated;

-- Minimal grants required for Supabase client operation
grant usage on schema public to anon, authenticated;
grant select on all sequences in schema public to anon, authenticated;

-- 4. Ensure supabase_auth_admin can read perfiles for Custom Access Token Hook
-- (Already granted in 0003, but idempotent re-grant is safe)
grant select on table public.perfiles to supabase_auth_admin;

-- supabase_auth_admin does NOT need grants on alumnos/tutores/cuotas/pagos
-- The hook only reads perfiles. Application queries go through authenticated role + RLS.

-- 5. Verify current_user_role() function exists and uses correct claim
-- (Created in 0003, but ensure it's correct)
create or replace function current_user_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'user_role', 'anon');
$$;