import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  Download,
  Ellipsis,
  FileSpreadsheet,
  Flower2,
  Heart,
  Home,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  NotebookPen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Store,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
  Pencil,
  Clock3,
  Pin,
  TrendingUp,
  CircleAlert,
  ExternalLink,
  Presentation,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Button, Empty, Field, Modal, Progress, SearchInput } from './ui';
import {
  CATEGORIES,
  STORAGE_KEY,
  createPlan,
  dateLabel,
  dayDiff,
  download,
  exportCalendar,
  money,
  shortMoney,
  taskDate,
  today,
  totals,
  uid,
  validatePlan,
  type Category,
  type Expense,
  type Guest,
  type Note,
  type Plan,
  type Task,
  type Vendor,
} from './model';
import { SharedSettings, initializeSharedAuth } from './SharedSettings';
import { Cashflow } from './CashflowView';

type Page =
  | 'dashboard'
  | 'timeline'
  | 'budget'
  | 'cashflow'
  | 'vendors'
  | 'guests'
  | 'notes'
  | 'settings'
  | 'moments';
type Editor =
  | { type: 'task'; item: Task }
  | { type: 'expense'; item: Expense }
  | { type: 'vendor'; item: Vendor }
  | { type: 'guest'; item: Guest }
  | { type: 'note'; item: Note };
