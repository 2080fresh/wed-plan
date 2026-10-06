export type Category = '웨딩홀' | '스드메' | '예물·예단' | '본식' | '신혼여행' | '신혼집' | '기타';
export const CATEGORIES: Category[] = [
  '웨딩홀',
  '스드메',
  '예물·예단',
  '본식',
  '신혼여행',
  '신혼집',
  '기타',
];
export type Owner = '함께' | '신랑' | '신부';
export type Task = {
  id: string;
  title: string;
  category: Category;
  offset: number;
  date: string;
  month?: string;
  done: boolean;
  owner: Owner;
  memo: string;
};
export type Expense = {
  id: string;
  title: string;
  category: Category;
  estimated: number;
  actual: number;
  paid: number;
  groomShare: number;
  due: string;
  vendor: string;
  memo: string;
};
export type Vendor = {
  id: string;
  name: string;
  category: Category;
  price: number;
  contact: string;
  url: string;
  rating: number;
  status: '검토 중' | '상담 예정' | '계약 완료' | '보류';
  memo: string;
};
export type Guest = {
  id: string;
  name: string;
  side: Owner;
  group: string;
  count: number;
  status: '미정' | '참석' | '불참';
  invitation: boolean;
  memo: string;
};
export type Note = {
  id: string;
  title: string;
  body: string;
  tag: string;
  date: string;
  pinned: boolean;
};
export type Profile = {
  groom: string;
  bride: string;
  weddingDate: string;
  weddingTime: string;
  venue: string;
  budget: number;
  invitation: string;
  familyDate: string;
  familyPlace: string;
  familyMemo: string;
};
export type Plan = {
  version: 1;
  profile: Profile;
  tasks: Task[];
  expenses: Expense[];
  vendors: Vendor[];
  guests: Guest[];
  notes: Note[];
  updatedAt: string;
};
export const STORAGE_KEY = 'owol-wedding-plan-v1';
export const uid = () => crypto.randomUUID();
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export const validMonth = (value: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(`${value}-01`);
export const dayDiff = (date: string, from = today()) =>
  validDate(date) && validDate(from)
    ? Math.round((Date.parse(date) - Date.parse(from)) / 86400000)
    : null;
export const addDays = (date: string, offset: number) =>
  validDate(date) ? new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10) : '';
export const taskDate = (task: Task, weddingDate: string) =>
  task.month ? '' : task.date || addDays(weddingDate, task.offset);
export const taskMonth = (task: Task, weddingDate: string) =>
  task.month || taskDate(task, weddingDate).slice(0, 7);
export const money = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
export const shortMoney = (n: number) =>
  Math.abs(n) >= 10000
    ? `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(n / 10000)}만`
    : money(n);
export const dateLabel = (date: string, full = false) =>
  validDate(date)
    ? new Intl.DateTimeFormat('ko-KR', {
        year: full ? 'numeric' : undefined,
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
      }).format(new Date(date))
    : '날짜 미정';
export const taskDateLabel = (task: Task, weddingDate: string) => {
  if (task.month) {
    const [year, month] = task.month.split('-');
    return `${year}년 ${Number(month)}월 · 날짜 미정`;
  }
  const date = taskDate(task, weddingDate);
  return date ? dateLabel(date) : `D${task.offset > 0 ? '+' : ''}${task.offset}`;
};
export const totals = (expenses: Expense[]) =>
  expenses.reduce(
    (a, e) => ({
      estimated: a.estimated + e.estimated,
      actual: a.actual + e.actual,
      paid: a.paid + e.paid,
      remaining: a.remaining + Math.max(0, e.actual - e.paid),
      groom: a.groom + Math.round((e.actual * e.groomShare) / 100),
      bride: a.bride + e.actual - Math.round((e.actual * e.groomShare) / 100),
    }),
    { estimated: 0, actual: 0, paid: 0, remaining: 0, groom: 0, bride: 0 },
  );
