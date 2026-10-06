import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError,
  InvalidLinkError,
  LinkCloud,
  createLinkCloud,
  formatConnectionLink,
  parseConnectionToken,
} from '../src/linkCloud';
import { createPlan, type Plan } from '../src/model';

const token = 'a1'.repeat(32);
const site = 'https://2080fresh.github.io/wed-plan/';
const config = {
  url: 'https://test-project.supabase.co',
  key: 'sb_publishable_test_public_key_1234',
};
const row = (plan = createPlan()) => ({
  id: 'workspace-id',
  plan,
  revision: 3,
  updated_at: '2026-10-06T00:00:00.000Z',
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('connection links keep tokens only in a same-site fragment', () => {
  const link = formatConnectionLink(` ${token} `, `${site}?old=setting#settings`);
  const parsed = new URL(link);
  assert.equal(parsed.origin + parsed.pathname, site.slice(0, -1) + '/');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, `#connect=${token}`);
  assert.equal(parseConnectionToken(` ${link} `, site), token);
  assert.equal(parseConnectionToken(` ${token} `), token);
  assert.equal(new URL(link).href.split('#')[0].includes(token), false);
  for (const invalid of [
    `${site}?connect=${token}`,
    `${site}?other=value#connect=${token}`,
    `${site}other/#connect=${token}`,
    `https://example.com/wed-plan/#connect=${token}`,
    `https://person@2080fresh.github.io/wed-plan/#connect=${token}`,
    `${site}#connect=${token}&other=value`,
    `${site}#connect=${token.toUpperCase()}`,
    `#connect=${token}`,
    token.slice(1),
    token + '0',
    token.toUpperCase(),
    '',
  ])
    assert.throws(() => parseConnectionToken(invalid, site), InvalidLinkError);
  assert.throws(() => formatConnectionLink('invalid', site), InvalidLinkError);
});

test('link RPCs map only a public key and send capability tokens in POST bodies without auth', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return response([row()]);
  };
  try {
    const cloud = new LinkCloud({ ...config, url: config.url + '/' });
    const loaded = await cloud.load(` ${token} `);
    assert.equal(loaded.revision, 3);
    assert.equal(loaded.updatedAt, row().updated_at);
    const plan = createPlan();
    plan.profile.groom = '로컬 수정';
    await cloud.save(token, plan, 3);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, `${config.url}/rest/v1/rpc/owol_link_load`);
    assert.equal(requests[1].url, `${config.url}/rest/v1/rpc/owol_link_save`);
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), { p_token: token });
    const saved = JSON.parse(String(requests[1].init.body));
    assert.equal(saved.p_token, token);
    assert.equal(saved.p_expected_revision, 3);
    assert.equal(saved.p_plan.profile.groom, '로컬 수정');
    for (const request of requests) {
      const headers = new Headers(request.init.headers);
      assert.equal(request.init.method, 'POST');
      assert.equal(headers.get('apikey'), config.key);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(headers.has('authorization'), false);
      assert.equal(request.init.credentials, 'omit');
      assert.equal(request.init.referrerPolicy, 'no-referrer');
      assert.equal(request.init.redirect, 'error');
      assert.equal(request.url.includes(token), false);
      assert.equal(new URL(request.url).search, '');
      assert.equal(new URL(request.url).hash, '');
    }
    assert.equal(createLinkCloud(null), null);
    assert.throws(() => new LinkCloud({ ...config, key: 'sb_secret_private_key' }), /공개 키/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid tokens, revisions, plan fields and oversized plans fail before any request', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response([row()]);
  };
  try {
    const cloud = new LinkCloud(config);
    const plan = createPlan();
    await assert.rejects(cloud.load('invalid'), InvalidLinkError);
    await assert.rejects(cloud.save(token.toUpperCase(), plan, 1), InvalidLinkError);
    for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(cloud.save(token, plan, revision), /먼저 가져온/);
    await assert.rejects(cloud.save(token, { ...plan, version: 9 } as unknown as Plan, 1));
    const largePlan = createPlan();
    largePlan.notes = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      title: '기록',
      body: '한'.repeat(20000),
      tag: '',
      date: '',
      pinned: false,
    }));
    await assert.rejects(cloud.save(token, largePlan, 1), /5 MB/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('link errors preserve local edits and CAS conflicts never retry or expose server details', async () => {
  const originalFetch = globalThis.fetch;
  const cloud = new LinkCloud(config);
  const plan = createPlan();
  plan.profile.groom = '수정 중';
  let requests = 0;
  let message = 'OWOL_REVISION_CONFLICT';
  let code = 'P0001';
  globalThis.fetch = async () => {
    requests++;
    return response({ code, message }, 400);
  };
  try {
    await assert.rejects(cloud.save(token, plan, 2), ConflictError);
    assert.equal(requests, 1);
    assert.equal(plan.profile.groom, '수정 중');
    message = 'OWOL_LINK_INVALID';
    await assert.rejects(cloud.load(token), InvalidLinkError);
    message = 'OWOL_PLAN_INVALID';
    await assert.rejects(cloud.save(token, plan, 2), /형식이나 크기/);
    code = 'PGRST202';
    message = 'missing RPC';
    await assert.rejects(cloud.load(token), /아직 준비되지/);
    code = 'unknown';
    message = `server request details: ${token}`;
    await assert.rejects(cloud.load(token), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('malformed response metadata or plans cannot enter the local workspace', async () => {
  const originalFetch = globalThis.fetch;
  let payload: unknown;
  globalThis.fetch = async () => response(payload);
  try {
    const cloud = new LinkCloud(config);
    for (payload of [
      [],
      [row(), row()],
      row(),
      [null],
      [{ ...row(), id: '' }],
      [{ ...row(), revision: 0 }],
      [{ ...row(), revision: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...row(), updated_at: 'invalid' }],
      [{ ...row(), plan: { version: 999 } }],
    ])
      await assert.rejects(cloud.load(token));
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    await assert.rejects(cloud.load(token), /응답을 확인/);
    globalThis.fetch = async () => {
      throw new Error(`network details ${token}`);
    };
    await assert.rejects(cloud.load(token), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(token), false);
      assert.match(error.message, /인터넷 연결/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
