import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AutoSyncEngine,
  mergePlans,
  samePlanContent,
  type SyncDraft,
  type SyncTransport,
} from '../src/autoSync.ts';
import { ConflictError, type LinkWorkspace } from '../src/linkCloud.ts';
import { createPlan, type Plan } from '../src/model.ts';
import { readCashflow, withCashflow, type CashflowData } from '../src/cashflow.ts';

const copy = <T>(value: T): T => structuredClone(value);
const token = 'a1'.repeat(32);
function transport(initial = createPlan()) {
  let workspace: LinkWorkspace = {
    id: 'shared',
    plan: copy(initial),
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
  let saves = 0;
  const cloud: SyncTransport = {
    async load() {
      return copy(workspace);
    },
    async save(_token, plan, revision) {
      saves++;
      if (revision !== workspace.revision) throw new ConflictError();
      workspace = { ...workspace, plan: copy(plan), revision: revision + 1 };
      return copy(workspace);
    },
  };
  return {
    cloud,
    state: () => workspace,
    saves: () => saves,
    edit: (fn: (plan: Plan) => Plan) => {
      workspace = {
        ...workspace,
        plan: fn(copy(workspace.plan)),
        revision: workspace.revision + 1,
      };
    },
  };
}
function editTask(plan: Plan, fields: Partial<Plan['tasks'][number]>) {
  return {
    ...plan,
    tasks: plan.tasks.map((task, index) => (index === 0 ? { ...task, ...fields } : task)),
  };
}

test('three-way merge retains independent fields, additions and unseen sections; local changed fields win a tie', () => {
  const base = createPlan();
  const local = editTask(base, { title: '우리 수정', done: true });
  const remote = editTask(base, { title: '상대 수정', owner: '신부' });
  remote.profile.venue = '상대방의 장소';
  remote.notes.push({
    id: 'remote-note',
    title: '보존',
    body: '기존 다른 화면 기록',
    tag: '',
    date: '',
    pinned: false,
  });
  remote.tasks.push({ ...base.tasks[1], id: 'remote-addition' });
  const merged = mergePlans(base, local, remote);
  assert.equal(merged.tasks[0].title, '우리 수정');
  assert.equal(merged.tasks[0].owner, '신부');
  assert.equal(merged.tasks[0].done, true);
  assert.equal(merged.profile.venue, remote.profile.venue);
  assert.deepEqual(merged.notes, remote.notes);
  assert.ok(merged.tasks.some((task) => task.id === 'remote-addition'));
});

test('delete versus edit keeps edited data in both directions, while deleting an unchanged item still works', () => {
  const base = createPlan();
  const deleted = { ...base, tasks: base.tasks.slice(1) };
  const edited = editTask(base, { memo: '삭제와 동시에 기록한 내용' });
  assert.equal(
    mergePlans(base, deleted, edited).tasks.find((task) => task.id === base.tasks[0].id)?.memo,
    '삭제와 동시에 기록한 내용',
  );
  assert.equal(
    mergePlans(base, edited, deleted).tasks.find((task) => task.id === base.tasks[0].id)?.memo,
    '삭제와 동시에 기록한 내용',
  );
  assert.equal(mergePlans(base, deleted, base).tasks.length, base.tasks.length - 1);
});

test('cash-flow JSON envelopes merge per entry and field instead of losing a whole note', () => {
  const cash: CashflowData = {
    version: 1,
    openingMonth: '2026-10',
    openingBalance: 1000,
    entries: [
      {
        id: 'one',
        title: '첫 항목',
        date: '2026-10-01',
        precision: 'month',
        type: 'expense',
        amount: 100,
        status: 'planned',
        memo: '',
      },
      {
        id: 'two',
        title: '두 번째',
        date: '2026-11-01',
        precision: 'month',
        type: 'income',
        amount: 200,
        status: 'planned',
        memo: '',
      },
    ],
  };
  const base = withCashflow(createPlan(), cash);
  const local = withCashflow(base, {
    ...cash,
    entries: cash.entries.map((entry, index) => (index === 0 ? { ...entry, amount: 150 } : entry)),
  });
  const remote = withCashflow(base, {
    ...cash,
    entries: [
      ...cash.entries.map((entry, index) =>
        index === 0 ? { ...entry, memo: '상대방 메모' } : { ...entry, amount: 300 },
      ),
      { ...cash.entries[1], id: 'three', title: '새 항목' },
    ],
  });
  const result = readCashflow(mergePlans(base, local, remote));
  assert.equal(result.error, '');
  assert.equal(result.data.entries.length, 3);
  assert.equal(result.data.entries[0].amount, 150);
  assert.equal(result.data.entries[0].memo, '상대방 메모');
  assert.equal(result.data.entries[1].amount, 300);
});

test('initial auto-load never uploads an old device plan over the shared workspace', async () => {
  const old = createPlan(),
    remote = createPlan();
  old.profile.groom = '오래된 기기 값';
  remote.profile.groom = '현재 공동 값';
  const server = transport(remote);
  const engine = new AutoSyncEngine({ cloud: server.cloud, token, initialPlan: old });
  try {
    await engine.start();
    assert.equal(engine.getSnapshot().plan.profile.groom, '현재 공동 값');
    assert.equal(server.saves(), 0);
    assert.equal(engine.getSnapshot().status, 'saved');
  } finally {
    engine.stop();
  }
});

test('rapid edits debounce into one complete save', async () => {
  const server = transport();
  const engine = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    debounceMs: 20,
  });
  try {
    await engine.start();
    engine.update((plan) => editTask(plan, { title: '가' }));
    engine.update((plan) => editTask(plan, { title: '가나' }));
    engine.update((plan) => editTask(plan, { title: '가나다' }));
    assert.equal(server.saves(), 0);
    await delay(60);
    assert.equal(server.saves(), 1);
    assert.equal(server.state().plan.tasks[0].title, '가나다');
    assert.equal(engine.getSnapshot().dirty, false);
  } finally {
    engine.stop();
  }
});

