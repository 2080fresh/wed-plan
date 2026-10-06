import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashflowDateLabel,
  cashflowMonths,
  readCashflow,
  validateCashflow,
  withCashflow,
  type CashflowData,
  type CashflowEntry,
} from '../src/cashflow';
import { createPlan, dateLabel, validatePlan } from '../src/model';

const monthEntry: CashflowEntry = {
  id: 'monthly-loan',
  title: '대출 실행 계획',
  date: '2026-11-01',
  precision: 'month',
  type: 'loan',
  amount: 500,
  status: 'planned',
  memo: '원본은 월별 계획이며 정확한 날짜는 미정입니다.',
};
const monthly: CashflowData = {
  version: 1,
  openingMonth: '2026-10',
  openingBalance: 1000,
  entries: [monthEntry],
};

test('month precision survives a full plan JSON backup without converting to an exact day', () => {
  const plan = withCashflow(createPlan(), monthly);
  const restored = validatePlan(JSON.parse(JSON.stringify(plan)));
  const read = readCashflow(restored);
  assert.equal(read.error, '');
  assert.deepEqual(read.data, monthly);
  assert.equal(cashflowDateLabel(read.data.entries[0]), '2026년 11월');
  assert.equal(plan.expenses.length, 0);
});

test('legacy entries keep their day and month anchors cannot claim other dates', () => {
  const legacy = { ...monthEntry, date: '2026-11-19' };
  delete legacy.precision;
  const validated = validateCashflow({ ...monthly, entries: [legacy] });
  assert.deepEqual(validated.entries[0], legacy);
  assert.equal(cashflowDateLabel(legacy), dateLabel('2026-11-19'));
  assert.doesNotThrow(() =>
    validateCashflow({ ...monthly, entries: [{ ...legacy, precision: 'day' }] }),
  );
  for (const entry of [
    { ...monthEntry, date: '2026-11-19' },
    { ...monthEntry, date: '2026-11' },
    { ...monthEntry, date: '2026-13-01' },
    { ...monthEntry, precision: 'year' },
    { ...monthEntry, precision: null },
  ]) {
    assert.throws(() => validateCashflow({ ...monthly, entries: [entry] }));
  }
});

test('mixed day and month entries roll up once and planned months stay out of completed totals', () => {
  const data = validateCashflow({
    ...monthly,
    entries: [
      monthEntry,
      { ...monthEntry, id: 'monthly-rent', type: 'expense', amount: 300 },
      {
        ...monthEntry,
        id: 'salary',
        precision: 'day',
        date: '2026-11-25',
        type: 'income',
        amount: 100,
        status: 'completed',
      },
    ],
  });
  const rows = cashflowMonths(data, '2026-12');
  assert.deepEqual(
    rows.map((row) => row.projectedClosing),
    [1000, 1300, 1300],
  );
  assert.deepEqual(
    rows.map((row) => row.completedClosing),
    [1000, 1100, 1100],
  );
  assert.equal(rows[1].income, 100);
  assert.equal(rows[1].loans, 500);
  assert.equal(rows[1].expense, 300);
});
