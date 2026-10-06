import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Cloud, Copy, Download, Link, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { readCloudConfig, deploymentCloudConfig, saveCloudConfig } from './cloud';
import {
  LinkCloud,
  parseConnectionToken,
  formatConnectionLink,
  type LinkWorkspace,
} from './linkCloud';
import { download, today, type Plan } from './model';
import { Button, Field } from './ui';

type Confirmation = { title: string; body: string; action: () => void } | null;
type Props = {
  plan: Plan;
  onReplace: (plan: Plan) => void;
  notify: (message: string) => void;
  confirm: Dispatch<SetStateAction<Confirmation>>;
};
type Binding = { token: string; workspace: LinkWorkspace; url: string };
const CONNECTION_KEY = 'owol-link-connection-v1';
let activeBinding: Binding | null = null;
let pendingToken = '';
let pendingError = '';

// Fragments stay off host requests. Remove the capability before app navigation.
export function receiveSharedLink(): boolean {
  if (!window.location.hash.startsWith('#connect=')) return false;
  try {
    pendingToken = parseConnectionToken(window.location.href);
    pendingError = '';
  } catch {
    pendingToken = '';
    pendingError = '공유 링크를 확인해 주세요. 전달받은 링크 전체를 다시 열어 주세요.';
  }
  window.history.replaceState(null, '', window.location.pathname + '#settings');
  window.dispatchEvent(new Event('owol-shared-link'));
  return true;
}

function rememberedToken(url: string): string {
  try {
    const value = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
    return value?.url === url ? parseConnectionToken(value.token) : '';
  } catch {
    return '';
  }
}

