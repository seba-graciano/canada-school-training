-- Resolve authorization from the current profile instead of stale JWT role claims.
-- SECURITY DEFINER avoids recursion through perfiles RLS when policies call this helper.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select p.user_role
    from public.perfiles as p
    where p.id = auth.uid()
  ), 'anon');
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- Only administrators can see Auth identities. Return the minimum directory data.
create or replace function public.admin_list_accounts(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text := coalesce(p_search, '');
  v_total bigint;
  v_accounts jsonb;
begin
  if auth.uid() is null or public.current_user_role() <> 'admin' then
    raise exception using errcode = '42501', message = 'Insufficient privilege';
  end if;
  if length(v_search) > 254 or p_page is null or p_page < 1
     or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'Invalid account directory parameters';
  end if;

  select count(*) into v_total
  from auth.users as u
  where v_search = '' or strpos(lower(coalesce(u.email, '')), lower(v_search)) > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', directory.id,
    'email', directory.email,
    'user_role', directory.user_role
  ) order by lower(coalesce(directory.email, '')), directory.id), '[]'::jsonb)
  into v_accounts
  from (
    select u.id, u.email, p.user_role
    from auth.users as u
    left join public.perfiles as p on p.id = u.id
    where v_search = '' or strpos(lower(coalesce(u.email, '')), lower(v_search)) > 0
    order by lower(coalesce(u.email, '')), u.id
    limit p_page_size offset (p_page::bigint - 1) * p_page_size
  ) as directory;

  return jsonb_build_object(
    'accounts', v_accounts,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size
  );
end;
$$;

revoke all on function public.admin_list_accounts(text, integer, integer) from public, anon;
grant execute on function public.admin_list_accounts(text, integer, integer) to authenticated;

-- Serialize identity deletions that could remove an administrator. The lock and
-- count run in the same transaction as Auth's profile cascade.
create or replace function public.prevent_last_admin_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_admin_count bigint;
begin
  select p.user_role into v_role
  from public.perfiles as p
  where p.id = old.id;

  if v_role = 'admin' then
    perform pg_advisory_xact_lock(741239, 1);
    -- Row locks make a transaction using REPEATABLE READ fail closed if another
    -- transaction removed an administrator after its snapshot was established.
    perform p.id
    from public.perfiles as p
    where p.user_role = 'admin'
    order by p.id
    for update;
    select count(*) into v_admin_count
    from public.perfiles as p
    where p.user_role = 'admin';

    if v_admin_count <= 1 then
      raise exception using errcode = 'P0001',
        message = 'ACCOUNT_DIRECTORY_LAST_ADMIN: cannot delete the final administrator';
    end if;
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_last_admin_deletion() from public, anon, authenticated;
drop trigger if exists prevent_last_admin_deletion on auth.users;
create trigger prevent_last_admin_deletion
  before delete on auth.users
  for each row execute function public.prevent_last_admin_deletion();
