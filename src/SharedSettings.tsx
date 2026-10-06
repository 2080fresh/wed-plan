import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { Cloud, Copy, Download, LogOut, RefreshCw, ShieldCheck, Upload, Users } from 'lucide-react';
import {
  createCloud,
  clearCloudConfig,
  readCloudConfig,
  saveCloudConfig,
  validateCloudConfig,
  type CloudConfig,
  type CloudStore,
  type Workspace,
  type WorkspaceSummary,
} from './cloud';
import { download, today, type Plan } from './model';
import { Button, Field } from './ui';

type Confirmation = { title: string; body: string; action: () => void } | null;
type Props = {
  plan: Plan;
  onReplace: (plan: Plan) => void;
  notify: (message: string) => void;
  confirm: Dispatch<SetStateAction<Confirmation>>;
};
type Binding = {
  url: string;
  userId: string;
  workspaceId: string;
  revision: number;
  ownerId: string;
  updatedAt: string;
};
type SignedInUser = { id: string; email?: string };
const BINDING_KEY = 'owol-cloud-tab-binding-v1';
let sharedCloud: CloudStore | null = null;
let unsubscribeSharedAuth: (() => void) | null = null;
// A revision is valid only for the current page lifetime, whose in-memory plan
// is known. Reloading may recover an older localStorage plan after a write error.
const activeBindings = new Map<string, Binding>();
const bindingKey = (url: string, userId: string) => JSON.stringify([url, userId]);
function forgetProjectBindings(url: string) {
  for (const [key, value] of activeBindings) if (value.url === url) activeBindings.delete(key);
}
function clearRememberedSpace() {
  try {
    sessionStorage.removeItem(BINDING_KEY);
  } catch {
    /* Memory binding still clears. */
  }
}

function getSharedCloud(config: CloudConfig): CloudStore {
  if (
    !sharedCloud ||
    sharedCloud.config.url !== config.url ||
    sharedCloud.config.key !== config.key
  ) {
    unsubscribeSharedAuth?.();
    sharedCloud?.dispose();
    sharedCloud = createCloud(config);
    const {
      data: { subscription },
    } = sharedCloud.auth.onAuthStateChange((event) => {
      // Also clear bindings when another tab signs out while Settings is closed.
      if (event === 'SIGNED_OUT') {
        forgetProjectBindings(config.url);
        clearRememberedSpace();
      }
    });
    unsubscribeSharedAuth = () => subscription.unsubscribe();
  }
  return sharedCloud;
}

