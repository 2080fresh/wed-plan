import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  createPlan,
  dayDiff,
  exportCalendar,
  taskDate,
  totals,
  validatePlan,
  validDate,
  type Expense,
} from '../src/model.ts';
import {
  cashflowMonths,
  completedBalance,
  readCashflow,
  validateCashflow,
  withCashflow,
  type CashflowData,
} from '../src/cashflow.ts';

test('budget shares conserve every won while partial payments preserve remaining balance', () => {
  const expenses: Expense[] = [
    {
      id: 'e',
      title: '예복',
      category: '스드메',
      estimated: 100,
      actual: 101,
      paid: 30,
      groomShare: 50,
      due: '',
      vendor: '',
      memo: '',
    },
  ];
  const result = totals(expenses);
  assert.equal(result.remaining, 71);
  assert.equal(result.groom, 51);
  assert.equal(result.bride, 50);
  assert.equal(result.groom + result.bride, result.actual);
});
test('calendar date calculations handle leap days and explicit dates without timezone drift', () => {
  assert.equal(validDate('2027-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(dayDiff('2027-01-01', '2026-12-31'), 1);
  const task = createPlan().tasks[0];
  assert.equal(taskDate({ ...task, date: '2027-08-02', offset: -1 }, '2027-10-17'), '2027-08-02');
  assert.equal(taskDate({ ...task, date: '', offset: -1 }, '2027-10-17'), '2027-10-16');
});
test('backup validation rejects invalid amounts, dates and duplicate stable IDs', () => {
  const plan = createPlan();
  assert.equal(validatePlan(plan).version, 1);
  assert.equal(
    validatePlan({ ...plan, profile: { ...plan.profile, weddingTime: '' } }).profile.weddingTime,
    '',
  );
  assert.throws(() =>
    validatePlan({ ...plan, profile: { ...plan.profile, weddingTime: '24:00' } }),
  );
  assert.throws(() =>
    validatePlan({ ...plan, profile: { ...plan.profile, weddingDate: '2027-02-30' } }),
  );
  assert.throws(() => validatePlan({ ...plan, tasks: [plan.tasks[0], plan.tasks[0]] }));
  const expense = {
    id: 'e',
    title: '예산',
    category: '본식',
    estimated: 100,
    actual: 100,
    paid: 101,
    groomShare: 50,
    due: '',
    vendor: '',
    memo: '',
  };
  assert.throws(() => validatePlan({ ...plan, expenses: [expense] }));
  assert.throws(() => validatePlan({ ...plan, profile: { ...plan.profile, budget: Infinity } }));
});
test('calendar export escapes text and folds Korean lines without splitting characters', () => {
  const task = {
    ...createPlan().tasks[0],
    title: '촬영, 사진; 준비\\확인\n다음',
    memo: '한글💍'.repeat(70),
    date: '2027-03-18',
    done: false,
  };
  const output = exportCalendar([task, { ...task, id: 'done', done: true }], '2027-10-17');
  assert.equal(output.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.match(output, /DTSTART;VALUE=DATE:20270318/);
  assert.match(output, /DTEND;VALUE=DATE:20270319/);
  assert.match(output.replace(/\r\n /g, ''), /SUMMARY:촬영\\, 사진\\; 준비\\\\확인\\n다음/);
  for (const line of output.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.ok(output.replace(/\r\n /g, '').includes(task.memo));
});
const data: CashflowData = {
  version: 1,
  openingMonth: '2026-10',
  openingBalance: 1000,
  entries: [
    {
      id: 'salary',
      date: '2026-10-25',
      title: '저축',
      type: 'income',
      amount: 200,
      status: 'completed',
      memo: '',
    },
    {
      id: 'loan',
      date: '2026-10-26',
      title: '대출',
      type: 'loan',
      amount: 500,
      status: 'planned',
      memo: '',
    },
    {
      id: 'home',
      date: '2026-10-27',
      title: '집',
      type: 'expense',
      amount: 1800,
      status: 'planned',
      memo: '',
    },
    {
      id: 'repayment',
      date: '2026-12-01',
      title: '상환',
      type: 'repayment',
      amount: 100,
      status: 'completed',
      memo: '',
    },
  ],
};
test('cash flow rolls missing months forward and separates lending from income and planned from completed', () => {
  const rows = cashflowMonths(data, '2026-12');
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.projectedClosing),
    [-100, -100, -200],
  );
  assert.deepEqual(
    rows.map((r) => r.completedClosing),
    [1200, 1200, 1100],
  );
  assert.equal(rows[0].income, 200);
  assert.equal(rows[0].loans, 500);
  assert.equal(rows[1].projectedOpening, -100);
  assert.equal(completedBalance(data, '2026-11-01'), 1200);
});
test('cash-flow note roundtrips without including budget expenses and preserves other notes', () => {
  const plan = createPlan();
  plan.notes.push({
    id: 'ours',
    title: '우리 기록',
    body: '메모',
    tag: '기록',
    date: '2026-10-06',
    pinned: false,
  });
  const saved = withCashflow(plan, data);
  assert.deepEqual(readCashflow(validatePlan(saved)).data, data);
  assert.equal(saved.notes.length, 2);
  assert.equal(withCashflow(saved, data).notes.length, 2);
  assert.equal(saved.expenses.length, 0);
});
test('cash-flow validation blocks duplicate IDs, invalid values, old dates and corrupted note writes', () => {
  assert.throws(() => validateCashflow({ ...data, entries: [...data.entries, data.entries[0]] }));
  assert.throws(() => validateCashflow({ ...data, entries: [{ ...data.entries[0], amount: -1 }] }));
  assert.throws(() =>
    validateCashflow({ ...data, entries: [{ ...data.entries[0], date: '2026-09-01' }] }),
  );
  const saved = withCashflow(createPlan(), data);
  saved.notes[0].body = '{broken';
  assert.ok(readCashflow(saved).error);
  assert.equal(saved.notes[0].body, '{broken');
});
