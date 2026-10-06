import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AutoSyncEngine,
  samePlanContent,
  validateSyncDraft,
  type SyncDraft,
  type SyncSnapshot,
} from './autoSync';
import { deploymentCloudConfig, readCloudConfig, type CloudConfig } from './cloud';
import { LinkCloud, formatConnectionLink, parseConnectionToken } from './linkCloud';
import { STORAGE_KEY, createPlan, validatePlan, type Plan } from './model';

export const CONNECTION_KEY = 'owol-link-connection-v1';
const DRAFT_PREFIX = 'owol-autosync-draft-v1:';
const RECOVERY_KEY = 'owol-plan-before-auto-sync-v1';
function preserveLegacyRecord() {
  const original = localStorage.getItem(STORAGE_KEY);
  if (original && !localStorage.getItem(RECOVERY_KEY)) localStorage.setItem(RECOVERY_KEY, original);
}
type Options = {
  subscribeRealtime?: (cloud: LinkCloud, token: string, onChange: () => void) => () => void;
  config?: CloudConfig | null;
  pollMs?: number;
};
function devicePlan(): { plan: Plan; error: string } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return { plan: raw ? validatePlan(JSON.parse(raw)) : createPlan(), error: '' };
  } catch {
    if (raw) {
      try {
        localStorage.setItem('owol-unreadable-local-plan-v1', raw);
      } catch {
        /* Leave the original key intact. */
      }
    }
    return {
      plan: createPlan(),
      error: raw
        ? '기존 기기 기록을 읽지 못했습니다. 원본을 유지한 채 공동 기록을 불러옵니다.'
        : '이 기기의 저장 공간에 접근하지 못했습니다.',
    };
  }
}
function rememberedToken(url: string): string {
  try {
    const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
    return saved?.url === url ? parseConnectionToken(saved.token) : '';
  } catch {
    return '';
  }
}
function normalizeRoute() {
  const hash = window.location.hash === '#cashflow' ? '#cashflow' : '#timeline';
  if (window.location.hash !== hash)
    window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
}
function incomingToken(): string {
  return window.location.hash.startsWith('#connect=')
    ? parseConnectionToken(window.location.href)
    : '';
}
function localSnapshot(plan: Plan, error = ''): SyncSnapshot {
  return {
    plan,
    status: 'local',
    error,
    connected: false,
    workspaceId: null,
    revision: null,
    dirty: false,
    loading: false,
  };
}
type DraftRecord = { key: string; raw: string; draft: SyncDraft };
function readDrafts(prefix: string): DraftRecord[] {
  const records: DraftRecord[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        records.push({ key, raw, draft: validateSyncDraft(JSON.parse(raw)) });
      } catch {
        /* Keep an unreadable draft unchanged for recovery. */
      }
    }
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return records.sort((a, b) => a.draft.plan.updatedAt.localeCompare(b.draft.plan.updatedAt));
}

