import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCloudConfig,
  readCloudConfig,
  saveCloudConfig,
  clearCloudConfig,
} from '../src/cloud';

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
