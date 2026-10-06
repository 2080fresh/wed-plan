-- Apply after setup.sql, as the project administrator.
-- No accounts are needed: possession of a random 256-bit link token authorizes
-- reading and editing exactly one plan. Only its SHA-256 hash is stored here.
-- Provision rows administratively; there is deliberately no create/list RPC.
-- Re-running preserves all existing plans and tokens.
begin;

create schema if not exists owol_private;
revoke all on schema owol_private from public;
revoke create on schema owol_private from anon, authenticated;
grant usage on schema owol_private to anon, authenticated;

create table if not exists owol_private.link_workspaces (
  id uuid primary key default gen_random_uuid(),
  access_hash text not null unique check (access_hash ~ '^[a-f0-9]{64}$'),
  plan jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table owol_private.link_workspaces enable row level security;
revoke all on owol_private.link_workspaces from public, anon, authenticated;

-- No table policies or grants are intentional. Only the two guarded definer
-- bodies below may access the table; the exposed wrappers remain invokers.
create or replace function owol_private.link_load(p_token text)
returns table (id uuid, plan jsonb, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'OWOL_LINK_INVALID';
  end if;
  return query
    select w.id, w.plan, w.revision, w.updated_at
    from owol_private.link_workspaces w
    where w.access_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex'
    );
  if not found then raise exception 'OWOL_LINK_INVALID'; end if;
end;
$$;

create or replace function owol_private.link_save(
  p_token text, p_plan jsonb, p_expected_revision bigint
)
returns table (id uuid, plan jsonb, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_revision bigint;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'OWOL_LINK_INVALID';
  end if;
  -- Serialize saves and administrative token rotation on this row. Never reveal
  -- whether a plan or revision exists until the caller proves token possession.
  select w.id, w.revision into v_id, v_revision
    from owol_private.link_workspaces w
    where w.access_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex'
    ) for update;
  if not found then raise exception 'OWOL_LINK_INVALID'; end if;
  if p_expected_revision is distinct from v_revision then
    raise exception 'OWOL_REVISION_CONFLICT';
  end if;
  perform owol_private.require_plan(p_plan);
  return query
    update owol_private.link_workspaces w
      set plan = p_plan, revision = w.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where w.id = v_id and w.revision = p_expected_revision
      returning w.id, w.plan, w.revision, w.updated_at;
  if not found then raise exception 'OWOL_REVISION_CONFLICT'; end if;
end;
$$;

create or replace function public.owol_link_load(p_token text)
returns table (id uuid, plan jsonb, revision bigint, updated_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from owol_private.link_load(p_token);
$$;
create or replace function public.owol_link_save(
  p_token text, p_plan jsonb, p_expected_revision bigint
)
returns table (id uuid, plan jsonb, revision bigint, updated_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from owol_private.link_save(p_token, p_plan, p_expected_revision);
$$;

revoke all on function owol_private.link_load(text),
  owol_private.link_save(text, jsonb, bigint),
  public.owol_link_load(text), public.owol_link_save(text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function owol_private.link_load(text),
  owol_private.link_save(text, jsonb, bigint),
  public.owol_link_load(text), public.owol_link_save(text, jsonb, bigint)
  to anon, authenticated;

commit;
