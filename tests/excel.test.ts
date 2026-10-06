import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { importWorkbook, exportWorkbook } from '../src/excel.ts';
import { createPlan, type Plan } from '../src/model.ts';

async function asFile(book: ExcelJS.Workbook, name = 'synthetic.xlsx') {
  return new File([new Uint8Array(await book.xlsx.writeBuffer()).slice().buffer], name);
}

test('original-format import never converts estimated or unconfirmed payments into contract or paid amounts', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('결혼식 예산');
  sheet.getCell('E5').value = '웨딩홀';
  sheet.getCell('F5').value = 10000000;
  sheet.getCell('G5').value = { formula: 'SUM(H5:X5)', result: 1500000 };
  sheet.getCell('K4').value = new Date('2027-09-01T00:00:00Z');
  sheet.getCell('K5').value = 1500000;
  sheet.getCell('E6').value = '스튜디오';
  sheet.getCell('F6').value = 2000000;
  sheet.getCell('E22').value = '소계';
  sheet.getCell('F22').value = 12000000;
  const original = createPlan();
  original.guests.push({
    id: 'guest',
    name: '테스트',
    side: '함께',
    group: '친구',
    count: 1,
    status: '미정',
    invitation: false,
    memo: '',
  });
  original.notes.push({
    id: 'own',
    title: '기존 기록',
    body: '보존할 내용',
    tag: '기록',
    date: '2026-10-06',
    pinned: false,
  });
  const { plan, warnings } = await importWorkbook(await asFile(book), original);
  assert.equal(plan.expenses.length, 2, 'subtotal rows must never be imported as expenses');
  assert.deepEqual(
    plan.expenses.map((e) => e.estimated),
    [10000000, 2000000],
  );
  assert.ok(plan.expenses.every((e) => e.actual === 0 && e.paid === 0));
  assert.match(plan.expenses[0].memo, /1,500,000원/);
  assert.match(plan.expenses[0].memo, /2027-09/);
  assert.match(warnings.join('\n'), /예상 비용만 입력/);
  assert.match(warnings.join('\n'), /계약 금액과 결제 완료는 확인 후 입력/);
  assert.deepEqual(plan.tasks, original.tasks, 'missing timeline should preserve existing tasks');
  assert.deepEqual(plan.guests, original.guests);
  assert.ok(plan.notes.some((n) => n.id === 'own'));
});

test('exported workbook roundtrips every plan field, Unicode and formula-like strings', async () => {
  const plan: Plan = createPlan();
  plan.profile.groom = '테스트 신랑';
  plan.profile.weddingDate = '2027-10-17';
  plan.notes.push({
    id: 'unicode',
    title: '=1+1',
    body: '💍한글'.repeat(4500),
    tag: '기록',
    date: '2026-10-06',
    pinned: true,
  });
  plan.notes.push({
    id: 'unicode-next',
    title: '두 번째 기록',
    body: '추가💐'.repeat(3500),
    tag: '기록',
    date: '2026-10-06',
    pinned: false,
  });
  plan.expenses.push({
    id: 'budget',
    title: '테스트 항목',
    category: '본식',
    estimated: 1000000,
    actual: 900000,
    paid: 100000,
    groomShare: 40,
    due: '2027-10-01',
    vendor: '후보 업체',
    memo: '계약 확인',
  });
  let blob: Blob | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (value) => {
    blob = value as Blob;
    return 'blob:owol-test';
  };
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => ({ click() {} }) },
    configurable: true,
  });
  try {
    await exportWorkbook(plan);
    assert.ok(blob);
    const bytes = await blob.arrayBuffer();
    const result = await importWorkbook(new File([bytes], 'roundtrip.xlsx'), createPlan());
    assert.deepEqual(result.plan, plan);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    assert.equal(
      book.getWorksheet('기록')!.getCell('B2').value,
      '=1+1',
      'formula-like strings must remain strings',
    );
    assert.ok(
      book.getWorksheet('오월 백업')!.rowCount > 5,
      'large Unicode data should span backup chunks',
    );
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('workbook importer rejects invalid archives, unsupported files and oversized inputs', async () => {
  await assert.rejects(
    importWorkbook(new File(['invalid'], 'invalid.xlsx'), createPlan()),
    /올바른 XLSX/,
  );
  await assert.rejects(importWorkbook(new File(['invalid'], 'invalid.xls'), createPlan()), /xlsx/);
  const oversized = new File([], 'oversized.xlsx');
  Object.defineProperty(oversized, 'size', { value: 30 * 1024 * 1024 + 1 });
  await assert.rejects(importWorkbook(oversized, createPlan()), /30MB/);
});
