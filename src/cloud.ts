import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validatePlan, type Plan } from './model';

export type CloudConfig = { url: string; key: string };
export type Workspace = {
  id: string;
  ownerId: string;
  plan: Plan;
  revision: number;
  updatedAt: string;
};
export type WorkspaceSummary = Omit<Workspace, 'plan'>;
const CONFIG_KEY = 'owol-cloud-config-v1';
const COLUMNS = 'id,owner_id,plan,revision,updated_at';
const MAX_PLAN_BYTES = 5 * 1024 * 1024;

export class ConflictError extends Error {
  constructor() {
    super(
      '상대방이 먼저 저장한 변경 사항이 있습니다. 내 내용을 백업한 뒤 최신 내용을 가져와 주세요.',
    );
    this.name = 'ConflictError';
  }
}

/** This check rejects accidentally pasted server credentials; the server authenticates keys. */
export function validateCloudConfig(input: CloudConfig): CloudConfig {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error('Supabase 프로젝트 URL을 확인해 주세요.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error('프로젝트의 HTTPS 기본 URL을 입력해 주세요.');
  }
  const key = input.key.trim();
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      publicKey = JSON.parse(atob(payload)).role === 'anon';
    } catch {
      /* Invalid JWT. */
    }
  }
  if (!publicKey)
    throw new Error(
      'Publishable key 또는 anon 공개 키만 사용할 수 있습니다. secret / service_role 키는 입력하지 마세요.',
    );
  return { url: url.origin, key };
}

export function readCloudConfig(): CloudConfig | null {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    return value ? validateCloudConfig(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}
export function saveCloudConfig(config: CloudConfig): CloudConfig {
  const normalized = validateCloudConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}
export function clearCloudConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

function checkError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.message.includes('OWOL_REVISION_CONFLICT')) throw new ConflictError();
  if (error.message.includes('OWOL_WORKSPACE_FULL'))
    throw new Error('이 준비 공간에는 이미 두 분이 참여하고 있습니다.');
  if (error.message.includes('OWOL_INVITE_INVALID'))
    throw new Error('초대 코드가 만료되었거나 올바르지 않습니다. 새 코드를 받아 주세요.');
  if (error.message.includes('OWOL_OWNER_ONLY'))
    throw new Error('준비 공간을 만든 분만 초대 코드를 발급할 수 있습니다.');
  if (error.message.includes('OWOL_AUTH_REQUIRED'))
    throw new Error('먼저 이메일로 로그인해 주세요.');
  if (error.message.includes('OWOL_NOT_MEMBER'))
    throw new Error('이 준비 공간에 접근할 수 없습니다.');
  if (error.message.includes('OWOL_PLAN_INVALID'))
    throw new Error('저장할 계획의 형식이나 크기를 확인해 주세요. (최대 5 MB)');
  if (error.code === 'PGRST202' || error.code === '42P01')
    throw new Error(
      '공유 저장소가 아직 준비되지 않았습니다. Supabase에서 setup.sql을 실행해 주세요.',
    );
  throw new Error(error.message);
}

function workspaceFromRow(value: unknown): Workspace {
  const row = value as Record<string, unknown> | null;
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.owner_id !== 'string' ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    typeof row.updated_at !== 'string'
  ) {
    throw new Error('공유 저장소 응답을 확인할 수 없습니다.');
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    plan: validatePlan(row.plan),
    revision: row.revision as number,
    updatedAt: row.updated_at,
  };
}

function planToSend(plan: Plan): Plan {
  const checked = validatePlan(plan);
  if (new TextEncoder().encode(JSON.stringify(checked)).byteLength > MAX_PLAN_BYTES)
    throw new Error('계획이 너무 큽니다. 최대 5 MB까지 저장할 수 있습니다.');
  return checked;
}

export class CloudStore {
  readonly client: SupabaseClient;
  readonly config: CloudConfig;
  constructor(config: CloudConfig) {
    this.config = validateCloudConfig(config);
    this.client = createClient(this.config.url, this.config.key, {
      auth: {
        // A static Pages site has no auth callback server. Supabase consumes and removes
        // the magic-link fragment, persists the session, and refreshes its access token.
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: `owol-auth-${new URL(this.config.url).hostname}`,
      },
    });
  }
  get auth() {
    return this.client.auth;
  }

  async sendMagicLink(email: string): Promise<void> {
    const redirect = new URL(window.location.href);
    redirect.hash = '';
    redirect.search = '';
    const { error } = await this.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true },
    });
    checkError(error);
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const { data, error } = await this.client
      .from('wedding_workspaces')
      .select('id,owner_id,revision,updated_at')
      .order('updated_at', { ascending: false });
    checkError(error);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      ownerId: row.owner_id as string,
      revision: Number(row.revision),
      updatedAt: row.updated_at as string,
    }));
  }

  async loadWorkspace(id: string): Promise<Workspace> {
    const { data, error } = await this.client
      .from('wedding_workspaces')
      .select(COLUMNS)
      .eq('id', id)
      .single();
    checkError(error);
    return workspaceFromRow(data);
  }

  async createWorkspace(plan: Plan): Promise<Workspace> {
    const { data, error } = await this.client.rpc('owol_create_workspace', {
      p_plan: planToSend(plan),
    });
    checkError(error);
    return workspaceFromRow(data?.[0]);
  }

  async joinWorkspace(inviteToken: string): Promise<Workspace> {
    const token = inviteToken.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error('전달받은 64자리 초대 코드를 그대로 입력해 주세요.');
    const { data, error } = await this.client.rpc('owol_join_workspace', { p_token: token });
    checkError(error);
    return workspaceFromRow(data?.[0]);
  }

  /** Only an atomic database revision match can commit. Never retry conflicts automatically. */
  async saveWorkspace(id: string, plan: Plan, expectedRevision: number): Promise<Workspace> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('공유 내용을 먼저 가져온 뒤 저장해 주세요.');
    const { data, error } = await this.client.rpc('owol_save_workspace', {
      p_workspace_id: id,
      p_plan: planToSend(plan),
      p_expected_revision: expectedRevision,
    });
    checkError(error);
    return workspaceFromRow(data?.[0]);
  }

  async getInviteToken(id: string): Promise<string> {
    return this.issueInvite(id, false);
  }
  async rotateInviteToken(id: string): Promise<string> {
    return this.issueInvite(id, true);
  }
  private async issueInvite(id: string, rotate: boolean): Promise<string> {
    const { data, error } = await this.client.rpc('owol_issue_invite', {
      p_workspace_id: id,
      p_rotate: rotate,
    });
    checkError(error);
    if (typeof data !== 'string' || !/^[a-f0-9]{64}$/.test(data))
      throw new Error('초대 코드를 생성하지 못했습니다.');
    return data;
  }

  dispose(): void {
    this.auth.stopAutoRefresh();
    void this.client.removeAllChannels();
  }
}

export function createCloud(config: CloudConfig): CloudStore {
  return new CloudStore(config);
}
