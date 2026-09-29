create table tutores (
  id serial primary key,
  nombre varchar,
  apellido varchar,
  dni varchar,
  email varchar,
  telefono varchar,
  created_at timestamp default now()
);
create table alumnos (
  id serial primary key,
  nombre varchar,
  apellido varchar,
  dni varchar,
  nivel varchar,
  curso varchar,
  tutor_id integer references tutores(id) on delete cascade,
  arancel_base float,
  activo boolean default true,
  created_at timestamp default now()
);
create table cuotas (
  id serial primary key,
  alumno_id integer references alumnos(id) on delete cascade,
  concepto varchar,
  mes integer,
  anio integer,
  monto float,
  descuento float,
  recargo float,
  estado varchar,
  fecha_vencimiento varchar,
  created_at timestamp default now()
);
create table pagos (
  id serial primary key,
  cuota_id integer references cuotas(id) on delete cascade,
  monto_abonado float,
  medio_pago varchar,
  fecha_pago varchar,
  created_at timestamp default now()
);

-- Enable Row Level Security on all tables
alter table alumnos enable row level security;
alter table tutores enable row level security;
alter table cuotas enable row level security;
alter table pagos enable row level security;

-- Revoke default Supabase grants that bypass RLS
revoke all on alumnos, tutores, cuotas, pagos from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on all sequences in schema public to anon, authenticated;

-- Helper function to get current user role from JWT
create or replace function current_user_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;

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

create or replace function buscar_alumnos(q text)
returns setof alumnos as $$
begin
  return query execute format('select * from alumnos where nombre ilike %L or apellido ilike %L', '%' || q || '%', '%' || q || '%');
end;
$$ language plpgsql;
