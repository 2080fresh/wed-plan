import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan } from '../src/model';
import { cashflowMonths, readCashflow, withCashflow, type CashflowData } from '../src/cashflow';
import {
  cashflowCell,
  parseCashflowMoney,
  renameCashflowRow,
  restoreCashflowEntry,
  simpleCashflowRows,
  updateCashflowCellAmount,
  updateCashflowEntryAmount,
  updateCashflowOpeningBalance,
} from '../src/cashflowGrid';

const source: CashflowData = {
  version: 1,
  openingMonth: '2026-10',
  openingBalance: 1000,
  entries: [
    {
      id: 'house',
      title: '신혼집',
      type: 'expense',
      amount: 200,
      date: '2026-10-17',
      precision: 'day',
      status: 'completed',
      memo: '원본: 매매 계약금',
    },
    {
      id: 'salary',
      title: '저축',
      type: 'income',
      amount: 100,
      date: '2026-10-01',
      precision: 'month',
      status: 'planned',
      memo: '월별 계획',
    },
    {
      id: 'loan',
      title: '회사대출',
      type: 'loan',
      amount: 500,
      date: '2026-11-01',
      precision: 'month',
      status: 'planned',
      memo: '',
    },
  ],
};
const row = { title: '신혼집', type: 'expense' as const };
const plan = () => withCashflow(createPlan(), source);

test('rows separate identical titles of different types and retain multiple entries in one cell', () => {
  const data: CashflowData = {
    ...source,
    entries: [
      ...source.entries,
      { ...source.entries[0], id: 'house-second', amount: 30 },
      { ...source.entries[1], id: 'same-title', title: '신혼집' },
    ],
  };
  assert.equal(simpleCashflowRows(data).length, 4);
  assert.equal(
    cashflowCell(data, row, '2026-10').reduce((sum, entry) => sum + entry.amount, 0),
    230,
  );
  assert.throws(
    () =>
      updateCashflowCellAmount(
        withCashflow(createPlan(), data),
        row,
        '2026-10',
        [data.entries[0]],
        250,
        'new',
      ),
    /여러 기록/,
  );
});

test('inline edit patches latest amount without reverting unrelated edits or source metadata', () => {
  const newer = {
    ...source,
    entries: source.entries.map((entry) =>
      entry.id === 'house'
        ? { ...entry, memo: '최신 원본 메모' }
        : entry.id === 'salary'
          ? { ...entry, amount: 150 }
          : entry,
    ),
  };
  const latest = withCashflow(
    { ...createPlan(), profile: { ...createPlan().profile, groom: '새 이름' } },
    newer,
  );
  const edited = updateCashflowCellAmount(
    latest,
    row,
    '2026-10',
    [source.entries[0]],
    250,
    'unused',
  );
  const entries = readCashflow(edited).data.entries;
  assert.deepEqual(entries[0], { ...newer.entries[0], amount: 250 });
  assert.equal(entries[1].amount, 150);
  assert.equal(edited.profile.groom, '새 이름');
  assert.equal(cashflowMonths(readCashflow(edited).data)[0].projectedClosing, 900);
});

test('stale edited amounts, replaced cells and concurrent new entries do not overwrite latest data', () => {
  const latest = updateCashflowEntryAmount(plan(), source.entries[0], 220);
  assert.throws(
    () => updateCashflowCellAmount(latest, row, '2026-10', [source.entries[0]], 250, 'unused'),
    /바뀌었습니다/,
  );
  assert.throws(
    () => updateCashflowCellAmount(plan(), row, '2026-10', [], 250, 'new'),
    /바뀌었습니다/,
  );
  const moved = withCashflow(createPlan(), {
    ...source,
    entries: source.entries.map((entry) =>
      entry.id === 'house' ? { ...entry, date: '2026-11-17' } : entry,
    ),
  });
  assert.throws(
    () => updateCashflowCellAmount(moved, row, '2026-10', [source.entries[0]], 250, 'new'),
    /바뀌었습니다/,
  );
});

