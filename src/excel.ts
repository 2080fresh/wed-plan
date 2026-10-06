import ExcelJS from 'exceljs';
import type { Worksheet, CellValue, Cell } from 'exceljs';
import { dayDiff, download, today, uid, validDate, validatePlan, taskDate } from './model';
import type { Category, Expense, Note, Plan, Task, Vendor } from './model';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_SHEETS = 24;
const MAX_ROWS = 10001;
const MAX_COLUMNS = 64;
const MAX_CELLS = 400000;
const MAX_JSON_CHUNKS = 500;
const BACKUP_SHEET = '오월 백업';
const BACKUP_MARKER = 'OWOL_WEDDING_PLAN_V1';

/** Only cached formula results are read. Formulas and external links are never evaluated. */
function scalar(value: CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  )
    return value;
  if ('formula' in value || 'sharedFormula' in value) return scalar(value.result ?? null);
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return null;
}
function cellScalar(source: Cell): ReturnType<typeof scalar> {
  const value = source.value;
  // ExcelJS's value getter omits falsy formula results, including cached 0.
  // Its result getter preserves the cached value and distinguishes undefined.
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))
    return scalar(source.result ?? null);
  return scalar(value);
}
function cell(sheet: Worksheet, address: string) {
  return cellScalar(sheet.getCell(address));
}
function text(value: ReturnType<typeof scalar>): string {
  if (value === null) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
}
function amount(value: ReturnType<typeof scalar>): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e13
    ? Math.round(value)
    : null;
}
function category(title: string): Category {
  if (/신혼여행|여권|환전|여행|항공|호텔/.test(title)) return '신혼여행';
  if (/신혼집|인테리어|가전|가구|이사|입주|주택/.test(title)) return '신혼집';
  if (/웨딩홀|예식장|보증인원|시식|하객수/.test(title)) return '웨딩홀';
  if (/예물|예단|웨딩밴드|반지|예복/.test(title)) return '예물·예단';
  if (/스튜디오|드레스|메이크업|헤어|촬영|스드메|헬퍼/.test(title)) return '스드메';
  if (
    /본식|사회자|축가|축사|축의|청첩|부케|식순|혼주|한복|식전|웨딩카|영상|답례|스냅|포토/.test(
      title,
    )
  )
    return '본식';
  return '기타';
}
function dateValue(value: ReturnType<typeof scalar>): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const source = text(value);
  if (validDate(source)) return source;
  const match = source.match(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
  const date = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
  return validDate(date) ? date : '';
}
function yearMonth(value: ReturnType<typeof scalar>): { year: number; month: number } | null {
  if (value instanceof Date)
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
  const match = text(value).match(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})/);
  return match && +match[2] >= 1 && +match[2] <= 12 ? { year: +match[1], month: +match[2] } : null;
}

