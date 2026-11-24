-- Inscripciones 2027 (OC-2026-0147, R-14, TEC 6.2 step 5): one row per confirmed import.
-- Only the import RPC (SECURITY DEFINER) inserts rows; only administrators read them.
create table public.importaciones (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  -- Snapshot of who imported, so the log stays readable if the account changes later.
  usuario_email text not null,
  fecha timestamptz not null default now(),
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 255),
  -- SHA-256 of the uploaded file in lowercase hex; detects re-uploads of the same file (R-09).
  hash_archivo text not null check (hash_archivo ~ '^[0-9a-f]{64}$'),
  alumnos_creados integer not null default 0 check (alumnos_creados >= 0),
  alumnos_actualizados integer not null default 0 check (alumnos_actualizados >= 0),
  tutores_creados integer not null default 0 check (tutores_creados >= 0),
  tutores_actualizados integer not null default 0 check (tutores_actualizados >= 0)
);

create index importaciones_hash_archivo_idx on public.importaciones (hash_archivo, fecha desc);

alter table public.importaciones enable row level security;
revoke all on public.importaciones from anon, authenticated;
grant select on public.importaciones to authenticated;
create policy importaciones_lectura_admin on public.importaciones
  for select to authenticated
  using (public.current_user_role() = 'admin');