/** Call once from App: auth callbacks must work even before Settings is mounted. */
export async function initializeSharedAuth(): Promise<void> {
  const config = readCloudConfig();
  if (!config) return;
  const isCallback = /(?:^#|&)(access_token|error|error_description)=/.test(window.location.hash);
  const { error } = await getSharedCloud(config).auth.getSession();
  if (isCallback) {
    // The SDK consumes successful auth fragments. Also remove rejected/expired tokens.
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#settings`,
    );
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  if (error) throw error;
}

function readRememberedSpace(url: string, userId: string): string {
  try {
    const value: Pick<Binding, 'url' | 'userId' | 'workspaceId'> | null = JSON.parse(
      sessionStorage.getItem(BINDING_KEY) || 'null',
    );
    return value &&
      value.url === url &&
      value.userId === userId &&
      typeof value.workspaceId === 'string'
      ? value.workspaceId
      : '';
  } catch {
    return '';
  }
}

export function SharedSettings({ plan, onReplace, notify, confirm }: Props) {
  const [config, setConfig] = useState(readCloudConfig);
  const [url, setUrl] = useState(config?.url || '');
  const [key, setKey] = useState(config?.key || '');
  const [cloud, setCloud] = useState<CloudStore | null>(() =>
    config ? getSharedCloud(config) : null,
  );
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [authReady, setAuthReady] = useState(!cloud);
  const [email, setEmail] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [binding, setBinding] = useState<Binding | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const planRef = useRef(plan);
  const userRef = useRef(user);
  const inviteRef = useRef<HTMLTextAreaElement>(null);
  planRef.current = plan;
  userRef.current = user;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function fail(cause: unknown) {
    const text = cause instanceof Error ? cause.message : '연결을 확인한 뒤 다시 시도해 주세요.';
    if (mounted.current) {
      setError(text);
      notify(text);
    }
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      fail(cause);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy('');
    }
  }
  function say(text: string) {
    if (mounted.current) {
      setMessage(text);
      notify(text);
    }
  }

  useEffect(() => {
    if (!cloud) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    let active = true;
    setAuthReady(false);
    const {
      data: { subscription },
    } = cloud.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        forgetProjectBindings(cloud.config.url);
        clearRememberedSpace();
      }
      if (active) {
        setUser(session?.user || null);
        setAuthReady(true);
      }
    });
    void cloud.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) setError(authError.message);
      setUser(data.session?.user || null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [cloud]);

  useEffect(() => {
    setWorkspaces([]);
    setInvite('');
    if (!cloud || !user?.id) {
      setBinding(null);
      setSelected('');
      return;
    }
    const remembered = activeBindings.get(bindingKey(cloud.config.url, user.id)) || null;
    setBinding(remembered);
    setSelected(remembered?.workspaceId || readRememberedSpace(cloud.config.url, user.id));
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const rows = await cloud.listWorkspaces();
        if (active) {
          setWorkspaces(rows);
          setSelected((value) =>
            value && rows.some((row) => row.id === value) ? value : rows[0]?.id || '',
          );
          // Deliberately do not copy any server revision into the local binding.
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '공동 공간 목록을 확인하지 못했습니다.',
          );
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cloud, user?.id]);

  function bind(workspace: Workspace, signedInUser: SignedInUser) {
    if (!cloud) return;
    const next: Binding = {
      url: cloud.config.url,
      userId: signedInUser.id,
      workspaceId: workspace.id,
      ownerId: workspace.ownerId,
      revision: workspace.revision,
      updatedAt: workspace.updatedAt,
    };
    // Navigation inside the app preserves this binding; a full reload requires
    // an explicit load. Persist only the selected space, never a usable revision.
    activeBindings.set(bindingKey(next.url, next.userId), next);
    try {
      sessionStorage.setItem(
        BINDING_KEY,
        JSON.stringify({ url: next.url, userId: next.userId, workspaceId: next.workspaceId }),
      );
    } catch {
      setError(
        '이 탭의 연결 정보를 기억하지 못했습니다. 새로고침 후 공동 내용을 다시 가져와 주세요.',
      );
    }
    setBinding(next);
    setSelected(workspace.id);
    setInvite('');
    setWorkspaces((rows) => [
      {
        id: workspace.id,
        ownerId: workspace.ownerId,
        revision: workspace.revision,
        updatedAt: workspace.updatedAt,
      },
      ...rows.filter((row) => row.id !== workspace.id),
    ]);
  }
  function replaceWith(workspace: Workspace, signedInUser: SignedInUser) {
    if (!mounted.current || userRef.current?.id !== signedInUser.id) return;
    download(JSON.stringify(planRef.current, null, 2), `오월-공유가져오기전-백업-${today()}.json`);
    onReplace(workspace.plan);
    // Advance the binding only if the parent's replacement callback accepted it.
    bind(workspace, signedInUser);
    say('현재 내용을 백업하고 공동 공간의 최신 내용을 가져왔어요.');
  }
  function askToLoad() {
    if (!cloud || !user || !selected) return;
    const target = selected,
      signedInUser = user;
    confirm({
      title: '공동 공간의 내용을 가져올까요?',
      body: '현재 기기의 기록을 JSON 백업으로 내려받은 뒤 공동 공간의 최신 기록으로 바꿉니다. 아직 공동 저장하지 않은 수정은 백업 파일에 남습니다.',
      action: () => {
        confirm(null);
        void run('공동 내용을 가져오는 중…', async () =>
          replaceWith(await cloud.loadWorkspace(target), signedInUser),
        );
      },
    });
  }
  function askToJoin(event: FormEvent) {
    event.preventDefault();
    if (!cloud || !user || !joinCode.trim()) return;
    const token = joinCode,
      signedInUser = user;
    confirm({
      title: '초대받은 준비 공간에 참여할까요?',
      body: '참여하면 현재 기기의 기록을 JSON으로 백업한 뒤 상대방의 준비 내용을 가져옵니다.',
      action: () => {
        confirm(null);
        void run('준비 공간에 참여하는 중…', async () => {
          const workspace = await cloud.joinWorkspace(token);
          replaceWith(workspace, signedInUser);
          setJoinCode('');
        });
      },
    });
  }
  const remote = binding ? workspaces.find((row) => row.id === binding.workspaceId) : undefined;
  const newer =
    remote && binding && binding.workspaceId === selected && remote.revision > binding.revision;
  const canSave = !!cloud && !!user && !!binding && binding.workspaceId === selected;
  const canInvite = canSave && binding?.ownerId === user?.id;
  const locked = !!busy;

  return (
    <section className="panel settings-panel" aria-labelledby="shared-settings-title">
      <div className="section-head">
        <div>
          <h2 id="shared-settings-title">
            <Cloud size={20} /> 함께 쓰는 준비 공간
          </h2>
          <p>각자의 휴대폰과 PC에서 같은 계획을 이어서 준비해요.</p>
        </div>
        <span className="badge purple">
          {!cloud
            ? '기기 저장 사용 중'
            : !authReady
              ? '로그인 확인 중'
              : user
                ? '로그인됨'
                : '로그인 필요'}
        </span>
      </div>
      <p className="help-text">
        이 기기의 편집은 자동 저장됩니다. 두 분이 공유할 때는 최신 내용을 가져온 뒤 편집하고, ‘공동
        공간에 저장’을 눌러 주세요.
      </p>
      <p className="help-text">
        <a
          href="https://github.com/2080fresh/wed-plan/blob/main/docs/SHARED-SETUP.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          처음 연결하기 · Supabase 설정 안내 ↗
        </a>
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="help-text" role="status">
          {message}
        </p>
      )}
      {busy && (
        <p className="help-text" role="status">
          {busy}
        </p>
      )}
      <details open={!cloud}>
        <summary>공유 저장소 연결 설정 {cloud ? '· 연결됨' : ''}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('공유 저장소를 연결하는 중…', async () => {
              // Validate before replacing a working configuration or signing out.
              const next = validateCloudConfig({ url, key });
              if (cloud && (cloud.config.url !== next.url || cloud.config.key !== next.key)) {
                const { error: logoutError } = await cloud.auth.signOut({ scope: 'local' });
                if (logoutError) throw logoutError;
                forgetProjectBindings(cloud.config.url);
                clearRememberedSpace();
              }
              saveCloudConfig(next);
              const store = getSharedCloud(next);
              setConfig(next);
              setUrl(next.url);
              setKey(next.key);
              setCloud(store);
              setBinding(null);
              say('공유 저장소 설정을 저장했어요. 이메일로 로그인해 주세요.');
            });
          }}
        >
          <div className="form-grid">
            <Field label="Supabase 프로젝트 URL">
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://프로젝트.supabase.co"
                required
                disabled={locked}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Publishable key (공개 키)" hint="sb_publishable_… 또는 기존 anon 키">
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="sb_publishable_…"
                required
                disabled={locked}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
          <p className="help-text">
            <ShieldCheck size={14} /> 두 분이 같은 URL과 공개 키를 입력하면 됩니다. 로그인한
            참여자만 준비 내용을 읽을 수 있어요.
          </p>
          <div className="form-footer">
            {cloud && (
              <Button
                variant="ghost"
                disabled={locked}
                onClick={() => {
                  void run('연결을 해제하는 중…', async () => {
                    const { error: logoutError } = await cloud.auth.signOut({ scope: 'local' });
                    if (logoutError) throw logoutError;
                    clearCloudConfig();
                    forgetProjectBindings(cloud.config.url);
                    clearRememberedSpace();
                    unsubscribeSharedAuth?.();
                    unsubscribeSharedAuth = null;
                    cloud.dispose();
                    sharedCloud = null;
                    setCloud(null);
                    setConfig(null);
                    setBinding(null);
                    setUser(null);
                    say('공유 연결을 해제했어요. 이 기기의 기록은 계속 사용할 수 있어요.');
                  });
                }}
              >
                연결 해제
              </Button>
            )}
            <Button type="submit" variant="secondary" disabled={locked}>
              연결 설정 저장
            </Button>
          </div>
        </form>
      </details>
      {cloud && authReady && !user && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('로그인 메일을 보내는 중…', async () => {
              await cloud.sendMagicLink(email);
              say('로그인 링크를 보냈어요. 메일의 링크를 지금 사용하는 브라우저에서 열어 주세요.');
            });
          }}
        >
          <div className="form-grid">
            <Field label="내 이메일" full>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
                disabled={locked}
              />
            </Field>
          </div>
          <div className="form-footer">
            <Button type="submit" disabled={locked}>
              이메일로 로그인 링크 받기
            </Button>
          </div>
          <p className="help-text">
            두 분은 각자의 이메일로 로그인합니다. 메일이 오지 않으면 스팸함과 설정 안내의 SMTP
            항목을 확인해 주세요.
          </p>
        </form>
      )}
      {cloud && user && (
        <>
          <div className="section-head">
            <p>
              <ShieldCheck size={16} /> {user.email || '이메일 계정으로 로그인됨'}
            </p>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => {
                void run('로그아웃하는 중…', async () => {
                  const { error: logoutError } = await cloud.auth.signOut({ scope: 'local' });
                  if (logoutError) throw logoutError;
                  forgetProjectBindings(cloud.config.url);
                  clearRememberedSpace();
                  setBinding(null);
                  say('이 기기에서 로그아웃했어요.');
                });
              }}
            >
              <LogOut size={15} /> 로그아웃
            </Button>
          </div>
          {workspaces.length > 0 && (
            <>
              <Field label="나의 공동 준비 공간">
                <select
                  value={selected}
                  disabled={locked}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setInvite('');
                  }}
                >
                  {workspaces.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.ownerId === user.id ? '내가 만든' : '함께 참여한'} 준비 공간 ·{' '}
                      {row.id.slice(0, 8)} · 버전 {row.revision}
                    </option>
                  ))}
                </select>
              </Field>
              {binding && selected === binding.workspaceId ? (
                <p className="help-text">
                  이 탭에서 불러오거나 저장한 버전: {binding.revision} · 마지막 공유 저장:{' '}
                  {new Intl.DateTimeFormat('ko-KR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Asia/Seoul',
                  }).format(new Date(binding.updatedAt))}
                </p>
              ) : (
                <p className="help-text">
                  먼저 공동 내용을 가져오면 이 탭에서 편집하고 저장할 수 있어요. 새로고침 후에는
                  다시 가져와 주세요. 현재 수정 내용은 가져오기 전에 자동 백업합니다.
                </p>
              )}
              {newer && (
                <div className="alert" role="status">
                  공동 공간에 더 새로운 내용이 있어요 (버전 {remote.revision}). 내 수정이 있다면
                  백업한 뒤 최신 내용을 가져와 주세요.
                </div>
              )}
              <div className="form-footer">
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => {
                    void run('공동 공간 목록을 확인하는 중…', async () => {
                      setWorkspaces(await cloud.listWorkspaces());
                      say('공동 공간의 저장 상태를 확인했어요.');
                    });
                  }}
                >
                  <RefreshCw size={15} /> 상태 확인
                </Button>
                <Button variant="secondary" disabled={locked || !selected} onClick={askToLoad}>
                  <Download size={16} /> 최신 내용 가져오기
                </Button>
                <Button
                  disabled={locked || !canSave || !!newer}
                  onClick={() => {
                    if (!binding) return;
                    const localSnapshot = planRef.current;
                    void run('공동 공간에 저장하는 중…', async () => {
                      const workspace = await cloud.saveWorkspace(
                        binding.workspaceId,
                        localSnapshot,
                        binding.revision,
                      );
                      if (!mounted.current || userRef.current?.id !== user.id) return;
                      bind(workspace, user);
                      // Keep any edits made while the request was in flight; never replace here.
                      say(
                        planRef.current === localSnapshot
                          ? '공동 공간에 저장했어요. 상대방이 최신 내용을 가져올 수 있어요.'
                          : '공동 저장을 마쳤어요. 저장 중 추가한 수정은 한 번 더 공동 저장해 주세요.',
                      );
                    });
                  }}
                >
                  <Upload size={16} /> 공동 공간에 저장
                </Button>
              </div>
              {canInvite && (
                <div>
                  <div className="form-footer">
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() => {
                        if (!binding) return;
                        void run('초대 코드를 확인하는 중…', async () => {
                          setInvite(await cloud.getInviteToken(binding.workspaceId));
                          say('상대방에게 초대 코드를 전달해 주세요. 7일 동안 유효해요.');
                        });
                      }}
                    >
                      <Users size={16} /> 상대방 초대 코드
                    </Button>
                    {invite && (
                      <Button
                        variant="ghost"
                        disabled={locked}
                        onClick={() => {
                          if (!binding) return;
                          void run('새 초대 코드를 만드는 중…', async () => {
                            setInvite(await cloud.rotateInviteToken(binding.workspaceId));
                            say('새 코드를 만들었어요. 이전 코드는 사용할 수 없어요.');
                          });
                        }}
                      >
                        코드 재발급
                      </Button>
                    )}
                  </div>
                  {invite && (
                    <>
                      <Field
                        label="상대방에게 전달할 초대 코드"
                        hint="한 번 참여하면 코드는 소모됩니다."
                      >
                        <textarea
                          ref={inviteRef}
                          readOnly
                          value={invite}
                          rows={2}
                          spellCheck={false}
                        />
                      </Field>
                      <Button
                        variant="secondary"
                        disabled={locked}
                        onClick={() => {
                          void run('초대 코드를 복사하는 중…', async () => {
                            try {
                              await navigator.clipboard.writeText(invite);
                              say('초대 코드를 복사했어요.');
                            } catch {
                              inviteRef.current?.select();
                              throw new Error('선택된 초대 코드를 직접 복사해 주세요.');
                            }
                          });
                        }}
                      >
                        <Copy size={15} /> 초대 코드 복사
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <div className="form-footer">
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() => {
                confirm({
                  title: '새 공동 준비 공간을 만들까요?',
                  body: '현재 기기의 모든 준비 내용으로 새 공간을 만듭니다. 상대방이 이미 공간을 만들었다면 초대 코드로 참여해 주세요.',
                  action: () => {
                    confirm(null);
                    const snapshot = planRef.current;
                    void run('공동 준비 공간을 만드는 중…', async () => {
                      const workspace = await cloud.createWorkspace(snapshot);
                      if (!mounted.current || userRef.current?.id !== user.id) return;
                      bind(workspace, user);
                      say('공동 준비 공간을 만들었어요. 초대 코드로 상대방을 초대해 주세요.');
                    });
                  },
                });
              }}
            >
              <Cloud size={16} /> 현재 기록으로 새 공동 공간 만들기
            </Button>
          </div>
          <form onSubmit={askToJoin}>
            <div className="form-grid">
              <Field label="상대방에게 받은 초대 코드" full>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  pattern="[a-fA-F0-9]{64}"
                  maxLength={64}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  disabled={locked}
                  placeholder="64자리 초대 코드를 붙여 넣으세요"
                />
              </Field>
            </div>
            <div className="form-footer">
              <Button type="submit" variant="secondary" disabled={locked || !joinCode.trim()}>
                <Users size={16} /> 초대받은 공간 참여하기
              </Button>
            </div>
          </form>
          <p className="help-text">
            같은 버전을 동시에 수정하면 먼저 저장한 내용만 반영하고 충돌을 안내합니다. 공유 데이터는
            자동으로 덮어쓰지 않으며, 설정 화면에서 30초마다 새 저장 여부를 확인합니다.
          </p>
        </>
      )}
    </section>
  );
}
