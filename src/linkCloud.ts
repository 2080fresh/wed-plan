import { ConflictError, readCloudConfig, validateCloudConfig, type CloudConfig } from './cloud';
import { validatePlan, type Plan } from './model';

export { ConflictError } from './cloud';
export type LinkWorkspace = {
  id: string;
  plan: Plan;
  revision: number;
  updatedAt: string;
};

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PLAN_BYTES = 5 * 1024 * 1024;

export class InvalidLinkError extends Error {
  constructor() {
    super(
      '공유 연결 링크가 올바르지 않거나 더 이상 사용할 수 없습니다. 전달받은 링크를 확인해 주세요.',
    );
    this.name = 'InvalidLinkError';
  }
}

function validateToken(input: string): string {
  const token = input.trim();
  if (!TOKEN_PATTERN.test(token)) throw new InvalidLinkError();
  return token;
}

function siteBase(siteUrl?: string | URL): URL {
  try {
    const url = new URL(siteUrl?.toString() ?? window.location.href);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new InvalidLinkError();
    return url;
  } catch {
    throw new InvalidLinkError();
  }
}

/** Accept only this site's exact path, or a directly pasted capability token. */
export function parseConnectionToken(input: string, siteUrl?: string | URL): string {
  const value = input.trim();
  if (TOKEN_PATTERN.test(value)) return value;
  try {
    const link = new URL(value);
    const base = siteBase(siteUrl);
    if (
      link.origin !== base.origin ||
      link.pathname !== base.pathname ||
      link.username ||
      link.password ||
      link.search
    )
      throw new InvalidLinkError();
    const match = /^#connect=([a-f0-9]{64})$/.exec(link.hash);
    if (!match) throw new InvalidLinkError();
    return match[1];
  } catch {
    throw new InvalidLinkError();
  }
}

/** Fragments stay on the device and are not sent with the page's HTTP request. */
export function formatConnectionLink(token: string, siteUrl?: string | URL): string {
  const checked = validateToken(token);
  const url = siteBase(siteUrl);
  url.search = '';
  url.hash = `connect=${checked}`;
  return url.toString();
}

function checkedPlan(input: unknown): Plan {
  const plan = validatePlan(input);
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_PLAN_BYTES)
    throw new Error('계획이 너무 큽니다. 최대 5 MB까지 저장할 수 있습니다.');
  return plan;
}

function workspaceFromResponse(value: unknown): LinkWorkspace {
  if (!Array.isArray(value) || value.length !== 1)
    throw new Error('공유 저장소 응답을 확인할 수 없습니다.');
  const row = value[0] as Record<string, unknown> | null;
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    typeof row.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(row.updated_at))
  )
    throw new Error('공유 저장소 응답을 확인할 수 없습니다.');
  return {
    id: row.id,
    plan: checkedPlan(row.plan),
    revision: row.revision as number,
    updatedAt: row.updated_at,
  };
}

function throwRpcError(value: unknown): never {
  const error = value as { message?: unknown; code?: unknown } | null;
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('OWOL_REVISION_CONFLICT')) throw new ConflictError();
  if (message.includes('OWOL_LINK_INVALID')) throw new InvalidLinkError();
  if (message.includes('OWOL_PLAN_INVALID'))
    throw new Error('저장할 계획의 형식이나 크기를 확인해 주세요. (최대 5 MB)');
  if (['PGRST202', 'PGRST205', '42P01'].includes(String(error?.code)))
    throw new Error('공유 저장소가 아직 준비되지 않았습니다. 연결 설정을 확인해 주세요.');
  // Do not echo raw server messages: they can contain request details or tokens.
  throw new Error(
    '공유 저장소 요청을 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  );
}

/** Capability RPCs never create, read, or attach a Supabase Auth session. */
export class LinkCloud {
  readonly config: CloudConfig;

  constructor(config: CloudConfig) {
    this.config = validateCloudConfig(config);
  }

  async load(token: string): Promise<LinkWorkspace> {
    return this.request('owol_link_load', { p_token: validateToken(token) });
  }

  async save(token: string, plan: Plan, expectedRevision: number): Promise<LinkWorkspace> {
    const checked = validateToken(token);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('공유 내용을 먼저 가져온 뒤 저장해 주세요.');
    return this.request('owol_link_save', {
      p_token: checked,
      p_plan: checkedPlan(plan),
      p_expected_revision: expectedRevision,
    });
  }

  private async request(
    rpc: 'owol_link_load' | 'owol_link_save',
    payload: Record<string, unknown>,
  ): Promise<LinkWorkspace> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers: { apikey: this.config.key, 'Content-Type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error('공유 저장소에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('공유 저장소 응답을 확인할 수 없습니다.');
    }
    if (!response.ok) throwRpcError(data);
    return workspaceFromResponse(data);
  }
}

export function createLinkCloud(config: CloudConfig | null = readCloudConfig()): LinkCloud | null {
  return config ? new LinkCloud(config) : null;
}
