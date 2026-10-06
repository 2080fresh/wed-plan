import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  Cloud,
  Download,
  Heart,
  Link2,
  LoaderCircle,
  Table2,
  X,
} from 'lucide-react';
import { SimpleTimeline } from './SimpleTimeline';
import { SimpleCashflow } from './SimpleCashflow';
import { useSharedPlan } from './useSharedPlan';
import { subscribePlanChanges } from './realtime';
import { download, today } from './model';
import { Modal } from './ui';
import './simple-app.css';

type Page = 'timeline' | 'cashflow';
const currentPage = (): Page => (location.hash === '#cashflow' ? 'cashflow' : 'timeline');

export default function App() {
  const shared = useSharedPlan({ subscribeRealtime: subscribePlanChanges });
  const { plan, update, status, error, connected } = shared;
  const [page, setPage] = useState<Page>(currentPage);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [notice, setNotice] = useState('');
  const [connectError, setConnectError] = useState('');
  useEffect(() => {
    const change = () => setPage(currentPage());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Page) {
    setPage(next);
    location.hash = next;
    window.scrollTo({ top: 0 });
  }
  async function connect() {
    setConnectError('');
    try {
      if (shared.connect(linkInput)) setLinkInput('');
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : '공유 링크를 확인해 주세요.');
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shared.connectionLink);
      setNotice('공유 링크를 복사했어요. 다른 기기에서 열어 주세요.');
    } catch {
      setShareOpen(true);
    }
  }
  const labels: Record<string, string> = {
    loading: '공동 기록 여는 중',
    connecting: '공동 기록 여는 중',
    saving: '저장 중',
    pending: '저장 중',
    saved: '모든 변경 저장됨',
    synced: '모든 변경 저장됨',
    idle: connected ? '모든 변경 저장됨' : '이 기기에 저장됨',
    offline: '연결되면 자동 저장',
    error: '연결 확인 중',
    local: '이 기기에 저장됨',
  };
  const busy = ['loading', 'connecting', 'saving', 'pending'].includes(status);
  const disabled = ['loading', 'connecting'].includes(status);

  return (
    <div className="simple-app">
      <header className="simple-topbar">
        <a className="simple-brand" href="#timeline" aria-label="우리의 결혼 준비 타임라인">
          <span>
            <Heart size={20} />
          </span>
          <strong>우리의 결혼 준비</strong>
        </a>
        <div className="simple-top-actions">
          <span className={`simple-sync ${status}`} role="status" aria-live="polite">
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : connected ? (
              <Check size={14} />
            ) : (
              <Cloud size={14} />
            )}
            {labels[status] || '자동 저장'}
          </span>
          <button
            className="simple-icon"
            onClick={() => setShareOpen(true)}
            aria-label="공유와 백업"
            title="공유와 백업"
          >
            <Link2 size={19} />
          </button>
        </div>
      </header>
      <main className="simple-main">
        <div className="simple-heading">
          <div>
            <h1>하나씩, 함께 준비해요.</h1>
            <p>내용을 고치면 자동으로 저장되고 두 사람에게 함께 반영돼요.</p>
          </div>
          <label className="simple-wedding-date">
            <span>예식일</span>
            <input
              type="date"
              aria-label="예식일"
              value={plan.profile.weddingDate}
              disabled={disabled}
              onChange={(event) => {
                const weddingDate = event.target.value;
                update((p) => ({ ...p, profile: { ...p.profile, weddingDate } }));
              }}
            />
          </label>
        </div>
        {!connected && !disabled && (
          <section className="simple-connect" aria-label="공동 준비 연결">
            <div>
              <strong>같은 공유 링크로 함께 열어요</strong>
              <p>한 번 연결하면 다음부터 자동으로 이어집니다.</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <input
                type="text"
                aria-label="공유 링크"
                placeholder="공유 링크 붙여넣기"
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                required
                autoComplete="off"
              />
              <button type="submit" className="button primary">
                열기
              </button>
            </form>
            {connectError && (
              <p className="simple-error" role="alert">
                {connectError}
              </p>
            )}
          </section>
        )}
        {error && (
          <div className="simple-error" role="alert">
            {error}
          </div>
        )}
        <nav className="simple-tabs" aria-label="준비 화면">
          <button
            aria-current={page === 'timeline' ? 'page' : undefined}
            onClick={() => navigate('timeline')}
          >
            <CalendarDays size={18} /> 타임라인
          </button>
          <button
            aria-current={page === 'cashflow' ? 'page' : undefined}
            onClick={() => navigate('cashflow')}
          >
            <Table2 size={18} /> 신혼집 자금 계획
          </button>
        </nav>
        <section
          className="simple-content"
          aria-label={page === 'timeline' ? '타임라인' : '신혼집 자금 계획'}
        >
          {page === 'timeline' ? (
            <SimpleTimeline plan={plan} update={update} disabled={disabled} />
          ) : (
            <SimpleCashflow plan={plan} update={update} disabled={disabled} />
          )}
        </section>
        <footer className="simple-footer">
          칸을 수정한 뒤 Enter를 누르거나 다른 칸으로 이동하면 저장돼요.
        </footer>
      </main>
      {shareOpen && (
        <Modal title="다른 기기에서도 함께" onClose={() => setShareOpen(false)}>
          <div className="simple-share">
            {connected ? (
              <>
                <p>
                  이 링크를 두 분의 휴대폰이나 PC에서 열어 주세요. 로그인 없이 같은 기록을 수정할 수
                  있어요.
                </p>
                <input
                  value={shared.connectionLink}
                  readOnly
                  aria-label="다른 기기에서 열 공유 링크"
                  onFocus={(event) => event.target.select()}
                />
                <button className="button primary" onClick={() => void copyLink()}>
                  <Link2 size={16} /> 링크 복사
                </button>
                <small>링크를 가진 사람은 기록을 수정할 수 있으니 두 분만 보관해 주세요.</small>
              </>
            ) : (
              <p>전달받은 공유 링크를 열면 두 사람의 기록이 자동으로 연결돼요.</p>
            )}
            <button
              className="button secondary"
              onClick={() => {
                download(JSON.stringify(plan, null, 2), `우리의-결혼준비-${today()}.json`);
                setNotice('백업을 내려받았어요.');
              }}
            >
              <Download size={16} /> 백업 다운로드
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="simple-toast" role="status">
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
