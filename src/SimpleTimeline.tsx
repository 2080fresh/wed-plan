import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import {
  addDays,
  dayDiff,
  taskMonth,
  today,
  uid,
  validDate,
  validMonth,
  type Owner,
  type Plan,
  type Task,
} from './model';
import './simple-timeline.css';

type Props = { plan: Plan; update: (fn: (p: Plan) => Plan) => void; disabled?: boolean };
type TextField = 'title' | 'memo';
type Mode = 'month' | 'date' | 'relative';
type TextDraft = { value: string; initial: string; group: string; task: Task };
type ScheduleDraft = { mode: Mode; value: string; group: string; task: Task };
const groupOf = (task: Task, weddingDate: string) => taskMonth(task, weddingDate) || 'undated';
const groupLabel = (month: string) =>
  month === 'undated'
    ? '결혼일 기준 · 날짜 미정'
    : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
const scheduleOf = (task: Task): { mode: Mode; value: string } =>
  task.month
    ? { mode: 'month', value: task.month }
    : task.date
      ? { mode: 'date', value: task.date }
      : { mode: 'relative', value: String(task.offset) };
const relativeLabel = (offset: number) =>
  offset === -1
    ? '결혼식 전날'
    : offset === 0
      ? '결혼식 당일'
      : offset < 0
        ? `결혼식 ${Math.abs(offset)}일 전`
        : `결혼식 ${offset}일 후`;