const navigation = [
  { id: 'dashboard', label: '한눈에 보기', icon: LayoutDashboard },
  { id: 'timeline', label: '준비 타임라인', icon: CalendarDays },
  { id: 'budget', label: '예산 플래너', icon: Wallet },
  { id: 'cashflow', label: '신혼집 · 자금 계획', icon: TrendingUp },
  { id: 'vendors', label: '업체 비교', icon: Store },
  { id: 'guests', label: '하객 관리', icon: Users },
  { id: 'notes', label: '우리의 기록', icon: NotebookPen },
] as const;
const pageNames: Record<Page, string> = {
  dashboard: '한눈에 보기',
  timeline: '준비 타임라인',
  budget: '예산 플래너',
  cashflow: '신혼집 · 자금 계획',
  vendors: '업체 비교',
  guests: '하객 관리',
  notes: '우리의 기록',
  settings: '설정 · 함께 사용하기',
  moments: '소중한 순간',
};
const categoryColors = [
  '#8871bf',
  '#c399b1',
  '#e0ad70',
  '#8aa89e',
  '#8a9ec5',
  '#bca184',
  '#acacb9',
];
const newTask = (): Task => ({
  id: uid(),
  title: '',
  category: '기타',
  offset: -30,
  date: '',
  done: false,
  owner: '함께',
  memo: '',
});
const newExpense = (): Expense => ({
  id: uid(),
  title: '',
  category: '웨딩홀',
  estimated: 0,
  actual: 0,
  paid: 0,
  groomShare: 50,
  due: '',
  vendor: '',
  memo: '',
});
const newVendor = (): Vendor => ({
  id: uid(),
  name: '',
  category: '웨딩홀',
  price: 0,
  contact: '',
  url: '',
  rating: 0,
  status: '검토 중',
  memo: '',
});
function initialPlan() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return { plan: raw ? validatePlan(JSON.parse(raw)) : createPlan(), raw, error: '' };
  } catch {
    return {
      plan: createPlan(),
      raw,
      error:
        '저장된 데이터를 읽지 못했습니다. 원본을 덮어쓰지 않도록 자동 저장을 멈췄습니다. 백업 파일을 복원해 주세요.',
    };
  }
}
function readPage(): Page {
  const key = location.hash.slice(1);
  return Object.keys(pageNames).includes(key) ? (key as Page) : 'dashboard';
}
export default function App() {
  const [initial] = useState(initialPlan);
  const [plan, setPlan] = useState<Plan>(initial.plan);
  const [storageError, setStorageError] = useState(initial.error);
  const [page, setPage] = useState<Page>(readPage);
  const [mobileNav, setMobileNav] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    action: () => void;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('전체');
  const [timelineView, setTimelineView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    plan: Plan;
    warnings: string[];
    summary: string[];
  } | null>(null);
  const [tourVendor, setTourVendor] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const lastStored = useRef(initial.raw);
  const storageBlocked = useRef(!!initial.error);
  const [tabConflict, setTabConflict] = useState(false);
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    void initializeSharedAuth().catch((e) =>
      setToast(e instanceof Error ? e.message : '로그인을 확인해 주세요.'),
    );
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = () => {
      setPage(readPage());
      setQuery('');
      setFilter('전체');
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    let active = true;
    const save = () => {
      if (!active || storageBlocked.current) return;
      try {
        if (localStorage.getItem(STORAGE_KEY) !== lastStored.current) {
          storageBlocked.current = true;
          setTabConflict(true);
          setStorageError(
            '다른 탭에서 기록이 변경되어 이 탭의 자동 저장을 멈췄습니다. 현재 수정은 백업으로 보관한 뒤 최신 기록을 불러와 주세요.',
          );
          return;
        }
        const raw = JSON.stringify(plan);
        localStorage.setItem(STORAGE_KEY, raw);
        lastStored.current = raw;
        setStorageError('');
      } catch {
        setStorageError(
          '기기 저장 공간이 부족하거나 저장이 차단되어 있습니다. 지금 백업 파일을 내려받아 주세요.',
        );
      }
    };
    if (navigator.locks)
      void navigator.locks.request(STORAGE_KEY, save).catch(() => {
        if (active) setStorageError('기기 저장을 완료하지 못했습니다. 백업을 보관해 주세요.');
      });
    else save();
    return () => {
      active = false;
    };
  }, [plan]);
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if ((e.key === STORAGE_KEY || e.key === null) && e.newValue !== lastStored.current) {
        storageBlocked.current = true;
        setTabConflict(true);
        setStorageError(
          '다른 탭에서 기록이 변경되어 이 탭의 자동 저장을 멈췄습니다. 현재 수정은 백업으로 보관한 뒤 최신 기록을 불러와 주세요.',
        );
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function go(next: Page) {
    location.hash = next;
    setPage(next);
    setMobileNav(false);
    setQuery('');
    setFilter('전체');
    window.scrollTo({ top: 0 });
  }
  function update(fn: (p: Plan) => Plan) {
    setPlan((prev) => ({ ...fn(prev), updatedAt: new Date().toISOString() }));
  }
  function upsert(
    key: 'tasks' | 'expenses' | 'vendors' | 'guests' | 'notes',
    item: Task | Expense | Vendor | Guest | Note,
  ) {
    update((p) => ({
      ...p,
      [key]: p[key].some((x) => x.id === item.id)
        ? p[key].map((x) => (x.id === item.id ? item : x))
        : [...p[key], item],
    }));
    setEditor(null);
    notify('저장했어요.');
  }
  function remove(key: 'tasks' | 'expenses' | 'vendors' | 'guests' | 'notes', id: string) {
    setConfirm({
      title: '이 항목을 삭제할까요?',
      body: '삭제하면 목록에서 사라집니다. 중요한 내용은 백업에 보관해 주세요.',
      action: () => {
        update((p) => ({ ...p, [key]: p[key].filter((x) => x.id !== id) }));
        setEditor(null);
        setConfirm(null);
        notify('항목을 삭제했어요.');
      },
    });
  }
  function toggleTask(id: string) {
    update((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  }
  function backup() {
    download(JSON.stringify(plan, null, 2), `오월-결혼준비-${today()}.json`);
    notify('백업 파일을 내려받았어요.');
  }
  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('30MB 이하의 파일을 선택해 주세요.');
      if (file.name.toLowerCase().endsWith('.json')) {
        const p = validatePlan(JSON.parse(await file.text()));
        setImportPreview({
          plan: p,
          warnings: ['복원하면 현재 기기의 준비 내용이 백업 내용으로 바뀝니다.'],
          summary: [
            `일정 ${p.tasks.length}개`,
            `예산 ${p.expenses.length}개`,
            `업체 ${p.vendors.length}개`,
            `기록 ${p.notes.length}개`,
          ],
        });
      } else {
        const { importWorkbook } = await import('./excel');
        setImportPreview(await importWorkbook(file, plan));
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }
  const budget = totals(plan.expenses),
    completed = plan.tasks.filter((t) => t.done).length,
    progress = plan.tasks.length ? Math.round((completed / plan.tasks.length) * 100) : 0,
    dday = dayDiff(plan.profile.weddingDate);
  const sortedTasks = useMemo(
    () =>
      [...plan.tasks].sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          (taskDate(a, plan.profile.weddingDate) || '9999').localeCompare(
            taskDate(b, plan.profile.weddingDate) || '9999',
          ),
      ),
    [plan.tasks, plan.profile.weddingDate],
  );
  const pending = sortedTasks.filter((t) => !t.done),
    upcoming = pending.filter((t) => {
      const d = dayDiff(taskDate(t, plan.profile.weddingDate));
      return d !== null && d >= 0 && d <= 30;
    });
  const overdue = pending.filter((t) => (dayDiff(taskDate(t, plan.profile.weddingDate)) ?? 0) < 0);
  const filteredTasks = sortedTasks.filter(
    (t) =>
      (filter === '전체' ||
        (filter === '완료' ? t.done : filter === '남은 할 일' ? !t.done : t.category === filter)) &&
      `${t.title} ${t.memo} ${t.owner}`.includes(query),
  );
  const filteredExpenses = plan.expenses.filter(
    (e) => (filter === '전체' || e.category === filter) && `${e.title} ${e.vendor}`.includes(query),
  );
  const taskGroups = filteredTasks.reduce<Record<string, Task[]>>((a, t) => {
    const key = taskDate(t, plan.profile.weddingDate).slice(0, 7) || '미정';
    (a[key] ??= []).push(t);
    return a;
  }, {});
  const filled = !!plan.profile.weddingDate;
  const familyTitle =
    [plan.profile.groom, plan.profile.bride].filter(Boolean).join(' & ') || '우리 두 사람';
  const readableNotes = plan.notes.filter(
    (n) => n.tag !== '자금계획 데이터' && !n.tag.startsWith('투어체크:'),
  );

  function TaskRow({ task }: { task: Task }) {
    const date = taskDate(task, plan.profile.weddingDate),
      days = dayDiff(date);
    return (
      <div className={`task-row ${task.done ? 'is-done' : ''}`}>
        <button
          className={`checkbox ${task.done ? 'checked' : ''}`}
          aria-label={`${task.title} ${task.done ? '완료 취소' : '완료하기'}`}
          onClick={() => toggleTask(task.id)}
        >
          {task.done && <Check size={14} />}
        </button>
        <button className="task-title" onClick={() => setEditor({ type: 'task', item: task })}>
          <span>{task.title}</span>
          <small>
            {task.category} <i /> {task.owner}
          </small>
        </button>
        <span className={`task-date ${days !== null && days < 0 && !task.done ? 'overdue' : ''}`}>
          {date ? dateLabel(date) : `D${task.offset > 0 ? '+' : ''}${task.offset}`}
          <small>
            {task.done
              ? '완료'
              : days === 0
                ? '오늘'
                : days !== null && days < 0
                  ? `${Math.abs(days)}일 지남`
                  : days !== null && days <= 7
                    ? `${days}일 남음`
                    : ''}
          </small>
        </span>
      </div>
    );
  }
  function header(title: string, subtitle: string, action?: React.ReactNode) {
    return (
      <div className="page-heading">
        <div>
          <div className="eyebrow">OUR WEDDING JOURNEY</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action && <div className="heading-actions">{action}</div>}
      </div>
    );
  }
  function filters(items: string[]) {
    return (
      <div className="filter-chips">
        {items.map((item) => (
          <button
            key={item}
            className={filter === item ? 'active' : ''}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <input
        ref={importRef}
        hidden
        type="file"
        accept=".json,.xlsx"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {mobileNav && <div className="nav-overlay" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <button className="brand" onClick={() => go('dashboard')}>
          <span className="brand-mark">
            <Heart size={23} strokeWidth={1.8} />
          </span>
          <span>
            오월<small>OUR WEDDING</small>
          </span>
        </button>
        <div className="couple-mini">
          <div className="couple-avatar">
            <Heart size={20} />
          </div>
          <div>
            <strong>{familyTitle}</strong>
            <span>
              {filled ? plan.profile.weddingDate.replaceAll('-', '.') : '함께 쓰는 웨딩 플래너'}
            </span>
          </div>
          <button
            className="icon-button"
            onClick={() => go('settings')}
            aria-label="우리 정보 수정"
          >
            <Pencil size={14} />
          </button>
        </div>
        <div className="nav-label">우리의 결혼 준비</div>
        <nav aria-label="주 메뉴">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => go(id)}
              aria-current={page === id ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'timeline' && <small>{pending.length}</small>}
            </button>
          ))}
        </nav>
        <div className="nav-label nav-second">그리고, 소중한 순간</div>
        <button
          className={`nav-item ${page === 'moments' ? 'active' : ''}`}
          onClick={() => go('moments')}
        >
          <Flower2 size={19} />
          <span>상견례 · 청첩장</span>
          <span className="tiny-badge">초안</span>
        </button>
        <div className="sidebar-bottom">
          <div className="side-note">
            <Sparkles size={17} />
            <span>
              완벽하지 않아도 괜찮아요.
              <br />
              우리의 속도로 준비해요.
            </span>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => go('settings')}
          >
            <Settings2 size={19} />
            <span>설정 · 함께 사용하기</span>
          </button>
          <div className="sidebar-foot">
            MADE FOR OUR BEGINNING <Heart size={10} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <Home size={16} />
            <span>/</span>
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="save-indicator">
              <CheckCheck size={15} />
              {storageError ? '저장 확인 필요' : '이 기기에 저장됨'}
            </span>
            <button
              className="icon-button"
              onClick={backup}
              aria-label="백업 내려받기"
              title="백업 내려받기"
            >
              <Download size={18} />
            </button>
            <button
              className="profile-button"
              onClick={() => go('settings')}
              aria-label="우리 정보"
            >
              <Heart size={17} />
            </button>
          </div>
        </header>
        <main id="main-content">
          {storageError && (
            <div className="alert error">
              <CircleAlert size={20} />
              <span>{storageError}</span>
              <Button variant="secondary" onClick={backup}>
                백업
              </Button>
              {tabConflict && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setConfirm({
                      title: '다른 탭의 최신 기록을 불러올까요?',
                      body: '현재 이 탭의 내용을 백업한 뒤 새로고침합니다. 다른 탭은 닫아 주세요. 공동 공간은 다시 가져온 후 저장할 수 있습니다.',
                      action: () => {
                        backup();
                        sessionStorage.removeItem('owol-cloud-tab-binding-v1');
                        location.reload();
                      },
                    })
                  }
                >
                  최신 기록 불러오기
                </Button>
              )}
            </div>
          )}
          {page === 'dashboard' && (
            <>
              {header(
                '차근차근, 함께 준비해요',
                `${dateLabel(today(), true)} · 우리의 새로운 시작을 위한 기록`,
                <Button onClick={() => setEditor({ type: 'task', item: newTask() })}>
                  <Plus size={17} />할 일 추가
                </Button>,
              )}
              <div className="welcome-strip">
                <div className="welcome-icon">
                  <Flower2 size={37} strokeWidth={1.15} />
                </div>
                <div className="welcome-text">
                  <span className="eyebrow">THE DAY WE SAY “YES”</span>
                  <h2>{filled ? `${familyTitle}의 결혼식` : '우리의 특별한 날을 정해볼까요?'}</h2>
                  <p>
                    {filled ? (
                      <>
                        <CalendarDays size={14} />
                        {dateLabel(plan.profile.weddingDate, true)} <span>·</span>{' '}
                        {plan.profile.weddingTime}{' '}
                        <span className="venue-inline">
                          <MapPin size={14} />
                          {plan.profile.venue || '장소를 입력해 주세요'}
                        </span>
                      </>
                    ) : (
                      '결혼식 날짜를 등록하면 준비 일정이 자동으로 연결돼요.'
                    )}
                  </p>
                </div>
                <div className="dday">
                  <span>OUR WEDDING DAY</span>
                  <strong>
                    {dday === null
                      ? 'D —'
                      : dday === 0
                        ? 'D-DAY'
                        : `D${dday > 0 ? '-' : '+'}${Math.abs(dday)}`}
                  </strong>
                  <button onClick={() => go('settings')}>
                    결혼식 정보 수정 <Pencil size={12} />
                  </button>
                </div>
              </div>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-icon lavender">
                    <ListChecks size={20} />
                  </span>
                  <div className="stat-label">준비 진행률</div>
                  <div className="stat-value">
                    {progress}
                    <small>%</small>
                    <span className="stat-pill">차곡차곡 준비 중</span>
                  </div>
                  <Progress value={progress} />
                  <div className="stat-foot">
                    전체 {plan.tasks.length}개 중 <b>{completed}개 완료</b>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon peach">
                    <Wallet size={20} />
                  </span>
                  <div className="stat-label">계약 금액 / 총 예산</div>
                  <div className="stat-value">
                    {shortMoney(budget.actual)}
                    <small>원</small>
                  </div>
                  <Progress
                    value={plan.profile.budget ? (budget.actual / plan.profile.budget) * 100 : 0}
                    color="#bd94a9"
                  />
                  <div className="stat-foot">
                    총 {shortMoney(plan.profile.budget)}원{' '}
                    <b className={budget.actual > plan.profile.budget ? 'text-danger' : ''}>
                      {budget.actual > plan.profile.budget ? '예산 초과' : '예산 설정 가능'}
                    </b>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon green">
                    <CalendarDays size={20} />
                  </span>
                  <div className="stat-label">30일 안에 할 일</div>
                  <div className="stat-value">
                    {upcoming.length}
                    <small>개</small>
                  </div>
                  <div className="stat-description">지금 함께 챙겨야 할 준비</div>
                  <div className="stat-foot">
                    {overdue.length
                      ? `기한이 지난 할 일 ${overdue.length}개`
                      : '조금씩, 여유롭게 준비해요'}
                    <button onClick={() => go('timeline')}>일정 보기</button>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon blue">
                    <Users size={20} />
                  </span>
                  <div className="stat-label">참석 예정 하객</div>
                  <div className="stat-value">
                    {plan.guests
                      .filter((g) => g.status === '참석')
                      .reduce((n, g) => n + g.count, 0)}
                    <small>명</small>
                  </div>
                  <div className="stat-description">소중한 날을 함께할 사람들</div>
                  <div className="stat-foot">
                    등록된 하객 {plan.guests.reduce((n, g) => n + g.count, 0)}명
                    <button onClick={() => go('guests')}>명단 보기</button>
                  </div>
                </div>
              </div>
              <div className="dashboard-columns">
                <section className="panel upcoming-panel">
                  <div className="section-head">
                    <div>
                      <h2>
                        다가오는 할 일 <span className="count-pill">{pending.length}</span>
                      </h2>
                      <p>
                        {filled
                          ? '하나씩 체크하며 우리만의 속도로 준비해요.'
                          : '날짜를 등록하기 전에도 할 일을 체크할 수 있어요.'}
                      </p>
                    </div>
                    <button className="text-button" onClick={() => go('timeline')}>
                      전체 보기 <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="task-list">
                    {pending.slice(0, 5).map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                    {!pending.length && (
                      <Empty
                        title="준비를 모두 마쳤어요!"
                        description="새로운 할 일이 생기면 여기에 기록해 보세요."
                      />
                    )}
                  </div>
                  <button
                    className="add-row"
                    onClick={() => setEditor({ type: 'task', item: newTask() })}
                  >
                    <Plus size={16} />
                    새로운 할 일 추가하기
                  </button>
                </section>
                <section className="panel budget-panel">
                  <div className="section-head">
                    <div>
                      <h2>우리의 예산 현황</h2>
                      <p>작은 지출도 놓치지 않도록</p>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => go('budget')}
                      aria-label="예산 상세 보기"
                    >
                      <ChevronRight size={19} />
                    </button>
                  </div>
                  <BudgetDonut expenses={plan.expenses} />
                  <div className="budget-mini">
                    <span>
                      결제 완료
                      <strong>
                        {money(budget.paid)}
                        <small>원</small>
                      </strong>
                    </span>
                    <span>
                      남은 결제
                      <strong>
                        {money(budget.remaining)}
                        <small>원</small>
                      </strong>
                    </span>
                  </div>
                  <button className="text-button budget-link" onClick={() => go('budget')}>
                    예산 자세히 살펴보기 <ChevronRight size={15} />
                  </button>
                </section>
              </div>
              <div className="dashboard-bottom">
                <section className="panel notes-summary">
                  <div className="section-head">
                    <div>
                      <h2>우리의 준비 노트</h2>
                      <p>함께 나누고 싶은 생각을 남겨보세요.</p>
                    </div>
                    <button className="text-button" onClick={() => go('notes')}>
                      모든 기록 <ChevronRight size={15} />
                    </button>
                  </div>
                  {readableNotes.length ? (
                    <div className="note-mini-grid">
                      {[...readableNotes]
                        .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                        .slice(0, 2)
                        .map((n) => (
                          <button
                            className="note-mini"
                            key={n.id}
                            onClick={() => setEditor({ type: 'note', item: n })}
                          >
                            <span>
                              {n.tag || '기록'} · {dateLabel(n.date)}
                            </span>
                            <strong>{n.title}</strong>
                            <p>{n.body.slice(0, 80)}</p>
                          </button>
                        ))}
                    </div>
                  ) : (
                    <button
                      className="blank-note"
                      onClick={() =>
                        setEditor({
                          type: 'note',
                          item: {
                            id: uid(),
                            title: '',
                            body: '',
                            tag: '우리의 생각',
                            date: today(),
                            pinned: false,
                          },
                        })
                      }
                    >
                      <NotebookPen size={26} />
                      <span>
                        <strong>첫 번째 준비 기록을 남겨볼까요?</strong>
                        <small>마음에 드는 공간, 궁금한 점, 함께 정한 것들.</small>
                      </span>
                      <Plus size={20} />
                    </button>
                  )}
                </section>
                <section className="little-card">
                  <Flower2 size={25} />
                  <h3>
                    준비하는 모든 순간도
                    <br />
                    우리의 이야기가 되니까.
                  </h3>
                  <p>
                    상견례 메모와 청첩장 문구를
                    <br />
                    미리 차곡차곡 모아보세요.
                  </p>
                  <button className="text-button" onClick={() => go('moments')}>
                    소중한 순간 기록하기 <ChevronRight size={14} />
                  </button>
                </section>
              </div>
              {!plan.expenses.length && (
                <div className="import-banner">
                  <FileSpreadsheet size={21} />
                  <span>
                    <strong>엑셀에 정리해 둔 준비가 있나요?</strong> 기존 결혼 준비 파일을 불러와
                    이어서 기록해요.
                  </span>
                  <Button
                    variant="secondary"
                    disabled={importing}
                    onClick={() => importRef.current?.click()}
                  >
                    {importing ? '불러오는 중…' : '엑셀 가져오기'}
                  </Button>
                </div>
              )}
            </>
          )}
          {page === 'timeline' && (
            <>
              {header(
                '우리의 준비 타임라인',
                '결혼식 날짜가 바뀌어도, 준비 일정은 함께 움직여요.',
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const scheduled = plan.tasks.filter(
                        (t) => !t.done && taskDate(t, plan.profile.weddingDate),
                      );
                      if (!scheduled.length) {
                        notify('결혼식 날짜나 할 일의 날짜를 먼저 등록해 주세요.');
                        return;
                      }
                      download(
                        exportCalendar(plan.tasks, plan.profile.weddingDate),
                        '결혼준비-일정.ics',
                        'text/calendar;charset=utf-8',
                      );
                    }}
                  >
                    <Download size={16} />
                    캘린더 저장
                  </Button>
                  <Button onClick={() => setEditor({ type: 'task', item: newTask() })}>
                    <Plus size={17} />할 일 추가
                  </Button>
                </>,
              )}
              <div className="timeline-progress panel">
                <div>
                  <span>함께 준비한 만큼, 가까워진 우리</span>
                  <strong>
                    {completed} <small>/ {plan.tasks.length}개 완료</small>
                  </strong>
                </div>
                <Progress value={progress} />
                <b>{progress}%</b>
              </div>
              {!filled && (
                <div className="alert">
                  <CalendarDays size={19} />
                  <span>결혼식 날짜를 등록하면 D-day 기준 일정이 실제 날짜로 표시됩니다.</span>
                  <button className="text-button" onClick={() => go('settings')}>
                    날짜 등록
                  </button>
                </div>
              )}
              <div className="toolbar">
                <SearchInput value={query} onChange={setQuery} placeholder="할 일, 메모 검색" />
                <div className="segmented">
                  <button
                    className={timelineView === 'list' ? 'active' : ''}
                    onClick={() => setTimelineView('list')}
                  >
                    <ListChecks size={16} />
                    목록
                  </button>
                  <button
                    className={timelineView === 'calendar' ? 'active' : ''}
                    onClick={() => setTimelineView('calendar')}
                  >
                    <CalendarDays size={16} />
                    달력
                  </button>
                </div>
              </div>
              {filters(['전체', '남은 할 일', '완료', ...CATEGORIES])}
              {timelineView === 'list' ? (
                <div className="timeline-list">
                  {Object.entries(taskGroups)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, tasks]) => (
                      <section className="timeline-group" key={key}>
                        <div className="month-marker">
                          <span className="timeline-dot" />
                          <h2>
                            {key === '미정'
                              ? '날짜 등록 전'
                              : `${key.slice(0, 4)}년 ${Number(key.slice(5))}월`}
                          </h2>
                          <small>{tasks.length}개의 할 일</small>
                        </div>
                        <div className="panel">
                          {tasks.map((t) => (
                            <TaskRow key={t.id} task={t} />
                          ))}
                        </div>
                      </section>
                    ))}
                  {!filteredTasks.length && (
                    <Empty
                      title="해당하는 일정이 없어요"
                      description="검색 조건을 바꾸거나 새로운 할 일을 추가해 주세요."
                    />
                  )}
                </div>
              ) : (
                <Calendar
                  month={month}
                  setMonth={setMonth}
                  tasks={filteredTasks}
                  weddingDate={plan.profile.weddingDate}
                  edit={(t) => setEditor({ type: 'task', item: t })}
                />
              )}
            </>
          )}
          {page === 'budget' && (
            <>
              {header(
                '마음은 넉넉하게, 예산은 꼼꼼하게',
                '예상 비용부터 계약금과 잔금까지, 한곳에서 관리해요.',
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void import('./excel')
                        .then((m) => m.exportWorkbook(plan))
                        .catch(() => notify('엑셀 내보내기에 실패했습니다.'))
                    }
                  >
                    <ArrowDownToLine size={16} />
                    엑셀 저장
                  </Button>
                  <Button onClick={() => setEditor({ type: 'expense', item: newExpense() })}>
                    <Plus size={17} />
                    예산 항목 추가
                  </Button>
                </>,
              )}
              <div className="budget-overview">
                <section className="budget-total">
                  <span>우리가 정한 총 예산</span>
                  <strong>
                    {money(plan.profile.budget)}
                    <small>원</small>
                  </strong>
                  <button onClick={() => go('settings')}>
                    <Pencil size={13} />
                    예산 수정
                  </button>
                  <Progress
                    value={plan.profile.budget ? (budget.actual / plan.profile.budget) * 100 : 0}
                  />
                  <p>
                    {budget.actual > plan.profile.budget
                      ? `${money(budget.actual - plan.profile.budget)}원 초과했어요`
                      : `계약 기준 ${money(plan.profile.budget - budget.actual)}원 남았어요`}
                  </p>
                </section>
                <section className="panel budget-numbers">
                  {[
                    ['예상 비용', budget.estimated],
                    ['계약 금액', budget.actual],
                    ['결제 완료', budget.paid],
                    ['남은 잔금', budget.remaining],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>
                        {money(Number(value))}
                        <small>원</small>
                      </strong>
                    </div>
                  ))}
                </section>
              </div>
              <div className="toolbar">
                <SearchInput value={query} onChange={setQuery} placeholder="항목 또는 업체 검색" />
                <span className="muted">모든 금액은 원(₩) 단위</span>
              </div>
              {filters(['전체', ...CATEGORIES])}
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>예산 항목</th>
                        <th>예상 비용</th>
                        <th>계약 금액</th>
                        <th>결제 완료</th>
                        <th>남은 잔금</th>
                        <th>결제 예정일</th>
                        <th>상태</th>
                        <th>
                          <span className="sr-only">수정</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExpenses.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <button
                              className="cell-title"
                              onClick={() => setEditor({ type: 'expense', item: e })}
                            >
                              {e.title}
                            </button>
                            <small className="cell-sub">
                              {e.category}
                              {e.vendor && ` · ${e.vendor}`}
                            </small>
                          </td>
                          <td>{money(e.estimated)}</td>
                          <td>{money(e.actual)}</td>
                          <td>{money(e.paid)}</td>
                          <td className={e.actual - e.paid > 0 ? 'text-purple' : ''}>
                            {money(e.actual - e.paid)}
                          </td>
                          <td>{e.due ? dateLabel(e.due) : '—'}</td>
                          <td>
                            <span
                              className={`badge ${e.actual > 0 && e.paid >= e.actual ? 'green' : e.paid > 0 ? 'purple' : 'neutral'}`}
                            >
                              {e.actual > 0 && e.paid >= e.actual
                                ? '결제 완료'
                                : e.paid > 0
                                  ? '일부 결제'
                                  : '준비 중'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              onClick={() => setEditor({ type: 'expense', item: e })}
                              aria-label={`${e.title} 수정`}
                            >
                              <Pencil size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {!!filteredExpenses.length && (
                      <tfoot>
                        <tr>
                          <td>
                            합계 <small>{filteredExpenses.length}개 항목</small>
                          </td>
                          <td>{money(totals(filteredExpenses).estimated)}</td>
                          <td>{money(totals(filteredExpenses).actual)}</td>
                          <td>{money(totals(filteredExpenses).paid)}</td>
                          <td>{money(totals(filteredExpenses).remaining)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {!filteredExpenses.length && (
                  <Empty
                    title={plan.expenses.length ? '검색 결과가 없어요' : '첫 예산을 기록해 보세요'}
                    description="웨딩홀, 스드메, 신혼여행… 예상 금액부터 하나씩 입력해요."
                    action="예산 항목 추가"
                    onAction={() => setEditor({ type: 'expense', item: newExpense() })}
                  />
                )}
              </section>
              <div className="split-panels">
                <section className="panel">
                  <div className="section-head">
                    <h2>카테고리별 계약 금액</h2>
                  </div>
                  {CATEGORIES.map((c, i) => {
                    const amount = plan.expenses
                      .filter((e) => e.category === c)
                      .reduce((n, e) => n + e.actual, 0);
                    return (
                      <div className="category-bar" key={c}>
                        <div>
                          <span>
                            <i style={{ background: categoryColors[i] }} />
                            {c}
                          </span>
                          <strong>{money(amount)}원</strong>
                        </div>
                        <Progress
                          value={budget.actual ? (amount / budget.actual) * 100 : 0}
                          color={categoryColors[i]}
                        />
                      </div>
                    );
                  })}
                </section>
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h2>우리의 부담 계획</h2>
                      <p>항목별로 설정한 신랑·신부 비율로 계산해요.</p>
                    </div>
                  </div>
                  <div className="share-card">
                    <span className="share-avatar">{plan.profile.groom.slice(0, 1) || '랑'}</span>
                    <div>
                      <span>{plan.profile.groom || '신랑'} 부담액</span>
                      <strong>
                        {money(budget.groom)}
                        <small>원</small>
                      </strong>
                    </div>
                  </div>
                  <div className="share-card">
                    <span className="share-avatar pink">
                      {plan.profile.bride.slice(0, 1) || '부'}
                    </span>
                    <div>
                      <span>{plan.profile.bride || '신부'} 부담액</span>
                      <strong>
                        {money(budget.bride)}
                        <small>원</small>
                      </strong>
                    </div>
                  </div>
                  <p className="help-text">
                    계약 금액을 기준으로 계산합니다. 예산 항목을 수정하면 부담 비율을 바꿀 수
                    있어요.
                  </p>
                  <VenueCalculator />
                </section>
              </div>
            </>
          )}
          {page === 'cashflow' && <Cashflow plan={plan} update={update} notify={notify} />}
          {page === 'vendors' && (
            <>
              {header(
                '우리에게 꼭 맞는 곳 찾기',
                '상담 내용과 견적을 나란히 두고 천천히 비교해요.',
                <Button onClick={() => setEditor({ type: 'vendor', item: newVendor() })}>
                  <Plus size={17} />
                  업체 추가
                </Button>,
              )}
              <div className="toolbar">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="업체명 또는 메모 검색"
                />
                <span className="muted">
                  계약 완료 {plan.vendors.filter((v) => v.status === '계약 완료').length}곳
                </span>
              </div>
              {filters(['전체', ...CATEGORIES])}
              <div className="vendor-grid">
                {plan.vendors
                  .filter(
                    (v) =>
                      (filter === '전체' || filter === v.category) &&
                      `${v.name} ${v.memo}`.includes(query),
                  )
                  .map((v) => (
                    <article className="panel vendor-card" key={v.id}>
                      <div className="vendor-card-top">
                        <span className="badge neutral">{v.category}</span>
                        <button
                          className="icon-button"
                          onClick={() => setEditor({ type: 'vendor', item: v })}
                          aria-label={`${v.name} 수정`}
                        >
                          <Ellipsis size={20} />
                        </button>
                      </div>
                      <h2>{v.name}</h2>
                      <div className="stars" aria-label={`선호도 ${v.rating}점`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star size={15} key={i} fill={i < v.rating ? 'currentColor' : 'none'} />
                        ))}
                      </div>
                      <div className="vendor-price">
                        {v.price ? money(v.price) : '견적 미등록'}
                        {v.price > 0 && <small>원</small>}
                      </div>
                      <span className={`badge ${v.status === '계약 완료' ? 'green' : 'purple'}`}>
                        {v.status}
                      </span>
                      <p>{v.memo || '상담 후 기억하고 싶은 점을 남겨보세요.'}</p>
                      {v.contact && <span className="vendor-contact">연락처 · {v.contact}</span>}
                      <div className="vendor-actions">
                        {v.url && /^https?:\/\//i.test(v.url) && (
                          <a className="text-button" href={v.url} target="_blank" rel="noreferrer">
                            업체 링크 <ExternalLink size={14} />
                          </a>
                        )}
                        {v.category === '웨딩홀' && (
                          <button className="text-button" onClick={() => setTourVendor(v.id)}>
                            <ClipboardList size={15} />
                            투어 체크
                          </button>
                        )}
                        <button
                          className="text-button"
                          onClick={() =>
                            setEditor({
                              type: 'expense',
                              item: {
                                ...newExpense(),
                                title: v.name,
                                category: v.category,
                                vendor: v.name,
                                estimated: v.price,
                              },
                            })
                          }
                        >
                          <Plus size={14} />
                          예산에 추가
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!plan.vendors.length && (
                <section className="panel">
                  <Empty
                    title="마음에 드는 업체를 모아보세요"
                    description="웨딩홀, 스튜디오, 드레스, 메이크업의 견적과 상담 내용을 비교할 수 있어요."
                    action="첫 업체 추가"
                    onAction={() => setEditor({ type: 'vendor', item: newVendor() })}
                  />
                </section>
              )}
            </>
          )}
          {page === 'guests' && (
            <>
              {header(
                '우리의 날을 함께할 사람들',
                '초대와 참석 여부를 확인하고, 최종 인원을 정리해요.',
                <Button
                  onClick={() =>
                    setEditor({
                      type: 'guest',
                      item: {
                        id: uid(),
                        name: '',
                        side: '함께',
                        group: '친구',
                        count: 1,
                        status: '미정',
                        invitation: false,
                        memo: '',
                      },
                    })
                  }
                >
                  <Plus size={17} />
                  하객 추가
                </Button>,
              )}
              <div className="simple-stats">
                {['전체', '참석', '미정', '불참'].map((s) => (
                  <div className="panel" key={s}>
                    <span>{s === '전체' ? '등록 인원' : s}</span>
                    <strong>
                      {plan.guests
                        .filter((g) => s === '전체' || g.status === s)
                        .reduce((n, g) => n + g.count, 0)}
                      <small>명</small>
                    </strong>
                  </div>
                ))}
              </div>
              <div className="toolbar">
                <SearchInput value={query} onChange={setQuery} placeholder="이름 또는 그룹 검색" />
                {filters(['전체', '신랑', '신부', '함께'])}
              </div>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>구분</th>
                        <th>그룹</th>
                        <th>동반 포함</th>
                        <th>참석 여부</th>
                        <th>청첩장 전달</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.guests
                        .filter(
                          (g) =>
                            (filter === '전체' || g.side === filter) &&
                            `${g.name} ${g.group}`.includes(query),
                        )
                        .map((g) => (
                          <tr key={g.id}>
                            <td>
                              <button
                                className="cell-title"
                                onClick={() => setEditor({ type: 'guest', item: g })}
                              >
                                {g.name}
                              </button>
                            </td>
                            <td>{g.side}</td>
                            <td>{g.group}</td>
                            <td>{g.count}명</td>
                            <td>
                              <select
                                aria-label={`${g.name} 참석 여부`}
                                className="inline-select"
                                value={g.status}
                                onChange={(e) =>
                                  update((p) => ({
                                    ...p,
                                    guests: p.guests.map((x) =>
                                      x.id === g.id
                                        ? { ...x, status: e.target.value as Guest['status'] }
                                        : x,
                                    ),
                                  }))
                                }
                              >
                                {['미정', '참석', '불참'].map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                className={`checkbox ${g.invitation ? 'checked' : ''}`}
                                aria-label={`${g.name} 청첩장 전달 ${g.invitation ? '취소' : '완료'}`}
                                onClick={() =>
                                  update((p) => ({
                                    ...p,
                                    guests: p.guests.map((x) =>
                                      x.id === g.id ? { ...x, invitation: !x.invitation } : x,
                                    ),
                                  }))
                                }
                              >
                                {g.invitation && <Check size={14} />}
                              </button>
                            </td>
                            <td className="truncate">{g.memo || '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!plan.guests.length && (
                  <Empty
                    title="소중한 사람들을 기록해 주세요"
                    description="하객 수에는 동반인을 포함해 입력하면 식사 인원까지 편하게 계산할 수 있어요."
                  />
                )}
              </section>
            </>
          )}
          {page === 'notes' && (
            <>
              {header(
                '준비하는 오늘도, 우리의 기록',
                '함께 결정한 것, 잊고 싶지 않은 생각을 남겨요.',
                <Button
                  onClick={() =>
                    setEditor({
                      type: 'note',
                      item: {
                        id: uid(),
                        title: '',
                        body: '',
                        tag: '우리의 생각',
                        date: today(),
                        pinned: false,
                      },
                    })
                  }
                >
                  <Plus size={17} />
                  기록 남기기
                </Button>,
              )}
              <div className="toolbar">
                <SearchInput value={query} onChange={setQuery} placeholder="제목 또는 내용 검색" />
                <span className="muted">{readableNotes.length}개의 기록</span>
              </div>
              <div className="note-grid">
                {[...readableNotes]
                  .filter((n) => `${n.title} ${n.body} ${n.tag}`.includes(query))
                  .sort(
                    (a, b) => Number(b.pinned) - Number(a.pinned) || b.date.localeCompare(a.date),
                  )
                  .map((n) => (
                    <button
                      className="note-card"
                      key={n.id}
                      onClick={() => setEditor({ type: 'note', item: n })}
                    >
                      <div>
                        <span className="badge purple">{n.tag || '기록'}</span>
                        {n.pinned && <Pin size={16} />}
                      </div>
                      <h2>{n.title}</h2>
                      <p>{n.body}</p>
                      <small>{dateLabel(n.date, true)}</small>
                    </button>
                  ))}
              </div>
              {!readableNotes.length && (
                <section className="panel">
                  <Empty
                    title="두 사람이 함께 쓰는 준비 노트"
                    description="상담 메모부터 서로에게 전하는 짧은 응원까지, 편하게 남겨보세요."
                    action="첫 기록 남기기"
                    onAction={() =>
                      setEditor({
                        type: 'note',
                        item: {
                          id: uid(),
                          title: '',
                          body: '',
                          tag: '우리의 생각',
                          date: today(),
                          pinned: false,
                        },
                      })
                    }
                  />
                </section>
              )}
            </>
          )}
          {page === 'settings' && (
            <>
              {header('우리의 준비 공간 설정', '기본 정보를 정하고, 기록을 안전하게 보관해요.')}
              <section className="panel settings-panel">
                <div className="section-head">
                  <div>
                    <h2>
                      <Heart size={19} /> 우리 두 사람
                    </h2>
                    <p>결혼식 날짜를 바꾸면 직접 지정한 날짜를 제외한 일정이 자동 조정됩니다.</p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    update((p) => ({
                      ...p,
                      profile: {
                        ...p.profile,
                        groom: String(f.get('groom') || '').trim(),
                        bride: String(f.get('bride') || '').trim(),
                        weddingDate: String(f.get('weddingDate') || ''),
                        weddingTime: String(f.get('weddingTime') || '12:00'),
                        venue: String(f.get('venue') || '').trim(),
                        budget: Number(f.get('budget')),
                      },
                    }));
                    notify('우리 정보를 저장했어요.');
                  }}
                  key={JSON.stringify(plan.profile)}
                >
                  <div className="form-grid">
                    <Field label="신랑 이름">
                      <input
                        name="groom"
                        defaultValue={plan.profile.groom}
                        placeholder="이름을 입력해 주세요"
                        maxLength={50}
                      />
                    </Field>
                    <Field label="신부 이름">
                      <input
                        name="bride"
                        defaultValue={plan.profile.bride}
                        placeholder="이름을 입력해 주세요"
                        maxLength={50}
                      />
                    </Field>
                    <Field label="결혼식 날짜">
                      <input
                        name="weddingDate"
                        type="date"
                        defaultValue={plan.profile.weddingDate}
                      />
                    </Field>
                    <Field label="결혼식 시간">
                      <input
                        name="weddingTime"
                        type="time"
                        required
                        defaultValue={plan.profile.weddingTime}
                      />
                    </Field>
                    <Field label="웨딩홀 / 장소">
                      <input
                        name="venue"
                        defaultValue={plan.profile.venue}
                        placeholder="예식 장소"
                        maxLength={200}
                      />
                    </Field>
                    <Field
                      label="총 예산 (원)"
                      hint="처음 표시된 3,000만 원은 수정할 수 있는 시작 값입니다."
                    >
                      <input
                        name="budget"
                        type="number"
                        min="0"
                        max="10000000000000"
                        step="1"
                        required
                        defaultValue={plan.profile.budget}
                      />
                    </Field>
                  </div>
                  <div className="form-footer">
                    <Button type="submit">
                      <Check size={17} />
                      기본 정보 저장
                    </Button>
                  </div>
                </form>
              </section>
              <SharedSettings
                plan={plan}
                onReplace={(p) => {
                  storageBlocked.current = false;
                  lastStored.current = localStorage.getItem(STORAGE_KEY);
                  setTabConflict(false);
                  setPlan(p);
                  setStorageError('');
                }}
                notify={notify}
                confirm={setConfirm}
              />
              <section className="panel settings-panel">
                <div className="section-head">
                  <div>
                    <h2>
                      <ShieldCheck size={20} /> 백업과 데이터 관리
                    </h2>
                    <p>
                      기기 저장 내용은 브라우저 데이터를 지우면 사라집니다. 중요한 기록은 백업해
                      주세요.
                    </p>
                  </div>
                </div>
                <div className="data-actions">
                  <button onClick={backup}>
                    <Download size={22} />
                    <strong>전체 백업 저장</strong>
                    <span>모든 기록을 JSON 파일로 보관</span>
                  </button>
                  <button onClick={() => importRef.current?.click()} disabled={importing}>
                    <Upload size={22} />
                    <strong>{importing ? '파일을 읽고 있어요…' : '엑셀 / 백업 불러오기'}</strong>
                    <span>미리 확인한 후 적용할 수 있어요</span>
                  </button>
                  <button
                    onClick={() =>
                      void import('./excel')
                        .then((m) => m.exportWorkbook(plan))
                        .catch(() => notify('내보내기에 실패했습니다.'))
                    }
                  >
                    <FileSpreadsheet size={22} />
                    <strong>엑셀로 내보내기</strong>
                    <span>지금까지의 준비를 엑셀로 정리</span>
                  </button>
                </div>
                <p className="help-text">
                  원본 엑셀 파일은 웹사이트에 공개되지 않습니다. 불러온 내용은 이 기기와 직접 연결한
                  공동 공간에만 저장됩니다.
                </p>
              </section>
            </>
          )}
          {page === 'moments' && (
            <Moments
              key={JSON.stringify(plan.profile)}
              plan={plan}
              update={update}
              notify={notify}
            />
          )}
          <footer className="page-footer">
            <span>오월 · 우리만의 결혼 준비</span>
            <span>
              차곡차곡 쌓이는 우리의 시작 <Heart size={11} />
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <ItemEditor
          editor={editor}
          plan={plan}
          onClose={() => setEditor(null)}
          onSave={upsert}
          onDelete={remove}
        />
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="modal-copy">{confirm.body}</p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              취소
            </Button>
            <Button variant="danger" onClick={confirm.action}>
              확인
            </Button>
          </div>
        </Modal>
      )}
      {importPreview && (
        <Modal title="불러올 내용을 확인해 주세요" wide onClose={() => setImportPreview(null)}>
          <div className="import-summary">
            {importPreview.summary.map((s, i) => (
              <span className="badge purple" key={i}>
                {s}
              </span>
            ))}
          </div>
          <div className="import-warnings">
            {importPreview.warnings.map((w, i) => (
              <p key={i}>
                <CircleAlert size={16} />
                {w}
              </p>
            ))}
          </div>
          <p className="help-text">
            현재 기록은 적용 전에 자동으로 백업 파일을 내려받습니다. 공동 공간에는 ‘공동 공간에
            저장’을 눌러 반영해 주세요.
          </p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setImportPreview(null)}>
              취소
            </Button>
            <Button
              onClick={() => {
                backup();
                storageBlocked.current = false;
                lastStored.current = localStorage.getItem(STORAGE_KEY);
                setTabConflict(false);
                setPlan(importPreview.plan);
                setStorageError('');
                setImportPreview(null);
                notify('파일을 불러왔어요. 날짜와 결제 금액을 확인해 주세요.');
              }}
            >
              백업 후 적용
            </Button>
          </div>
        </Modal>
      )}
      {tourVendor && (
        <TourChecklist
          vendor={plan.vendors.find((v) => v.id === tourVendor)!}
          plan={plan}
          update={update}
          onClose={() => setTourVendor(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function BudgetDonut({ expenses }: { expenses: Expense[] }) {
  const all = totals(expenses).actual;
  let angle = 0;
  const segments = CATEGORIES.map((c, i) => {
    const amount = expenses.filter((e) => e.category === c).reduce((n, e) => n + e.actual, 0);
    const start = angle;
    angle += all ? (amount / all) * 360 : 0;
    return `${categoryColors[i]} ${start}deg ${angle}deg`;
  });
  return (
    <div className="donut-area">
      <div
        className="donut"
        style={{ background: all ? `conic-gradient(${segments.join(',')})` : '#eeebf5' }}
      >
        <div>
          <span>총 계약 금액</span>
          <strong>
            {shortMoney(all)}
            <small>원</small>
          </strong>
        </div>
      </div>
      <div className="donut-legend">
        {CATEGORIES.slice(0, 4).map((c, i) => (
          <span key={c}>
            <i style={{ background: categoryColors[i] }} />
            {c}
          </span>
        ))}
        <span>
          <i style={{ background: categoryColors[4] }} />그 외 항목
        </span>
      </div>
    </div>
  );
}

function Calendar({
  month,
  setMonth,
  tasks,
  weddingDate,
  edit,
}: {
  month: string;
  setMonth: (m: string) => void;
  tasks: Task[];
  weddingDate: string;
  edit: (t: Task) => void;
}) {
  const [selectedDate, setSelectedDate] = useState(today());
  const [y, m] = month.split('-').map(Number),
    first = new Date(y, m - 1, 1).getDay(),
    last = new Date(y, m, 0).getDate();
  const move = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <section className="panel calendar-panel">
      <div className="calendar-head">
        <h2>
          {y}년 {m}월
        </h2>
        <div>
          <button className="icon-button" aria-label="이전 달" onClick={() => move(-1)}>
            <ChevronLeft size={20} />
          </button>
          <button className="text-button" onClick={() => setMonth(today().slice(0, 7))}>
            이번 달
          </button>
          <button className="icon-button" aria-label="다음 달" onClick={() => move(1)}>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <div key={d} className="weekday">
            {d}
          </div>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <div className="calendar-cell blank" key={`blank-${i}`} />
        ))}
        {Array.from({ length: last }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const dayTasks = tasks.filter((t) => taskDate(t, weddingDate) === date);
          return (
            <div
              key={date}
              className={`calendar-cell ${date === today() ? 'today' : ''} ${date === selectedDate ? 'selected-date' : ''}`}
            >
              <span className="day-number">{i + 1}</span>
              {!!dayTasks.length && (
                <button
                  className="calendar-day-count"
                  aria-label={`${dateLabel(date)} 일정 ${dayTasks.length}개 보기`}
                  onClick={() => setSelectedDate(date)}
                >
                  {dayTasks.length}개
                </button>
              )}
              {date === weddingDate && <span className="wedding-event">우리의 결혼식 ♡</span>}
              {dayTasks.map((t) => (
                <button
                  className={`calendar-event ${t.done ? 'done' : ''}`}
                  key={t.id}
                  onClick={() => edit(t)}
                >
                  {t.done ? '✓ ' : ''}
                  {t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="calendar-day-detail">
        <h3>{dateLabel(selectedDate)}의 할 일</h3>
        {tasks
          .filter((t) => taskDate(t, weddingDate) === selectedDate)
          .map((t) => (
            <button key={t.id} onClick={() => edit(t)}>
              <span>
                {t.done ? '✓ ' : ''}
                {t.title}
              </span>
              <small>
                {t.category} · {t.owner}
              </small>
            </button>
          ))}
        {!tasks.some((t) => taskDate(t, weddingDate) === selectedDate) && (
          <p>일정이 있는 날짜의 개수를 누르면 내용을 확인할 수 있어요.</p>
        )}
      </div>
    </section>
  );
}

function ItemEditor({
  editor,
  plan,
  onClose,
  onSave,
  onDelete,
}: {
  editor: Editor;
  plan: Plan;
  onClose: () => void;
  onSave: (
    key: 'tasks' | 'expenses' | 'vendors' | 'guests' | 'notes',
    item: Task | Expense | Vendor | Guest | Note,
  ) => void;
  onDelete: (key: 'tasks' | 'expenses' | 'vendors' | 'guests' | 'notes', id: string) => void;
}) {
  const [error, setError] = useState('');
  const [dateMode, setDateMode] = useState(
    editor.type === 'task' && editor.item.date ? 'fixed' : 'relative',
  );
  const map = {
    task: 'tasks',
    expense: 'expenses',
    vendor: 'vendors',
    guest: 'guests',
    note: 'notes',
  } as const;
  const key = map[editor.type],
    exists = plan[key].some((x) => x.id === editor.item.id);
  const names = {
    task: '할 일',
    expense: '예산 항목',
    vendor: '업체',
    guest: '하객',
    note: '기록',
  };
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      s = (k: string) => String(f.get(k) || '').trim(),
      n = (k: string) => Number(f.get(k));
    let item: Task | Expense | Vendor | Guest | Note;
    if (editor.type === 'task')
      item = {
        ...editor.item,
        title: s('title'),
        category: s('category') as Category,
        owner: s('owner') as Task['owner'],
        date: dateMode === 'fixed' ? s('date') : '',
        offset: dateMode === 'relative' ? n('offset') : editor.item.offset,
        memo: s('memo'),
      };
    else if (editor.type === 'expense') {
      if (n('paid') > n('actual')) {
        setError('결제 완료 금액은 계약 금액보다 클 수 없습니다.');
        return;
      }
      item = {
        ...editor.item,
        title: s('title'),
        category: s('category') as Category,
        estimated: n('estimated'),
        actual: n('actual'),
        paid: n('paid'),
        groomShare: n('groomShare'),
        due: s('due'),
        vendor: s('vendor'),
        memo: s('memo'),
      };
    } else if (editor.type === 'vendor')
      item = {
        ...editor.item,
        name: s('name'),
        category: s('category') as Category,
        price: n('price'),
        contact: s('contact'),
        url: s('url'),
        rating: n('rating'),
        status: s('status') as Vendor['status'],
        memo: s('memo'),
      };
    else if (editor.type === 'guest')
      item = {
        ...editor.item,
        name: s('name'),
        side: s('side') as Guest['side'],
        group: s('group'),
        count: n('count'),
        status: s('status') as Guest['status'],
        invitation: f.get('invitation') === 'on',
        memo: s('memo'),
      };
    else
      item = {
        ...editor.item,
        title: s('title'),
        body: s('body'),
        tag: s('tag'),
        date: s('date'),
        pinned: f.get('pinned') === 'on',
      };
    if (('title' in item && !item.title) || ('name' in item && !item.name)) {
      setError('이름이나 제목을 입력해 주세요.');
      return;
    }
    try {
      const items = exists
        ? plan[key].map((x) => (x.id === item.id ? item : x))
        : [...plan[key], item];
      validatePlan({ ...plan, [key]: items });
      onSave(key, item);
    } catch (e) {
      setError(e instanceof Error ? e.message : '입력값을 확인해 주세요.');
    }
  }
  const category = (value: Category) => (
    <Field label="카테고리">
      <select name="category" defaultValue={value}>
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  );
  const memo = (value: string) => (
    <Field label="메모" full>
      <textarea
        name="memo"
        rows={3}
        defaultValue={value}
        maxLength={20000}
        placeholder="기억해 둘 내용을 남겨주세요"
      />
    </Field>
  );
  const num = (label: string, name: string, value: number, max = 1e13) => (
    <Field label={label}>
      <input name={name} type="number" min="0" max={max} step="1" defaultValue={value} required />
    </Field>
  );
  return (
    <Modal title={`${names[editor.type]} ${exists ? '수정' : '추가'}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {editor.type === 'task' && (
            <>
              <Field label="할 일" full>
                <input
                  name="title"
                  defaultValue={editor.item.title}
                  required
                  maxLength={200}
                  placeholder="어떤 준비를 할까요?"
                  autoFocus
                />
              </Field>
              {category(editor.item.category)}
              <Field label="담당">
                <select name="owner" defaultValue={editor.item.owner}>
                  {['함께', '신랑', '신부'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="일정 기준">
                <select value={dateMode} onChange={(e) => setDateMode(e.target.value)}>
                  <option value="relative">결혼식 날짜 기준</option>
                  <option value="fixed">직접 날짜 지정</option>
                </select>
              </Field>
              {dateMode === 'relative' ? (
                <Field label="결혼식 기준 일수" hint="예: 30일 전은 -30, 7일 후는 7">
                  <input
                    name="offset"
                    type="number"
                    min="-36500"
                    max="36500"
                    required
                    defaultValue={editor.item.offset}
                  />
                </Field>
              ) : (
                <Field label="진행 날짜">
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={editor.item.date || today()}
                  />
                </Field>
              )}
              {memo(editor.item.memo)}
            </>
          )}
          {editor.type === 'expense' && (
            <>
              <Field label="예산 항목" full>
                <input
                  autoFocus
                  name="title"
                  required
                  defaultValue={editor.item.title}
                  maxLength={200}
                  placeholder="예: 웨딩홀 대관료"
                />
              </Field>
              {category(editor.item.category)}
              <Field label="업체명">
                <input name="vendor" defaultValue={editor.item.vendor} maxLength={200} />
              </Field>
              {num('예상 비용 (원)', 'estimated', editor.item.estimated)}
              {num('계약 금액 (원)', 'actual', editor.item.actual)}
              {num('결제 완료 (원)', 'paid', editor.item.paid)}
              <Field label="잔금 결제 예정일">
                <input type="date" name="due" defaultValue={editor.item.due} />
              </Field>
              {num('신랑 부담 비율 (%)', 'groomShare', editor.item.groomShare, 100)}
              <div className="field-note">
                나머지 비율은 신부 부담액으로 자동 계산합니다. 아직 계약 전이라면 계약 금액을 0으로
                두세요.
              </div>
              {memo(editor.item.memo)}
            </>
          )}
          {editor.type === 'vendor' && (
            <>
              <Field label="업체명" full>
                <input
                  autoFocus
                  name="name"
                  required
                  defaultValue={editor.item.name}
                  maxLength={200}
                />
              </Field>
              {category(editor.item.category)}
              <Field label="진행 상태">
                <select name="status" defaultValue={editor.item.status}>
                  {['검토 중', '상담 예정', '계약 완료', '보류'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              {num('견적 금액 (원)', 'price', editor.item.price)}
              <Field label="선호도">
                <select name="rating" defaultValue={editor.item.rating}>
                  {[0, 1, 2, 3, 4, 5].map((x) => (
                    <option value={x} key={x}>
                      {x ? '★'.repeat(x) : '아직 평가하지 않음'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="연락처">
                <input name="contact" defaultValue={editor.item.contact} maxLength={200} />
              </Field>
              <Field label="업체 링크">
                <input
                  name="url"
                  type="url"
                  pattern="https?://.*"
                  defaultValue={editor.item.url}
                  placeholder="https://"
                  maxLength={2000}
                />
              </Field>
              {memo(editor.item.memo)}
            </>
          )}
          {editor.type === 'guest' && (
            <>
              <Field label="이름" full>
                <input
                  autoFocus
                  name="name"
                  required
                  defaultValue={editor.item.name}
                  maxLength={100}
                />
              </Field>
              <Field label="구분">
                <select name="side" defaultValue={editor.item.side}>
                  {['함께', '신랑', '신부'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="그룹">
                <input
                  name="group"
                  defaultValue={editor.item.group}
                  list="guest-groups"
                  maxLength={100}
                />
                <datalist id="guest-groups">
                  {['가족', '친척', '친구', '직장', '지인'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </datalist>
              </Field>
              <Field label="동반인 포함 인원">
                <input
                  name="count"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  required
                  defaultValue={editor.item.count}
                />
              </Field>
              <Field label="참석 여부">
                <select name="status" defaultValue={editor.item.status}>
                  {['미정', '참석', '불참'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <label className="check-label span-2">
                <input type="checkbox" name="invitation" defaultChecked={editor.item.invitation} />
                청첩장 전달 완료
              </label>
              {memo(editor.item.memo)}
            </>
          )}
          {editor.type === 'note' && (
            <>
              <Field label="기록 제목" full>
                <input
                  autoFocus
                  name="title"
                  required
                  defaultValue={editor.item.title}
                  maxLength={200}
                />
              </Field>
              <Field label="분류">
                <input
                  name="tag"
                  defaultValue={editor.item.tag}
                  maxLength={100}
                  placeholder="상담 메모, 우리의 생각…"
                />
              </Field>
              <Field label="기록 날짜">
                <input name="date" type="date" required defaultValue={editor.item.date} />
              </Field>
              <Field label="내용" full>
                <textarea
                  name="body"
                  rows={9}
                  defaultValue={editor.item.body}
                  maxLength={20000}
                  placeholder="우리의 생각을 자유롭게 남겨주세요."
                />
              </Field>
              <label className="check-label span-2">
                <input type="checkbox" name="pinned" defaultChecked={editor.item.pinned} />
                중요한 기록으로 고정
              </label>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          {exists && (
            <button
              type="button"
              className="delete-button"
              onClick={() => onDelete(key, editor.item.id)}
            >
              <Trash2 size={16} />
              삭제
            </button>
          )}
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit">저장하기</Button>
        </div>
      </form>
    </Modal>
  );
}

function VenueCalculator() {
  const [rental, setRental] = useState(0),
    [meal, setMeal] = useState(0),
    [guarantee, setGuarantee] = useState(0),
    [guests, setGuests] = useState(0),
    [options, setOptions] = useState(0);
  return (
    <div className="venue-calculator">
      <h3>웨딩홀 견적 계산기</h3>
      <div className="form-grid">
        {[
          ['대관료 (원)', rental, setRental],
          ['1인 식대 (원)', meal, setMeal],
          ['보증 인원', guarantee, setGuarantee],
          ['예상 참석 인원', guests, setGuests],
          ['기타 비용 (원)', options, setOptions],
        ].map(([l, v, set]) => (
          <Field label={l as string} key={l as string}>
            <input
              type="number"
              min="0"
              max="10000000000000"
              value={v as number}
              onChange={(e) => (set as (n: number) => void)(Math.max(0, Number(e.target.value)))}
            />
          </Field>
        ))}
      </div>
      <div className="calculator-result">
        <span>예상 합계</span>
        <strong>{money(rental + meal * Math.max(guarantee, guests) + options)}원</strong>
      </div>
      <small>
        식대는 보증 인원과 예상 인원 중 큰 인원으로 계산합니다. 계산기 입력값은 저장되지 않습니다.
      </small>
    </div>
  );
}

const tourQuestions = [
  '위치·대중교통 접근성 확인',
  '예식 날짜와 시간 가능 여부',
  '홀 단독 사용 여부와 동시 예식 수',
  '예식 간격과 실제 사용 가능 시간',
  '대관료·필수 옵션·부가세 포함 여부',
  '1인 식대와 최소 보증 인원',
  '보증 인원 변경 마감일',
  '시식 가능 여부와 메뉴 구성',
  '주차 대수·무료 시간·셔틀',
  '신부 대기실·혼주 대기실·탈의실',
  '생화 장식·음향·조명 구성',
  '식전 영상·사회자·축가 장비',
  '외부 스냅·영상 업체 반입 조건',
  '계약금·중도금·잔금 납부일',
  '취소·일정 변경·환불 규정',
];
function TourChecklist({
  vendor,
  plan,
  update,
  onClose,
}: {
  vendor: Vendor;
  plan: Plan;
  update: (f: (p: Plan) => Plan) => void;
  onClose: () => void;
}) {
  const tag = `투어체크:${vendor.id}`,
    note = plan.notes.find((n) => n.tag === tag);
  const [checked, setChecked] = useState<string[]>(() => {
    try {
      return JSON.parse(note?.body || '{}').checked || [];
    } catch {
      return [];
    }
  });
  const [memo, setMemo] = useState(() => {
    try {
      return JSON.parse(note?.body || '{}').memo || '';
    } catch {
      return '';
    }
  });
  return (
    <Modal title={`${vendor.name} · 투어 체크리스트`} onClose={onClose}>
      <p className="help-text">상담에서 확인한 내용을 체크하고, 업체별로 보관해요.</p>
      <div className="tour-checklist">
        {tourQuestions.map((q) => (
          <label className="check-label" key={q}>
            <input
              type="checkbox"
              checked={checked.includes(q)}
              onChange={() =>
                setChecked((c) => (c.includes(q) ? c.filter((x) => x !== q) : [...c, q]))
              }
            />
            {q}
          </label>
        ))}
      </div>
      <Field label="상담 메모">
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={4}
          maxLength={16000}
        />
      </Field>
      <div className="form-footer">
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button
          onClick={() => {
            const n: Note = {
              id: note?.id || uid(),
              title: `${vendor.name} 투어 체크`,
              body: JSON.stringify({ checked, memo }, null, 2),
              tag,
              date: today(),
              pinned: false,
            };
            update((p) => ({
              ...p,
              notes: note ? p.notes.map((x) => (x.id === note.id ? n : x)) : [...p.notes, n],
            }));
            onClose();
          }}
        >
          체크리스트 저장
        </Button>
      </div>
    </Modal>
  );
}

function Moments({
  plan,
  update,
  notify,
}: {
  plan: Plan;
  update: (f: (p: Plan) => Plan) => void;
  notify: (s: string) => void;
}) {
  const [preview, setPreview] = useState<'family' | 'invitation' | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OUR PRECIOUS MOMENTS</div>
          <h1>함께 나눌 소중한 순간</h1>
          <p>상견례와 청첩장에 담을 이야기를 미리 준비해요.</p>
        </div>
        <span className="badge purple">내용 준비 · 미리보기</span>
      </div>
      <div className="split-panels">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>
                <Presentation size={20} /> 상견례 준비
              </h2>
              <p>가족들과 함께 볼 내용을 한 장에 담아보세요.</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update((p) => ({
                ...p,
                profile: {
                  ...p.profile,
                  familyDate: String(f.get('familyDate') || ''),
                  familyPlace: String(f.get('familyPlace') || ''),
                  familyMemo: String(f.get('familyMemo') || ''),
                },
              }));
              notify('상견례 내용을 저장했어요.');
            }}
          >
            <div className="form-grid">
              <Field label="상견례 날짜">
                <input type="date" name="familyDate" defaultValue={plan.profile.familyDate} />
              </Field>
              <Field label="장소">
                <input name="familyPlace" defaultValue={plan.profile.familyPlace} maxLength={200} />
              </Field>
              <Field label="함께 나눌 이야기" full>
                <textarea
                  name="familyMemo"
                  rows={7}
                  defaultValue={plan.profile.familyMemo}
                  maxLength={15000}
                  placeholder="두 사람의 소개, 결혼식 계획, 가족에게 드리는 말씀…"
                />
              </Field>
            </div>
            <div className="form-footer">
              <Button variant="secondary" onClick={() => setPreview('family')}>
                미리보기
              </Button>
              <Button type="submit">내용 저장</Button>
            </div>
          </form>
        </section>
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>
                <Mail size={20} /> 모바일 청첩장 문구
              </h2>
              <p>아직 공개되지 않는 우리만의 초안이에요.</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update((p) => ({
                ...p,
                profile: { ...p.profile, invitation: String(f.get('invitation') || '') },
              }));
              notify('청첩장 문구를 저장했어요.');
            }}
          >
            <Field label="초대 문구">
              <textarea
                name="invitation"
                rows={11}
                defaultValue={plan.profile.invitation}
                maxLength={15000}
              />
            </Field>
            <p className="help-text">
              사진·지도·공개 링크와 RSVP는 이후 모바일 청첩장 제작 때 확장할 수 있습니다.
            </p>
            <div className="form-footer">
              <Button variant="secondary" onClick={() => setPreview('invitation')}>
                미리보기
              </Button>
              <Button type="submit">문구 저장</Button>
            </div>
          </form>
        </section>
      </div>
      {preview && (
        <Modal
          title={preview === 'family' ? '상견례 화면 미리보기' : '청첩장 문구 미리보기'}
          onClose={() => setPreview(null)}
        >
          <div className="invitation-preview">
            <Flower2 size={37} />
            <span>
              {preview === 'family' ? 'OUR FAMILIES, ONE BEGINNING' : 'WE ARE GETTING MARRIED'}
            </span>
            <h2>
              {plan.profile.groom || '신랑'} <small>&</small> {plan.profile.bride || '신부'}
            </h2>
            <div className="invitation-rule" />
            <p>
              {preview === 'family'
                ? plan.profile.familyMemo || '가족들과 나눌 이야기를 적어주세요.'
                : plan.profile.invitation}
            </p>
            <strong>
              {dateLabel(
                preview === 'family' ? plan.profile.familyDate : plan.profile.weddingDate,
                true,
              )}
            </strong>
            <small>{preview === 'family' ? plan.profile.familyPlace : plan.profile.venue}</small>
          </div>
          <p className="help-text">
            마지막으로 저장한 내용을 보여줍니다. 가족 화면에는 예산과 개인 메모가 표시되지 않습니다.
          </p>
        </Modal>
      )}
    </>
  );
}
