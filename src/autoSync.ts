import { ConflictError, InvalidLinkError, type LinkWorkspace } from './linkCloud';
import { isCashflowNote, validateCashflow } from './cashflow';
import { validatePlan, type Plan } from './model';

export type SyncStatus =
  | 'local'
  | 'connecting'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error';
export type SyncTransport = {
  load(token: string): Promise<LinkWorkspace>;
  save(token: string, plan: Plan, expectedRevision: number): Promise<LinkWorkspace>;
};
export type SyncDraft = {
  version: 1;
  initialPlan: Plan;
  plan: Plan;
  base: LinkWorkspace | null;
};
export type SyncSnapshot = {
  plan: Plan;
  status: SyncStatus;
  error: string;
  connected: boolean;
  workspaceId: string | null;
  revision: number | null;
  dirty: boolean;
  loading: boolean;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a),
      other = Object.keys(b);
    return (
      keys.length === other.length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
};
const missing = Symbol('missing');
type Value = unknown | typeof missing;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const idArray = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((item) => object(item) && typeof item.id === 'string');

function mergeValue(base: Value, local: Value, remote: Value, path: string[]): Value {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  // A deletion wins only against an unchanged item. Concurrent edits are kept.
  if (local === missing) return remote;
  if (remote === missing) return local;
  if (idArray(local) && idArray(remote) && (base === missing || idArray(base))) {
    const before = new Map(
      (base === missing ? [] : (base as { id: string }[])).map((item) => [item.id, item]),
    );
    const ours = new Map(local.map((item) => [item.id, item]));
    const theirs = new Map(remote.map((item) => [item.id, item]));
    const ids = [...new Set([...remote.map((item) => item.id), ...local.map((item) => item.id)])];
    return ids.flatMap((id) => {
      const merged = mergeValue(
        before.get(id) ?? missing,
        ours.get(id) ?? missing,
        theirs.get(id) ?? missing,
        [...path, id],
      );
      return merged === missing ? [] : [merged];
    });
  }
  if (object(local) && object(remote) && (base === missing || object(base))) {
    const before = base === missing ? {} : (base as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(remote),
      ...Object.keys(local),
    ])) {
      let b = Object.hasOwn(before, key) ? before[key] : missing;
      let l = Object.hasOwn(local, key) ? local[key] : missing;
      let r = Object.hasOwn(remote, key) ? remote[key] : missing;
      const cashflow =
        key === 'body' &&
        path[0] === 'notes' &&
        (isCashflowNote(local as { id: string; tag: string }) ||
          isCashflowNote(remote as { id: string; tag: string }));
      if (
        cashflow &&
        typeof l === 'string' &&
        typeof r === 'string' &&
        (b === missing || typeof b === 'string')
      ) {
        // A note is the persistence envelope; its entries are independent records.
        try {
          b = b === missing ? missing : validateCashflow(JSON.parse(b as string));
          l = validateCashflow(JSON.parse(l));
          r = validateCashflow(JSON.parse(r));
        } catch {
          throw new Error(
            '자금 계획을 자동으로 합치지 못했습니다. 이 기기의 수정은 보관되어 있습니다.',
          );
        }
        const merged = validateCashflow(mergeValue(b, l, r, [...path, key]));
        result[key] = JSON.stringify(merged);
      } else {
        const merged = mergeValue(b, l, r, [...path, key]);
        if (merged !== missing) result[key] = merged;
      }
    }
    if (path[0] === 'tasks' && path.length === 2) {
      // Exact day, month and wedding offset form one schedule. Merging their
      // fields independently could silently change which mode takes precedence.
      const chosen = !equal(
        [local.date, local.month, local.offset],
        [before.date, before.month, before.offset],
      )
        ? local
        : remote;
      result.date = chosen.date;
      if (chosen.month) result.month = chosen.month;
      else delete result.month;
      result.offset = chosen.offset;
    }
    if (path[0] === 'notes' && path.at(-2) === 'entries' && 'date' in local && 'date' in remote) {
      const chosen = !equal([local.date, local.precision], [before.date, before.precision])
        ? local
        : remote;
      result.date = chosen.date;
      if (chosen.precision) result.precision = chosen.precision;
      else delete result.precision;
    }
    return result;
  }
  return local;
}