/** Automatic capability-link connection, durable local drafts and remote updates. */
export function useSharedPlan(options: Options = {}) {
  const [config] = useState(() =>
    options.config === undefined ? (readCloudConfig() ?? deploymentCloudConfig) : options.config,
  );
  const [initialState] = useState(devicePlan);
  const initial = initialState.plan;
  const [connection, setConnection] = useState(() => {
    let error = '',
      token = config ? rememberedToken(config.url) : '';
    try {
      token = incomingToken() || token;
    } catch {
      error = '공유 링크를 확인해 주세요. 전달받은 링크 전체를 다시 열어 주세요.';
    }
    return { token, error };
  });
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() =>
    connection.token && config
      ? { ...localSnapshot(initial), connected: true, loading: true, status: 'connecting' }
      : localSnapshot(initial, connection.error),
  );
  const engine = useRef<AutoSyncEngine | null>(null);
  const plan = useRef(initial);
  const documentId = useRef(crypto.randomUUID());
  const realtimeSubscriber = useRef(options.subscribeRealtime);
  realtimeSubscriber.current = options.subscribeRealtime;

  const connect = useCallback(
    (input: string) => {
      try {
        if (!config) throw new Error('공동 저장소 연결 설정을 확인해 주세요.');
        const token = parseConnectionToken(input);
        localStorage.setItem(CONNECTION_KEY, JSON.stringify({ url: config.url, token }));
        if (token !== connection.token) {
          engine.current?.stop();
          engine.current = null;
          setSnapshot({
            ...localSnapshot(plan.current),
            connected: true,
            loading: true,
            status: 'connecting',
          });
        }
        setConnection({ token, error: '' });
        normalizeRoute();
        if (token === connection.token) void engine.current?.refresh();
        return true;
      } catch (cause) {
        setSnapshot((value) => ({
          ...value,
          error: cause instanceof Error ? cause.message : '공유 링크를 확인해 주세요.',
        }));
        return false;
      }
    },
    [config, connection.token],
  );

  useEffect(() => {
    const receive = () => {
      if (window.location.hash.startsWith('#connect=')) connect(window.location.href);
      normalizeRoute();
    };
    receive();
    window.addEventListener('hashchange', receive);
    const changed = (event: StorageEvent) => {
      if (event.key === CONNECTION_KEY || event.key === null)
        setConnection({ token: config ? rememberedToken(config.url) : '', error: '' });
    };
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('hashchange', receive);
      window.removeEventListener('storage', changed);
    };
  }, [config, connect]);

  useEffect(() => {
    if (!config || !connection.token) {
      setSnapshot(localSnapshot(plan.current, connection.error));
      return;
    }
    const cloud = new LinkCloud(config);
    const prefix = `${DRAFT_PREFIX}${config.url}:${connection.token}:`;
    const key = prefix + documentId.current;
    const records = readDrafts(prefix);
    const primary = records.at(-1);
    const recovered = records.filter(
      (record) =>
        record !== primary &&
        !samePlanContent(record.draft.plan, record.draft.base?.plan ?? record.draft.initialPlan),
    );
    try {
      localStorage.setItem(
        CONNECTION_KEY,
        JSON.stringify({ url: config.url, token: connection.token }),
      );
      preserveLegacyRecord();
    } catch {
      /* The engine reports storage errors without blocking a usable link. */
    }
    const next = new AutoSyncEngine({
      cloud,
      token: connection.token,
      initialPlan: plan.current,
      draft: primary?.draft,
      recoveryDrafts: recovered.map((record) => record.draft),
      persist(draft) {
        // If the first backup cannot be written, keep the old device key intact.
        preserveLegacyRecord();
        // Each document has its own durable queue, so another tab cannot erase it.
        localStorage.setItem(key, JSON.stringify(draft));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft.plan));
      },
    });
    engine.current = next;
    const changed = () => {
      const value = next.getSnapshot();
      plan.current = value.plan;
      setSnapshot(value);
      if (value.status === 'saved' && !value.dirty) {
        for (const record of records) {
          if (record.key === key) continue;
          try {
            // Never delete another document's newer pending edit.
            if (localStorage.getItem(record.key) === record.raw)
              localStorage.removeItem(record.key);
          } catch {
            /* Keeping a recovery copy is safe. */
          }
        }
      }
    };
    const unsubscribe = next.subscribe(changed);
    changed();
    next.setOnline(navigator.onLine);
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void next.refresh();
    };
    const online = () => next.setOnline(true);
    const offline = () => next.setOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const poll = window.setInterval(refresh, options.pollMs ?? 15000);
    let unsubscribeRealtime: (() => void) | undefined;
    try {
      unsubscribeRealtime = realtimeSubscriber.current?.(cloud, connection.token, () => {
        void next.refresh();
      });
    } catch {
      /* Polling remains active if a realtime connection cannot be opened. */
    }
    return () => {
      unsubscribe();
      next.stop();
      if (engine.current === next) engine.current = null;
      unsubscribeRealtime?.();
      clearInterval(poll);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [config, connection.token, connection.error, options.pollMs]);

  const update = useCallback((fn: (current: Plan) => Plan) => {
    try {
      if (engine.current) engine.current.update(fn);
      else {
        const next = validatePlan(fn(structuredClone(plan.current)));
        next.updatedAt = new Date().toISOString();
        plan.current = next;
        setSnapshot(localSnapshot(next));
        preserveLegacyRecord();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch (cause) {
      setSnapshot((value) => ({
        ...value,
        error: cause instanceof Error ? cause.message : '수정 내용을 저장하지 못했습니다.',
      }));
    }
  }, []);
  const refresh = useCallback(() => engine.current?.refresh() ?? Promise.resolve(), []);
  const disconnect = useCallback(() => {
    engine.current?.stop();
    engine.current = null;
    try {
      localStorage.removeItem(CONNECTION_KEY);
    } catch {
      /* Current page disconnect still works. */
    }
    setConnection({ token: '', error: '' });
    setSnapshot(localSnapshot(plan.current));
    normalizeRoute();
  }, []);
  return {
    ...snapshot,
    error: snapshot.error || initialState.error,
    update,
    connect,
    disconnect,
    refresh,
    connectionLink: connection.token ? formatConnectionLink(connection.token) : '',
  };
}