/** Check declared ZIP sizes before ExcelJS allocates expanded workbook parts. */
function checkArchive(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  if (view.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50)
    throw new Error('올바른 XLSX 파일이 아닙니다. .xlsx 형식으로 저장해 주세요.');
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('엑셀 파일의 압축 정보를 읽을 수 없습니다.');
  const entries = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true),
    total = 0;
  if (entries > 2000 || entries === 0 || cursor === 0xffffffff)
    throw new Error('너무 복잡한 엑셀 파일입니다. 필요한 시트만 복사하여 가져와 주세요.');
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('엑셀 파일의 압축 구조가 올바르지 않습니다.');
    const flags = view.getUint16(cursor + 8, true),
      expanded = view.getUint32(cursor + 24, true);
    total += expanded;
    if (flags & 1) throw new Error('암호화된 엑셀 파일은 가져올 수 없습니다.');
    if (expanded > 40 * 1024 * 1024 || total > 100 * 1024 * 1024)
      throw new Error(
        '압축 해제된 엑셀 데이터가 너무 큽니다. 이미지나 사용하지 않는 시트를 줄여 주세요.',
      );
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
}
function checkSheets(book: ExcelJS.Workbook) {
  if (book.worksheets.length > MAX_SHEETS)
    throw new Error(`한 번에 ${MAX_SHEETS}개 이하의 시트만 가져올 수 있습니다.`);
  let count = 0;
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS)
      throw new Error(
        `'${sheet.name}' 시트가 너무 큽니다. ${MAX_ROWS}행, ${MAX_COLUMNS}열 이내로 줄여 주세요.`,
      );
    sheet.eachRow((row) =>
      row.eachCell(() => {
        count++;
      }),
    );
    if (count > MAX_CELLS) throw new Error('입력 셀이 너무 많습니다. 필요한 시트만 가져와 주세요.');
  }
}
function restoreBackup(sheet: Worksheet): Plan {
  if (cell(sheet, 'A1') !== BACKUP_MARKER)
    throw new Error('오월 백업 시트의 형식을 확인해 주세요.');
  if (cell(sheet, 'B2') !== 1) throw new Error('지원하지 않는 오월 백업 버전입니다.');
  const count = cell(sheet, 'B3');
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_JSON_CHUNKS)
    throw new Error('백업 데이터 조각 수가 올바르지 않습니다.');
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    if (cell(sheet, `A${i + 5}`) !== i + 1)
      throw new Error('백업 데이터 순서가 올바르지 않습니다.');
    const chunk = cell(sheet, `B${i + 5}`);
    if (typeof chunk !== 'string' || chunk.length > 30000)
      throw new Error('백업 데이터가 손상되었습니다.');
    parts.push(chunk);
  }
  try {
    return validatePlan(JSON.parse(parts.join('')));
  } catch (error) {
    throw new Error(`백업을 복원할 수 없습니다. ${error instanceof Error ? error.message : ''}`);
  }
}