export function SimpleTimeline({ plan, update, disabled = false }: Props) {
  const root = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [textDrafts, setTextDrafts] = useState<Record<string, TextDraft>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [removed, setRemoved] = useState<{ task: Task; index: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const weddingDate = plan.profile.weddingDate;
  const keyOf = (id: string, field: TextField) => `${id}:${field}`;

  useEffect(() => {
    if (!focusId) return;
    const input = root.current?.querySelector<HTMLInputElement>(
      `input[data-task-title="${CSS.escape(focusId)}"]`,
    );
    if (input) {
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setFocusId(null);
    }
  }, [focusId, plan.tasks]);

  function patchTask(id: string, fields: Partial<Task>) {
    update((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task, ...fields };
        if (next.month === undefined) delete next.month;
        return next;
      }),
    }));
  }
  function dropTextDraft(key: string) {
    setTextDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  function dropScheduleDraft(id: string) {
    setScheduleDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function changeText(task: Task, field: TextField, value: string) {
    const key = keyOf(task.id, field);
    setTextDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { initial: task[field], group: groupOf(task, weddingDate), task }),
        value,
      },
    }));
  }
  function commitText(id: string, field: TextField) {
    if (disabled) return;
    const key = keyOf(id, field),
      draft = textDrafts[key];
    if (!draft) return;
    const value = field === 'title' ? draft.value.trim() : draft.value;
    if (field === 'title' && !value) {
      setMessage('일정 제목을 입력해 주세요. 입력 중인 내용은 그대로 보관됩니다.');
      return;
    }
    if (!plan.tasks.some((task) => task.id === id)) {
      setMessage(
        '다른 기기에서 삭제된 일정의 입력 내용을 보관했습니다. 아래에서 복구할 수 있어요.',
      );
      return;
    }
    patchTask(id, { [field]: value });
    dropTextDraft(key);
    setMessage('변경 내용을 반영했어요.');
  }
  function changeSchedule(task: Task, change: Partial<{ mode: Mode; value: string }>) {
    setScheduleDrafts((prev) => ({
      ...prev,
      [task.id]: {
        ...(prev[task.id] || { ...scheduleOf(task), group: groupOf(task, weddingDate), task }),
        ...change,
      },
    }));
  }
  function changeMode(task: Task, mode: Mode) {
    const current = scheduleDrafts[task.id] || scheduleOf(task);
    if (current.mode === mode) return;
    // A month never supplies an exact day. Date mode stays blank until chosen.
    const value =
      mode === 'month'
        ? current.mode === 'date' && validDate(current.value)
          ? current.value.slice(0, 7)
          : task.month || task.date.slice(0, 7)
        : mode === 'date'
          ? task.date
          : String(task.offset);
    changeSchedule(task, { mode, value });
  }
  function commitSchedule(id: string) {
    if (disabled) return;
    const draft = scheduleDrafts[id];
    if (!draft) return;
    if (!plan.tasks.some((task) => task.id === id)) return;
    if (draft.mode === 'month') {
      if (!validMonth(draft.value)) {
        setMessage('준비할 월을 선택해 주세요.');
        return;
      }
      patchTask(id, { month: draft.value, date: '', offset: 0 });
    } else if (draft.mode === 'date') {
      if (!validDate(draft.value)) {
        setMessage('정확한 날짜를 선택해 주세요. 월만 알고 있다면 ‘월’을 선택하면 됩니다.');
        return;
      }
      patchTask(id, {
        date: draft.value,
        month: undefined,
        ...(weddingDate ? { offset: dayDiff(draft.value, weddingDate) ?? draft.task.offset } : {}),
      });
    } else {
      const offset = Number(draft.value);
      if (draft.value.trim() === '' || !Number.isInteger(offset) || Math.abs(offset) > 36500) {
        setMessage('결혼식 기준 일수를 정수로 입력해 주세요. 예: 전날 -1, 당일 0');
        return;
      }
      patchTask(id, { date: '', month: undefined, offset });
    }
    dropScheduleDraft(id);
    setMessage('일정을 변경했어요.');
  }
  function textKey(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    id: string,
    field: TextField,
  ) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      dropTextDraft(keyOf(id, field));
    }
  }
  function addTask() {
    const task: Task = {
      id: uid(),
      title: '새 일정',
      category: '기타',
      date: '',
      month: today().slice(0, 7),
      offset: 0,
      done: false,
      owner: '함께',
      memo: '',
    };
    update((prev) => ({ ...prev, tasks: [...prev.tasks, task] }));
    setQuery('');
    setOnlyPending(false);
    setFocusId(task.id);
  }
  function removeTask(task: Task) {
    const latest = plan.tasks.find((t) => t.id === task.id);
    if (!latest) return;
    setRemoved({ task: latest, index: plan.tasks.findIndex((t) => t.id === task.id) });
    update((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) }));
    // Do not discard any active draft. It also remains recoverable after remote deletion.
    setMessage('일정을 삭제했어요. 되돌리기로 복구할 수 있습니다.');
  }
  function undoRemove() {
    if (!removed) return;
    update((prev) => {
      if (prev.tasks.some((task) => task.id === removed.task.id)) return prev;
      const tasks = [...prev.tasks];
      tasks.splice(Math.min(removed.index, tasks.length), 0, removed.task);
      return { ...prev, tasks };
    });
    setFocusId(removed.task.id);
    setRemoved(null);
    setQuery('');
    setOnlyPending(false);
  }
  const activeDraftIds = new Set([
    ...Object.values(textDrafts).map((draft) => draft.task.id),
    ...Object.keys(scheduleDrafts),
  ]);
  const orphanIds = [...activeDraftIds].filter(
    (id) => !plan.tasks.some((t) => t.id === id) && removed?.task.id !== id,
  );
  function recoverDraft(id: string) {
    const title = textDrafts[keyOf(id, 'title')],
      memo = textDrafts[keyOf(id, 'memo')],
      schedule = scheduleDrafts[id];
    const original = title?.task || memo?.task || schedule?.task;
    if (!original) return;
    const task = {
      ...original,
      title: title?.value.trim() || original.title,
      memo: memo?.value ?? original.memo,
    };
    update((prev) =>
      prev.tasks.some((t) => t.id === id) ? prev : { ...prev, tasks: [...prev.tasks, task] },
    );
    setFocusId(id);
    setQuery('');
    setOnlyPending(false);
  }
  const search = query.trim().toLocaleLowerCase();
  const matching = plan.tasks.filter((task) => {
    if (activeDraftIds.has(task.id)) return true;
    return (
      (!onlyPending || !task.done) &&
      `${task.title} ${task.memo} ${task.owner}`.toLocaleLowerCase().includes(search)
    );
  });
  const groups = new Map<string, Task[]>();
  for (const task of matching) {
    // Keep an actively edited row in place if a remote update changes its month.
    const group =
      textDrafts[keyOf(task.id, 'title')]?.group ||
      textDrafts[keyOf(task.id, 'memo')]?.group ||
      scheduleDrafts[task.id]?.group ||
      groupOf(task, weddingDate);
    groups.set(group, [...(groups.get(group) || []), task]);
  }
  const grouped = [...groups.entries()].sort(([a], [b]) =>
    a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b),
  );
  const completed = plan.tasks.filter((task) => task.done).length;

  return (
    <section className="simple-timeline" ref={root} aria-label="결혼 준비 타임라인">
      <div className="st-heading">
        <div>
          <h2>준비 타임라인</h2>
          <p>칸을 눌러 바로 수정하세요. Enter 또는 다른 칸으로 이동하면 저장돼요.</p>
        </div>
        <button type="button" className="st-add" disabled={disabled} onClick={addTask}>
          <Plus size={17} />
          일정 추가
        </button>
      </div>
      <div className="st-toolbar">
        <label className="st-search">
          <Search size={17} />
          <input
            aria-label="일정 검색"
            placeholder="일정 또는 메모 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="st-pending">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          미완료만
        </label>
        <span className="st-count">
          {completed} / {plan.tasks.length} 완료
        </span>
      </div>
      {removed && (
        <div className="st-undo">
          <span>‘{removed.task.title}’ 삭제됨</span>
          <button type="button" disabled={disabled} onClick={undoRemove}>
            <RotateCcw size={14} />
            되돌리기
          </button>
          <button
            type="button"
            className="st-dismiss"
            aria-label="삭제 알림 닫기"
            onClick={() => setRemoved(null)}
          >
            ×
          </button>
        </div>
      )}
      {orphanIds.map((id) => (
        <div className="st-undo" key={id}>
          <span>다른 기기에서 삭제된 일정의 입력 내용을 보관하고 있어요.</span>
          <button type="button" disabled={disabled} onClick={() => recoverDraft(id)}>
            일정 복구
          </button>
        </div>
      ))}
      <div className="st-feedback" role="status" aria-live="polite">
        {disabled ? '현재 내용을 확인하는 중입니다. 잠시 후 수정할 수 있어요.' : message}
      </div>
      <div className="st-table-wrap">
        <table className="st-table">
          <colgroup>
            <col className="st-col-check" />
            <col className="st-col-title" />
            <col className="st-col-owner" />
            <col className="st-col-date" />
            <col className="st-col-memo" />
            <col className="st-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <span className="st-sr-only">완료</span>
              </th>
              <th>준비할 일</th>
              <th>담당</th>
              <th>월 / 날짜</th>
              <th>메모</th>
              <th>
                <span className="st-sr-only">삭제</span>
              </th>
            </tr>
          </thead>
          {grouped.map(([month, tasks]) => (
            <tbody key={month}>
              <tr className="st-month-row">
                <th colSpan={6}>
                  <span>{groupLabel(month)}</span>
                  <small>{tasks.length}개</small>
                </th>
              </tr>
              {tasks.map((task) => {
                const titleDraft = textDrafts[keyOf(task.id, 'title')],
                  memoDraft = textDrafts[keyOf(task.id, 'memo')];
                const schedule = scheduleDrafts[task.id] || scheduleOf(task);
                const relativeOffset = Number(schedule.value);
                const validRelative =
                  schedule.value.trim() !== '' &&
                  Number.isInteger(relativeOffset) &&
                  Math.abs(relativeOffset) <= 36500;
                const relativeDate = validRelative ? addDays(weddingDate, relativeOffset) : '';
                const changedRemotely =
                  (titleDraft && titleDraft.initial !== task.title) ||
                  (memoDraft && memoDraft.initial !== task.memo);
                return (
                  <tr key={task.id} className={`st-task-row ${task.done ? 'st-done' : ''}`}>
                    <td className="st-check-cell">
                      <button
                        type="button"
                        className="st-check"
                        role="checkbox"
                        aria-checked={task.done}
                        aria-label={`${task.title} 완료`}
                        disabled={disabled}
                        onClick={() =>
                          update((prev) => ({
                            ...prev,
                            tasks: prev.tasks.map((t) =>
                              t.id === task.id ? { ...t, done: !t.done } : t,
                            ),
                          }))
                        }
                      >
                        {task.done && <Check size={14} />}
                      </button>
                    </td>
                    <td className="st-title-cell">
                      <input
                        className="st-inline st-title"
                        data-task-title={task.id}
                        aria-label={`${task.title} 제목`}
                        disabled={disabled}
                        value={titleDraft?.value ?? task.title}
                        maxLength={20000}
                        onChange={(e) => changeText(task, 'title', e.target.value)}
                        onBlur={() => commitText(task.id, 'title')}
                        onKeyDown={(e) => textKey(e, task.id, 'title')}
                      />
                      {changedRemotely && (
                        <small className="st-conflict">
                          다른 기기에서 수정됨 · 입력 중인 내용 유지
                        </small>
                      )}
                    </td>
                    <td className="st-owner-cell">
                      <select
                        className="st-inline st-owner"
                        aria-label={`${task.title} 담당`}
                        disabled={disabled}
                        value={task.owner}
                        onChange={(e) => patchTask(task.id, { owner: e.target.value as Owner })}
                      >
                        {(['함께', '신랑', '신부'] as const).map((owner) => (
                          <option key={owner} value={owner}>
                            {owner}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="st-date-cell">
                      <div
                        className="st-schedule"
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                            commitSchedule(task.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLElement).blur();
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            dropScheduleDraft(task.id);
                          }
                        }}
                      >
                        <select
                          className="st-inline st-date-mode"
                          aria-label={`${task.title} 일정 단위`}
                          disabled={disabled}
                          value={schedule.mode}
                          onChange={(e) => changeMode(task, e.target.value as Mode)}
                        >
                          <option value="month">월</option>
                          <option value="date">날짜</option>
                          <option value="relative">예식 기준</option>
                        </select>
                        {schedule.mode === 'relative' ? (
                          <input
                            type="number"
                            className="st-inline st-relative"
                            aria-label={`${task.title} 결혼식 기준 일수`}
                            disabled={disabled}
                            min={-36500}
                            max={36500}
                            step={1}
                            value={schedule.value}
                            onChange={(e) => changeSchedule(task, { value: e.target.value })}
                          />
                        ) : (
                          <input
                            type={schedule.mode}
                            className="st-inline st-date"
                            aria-label={`${task.title} ${schedule.mode === 'month' ? '준비 월' : '날짜'}`}
                            disabled={disabled}
                            value={schedule.value}
                            onChange={(e) => changeSchedule(task, { value: e.target.value })}
                          />
                        )}
                      </div>
                      {schedule.mode === 'relative' && (
                        <small className="st-relative-hint">
                          {validRelative ? relativeLabel(relativeOffset) : '전날 -1 · 당일 0'}
                          {relativeDate && ` · ${relativeDate.slice(5).replace('-', '/')}`}
                        </small>
                      )}
                    </td>
                    <td className="st-memo-cell">
                      <textarea
                        rows={1}
                        className="st-inline st-memo"
                        aria-label={`${task.title} 메모`}
                        disabled={disabled}
                        placeholder="메모 추가"
                        value={memoDraft?.value ?? task.memo}
                        maxLength={20000}
                        onChange={(e) => changeText(task, 'memo', e.target.value)}
                        onBlur={() => commitText(task.id, 'memo')}
                        onKeyDown={(e) => textKey(e, task.id, 'memo')}
                      />
                    </td>
                    <td className="st-action-cell">
                      <button
                        type="button"
                        className="st-delete"
                        aria-label={`${task.title} 삭제`}
                        title="일정 삭제"
                        disabled={disabled}
                        onClick={() => removeTask(task)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {!matching.length && (
          <div className="st-empty">
            {plan.tasks.length ? '조건에 맞는 일정이 없어요.' : '첫 준비 일정을 추가해 주세요.'}
          </div>
        )}
      </div>
      <p className="st-footnote">
        월만 정한 일정은 임의의 날짜로 바꾸지 않습니다. ‘예식 기준’ 일정은 결혼식 날짜에 맞춰
        움직여요.
      </p>
    </section>
  );
}

export default SimpleTimeline;
