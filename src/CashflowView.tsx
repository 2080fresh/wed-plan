import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDownUp, Check, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Button, Empty, Field, Modal } from './ui';
import { dateLabel, money, today, uid, type Plan } from './model';
import {
  CASHFLOW_TYPES,
  cashflowMonths,
  completedBalance,
  isInflow,
  readCashflow,
  validateCashflow,
  withCashflow,
  type CashflowData,
  type CashflowEntry,
  type CashflowType,
} from './cashflow';

type Props = {
  plan: Plan;
  update: (fn: (plan: Plan) => Plan) => void;
  notify: (message: string) => void;
};
export function Cashflow({ plan, update, notify }: Props) {
  const { data, error } = useMemo(() => readCashflow(plan), [plan]);
  const [editing, setEditing] = useState<CashflowEntry | null>(null);
  const [removing, setRemoving] = useState<CashflowEntry | null>(null);
  const [filter, setFilter] = useState('all');
  const through = plan.profile.weddingDate.slice(0, 7) || today().slice(0, 7);
  const months = cashflowMonths(data, through);
  const last = months.at(-1)!;
  const minCash = Math.min(data.openingBalance, ...months.map((m) => m.projectedClosing));
  const entries = [...data.entries]
    .filter((e) => filter === 'all' || e.status === filter)
    .sort((a, b) => a.date.localeCompare(b.date));
  function save(next: CashflowData, message = '자금 계획을 저장했어요.') {
    try {
      const valid = validateCashflow(next);
      update((p) => withCashflow(p, valid));
      notify(message);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : '자금 계획을 저장하지 못했습니다.');
      return false;
    }
  }
  function addEntry() {
    setEditing({
      id: uid(),
      date: today().slice(0, 7) < data.openingMonth ? `${data.openingMonth}-01` : today(),
      title: '',
      type: 'expense',
      amount: 0,
      status: 'planned',
      memo: '',
    });
  }
  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const f = new FormData(event.currentTarget);
    const entry: CashflowEntry = {
      id: editing.id,
      date: String(f.get('date')),
      title: String(f.get('title')).trim(),
      type: String(f.get('type')) as CashflowType,
      amount: Number(f.get('amount')),
      status: String(f.get('status')) as CashflowEntry['status'],
      memo: String(f.get('memo')).trim(),
    };
    if (
      save({
        ...data,
        entries: data.entries.some((e) => e.id === entry.id)
          ? data.entries.map((e) => (e.id === entry.id ? entry : e))
          : [...data.entries, entry],
      })
    )
      setEditing(null);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OUR WEDDING JOURNEY</div>
          <h1>필요한 순간에, 충분한 자금</h1>
          <p>신혼집 계약부터 결혼식 정산까지, 월별로 들어오고 나갈 돈을 계획해요.</p>
        </div>
        <Button disabled={!!error || data.entries.length >= 100} onClick={addEntry}>
          <Plus size={17} />
          자금 항목 추가
        </Button>
      </div>
      {error ? (
        <section className="panel">
          <div className="alert error" role="alert">
            {error}
          </div>
          <p className="help-text">
            설정에서 전체 백업을 내려받은 후 정상 백업을 복원해 주세요. 읽을 수 없는 원본을 덮어쓰지
            않도록 편집을 잠갔습니다.
          </p>
        </section>
      ) : (
        <>
          <div className="simple-stats">
            <div className="panel">
              <span>시작 잔액</span>
              <strong>
                {money(data.openingBalance)}
                <small>원</small>
              </strong>
            </div>
            <div className="panel">
              <span>오늘까지 완료 기준 잔액</span>
              <strong>
                {money(completedBalance(data))}
                <small>원</small>
              </strong>
            </div>
            <div className="panel">
              <span>{last.month} 예상 잔액</span>
              <strong>
                {money(last.projectedClosing)}
                <small>원</small>
              </strong>
            </div>
            <div className="panel">
              <span>기간 중 최저 예상 잔액</span>
              <strong className={minCash < 0 ? 'overdue' : ''}>
                {money(minCash)}
                <small>원</small>
              </strong>
            </div>
          </div>
          <section className="panel settings-panel">
            <div className="section-head">
              <div>
                <h2>
                  <Wallet size={19} /> 자금 계획의 시작점
                </h2>
                <p>
                  시작 월 직전의 보유 현금을 입력해 주세요. 이미 보유한 저축은 시작 잔액에 한 번만
                  포함해요.
                </p>
              </div>
            </div>
            <form
              key={`${data.openingMonth}-${data.openingBalance}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save({
                  ...data,
                  openingMonth: String(f.get('month')),
                  openingBalance: Number(f.get('balance')),
                });
              }}
            >
              <div className="form-grid">
                <Field label="시작 월">
                  <input
                    type="month"
                    name="month"
                    min="2000-01"
                    max="2099-12"
                    defaultValue={data.openingMonth}
                    required
                  />
                </Field>
                <Field label="시작 잔액 (원)">
                  <input
                    type="number"
                    name="balance"
                    min="-10000000000000"
                    max="10000000000000"
                    step="1"
                    defaultValue={data.openingBalance}
                    required
                  />
                </Field>
              </div>
              <div className="form-footer">
                <Button type="submit" variant="secondary">
                  <Check size={16} />
                  시작 잔액 저장
                </Button>
              </div>
            </form>
            <p className="help-text">
              예산 플래너는 계약 비용을, 이 화면은 실제 현금 이동을 관리해요. 예산 항목을 자동
              합산하지 않으므로 입출금을 한 번씩 기록해 주세요. 대출 실행은 수입과 구분해
              표시합니다.
            </p>
          </section>
          {minCash < 0 && (
            <div className="alert error" role="status">
              예상 잔액이 부족한 달이 있어요. 입금 시기와 지출 예정일을 확인해 주세요.
            </div>
          )}
          <section className="panel table-panel">
            <div className="section-head">
              <div>
                <h2>
                  <ArrowDownUp size={19} /> 월별 자금 흐름
                </h2>
                <p>
                  예상 잔액에는 예정·완료 항목이 모두 포함되고, 완료 기준에는 완료한 항목만
                  포함됩니다.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>전월 예상 잔액</th>
                    <th>수입</th>
                    <th>대출 실행</th>
                    <th>지출</th>
                    <th>원금·이자 상환</th>
                    <th>예상 잔액</th>
                    <th>완료 기준 잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>{money(m.projectedOpening)}</td>
                      <td>{money(m.income)}</td>
                      <td>{money(m.loans)}</td>
                      <td>{money(m.expense)}</td>
                      <td>{money(m.repayments)}</td>
                      <td className={m.projectedClosing < 0 ? 'overdue' : 'text-purple'}>
                        <strong>{money(m.projectedClosing)}</strong>
                      </td>
                      <td>{money(m.completedClosing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="help-text">
              월말 예상 잔액 = 전월 예상 잔액 + 수입 + 대출 실행 − 지출 − 원금·이자 상환 (단위: 원)
            </p>
          </section>
          <div className="toolbar">
            <div className="filter-chips">
              {[
                ['all', '전체'],
                ['planned', '예정'],
                ['completed', '완료'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="muted">{data.entries.length} / 100개 항목</span>
          </div>
          <section className="panel table-panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>자금 항목</th>
                    <th>구분</th>
                    <th>금액</th>
                    <th>상태</th>
                    <th>메모</th>
                    <th>
                      <span className="sr-only">편집</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{dateLabel(e.date)}</td>
                      <td>
                        <button className="cell-title" onClick={() => setEditing(e)}>
                          {e.title}
                        </button>
                      </td>
                      <td>{CASHFLOW_TYPES[e.type]}</td>
                      <td>
                        {isInflow(e) ? '+' : '−'}
                        {money(e.amount)}
                      </td>
                      <td>
                        <button
                          className={`badge ${e.status === 'completed' ? 'green' : 'purple'}`}
                          aria-label={`${e.title} ${e.status === 'completed' ? '예정으로 변경' : '완료로 변경'}`}
                          onClick={() =>
                            save({
                              ...data,
                              entries: data.entries.map((x) =>
                                x.id === e.id
                                  ? {
                                      ...x,
                                      status: x.status === 'completed' ? 'planned' : 'completed',
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          {e.status === 'completed' ? '완료' : '예정'}
                        </button>
                      </td>
                      <td className="truncate">{e.memo || '—'}</td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`${e.title} 수정`}
                          onClick={() => setEditing(e)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`${e.title} 삭제`}
                          onClick={() => setRemoving(e)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!entries.length && (
              <Empty
                title={
                  data.entries.length
                    ? '해당 상태의 항목이 없어요'
                    : '매달 필요한 돈을 계획해 보세요'
                }
                description="저축 입금, 가족 지원, 대출 실행, 신혼집 잔금과 결혼식 비용을 날짜별로 기록해요."
                action="자금 항목 추가"
                onAction={addEntry}
              />
            )}
          </section>
        </>
      )}
      {editing && (
        <Modal
          title={
            data.entries.some((e) => e.id === editing.id) ? '자금 항목 수정' : '자금 항목 추가'
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={submitEntry}>
            <div className="form-grid">
              <Field label="항목 이름" full>
                <input
                  name="title"
                  defaultValue={editing.title}
                  placeholder="예: 신혼집 잔금, 월 저축액"
                  maxLength={100}
                  required
                  autoFocus
                />
              </Field>
              <Field label="날짜">
                <input
                  name="date"
                  type="date"
                  min={`${data.openingMonth}-01`}
                  defaultValue={editing.date}
                  required
                />
              </Field>
              <Field label="구분">
                <select name="type" defaultValue={editing.type}>
                  {Object.entries(CASHFLOW_TYPES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="금액 (원)">
                <input
                  name="amount"
                  type="number"
                  min="1"
                  max="10000000000000"
                  step="1"
                  defaultValue={editing.amount || ''}
                  required
                />
              </Field>
              <Field label="처리 상태">
                <select name="status" defaultValue={editing.status}>
                  <option value="planned">예정</option>
                  <option value="completed">완료</option>
                </select>
              </Field>
              <Field label="메모" full>
                <textarea
                  name="memo"
                  maxLength={300}
                  rows={3}
                  defaultValue={editing.memo}
                  placeholder="입금자, 자금 출처, 이체할 계좌 구분 등"
                />
              </Field>
            </div>
            <div className="form-footer">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                취소
              </Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="자금 항목을 삭제할까요?" onClose={() => setRemoving(null)}>
          <p>
            {removing.title} · {money(removing.amount)}원
          </p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  save(
                    { ...data, entries: data.entries.filter((e) => e.id !== removing.id) },
                    '자금 항목을 삭제했어요.',
                  )
                )
                  setRemoving(null);
              }}
            >
              삭제
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export default Cashflow;