function sourceNotes(book: ExcelJS.Workbook): Note[] {
  const notes: Note[] = [];
  for (const [sheetIndex, sheet] of book.worksheets.entries()) {
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const parts: string[] = [];
      row.eachCell((c) => {
        const value = text(cellScalar(c));
        if (value) parts.push(`${c.address}: ${value}`);
      });
      if (parts.length) lines.push(parts.join(' · '));
    });
    if (!lines.length) continue;
    let body = '',
      part = 1;
    const flush = () => {
      if (body)
        notes.push({
          id: `xlsx-source-${sheetIndex}-${part++}`,
          title: `엑셀 원본 · ${sheet.name}${part > 2 ? ` (${part - 1})` : ''}`,
          body,
          tag: '엑셀 가져오기',
          date: today(),
          pinned: false,
        });
      body = '';
    };
    // Retain readable source values, including unstructured prices and cash-flow details.
    for (const line of lines) {
      for (let start = 0; start < line.length; start += 18000) {
        const segment = line.slice(start, start + 18000);
        if (body.length + segment.length + 1 > 19000) flush();
        body += `${body ? '\n' : ''}${segment}`;
      }
    }
    flush();
  }
  return notes;
}
function timelineTasks(sheet: Worksheet, weddingDate: string): Task[] {
  const tasks: Task[] = [];
  for (let col = 3; col <= 21; col++) {
    const heading = cellScalar(sheet.getCell(4, col)),
      period = yearMonth(heading);
    const label = text(heading);
    for (let row = 5; row <= (label === '전날' ? 20 : 13); row++) {
      const title = text(cellScalar(sheet.getCell(row, col)));
      if (!title) continue;
      let date = '',
        offset = label === '전날' ? -1 : 0;
      const explicit = title.match(/(?:\(|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\)|\s|$)/);
      if (explicit && period) {
        const candidate = `${period.year}-${explicit[1].padStart(2, '0')}-${explicit[2].padStart(2, '0')}`;
        if (validDate(candidate)) date = candidate;
      }
      if (date && weddingDate) offset = dayDiff(date, weddingDate) ?? offset;
      tasks.push({
        id: uid(),
        title: title.slice(0, 20000),
        category: category(title),
        date,
        ...(!date && period
          ? { month: `${period.year}-${String(period.month).padStart(2, '0')}` }
          : {}),
        offset,
        done: false,
        owner: '함께',
        memo: `엑셀 ${sheet.name}!${sheet.getCell(row, col).address} · ${label || '일정 미정'}${!date && period ? '\n원본은 월 단위 일정입니다. 필요하면 정확한 날짜를 지정해 주세요.' : ''}`,
      });
    }
  }
  return tasks;
}
function budgetExpenses(sheet: Worksheet): Expense[] {
  const ranges: [number, number, string][] = [
    [5, 21, '결혼식 및 스드메'],
    [23, 25, '신혼여행·혼수·예물'],
    [27, 28, '신혼집'],
    [30, 39, '생활지출 · 신랑'],
    [41, 50, '생활지출 · 신부'],
  ];
  const expenses: Expense[] = [];
  for (const [start, end, group] of ranges)
    for (let row = start; row <= end; row++) {
      const rawTitle = text(cell(sheet, `E${row}`));
      if (!rawTitle || /^(소계|계|합계)$/.test(rawTitle)) continue;
      const estimated = amount(cell(sheet, `F${row}`)) ?? 0;
      const sourceTotal = amount(cell(sheet, `G${row}`));
      const schedule: string[] = [];
      for (let col = 8; col <= 24; col++) {
        const payment = amount(cellScalar(sheet.getCell(row, col)));
        if (payment)
          schedule.push(
            `${text(cellScalar(sheet.getCell(4, col))).slice(0, 7)} ${payment.toLocaleString('ko-KR')}원`,
          );
      }
      const memo = [
        `원본 분류: ${group}`,
        `원본 G열 합계 (예정·완료 구분 미확인): ${sourceTotal === null ? '캐시값 없음' : `${sourceTotal.toLocaleString('ko-KR')}원`}`,
        '예상 비용만 입력했습니다. 계약 금액과 결제 완료는 확인 후 입력해 주세요. 원본의 총 계약금액과 실제 결제 여부가 확인되지 않아 두 항목은 0원으로 시작합니다.',
        schedule.length ? `원본 월별 입력: ${schedule.join(' / ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      expenses.push({
        id: uid(),
        title: group.startsWith('생활지출') ? `${group} · ${rawTitle}` : rawTitle,
        category: category(rawTitle),
        estimated,
        actual: 0,
        paid: 0,
        groomShare: group.endsWith('신랑') ? 100 : group.endsWith('신부') ? 0 : 50,
        due: '',
        vendor: '',
        memo,
      });
    }
  return expenses;
}
function vendorsFromWorkbook(book: ExcelJS.Workbook): Vendor[] {
  const vendors: Vendor[] = [];
  const add = (name: string, kind: Category, price: number, memo: string) =>
    vendors.push({
      id: uid(),
      name,
      category: kind,
      price,
      contact: '',
      url: '',
      rating: 0,
      status: '검토 중',
      memo,
    });
  const timeline = book.getWorksheet('결혼식 타임라인');
  if (timeline)
    for (let row = 17; row <= 33; row++) {
      const name = text(cell(timeline, `D${row}`)),
        label = text(cell(timeline, `C${row}`));
      if (name)
        add(
          name,
          category(label),
          0,
          `${label}\n원본 업체 정리에 기재된 내용입니다. 계약 상태는 확인되지 않았습니다.`,
        );
    }
  const venues = book.getWorksheet('웨딩홀 정리');
  if (venues)
    for (const row of [
      4,
      5,
      ...Array.from({ length: 13 }, (_, i) => i + 9),
      ...Array.from({ length: 8 }, (_, i) => i + 25),
    ]) {
      const name = text(cell(venues, `B${row}`));
      if (!name) continue;
      const total = amount(cell(venues, `${row <= 5 ? 'J' : 'H'}${row}`));
      const details = [
        `위치: ${text(cell(venues, `C${row}`))}`,
        `대관료: ${text(cell(venues, `D${row}`))}원`,
        `식대: ${text(cell(venues, `E${row}`))}원`,
        `최소 보증인원: ${text(cell(venues, `F${row}`))}명`,
        `예식도우미: ${text(cell(venues, `G${row}`))}`,
        `원본 총 견적: ${total === null ? '미확인' : `${total.toLocaleString('ko-KR')}원`}`,
      ];
      for (let col = row <= 5 ? 8 : 9; col <= 16; col++) {
        const raw = text(cellScalar(venues.getCell(row, col)));
        if (raw) details.push(`${venues.getCell(row, col).address}: ${raw}`);
      }
      add(name, '웨딩홀', total ?? 0, details.join('\n'));
    }
  const beauty = book.getWorksheet('스드메 업체 정리');
  if (beauty) {
    let studio = '';
    for (let row = 3; row <= 28; row++) {
      studio = text(cell(beauty, `D${row}`)) || studio;
      const branch = text(cell(beauty, `E${row}`));
      if (!studio) continue;
      const raw = Array.from(
        { length: 6 },
        (_, i) => `${String.fromCharCode(70 + i)}: ${text(cellScalar(beauty.getCell(row, i + 6)))}`,
      ).filter((v) => !v.endsWith(': '));
      add(
        `${studio}${branch ? ` · ${branch}` : ''}`,
        '스드메',
        0,
        `스튜디오\n원본 견적(단위·구성 확인 필요): ${raw.join(' / ')}`,
      );
    }
    for (const [start, end, kind] of [
      [31, 52, '드레스'],
      [57, 68, '메이크업'],
    ] as const)
      for (let row = start; row <= end; row++) {
        const name = text(cell(beauty, `C${row}`));
        if (!name) continue;
        const raw: string[] = [];
        for (let col = 4; col <= 14; col++) {
          const value = text(cellScalar(beauty.getCell(row, col)));
          if (value) raw.push(`${beauty.getCell(row, col).address}: ${value}`);
        }
        add(
          name,
          '스드메',
          0,
          `${kind}\n원본 견적은 만원 단위·복수 구성 표기가 섞여 있어 숫자로 변환하지 않았습니다.\n${raw.join('\n')}`,
        );
      }
  }
  return vendors;
}

/** Imports locally. Recognized sections replace matching arrays; unrelated sections and authored notes remain. */
export async function importWorkbook(
  file: File,
  current: Plan,
): Promise<{ plan: Plan; warnings: string[]; summary: string[] }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('엑셀 파일은 30MB 이하로 가져와 주세요.');
  if (!/\.xlsx$/i.test(file.name)) throw new Error('.xlsx 형식의 엑셀 파일을 선택해 주세요.');
  const bytes = await file.arrayBuffer();
  checkArchive(bytes);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes, {
      ignoreNodes: ['drawing', 'picture', 'extLst', 'conditionalFormatting', 'dataValidations'],
    });
  } catch {
    throw new Error(
      '엑셀 파일을 읽지 못했습니다. 암호를 해제하고 XLSX 형식으로 다시 저장해 주세요.',
    );
  }
  checkSheets(book);
  const backup = book.getWorksheet(BACKUP_SHEET);
  if (backup) {
    const plan = restoreBackup(backup);
    return {
      plan,
      warnings: [
        '이 파일은 오월 전체 백업입니다. 적용하면 현재 기본 정보·일정·예산·업체·하객·기록을 모두 교체합니다.',
        '표 시트의 수동 수정은 복원에 반영되지 않습니다. 전체 복원은 오월 백업 시트의 저장 데이터로 진행됩니다.',
      ],
      summary: [
        `일정 ${plan.tasks.length}개`,
        `예산 ${plan.expenses.length}개`,
        `업체 ${plan.vendors.length}개`,
        `하객 ${plan.guests.length}개`,
        `기록 ${plan.notes.length}개`,
      ],
    };
  }
  const timeline = book.getWorksheet('결혼식 타임라인'),
    budget = book.getWorksheet('결혼식 예산');
  const hasVendors = !!(
    timeline ||
    book.getWorksheet('웨딩홀 정리') ||
    book.getWorksheet('스드메 업체 정리')
  );
  if (
    !timeline &&
    !budget &&
    !hasVendors &&
    !book.getWorksheet('신혼집 예산 정리') &&
    !book.getWorksheet('웨딩홀투어 체크리스트')
  )
    throw new Error(
      '지원하는 결혼 준비 시트를 찾지 못했습니다. 원본 결혼 준비 파일 또는 오월에서 내보낸 파일을 선택해 주세요.',
    );
  const warnings = [
    '파일은 이 기기에서만 읽습니다. 적용할 항목 수와 기록을 확인해 주세요.',
    '완료·계약·결제 상태는 추정하지 않았습니다. 가져온 후 확인해 주세요.',
  ];
  const profile = { ...current.profile };
  if (timeline) {
    const period = yearMonth(cell(timeline, 'S4')),
      day = text(cell(timeline, 'S2')).match(/(\d{1,2})\/(\d{1,2})/);
    if (period && day) {
      const date = `${period.year}-${day[1].padStart(2, '0')}-${day[2].padStart(2, '0')}`;
      if (validDate(date)) {
        profile.weddingDate = date;
        warnings.push(
          `원본 타임라인의 예정일 ${date}을 가져옵니다. 확정한 예식일인지 설정에서 확인해 주세요.`,
        );
      }
    }
    const venue = text(cell(timeline, 'D17'));
    if (venue) profile.venue = venue;
  }
  const tasks = timeline ? timelineTasks(timeline, profile.weddingDate) : current.tasks;
  const expenses = budget ? budgetExpenses(budget) : current.expenses;
  const vendors = hasVendors ? vendorsFromWorkbook(book) : current.vendors;
  const importedNotes = sourceNotes(book);
  const notes = [
    ...current.notes.filter((note) => !note.id.startsWith('xlsx-source-')),
    ...importedNotes,
  ];
  if (budget)
    warnings.push(
      'F열에서 예상 비용만 입력합니다. 계약 금액과 결제 완료는 확인 후 입력해 주세요. G열 및 월별 금액은 예정·완료 구분이 없어 메모에 보존하며, 계약 금액과 납부액은 모두 0원으로 가져옵니다.',
    );
  if (book.getWorksheet('신혼집 예산 정리'))
    warnings.push(
      '신혼집의 대출·수입·월별 자금흐름은 원본 기록으로 보존했습니다. 예산 지출에 중복 합산하지 않습니다.',
    );
  if (book.getWorksheet('드레스투어 도안'))
    warnings.push('엑셀에 삽입된 사진·드레스 도안은 가져오지 않습니다.');
  const summary = [
    timeline ? `일정 ${tasks.length}개로 교체` : '기존 일정 유지',
    budget ? `예산 ${expenses.length}개로 교체` : '기존 예산 유지',
    hasVendors ? `업체 ${vendors.length}개로 교체` : '기존 업체 유지',
    `원본 기록 ${importedNotes.length}개 저장 (이전 엑셀 원본 기록 교체)`,
    `기존 하객 ${current.guests.length}개와 직접 작성한 기록 유지`,
  ];
  const plan = validatePlan({
    ...current,
    profile,
    tasks,
    expenses,
    vendors,
    notes,
    updatedAt: new Date().toISOString(),
  });
  return { plan, warnings, summary };
}

function table(
  book: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | boolean)[][],
) {
  const sheet = book.addWorksheet(name);
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF766558' } };
  sheet.getRow(1).height = 26;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
  sheet.columns.forEach((column, i) => {
    column.width = /메모|내용|문구/.test(headers[i])
      ? 52
      : /명|항목|제목|이름/.test(headers[i])
        ? 30
        : 20;
  });
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
  return sheet;
}
export async function exportWorkbook(input: Plan): Promise<void> {
  const plan = validatePlan(input),
    book = new ExcelJS.Workbook();
  book.creator = '오월';
  book.created = new Date();
  table(
    book,
    '안내',
    ['항목', '내용'],
    [
      ['저장일', new Date().toISOString()],
      ['전체 복원', '오월에서 이 XLSX 파일을 가져오면 오월 백업 시트의 데이터가 복원됩니다.'],
      [
        '표 편집 안내',
        '각 표는 확인·공유용입니다. 엑셀에서 표를 수정해도 전체 복원 데이터에는 반영되지 않습니다.',
      ],
      ['금액', '모든 금액의 단위는 원입니다. 납부액은 사용자가 확인한 값입니다.'],
      [
        '개인정보',
        '이 파일에는 결혼 준비와 하객 정보가 포함될 수 있습니다. 필요한 사람에게만 전달해 주세요.',
      ],
    ],
  );
  table(
    book,
    '기본 정보',
    ['항목', '내용'],
    Object.entries(plan.profile).map(([key, value]) => [key, value]),
  );
  table(
    book,
    '일정',
    ['ID', '할 일', '분류', '담당', '완료', '예정일', '직접 지정 날짜', '결혼일 기준 일수', '메모'],
    plan.tasks.map((t) => [
      t.id,
      t.title,
      t.category,
      t.owner,
      t.done ? '완료' : '준비 중',
      t.month ? `${t.month} (월단위)` : taskDate(t, plan.profile.weddingDate),
      t.date,
      t.offset,
      t.memo,
    ]),
  );
  const budget = table(
    book,
    '예산',
    [
      'ID',
      '항목',
      '분류',
      '예산',
      '계약·예상금액',
      '납부액',
      '남은 금액',
      '신랑 비율(%)',
      '예정일',
      '업체',
      '메모',
    ],
    plan.expenses.map((e) => [
      e.id,
      e.title,
      e.category,
      e.estimated,
      e.actual,
      e.paid,
      e.actual - e.paid,
      e.groomShare,
      e.due,
      e.vendor,
      e.memo,
    ]),
  );
  [4, 5, 6, 7].forEach((n) => {
    budget.getColumn(n).numFmt = '#,##0';
  });
  table(
    book,
    '업체',
    ['ID', '업체명', '분류', '견적', '연락처', 'URL', '별점', '상태', '메모'],
    plan.vendors.map((v) => [
      v.id,
      v.name,
      v.category,
      v.price,
      v.contact,
      v.url,
      v.rating,
      v.status,
      v.memo,
    ]),
  );
  table(
    book,
    '하객',
    ['ID', '이름', '측', '그룹', '인원', '참석', '청첩장 전달', '메모'],
    plan.guests.map((g) => [
      g.id,
      g.name,
      g.side,
      g.group,
      g.count,
      g.status,
      g.invitation ? '전달' : '미전달',
      g.memo,
    ]),
  );
  table(
    book,
    '기록',
    ['ID', '제목', '내용', '태그', '날짜', '고정'],
    plan.notes.map((n) => [n.id, n.title, n.body, n.tag, n.date, n.pinned]),
  );
  // ExcelJS/JSZip can split XML strings at an internal UTF-16 buffer boundary.
  // Keep the recovery payload ASCII-only so no surrogate pair can be divided
  // there. These are standard JSON escapes, decoded losslessly by JSON.parse.
  const json = JSON.stringify(plan).replace(
      /[\u007f-\uffff]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ),
    chunks: string[] = [];
  for (let start = 0; start < json.length; ) {
    let end = Math.min(start + 30000, json.length);
    // Keep emoji surrogate pairs together when serializing separate XML cells.
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    chunks.push(json.slice(start, end));
    start = end;
  }
  if (chunks.length > MAX_JSON_CHUNKS)
    throw new Error('엑셀 백업에 담기에는 기록이 너무 큽니다. JSON 백업을 이용해 주세요.');
  const backup = book.addWorksheet(BACKUP_SHEET);
  backup.addRows([
    [BACKUP_MARKER],
    ['형식 버전', 1],
    ['데이터 조각 수', chunks.length],
    ['순서', '전체 복원 데이터 (수정하지 마세요)'],
    ...chunks.map((chunk, i) => [i + 1, chunk]),
  ]);
  backup.getColumn(1).width = 24;
  backup.getColumn(2).width = 80;
  // ExcelJS treats ordinary strings as strings, including strings beginning with '='.
  const bytes = await book.xlsx.writeBuffer();
  download(
    new Uint8Array(bytes).slice().buffer,
    `오월-결혼준비-${today()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