/** Merge only edits made since base; untouched local fields always follow remote. */
export function mergePlans(base: Plan, local: Plan, remote: Plan): Plan {
  const merged = mergeValue(base, local, remote, []) as Plan;
  return clone(validatePlan(merged));
}
export function samePlanContent(a: Plan, b: Plan) {
  const { updatedAt: _a, ...left } = a;
  const { updatedAt: _b, ...right } = b;
  return equal(left, right);
}
export function validateSyncDraft(input: unknown): SyncDraft {
  if (!object(input) || input.version !== 1)
    throw new Error('저장된 수정 내용을 확인할 수 없습니다.');
  const initialPlan = validatePlan(input.initialPlan),
    plan = validatePlan(input.plan);
  let base: LinkWorkspace | null = null;
  if (input.base !== null) {
    if (
      !object(input.base) ||
      typeof input.base.id !== 'string' ||
      !input.base.id ||
      !Number.isSafeInteger(input.base.revision) ||
      Number(input.base.revision) < 1 ||
      typeof input.base.updatedAt !== 'string'
    )
      throw new Error('저장된 수정 내용을 확인할 수 없습니다.');
    base = { ...input.base, plan: validatePlan(input.base.plan) } as LinkWorkspace;
  }
  return clone({ version: 1, initialPlan, plan, base });
}

/** Serial RPC queue: no save response can replace edits made while it was in flight. */
export class AutoSyncEngine {
  private plan: Plan;
  private initialPlan: Plan;
  private base: LinkWorkspace | null;
  private status: SyncStatus = 'connecting';
  private error = '';
  private dirty: boolean;
  private online = true;
  private stopped = false;
  private epoch = 0;
  private refreshRequested = false;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 3000;
  private listeners = new Set<() => void>();
  private snapshot: SyncSnapshot;
  private readonly debounceMs: number;
  private recoveryDrafts: SyncDraft[];