test('edits made during a save remain visible and queue a second save', async () => {
  const server = transport();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cloud = {
    ...server.cloud,
    async save(...args: Parameters<SyncTransport['save']>) {
      await gate;
      return server.cloud.save(...args);
    },
  };
  const engine = new AutoSyncEngine({ cloud, token, initialPlan: createPlan(), debounceMs: 10000 });
  try {
    await engine.start();
    engine.update((plan) => editTask(plan, { title: '첫 수정' }));
    const saving = engine.flush();
    engine.update((plan) => editTask(plan, { title: '저장 중 수정', owner: '신랑' }));
    finish();
    await saving;
    assert.equal(engine.getSnapshot().plan.tasks[0].title, '저장 중 수정');
    assert.equal(engine.getSnapshot().dirty, true);
    await engine.flush();
    assert.equal(server.state().plan.tasks[0].title, '저장 중 수정');
    assert.equal(server.state().plan.tasks[0].owner, '신랑');
    assert.equal(engine.getSnapshot().dirty, false);
  } finally {
    engine.stop();
  }
});

test('two devices recover a CAS conflict and preserve both independent edits', async () => {
  const server = transport();
  const a = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    debounceMs: 10000,
  });
  const b = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    debounceMs: 10000,
  });
  try {
    await Promise.all([a.start(), b.start()]);
    a.update((plan) => editTask(plan, { title: '첫 기기 제목' }));
    b.update((plan) => editTask(plan, { owner: '신부' }));
    await Promise.all([a.flush(), b.flush()]);
    await a.refresh();
    assert.equal(server.state().plan.tasks[0].title, '첫 기기 제목');
    assert.equal(server.state().plan.tasks[0].owner, '신부');
    assert.deepEqual(a.getSnapshot().plan, b.getSnapshot().plan);
  } finally {
    a.stop();
    b.stop();
  }
});

test('an offline draft survives restart and merges remote changes on reconnect', async () => {
  const server = transport();
  let draft: SyncDraft | undefined;
  const first = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    persist: (value) => {
      draft = value;
    },
  });
  await first.start();
  first.setOnline(false);
  first.update((plan) => editTask(plan, { memo: '오프라인 수정' }));
  first.stop();
  server.edit((plan) => editTask(plan, { owner: '신랑' }));
  const recovered = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    draft,
  });
  try {
    await recovered.start();
    assert.equal(server.state().plan.tasks[0].memo, '오프라인 수정');
    assert.equal(server.state().plan.tasks[0].owner, '신랑');
    assert.equal(recovered.getSnapshot().dirty, false);
  } finally {
    recovered.stop();
  }
});

test('a response from a disconnected engine is discarded', async () => {
  const old = createPlan(),
    remote = createPlan();
  old.profile.groom = '유지';
  remote.profile.groom = '폐기할 응답';
  let finish!: (value: LinkWorkspace) => void;
  const cloud: SyncTransport = {
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    save: async () => {
      throw new Error('unexpected save');
    },
  };
  const engine = new AutoSyncEngine({ cloud, token, initialPlan: old });
  const loading = engine.start();
  engine.stop();
  finish({ id: 'stale', plan: remote, revision: 1, updatedAt: new Date().toISOString() });
  await loading;
  assert.equal(engine.getSnapshot().plan.profile.groom, '유지');
});

test('Postgres JSON object key order and updated timestamps do not create phantom edits', () => {
  const first = createPlan();
  const second = copy(first);
  second.profile = Object.fromEntries(Object.entries(second.profile).reverse()) as Plan['profile'];
  second.updatedAt = '2030-01-01T00:00:00Z';
  assert.equal(samePlanContent(first, second), true);
});

