-- Run once in the Supabase SQL Editor as the project administrator.
-- Re-running preserves plans; this is not a destructive reset script.
begin;

create schema if not exists owol_private;
revoke all on schema owol_private from public, anon;
grant usage on schema owol_private to authenticated;

create table if not exists public.wedding_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.wedding_members (
  workspace_id uuid not null references public.wedding_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists wedding_members_user_idx on public.wedding_members(user_id);
create table if not exists owol_private.wedding_invites (
  workspace_id uuid primary key references public.wedding_workspaces(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null
);

alter table public.wedding_workspaces enable row level security;
alter table public.wedding_members enable row level security;
alter table owol_private.wedding_invites enable row level security;
revoke all on public.wedding_workspaces, public.wedding_members from public, anon, authenticated;
revoke all on owol_private.wedding_invites from public, anon, authenticated;
grant select on public.wedding_workspaces, public.wedding_members to authenticated;

drop policy if exists owol_members_read_self on public.wedding_members;
create policy owol_members_read_self on public.wedding_members for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists owol_workspaces_read_members on public.wedding_workspaces;
create policy owol_workspaces_read_members on public.wedding_workspaces for select to authenticated
  using (exists (
    select 1 from public.wedding_members m
    where m.workspace_id = wedding_workspaces.id and m.user_id = (select auth.uid())
  ));

-- Privileged bodies are kept outside exposed schemas. Invoker RPC wrappers below
-- expose exactly four actions; every body checks the authenticated user explicitly.
create or replace function owol_private.require_plan(p_plan jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_plan is null or jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan->>'version' is distinct from '1'
    or jsonb_typeof(p_plan->'profile') is distinct from 'object'
    or jsonb_typeof(p_plan->'tasks') is distinct from 'array'
    or jsonb_typeof(p_plan->'expenses') is distinct from 'array'
    or jsonb_typeof(p_plan->'vendors') is distinct from 'array'
    or jsonb_typeof(p_plan->'guests') is distinct from 'array'
    or jsonb_typeof(p_plan->'notes') is distinct from 'array'
    or octet_length(p_plan::text) > 5242880 then
    raise exception 'OWOL_PLAN_INVALID';
  end if;
end;
$$;

create or replace function owol_private.create_workspace(p_plan jsonb)
returns setof public.wedding_workspaces language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'OWOL_AUTH_REQUIRED'; end if;
  perform owol_private.require_plan(p_plan);
  insert into public.wedding_workspaces(owner_id, plan) values (v_user, p_plan) returning id into v_id;
  insert into public.wedding_members(workspace_id, user_id) values (v_id, v_user);
  return query select * from public.wedding_workspaces where id = v_id;
end;
$$;

create or replace function owol_private.issue_invite(p_workspace_id uuid, p_rotate boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_token text;
begin
  if v_user is null then raise exception 'OWOL_AUTH_REQUIRED'; end if;
  select owner_id into v_owner from public.wedding_workspaces where id = p_workspace_id for update;
  if v_owner is distinct from v_user then raise exception 'OWOL_OWNER_ONLY'; end if;
  if (select count(*) from public.wedding_members where workspace_id = p_workspace_id) >= 2 then
    raise exception 'OWOL_WORKSPACE_FULL';
  end if;
  if not coalesce(p_rotate, false) then
    select token into v_token from owol_private.wedding_invites
      where workspace_id = p_workspace_id and expires_at > now();
    if v_token is not null then return v_token; end if;
  end if;
  -- Two cryptographically random UUIDs provide 244 random bits; no extension needed.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into owol_private.wedding_invites(workspace_id, token, expires_at)
    values (p_workspace_id, v_token, now() + interval '7 days')
    on conflict (workspace_id) do update set token = excluded.token, expires_at = excluded.expires_at;
  return v_token;
end;
$$;

create or replace function owol_private.join_workspace(p_token text)
returns setof public.wedding_workspaces language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'OWOL_AUTH_REQUIRED'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'OWOL_INVITE_INVALID'; end if;
  select workspace_id into v_id from owol_private.wedding_invites where token = p_token and expires_at > now();
  if v_id is null then raise exception 'OWOL_INVITE_INVALID'; end if;
  -- Serialize joining and invite rotation on the same workspace row.
  perform 1 from public.wedding_workspaces where id = v_id for update;
  if not exists (select 1 from owol_private.wedding_invites where workspace_id = v_id and token = p_token and expires_at > now()) then
    raise exception 'OWOL_INVITE_INVALID';
  end if;
  if exists (select 1 from public.wedding_members where workspace_id = v_id and user_id = v_user) then
    return query select * from public.wedding_workspaces where id = v_id;
    return;
  end if;
  if (select count(*) from public.wedding_members where workspace_id = v_id) >= 2 then raise exception 'OWOL_WORKSPACE_FULL'; end if;
  insert into public.wedding_members(workspace_id, user_id) values (v_id, v_user);
  delete from owol_private.wedding_invites where workspace_id = v_id;
  return query select * from public.wedding_workspaces where id = v_id;
end;
$$;

create or replace function owol_private.save_workspace(p_workspace_id uuid, p_plan jsonb, p_expected_revision bigint)
returns setof public.wedding_workspaces language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'OWOL_AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.wedding_members where workspace_id = p_workspace_id and user_id = v_user) then
    raise exception 'OWOL_NOT_MEMBER';
  end if;
  perform owol_private.require_plan(p_plan);
  return query update public.wedding_workspaces
    set plan = p_plan, revision = revision + 1, updated_at = clock_timestamp()
    where id = p_workspace_id and revision = p_expected_revision
    returning *;
  if not found then raise exception 'OWOL_REVISION_CONFLICT'; end if;
end;
$$;

create or replace function public.owol_create_workspace(p_plan jsonb)
returns setof public.wedding_workspaces language sql security invoker set search_path = '' as $$
  select * from owol_private.create_workspace(p_plan);
$$;
create or replace function public.owol_issue_invite(p_workspace_id uuid, p_rotate boolean default false)
returns text language sql security invoker set search_path = '' as $$
  select owol_private.issue_invite(p_workspace_id, p_rotate);
$$;
create or replace function public.owol_join_workspace(p_token text)
returns setof public.wedding_workspaces language sql security invoker set search_path = '' as $$
  select * from owol_private.join_workspace(p_token);
$$;
create or replace function public.owol_save_workspace(p_workspace_id uuid, p_plan jsonb, p_expected_revision bigint)
returns setof public.wedding_workspaces language sql security invoker set search_path = '' as $$
  select * from owol_private.save_workspace(p_workspace_id, p_plan, p_expected_revision);
$$;

revoke all on function owol_private.require_plan(jsonb) from public, anon, authenticated;
revoke all on function owol_private.create_workspace(jsonb) from public, anon;
revoke all on function owol_private.issue_invite(uuid, boolean) from public, anon;
revoke all on function owol_private.join_workspace(text) from public, anon;
revoke all on function owol_private.save_workspace(uuid, jsonb, bigint) from public, anon;
grant execute on function owol_private.create_workspace(jsonb), owol_private.issue_invite(uuid, boolean),
  owol_private.join_workspace(text), owol_private.save_workspace(uuid, jsonb, bigint) to authenticated;
revoke all on function public.owol_create_workspace(jsonb), public.owol_issue_invite(uuid, boolean),
  public.owol_join_workspace(text), public.owol_save_workspace(uuid, jsonb, bigint) from public, anon;
grant execute on function public.owol_create_workspace(jsonb), public.owol_issue_invite(uuid, boolean),
  public.owol_join_workspace(text), public.owol_save_workspace(uuid, jsonb, bigint) to authenticated;

commit;
