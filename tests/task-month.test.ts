import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlan,
  dayDiff,
  exportCalendar,
  taskDate,
  taskDateLabel,
  taskMonth,
  validatePlan,
  type Task,
} from '../src/model.ts';

const monthTask: Task = {
  id: 'month-plan',
  title: '월별 준비 계획',
  category: '스드메',
  date: '',
  month: '2026-09',
  offset: -390,
  done: false,
  owner: '함께',
  memo: '원본에는 월만 지정되어 있습니다.',
};

test('month tasks keep their source month as the wedding date changes without inventing an exact day', () => {
  for (const wedding of ['', '2027-10-17', '2028-02-29']) {
    assert.equal(taskDate(monthTask, wedding), '');
    assert.equal(taskMonth(monthTask, wedding), '2026-09');
    assert.equal(taskDateLabel(monthTask, wedding), '2026년 9월 · 날짜 미정');
    assert.equal(dayDiff(taskDate(monthTask, wedding), '2026-10-06'), null);
  }
  const plan = validatePlan({ ...createPlan(), tasks: [monthTask] });
  assert.deepEqual(validatePlan(JSON.parse(JSON.stringify(plan))).tasks, [monthTask]);
});

test('invalid months and simultaneous month/exact-date values cannot enter a plan', () => {
  for (const month of ['', '2026-9', '2026-00', '2026-13', '2026-09-01', null, 202609]) {
    assert.throws(
      () => validatePlan({ ...createPlan(), tasks: [{ ...monthTask, month }] }),
      /일정 데이터/,
    );
  }
  assert.throws(
    () => validatePlan({ ...createPlan(), tasks: [{ ...monthTask, date: '2026-09-01' }] }),
    /일정 데이터/,
  );
});

test('calendar export includes legacy exact and relative days but omits month-only tasks', () => {
  const exact: Task = {
    ...monthTask,
    id: 'fixed',
    title: '실제 예약일',
    month: undefined,
    date: '2026-09-12',
  };
  const relative: Task = {
    ...monthTask,
    id: 'relative',
    title: '전날 준비',
    month: undefined,
    offset: -1,
  };
  assert.equal(taskDate(exact, '2027-10-17'), '2026-09-12');
  assert.equal(taskMonth(exact, '2027-10-17'), '2026-09');
  assert.equal(taskDate(relative, '2027-10-17'), '2027-10-16');
  assert.equal(taskMonth(relative, '2027-10-17'), '2027-10');
  const calendar = exportCalendar([monthTask, exact, relative], '2027-10-17');
  assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.ok(!calendar.includes('UID:month-plan@'));
  assert.ok(calendar.includes('DTSTART;VALUE=DATE:20260912'));
  assert.ok(calendar.includes('DTSTART;VALUE=DATE:20271016'));
});

test('mixed month and exact-day tasks group by their authored month, including across a year boundary', () => {
  const list: Task[] = [
    { ...monthTask, id: 'january', month: '2027-01' },
    { ...monthTask, id: 'december', month: '2026-12' },
    { ...monthTask, id: 'dated-december', month: undefined, date: '2026-12-15' },
  ];
  const groups = list.reduce<Record<string, string[]>>((result, task) => {
    (result[taskMonth(task, '2027-10-17')] ??= []).push(task.id);
    return result;
  }, {});
  assert.deepEqual(Object.keys(groups).sort(), ['2026-12', '2027-01']);
  assert.deepEqual(groups['2026-12'], ['december', 'dated-december']);
});
