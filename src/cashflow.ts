import { today, validDate, type Plan } from './model';

export const CASHFLOW_NOTE_ID = 'owol-cashflow-v1';
export const CASHFLOW_TAG = '자금계획 데이터';
export const CASHFLOW_TYPES = {
  income: '수입',
  expense: '지출',
  loan: '대출 실행',
  repayment: '원금·이자 상환',
} as const;
export type CashflowType = keyof typeof CASHFLOW_TYPES;
export type CashflowEntry = {
  id: string;
  date: string;
  title: string;
  type: CashflowType;
  amount: number;
  status: 'planned' | 'completed';
  memo: string;
};
export type CashflowData = {
  version: 1;
  openingMonth: string;
  openingBalance: number;
  entries: CashflowEntry[];
};
export type CashflowMonth = {
  month: string;
  income: number;
  expense: number;
  loans: number;
  repayments: number;
  completedIn: number;
  completedOut: number;
  projectedOpening: number;
  projectedClosing: number;
  completedClosing: number;
};
export const isCashflowNote = (note: { id: string; tag: string }) =>
  note.id === CASHFLOW_NOTE_ID || note.tag === CASHFLOW_TAG;
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
export function monthIndex(month: string) {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + m - 1;
}
export function monthAt(index: number) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
export function newCashflowData(date = today()): CashflowData {
  return { version: 1, openingMonth: date.slice(0, 7), openingBalance: 0, entries: [] };
}
export function validateCashflow(input: unknown): CashflowData {
  if (!input || typeof input !== 'object') throw new Error('자금 계획 형식이 올바르지 않습니다.');
  const d = input as CashflowData;
  if (
    d.version !== 1 ||
    !monthPattern.test(d.openingMonth) ||
    !Number.isSafeInteger(d.openingBalance) ||
    Math.abs(d.openingBalance) > 1e13 ||
    !Array.isArray(d.entries) ||
    d.entries.length > 100
  )
    throw new Error('시작 월·잔액 또는 자금 항목 수를 확인해 주세요. 항목은 최대 100개입니다.');
  const ids = new Set<string>();
  for (const e of d.entries) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !e.id ||
      e.id.length > 100 ||
      ids.has(e.id) ||
      typeof e.title !== 'string' ||
      !e.title.trim() ||
      e.title.length > 100 ||
      !validDate(e.date) ||
      !Object.hasOwn(CASHFLOW_TYPES, e.type) ||
      !Number.isSafeInteger(e.amount) ||
      e.amount <= 0 ||
      e.amount > 1e13 ||
      !['planned', 'completed'].includes(e.status) ||
      typeof e.memo !== 'string' ||
      e.memo.length > 300
    )
      throw new Error('자금 항목의 날짜·금액·유형을 확인해 주세요. 금액은 1원 이상의 정수입니다.');
    const offset = monthIndex(e.date.slice(0, 7)) - monthIndex(d.openingMonth);
    if (offset < 0 || offset >= 120)
      throw new Error('항목 날짜는 시작 월부터 10년 이내여야 합니다.');
    ids.add(e.id);
  }
  if (JSON.stringify(d).length > 19500)
    throw new Error(
      '자금 기록의 저장 한도에 도달했습니다. 메모를 줄이거나 지난 항목을 정리해 주세요.',
    );
  return {
    version: 1,
    openingMonth: d.openingMonth,
    openingBalance: d.openingBalance,
    entries: d.entries.map((e) => ({ ...e })),
  };
}
export function readCashflow(plan: Plan): { data: CashflowData; error: string } {
  const notes = plan.notes.filter(isCashflowNote);
  if (!notes.length) return { data: newCashflowData(), error: '' };
  try {
    if (notes.length !== 1)
      throw new Error('자금 계획 데이터가 중복되어 있습니다. 백업을 확인해 주세요.');
    return { data: validateCashflow(JSON.parse(notes[0].body)), error: '' };
  } catch (error) {
    return {
      data: newCashflowData(),
      error: `저장된 자금 계획을 읽지 못했습니다. ${error instanceof Error ? error.message : ''} 원본은 보존되어 있습니다.`,
    };
  }
}
export function withCashflow(plan: Plan, input: CashflowData): Plan {
  const data = validateCashflow(input);
  return {
    ...plan,
    notes: [
      ...plan.notes.filter((note) => !isCashflowNote(note)),
      {
        id: CASHFLOW_NOTE_ID,
        tag: CASHFLOW_TAG,
        title: '월별 자금 계획',
        body: JSON.stringify(data),
        date: today(),
        pinned: false,
      },
    ],
  };
}
export function isInflow(entry: CashflowEntry) {
  return entry.type === 'income' || entry.type === 'loan';
}
export function cashflowMonths(
  data: CashflowData,
  throughMonth = data.openingMonth,
): CashflowMonth[] {
  const start = monthIndex(data.openingMonth);
  const lastEntry = data.entries.reduce(
    (end, e) => Math.max(end, monthIndex(e.date.slice(0, 7))),
    start,
  );
  const end = Math.min(
    start + 119,
    Math.max(start, lastEntry, monthPattern.test(throughMonth) ? monthIndex(throughMonth) : start),
  );
  const rows: CashflowMonth[] = [];
  let projected = data.openingBalance,
    completed = data.openingBalance;
  for (let index = start; index <= end; index++) {
    const month = monthAt(index),
      entries = data.entries.filter((e) => e.date.startsWith(month));
    const sum = (type: CashflowType) =>
      entries.filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0);
    const income = sum('income'),
      expense = sum('expense'),
      loans = sum('loan'),
      repayments = sum('repayment');
    const completedIn = entries
      .filter((e) => e.status === 'completed' && isInflow(e))
      .reduce((n, e) => n + e.amount, 0);
    const completedOut = entries
      .filter((e) => e.status === 'completed' && !isInflow(e))
      .reduce((n, e) => n + e.amount, 0);
    const projectedOpening = projected;
    projected += income + loans - expense - repayments;
    completed += completedIn - completedOut;
    rows.push({
      month,
      income,
      expense,
      loans,
      repayments,
      completedIn,
      completedOut,
      projectedOpening,
      projectedClosing: projected,
      completedClosing: completed,
    });
  }
  return rows;
}
export function completedBalance(data: CashflowData, asOf = today()) {
  return data.entries
    .filter((e) => e.status === 'completed' && e.date <= asOf)
    .reduce((balance, e) => balance + (isInflow(e) ? e.amount : -e.amount), data.openingBalance);
}
