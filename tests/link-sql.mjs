// Optional PostgreSQL integration check. Pass a PGlite ESM module path as argv[2]
// when it is installed outside this project; otherwise @electric-sql/pglite is used.
// Example: node tests/link-sql.mjs <path-to-pglite/dist/index.js>
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite'
);
const db = new PGlite();
const setup = await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/link-workspace.sql', import.meta.url),
  'utf8',
);
const plan = {
  version: 1,
  profile: {},
  tasks: [],
  expenses: [],
  vendors: [],
  guests: [],
  notes: [],
};
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
const as = async (role) => {
  await db.exec(`reset role; set role ${role};`);
};
const load = (value = token) => db.query('select * from public.owol_link_load($1)', [value]);
const save = (value, body, revision) =>
  db.query('select * from public.owol_link_save($1,$2::jsonb,$3)', [
    value,
    JSON.stringify(body),
    revision,
  ]);

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role unrelated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(setup);
  await db.exec(migration);
  await db.exec(migration);
  const fixture = (
    await db.query(
      'insert into owol_private.link_workspaces(access_hash,plan) values ($1,$2::jsonb) returning id',
      [hash, JSON.stringify(plan)],
    )
  ).rows[0];

  await as('anon');
  const loaded = (await load()).rows[0];
  assert.equal(loaded.id, fixture.id);
  assert.deepEqual(loaded.plan, plan);
  assert.equal(Number(loaded.revision), 1);
  assert.deepEqual(Object.keys(loaded).sort(), ['id', 'plan', 'revision', 'updated_at']);
  await assert.rejects(db.query('select * from owol_private.link_workspaces'), /permission denied/);
  await assert.rejects(
    db.query('update owol_private.link_workspaces set revision=100'),
    /permission denied/,
  );
  await assert.rejects(db.query('select * from public.wedding_workspaces'), /permission denied/);
  await assert.rejects(db.query('select * from owol_private.wedding_invites'), /permission denied/);
  await assert.rejects(
    db.query('select * from public.owol_create_workspace($1::jsonb)', [JSON.stringify(plan)]),
    /permission denied/,
  );

  for (const wrong of [
    null,
    '',
    'short',
    'g'.repeat(64),
    'f'.repeat(64),
    'A'.repeat(64),
    '0'.repeat(65),
  ]) {
    await assert.rejects(load(wrong), /OWOL_LINK_INVALID/);
    await assert.rejects(save(wrong, null, 0), /OWOL_LINK_INVALID/);
  }
  await assert.rejects(save(token, null, 1), /OWOL_PLAN_INVALID/);
  await assert.rejects(save(token, { ...plan, tasks: {} }, 1), /OWOL_PLAN_INVALID/);
  await assert.rejects(save(token, { ...plan, version: 2 }, 1), /OWOL_PLAN_INVALID/);
  await assert.rejects(
    save(token, { ...plan, oversized: 'x'.repeat(5242881) }, 1),
    /OWOL_PLAN_INVALID/,
  );
  await assert.rejects(save(token, plan, null), /OWOL_REVISION_CONFLICT/);
  await assert.rejects(save(token, plan, 0), /OWOL_REVISION_CONFLICT/);
  assert.equal(Number((await load()).rows[0].revision), 1);

  const results = await Promise.allSettled([
    save(token, { ...plan, notes: [{ content: 'first writer' }] }, 1),
    save(token, { ...plan, notes: [{ content: 'second writer' }] }, 1),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.match(rejected.reason.message, /OWOL_REVISION_CONFLICT/);
  const saved = (await load()).rows[0];
  assert.equal(Number(saved.revision), 2);

  await as('authenticated');
  assert.equal((await load()).rows[0].id, fixture.id);
  await assert.rejects(db.query('select * from owol_private.link_workspaces'), /permission denied/);
  await as('unrelated');
  await assert.rejects(load(), /permission denied/);

  await db.exec('reset role');
  const flags = (
    await db.query(`
    select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'SELECT') as anon_select,
      has_table_privilege('authenticated',c.oid,'SELECT') as member_select
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='owol_private' and c.relname='link_workspaces'
  `)
  ).rows[0];
  assert.deepEqual(flags, { rls: true, anon_select: false, member_select: false });
  const wrappers = (
    await db.query(`
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('owol_link_load','owol_link_save')
  `)
  ).rows;
  assert.equal(wrappers.length, 2);
  assert.ok(wrappers.every((wrapper) => wrapper.prosecdef === false));
  await db.exec(migration);
  await as('anon');
  assert.deepEqual((await load()).rows[0].plan, saved.plan);
  assert.equal(Number((await load()).rows[0].revision), 2);

  await db.exec('reset role');
  const rotatedToken = randomBytes(32).toString('hex');
  await db.query('update owol_private.link_workspaces set access_hash=$1 where id=$2', [
    createHash('sha256').update(rotatedToken).digest('hex'),
    fixture.id,
  ]);
  await as('anon');
  await assert.rejects(load(), /OWOL_LINK_INVALID/);
  assert.equal((await load(rotatedToken)).rows[0].id, fixture.id);
  console.log(
    'Link SQL checks passed: token isolation, no table access, input validation, stale-write protection, token rotation, idempotence, RLS and invoker wrappers.',
  );
} finally {
  await db.close();
}
