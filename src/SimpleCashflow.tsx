import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarPlus, MoreHorizontal, Plus, Undo2, X } from 'lucide-react';
import {
  CASHFLOW_TYPES,
  cashflowDateLabel,
  cashflowMonths,
  monthAt,
  monthIndex,
  readCashflow,
  type CashflowEntry,
  type CashflowType,
} from './cashflow';
import { uid, type Plan } from './model';
import {
  SIMPLE_CASHFLOW_ORDER,
  cashflowCell,
  cashflowRowKey,
  parseCashflowMoney,
  renameCashflowRow,
  restoreCashflowEntry,
  simpleCashflowRows,
  updateCashflowCellAmount,
  updateCashflowEntryAmount,
  updateCashflowOpeningBalance,
  type SimpleCashflowRow,
} from './cashflowGrid';
import './simple-cashflow.css';

type Props = {
  plan: Plan;
  update: (fn: (plan: Plan) => Plan) => void;
  disabled?: boolean;
};
const format = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const monthLabel = (value: string) => `${value.slice(0, 4)}.${value.slice(5)}`;
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : '금액을 저장하지 못했습니다. 다시 확인해 주세요.';

function RowNameInput({
  row,
  entries,
  disabled,
  onCommit,
}: {
  row: SimpleCashflowRow;
  entries: CashflowEntry[];
  disabled: boolean;
  onCommit: (name: string, expectedIds: string[]) => boolean;
}) {
  const [draft, setDraft] = useState(row.title);
  const focused = useRef(false);
  const skipBlur = useRef(false);
  const expectedIds = useRef<string[]>([]);
  useEffect(() => {
    if (!focused.current) setDraft(row.title);
  });
  return (
    <input
      className="scf-row-name"
      value={draft}
      aria-label={`${row.title} 항목 이름`}
      title={row.title}
      disabled={disabled}
      maxLength={100}
      onFocus={() => {
        focused.current = true;
        expectedIds.current = entries.map((entry) => entry.id);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false;
        if (!skipBlur.current && !disabled && draft.trim() !== row.title)
          onCommit(draft, expectedIds.current);
        skipBlur.current = false;
        setDraft(row.title);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          skipBlur.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function AmountInput({
  value,
  label,
  disabled,
  signed,
  snapshot,
  onCommit,
  onError,
}: {
  value: number | null;
  label: string;
  disabled?: boolean;
  signed?: boolean;
  snapshot?: CashflowEntry[];
  onCommit: (amount: number, before: number | null, entries: CashflowEntry[]) => boolean;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : format(value));
  const focused = useRef(false);
  const before = useRef(value);
  const beforeEntries = useRef<CashflowEntry[]>([]);
  const skipBlur = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value === null ? '' : format(value));
  });
  function finish() {
    focused.current = false;
    if (skipBlur.current || disabled) {
      skipBlur.current = false;
      setDraft(value === null ? '' : format(value));
      return;
    }
    try {
      const amount = parseCashflowMoney(draft, signed);
      if (
        amount !== (before.current ?? 0) &&
        !onCommit(amount, before.current, beforeEntries.current)
      ) {
        setDraft(value === null ? '' : format(value));
        return;
      }
      setDraft(amount || signed ? format(amount) : '');
    } catch (cause) {
      onError(errorText(cause));
      setDraft(value === null ? '' : format(value));
    }
  }
  return (
    <input
      className="scf-amount"
      type="text"
      inputMode={signed ? 'text' : 'numeric'}
      aria-label={label}
      value={draft}
      disabled={disabled}
      autoComplete="off"
      onFocus={(event) => {
        focused.current = true;
        before.current = value;
        beforeEntries.current = (snapshot ?? []).map((entry) => ({ ...entry }));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          skipBlur.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function EntryDetails({
  title,
  entries,
  disabled,
  onChange,
  onError,
  onClose,
  undo,
  message,
}: {
  title: string;
  entries: CashflowEntry[];
  disabled: boolean;
  onChange: (entry: CashflowEntry, amount: number, expectedAmount: number) => boolean;
  onError: (message: string) => void;
  onClose: () => void;
  undo: { label: string; action: () => void } | null;
  message: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="scf-dialog"
      aria-labelledby="scf-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="scf-dialog-heading">
        <h3 id="scf-dialog-title">{title}</h3>
        <button type="button" onClick={onClose} aria-label="상세 보기 닫기">
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <p>기록별 금액을 수정하세요. 날짜·상태·메모는 유지됩니다.</p>
      {message && (
        <p className="scf-message" role="status">
          {message}
        </p>
      )}
      {entries.map((entry) => (
        <div className="scf-record" key={entry.id}>
          <div className="scf-record-heading">
            <span>
              {cashflowDateLabel(entry)} · {entry.status === 'completed' ? '완료' : '예정'}
            </span>
            <div className="scf-record-amount">
              <AmountInput
                value={entry.amount}
                label={`${entry.title} ${cashflowDateLabel(entry)} 금액`}
                disabled={disabled}
                snapshot={[entry]}
                onCommit={(amount, before, snapshots) =>
                  onChange(snapshots[0] ?? entry, amount, before ?? entry.amount)
                }
                onError={onError}
              />
              <span>원</span>
            </div>
          </div>
          {entry.memo && <p className="scf-record-memo">{entry.memo}</p>}
        </div>
      ))}
      {!entries.length && <p>이 셀에 남아 있는 기록이 없습니다.</p>}
      <div className="scf-dialog-footer">
        {undo && (
          <button type="button" disabled={disabled} onClick={undo.action}>
            <Undo2 size={15} aria-hidden="true" />
            {undo.label} 되돌리기
          </button>
        )}
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </dialog>
  );
}

export function SimpleCashflow({ plan, update, disabled = false }: Props) {
  const { data, error: sourceError } = useMemo(() => readCashflow(plan), [plan]);
  const [message, setMessage] = useState('');
  const [extraThrough, setExtraThrough] = useState('');
  const [draftRows, setDraftRows] = useState<SimpleCashflowRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<CashflowType>('expense');
  const [details, setDetails] = useState<{ row: SimpleCashflowRow; month: string } | null>(null);
  const [removed, setRemoved] = useState<CashflowEntry | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const locked = disabled || !!sourceError;
  const through = [data.openingMonth, plan.profile.weddingDate.slice(0, 7), extraThrough]
    .sort()
    .at(-1)!;
  const months = cashflowMonths(data, through);
  const realRows = simpleCashflowRows(data);
  const rows = [
    ...realRows,
    ...draftRows.filter((draft) => !realRows.some((row) => row.key === draft.key)),
  ];

  function commit(action: (latest: Plan) => Plan): boolean {
    if (locked) return false;
    try {
      action(plan); // Immediate validation gives feedback without throwing inside React's updater.
      update((latest) => {
        try {
          return action(latest);
        } catch (cause) {
          queueMicrotask(() => {
            if (live.current) setMessage(errorText(cause));
          });
          return latest;
        }
      });
      setMessage('');
      return true;
    } catch (cause) {
      setMessage(errorText(cause));
      return false;
    }
  }

  function saveCell(
    row: SimpleCashflowRow,
    month: string,
    amount: number,
    expected: CashflowEntry[],
  ) {
    const id = uid();
    const saved = commit((latest) =>
      updateCashflowCellAmount(latest, row, month, expected, amount, id),
    );
    if (saved && !amount && expected.length === 1) setRemoved(expected[0]);
    return saved;
  }
  function saveEntry(entry: CashflowEntry, amount: number, before: number) {
    const expected = { ...entry, amount: before };
    const saved = commit((latest) => updateCashflowEntryAmount(latest, expected, amount));
    if (saved && !amount) setRemoved(expected);
    return saved;
  }
  function undoRemoval() {
    if (removed && commit((latest) => restoreCashflowEntry(latest, removed))) setRemoved(null);
  }
  function renameRow(row: SimpleCashflowRow, name: string, expectedIds: string[]) {
    if (locked) return false;
    const title = name.trim();
    if (!title || title.length > 100) {
      setMessage('항목 이름을 1~100자로 입력해 주세요.');
      return false;
    }
    const key = cashflowRowKey(title, row.type);
    if (rows.some((other) => other.key === key && other.key !== row.key)) {
      setMessage('같은 분류에 이미 있는 이름입니다. 다른 이름을 입력해 주세요.');
      return false;
    }
    if (!expectedIds.length) {
      if (data.entries.some((entry) => entry.title === row.title && entry.type === row.type)) {
        setMessage('이 항목에 기록이 추가됐습니다. 최신 값을 확인한 뒤 이름을 다시 수정해 주세요.');
        return false;
      }
      setDraftRows((current) =>
        current.map((draft) => (draft.key === row.key ? { ...draft, title, key } : draft)),
      );
      return true;
    }
    const saved = commit((latest) => renameCashflowRow(latest, row, expectedIds, title));
    if (saved) setDraftRows((current) => current.filter((draft) => draft.key !== row.key));
    return saved;
  }
  const undo = removed ? { label: `${removed.title} 삭제`, action: undoRemoval } : null;

  function addRow(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const title = newTitle.trim();
    if (!title || title.length > 100) {
      setMessage('항목 이름을 1~100자로 입력해 주세요.');
      return;
    }
    const key = cashflowRowKey(title, newType);
    if (rows.some((row) => row.key === key)) {
      setMessage('같은 분류에 이미 있는 항목입니다. 기존 행에 금액을 입력해 주세요.');
      return;
    }
    setDraftRows((current) => [...current, { key, title, type: newType }]);
    setNewTitle('');
    setAdding(false);
    setMessage('빈 행을 추가했습니다. 금액을 입력하면 저장됩니다.');
  }

  return (
    <section className="simple-cashflow" aria-labelledby="scf-title">
      <div className="scf-heading">
        <div>
          <h2 id="scf-title">신혼집 자금 계획</h2>
          <p>
            금액을 입력하고 Enter를 누르거나 다른 셀로 이동하세요.{' '}
            <span className="scf-unit">단위: 원</span>
          </p>
        </div>
        <div className="scf-actions">
          <button
            className="scf-primary"
            type="button"
            disabled={locked}
            onClick={() => setAdding((value) => !value)}
          >
            <Plus size={16} aria-hidden="true" />
            항목 추가
          </button>
          <button
            type="button"
            disabled={locked || months.length >= 120}
            onClick={() => setExtraThrough(monthAt(monthIndex(months.at(-1)!.month) + 1))}
          >
            <CalendarPlus size={16} aria-hidden="true" />
            다음 달 추가
          </button>
        </div>
      </div>
      <div className="scf-opening">
        <div className="scf-opening-copy">
          <span className="scf-opening-label">{monthLabel(data.openingMonth)} 시작 잔액</span>
          <small>첫 달 직전의 보유 자금</small>
        </div>
        <div className="scf-opening-amount">
          <AmountInput
            value={data.openingBalance}
            label="시작 잔액 (원)"
            signed
            disabled={locked}
            onCommit={(amount, before) =>
              commit((latest) => updateCashflowOpeningBalance(latest, before ?? 0, amount))
            }
            onError={setMessage}
          />
          <span>원</span>
        </div>
      </div>
      {sourceError && (
        <p className="scf-error" role="alert">
          {sourceError}
        </p>
      )}
      {message && (
        <p className="scf-message" role="status">
          {message}
        </p>
      )}
      {undo && (
        <div className="scf-undo" role="status">
          <span>{removed!.title} 기록을 지웠습니다.</span>
          <button type="button" disabled={locked} onClick={undo.action}>
            <Undo2 size={15} aria-hidden="true" />
            되돌리기
          </button>
        </div>
      )}
      {adding && (
        <form className="scf-add" onSubmit={addRow}>
          <select
            value={newType}
            onChange={(event) => setNewType(event.target.value as CashflowType)}
            aria-label="새 항목 분류"
            disabled={locked}
          >
            {SIMPLE_CASHFLOW_ORDER.map((type) => (
              <option key={type} value={type}>
                {CASHFLOW_TYPES[type]}
              </option>
            ))}
          </select>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            maxLength={100}
            placeholder="항목 이름"
            aria-label="새 항목 이름"
            disabled={locked}
          />
          <button className="scf-primary" type="submit" disabled={locked || !newTitle.trim()}>
            <Plus size={16} aria-hidden="true" />행 추가
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewTitle('');
            }}
          >
            취소
          </button>
        </form>
      )}
      <div
        className="scf-scroll"
        tabIndex={0}
        role="region"
        aria-label="월별 자금 표, 가로로 스크롤할 수 있습니다"
      >
        <table className="scf-table">
          <caption>
            월별 자금 계획. 빈칸 또는 0원을 입력하면 해당 기록을 삭제하며 되돌릴 수 있습니다.
          </caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              {months.map(({ month }) => (
                <th scope="col" key={month}>
                  {monthLabel(month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIMPLE_CASHFLOW_ORDER.map((type) => {
              const group = rows.filter((row) => row.type === type);
              if (!group.length) return null;
              return (
                <CashflowGroup
                  key={type}
                  type={type}
                  rows={group}
                  months={months.map((month) => month.month)}
                  entries={data.entries}
                  disabled={locked}
                  onCommit={saveCell}
                  onRename={renameRow}
                  onError={setMessage}
                  onDetails={(row, month) => {
                    setMessage('');
                    setDetails({ row, month });
                  }}
                  onDropDraft={(key) =>
                    setDraftRows((current) => current.filter((row) => row.key !== key))
                  }
                />
              );
            })}
            <tr className="scf-total">
              <th scope="row">입금 합계</th>
              {months.map((month) => (
                <td key={month.month}>{format(month.income + month.loans)}</td>
              ))}
            </tr>
            <tr className="scf-total">
              <th scope="row">출금 합계</th>
              {months.map((month) => (
                <td key={month.month}>{format(month.expense + month.repayments)}</td>
              ))}
            </tr>
            <tr className="scf-balance">
              <th scope="row">월말 예상 잔액</th>
              {months.map((month) => (
                <td className={month.projectedClosing < 0 ? 'scf-negative' : ''} key={month.month}>
                  {format(month.projectedClosing)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="scf-footnote">
        예정·완료 금액을 모두 반영한 계획입니다. 여러 기록이 있는 셀은 합계를 눌러 각각 수정하세요.
        빈칸·0원은 기록 삭제입니다.
      </p>
      {details && (
        <EntryDetails
          title={`${details.row.title} · ${monthLabel(details.month)}`}
          entries={cashflowCell(data, details.row, details.month)}
          disabled={locked}
          onChange={saveEntry}
          onError={setMessage}
          onClose={() => setDetails(null)}
          undo={undo}
          message={message}
        />
      )}
    </section>
  );
}

function CashflowGroup({
  type,
  rows,
  months,
  entries,
  disabled,
  onCommit,
  onRename,
  onError,
  onDetails,
  onDropDraft,
}: {
  type: CashflowType;
  rows: SimpleCashflowRow[];
  months: string[];
  entries: CashflowEntry[];
  disabled: boolean;
  onCommit: (
    row: SimpleCashflowRow,
    month: string,
    amount: number,
    expected: CashflowEntry[],
  ) => boolean;
  onRename: (row: SimpleCashflowRow, name: string, expectedIds: string[]) => boolean;
  onError: (message: string) => void;
  onDetails: (row: SimpleCashflowRow, month: string) => void;
  onDropDraft: (key: string) => void;
}) {
  return (
    <>
      <tr className={`scf-category scf-${type}`}>
        <th scope="row">{CASHFLOW_TYPES[type]}</th>
        {months.map((month) => (
          <td key={month} />
        ))}
      </tr>
      {rows.map((row) => {
        const rowEntries = entries.filter(
          (entry) => entry.type === type && entry.title === row.title,
        );
        return (
          <tr className="scf-data-row" key={row.key}>
            <th scope="row" className="scf-row-label">
              <div className="scf-row-title">
                <RowNameInput
                  row={row}
                  entries={rowEntries}
                  disabled={disabled}
                  onCommit={(name, expectedIds) => onRename(row, name, expectedIds)}
                />
                {!rowEntries.length && (
                  <button
                    className="scf-drop-draft"
                    type="button"
                    disabled={disabled}
                    aria-label={`${row.title} 빈 행 취소`}
                    onClick={() => onDropDraft(row.key)}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </th>
            {months.map((month) => {
              const records = rowEntries.filter((entry) => entry.date.startsWith(month));
              const total = records.reduce((sum, entry) => sum + entry.amount, 0);
              return (
                <td key={month}>
                  {records.length > 1 ? (
                    <button
                      className="scf-multiple"
                      type="button"
                      onClick={() => onDetails(row, month)}
                    >
                      <span>{format(total)}</span>
                      <small>{records.length}건</small>
                    </button>
                  ) : (
                    <div className="scf-cell">
                      <AmountInput
                        value={records.length ? total : null}
                        label={`${row.title} ${monthLabel(month)} 금액 (원)`}
                        disabled={disabled}
                        snapshot={records}
                        onCommit={(amount, _before, snapshots) =>
                          onCommit(row, month, amount, snapshots)
                        }
                        onError={onError}
                      />
                      {!!records.length && (
                        <button
                          className="scf-details"
                          type="button"
                          aria-label={`${row.title} ${monthLabel(month)} 기록 상세`}
                          onClick={() => onDetails(row, month)}
                        >
                          <MoreHorizontal size={17} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
      <tr className="scf-subtotal">
        <th scope="row">{CASHFLOW_TYPES[type]} 소계</th>
        {months.map((month) => (
          <td key={month}>
            {format(
              entries
                .filter((entry) => entry.type === type && entry.date.startsWith(month))
                .reduce((sum, entry) => sum + entry.amount, 0),
            )}
          </td>
        ))}
      </tr>
    </>
  );
}