  constructor(
    private readonly options: {
      cloud: SyncTransport;
      token: string;
      initialPlan: Plan;
      draft?: SyncDraft;
      recoveryDrafts?: SyncDraft[];
      debounceMs?: number;
      persist?: (draft: SyncDraft) => void;
    },
  ) {
    const draft = options.draft ? validateSyncDraft(options.draft) : null;
    this.initialPlan = clone(draft?.initialPlan ?? validatePlan(options.initialPlan));
    this.plan = clone(draft?.plan ?? this.initialPlan);
    this.base = draft?.base ?? null;
    this.dirty = !samePlanContent(this.plan, this.base?.plan ?? this.initialPlan);
    this.debounceMs = options.debounceMs ?? 400;
    this.recoveryDrafts = (options.recoveryDrafts ?? []).map(validateSyncDraft);
    this.snapshot = this.makeSnapshot();
  }
  private makeSnapshot(): SyncSnapshot {
    return {
      plan: this.plan,
      status: this.status,
      error: this.error,
      connected: !this.stopped,
      workspaceId: this.base?.id ?? null,
      revision: this.base?.revision ?? null,
      dirty: this.dirty,
      loading: this.status === 'connecting',
    };
  }
  getSnapshot = () => this.snapshot;
  getDraft = (): SyncDraft =>
    clone({ version: 1, initialPlan: this.initialPlan, plan: this.plan, base: this.base });
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(persist = true) {
    if (persist) {
      try {
        this.options.persist?.(this.getDraft());
      } catch {
        this.error = '이 기기에 수정 내용을 보관하지 못했습니다. 저장 공간을 확인해 주세요.';
      }
    }
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
  update(fn: (plan: Plan) => Plan) {
    if (this.stopped) return;
    const next = clone(validatePlan(fn(clone(this.plan))));
    if (samePlanContent(next, this.plan)) return;
    next.updatedAt = new Date().toISOString();
    this.plan = next;
    this.dirty = !samePlanContent(next, this.base?.plan ?? this.initialPlan);
    this.status = this.online ? 'pending' : 'offline';
    this.error = '';
    this.emit();
    if (this.online) this.schedule(this.debounceMs);
  }
  start = () => this.refresh();
  refresh = (): Promise<void> => {
    this.refreshRequested = true;
    return this.flush();
  };
  setOnline(value: boolean) {
    this.online = value;
    if (!value) {
      clearTimeout(this.timer);
      this.status = 'offline';
      this.emit();
    } else void this.refresh();
  }
  stop() {
    this.stopped = true;
    this.epoch++;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.stopped && this.online)
      this.timer = setTimeout(() => {
        void this.flush();
      }, delay);
  }
  private acceptRemote(remote: LinkWorkspace) {
    if (this.base && remote.id !== this.base.id) throw new Error('공동 공간을 확인할 수 없습니다.');
    if (this.base && remote.revision < this.base.revision) return;
    let next = clone(remote.plan);
    for (const draft of this.recoveryDrafts) {
      const before = draft.base?.plan ?? draft.initialPlan;
      if (!samePlanContent(before, draft.plan)) next = mergePlans(before, draft.plan, next);
    }
    if (this.dirty) next = mergePlans(this.base?.plan ?? this.initialPlan, this.plan, next);
    this.base = clone(remote);
    this.plan = next;
    this.dirty = !samePlanContent(next, remote.plan);
    this.recoveryDrafts = [];
    this.emit();
  }
  flush = (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.stopped || !this.online) return Promise.resolve();
    if (this.running) return this.running;
    const epoch = this.epoch;
    const current = () => !this.stopped && epoch === this.epoch;
    const work = (async () => {
      let conflicts = 0;
      try {
        if (!this.base || this.refreshRequested) {
          this.refreshRequested = false;
          if (!this.base) this.status = 'connecting';
          this.emit(false);
          const remote = await this.options.cloud.load(this.options.token);
          if (!current()) return;
          this.acceptRemote(remote);
        }
        while (current() && this.online && this.dirty && this.base) {
          const sent = clone(this.plan),
            expectedRevision = this.base.revision;
          this.status = 'saving';
          this.error = '';
          this.emit(false);
          try {
            const saved = await this.options.cloud.save(this.options.token, sent, expectedRevision);
            if (!current()) return;
            if (saved.id !== this.base.id || saved.revision <= expectedRevision)
              throw new Error('공동 저장 결과를 확인할 수 없습니다.');
            this.plan = mergePlans(sent, this.plan, saved.plan);
            this.base = clone(saved);
            this.dirty = !samePlanContent(this.plan, saved.plan);
            break; // Edits made during this save retain their own debounce window.
          } catch (cause) {
            if (!current()) return;
            if (!(cause instanceof ConflictError)) throw cause;
            const remote = await this.options.cloud.load(this.options.token);
            if (!current()) return;
            this.acceptRemote(remote);
            if (++conflicts >= 3) break;
          }
        }
        if (!current()) return;
        this.retryDelay = 3000;
        this.status = this.online ? (this.dirty ? 'pending' : 'saved') : 'offline';
        this.error = '';
        this.emit();
      } catch (cause) {
        if (!current()) return;
        this.status = cause instanceof InvalidLinkError ? 'error' : 'offline';
        this.error =
          cause instanceof Error
            ? cause.message
            : '연결이 복구되면 수정 내용을 자동으로 저장합니다.';
        this.emit();
        if (!(cause instanceof InvalidLinkError)) {
          this.refreshRequested = true;
          this.schedule(this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 60000);
        }
      }
    })();
    // The work can complete synchronously when there is nothing to load/save.
    // Clear the assigned promise in a microtask, never from inside that work.
    const running = work.finally(() => {
      if (this.running === running) this.running = null;
      if (current() && this.online && !['offline', 'error'].includes(this.status)) {
        if (this.refreshRequested) this.schedule(0);
        else if (this.dirty) this.schedule(this.debounceMs);
      }
    });
    this.running = running;
    return running;
  };
}