test('zero clears a single record and undo restores its ID, date, precision, status and memo', () => {
  const cleared = updateCashflowCellAmount(
    plan(),
    row,
    '2026-10',
    [source.entries[0]],
    0,
    'unused',
  );
  assert.equal(
    readCashflow(cleared).data.entries.some((entry) => entry.id === 'house'),
    false,
  );
  const restored = restoreCashflowEntry(cleared, source.entries[0]);
  assert.deepEqual(
    readCashflow(restored).data.entries.find((entry) => entry.id === 'house'),
    source.entries[0],
  );
  assert.throws(() => restoreCashflowEntry(restored, source.entries[0]), /이미/);
  const changedMemo = withCashflow(createPlan(), {
    ...source,
    entries: source.entries.map((entry) =>
      entry.id === 'house' ? { ...entry, memo: '새 메모' } : entry,
    ),
  });
  assert.throws(() => updateCashflowEntryAmount(changedMemo, source.entries[0], 0), /바뀌었습니다/);
});

test('new blank cells create only explicit month plans and zero creates no draft records', () => {
  const original = plan();
  assert.equal(updateCashflowCellAmount(original, row, '2026-12', [], 0, 'new'), original);
  const edited = updateCashflowCellAmount(original, row, '2026-12', [], 90, 'new');
  assert.deepEqual(readCashflow(edited).data.entries.at(-1), {
    id: 'new',
    title: '신혼집',
    type: 'expense',
    amount: 90,
    date: '2026-12-01',
    precision: 'month',
    status: 'planned',
    memo: '',
  });
  assert.throws(() => updateCashflowCellAmount(original, row, '2026-09', [], 90, 'new'), /시작 월/);
});

test('opening balance edit retains latest entries and rejects stale balance edits', () => {
  const latest = updateCashflowEntryAmount(plan(), source.entries[0], 250);
  const edited = updateCashflowOpeningBalance(latest, 1000, -100);
  assert.equal(readCashflow(edited).data.openingBalance, -100);
  assert.equal(readCashflow(edited).data.entries[0].amount, 250);
  assert.throws(() => updateCashflowOpeningBalance(edited, 1000, 900), /바뀌었습니다/);
});

test('money parsing distinguishes blank/zero, supports comma input and rejects invalid amounts', () => {
  assert.equal(parseCashflowMoney('1,234,567'), 1234567);
  assert.equal(parseCashflowMoney(''), 0);
  assert.equal(parseCashflowMoney('0'), 0);
  assert.equal(parseCashflowMoney('-1,500', true), -1500);
  for (const invalid of ['-1', '1.5', '1e3', 'NaN', '10000000000001'])
    assert.throws(() => parseCashflowMoney(invalid));
});

test('row rename preserves latest amounts and metadata, rejects collisions and changed membership', () => {
  const extra = { ...source.entries[0], id: 'house-next', date: '2026-11-17', amount: 300 };
  const input = { ...source, entries: [...source.entries, extra] };
  const latest = withCashflow(createPlan(), {
    ...input,
    entries: input.entries.map((entry) =>
      entry.id === 'house' ? { ...entry, amount: 250, memo: '다른 기기에서 수정한 메모' } : entry,
    ),
  });
  const renamed = renameCashflowRow(latest, row, ['house', 'house-next'], ' 주택 계약금 ');
  const actual = readCashflow(renamed).data.entries;
  assert.deepEqual(
    actual.find((entry) => entry.id === 'house'),
    {
      ...source.entries[0],
      amount: 250,
      memo: '다른 기기에서 수정한 메모',
      title: '주택 계약금',
    },
  );
  assert.equal(actual.find((entry) => entry.id === 'house-next')?.title, '주택 계약금');
  assert.deepEqual(
    actual.find((entry) => entry.id === 'salary'),
    source.entries[1],
  );
  assert.throws(
    () => renameCashflowRow(latest, row, ['house'], '주택 계약금'),
    /기록이 바뀌었습니다/,
  );
  const collision = withCashflow(createPlan(), {
    ...input,
    entries: [...input.entries, { ...extra, id: 'another', title: '주택 계약금' }],
  });
  assert.throws(
    () => renameCashflowRow(collision, row, ['house', 'house-next'], '주택 계약금'),
    /이미 있는 이름/,
  );
  assert.throws(() => renameCashflowRow(latest, row, ['house', 'house-next'], ''), /이름/);
});
