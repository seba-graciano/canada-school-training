-- Inscripciones 2027 (OC-2026-0147, TEC 6.2 step 4): guardians can now exist before their account
-- (imported from the enrollment sheet). Creating the account links the guardian with the same DNI
-- instead of inserting a duplicate, which UNIQUE(dni) would reject.
-- Only the tutor branch changes; role checks and staff accounts are unchanged from 0017.
create or replace function private.provision_tutor_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor_id integer;
  v_data jsonb := new.raw_user_meta_data;
  v_app_data jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_actor text;
  v_role text;
  v_dni text := regexp_replace(coalesce(new.raw_user_meta_data->>'dni', ''), '[.[:space:]]', '', 'g');
begin
  -- Existing assignments are authoritative; provider/metadata updates must not
  -- recreate guardians, overwrite roles or recheck the original creator.
  if exists (select 1 from public.perfiles where id = new.id) then
    return new;
  end if;

  if v_app_data ? 'provision_account_by' then
    if v_app_data ? 'provision_tutor_by' then
      raise exception 'Ambiguous account provisioning marker' using errcode = '22023';
    end if;
    v_actor := v_app_data ->> 'provision_account_by';
    v_role := v_app_data ->> 'provision_account_role';
  elsif v_app_data ? 'provision_tutor_by' then
    -- Legacy endpoint is always tutor-only, regardless of editable metadata.
    if v_app_data ? 'provision_account_role' then
      raise exception 'Invalid legacy account role' using errcode = '22023';
    end if;
    v_actor := v_app_data ->> 'provision_tutor_by';
    v_role := 'tutor';
  elsif v_app_data ? 'provision_account_role' then
    raise exception 'Missing account provisioning actor' using errcode = '22023';
  else
    return new;
  end if;
  if v_role is null or v_role not in ('tutor', 'admin', 'secretaria') then
    raise exception 'Invalid account role' using errcode = '22023';
  end if;

  -- Auth creates users outside the caller's JWT session. Check the protected
  -- actor ID against the current profile and hold it stable for this transaction.
  perform 1 from public.perfiles
    where id = v_actor::uuid
      and user_role = 'admin'
    for share;
  if not found then
    raise exception 'Only administrators can create accounts' using errcode = '42501';
  end if;

  if coalesce(length(trim(v_data->>'nombre')), 0) not between 1 and 100
    or coalesce(length(trim(v_data->>'apellido')), 0) not between 1 and 100
    or coalesce(length(new.email), 0) not between 3 and 254
    or (v_role = 'tutor' and (
      v_dni !~ '^[0-9]{7,8}$'
      or coalesce(length(v_data->>'telefono'), 0) > 40
    )) then
    raise exception 'Invalid account data' using errcode = '22023';
  end if;

  if v_role = 'tutor' then
    -- ON CONFLICT also covers two accounts created at the same time for the same new DNI.
    insert into public.tutores(nombre, apellido, dni, email, telefono)
      values (trim(v_data->>'nombre'), trim(v_data->>'apellido'), v_dni,
        lower(new.email), nullif(trim(v_data->>'telefono'), ''))
      on conflict (dni) do nothing
      returning id into v_tutor_id;
    if v_tutor_id is null then
      -- Imported guardian: keep its data and only fill a missing contact email.
      update public.tutores
        set email = coalesce(email, lower(new.email))
        where dni = v_dni
        returning id into v_tutor_id;
    end if;
  end if;
  insert into public.perfiles(id, user_role, tutor_id)
    values (new.id, v_role, v_tutor_id);
  return new;
end;
$$;
revoke all on function private.provision_tutor_account() from public, anon, authenticated;
