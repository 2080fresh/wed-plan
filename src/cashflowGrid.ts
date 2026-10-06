import {
  CASHFLOW_TYPES,
  readCashflow,
  withCashflow,
  type CashflowData,
  type CashflowEntry,
  type CashflowType,
} from './cashflow';
import type { Plan } from './model';

export type SimpleCashflowRow = { key: string; title: string; type: CashflowType };
export const SIMPLE_CASHFLOW_ORDER: CashflowType[] = ['expense', 'repayment', 'loan', 'income'];
export const cashflowRowKey = (title: string, type: CashflowType) => JSON.stringify([type, title]);

export function simpleCashflowRows(data: CashflowData): SimpleCashflowRow[] {
  const rows = new Map<string, SimpleCashflowRow>();
  for (const entry of data.entries) {
    const key = cashflowRowKey(entry.title, entry.type);
    if (!rows.has(key)) rows.set(key, { key, title: entry.title, type: entry.type });
  }
  return [...rows.values()].sort(
    (a, b) => SIMPLE_CASHFLOW_ORDER.indexOf(a.type) - SIMPLE_CASHFLOW_ORDER.indexOf(b.type),
  );
}

export function cashflowCell(
  data: CashflowData,
  row: Pick<SimpleCashflowRow, 'title' | 'type'>,
  month: string,
): CashflowEntry[] {
  return data.entries.filter(
    (entry) =>
      entry.title === row.title && entry.type === row.type && entry.date.slice(0, 7) === month,
  );
}

export function parseCashflowMoney(input: string, signed = false): number {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!cleaned) return 0;
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(cleaned))
    throw new Error('금액은 원 단위 정수로 입력해 주세요.');
  const amount = Number(cleaned);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1e13)
    throw new Error('금액은 10조 원 이내로 입력해 주세요.');
  return amount;
}

function latestCashflow(plan: Plan): CashflowData {
  const { data, error } = readCashflow(plan);
  if (error) throw new Error(error);
  return data;
}

function changed(): never {
  throw new Error('편집하는 동안 이 금액이 바뀌었습니다. 최신 값을 확인한 뒤 다시 입력해 주세요.');
}

function checkAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e13)
    throw new Error('금액은 0원 이상 10조 원 이내의 정수로 입력해 주세요.');
}

/** Patch only an amount on the latest record, retaining its other current fields. */
export function updateCashflowEntryAmount(
  plan: Plan,
  expected: CashflowEntry,
  amount: number,
): Plan {
  checkAmount(amount);
  const data = latestCashflow(plan);
  const current = data.entries.find((entry) => entry.id === expected.id);
  if (!current || current.amount !== expected.amount) changed();
  // Deletion/undo must preserve the complete record; reject a changed snapshot.
  if (
    !amount &&
    (['id', 'date', 'precision', 'title', 'type', 'amount', 'status', 'memo'] as const).some(
      (key) => current[key] !== expected[key],
    )
  )
    changed();
  if (amount === current.amount) return plan;
  return withCashflow(plan, {
    ...data,
    entries: amount
      ? data.entries.map((entry) => (entry.id === current.id ? { ...entry, amount } : entry))
      : data.entries.filter((entry) => entry.id !== current.id),
  });
}

export function updateCashflowCellAmount(
  plan: Plan,
  row: Pick<SimpleCashflowRow, 'title' | 'type'>,
  month: string,
  expected: CashflowEntry[],
  amount: number,
  newId: string,
): Plan {
  checkAmount(amount);
  const data = latestCashflow(plan);
  const current = cashflowCell(data, row, month);
  if (expected.length > 1 || current.length > 1)
    throw new Error('이 셀에는 여러 기록이 있습니다. 상세 보기에서 각각 수정해 주세요.');
  if (current.length !== expected.length || current[0]?.id !== expected[0]?.id) changed();
  if (current.length) return updateCashflowEntryAmount(plan, expected[0], amount);
  if (!amount) return plan;
  if (!row.title.trim() || row.title.length > 100 || !Object.hasOwn(CASHFLOW_TYPES, row.type))
    throw new Error('항목 이름과 분류를 확인해 주세요.');
  return withCashflow(plan, {
    ...data,
    entries: [
      ...data.entries,
      {
        id: newId,
        title: row.title,
        type: row.type,
        date: `${month}-01`,
        precision: 'month',
        amount,
        status: 'planned',
        memo: '',
      },
    ],
  });
}

export function restoreCashflowEntry(plan: Plan, entry: CashflowEntry): Plan {
  const data = latestCashflow(plan);
  if (data.entries.some((current) => current.id === entry.id))
    throw new Error('같은 기록이 이미 있어 되돌리지 않았습니다. 현재 금액을 확인해 주세요.');
  return withCashflow(plan, { ...data, entries: [...data.entries, { ...entry }] });
}

export function renameCashflowRow(
  plan: Plan,
  row: Pick<SimpleCashflowRow, 'title' | 'type'>,
  expectedIds: string[],
  input: string,
): Plan {
  const title = input.trim();
  if (!title || title.length > 100) throw new Error('항목 이름을 1~100자로 입력해 주세요.');
  const data = latestCashflow(plan);
  if (title === row.title) return plan;
  const expected = new Set(expectedIds);
  const current = data.entries.filter(
    (entry) => entry.title === row.title && entry.type === row.type,
  );
  if (
    !expected.size ||
    current.length !== expected.size ||
    current.some((entry) => !expected.has(entry.id))
  )
    throw new Error(
      '이 항목의 기록이 바뀌었습니다. 최신 항목을 확인한 뒤 이름을 다시 수정해 주세요.',
    );
  if (
    data.entries.some(
      (entry) => entry.type === row.type && entry.title === title && !expected.has(entry.id),
    )
  )
    throw new Error('같은 분류에 이미 있는 이름입니다. 다른 이름을 입력해 주세요.');
  return withCashflow(plan, {
    ...data,
    entries: data.entries.map((entry) => (expected.has(entry.id) ? { ...entry, title } : entry)),
  });
}

export function updateCashflowOpeningBalance(plan: Plan, expected: number, amount: number): Plan {
  const data = latestCashflow(plan);
  if (data.openingBalance !== expected) changed();
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1e13)
    throw new Error('시작 잔액은 10조 원 이내의 정수로 입력해 주세요.');
  return amount === expected ? plan : withCashflow(plan, { ...data, openingBalance: amount });
}
