-- Inscripciones 2027 (OC-2026-0147, TEC 6.2 step 3): a student and a guardian are identified by DNI (R-05).
-- UNIQUE gives the import RPC something to collide with in ON CONFLICT (dni).
alter table public.alumnos add constraint alumnos_dni_key unique (dni);
alter table public.tutores add constraint tutores_dni_key unique (dni);

-- NOT VALID enforces the rule on every new or updated row without checking existing rows.
-- VALIDATE CONSTRAINT checks existing rows later, under a lock that does not block writes.
alter table public.alumnos
  add constraint alumnos_dni_formato check (dni ~ '^[0-9]{7,8}$') not valid;
alter table public.alumnos validate constraint alumnos_dni_formato;

-- Left unvalidated on purpose: the 2026-11-24 audit found one guardian account with an
-- 11-digit DNI, created before this rule. Validate after that row is reviewed.
-- Until then, any UPDATE of that row must also fix its DNI.
alter table public.tutores
  add constraint tutores_dni_formato check (dni ~ '^[0-9]{7,8}$') not valid;

-- Staff student creation: same normalization as the import, with a readable error.
create or replace function private.validar_alumno()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user='authenticated' and public.current_user_role() in ('admin','secretaria') then
    new.nombre := btrim(new.nombre);
    new.apellido := btrim(new.apellido);
    new.dni := regexp_replace(new.dni, '[.[:space:]]', '', 'g');
    if coalesce(new.nombre,'')='' or coalesce(new.apellido,'')='' or coalesce(new.dni,'')=''
      or new.arancel_base is null or new.arancel_base<0 or new.tutor_id is null then
      raise exception 'Complete los datos del alumno y un arancel válido' using errcode='22023';
    end if;
    if new.dni !~ '^[0-9]{7,8}$' then
      raise exception 'El DNI debe tener 7 u 8 dígitos' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validar_alumno() from public,anon,authenticated;
