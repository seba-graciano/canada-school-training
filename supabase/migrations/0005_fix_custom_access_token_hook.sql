-- Migration 0005: Fix Custom Access Token Hook return format
-- Only changes the return value from full event to { claims: ... }
-- Supabase Custom Access Token Hook contract requires: { "claims": <object> }

-- Re-create the hook with correct return format
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
  -- Fetch perfil for this user (unchanged)
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

  -- FIX: Return only { claims: ... } per Supabase hook contract
  -- Was: return jsonb_set(event, '{claims}', claims);
  return jsonb_build_object('claims', claims);
end;
$$;

-- Permissions unchanged (idempotent re-grants)
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on table public.perfiles to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;