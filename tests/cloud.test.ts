import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudStore,
  ConflictError,
  validateCloudConfig,
  readCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
} from '../src/cloud';
import { createPlan } from '../src/model';

const config = {
  url: 'https://test-project.supabase.co',
  key: 'sb_publishable_test_public_key_1234',
};

test('deployment configuration works on a fresh device and respects local overrides and disconnection', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  try {
    assert.deepEqual(readCloudConfig(config), config);
    const override = { ...config, url: 'https://other-project.supabase.co' };
    saveCloudConfig(override);
    assert.deepEqual(readCloudConfig(config), override);
    clearCloudConfig();
    assert.equal(readCloudConfig(config), null);
    saveCloudConfig(config);
    assert.deepEqual(readCloudConfig(config), config);
    values.set('owol-cloud-config-v1', '{broken');
    assert.equal(readCloudConfig(config), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('cloud configuration accepts public keys and rejects administrator keys and ambiguous URLs', () => {
  assert.deepEqual(validateCloudConfig({ ...config, url: `${config.url}/` }), config);
  const jwt = (role: string) => `e30.${btoa(JSON.stringify({ role }))}.signature`;
  assert.equal(validateCloudConfig({ ...config, key: jwt('anon') }).key, jwt('anon'));
  for (const key of [
    'sb_secret_super_secret',
    jwt('service_role'),
    jwt('authenticated'),
    'not-a-key',
  ]) {
    assert.throws(() => validateCloudConfig({ ...config, key }), /공개 키/);
  }
  for (const url of [
    'http://project.supabase.co',
    'https://user:password@project.supabase.co',
    'https://project.supabase.co/path',
    'https://project.supabase.co/?token=secret',
  ]) {
    assert.throws(() => validateCloudConfig({ ...config, url }));
  }
});

test('stale shared save surfaces a conflict without retrying or mutating local edits', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.match(String(input), /\/rest\/v1\/rpc\/owol_save_workspace$/);
    sentBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        code: 'P0001',
        message: 'OWOL_REVISION_CONFLICT',
        details: null,
        hint: null,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const cloud = new CloudStore(config);
  const plan = createPlan();
  plan.profile.groom = '로컬 수정';
  try {
    await assert.rejects(cloud.saveWorkspace('workspace-id', plan, 3), ConflictError);
    assert.equal(requests, 1);
    assert.equal(sentBody?.p_expected_revision, 3);
    assert.equal(plan.profile.groom, '로컬 수정');
  } finally {
    cloud.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('malformed incoming cloud plans fail validation before entering the local plan', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'id',
        owner_id: 'owner',
        revision: 1,
        updated_at: new Date().toISOString(),
        plan: { version: 999 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  const cloud = new CloudStore(config);
  try {
    await assert.rejects(cloud.loadWorkspace('id'), /지원하지 않는 백업 형식/);
  } finally {
    cloud.dispose();
    globalThis.fetch = originalFetch;
  }
});