const seedTasks: [string, Category, number][] = [
  ['우리의 결혼 예산 정하기', '기타', -365],
  ['양가 부모님께 인사드리기', '기타', -350],
  ['상견례 날짜와 장소 정하기', '기타', -330],
  ['웨딩홀 후보 비교하기', '웨딩홀', -330],
  ['웨딩홀 투어 및 계약', '웨딩홀', -300],
  ['스튜디오·드레스·메이크업 비교', '스드메', -280],
  ['스드메 패키지 계약', '스드메', -270],
  ['신혼집 지역 및 자금 계획', '신혼집', -240],
  ['신혼여행 일정과 예산 정하기', '신혼여행', -210],
  ['본식 스냅·영상 예약', '본식', -210],
  ['드레스 투어 예약', '스드메', -180],
  ['예물·웨딩밴드 알아보기', '예물·예단', -180],
  ['신혼여행 항공권·숙소 예약', '신혼여행', -180],
  ['웨딩 촬영 준비물 확인', '스드메', -150],
  ['웨딩 촬영', '스드메', -140],
  ['신랑 예복 준비', '예물·예단', -120],
  ['신혼집 계약 및 입주 일정 확인', '신혼집', -120],
  ['양가 한복·혼주 메이크업 예약', '본식', -100],
  ['하객 명단 정리', '기타', -90],
  ['청첩장 문구와 사진 고르기', '본식', -75],
  ['가전·가구 비교 및 주문', '신혼집', -60],
  ['청첩장 전달하기', '본식', -60],
  ['사회·축가·주례 섭외', '본식', -60],
  ['본식 드레스 셀렉', '스드메', -45],
  ['예식 순서와 음악 확정', '본식', -30],
  ['참석 인원 및 보증 인원 확인', '웨딩홀', -21],
  ['계약금·잔금 최종 확인', '기타', -14],
  ['본식 준비물과 동선 확인', '본식', -7],
  ['웨딩데이 최종 체크', '본식', -1],
  ['감사 인사와 결혼 준비 정산', '기타', 7],
];
export function createPlan(): Plan {
  return {
    version: 1,
    profile: {
      groom: '',
      bride: '',
      weddingDate: '',
      weddingTime: '',
      venue: '',
      budget: 30000000,
      invitation:
        '서로의 가장 좋은 친구로,\n이제 평생을 함께하려 합니다.\n저희의 새로운 시작을 축복해 주세요.',
      familyDate: '',
      familyPlace: '',
      familyMemo: '',
    },
    tasks: seedTasks.map(([title, category, offset], i) => ({
      id: `task-${i}`,
      title,
      category,
      offset,
      date: '',
      done: false,
      owner: '함께',
      memo: '',
    })),
    expenses: [],
    vendors: [],
    guests: [],
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}
const textField = (x: unknown, max = 20000): x is string =>
  typeof x === 'string' && x.length <= max;
const amount = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e13;
const dateField = (x: unknown) => x === '' || (typeof x === 'string' && validDate(x));
export function validatePlan(input: unknown): Plan {
  if (!input || typeof input !== 'object') throw new Error('올바른 오월 백업 파일이 아닙니다.');
  const p = input as Plan;
  if (
    p.version !== 1 ||
    !p.profile ||
    ![p.tasks, p.expenses, p.vendors, p.guests, p.notes].every(
      (x) => Array.isArray(x) && x.length <= 10000,
    )
  )
    throw new Error('지원하지 않는 백업 형식입니다.');
  const f = p.profile;
  if (
    ![f.groom, f.bride, f.venue, f.invitation, f.familyPlace, f.familyMemo].every((x) =>
      textField(x),
    ) ||
    !dateField(f.weddingDate) ||
    !dateField(f.familyDate) ||
    !(f.weddingTime === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(f.weddingTime)) ||
    !amount(f.budget)
  )
    throw new Error('기본 정보가 올바르지 않습니다.');
  const base = (x: { id: string }) => x && textField(x.id, 100) && x.id.length > 0;
  const owner = (x: unknown) => ['함께', '신랑', '신부'].includes(x as string);
  const category = (x: unknown) => CATEGORIES.includes(x as Category);
  if (
    !p.tasks.every(
      (x) =>
        base(x) &&
        textField(x.title) &&
        category(x.category) &&
        Number.isInteger(x.offset) &&
        Math.abs(x.offset) <= 36500 &&
        dateField(x.date) &&
        (x.month === undefined ||
          (typeof x.month === 'string' && validMonth(x.month) && x.date === '')) &&
        typeof x.done === 'boolean' &&
        owner(x.owner) &&
        textField(x.memo),
    )
  )
    throw new Error('일정 데이터가 올바르지 않습니다.');
  if (
    !p.expenses.every(
      (x) =>
        base(x) &&
        textField(x.title) &&
        category(x.category) &&
        [x.estimated, x.actual, x.paid].every(amount) &&
        x.paid <= x.actual &&
        amount(x.groomShare) &&
        x.groomShare <= 100 &&
        dateField(x.due) &&
        textField(x.vendor) &&
        textField(x.memo),
    )
  )
    throw new Error('예산 데이터가 올바르지 않습니다. 납부액과 계약 금액을 확인해 주세요.');
  if (
    !p.vendors.every(
      (x) =>
        base(x) &&
        textField(x.name) &&
        category(x.category) &&
        amount(x.price) &&
        textField(x.contact) &&
        textField(x.url) &&
        Number.isInteger(x.rating) &&
        x.rating >= 0 &&
        x.rating <= 5 &&
        ['검토 중', '상담 예정', '계약 완료', '보류'].includes(x.status) &&
        textField(x.memo),
    )
  )
    throw new Error('업체 데이터가 올바르지 않습니다.');
  if (
    !p.guests.every(
      (x) =>
        base(x) &&
        textField(x.name) &&
        owner(x.side) &&
        textField(x.group) &&
        Number.isInteger(x.count) &&
        x.count >= 1 &&
        x.count <= 10000 &&
        ['미정', '참석', '불참'].includes(x.status) &&
        typeof x.invitation === 'boolean' &&
        textField(x.memo),
    )
  )
    throw new Error('하객 데이터가 올바르지 않습니다.');
  if (
    !p.notes.every(
      (x) =>
        base(x) &&
        textField(x.title) &&
        textField(x.body) &&
        textField(x.tag) &&
        dateField(x.date) &&
        typeof x.pinned === 'boolean',
    )
  )
    throw new Error('기록 데이터가 올바르지 않습니다.');
  for (const list of [p.tasks, p.expenses, p.vendors, p.guests, p.notes])
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw new Error('중복된 항목 ID가 있습니다.');
  return {
    version: 1,
    profile: { ...f },
    tasks: p.tasks,
    expenses: p.expenses,
    vendors: p.vendors,
    guests: p.guests,
    notes: p.notes,
    updatedAt: textField(p.updatedAt) ? p.updatedAt : new Date().toISOString(),
  };
}
export function download(content: BlobPart, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCalendar(tasks: Task[], weddingDate: string) {
  const escape = (v: string) =>
    v
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\r/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Owol//Wedding Planner//KO',
    'CALSCALE:GREGORIAN',
  ];
  for (const task of tasks.filter((t) => !t.done && taskDate(t, weddingDate))) {
    const d = taskDate(task, weddingDate);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${task.id}@owol.local`,
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')}`,
      `DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(d, 1).replace(/-/g, '')}`,
      `SUMMARY:${escape(task.title)}`,
      `DESCRIPTION:${escape(task.memo)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545: fold at 75 UTF-8 octets, without splitting multibyte characters.
  return (
    lines
      .map((line) => {
        let result = '',
          size = 0;
        for (const char of line) {
          const bytes = new TextEncoder().encode(char).length;
          if (size + bytes > 75) {
            result += '\r\n ';
            size = 1;
          }
          result += char;
          size += bytes;
        }
        return result;
      })
      .join('\r\n') + '\r\n'
  );
}