export function SharedSettings({ plan, onReplace, notify, confirm }: Props) {
  const [config, setConfig] = useState(readCloudConfig);
  const [cloud, setCloud] = useState(() => (config ? new LinkCloud(config) : null));
  const [token, setToken] = useState(() => (config ? rememberedToken(config.url) : ''));
  const [input, setInput] = useState(pendingToken);
  const [candidate, setCandidate] = useState<{ token: string; workspace: LinkWorkspace } | null>(
    null,
  );
  const [binding, setBinding] = useState(() =>
    activeBinding?.url === config?.url && activeBinding?.token === token ? activeBinding : null,
  );
  const [error, setError] = useState(pendingError);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [linkRequest, setLinkRequest] = useState(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const connectionEpoch = useRef(0);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    mounted.current = true;
    const incoming = () => {
      connectionEpoch.current++;
      setLinkRequest((value) => value + 1);
    };
    window.addEventListener('owol-shared-link', incoming);
    const changed = (event: StorageEvent) => {
      if (event.key !== CONNECTION_KEY && event.key !== null) return;
      connectionEpoch.current++;
      activeBinding = null;
      setBinding(null);
      setCandidate(null);
      setToken(config ? rememberedToken(config.url) : '');
      setMessage('다른 탭에서 연결이 바뀌었어요. 공동 기록을 다시 가져와 주세요.');
    };
    window.addEventListener('storage', changed);
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener('owol-shared-link', incoming);
    };
  }, [config]);

  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current) {
        const text =
          cause instanceof Error ? cause.message : '연결을 확인한 뒤 다시 시도해 주세요.';
        setError(text);
        notify(text);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy('');
    }
  }
  function say(text: string) {
    setMessage(text);
    notify(text);
  }
  function isCurrentConnection(epoch: number) {
    return mounted.current && connectionEpoch.current === epoch;
  }
  function acceptConfirmation(epoch: number) {
    confirm(null);
    if (isCurrentConnection(epoch)) return true;
    if (mounted.current) say('연결이 바뀌었어요. 현재 연결에서 작업을 다시 선택해 주세요.');
    return false;
  }
  function bind(nextToken: string, workspace: LinkWorkspace) {
    if (!config) return;
    activeBinding = { token: nextToken, workspace, url: config.url };
    setBinding(activeBinding);
    setToken(nextToken);
    setCandidate(null);
    setInput('');
    try {
      localStorage.setItem(CONNECTION_KEY, JSON.stringify({ url: config.url, token: nextToken }));
    } catch {
      setError('이 기기에 연결을 기억하지 못했어요. 공유 링크를 따로 보관해 주세요.');
    }
  }
  async function inspect(value: string) {
    if (!cloud) return;
    const epoch = connectionEpoch.current;
    const nextToken = parseConnectionToken(value);
    const workspace = await cloud.load(nextToken);
    if (isCurrentConnection(epoch)) {
      setCandidate({ token: nextToken, workspace });
      setInput('');
      say('공동 공간을 찾았어요. 아래에서 가져올 기록을 선택해 주세요.');
    }
  }
  useEffect(() => {
    if (pendingError) {
      setError(pendingError);
      pendingError = '';
    }
    if (!pendingToken || !cloud || busyRef.current) return;
    const incoming = pendingToken;
    pendingToken = '';
    pendingError = '';
    connectionEpoch.current++;
    activeBinding = null;
    setBinding(null);
    setCandidate(null);
    void run('공동 공간을 확인하는 중…', () => inspect(incoming));
  }, [cloud, linkRequest, busy]);

  function askLoad(nextToken: string) {
    if (!cloud) return;
    const epoch = connectionEpoch.current;
    confirm({
      title: '최신 공동 기록을 가져올까요?',
      body: '이 기기의 기록을 JSON 백업으로 내려받은 뒤, 두 분이 공유하는 최신 기록으로 바꿉니다.',
      action: () => {
        if (!acceptConfirmation(epoch)) return;
        void run('최신 기록을 가져오는 중…', async () => {
          const before = planRef.current;
          const workspace = await cloud.load(nextToken);
          if (!isCurrentConnection(epoch)) return;
          if (planRef.current !== before)
            throw new Error('가져오는 동안 기록이 수정됐어요. 다시 가져와 주세요.');
          download(JSON.stringify(before, null, 2), '오월-가져오기전-백업-' + today() + '.json');
          onReplace(workspace.plan);
          bind(nextToken, workspace);
          say('최신 공동 기록을 가져왔어요. 편집 후 공동 공간에 저장해 주세요.');
        });
      },
    });
  }
  function startWithLocal() {
    if (!cloud || !candidate || candidate.workspace.revision !== 1) return;
    const target = candidate;
    const epoch = connectionEpoch.current;
    confirm({
      title: '이 기기의 기록으로 공동 준비를 시작할까요?',
      body: '현재 작성한 모든 기록을 공동 공간에 저장합니다. 다른 기기에서는 같은 공유 링크를 열어 가져올 수 있어요.',
      action: () => {
        if (!acceptConfirmation(epoch)) return;
        void run('처음 공동 기록을 저장하는 중…', async () => {
          const workspace = await cloud.save(
            target.token,
            planRef.current,
            target.workspace.revision,
          );
          if (!isCurrentConnection(epoch)) return;
          bind(target.token, workspace);
          say('공동 준비를 시작했어요. 공유 링크를 상대방에게 전달해 주세요.');
        });
      },
    });
  }
  async function copyLink() {
    if (!token) return;
    const link = formatConnectionLink(token);
    try {
      await navigator.clipboard.writeText(link);
      say('공유 링크를 복사했어요. 두 분의 기기에서만 열어 주세요.');
    } catch {
      download(link, '오월-비공개-공유링크.txt', 'text/plain');
      say('공유 링크를 파일로 내려받았어요.');
    }
  }
  const locked = !!busy;
  return (
    <section className="panel settings-panel" aria-labelledby="shared-settings-title">
      <div className="section-head">
        <div>
          <h2 id="shared-settings-title">
            <Cloud size={20} /> 함께 쓰는 준비 공간
          </h2>
          <p>로그인 없이, 공유 링크 하나로 함께 준비해요.</p>
        </div>
        <span className="badge purple">
          {binding ? '공동 공간 연결됨' : token ? '연결 기억됨' : '기기 저장 사용 중'}
        </span>
      </div>
      <p className="help-text">
        기기에는 자동 저장됩니다. 편집을 시작할 때 최신 공동 기록을 가져오고, 마치면 ‘공동 공간에
        저장’을 눌러 주세요.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {(busy || message) && (
        <p className="help-text" role="status">
          {busy || message}
        </p>
      )}
      {!cloud && (
        <div className="alert">
          <p>공동 공간의 기본 연결을 사용해 주세요.</p>
          <Button
            disabled={locked || !deploymentCloudConfig}
            onClick={() => {
              if (!deploymentCloudConfig) return;
              const defaults = deploymentCloudConfig;
              void run('공동 공간을 연결하는 중…', async () => {
                const next = saveCloudConfig(defaults);
                connectionEpoch.current++;
                setConfig(next);
                setCloud(new LinkCloud(next));
                setToken(rememberedToken(next.url));
                setBinding(null);
                activeBinding = null;
              });
            }}
          >
            기본 연결 사용
          </Button>
        </div>
      )}
      {cloud && (
        <>
          {token && (
            <>
              <div className="form-footer">
                <Button variant="secondary" disabled={locked} onClick={() => askLoad(token)}>
                  <Download size={16} /> 최신 공동 기록 가져오기
                </Button>
                <Button
                  disabled={locked || !binding}
                  onClick={() => {
                    if (!binding) return;
                    const target = binding;
                    const epoch = connectionEpoch.current;
                    void run('공동 공간에 저장하는 중…', async () => {
                      const workspace = await cloud.save(
                        target.token,
                        planRef.current,
                        target.workspace.revision,
                      );
                      if (!isCurrentConnection(epoch)) return;
                      bind(target.token, workspace);
                      say('공동 공간에 저장했어요. 다른 기기에서 최신 내용을 가져올 수 있어요.');
                    });
                  }}
                >
                  <Upload size={16} /> 공동 공간에 저장
                </Button>
              </div>
              <p className="help-text">
                {binding
                  ? '마지막 공동 저장: ' +
                    new Date(binding.workspace.updatedAt).toLocaleString('ko-KR')
                  : '새로 연 창에서는 최신 공동 기록을 가져온 뒤 저장할 수 있어요. 기기의 수정은 가져오기 전에 자동 백업됩니다.'}
              </p>
              <div className="form-footer">
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => void run('공유 링크를 복사하는 중…', copyLink)}
                >
                  <Copy size={16} /> 다른 기기 연결 링크 복사
                </Button>
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => {
                    const epoch = connectionEpoch.current;
                    confirm({
                      title: '이 기기의 공동 연결을 해제할까요?',
                      body: '기록은 그대로 남고, 이 기기에서 기억한 공유 링크만 지웁니다. 다시 연결하려면 공유 링크가 필요해요.',
                      action: () => {
                        if (!acceptConfirmation(epoch)) return;
                        void run('연결을 해제하는 중…', async () => {
                          localStorage.removeItem(CONNECTION_KEY);
                          connectionEpoch.current++;
                          pendingToken = '';
                          pendingError = '';
                          activeBinding = null;
                          setBinding(null);
                          setToken('');
                          setCandidate(null);
                          setInput('');
                          say('이 기기의 연결을 해제했어요.');
                        });
                      },
                    });
                  }}
                >
                  이 기기 연결 해제
                </Button>
              </div>
            </>
          )}
          {candidate && (
            <div className="alert">
              <strong>함께 사용할 준비 공간을 찾았어요</strong>
              <p>
                공동 기록: 일정 {candidate.workspace.plan.tasks.length}개 · 예산 항목{' '}
                {candidate.workspace.plan.expenses.length}개
              </p>
              <div className="form-footer">
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() => askLoad(candidate.token)}
                >
                  <RefreshCw size={16} /> 공동 기록 가져오기
                </Button>
                {candidate.workspace.revision === 1 && (
                  <Button disabled={locked} onClick={startWithLocal}>
                    이 기기의 기록으로 공동 준비 시작
                  </Button>
                )}
              </div>
            </div>
          )}
          <details open={!token && !candidate}>
            <summary>
              <Link size={15} /> {token ? '다른 공유 링크 연결' : '공유 링크로 연결하기'}
            </summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run('공동 공간을 확인하는 중…', () => inspect(input));
              }}
            >
              <Field label="전달받은 공유 링크" hint="처음 한 번만 연결하면 이 기기에서 기억해요.">
                <input
                  type="password"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="공유 링크 전체를 붙여 넣으세요"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  disabled={locked}
                />
              </Field>
              <div className="form-footer">
                <Button type="submit" variant="secondary" disabled={locked || !input.trim()}>
                  준비 공간 연결
                </Button>
              </div>
            </form>
          </details>
        </>
      )}
      <p className="help-text">
        <ShieldCheck size={14} /> 공유 링크를 가진 사람은 기록을 읽고 수정할 수 있어요. 두 분만
        보관하고, 새 휴대폰이나 PC에서도 같은 링크를 열어 주세요.
      </p>
    </section>
  );
}
