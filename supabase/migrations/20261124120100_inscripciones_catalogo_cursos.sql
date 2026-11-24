-- Inscripciones 2027 (OC-2026-0147, TEC 6.2 step 2): the level/course rule lives in the database.
-- The frontend and the import RPC read this catalog instead of hard-coding the list.
create table public.cursos (
  nivel varchar not null,
  curso varchar not null,
  orden smallint not null unique,
  primary key (nivel, curso)
);

insert into public.cursos (nivel, curso, orden) values
  ('Inicial', 'Inicial', 1),
  ('Primario', '1º Primaria', 2),
  ('Primario', '2º Primaria', 3),
  ('Primario', '3º Primaria', 4),
  ('Primario', '4º Primaria', 5),
  ('Primario', '5º Primaria', 6),
  ('Primario', '6º Primaria', 7),
  ('Secundario', '1º Secundaria', 8),
  ('Secundario', '2º Secundaria', 9),
  ('Secundario', '3º Secundaria', 10),
  ('Secundario', '4º Secundaria', 11),
  ('Secundario', '5º Secundaria', 12),
  ('Secundario', '6º Secundaria', 13);

-- Read-only reference data for signed-in users; nobody writes it through the Data API.
alter table public.cursos enable row level security;
revoke all on public.cursos from anon, authenticated;
grant select on public.cursos to authenticated;
create policy cursos_lectura on public.cursos for select to authenticated using (true);

-- A student's course must belong to its level. Fails loudly if the cleanup missed a value.
alter table public.alumnos
  add constraint alumnos_nivel_curso_fkey
  foreign key (nivel, curso) references public.cursos (nivel, curso);
