-- Authentication & Authorization Schema
-- Adds perfiles table, Custom Access Token Hook, and updates RLS policies to use user_role claim

-- 1. Helper function to read custom 'user_role' claim (not Supabase 'role')
-- Must be created FIRST before any policies reference it
create or replace function current_user_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'user_role', 'anon');
$$;

-- 2. Create perfiles table linked to auth.users
create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_role text not null check (user_role in ('admin','secretaria','tutor')),
  tutor_id integer references tutores(id) unique,
  created_at timestamp default now()
);

-- 3. Enable RLS on perfiles
alter table perfiles enable row level security;

-- Users can only see their own perfil
create policy "own_perfil" on perfiles for select to authenticated
using (id = auth.uid());

-- Admins can manage all perfiles (uses custom user_role claim)
create policy "admin_perfil" on perfiles for all to authenticated
using (current_user_role() = 'admin')
with check (current_user_role() = 'admin');

-- 4. Recreate all table policies using user_role claim
-- Drop existing policies first (idempotent)
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

-- ADMIN: full access to everything
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

-- SECRETARIA: read/write all alumnos, tutores, cuotas, pagos
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

-- TUTOR: can only see their own tutor record and their children's data
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

-- 5. Custom Access Token Hook (Postgres function)
-- Runs as supabase_auth_admin, reads perfiles, injects user_role + tutor_id into JWT
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_user_role text;
  v_tutor_id int;
begin
  -- Fetch perfil for this user
  select p.user_role, p.tutor_id
  into v_user_role, v_tutor_id
  from public.perfiles p
  where p.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- Only set user_role if a valid perfil exists (no default fallback)
  if v_user_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_user_role));
  end if;

  -- Set tutor_id if present
  if v_tutor_id is not null then
    claims := jsonb_set(claims, '{tutor_id}', to_jsonb(v_tutor_id));
  end if;

  -- Return modified event with updated claims
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- 6. Grant permissions for supabase_auth_admin to execute hook and read perfiles
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant select on table public.perfiles to supabase_auth_admin;

-- Prevent direct client access to the hook function
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Ensure supabase_auth_admin can read all tables for hook operation (RLS bypass via policy)
grant select on alumnos, tutores, cuotas, pagos to supabase_auth_admin;