-- The plan remains in the private schema with no direct table access.
-- Public websocket messages contain only {} on an unguessable digest topic.
-- Receiving a notification never grants access to the plan's RPCs.
begin;
create or replace function owol_private.notify_link_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'owol:' || new.access_hash, false);
  return new;
end;
$$;
revoke all on function owol_private.notify_link_change() from public, anon, authenticated;
drop trigger if exists owol_link_changed on owol_private.link_workspaces;
create trigger owol_link_changed after update of plan on owol_private.link_workspaces
for each row when (old.plan is distinct from new.plan)
execute function owol_private.notify_link_change();
commit;
