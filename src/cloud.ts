export type CloudConfig = { url: string; key: string };
const CONFIG_KEY = 'owol-cloud-config-v1';
const DISCONNECTED = 'disabled';
// GitHub Actions supplies these browser-safe values at build time.
const deployedUrl = import.meta.env?.VITE_SUPABASE_URL;
const deployedKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const deploymentCloudConfig: CloudConfig | null =
  deployedUrl && deployedKey ? { url: deployedUrl, key: deployedKey } : null;

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

export function readCloudConfig(
  defaultConfig: CloudConfig | null = deploymentCloudConfig,
): CloudConfig | null {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (value === DISCONNECTED) return null;
    return value
      ? validateCloudConfig(JSON.parse(value))
      : defaultConfig
        ? validateCloudConfig(defaultConfig)
        : null;
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
  // Explicit disconnection must survive a refresh even with a deployment default.
  localStorage.setItem(CONFIG_KEY, DISCONNECTED);
}