test('offline edits after an initial load failure merge only the new local changes into remote', async () => {
  const stale = createPlan(),
    shared = createPlan();
  stale.profile.venue = '오래된 장소';
  shared.profile.venue = '현재 장소';
  const server = transport(shared);
  let failing = true;
  const cloud: SyncTransport = {
    ...server.cloud,
    async load(value) {
      if (failing) throw new Error('연결 없음');
      return server.cloud.load(value);
    },
  };
  const engine = new AutoSyncEngine({ cloud, token, initialPlan: stale, debounceMs: 10000 });
  try {
    await engine.start();
    assert.equal(engine.getSnapshot().status, 'offline');
    engine.setOnline(false);
    engine.update((plan) => editTask(plan, { title: '오프라인에서 방금 입력' }));
    failing = false;
    engine.setOnline(true);
    await engine.flush();
    assert.equal(server.state().plan.profile.venue, '현재 장소');
    assert.equal(server.state().plan.tasks[0].title, '오프라인에서 방금 입력');
  } finally {
    engine.stop();
  }
});

test('separate pending document drafts both survive browser restart recovery', async () => {
  const server = transport();
  const base = copy(server.state());
  const one: SyncDraft = {
    version: 1,
    initialPlan: base.plan,
    base,
    plan: editTask(base.plan, { title: '첫 탭 수정' }),
  };
  const two: SyncDraft = {
    version: 1,
    initialPlan: base.plan,
    base,
    plan: editTask(base.plan, { owner: '신부' }),
  };
  const engine = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    draft: two,
    recoveryDrafts: [one],
  });
  try {
    await engine.start();
    assert.equal(server.state().plan.tasks[0].title, '첫 탭 수정');
    assert.equal(server.state().plan.tasks[0].owner, '신부');
  } finally {
    engine.stop();
  }
});

test('a clean flush does not latch the queue and block a later edit', async () => {
  const server = transport();
  const engine = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    debounceMs: 10000,
  });
  try {
    await engine.start();
    await engine.flush();
    engine.update((plan) => editTask(plan, { title: '빈 큐 이후의 수정' }));
    await engine.flush();
    assert.equal(server.saves(), 1);
    assert.equal(server.state().plan.tasks[0].title, '빈 큐 이후의 수정');
    assert.equal(engine.getSnapshot().status, 'saved');
  } finally {
    engine.stop();
  }
});

test('editing then undoing before debounce still allows subsequent automatic saves', async () => {
  const server = transport();
  const engine = new AutoSyncEngine({
    cloud: server.cloud,
    token,
    initialPlan: createPlan(),
    debounceMs: 15,
  });
  try {
    await engine.start();
    const originalTitle = engine.getSnapshot().plan.tasks[0].title;
    engine.update((plan) => editTask(plan, { title: '잠깐 수정' }));
    engine.update((plan) => editTask(plan, { title: originalTitle }));
    await delay(40);
    assert.equal(server.saves(), 0);
    engine.update((plan) => editTask(plan, { title: '다음 자동 저장' }));
    await delay(40);
    assert.equal(server.saves(), 1);
    assert.equal(server.state().plan.tasks[0].title, '다음 자동 저장');
  } finally {
    engine.stop();
  }
});

test('task day/month/relative modes merge as one schedule while independent memo edits survive', () => {
  const cases: [
    Partial<Plan['tasks'][number]>,
    Partial<Plan['tasks'][number]>,
    Partial<Plan['tasks'][number]>,
  ][] = [
    [
      { month: '2026-10', date: '', offset: 0 },
      { month: undefined, date: '', offset: -1 },
      { month: '2026-11' },
    ],
    [
      { month: undefined, date: '', offset: -30 },
      { month: '2026-10', date: '' },
      { date: '2026-11-20', offset: -20 },
    ],
    [
      { month: undefined, date: '2026-10-10', offset: 0 },
      { month: undefined, date: '', offset: -1 },
      { date: '2026-10-20' },
    ],
    [
      { month: '2026-10', date: '', offset: 0 },
      { month: undefined, date: '2026-10-17' },
      { month: '2026-11' },
    ],
  ];
  for (const [original, ours, theirs] of cases) {
    const base = editTask(createPlan(), original);
    const local = editTask(base, ours);
    const remote = editTask(base, { ...theirs, memo: '상대방의 독립 메모' });
    const merged = mergePlans(base, local, remote).tasks[0];
    assert.deepEqual(
      [merged.date, merged.month, merged.offset],
      [local.tasks[0].date, local.tasks[0].month, local.tasks[0].offset],
    );
    assert.equal(merged.memo, '상대방의 독립 메모');
  }
});
